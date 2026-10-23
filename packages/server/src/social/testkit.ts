// Test kit of the social module (not imported by production code): the real D1 queries on node:sqlite, a fake PlayerHub
// namespace that records pushes, a fake Durable Object state with fake sockets, and a signed-request client that talks to
// the module's router in process. Workers-runtime behaviour (real D1, real hibernating sockets) is covered by the Miniflare tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateDeviceKey, signRequest, type DeviceKeys } from '../../../core/social/sign.ts';
import type { MyProfile, HubEvent, AgeBand } from '../../../core/social/types.ts';
import type { CfWebSocket, DurableObjectIdLike, DurableObjectNamespaceLike, DurableObjectStateLike, ExecutionContextLike, Fetcher } from '../cf.ts';
import { Router } from '../router.ts';
import type { D1Like, D1Result, D1Stmt } from './db.ts';
import type { SocialEnv } from './env.ts';
import { resetAuthCaches } from './auth.ts';
import { resetMemLimits } from './util.ts';
import { resetSweepThrottle } from './sweep.ts';
import { registerSocialRoutes } from './routes.ts';

// ───────── D1 on node:sqlite ─────────

const MIGRATION = readFileSync(new URL('../../migrations/0001_social.sql', import.meta.url), 'utf8');

/** Statements that return rows (a SELECT, or anything with RETURNING). */
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA)\b|\bRETURNING\b/i;

interface Counters { reads: number; writes: number; statements: number; changes: number }

class SqliteStmt implements D1Stmt {
  private readonly owner: SqliteD1;
  readonly sql: string;
  private readonly params: unknown[];
  constructor(owner: SqliteD1, sql: string, params: unknown[] = []) {
    this.owner = owner;
    this.sql = sql;
    this.params = params;
  }
  bind(...values: unknown[]): D1Stmt {
    return new SqliteStmt(this.owner, this.sql, values);
  }
  private exec(): { results: Record<string, unknown>[]; changes: number } {
    return this.owner.execute(this.sql, this.params);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const { results } = this.exec();
    return (results[0] as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { results, changes } = this.exec();
    return { results: results as T[], success: true, meta: { changes } };
  }
  async run(): Promise<D1Result> {
    const { results, changes } = this.exec();
    return { results, success: true, meta: { changes } };
  }
}

export class SqliteD1 implements D1Like {
  readonly raw: DatabaseSync;
  /** Counts the statements run: tests read these to prove how many rows a flow writes. */
  readonly counters: Counters = { reads: 0, writes: 0, statements: 0, changes: 0 };
  /** Every non-SELECT statement run (first 60 characters), for the write-budget test. */
  readonly log: string[] = [];
  constructor(raw: DatabaseSync) {
    this.raw = raw;
  }
  prepare(sql: string): D1Stmt {
    return new SqliteStmt(this, sql);
  }
  execute(sql: string, params: unknown[]): { results: Record<string, unknown>[]; changes: number } {
    const st = this.raw.prepare(sql);
    this.counters.statements++;
    if (RETURNS_ROWS.test(sql)) {
      const rows = st.all(...(params as never[])).map((r) => ({ ...r })) as Record<string, unknown>[];
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) { this.counters.writes += rows.length; this.log.push(sql.slice(0, 60)); } else this.counters.reads++;
      return { results: rows, changes: rows.length };
    }
    const info = st.run(...(params as never[]));
    const changes = Number(info.changes);
    this.counters.writes += changes;
    this.counters.changes += changes;
    if (changes > 0) this.log.push(sql.slice(0, 60));
    return { results: [], changes };
  }
  async batch(stmts: D1Stmt[]): Promise<D1Result[]> {
    this.raw.exec('BEGIN');
    try {
      const out: D1Result[] = [];
      for (const s of stmts) out.push(await (s as SqliteStmt).all());
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  resetCounters(): void {
    this.counters.reads = 0; this.counters.writes = 0; this.counters.statements = 0; this.counters.changes = 0;
    this.log.length = 0;
  }
}

/** A fresh in-memory database with the social schema. */
export function createTestDb(): SqliteD1 {
  const raw = new DatabaseSync(':memory:');
  raw.exec(MIGRATION);
  return new SqliteD1(raw);
}

// ───────── PlayerHub namespace ─────────

/** Stands in for the HUB binding: records what would be pushed to each player. A player is "online" after connect(). */
export class FakeHubs implements DurableObjectNamespaceLike {
  readonly sockets = new Set<string>();
  private readonly inbox = new Map<string, HubEvent[]>();
  readonly closes: { pid: string; reason: string }[] = [];

  idFromName(name: string): DurableObjectIdLike {
    return { name, toString: () => name };
  }

  get(id: DurableObjectIdLike): Fetcher {
    const pid = id.name ?? id.toString();
    return {
      fetch: async (input: Request | string, init?: RequestInit): Promise<Response> => {
        const req = input instanceof Request ? input : new Request(input, init);
        const path = new URL(req.url).pathname;
        if (path === '/push') {
          const ev = (await req.json()) as HubEvent;
          if (!this.sockets.has(pid)) return new Response(null, { status: 204 });
          const list = this.inbox.get(pid) ?? [];
          list.push(ev);
          this.inbox.set(pid, list);
          return Response.json({ n: 1 });
        }
        if (path === '/close') {
          const b = (await req.json()) as { reason: string };
          this.closes.push({ pid, reason: b.reason });
          this.sockets.delete(pid);
          return new Response(null, { status: 204 });
        }
        return new Response('not supported by the fake hub', { status: 501 });
      },
    };
  }

  connect(pid: string): void { this.sockets.add(pid); }
  disconnect(pid: string): void { this.sockets.delete(pid); }
  /** Events pushed to `pid` and not yet taken. */
  events(pid: string): HubEvent[] { return this.inbox.get(pid) ?? []; }
  /** Takes (and clears) the events pushed to `pid`. */
  take(pid: string): HubEvent[] {
    const list = this.inbox.get(pid) ?? [];
    this.inbox.delete(pid);
    return list;
  }
}

// ───────── Durable Object state and sockets ─────────

export class FakeSocket implements CfWebSocket {
  readyState = 1;
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private att: unknown = null;
  send(message: string): void {
    if (this.readyState !== 1) throw new Error('socket closed');
    this.sent.push(message);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) };
  }
  serializeAttachment(value: unknown): void { this.att = structuredClone(value); }
  deserializeAttachment(): unknown { return structuredClone(this.att); }
  /** The events the hub wrote to this socket. */
  events(): HubEvent[] { return this.sent.map((s) => JSON.parse(s) as HubEvent); }
}

