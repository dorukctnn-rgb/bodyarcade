// The game signal: one small, unsigned POST that says what just happened on the site, in a word, with the game, page or plan
// it happened to and, for some events, one more word from a fixed list. Nothing else.
//
//   POST /api/ping   body {"e":"<event>","g":"<key>"} or {"e":"<event>","g":"<key>","x":"<detail>"}   204; 400 for any other body; 429 over the limit
//
// The events, in the order a new player meets them (the funnel):
//   visit           a page of the site was opened          g = the page (home, game, webcam-fitness-games, tr-home ...)   x = the kind of site that sent the visitor (pro-source.js)
//   play_open       the play screen of a game opened       g = the game    x = first | again (has this device finished a round before)
//   tracking_ready  the camera and the body tracking run   g = the game    x = first | again
//   game_start      the round really started               g = the game    x = first | again (optional: older pages send none)
//   run_finished    the round finished                     g = the game    x = first | again (optional)
//   play_left       the play screen was left unfinished    g = the game    x = where: explainer | loading | calibrating | countdown | running | paused | error | keyboard (chose keyboard or touch)
//   play_error      a round could not start                g = the game    x = the error code (denied, not_found, pose_load ...)
//   paywall_view    the Pro screen was shown               g = what sent the player: results | locked | direct
//   buy_click       a buy button was pressed               g = the plan    x = paddle | gumroad | play | none (what the button does here)
//   checkout_open   the checkout opened                    g = the plan    x = paddle | gumroad
//   checkout_done   the checkout said the purchase is paid g = the plan    x = paddle
//
// What is kept: the event, the key, the detail and the moment (the platform stamps it). No cookie, no profile, no network address,
// no user agent, no country, no timing: the handler never reads them except for the one thing below. A counter in the Worker's
// memory (a scrambled form of the address, not written anywhere, gone with the isolate) holds each sender to a few signals a minute.
//
// Where it goes: Workers Analytics Engine (free plan: 100,000 data points a day). The two round events keep their own datasets
// (since 4 Nov 2026), so Cloudflare's totals per dataset (GraphQL) still work with a read-only analytics token:
//   PING_START  = dataset bodyarcade_game_start      PING_FINISH = dataset bodyarcade_run_finished
// every other event goes to one dataset, blobs [event, key, detail] with the event as the index, read with the SQL API:
//   PING_FUNNEL = dataset bodyarcade_funnel          (the preview and dev Workers have _preview and _dev names)
// and one log line per signal ({"evt":"ping","e":...,"g":...}) for the Workers Logs query builder. Without a binding (a local
// run, a test) only the log line is written. tools/signals/read.mjs reads the numbers back (--funnel for the whole path).
import type { Router } from '../router.ts';
import { HttpError, clientIp, isRecord, readJson } from '../http.ts';

/** The two events of a round, each in its own dataset (the first signal, 4 Nov 2026). */
export const ROUND_EVENTS = ['game_start', 'run_finished'] as const;
/** The other steps of the path from a visit to a purchase, all in the funnel dataset. */
export const FUNNEL_EVENTS = ['visit', 'play_open', 'tracking_ready', 'play_left', 'play_error', 'paywall_view', 'buy_click', 'checkout_open', 'checkout_done'] as const;
export const PING_EVENTS = [...ROUND_EVENTS, ...FUNNEL_EVENTS] as const;
export type RoundEvent = (typeof ROUND_EVENTS)[number];
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
export type PingEvent = RoundEvent | FunnelEvent;

/** The binding of each round event's dataset (wrangler.jsonc and wrangler.prod.jsonc: analytics_engine_datasets). */
export const PING_BINDINGS: Readonly<Record<RoundEvent, string>> = { game_start: 'PING_START', run_finished: 'PING_FINISH' };
/** The binding of the dataset every other event goes to. */
export const FUNNEL_BINDING = 'PING_FUNNEL';
/** Every binding the signal writes to: what each Worker config binds. */
export const ALL_BINDINGS: readonly string[] = [...Object.values(PING_BINDINGS), FUNNEL_BINDING];

