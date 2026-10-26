// Tokens for the Pro tests of live play: a signing key pair of the test's own, and entitlement tokens minted the way the entitlement
// service mints them (core/entitlements/sign.ts), so what the Worker verifies in these tests is the real format with the real checks.
import { generateSigningKeys, importSigningKey, signToken, type PrivateKeyJwk } from '../../../core/entitlements/sign.ts';
import { TOKEN_AUD, TOKEN_ISS, type TokenClaims, type TokenKey } from '../../../core/entitlements/token.ts';

export const DAY_S = 86_400;
const DID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SUB = 'f'.repeat(64);

/** The claims of a Pro token issued a minute before `nowMs` that is good for three days. */
export function proClaims(nowMs: number, over: Partial<TokenClaims> = {}): TokenClaims {
  const nowS = Math.floor(nowMs / 1000);
  return { iss: TOKEN_ISS, aud: TOKEN_AUD, sub: SUB, did: DID, plan: 'pro-yearly', src: 'gumroad', feat: ['pro'], chk: nowS - 60, iat: nowS - 60, exp: nowS + 3 * DAY_S, ...over };
}

export interface ProKit {
  privateJwk: PrivateKeyJwk;
  publicKey: TokenKey;
  /** The Worker settings that make a Worker verify with this key (what `wrangler secret put ENT_PRIV_JWK` does for the real one). */
  env: { ENT_PRIV_JWK: string };
  /** A token signed with this key. `over` changes claims; `nowMs` is the moment it is minted (default: now). */
  mint(over?: Partial<TokenClaims>, nowMs?: number): Promise<string>;
}

export async function makeProKit(): Promise<ProKit> {
  const { privateJwk, publicKey } = await generateSigningKeys();
  const key = await importSigningKey(privateJwk);
  return {
    privateJwk, publicKey,
    env: { ENT_PRIV_JWK: JSON.stringify(privateJwk) },
    mint: (over = {}, nowMs = Date.now()) => signToken(proClaims(nowMs, over), key, privateJwk.kid),
  };
}