export class FakeState implements DurableObjectStateLike {
  readonly id: DurableObjectIdLike = { toString: () => 'fake' };
  readonly storage = {} as DurableObjectStateLike['storage'];
  readonly sockets: FakeSocket[] = [];
  readonly pending: Promise<unknown>[] = [];
  acceptWebSocket(ws: CfWebSocket): void { this.sockets.push(ws as FakeSocket); }
  getWebSockets(): CfWebSocket[] { return [...this.sockets]; }
  setWebSocketAutoResponse(): void { /* the platform answers ping with pong */ }
  waitUntil(p: Promise<unknown>): void { this.pending.push(p); }
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
  /** Waits for everything the object scheduled with waitUntil. */
  async settle(): Promise<void> {
    while (this.pending.length > 0) await Promise.allSettled(this.pending.splice(0));
  }
}

/** The two Workers runtime globals the hub reads when it is built (not present in Node). */
export function installRuntimeStubs(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.WebSocketRequestResponsePair ??= class { request = ''; response = ''; };
  g.WebSocketPair ??= class { 0 = new FakeSocket(); 1 = new FakeSocket(); };
}

// ───────── the app and signed clients ─────────

export interface ApiResult<T = Record<string, any>> { status: number; body: T; headers: Headers }

export const TEST_ADMIN_TOKEN = 'admin-token-0123456789abcdef';
export const TEST_ORIGIN = 'https://bodyarcade.test';

export interface TestDevice { keys: DeviceKeys; ip: string }

export interface TestPlayer {
  dev: TestDevice;
  /** The profile as the server returned it at sign-up. */
  me: MyProfile;
  /** A signed request as this player. */
  api<T = Record<string, any>>(method: string, path: string, body?: unknown): Promise<ApiResult<T>>;
  get<T = Record<string, any>>(path: string): Promise<ApiResult<T>>;
  post<T = Record<string, any>>(path: string, body?: unknown): Promise<ApiResult<T>>;
  /** The secret profile id (read from the database; tests only). */
  pid(): string;
  /** The six friend-code characters as stored. */
  chars(): string;
}

