// The entitlement token: a compact JWS signed with ES256 (ECDSA P-256, SHA-256). The Worker signs it with a private key
// that is a Worker secret; the app checks it offline with the public key. Pure WebCrypto, so it runs in the browser,
// in Node and in the Worker alike.
//
// What the app trusts: the signature, the issuer and audience, that it was issued for THIS device, that it was not
// issued in the future and has not run out. A token copied to another device is worthless there (did), and one that
// outlives its week is worthless too (exp, at most 7 days). Nothing else in storage can grant Pro by itself.
import { isPlanId, type PlanId } from './plans.ts';
import { DID_RE } from './api.ts';

export const TOKEN_ISS = 'bodyarcade';
export const TOKEN_AUD = 'bodyarcade-app';
/** The longest a token may live: seven days. A refund or a cancellation reaches the app within a week at most. */
export const MAX_TOKEN_TTL_S = 7 * 86_400;
/** How far a device clock may differ from the server's before a token looks like it came from the future. */
export const CLOCK_SKEW_S = 5 * 60;
const MAX_TOKEN_CHARS = 2048;

export interface TokenClaims {
  iss: typeof TOKEN_ISS;
  aud: typeof TOKEN_AUD;
  /** The purchase: SHA-256 (hex) of the licence key or of the Play purchase token. */
  sub: string;
  /** The device this token was issued to. */
  did: string;
  plan: PlanId;
  /** Where the purchase was made. */
  src: 'gumroad' | 'play';
  /** Feature words: 'pro', 'family6'. */
  feat: string[];
  /** Epoch seconds of the last check with the seller (Gumroad or Google). */
  chk: number;
  iat: number;
  /** Epoch seconds; at most iat + 7 days, and never after the end of a paid period. */
  exp: number;
  /** Epoch seconds when the paid period ends (a cancelled subscription); absent for lifetime and renewing plans. */
  pe?: number;
  /** Epoch seconds when a free trial ends; present only while the seller's records show one running. It grants nothing: it only lets the app say so. */
  tr?: number;
  /** A Play licence-test purchase. */
  test?: boolean;
}

export interface TokenKey { kid: string; jwk: JsonWebKey }

export type TokenFailure = 'format' | 'alg' | 'kid' | 'signature' | 'claims' | 'issuer' | 'expired' | 'not_yet_valid' | 'wrong_device' | 'too_long';
export type VerifyResult =
  | { ok: true; claims: TokenClaims }
  /** `claims` is present only when the signature was good (so an expired token can still be read, never trusted). */
  | { ok: false; reason: TokenFailure; claims?: TokenClaims };

export interface VerifyOptions {
  keys: readonly TokenKey[];
  /** Epoch milliseconds now. */
  now: number;
  /** When given, the token must have been issued to this device. */
  did?: string;
}

// ── base64url ──
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array | null {
  if (!B64URL_RE.test(text) || text.length % 4 === 1) return null;
  try {
    const std = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const utf8 = new TextEncoder();

function parseJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { return undefined; }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x < 4_102_444_800;

/** The claims of a token whose signature has been checked: every field is verified for type and range; null otherwise. */
export function readClaims(x: unknown): TokenClaims | null {
  if (!isRecord(x)) return null;
  const { iss, aud, sub, did, plan, src, feat, chk, iat, exp, pe, tr, test } = x;
  if (iss !== TOKEN_ISS || aud !== TOKEN_AUD) return null;
  if (typeof sub !== 'string' || !/^[0-9a-f]{64}$/.test(sub)) return null;
  if (typeof did !== 'string' || !DID_RE.test(did)) return null;
  if (!isPlanId(plan)) return null;
  if (src !== 'gumroad' && src !== 'play') return null;
  if (!Array.isArray(feat) || feat.length > 8 || !feat.every((f) => typeof f === 'string' && /^[a-z0-9]{1,16}$/.test(f))) return null;
  if (!isInt(chk) || !isInt(iat) || !isInt(exp)) return null;
  if (pe !== undefined && !isInt(pe)) return null;
  if (tr !== undefined && !isInt(tr)) return null;
  if (test !== undefined && typeof test !== 'boolean') return null;
  const claims: TokenClaims = { iss, aud, sub, did, plan, src, feat: feat as string[], chk, iat, exp };
  if (pe !== undefined) claims.pe = pe;
  if (tr !== undefined) claims.tr = tr;
  if (test !== undefined) claims.test = test;
  return claims;
}

const importCache = new Map<string, Promise<CryptoKey | null>>();

/** Only the public half of a key is ever imported: a JWK that also carries `d` is cut down to x and y first. */
function importPublic(k: TokenKey): Promise<CryptoKey | null> {
  const { kty, crv, x, y } = k.jwk;
  const id = `${k.kid}.${kty ?? ''}.${crv ?? ''}.${x ?? ''}.${y ?? ''}`;
  let p = importCache.get(id);
  if (!p) {
    p = kty === 'EC' && crv === 'P-256' && typeof x === 'string' && typeof y === 'string'
      ? crypto.subtle.importKey('jwk', { kty, crv, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null)
      : Promise.resolve(null);
    importCache.set(id, p);
    if (importCache.size > 16) importCache.delete(importCache.keys().next().value as string);
  }
  return p;
}

export async function verifyToken(token: string, o: VerifyOptions): Promise<VerifyResult> {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'format' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [h, pl, sg] = parts as [string, string, string];
  const headerBytes = b64urlDecode(h);
  const payloadBytes = b64urlDecode(pl);
  const sig = b64urlDecode(sg);
  if (!headerBytes || !payloadBytes || !sig) return { ok: false, reason: 'format' };
  const header = parseJson(headerBytes);
  if (!isRecord(header)) return { ok: false, reason: 'format' };
  if (header['alg'] !== 'ES256') return { ok: false, reason: 'alg' };
  const kid = header['kid'];
  const key = typeof kid === 'string' ? o.keys.find((k) => k.kid === kid) : undefined;
  if (!key) return { ok: false, reason: 'kid' };
  if (sig.length !== 64) return { ok: false, reason: 'signature' };         // JWS wants r||s, not DER
  const pub = await importPublic(key);
  if (!pub) return { ok: false, reason: 'kid' };
  let good = false;
  try {
    good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig as BufferSource, utf8.encode(`${h}.${pl}`) as BufferSource);
  } catch { good = false; }
  if (!good) return { ok: false, reason: 'signature' };

  const raw = parseJson(payloadBytes);
  if (isRecord(raw) && (raw['iss'] !== TOKEN_ISS || raw['aud'] !== TOKEN_AUD)) return { ok: false, reason: 'issuer' };
  const claims = readClaims(raw);
  if (!claims) return { ok: false, reason: 'claims' };
  if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_TOKEN_TTL_S + 60) return { ok: false, reason: 'too_long', claims };
  const nowS = Math.floor(o.now / 1000);
  if (claims.iat > nowS + CLOCK_SKEW_S) return { ok: false, reason: 'not_yet_valid', claims };
  if (o.did !== undefined && claims.did !== o.did) return { ok: false, reason: 'wrong_device', claims };
  if (claims.exp <= nowS) return { ok: false, reason: 'expired', claims };
  return { ok: true, claims };
}
