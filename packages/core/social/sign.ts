// Device-signed requests (tech.md 5, "passwordless profile"). A device holds an ECDSA P-256 key pair made with WebCrypto;
// the private key is not extractable and lives in IndexedDB, so even a script on the page cannot read it, only use it.
// Every request carries one header:
//
//   X-BA-Auth: v1.<kid>.<ts>.<nonce>.<sig>
//     kid    key id: the first 22 characters of base64url(SHA-256(raw public key)), 128 bits
//     ts     the client's idea of server time in epoch ms (the client keeps an offset from `serverTime` in answers)
//     nonce  16 random bytes, base64url: a request is accepted once (the server keeps recent nonces)
//     sig    base64url of the 64-byte ECDSA signature (IEEE P1363, what WebCrypto produces) over the signing text:
//
//   BA1 \n METHOD \n path?sortedQuery \n ts \n nonce \n bodyHash
//     bodyHash  '-' without a body, otherwise base64url(SHA-256(canonicalJson(parsed body))). The canonical form (sorted
//               keys, no spaces) lets a server that has already parsed the body (the live Room's verifyPlayer hook gets a
//               parsed object, not bytes) check exactly what the device signed.
//
// A WebSocket cannot set headers, so there the same value goes in the query as `ba_auth`; that parameter is left out of the signed query.
// The signature binds method, path, query, body and a 5-minute window, so a captured request cannot be turned into a
// different one. The profile that signs is found by `kid` on the server; nothing in the request names a player.
import { cryptoRandomBytes, fromB64u, randomToken, toB64u, type RandomBytes } from './codes.ts';

export const AUTH_HEADER = 'X-BA-Auth';
export const AUTH_QUERY = 'ba_auth';
export const AUTH_VERSION = 'v1';
export const MAX_SKEW_MS = 5 * 60_000;
export const NO_BODY = '-';
export const KID_LEN = 22;
export const PUB_RAW_LEN = 65;

const ECDSA_KEY = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;
const enc = new TextEncoder();

export interface AuthParts { kid: string; ts: number; nonce: string; sig: string }

const B64U = /^[A-Za-z0-9_-]+$/;

export function formatAuth(p: AuthParts): string {
  return `${AUTH_VERSION}.${p.kid}.${p.ts}.${p.nonce}.${p.sig}`;
}

/** The parts of a header value, or null for anything that is not exactly the v1 shape. */
export function parseAuth(value: string | null | undefined): AuthParts | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  const f = value.split('.');
  if (f.length !== 5 || f[0] !== AUTH_VERSION) return null;
  const [, kid, ts, nonce, sig] = f as [string, string, string, string, string];
  if (kid.length !== KID_LEN || !B64U.test(kid)) return null;
  if (!/^\d{1,14}$/.test(ts)) return null;
  if (nonce.length < 16 || nonce.length > 32 || !B64U.test(nonce)) return null;
  if (sig.length !== 86 || !B64U.test(sig)) return null;
  return { kid, ts: Number(ts), nonce, sig };
}

// ───────── canonical forms ─────────

const MAX_DEPTH = 16;

