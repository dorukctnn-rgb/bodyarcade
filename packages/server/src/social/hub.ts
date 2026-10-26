// The players' live sockets: presence and pushes. HubRegistry is held by the SocialDirectory Durable Object (directory.ts), which
// owns the social tables, so a status change is a local write and a push to a friend is a local `send`: no call from one
// object to another.
//
//   - Hibernating WebSockets: while the players are idle the object sleeps and costs nothing. The page sends the text 'ping'
//     every 45 seconds and the platform answers 'pong' without waking the object. A real message (a 'beat' every four minutes,
//     a status change) wakes it for a few milliseconds.
//   - Every socket is tagged `p:<pid>`, so a player's sockets are found without a scan. What a socket keeps is a small attachment
//     (who it is, its rate counters); the presence itself lives in the tables (soc_presence), where friends are listed with one query.
//   - Pushes come from the handlers (a friend request, an invitation, a friend's status): the registry writes the event to every
//     open socket of the player. `namespace()` is a stand-in for the old per-player objects, so presence.ts, friends.ts and the
//     others call it the way they always did (`env.HUB.get(env.HUB.idFromName(pid)).fetch(...)`) and it never leaves the object.
//
// What the namespace answers (the pid is the object's name):
//   POST /push   {HubEvent}   200 {n} when n sockets got it, 204 when none is open
//   POST /close  {reason}     tell and close every socket ('deleted' or 'banned')
import { isGameId, PRESENCE } from '../../../core/social/rules.ts';
import { HUB_CLOSE, type HubCommand, type HubEvent } from '../../../core/social/types.ts';
import { cryptoRandomBytes, toB64u } from '../../../core/social/codes.ts';
import type { AgeBand } from '../../../core/social/types.ts';
import type { CfWebSocket, DurableObjectIdLike, DurableObjectNamespaceLike, DurableObjectStateLike, Fetcher } from '../cf.ts';
import { upgradeResponse, workersRuntime } from '../cf.ts';
import type { SqlLike } from './db.ts';
import { beat, markOffline, markOnline, pushPresence, setClientStatus } from './presence.ts';

const OPEN = 1;
const MAX_MESSAGE_CHARS = 512;
/** A heartbeat closer than this to the last one is ignored (no write). */
export const BEAT_MIN_GAP_MS = 30_000;
/** Status changes: a burst of four, then one a minute (a flapping client costs a few writes, not thousands). */
export const STATUS_BURST = 4;
export const STATUS_REFILL_MS = 60_000;

/** What a hub socket remembers (the socket's attachment; survives hibernation). */
export interface HubAtt {
  /** Socket id (told apart from the replacing socket after a takeover). */
  i: string;
  /** Secret player id. */
  p: string;
  /** Friend-visible id and name. */
  f: string;
  n: string;
  a: AgeBand;
  /** Messages in the current second. */
  w: number;
  c: number;
  /** Status tokens and when they were last topped up. */
  tk: number;
  tt: number;
  /** Last accepted heartbeat. */
  b: number;
}

export interface HubIdentity { pid: string; fid: string; name: string; band: AgeBand }

const HUB_EVENT_TYPES: readonly string[] = ['hello', 'presence', 'friend_request', 'friend_added', 'friend_removed', 'request_cancelled', 'invite', 'invite_declined', 'closing'];

/** The tag every socket of a player carries. */
export const hubTag = (pid: string): string => `p:${pid}`;

function log(what: string, e: unknown): void {
  console.log(JSON.stringify({ evt: 'hub_error', what, error: String((e as { message?: unknown })?.message ?? e) }));
}

function readAtt(ws: CfWebSocket): HubAtt | null {
  try {
    const a = ws.deserializeAttachment() as HubAtt | null | undefined;
    return a && typeof a === 'object' && typeof a.p === 'string' ? a : null;
  } catch {
    return null;
  }
}

/** What the registry needs of the object's environment: the tables, and (in tests) the namespace pushes go to. */
export interface HubEnv {
  DB: SqlLike;
  /** Where pushes to friends go. Absent: the registry's own sockets, which is what the directory wants. */
  HUB?: DurableObjectNamespaceLike;
}

export class HubRegistry {
  protected readonly state: DurableObjectStateLike;
  protected readonly env: HubEnv;
  private readonly local: DurableObjectNamespaceLike;

