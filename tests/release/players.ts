// Signed players for the release checks. A player of the deployed Worker is a social profile: a device key (ECDSA P-256) that signs
// every room call (core/social/sign.ts: header X-BA-Auth), and the Worker takes the name, the age band and the mute from the stored
// profile, never from the request. A call with no signature is a guest, which only a build that still has the preview bridge
// (SOCIAL_ALLOW_UNSIGNED) lets in; bodyarcade.com never does, and the bridge goes when the shell signs its own room calls
// (final test rows 3, 13, 27). So the live races and the room made by urls.spec sign their calls here, the way the shell does:
//   - the same signing function the page's client uses (SocialClient.fetcher calls signRequest on the parsed JSON body);
//   - the key lives in Node, made extractable on purpose, so a profile is signed up ONCE and the key is kept under
//     tests/release/out/identities/<host>/ for the next run: a deployed Worker lets one address make 20 profiles an hour and 60 a day
//     (core/social/rules.ts LIMITS.registerHour), and a run needs five; registering the same key again returns the same profile;
//   - the browsers of a race do not hold a key: the context signs their room calls on the way out (signRoomCalls), so the page code under
//     test (the duel page, LiveRace) is the one the live suite runs, unchanged.
// A deployed build from before the social module has no profiles: there the players are guests as the old checks were
// (chooseMode), and the evidence says so.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { toB64u } from '../../packages/core/social/codes.ts';
import { AUTH_HEADER, keyId, signRequest } from '../../packages/core/social/sign.ts';

export type SigningMode = 'signed' | 'guest';
export interface ModeVerdict { mode: SigningMode; why: string }

/**
 * Signed or guest. `want` is BA_RELEASE_SIGNING. In auto, production is always signed (it takes no guests, and a missing social module
 * there must fail the run, not be hidden by a fallback), and any other deployment is probed: an unsigned GET /api/social/me is refused with
 * 401 by a Worker that has the module (the edge answers it without waking the directory), and answers 404 or 5xx on one that has not.
 */
export async function chooseMode(base: string, o: { want?: string; production?: boolean; fetch?: typeof fetch } = {}): Promise<ModeVerdict> {
  if (o.want === 'signed') return { mode: 'signed', why: 'BA_RELEASE_SIGNING=signed' };
  if (o.want === 'guest') return { mode: 'guest', why: 'BA_RELEASE_SIGNING=guest' };
  if (o.production) return { mode: 'signed', why: 'bodyarcade.com takes no guests' };
  const res = await (o.fetch ?? fetch)(`${base}/api/social/me`, { cache: 'no-store' });
  if (res.status === 401) return { mode: 'signed', why: 'the deployed build has the social module (an unsigned call is refused with 401)' };
  return { mode: 'guest', why: `the deployed build has no social module (an unsigned GET /api/social/me answered ${res.status}), so its rooms take guests: redeploy the preview before the final test` };
}

/** What the page's room calls and the checks' own room calls need of a player. */
export interface RacePlayer {
  readonly mode: SigningMode;
  /** The name the profile has (signed) or the guest says. */
  readonly label: string;
  /** The device id the page sends as its own: the key id when signed (what SocialClient.roomIdentity() sends), a random one for a guest. The Worker ignores it when the call is signed. */
  readonly pid: string;
  /** The identity fields of a room call's body. */
  identity(): { pid: string; name: string; age: 'adult' };
  /** The X-BA-Auth value for one request (`body` is the parsed JSON that will be sent), or null for a guest. */
  authFor(method: string, url: string, body?: unknown): Promise<string | null>;
  /** POST of a JSON body, signed when the player is. A wrong device clock is corrected once (the answer carries the server's time). */
  post(url: string, body: Record<string, unknown>): Promise<Response>;
  /** Removes the profile from the server and the saved key from this machine (a guest has nothing to remove). */
  retire(): Promise<void>;
}

