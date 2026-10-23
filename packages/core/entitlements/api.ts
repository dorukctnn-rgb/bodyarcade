// The wire contract between the app (providers/server.ts, providers/play.ts) and the Worker (server/src/entitlements).
// Both sides import this file, so a route and its caller cannot drift apart.
//
//   POST /api/entitlements/activate    { key, did }                  a Gumroad licence key on this device      -> Grant
//   POST /api/entitlements/refresh     { key, did }                  the same key again, to renew the token    -> Grant
//   POST /api/entitlements/play        { did, purchases }            Google Play purchases of this device      -> Grant
//   POST /api/entitlements/deactivate  { token, did }                give this device's seat back              -> { ok: true }
//   POST /api/entitlements/reset       { did, key | purchases }      give every other seat back                -> { ok: true, removed }
//   GET  /api/entitlements/key                                       the public key(s) that verify tokens      -> { keys }
//
// The server stores no licence key and no purchase token, only their SHA-256, so the app sends the key (or the Play
// purchases it lists) again whenever it renews. Errors are `{ "error": code }` with the status in ERROR_STATUS.
import type { PlanId } from './plans.ts';

export const API_PREFIX = '/api/entitlements';
export const API = {
  activate: `${API_PREFIX}/activate`,
  refresh: `${API_PREFIX}/refresh`,
  play: `${API_PREFIX}/play`,
  deactivate: `${API_PREFIX}/deactivate`,
  reset: `${API_PREFIX}/reset`,
  key: `${API_PREFIX}/key`,
} as const;

/** The device's own random identifier: 16 random bytes in hex. Never derived from anything about the person. */
export const DID_RE = /^[0-9a-f]{32}$/;
/** What a Gumroad licence key looks like (the live site's check, with an upper bound). */
export const LICENSE_KEY_RE = /^[A-Za-z0-9-]{8,80}$/;
/** Google Play purchase tokens are long opaque strings. */
export const PURCHASE_TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,1024}$/;
export const PRODUCT_ID_RE = /^[a-z0-9_]{1,40}$/;
export const MAX_PURCHASES = 10;

export interface PlayPurchaseRef { productId: string; purchaseToken: string }

export interface KeyRequest { key: string; did: string }
export interface PlayRequest { did: string; purchases: PlayPurchaseRef[] }
export interface DeactivateRequest { token: string; did: string }
export type ResetRequest = { did: string } & ({ key: string; purchases?: undefined } | { purchases: PlayPurchaseRef[]; key?: undefined });

export interface Grant {
  /** The signed entitlement token (core/entitlements/token.ts). */
  token: string;
  plan: PlanId;
  /** Seats in use after this call, and the most this purchase may have. */
  devices: { used: number; limit: number };
}
export interface PublicKeys { keys: { kid: string; jwk: JsonWebKey }[] }

/** A refusal: the server looked and said no. Only these can take Pro away (B2). */
export type RefusalCode = 'not_found' | 'refunded' | 'ended' | 'limit';
export type ErrorCode =
  | RefusalCode
  | 'bad_request' | 'json_expected' | 'bad_json' | 'too_large' | 'method_not_allowed'
  | 'rate_limited' | 'upstream' | 'unavailable' | 'internal';

export const REFUSALS: readonly RefusalCode[] = ['not_found', 'refunded', 'ended', 'limit'];

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  json_expected: 415,
  bad_json: 400,
  too_large: 413,
  method_not_allowed: 405,
  not_found: 404,
  refunded: 403,
  ended: 403,
  limit: 409,
  rate_limited: 429,
  upstream: 502,
  unavailable: 503,
  internal: 500,
};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * B2, rule 6: only an explicit refusal may take Pro away. That is a client error status that is not a timeout or a
 * rate limit, with a well-formed body naming one of the refusal codes. A network error, a 5xx, a 429, an HTML page
 * from a captive portal or a proxy, an unknown code: none of these means "no longer entitled".
 */
export function isExplicitRefusal(status: number, body: unknown): body is { error: RefusalCode } {
  if (status < 400 || status >= 500 || status === 408 || status === 425 || status === 429) return false;
  return isRecord(body) && typeof body['error'] === 'string' && (REFUSALS as readonly string[]).includes(body['error']);
}

/** The refusal or error code of an answer body, or null. */
export function errorCodeOf(body: unknown): string | null {
  return isRecord(body) && typeof body['error'] === 'string' ? body['error'] : null;
}