  constructor(state: DurableObjectStateLike, env: HubEnv) {
    this.state = state;
    this.env = env;
    this.local = this.makeNamespace();
    // The keep-alive ping is answered by the platform without waking the object.
    try {
      state.setWebSocketAutoResponse(new (workersRuntime().WebSocketRequestResponsePair)('ping', 'pong'));
    } catch (e) {
      log('autoresponse', e);
    }
  }

  /** The environment the presence functions push through. */
  private get pushEnv(): { DB: SqlLike; HUB: DurableObjectNamespaceLike } {
    return { DB: this.env.DB, HUB: this.env.HUB ?? this.local };
  }

  /** The stand-in for the old per-player objects: `get(id).fetch('/push' | '/close')` reaches this registry's sockets. */
  namespace(): DurableObjectNamespaceLike {
    return this.local;
  }

  private makeNamespace(): DurableObjectNamespaceLike {
    return {
      idFromName: (name: string): DurableObjectIdLike => ({ name, toString: () => name }),
      get: (id: DurableObjectIdLike): Fetcher => ({
        fetch: async (input: Request | string, init?: RequestInit): Promise<Response> => {
          const req = input instanceof Request ? input : new Request(input, init);
          const pid = id.name ?? id.toString();
          switch (new URL(req.url).pathname) {
            case '/push': return this.pushRequest(pid, req);
            case '/close': return this.closeRequest(pid, req);
            default: return new Response('not found', { status: 404 });
          }
        },
      }),
    };
  }

  /** The player's open sockets. */
  open(pid: string): CfWebSocket[] {
    return this.state.getWebSockets(hubTag(pid)).filter((ws) => ws.readyState === OPEN);
  }

  /** Does this player have an open socket right now? */
  has(pid: string): boolean {
    return this.open(pid).length > 0;
  }

  /**
   * Takes the player's new socket: the older ones (another tab or device) are told and closed. The player is online from here on,
   * and the friends who are online hear it.
   */
  accept(ws: CfWebSocket, who: HubIdentity, now = Date.now()): void {
    for (const old of this.open(who.pid)) {
      try {
        old.send(JSON.stringify({ t: 'closing', reason: 'replaced' } satisfies HubEvent));
        old.close(HUB_CLOSE.REPLACED, 'replaced');
      } catch { /* already gone */ }
    }
    this.state.acceptWebSocket(ws, [hubTag(who.pid)]);
    const att: HubAtt = { i: toB64u(cryptoRandomBytes(6)), p: who.pid, f: who.fid, n: who.name, a: who.band, w: now, c: 0, tk: STATUS_BURST, tt: now, b: now };
    ws.serializeAttachment(att);
    ws.send(JSON.stringify({ t: 'hello', now } satisfies HubEvent));
    this.later('online', (async () => {
      if (await markOnline(this.env.DB, who.pid, now)) await pushPresence(this.pushEnv, who.pid, now);
    })());
  }

  /** A new WebSocket pair for the player: the server side is accepted here, the client side goes back in the 101 answer. */
  upgrade(who: HubIdentity): Response {
    const pair = new (workersRuntime().WebSocketPair)();
    this.accept(pair[1], who);
    return upgradeResponse(pair[0]);
  }

  private later(what: string, p: Promise<unknown>): void {
    this.state.waitUntil(p.catch((e: unknown) => log(what, e)));
  }