/** The server's time as far as this machine knows it. */
class Clock {
  private offset = 0;
  private readonly local: () => number;
  constructor(local: () => number) { this.local = local; }
  now(): number { return this.local() + this.offset; }
  set(serverTime: number): void { this.offset = serverTime - this.local(); }
  /** The HTTP date of an answer is good to a second: far inside the five minutes a signature allows. */
  learn(res: Response): void {
    const d = Date.parse(res.headers.get('date') ?? '');
    if (Number.isFinite(d)) this.set(d);
  }
}

interface SavedIdentity { v: 1; origin: string; label: string; pub: string; kid: string; jwk: JsonWebKey }

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

class Guest implements RacePlayer {
  readonly mode = 'guest' as const;
  readonly label: string;
  readonly pid: string;
  constructor(label: string, index: number) {
    this.label = label;
    this.pid = `${slug(label)}-${Date.now().toString(36)}-${index}`;
  }
  identity() { return { pid: this.pid, name: this.label, age: 'adult' as const }; }
  async authFor(): Promise<null> { return null; }
  async post(url: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  }
  async retire(): Promise<void> { /* a guest has no profile */ }
}

export class SignedPlayer implements RacePlayer {
  readonly mode = 'signed' as const;
  readonly label: string;
  /** The raw public key (65 bytes, base64url): what the sign-up sends. */
  readonly pub: string;
  readonly kid: string;
  private readonly key: CryptoKey;
  private readonly base: string;
  private readonly clock: Clock;
  private readonly fetchFn: typeof fetch;
  private readonly file: string | null;

  private constructor(base: string, label: string, ident: { pub: string; kid: string; key: CryptoKey }, env: { clock: Clock; fetch: typeof fetch; file: string | null }) {
    this.base = base;
    this.label = label;
    this.pub = ident.pub;
    this.kid = ident.kid;
    this.key = ident.key;
    this.clock = env.clock;
    this.fetchFn = env.fetch;
    this.file = env.file;
  }

  get pid(): string { return this.kid; }
  identity() { return { pid: this.kid, name: this.label, age: 'adult' as const }; }

  /** The saved key of this label, or a new one (kept when `dir` is given), signed up on the server. Signing up again with a known key returns the same profile and costs the address nothing. */
  static async open(base: string, label: string, o: { dir: string | null; clock: Clock; fetch: typeof fetch }): Promise<SignedPlayer> {
    const file = o.dir ? join(o.dir, `${slug(label)}.json`) : null;
    let saved: SavedIdentity | null = null;
    if (file && existsSync(file)) {
      try { saved = JSON.parse(readFileSync(file, 'utf8')) as SavedIdentity; } catch { saved = null; }
      if (saved && (saved.v !== 1 || saved.origin !== base || typeof saved.pub !== 'string' || typeof saved.kid !== 'string' || !saved.jwk)) saved = null;
    }
    let ident: { pub: string; kid: string; key: CryptoKey };
    if (saved) {
      ident = { pub: saved.pub, kid: saved.kid, key: await crypto.subtle.importKey('jwk', saved.jwk, ECDSA, false, ['sign']) };
    } else {
      const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
      const pub = toB64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
      ident = { pub, kid: await keyId(pub), key: pair.privateKey };
      if (file) {
        mkdirSync(o.dir as string, { recursive: true });
        const record: SavedIdentity = { v: 1, origin: base, label, pub, kid: ident.kid, jwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
        writeFileSync(file, JSON.stringify(record, null, 1));
      }
    }
    const p = new SignedPlayer(base, label, ident, { clock: o.clock, fetch: o.fetch, file });
    await p.signUp();
    return p;
  }

  async authFor(method: string, url: string, body?: unknown): Promise<string> {
    return signRequest({ privateKey: this.key, kid: this.kid }, { method, url, body }, this.clock.now());
  }

  private async signUp(): Promise<void> {
    const res = await this.post(`${this.base}/api/social/register`, { pub: this.pub, band: 'adult', name: this.label });
    if (res.ok) return;
    const data = (await res.json().catch(() => null)) as { error?: unknown; reason?: unknown } | null;
    const hint = res.status === 429 || data?.error === 'rate_limited' || data?.error === 'too_many_attempts'
      ? ' (a deployed Worker lets one address sign up 20 profiles an hour and 60 a day; the keys are kept under tests/release/out/identities so the next run needs none)' : '';
    throw new Error(`signing up ${this.label} on ${this.base} answered ${res.status} ${String(data?.error ?? '')}${data?.reason ? ` (${String(data.reason)})` : ''}${hint}`);
  }

  async post(url: string, body: Record<string, unknown>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const auth = await this.authFor('POST', url, body);
      const res = await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: auth }, body: JSON.stringify(body), cache: 'no-store' });
      this.clock.learn(res);
      if (res.status === 401 && attempt === 0) {
        const peek = (await res.clone().json().catch(() => null)) as { error?: unknown; serverTime?: unknown } | null;
        if (peek?.error === 'clock_skew' && typeof peek.serverTime === 'number') { this.clock.set(peek.serverTime); continue; }
      }
      return res;
    }
  }

  async retire(): Promise<void> {
    const res = await this.post(`${this.base}/api/social/me/delete`, { confirm: 'delete' });
    // 401 unknown_device: the server no longer has the profile, which is what deleting wanted
    if (!res.ok && res.status !== 401) throw new Error(`deleting the profile of ${this.label} on ${this.base} answered ${res.status}`);
    if (this.file) rmSync(this.file, { force: true });
  }
}

