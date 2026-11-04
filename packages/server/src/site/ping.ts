// The game signal: one small, unsigned POST that says "a round started" or "a round finished" for one game. Nothing else.
//
//   POST /api/ping   body {"e":"game_start"|"run_finished","g":"<game id>"}   204; 400 for any other body; 429 over the limit
//
// What is kept: the event, the game id and the moment (the platform stamps it). No cookie, no profile, no network address, no
// user agent, no country: the handler never reads them except for the one thing below. A counter in the Worker's memory (a
// scrambled form of the address, not written anywhere, gone with the isolate) holds each sender to a few signals a minute.
//
// Where it goes: Workers Analytics Engine (free plan: 100,000 data points a day), one dataset per event, so Cloudflare's own
// totals (GraphQL, per dataset) work with a read-only analytics token and the SQL API gives the per-game numbers:
//   PING_START  = dataset bodyarcade_game_start      PING_FINISH = dataset bodyarcade_run_finished   (the preview has _preview names)
// and one log line per signal ({"evt":"ping","e":...,"g":...}) for the Workers Logs query builder. Without a binding (a local
// run, a test) only the log line is written. tools/signals/read.mjs reads the numbers back.
import type { Router } from '../router.ts';
import { HttpError, clientIp, isRecord, readJson } from '../http.ts';

export const PING_EVENTS = ['game_start', 'run_finished'] as const;
export type PingEvent = (typeof PING_EVENTS)[number];

/** The binding of each event's dataset (wrangler.jsonc and wrangler.prod.jsonc: analytics_engine_datasets). */
export const PING_BINDINGS: Readonly<Record<PingEvent, string>> = { game_start: 'PING_START', run_finished: 'PING_FINISH' };

/** The body of a signal is two short strings: 256 bytes is plenty and cheap to refuse beyond. */
const MAX_BODY = 256;
/** A game id is the folder name of a game: lowercase words joined by hyphens ("road-run", "knee-sprint"). */
const GAME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GAME_ID_MAX = 40;

/** At most this many signals per sender and minute in one isolate (a real round sends two). */
export const PINGS_PER_MINUTE = 30;
/** The counter forgets everyone when it holds this many senders, so a flood of addresses cannot grow it. */
const MAX_SENDERS = 5000;

/** The part of an Analytics Engine dataset binding this module uses. */
export interface DatasetLike {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface Limiter {
  /** True when this sender may send now (and counts the signal). */
  allow(sender: string, now: number): boolean;
}

/** A 32-bit hash of the sender with a salt that only this isolate knows: what the counter keeps is never the address. */
function scramble(salt: number, s: string): number {
  let h = (salt ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function createLimiter(perMinute = PINGS_PER_MINUTE, salt = (crypto.getRandomValues(new Uint32Array(1))[0] as number)): Limiter {
  let windowStart = 0;
  let counts = new Map<number, number>();
  return {
    allow(sender, now) {
      if (now - windowStart >= 60_000) { windowStart = now; counts = new Map(); }
      const key = scramble(salt, sender);
      const n = counts.get(key) ?? 0;
      if (n >= perMinute) return false;
      if (n === 0 && counts.size >= MAX_SENDERS) counts = new Map();
      counts.set(key, n + 1);
      return true;
    },
  };
}

export interface Signal { e: PingEvent; g: string }

/** The signal in a parsed body, or null: exactly the two keys, a known event and a well-formed game id. */
export function parseSignal(body: unknown): Signal | null {
  if (!isRecord(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('e') || !keys.includes('g')) return null;
  const e = body['e'];
  const g = body['g'];
  if (typeof e !== 'string' || !(PING_EVENTS as readonly string[]).includes(e)) return null;
  if (typeof g !== 'string' || g.length === 0 || g.length > GAME_ID_MAX || !GAME_ID.test(g)) return null;
  return { e: e as PingEvent, g };
}

/** A browser's own page sends the Origin of the site; a page of another site must not count games on ours. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  return origin === null || origin === new URL(req.url).origin;
}

// made on the first request, not when the module loads: the platform refuses random numbers in the global scope (the salt is one)
let shared: Limiter | null = null;

export async function ping(req: Request, env: Record<string, unknown>, limiter: Limiter = (shared ??= createLimiter()), now = Date.now()): Promise<Response> {
  if (!sameOrigin(req)) throw new HttpError(403, 'forbidden');
  // every POST counts against the sender, a malformed one too: the limit is checked before the body is read
  if (!limiter.allow(clientIp(req), now)) throw new HttpError(429, 'slow_down');
  const signal = parseSignal(await readJson(req, MAX_BODY));
  if (!signal) throw new HttpError(400, 'bad_signal');
  const dataset = env[PING_BINDINGS[signal.e]] as DatasetLike | undefined;
  try {
    dataset?.writeDataPoint({ blobs: [signal.g], doubles: [1], indexes: [signal.g] });
  } catch (e) {
    // a counter that cannot write is no reason to answer the player's page with an error
    console.error(JSON.stringify({ evt: 'ping_error', error: String(e) }));
  }
  console.log(JSON.stringify({ evt: 'ping', e: signal.e, g: signal.g }));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function registerPing(router: Router): void {
  router.add('POST', '/api/ping', (req, env) => ping(req, env));
}