  async webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = readAtt(ws);
    if (!att) return;
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_CHARS) {
      try { ws.close(1009, 'message too big'); } catch { /* gone */ }
      return;
    }
    const now = Date.now();
    // At most PRESENCE.maxMessagesPerSec messages a second, then the socket is dropped (the page reconnects with backoff).
    if (now - att.w >= 1000) { att.w = now; att.c = 0; }
    att.c++;
    if (att.c > PRESENCE.maxMessagesPerSec) {
      try { ws.close(HUB_CLOSE.RATE, 'rate'); } catch { /* gone */ }
      return;
    }
    let cmd: HubCommand | null = null;
    try {
      const v: unknown = JSON.parse(message);
      if (typeof v === 'object' && v !== null && (v as { t?: unknown }).t === 'beat') cmd = { t: 'beat' };
      else if (typeof v === 'object' && v !== null && (v as { t?: unknown }).t === 'status') {
        const s = v as { status?: unknown; game?: unknown };
        if ((s.status === 'online' || s.status === 'playing') && (s.game === undefined || s.game === null || isGameId(s.game))) {
          cmd = s.game ? { t: 'status', status: s.status, game: s.game as string } : { t: 'status', status: s.status };
        }
      }
    } catch { cmd = null; }

    if (cmd?.t === 'beat') {
      if (now - att.b >= BEAT_MIN_GAP_MS) {
        att.b = now;
        this.later('beat', (async () => {
          if (await beat(this.env.DB, att.p, now)) await pushPresence(this.pushEnv, att.p, now);
        })());
      }
    } else if (cmd?.t === 'status') {
      att.tk = Math.min(STATUS_BURST, att.tk + (now - att.tt) / STATUS_REFILL_MS);
      att.tt = now;
      if (att.tk >= 1) {
        att.tk -= 1;
        const { status } = cmd;
        const game = cmd.game ?? null;
        this.later('status', (async () => {
          if (await setClientStatus(this.env.DB, att.p, status, status === 'playing' ? game : null, now)) await pushPresence(this.pushEnv, att.p, now);
        })());
      }
    }
    try { ws.serializeAttachment(att); } catch { /* gone */ }
  }

  webSocketClose(ws: CfWebSocket, code: number, reason: string): void {
    try { ws.close(code === 1005 || code === 1006 || code === 1015 || code < 1000 ? 1000 : code, reason); } catch { /* already closed */ }
    this.gone(ws);
  }

  webSocketError(ws: CfWebSocket): void {
    this.gone(ws);
  }

  /** A socket is gone. When it was the player's last one the player is offline: friends are told. */
  private gone(ws: CfWebSocket): void {
    const att = readAtt(ws);
    if (!att) return;
    if (this.open(att.p).some((s) => readAtt(s)?.i !== att.i)) return;
    const now = Date.now();
    this.later('offline', (async () => {
      if (await markOffline(this.env.DB, att.p, now)) await pushPresence(this.pushEnv, att.p, now);
    })());
  }

  /** Writes an event to every open socket of the player. How many got it. */
  push(pid: string, ev: HubEvent): number {
    const text = JSON.stringify(ev);
    let n = 0;
    for (const ws of this.open(pid)) {
      try { ws.send(text); n++; } catch { /* the socket just closed */ }
    }
    return n;
  }

  private async pushRequest(pid: string, req: Request): Promise<Response> {
    let ev: unknown;
    try { ev = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof ev !== 'object' || ev === null || !HUB_EVENT_TYPES.includes((ev as { t?: string }).t ?? '')) return new Response('bad event', { status: 400 });
    const n = this.push(pid, ev as HubEvent);
    return n > 0 ? Response.json({ n }) : new Response(null, { status: 204 });
  }

  /** Tells every socket of the player why it is about to close, and closes it (the profile was deleted or the player was banned). */
  closeAll(pid: string, reason: 'deleted' | 'banned'): void {
    for (const ws of this.open(pid)) {
      try {
        ws.send(JSON.stringify({ t: 'closing', reason } satisfies HubEvent));
        ws.close(reason === 'deleted' ? HUB_CLOSE.DELETED : HUB_CLOSE.BANNED, reason);
      } catch { /* gone */ }
    }
  }

  private async closeRequest(pid: string, req: Request): Promise<Response> {
    let reason: unknown;
    try { reason = ((await req.json()) as { reason?: unknown }).reason; } catch { return new Response('bad json', { status: 400 }); }
    if (reason !== 'deleted' && reason !== 'banned') return new Response('bad reason', { status: 400 });
    this.closeAll(pid, reason);
    return new Response(null, { status: 204 });
  }
}

/**
 * Accepts a WebSocket upgrade and closes it at once with `code` and `reason`, so the page sees a close code it can act on
 * (a bare HTTP error on an upgrade looks like a network failure to a browser).
 */
export function closedSocket(code: number, reason: string): Response {
  const pair = new (workersRuntime().WebSocketPair)();
  const server = pair[1];
  server.accept?.();
  server.close(code, reason);
  return upgradeResponse(pair[0]);
}

/**
 * The per-player hub of the first design. The sockets and the presence now live in the SocialDirectory, and nothing calls this
 * class: it stays exported because the preview Worker created it (migration v2), and a Worker cannot drop a class its migrations
 * made without a migration that deletes it. It holds nothing and answers 410.
 */
export class PlayerHub {
  fetch(): Response {
    return new Response('gone', { status: 410 });
  }
}
