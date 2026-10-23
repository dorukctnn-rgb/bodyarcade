// PlayerHub: one Durable Object per player that holds the player's live socket (presence and pushes).
//
//   - Hibernating WebSocket: while the player is idle the object sleeps and costs nothing. The page sends the text 'ping'
//     every 45 seconds and the platform answers 'pong' without waking the object. A real message (a 'beat' every four
//     minutes, a status change) wakes it for a few milliseconds.
//   - No Durable Object storage: presence lives in D1 (soc_presence) so friends can be listed with one query. What the hub
//     keeps per socket is a small attachment (who it is, its rate counters).
//   - Pushes come from other players' requests (a friend request, an invitation, a friend's status): the Worker calls the
//     hub's /push, the hub writes the event to every open socket of the player.
//
// Internal routes (reachable only from the Worker through the HUB binding):
//   GET  /ws     + X-Hub-* headers   WebSocket upgrade (the Worker verified the signed request)
//   POST /push   {HubEvent}          200 {n} when n sockets got it, 204 when none is open
//   POST /close  {reason}            tell and close every socket ('deleted' or 'banned')
import { isGameId, PRESENCE } from '../../../core/social/rules.ts';
import { HUB_CLOSE, type HubCommand, type HubEvent } from '../../../core/social/types.ts';
import { isAgeBand } from '../../../core/social/age.ts';
import { cryptoRandomBytes, toB64u } from '../../../core/social/codes.ts';
import type { AgeBand } from '../../../core/social/types.ts';
import type { CfWebSocket, DurableObjectStateLike } from '../cf.ts';
import { upgradeResponse, workersRuntime } from '../cf.ts';
import type { SocialEnv } from './env.ts';
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
  /** Friend-visible id and name, used in the events pushed to friends. */
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

export const HUB_HEADERS = { pid: 'X-Hub-Pid', fid: 'X-Hub-Fid', name: 'X-Hub-Name', band: 'X-Hub-Band' } as const;

const HUB_EVENT_TYPES: readonly string[] = ['hello', 'presence', 'friend_request', 'friend_added', 'friend_removed', 'request_cancelled', 'invite', 'invite_declined', 'closing'];

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

export class PlayerHub {
  protected readonly state: DurableObjectStateLike;
  protected readonly env: SocialEnv;

  constructor(state: DurableObjectStateLike, env: SocialEnv) {
    this.state = state;
    this.env = env;
    // The keep-alive ping is answered by the platform without waking the object.
    try {
      state.setWebSocketAutoResponse(new (workersRuntime().WebSocketRequestResponsePair)('ping', 'pong'));
    } catch (e) {
      log('autoresponse', e);
    }
  }

  protected open(): CfWebSocket[] {
    return this.state.getWebSockets().filter((ws) => ws.readyState === OPEN);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/ws': return this.upgrade(req);
      case '/push': return this.push(req);
      case '/close': return this.closeAll(req);
      default: return new Response('not found', { status: 404 });
    }
  }

  private upgrade(req: Request): Response {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pid = req.headers.get(HUB_HEADERS.pid);
    const fid = req.headers.get(HUB_HEADERS.fid);
    const rawName = req.headers.get(HUB_HEADERS.name);
    const band = req.headers.get(HUB_HEADERS.band);
    if (!pid || !fid || rawName === null || !isAgeBand(band)) return new Response('bad identity', { status: 400 });
    let name: string;
    try { name = decodeURIComponent(rawName); } catch { return new Response('bad identity', { status: 400 }); }
    const pair = new (workersRuntime().WebSocketPair)();
    const client = pair[0];
    const server = pair[1];
    this.accept(server, { pid, fid, name, band });
    return upgradeResponse(client);
  }

  /** Takes the player's new socket: the older one (another tab or device) is told and closed. */
  accept(ws: CfWebSocket, who: HubIdentity, now = Date.now()): void {
    for (const old of this.open()) {
      try {
        old.send(JSON.stringify({ t: 'closing', reason: 'replaced' } satisfies HubEvent));
        old.close(HUB_CLOSE.REPLACED, 'replaced');
      } catch { /* already gone */ }
    }
    this.state.acceptWebSocket(ws);
    const att: HubAtt = { i: toB64u(cryptoRandomBytes(6)), p: who.pid, f: who.fid, n: who.name, a: who.band, w: now, c: 0, tk: STATUS_BURST, tt: now, b: now };
    ws.serializeAttachment(att);
    ws.send(JSON.stringify({ t: 'hello', now } satisfies HubEvent));
    this.later('online', (async () => {
      if (await markOnline(this.env.DB, who.pid, now)) await pushPresence(this.env, who.pid, now);
    })());
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
          if (await beat(this.env.DB, att.p, now)) await pushPresence(this.env, att.p, now);
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
          if (await setClientStatus(this.env.DB, att.p, status, status === 'playing' ? game : null, now)) await pushPresence(this.env, att.p, now);
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
    if (this.open().some((s) => readAtt(s)?.i !== att.i)) return;
    const now = Date.now();
    this.later('offline', (async () => {
      if (await markOffline(this.env.DB, att.p, now)) await pushPresence(this.env, att.p, now);
    })());
  }

  private async push(req: Request): Promise<Response> {
    let ev: unknown;
    try { ev = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof ev !== 'object' || ev === null || !HUB_EVENT_TYPES.includes((ev as { t?: string }).t ?? '')) return new Response('bad event', { status: 400 });
    const text = JSON.stringify(ev);
    let n = 0;
    for (const ws of this.open()) {
      try { ws.send(text); n++; } catch { /* the socket just closed */ }
    }
    return n > 0 ? Response.json({ n }) : new Response(null, { status: 204 });
  }

  private async closeAll(req: Request): Promise<Response> {
    let reason: unknown;
    try { reason = ((await req.json()) as { reason?: unknown }).reason; } catch { return new Response('bad json', { status: 400 }); }
    if (reason !== 'deleted' && reason !== 'banned') return new Response('bad reason', { status: 400 });
    for (const ws of this.open()) {
      try {
        ws.send(JSON.stringify({ t: 'closing', reason } satisfies HubEvent));
        ws.close(reason === 'deleted' ? HUB_CLOSE.DELETED : HUB_CLOSE.BANNED, reason);
      } catch { /* gone */ }
    }
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
