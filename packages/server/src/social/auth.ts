// Who is calling: verifies the device signature (core/social/sign.ts) and loads the profile it belongs to.
//
//   - the device (kid) and its profile come from one indexed join, so a banned or deleted profile stops working at once;
//   - the public key import is cached per isolate (the key text is the cache key, so a changed row can never reuse a key);
//   - a nonce is accepted once per isolate for ten minutes (a replay across isolates is still bounded by the 5-minute
//     clock window and by the fact that every route is idempotent or counted);
//   - the profile row's `seen_day` is written at most once a day (retention sweep of unused profiles).
import type { AgeBand, Region } from '../../../core/social/types.ts';
import { DAY } from '../../../core/social/rules.ts';
import { AUTH_HEADER, AUTH_QUERY, importPublicKey, keyId, parseAuth, verifyRequest } from '../../../core/social/sign.ts';
import { HttpError } from '../http.ts';
import { one, run, type SqlLike } from './db.ts';

export interface Me {
  pid: string;
  fid: string;
  code: string;
  name: string;
  band: AgeBand;
  level: number;
  region: Region;
  lang: string;
  dnd: boolean;
  createdAt: number;
  seenDay: number;
  mutedUntil: number;
  publicBlockedUntil: number;
  bannedUntil: number;
  /** The key id of the device that signed this request. */
  kid: string;
}

interface DeviceRow {
  kid: string; pub: string; pid: string; fid: string; code: string; name: string; band: AgeBand; level: number;
  region: Region; lang: string; dnd: number; created_at: number; seen_day: number; muted_until: number;
  public_blocked_until: number; banned_until: number;
}

export const PROFILE_COLUMNS = 'p.pid, p.fid, p.code, p.name, p.band, p.level, p.region, p.lang, p.dnd, p.created_at, p.seen_day, p.muted_until, p.public_blocked_until, p.banned_until';

export function meFromRow(r: Omit<DeviceRow, 'kid' | 'pub'>, kid = ''): Me {
  return {
    pid: r.pid, fid: r.fid, code: r.code, name: r.name, band: r.band, level: r.level, region: r.region, lang: r.lang, dnd: r.dnd === 1,
    createdAt: r.created_at, seenDay: r.seen_day, mutedUntil: r.muted_until, publicBlockedUntil: r.public_blocked_until,
    bannedUntil: r.banned_until, kid,
  };
}

const keyCache = new Map<string, CryptoKey>();
const KEY_CACHE_MAX = 2000;

export async function cachedPublicKey(pub: string): Promise<CryptoKey | null> {
  const hit = keyCache.get(pub);
  if (hit) return hit;
  const key = await importPublicKey(pub);
  if (!key) return null;
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(pub, key);
  return key;
}

const NONCE_TTL_MS = 10 * 60_000;
const NONCE_MAX = 20_000;
const nonces = new Map<string, number>();

/** True when this nonce was already used by this device; records it otherwise. */
export function replayed(kid: string, nonce: string, now: number): boolean {
  if (nonces.size > NONCE_MAX) {
    for (const [k, exp] of nonces) if (exp < now) nonces.delete(k);
    if (nonces.size > NONCE_MAX) nonces.clear();
  }
  const key = `${kid}.${nonce}`;
  const exp = nonces.get(key);
  if (exp !== undefined && exp >= now) return true;
  nonces.set(key, now + NONCE_TTL_MS);
  return false;
}

/** Tests only. */
export function resetAuthCaches(): void {
  keyCache.clear();
  nonces.clear();
}

export interface AuthInput {
  req: Request;
  db: SqlLike;
  now: number;
  wait(p: Promise<unknown>): void;
}

/**
 * Verifies the request and returns the player. `body` is the parsed JSON body (undefined for a GET). Throws 401 with
 * `unauthorized`, `unknown_device`, `clock_skew` (the answer carries the server time) or `replayed`, and 403 `banned`.
 */
export async function authenticate(c: AuthInput, body: unknown, opts: { allowBanned?: boolean } = {}): Promise<Me> {
  const url = new URL(c.req.url);
  const parts = parseAuth(c.req.headers.get(AUTH_HEADER) ?? url.searchParams.get(AUTH_QUERY));
  if (!parts) throw new HttpError(401, 'unauthorized');
  const row = await one<DeviceRow>(c.db, `SELECT d.kid, d.pub, ${PROFILE_COLUMNS} FROM soc_devices d JOIN soc_profiles p ON p.pid = d.pid WHERE d.kid = ?1`, parts.kid);
  if (!row) throw new HttpError(401, 'unknown_device');
  const pub = await cachedPublicKey(row.pub);
  if (!pub) throw new HttpError(401, 'unauthorized');
  const verdict = await verifyRequest(parts, pub, { method: c.req.method, url: c.req.url, body }, c.now);
  if (verdict === 'clock_skew') throw new HttpError(401, 'clock_skew');
  if (verdict !== 'ok') throw new HttpError(401, 'unauthorized');
  if (replayed(parts.kid, parts.nonce, c.now)) throw new HttpError(401, 'replayed');
  const me = meFromRow(row, row.kid);
  if (me.bannedUntil > c.now && !opts.allowBanned) throw new HttpError(403, 'banned', { until: me.bannedUntil });
  const today = Math.floor(c.now / DAY);
  if (me.seenDay < today) {
    me.seenDay = today;
    c.wait(run(c.db, 'UPDATE soc_profiles SET seen_day = ?2 WHERE pid = ?1', me.pid, today));
  }
  return me;
}

/**
 * A request signed with the key its own body carries (`pub`): the sender holds the private half. Register and recover use it
 * (the device is not known to the server yet). Returns the key and its id; throws 400 `bad_request` for a key that is not one,
 * 401 `unauthorized`, `clock_skew` or `replayed`.
 */
export async function proveKey(c: { req: Request; body: Record<string, unknown>; now: number }): Promise<{ pub: string; kid: string }> {
  const pub = c.body.pub;
  const key = await importPublicKey(pub);
  if (!key || typeof pub !== 'string') throw new HttpError(400, 'bad_request', { field: 'pub' });
  const parts = parseAuth(c.req.headers.get(AUTH_HEADER));
  const kid = await keyId(pub);
  if (!parts || parts.kid !== kid) throw new HttpError(401, 'unauthorized');
  const verdict = await verifyRequest(parts, key, { method: c.req.method, url: c.req.url, body: c.body }, c.now);
  if (verdict === 'clock_skew') throw new HttpError(401, 'clock_skew');
  if (verdict !== 'ok') throw new HttpError(401, 'unauthorized');
  if (replayed(kid, parts.nonce, c.now)) throw new HttpError(401, 'replayed');
  return { pub, kid };
}