const FIRST = ['first', 'again'] as const;
/** The kinds of site pro-source.js sorts a visitor's source into, the Android app (whose pages keep no source), and internal: a page opened from another page of the site. */
export const SOURCE_WORDS = ['google', 'bing', 'other-search', 'ai-assistant', 'pinterest', 'social', 'referral', 'direct', 'app', 'internal'] as const;
/** Where a player can leave the play screen (packages/web/src/app/play.ts leftAt). */
export const LEFT_AT = ['explainer', 'loading', 'calibrating', 'countdown', 'running', 'paused', 'error', 'keyboard'] as const;
const CODE = 'code';
/**
 * The detail each event may carry: a fixed list, CODE (an error code: lowercase words joined by underscores), or null (none: a
 * body with a detail is refused). A detail is always optional.
 */
export const DETAILS: Readonly<Record<PingEvent, readonly string[] | typeof CODE | null>> = {
  game_start: FIRST, run_finished: FIRST, play_open: FIRST, tracking_ready: FIRST,
  visit: SOURCE_WORDS, play_left: LEFT_AT, play_error: CODE, paywall_view: null,
  buy_click: ['paddle', 'gumroad', 'play', 'none'], checkout_open: ['paddle', 'gumroad'], checkout_done: ['paddle'],
};
const ERROR_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const DETAIL_MAX = 24;

/** The body of a signal is two short strings: 256 bytes is plenty and cheap to refuse beyond. */
const MAX_BODY = 256;
/** A key is written like the folder name of a game: lowercase words joined by hyphens ("road-run", "pro-yearly", "tr-home"). */
const GAME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GAME_ID_MAX = 40;

/** At most this many signals per sender and minute in one isolate (a real round sends four or five, a visit one). */
export const PINGS_PER_MINUTE = 40;
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

export interface Signal { e: PingEvent; g: string; x?: string }

/** Is this a detail the event may carry? */
function detailFits(e: PingEvent, x: unknown): x is string {
  const rule = DETAILS[e];
  if (typeof x !== 'string' || x.length === 0 || x.length > DETAIL_MAX || rule === null) return false;
  return rule === CODE ? ERROR_CODE.test(x) : rule.includes(x);
}

/** The signal in a parsed body, or null: the keys e and g (and x where the event takes one), a known event, a well-formed key and detail. */
export function parseSignal(body: unknown): Signal | null {
  if (!isRecord(body)) return null;
  const keys = Object.keys(body);
  const withDetail = keys.length === 3 && keys.includes('x');
  if ((keys.length !== 2 && !withDetail) || !keys.includes('e') || !keys.includes('g')) return null;
  const e = body['e'];
  const g = body['g'];
  if (typeof e !== 'string' || !(PING_EVENTS as readonly string[]).includes(e)) return null;
  if (typeof g !== 'string' || g.length === 0 || g.length > GAME_ID_MAX || !GAME_ID.test(g)) return null;
  if (!withDetail) return { e: e as PingEvent, g };
  const x = body['x'];
  return detailFits(e as PingEvent, x) ? { e: e as PingEvent, g, x } : null;
}

/** Where a signal is written: a round event in its own dataset (the game, then the detail), any other in the funnel dataset. */
export function pointOf(s: Signal): { binding: string; point: { blobs: string[]; doubles: number[]; indexes: string[] } } {
  if ((ROUND_EVENTS as readonly string[]).includes(s.e)) {
    return { binding: PING_BINDINGS[s.e as RoundEvent], point: { blobs: s.x ? [s.g, s.x] : [s.g], doubles: [1], indexes: [s.g] } };
  }
  return { binding: FUNNEL_BINDING, point: { blobs: [s.e, s.g, s.x ?? ''], doubles: [1], indexes: [s.e] } };
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
  const { binding, point } = pointOf(signal);
  const dataset = env[binding] as DatasetLike | undefined;
  try {
    dataset?.writeDataPoint(point);
  } catch (e) {
    // a counter that cannot write is no reason to answer the player's page with an error
    console.error(JSON.stringify({ evt: 'ping_error', error: String(e) }));
  }
  console.log(JSON.stringify({ evt: 'ping', e: signal.e, g: signal.g, ...(signal.x ? { x: signal.x } : {}) }));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function registerPing(router: Router): void {
  router.add('POST', '/api/ping', (req, env) => ping(req, env));
}
