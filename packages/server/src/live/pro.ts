// The Pro check of live play: does the player who creates or joins a room hold a Pro entitlement that the entitlement service signed?
// The paywall promises "rooms where everyone plays the Pro games the host picks", so a Pro game may start in a room only while a
// Pro entitlement stands behind it. The proof is the entitlement token itself (core/entitlements/token.ts: a compact JWS signed with
// ES256 by the Worker's own entitlement key), sent in the body of the create and join calls; here it is checked with the PUBLIC key,
// the same way the app checks it. A flag from a page is never believed: a page that says "I am Pro" has no token to show, and a token
// that was made up, cut, signed by another key, or has run out is worth nothing.
//
// What a verdict carries: the end of the token's own validity (its `exp`, at most seven days after it was issued). The Worker writes
// it into the join ticket (`x`), the Room keeps it per member and in the room's Pro authorisation, and the Room needs no key, no clock
// beyond its own and no network for it: everything after this file is synchronous.
//
// What this does not do: bind the token to a person. The token names the purchase and the device it was issued to, and a page has no
// private key for it, so someone who hands their token string to a friend lends their Pro for the days the token lives (seven at most;
// the entitlement service already limits the devices per purchase when keys are activated). Lending a token is the same act as
// lending a licence key, and no worse.
import { parsePrivateJwk, publicKeyOf } from '../../../core/entitlements/sign.ts';
import { verifyToken, type TokenKey } from '../../../core/entitlements/token.ts';
import { parsePublicKeys } from '../entitlements/config.ts';
import type { LiveEnv } from './env.ts';

/** `none`: no token was sent. `expired`: a genuine token whose time has run out (the app renews it when it is online). `invalid`: anything else. */
export type ProRefusal = 'none' | 'expired' | 'invalid';

export type ProVerdict =
  /** `until`: epoch ms until which the token vouches for the player. */
  | { ok: true; until: number }
  | { ok: false; reason: ProRefusal };

export const NO_PRO: ProVerdict = Object.freeze({ ok: false, reason: 'none' }) as ProVerdict;

type KeyEnv = Pick<LiveEnv, 'ENT_PRIV_JWK' | 'ENT_PUB_JWKS'>;

let keyCache: { id: string; keys: TokenKey[] } | null = null;
let warnedNoKeys = false;

/** The public keys that verify entitlement tokens on this Worker: the public half of its signing key, then the older ones in ENT_PUB_JWKS. */
export function proKeys(env: KeyEnv): TokenKey[] {
  const priv = typeof env.ENT_PRIV_JWK === 'string' ? env.ENT_PRIV_JWK : '';
  const pub = typeof env.ENT_PUB_JWKS === 'string' ? env.ENT_PUB_JWKS : '';
  const id = `${priv}\n${pub}`;
  if (keyCache && keyCache.id === id) return keyCache.keys;
  const keys: TokenKey[] = [];
  const own = parsePrivateJwk(priv);
  if (own) keys.push(publicKeyOf(own));
  for (const k of parsePublicKeys(pub)) if (!keys.some((x) => x.kid === k.kid)) keys.push(k);
  keyCache = { id, keys };
  return keys;
}

/** Tests only: forget the cached keys. */
export function resetProKeys(): void {
  keyCache = null;
  warnedNoKeys = false;
}

/**
 * Checks what a request sent as its Pro proof (`body.pro`): signature, issuer, the dates, and that the token grants Pro. Never throws;
 * a request without a token is `none`, one with a token that does not stand up is `expired` or `invalid`.
 */
export async function verifyProProof(env: KeyEnv, token: unknown, now: number = Date.now()): Promise<ProVerdict> {
  if (token === undefined || token === null || token === '') return NO_PRO;
  if (typeof token !== 'string') return { ok: false, reason: 'invalid' };
  const keys = proKeys(env);
  if (!keys.length) {
    if (!warnedNoKeys) { warnedNoKeys = true; console.log(JSON.stringify({ evt: 'pro_no_keys' })); }
    return { ok: false, reason: 'invalid' };
  }
  let r;
  try { r = await verifyToken(token, { keys, now }); } catch { return { ok: false, reason: 'invalid' }; }
  if (!r.ok) return { ok: false, reason: r.reason === 'expired' ? 'expired' : 'invalid' };
  // every sold plan carries 'pro'; a token without it (a future non-Pro plan) opens no Pro game
  if (!r.claims.feat.includes('pro')) return { ok: false, reason: 'invalid' };
  const until = r.claims.exp * 1000;
  return until > now ? { ok: true, until } : { ok: false, reason: 'expired' };
}
