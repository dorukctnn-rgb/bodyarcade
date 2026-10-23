// Shared plumbing of the social routes: JSON answers with the server time, the body reader, the in-memory guards and the
// `authed` wrapper that turns a handler working on a verified player into a router handler.
import { cryptoRandomBytes, toB64u } from '../../../core/social/codes.ts';
import type { ExecutionContextLike } from '../cf.ts';
import { HttpError, clientIp, isRecord, json, publicOrigin, readJson } from '../http.ts';
import type { Handler, Params } from '../router.ts';
import type { D1Like } from './db.ts';
import { authenticate, type Me } from './auth.ts';
import { socialEnv, type SocialEnv } from './env.ts';

export const MAX_BODY_BYTES = 4096;

/** A success answer: the data plus the server time (the client keeps an offset to sign with). */
export function ok(data: Record<string, unknown> = {}, status = 200, now = Date.now()): Response {
  return json({ ...data, serverTime: now }, status);
}

/** The JSON object of a POST (at most 4 KB; an empty object when the client has nothing to say). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const b = await readJson(req, MAX_BODY_BYTES);
  if (!isRecord(b)) throw new HttpError(400, 'bad_request');
  return b;
}

export const randomId = (bytes = 9): string => toB64u(cryptoRandomBytes(bytes));

// ───────── in-memory guards (per isolate; the second line behind the D1 counters and Cloudflare's own rules) ─────────

interface Bucket { start: number; n: number }
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** True when this call is within `max` per `windowMs` for `key`; counts the call. */
export function memAllow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of buckets) if (now - b.start > 3_600_000) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { buckets.set(key, { start: now, n: 1 }); return true; }
  if (b.n >= max) return false;
  b.n++;
  return true;
}

/** Tests only. */
export function resetMemLimits(): void {
  buckets.clear();
}

/** Per-address and per-player request guards of every authenticated route. */
export function guardRequest(env: SocialEnv, req: Request, scope: string | null, now: number): void {
  if (env.SOCIAL_NO_LIMITS === '1') return;
  const ip = clientIp(req);
  if (ip && !memAllow(`ip:${ip}`, 600, 60_000, now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 60_000 });
  if (scope && !memAllow(`pid:${scope}`, 240, 60_000, now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 60_000 });
}

const enc = new TextEncoder();
const hmacKeys = new Map<string, Promise<CryptoKey>>();

/** A keyed hash of the caller's address: the only form in which an address is ever stored (counter keys). */
export async function addressHash(env: SocialEnv, req: Request): Promise<string> {
  const ip = clientIp(req) || 'local';
  const secret = typeof env.TICKET_SECRET === 'string' && env.TICKET_SECRET.length >= 16 ? env.TICKET_SECRET : 'ba-social-address-salt';
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key, enc.encode(`ip:${ip}`)));
  return toB64u(sig.slice(0, 12));
}

// ───────── handlers ─────────

export interface Ctx {
  req: Request;
  /** The Worker env narrowed to the social bindings. */
  env: SocialEnv;
  /** The full env object, for the other modules' bindings. */
  raw: Record<string, unknown>;
  db: D1Like;
  now: number;
  url: URL;
  params: Params;
  /** The parsed JSON body of a POST; undefined for a GET. */
  body: Record<string, unknown>;
  /** The verified player. */
  me: Me;
  /** Origin for the links the server hands out. */
  origin: string;
  /** Runs `p` after the answer is sent (pushes to friends); errors are logged, never thrown. */
  wait(p: Promise<unknown>): void;
}

export type SocialHandler = (c: Ctx) => Promise<Record<string, unknown> | Response> | Record<string, unknown> | Response;

export interface AuthedOptions {
  /** Banned players may still call this route (their own profile, the data export and the deletion). */
  allowBanned?: boolean;
}

function waiter(ctx: ExecutionContextLike): (p: Promise<unknown>) => void {
  return (p) => {
    const safe = p.catch((e: unknown) => console.log(JSON.stringify({ evt: 'social_wait_error', error: String((e as { message?: unknown })?.message ?? e) })));
    try { ctx.waitUntil(safe); } catch { /* no execution context (tests without one): the promise still runs */ }
  };
}

/** Wraps a handler: reads the body, verifies the signed request, calls the handler, adds the server time to the answer. */
export function authed(handler: SocialHandler, opts: AuthedOptions = {}): Handler {
  return async (req, raw, ctx, params) => {
    const env = socialEnv(raw);
    const now = Date.now();
    try {
      guardRequest(env, req, null, now);
      const url = new URL(req.url);
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      const wait = waiter(ctx);
      const me = await authenticate({ req, db: env.DB, now, wait }, body, opts);
      guardRequest(env, req, me.pid, now);
      const out = await handler({ req, env, raw, db: env.DB, now, url, params, body: body ?? {}, me, origin: publicOrigin(req, env.PUBLIC_ORIGIN), wait });
      return out instanceof Response ? out : ok(out, 200, now);
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.status, e.code, { serverTime: Date.now(), ...e.extra });
      throw e;
    }
  };
}

/** A route that needs no signature but still answers with the server time on errors. */
export function open(handler: (c: Omit<Ctx, 'me'>) => Promise<Record<string, unknown> | Response> | Record<string, unknown> | Response, opts: { bodyless?: boolean } = {}): Handler {
  return async (req, raw, ctx, params) => {
    const env = socialEnv(raw);
    const now = Date.now();
    try {
      guardRequest(env, req, null, now);
      const body = opts.bodyless || req.method === 'GET' ? undefined : await readBody(req);
      const out = await handler({ req, env, raw, db: env.DB, now, url: new URL(req.url), params, body: body ?? {}, origin: publicOrigin(req, env.PUBLIC_ORIGIN), wait: waiter(ctx) });
      return out instanceof Response ? out : ok(out, 200, now);
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.status, e.code, { serverTime: Date.now(), ...e.extra });
      throw e;
    }
  };
}
