// The Room Durable Object: a thin adapter between Cloudflare's WebSocket Hibernation API and RoomEngine.
// All rules live in room-engine.ts. This file only turns sockets, storage, the alarm and the clock into EngineHost.
//
// Internal routes (reachable only from the Worker through the DO binding, never from the internet):
//   POST /init     {InitInput}       create the room
//   GET  /preview                    RoomPreview or 404
//   GET  /summary                    RoomSummary or 404 (lobby directory)
//   POST /check    {p, a, k}         join pre-check (CheckResult)
//   GET  /ws       + X-BA-Claims     WebSocket upgrade; the Worker verified the ticket and passes its claims
import type { CfWebSocket, DurableObjectStateLike } from '../cf.ts';
import { upgradeResponse, workersRuntime } from '../cf.ts';
import { b64url, fromB64url, isClaims } from './tickets.ts';
import { RoomEngine, type ConnAtt, type EngineConn, type EngineHost, type InitInput } from './room-engine.ts';
import { liveHooks } from './hooks.ts';
import type { LiveEnv } from './env.ts';

const OPEN = 1;
const STORED_KEYS = ['meta', 'members', 'match', 'ev', 'chat', 'reports'];

/** Header the Worker uses to hand the verified ticket claims to the Room. */
export const CLAIMS_HEADER = 'X-BA-Claims';

export function encodeClaims(claims: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(claims)));
}

class WsConn implements EngineConn {
  readonly id: string;
  private readonly ws: CfWebSocket;
  private cache: ConnAtt;

  /** `freshId` is given for a socket that was just accepted; later wrappers read the id from the attachment. */
  constructor(ws: CfWebSocket, freshId?: string) {
    this.ws = ws;
    const a = ws.deserializeAttachment() as ConnAtt | null | undefined;
    this.cache = a && typeof a === 'object' ? a : { c: freshId ?? '', p: '', n: '', a: 'adult', k: '', m: 0, s: null, t: null, h: false };
    this.id = freshId ?? this.cache.c;
  }

  get att(): ConnAtt { return this.cache; }
  set att(v: ConnAtt) {
    this.cache = v;
    try { this.ws.serializeAttachment(v); } catch { /* the socket is gone */ }
  }

  send(text: string): void { this.ws.send(text); }
  close(code: number, reason?: string): void { this.ws.close(code, reason); }
}

export class Room {
  protected readonly state: DurableObjectStateLike;
  protected readonly env: LiveEnv;
  protected engine!: RoomEngine;

  constructor(state: DurableObjectStateLike, env: LiveEnv) {
    this.state = state;
    this.env = env;
    // Keep-alive pings are answered by the platform without waking the object.
    state.setWebSocketAutoResponse(new (workersRuntime().WebSocketRequestResponsePair)('ping', 'pong'));
    void state.blockConcurrencyWhile(async () => {
      this.engine = await RoomEngine.create(this.host());
    });
  }

  private host(): EngineHost {
    const { state, env } = this;
    const hook = <T>(name: string, fn: () => T | Promise<T>): void => {
      state.waitUntil(Promise.resolve().then(fn).catch((e: unknown) => console.log(JSON.stringify({ evt: 'hook_error', hook: name, error: String(e) }))));
    };
    return {
      now: () => Date.now(),
      conns: () => state.getWebSockets().filter((ws) => ws.readyState === OPEN).map((ws) => new WsConn(ws)),
      load: async () => {
        const got = await state.storage.get<unknown>(STORED_KEYS);
        return Object.fromEntries(got);
      },
      save: (patch) => { state.storage.put(patch).catch((e: unknown) => console.log(JSON.stringify({ evt: 'save_error', error: String(e) }))); },
      deleteAll: () => { state.storage.deleteAll().catch((e: unknown) => console.log(JSON.stringify({ evt: 'delete_error', error: String(e) }))); },
      setAlarm: (at) => {
        const p = at === null ? state.storage.deleteAlarm() : state.storage.setAlarm(at);
        p.catch((e: unknown) => console.log(JSON.stringify({ evt: 'alarm_error', error: String(e) })));
      },
      randomU32: () => crypto.getRandomValues(new Uint32Array(1))[0] as number,
      uuid: () => crypto.randomUUID(),
      log: (line) => console.log(JSON.stringify(line)),
      hooks: {
        publish: (summary, pids) => { const h = liveHooks().publishRoom; if (h) hook('publishRoom', () => h(env, summary, pids)); },
        removed: (code) => { const h = liveHooks().removeRoom; if (h) hook('removeRoom', () => h(env, code)); },
        playing: (pid, inRoom, playing, gameId) => {
          const h = liveHooks().setPlaying;
          const code = this.engine.preview()?.code;
          if (h && code) hook('setPlaying', () => h(env, { code, pid, inRoom, playing, gameId }));
        },
        report: (r) => { const h = liveHooks().submitReport; if (h) hook('submitReport', () => h(env, r)); },
        block: (pid, target) => { const h = liveHooks().blockByPid; if (h) hook('blockByPid', () => h(env, pid, target)); },
      },
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/init': {
        const r = this.engine.init((await req.json()) as InitInput);
        return Response.json(r, { status: r.ok ? 200 : r.error === 'exists' ? 409 : 400 });
      }
      case '/preview': {
        const p = this.engine.preview();
        return p ? Response.json(p) : Response.json({ error: 'no_room' }, { status: 404 });
      }
      case '/summary': {
        const s = this.engine.summary();
        return s ? Response.json(s) : Response.json({ error: 'no_room' }, { status: 404 });
      }
      case '/check': {
        const r = this.engine.check((await req.json()) as { p: string; a: 'child' | 'teen' | 'adult'; k: string });
        return Response.json(r, { status: r.ok ? 200 : 403 });
      }
      case '/ws':
        return this.upgrade(req);
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private upgrade(req: Request): Response {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const raw = req.headers.get(CLAIMS_HEADER);
    const bytes = raw ? fromB64url(raw) : null;
    let claims: unknown = null;
    try { claims = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null; } catch { claims = null; }
    if (!isClaims(claims)) return new Response('bad claims', { status: 400 });
    const pair = new (workersRuntime().WebSocketPair)();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    // engine.accept stores the new id in the attachment together with the claims
    this.engine.accept(new WsConn(server, crypto.randomUUID()), claims);
    return upgradeResponse(client);
  }

  webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): void {
    this.engine.message(new WsConn(ws), message);
  }

  webSocketClose(ws: CfWebSocket, code: number, reason: string): void {
    try { ws.close(code === 1005 || code === 1006 || code === 1015 || code < 1000 ? 1000 : code, reason); } catch { /* already closed */ }
    this.engine.closed(new WsConn(ws));
  }

  webSocketError(ws: CfWebSocket): void {
    this.engine.closed(new WsConn(ws));
  }

  alarm(): void {
    this.engine.alarm();
  }
}