/** The players of a run, in the order of `labels`. `dir` keeps the keys between runs; null keeps them in this process only. */
export async function openPlayers(base: string, labels: string[], o: { mode: SigningMode; dir?: string | null; fetch?: typeof fetch; now?: () => number }): Promise<RacePlayer[]> {
  if (o.mode === 'guest') return labels.map((l, i) => new Guest(l, i));
  const clock = new Clock(o.now ?? (() => Date.now()));
  const out: RacePlayer[] = [];
  // one after the other: the first answer teaches the clock before the others sign
  for (const label of labels) out.push(await SignedPlayer.open(base, label, { dir: o.dir ?? null, clock, fetch: o.fetch ?? fetch }));
  return out;
}

/**
 * A fetch that signs each call as the player, for code that takes a `fetcher` (core/net createRoom, joinRoom and a LiveClient's ticket
 * refresh: what the shell gives them as SocialClient.fetcher). The body is signed as the parsed JSON it carries, the way signRoomCalls and
 * the shell do. A guest's fetcher is the plain one.
 */
export function signedFetcher(player: RacePlayer, fetchFn: typeof fetch = fetch): typeof fetch {
  if (player.mode === 'guest') return fetchFn;
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    let body: unknown;
    if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    const auth = await player.authFor(method, url, body);
    if (auth) headers.set(AUTH_HEADER, auth);
    return fetchFn(input, { ...init, headers });
  };
}

/** Where the keys of a deployed origin's test profiles are kept between runs (under the evidence folder, never committed); null for a local stack, whose profiles die with it. */
export function identitiesDir(base: string, out: string): string | null {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) return null;
  return join(out, 'identities', base.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9.-]+/g, '-'));
}

/** The room calls of a page: creating a room and taking a seat (joining again for a fresh ticket included). */
const ROOM_CALL = /^\/api\/rooms(\/[A-Za-z0-9]{1,16}\/join)?$/;

/**
 * Signs the room calls a page of this context makes, as the player: the request leaves the browser with the X-BA-Auth header the
 * shell's SocialClient.fetcher would have put there. Calls of a guest and everything that is not a room call pass untouched.
 */
export async function signRoomCalls(context: Pick<BrowserContext, 'route'>, base: string, player: RacePlayer): Promise<void> {
  if (player.mode === 'guest') return;
  const origin = new URL(base).origin;
  await context.route((url) => url.origin === origin && ROOM_CALL.test(url.pathname), async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    let body: unknown;
    const raw = req.postData();
    if (raw) {
      try { body = JSON.parse(raw); } catch { return route.fallback(); }
    }
    const auth = await player.authFor('POST', req.url(), body);
    if (!auth) return route.fallback();
    return route.continue({ headers: { ...req.headers(), [AUTH_HEADER.toLowerCase()]: auth } });
  });
}