export interface TestApp {
  router: Router;
  env: SocialEnv & Record<string, unknown>;
  db: SqliteD1;
  hubs: FakeHubs;
  /** Waits for the work scheduled after a response (pushes, sweeps). */
  settle(): Promise<void>;
  newDevice(ip?: string): Promise<TestDevice>;
  /** A request with no signature, or with `signed` as the player of that device. */
  call<T = Record<string, any>>(method: string, path: string, opts?: { dev?: TestDevice; body?: unknown; headers?: Record<string, string>; ip?: string; rawAuth?: string; at?: number }): Promise<ApiResult<T>>;
  /** Registers a new player and keeps their device. */
  signup(band: AgeBand, extra?: Record<string, unknown>, opts?: { ip?: string }): Promise<TestPlayer>;
  admin<T = Record<string, any>>(method: string, path: string, body?: unknown, token?: string | null): Promise<ApiResult<T>>;
}

let ipCounter = 0;
const nextIp = (): string => { ipCounter++; return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };

export interface AppOptions { env?: Partial<SocialEnv> & Record<string, unknown> }

export function createTestApp(opts: AppOptions = {}): TestApp {
  installRuntimeStubs();
  resetAuthCaches();
  resetMemLimits();
  resetSweepThrottle();
  const db = createTestDb();
  const hubs = new FakeHubs();
  const router = new Router();
  registerSocialRoutes(router);
  const env = {
    DB: db,
    HUB: hubs,
    TICKET_SECRET: 'test-secret-0123456789abcdef0123456789',
    PUBLIC_ORIGIN: TEST_ORIGIN,
    ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    ...opts.env,
  } as SocialEnv & Record<string, unknown>;
  const pending: Promise<unknown>[] = [];
  const ctx: ExecutionContextLike = { waitUntil: (p) => { pending.push(p); } };
  const settle = async (): Promise<void> => {
    while (pending.length > 0) await Promise.allSettled(pending.splice(0));
  };

  const app: TestApp = {
    router, env, db, hubs, settle,
    async newDevice(ip = nextIp()) {
      return { keys: await generateDeviceKey(), ip };
    },
    async call<T>(method: string, path: string, o: { dev?: TestDevice; body?: unknown; headers?: Record<string, string>; ip?: string; rawAuth?: string; at?: number } = {}): Promise<ApiResult<T>> {
      const headers: Record<string, string> = { 'CF-Connecting-IP': o.ip ?? o.dev?.ip ?? '10.99.99.99', ...o.headers };
      const hasBody = o.body !== undefined && method !== 'GET';
      if (hasBody) headers['Content-Type'] = 'application/json';
      const url = `${TEST_ORIGIN}${path}`;
      if (o.rawAuth !== undefined) headers['X-BA-Auth'] = o.rawAuth;
      else if (o.dev) headers['X-BA-Auth'] = await signRequest(o.dev.keys, { method, url, ...(hasBody ? { body: o.body } : {}) }, o.at ?? Date.now());
      const req = new Request(url, { method, headers, ...(hasBody ? { body: JSON.stringify(o.body) } : {}) });
      const res = await router.handle(req, env, ctx);
      if (!res) throw new Error(`no route for ${method} ${path}`);
      await settle();
      let body: unknown = null;
      const text = await res.text();
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body: body as T, headers: res.headers };
    },
    async signup(band, extra = {}, so = {}) {
      const dev = await app.newDevice(so.ip);
      const body = { pub: dev.keys.publicRaw, band, ...extra };
      const r = await app.call<{ me: MyProfile; error?: string }>('POST', '/api/social/register', { dev, body });
      if (r.status !== 201 && r.status !== 200) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
      const me = r.body.me;
      const player: TestPlayer = {
        dev, me,
        api: (method, path, b) => app.call(method, path, { dev, ...(b === undefined ? {} : { body: b }) }),
        get: (path) => app.call('GET', path, { dev }),
        post: (path, b = {}) => app.call('POST', path, { dev, body: b }),
        pid: () => (db.raw.prepare('SELECT pid FROM soc_profiles WHERE fid = ?').get(me.fid) as { pid: string }).pid,
        chars: () => me.code.replace(/^BA-/, ''),
      };
      return player;
    },
    async admin<T>(method: string, path: string, body?: unknown, token: string | null = TEST_ADMIN_TOKEN) {
      const headers: Record<string, string> = { 'CF-Connecting-IP': '10.77.77.77' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await router.handle(new Request(`${TEST_ORIGIN}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, ctx);
      if (!res) throw new Error(`no route for ${method} ${path}`);
      await settle();
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: res.status, body: parsed as T, headers: res.headers };
    },
  };
  return app;
}