/** JSON with sorted keys and no spaces. Throws TypeError for anything JSON cannot carry (NaN, functions, deep nesting). */
export function canonicalJson(v: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new TypeError('canonicalJson: too deep');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x, depth + 1))).join(',')}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k], depth + 1)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof v}`);
  }
}

/** `/path?a=1&b=2` with the query pairs sorted and the auth parameter left out. Accepts a path with query or a full URL. */
export function normalizePathQuery(input: string): string {
  const u = new URL(input, 'https://x.invalid');
  const pairs: [string, string][] = [];
  u.searchParams.forEach((v, k) => { if (k !== AUTH_QUERY) pairs.push([k, v]); });
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const q = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return u.pathname + (q ? `?${q}` : '');
}

export async function sha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** '-' when there is no body, else the hash of the canonical JSON of the (parsed) body. */
export async function bodyHash(body: unknown): Promise<string> {
  if (body === undefined) return NO_BODY;
  return toB64u(await sha256(canonicalJson(body)));
}

export interface SigningInput { method: string; pathQuery: string; ts: number; nonce: string; bodyHash: string }

export function signingText(m: SigningInput): string {
  return `BA1\n${m.method.toUpperCase()}\n${m.pathQuery}\n${m.ts}\n${m.nonce}\n${m.bodyHash}`;
}

// ───────── keys ─────────

export interface DeviceKeys { privateKey: CryptoKey; publicRaw: string; kid: string }

/** A new device key pair. The private key cannot be exported; the public key is the 65-byte uncompressed point. */
export async function generateDeviceKey(): Promise<DeviceKeys> {
  const pair = await globalThis.crypto.subtle.generateKey(ECDSA_KEY, false, ['sign', 'verify']);
  const publicRaw = toB64u(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey)));
  return { privateKey: pair.privateKey, publicRaw, kid: await keyId(publicRaw) };
}

/** The key id of a raw public key (as base64url). */
export async function keyId(publicRaw: string): Promise<string> {
  const raw = fromB64u(publicRaw);
  if (!raw) throw new TypeError('keyId: not base64url');
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', raw as Uint8Array<ArrayBuffer>));
  return toB64u(h).slice(0, KID_LEN);
}

/** Imports a raw public key for verification; null for anything that is not a valid P-256 point of 65 bytes. */
export async function importPublicKey(publicRaw: unknown): Promise<CryptoKey | null> {
  if (typeof publicRaw !== 'string' || publicRaw.length > 120) return null;
  const raw = fromB64u(publicRaw);
  if (!raw || raw.length !== PUB_RAW_LEN || raw[0] !== 4) return null;
  try {
    return await globalThis.crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, ECDSA_KEY, true, ['verify']);
  } catch {
    return null;
  }
}

// ───────── sign and verify ─────────

export interface RequestToSign {
  method: string;
  /** Path with query, or a full URL. */
  url: string;
  /** The parsed body that will be sent as JSON; undefined for no body. */
  body?: unknown;
}

/** The header value for one request. `now` is the client's estimate of server time (epoch ms). */
export async function signRequest(keys: Pick<DeviceKeys, 'privateKey' | 'kid'>, req: RequestToSign, now: number, rb: RandomBytes = cryptoRandomBytes): Promise<string> {
  const ts = Math.floor(now);
  const nonce = randomToken(16, rb);
  const text = signingText({ method: req.method, pathQuery: normalizePathQuery(req.url), ts, nonce, bodyHash: await bodyHash(req.body) });
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign(ECDSA_SIGN, keys.privateKey, enc.encode(text)));
  return formatAuth({ kid: keys.kid, ts, nonce, sig: toB64u(sig) });
}

export type VerifyOutcome = 'ok' | 'clock_skew' | 'bad_signature';

/** Checks the clock window first, then the signature. The path and query are normalised here again. */
export async function verifyRequest(
  parts: AuthParts,
  pub: CryptoKey,
  req: { method: string; url: string; body?: unknown },
  now: number,
  maxSkewMs = MAX_SKEW_MS,
): Promise<VerifyOutcome> {
  if (Math.abs(now - parts.ts) > maxSkewMs) return 'clock_skew';
  const sig = fromB64u(parts.sig);
  if (!sig || sig.length !== 64) return 'bad_signature';
  let hash: string;
  try { hash = await bodyHash(req.body); } catch { return 'bad_signature'; }
  const text = signingText({ method: req.method, pathQuery: normalizePathQuery(req.url), ts: parts.ts, nonce: parts.nonce, bodyHash: hash });
  try {
    const ok = await globalThis.crypto.subtle.verify(ECDSA_SIGN, pub, sig as Uint8Array<ArrayBuffer>, enc.encode(text));
    return ok ? 'ok' : 'bad_signature';
  } catch {
    return 'bad_signature';
  }
}
