// SocialDirectory: the one Durable Object ("main") that holds everything social: the profiles, the friend lists, presence, the
// lobby directory, the weekly boards, the synced documents and the moderation queue (its SQLite storage, schema.ts), and every
// player's live socket (hub.ts). There is no other database: the Worker and the Room objects only forward to it.
//
// Why one object. Everything here is relational (a friends list joins profiles and presence, a lobby list hides blocked pairs, a
// board joins scores and friends) and a request is a handful of small queries, so the queries run where the tables are and a call
// costs one hop. Requests are served one at a time, so "is there room in this list? then add" cannot be raced. The free plans cap
// the load far below what one object serves (100,000 requests a day is about one a second), and the day it is not enough the
// partitions are visible in the tables: the boards by game and week, the lobby rows by game, the limit counters by scope.
//
// What it answers (the object's name is DIRECTORY_NAME; env.ts):
//   /api/social/*, /api/admin/social/*   the module's routes (routes.ts), with the handlers running here; a WebSocket upgrade on
//                                        /api/social/hub is the player's presence connection
//   https://directory.internal/op/<name> the operations live play asks for (ops.ts), called by the hooks (hooks.ts)
import type { CfWebSocket, DurableObjectStateLike, ExecutionContextLike } from '../cf.ts';
import { HttpError, fail } from '../http.ts';
import { Router } from '../router.ts';
import { HUB_CLOSE } from '../../../core/social/types.ts';
import { authenticate } from './auth.ts';
import { sqlOfDurableObject, type DoSqlStorage, type SqlLike, type SqlMeter } from './db.ts';
import { INTERNAL_HOST, type SocialEnv } from './env.ts';
import { closedSocket, HubRegistry } from './hub.ts';
import { runOp } from './ops.ts';
import { registerDirectoryRoutes } from './routes.ts';
import { migrate } from './schema.ts';
import { guardRequest } from './util.ts';

/** How often the object logs what its SQL did (rows read and written: the numbers the free plan is counted in). */
export const METER_LOG_EVERY_MS = 60 * 60_000;

export class SocialDirectory {
  protected readonly state: DurableObjectStateLike;
  protected readonly storage: DoSqlStorage;
  protected readonly db: SqlLike;
  /** What the SQL did since the last log line. */
  protected readonly meter: SqlMeter = { statements: 0, rowsRead: 0, rowsWritten: 0 };
  protected readonly hub: HubRegistry;
  /** The environment of the handlers: the Worker's settings with this object's own SQL and sockets. */
  protected readonly env: SocialEnv & Record<string, unknown>;
  private readonly router = new Router();
  private readonly ctx: ExecutionContextLike;
  private meterAt = Date.now();

  constructor(state: DurableObjectStateLike, env: Record<string, unknown>) {
    this.state = state;
    this.storage = state.storage as unknown as DoSqlStorage;
    this.db = sqlOfDurableObject(this.storage, this.meter);
    this.hub = new HubRegistry(state, { DB: this.db });
    this.env = { ...env, DB: this.db, HUB: this.hub.namespace() } as SocialEnv & Record<string, unknown>;
    this.ctx = { waitUntil: (p) => state.waitUntil(p) };
    registerDirectoryRoutes(this.router, { connectHub: (req) => this.connectHub(req) });
    void state.blockConcurrencyWhile(async () => {
      const m = migrate(this.storage);
      if (m.from !== m.to) console.log(JSON.stringify({ evt: 'social_schema', from: m.from, to: m.to }));
    });
  }

  async fetch(req: Request): Promise<Response> {
    const now = Date.now();
    this.logMeter(now);
    const url = new URL(req.url);
    if (url.hostname === INTERNAL_HOST) return this.internal(req, url, now);
    const res = await this.router.handle(req, this.env, this.ctx);
    return res ?? new Response('not found', { status: 404 });
  }

  /** The calls the Worker's room routes and the Room objects make (never a request from the internet: it has another host). */
  private async internal(req: Request, url: URL, now: number): Promise<Response> {
    const m = /^\/op\/([a-z]+)$/.exec(url.pathname);
    if (!m || req.method !== 'POST') return new Response('not found', { status: 404 });
    let input: unknown;
    try { input = await req.json(); } catch { return fail('bad_json', 400); }
    return runOp({ env: this.env, now, wait: (p) => this.ctx.waitUntil(p.catch(() => undefined)) }, m[1] ?? '', input);
  }

  /**
   * GET /api/social/hub: verify the signed request, then keep the socket as the player's presence connection. A refusal is a
   * socket that is accepted and closed at once with a code the page can act on, because a bare HTTP error on an upgrade looks
   * like a network failure to a browser.
   */
  private readonly connectHub = async (req: Request): Promise<Response> => {
    if (req.headers.get('Upgrade') !== 'websocket') return fail('expected_websocket', 426);
    const origin = req.headers.get('Origin');
    if (origin) {
      let same = false;
      try { same = new URL(origin).host === new URL(req.url).host; } catch { same = false; }
      if (!same) return fail('origin', 403);
    }
    const now = Date.now();
    const pending: Promise<unknown>[] = [];
    try {
      guardRequest(this.env, req, null, now);
      const me = await authenticate({ req, db: this.db, now, wait: (p) => { pending.push(p); } }, undefined);
      guardRequest(this.env, req, me.pid, now);
      this.ctx.waitUntil(Promise.allSettled(pending));
      return this.hub.upgrade({ pid: me.pid, fid: me.fid, name: me.name, band: me.band });
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.code === 'banned') return closedSocket(HUB_CLOSE.BANNED, 'banned');
        if (e.status === 401) return closedSocket(HUB_CLOSE.AUTH, e.code);
        if (e.status === 429) return closedSocket(HUB_CLOSE.RATE, 'rate_limited');
      }
      throw e;
    }
  };

  async webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.hub.webSocketMessage(ws, message);
  }

  webSocketClose(ws: CfWebSocket, code: number, reason: string): void {
    this.hub.webSocketClose(ws, code, reason);
  }

  webSocketError(ws: CfWebSocket): void {
    this.hub.webSocketError(ws);
  }

  /** One line an hour with the rows the SQL read and wrote (Workers Logs): how close the day is to the free plan's numbers. */
  private logMeter(now: number): void {
    if (now - this.meterAt < METER_LOG_EVERY_MS) return;
    const { statements, rowsRead, rowsWritten } = this.meter;
    console.log(JSON.stringify({ evt: 'social_sql', sinceMs: now - this.meterAt, statements, rowsRead, rowsWritten }));
    this.meter.statements = 0;
    this.meter.rowsRead = 0;
    this.meter.rowsWritten = 0;
    this.meterAt = now;
  }
}
