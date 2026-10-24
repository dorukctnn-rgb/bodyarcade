// The public keys that verify entitlement tokens, per release target. Public by nature (the Worker signs with the private
// half, which only lives in the Worker's secrets); they were made by the release owner (release/secrets.ts) and are copied
// here by tools/entitlements/sync-public-keys.mjs, so a new key is a one-command change.
//
// The page chooses by where it runs: bodyarcade.com (and the Android app, which loads it) trusts the production key,
// everything else (the preview on workers.dev, a local run) the preview key. A token of one target is worthless on the other.
import type { TokenKey } from './token.ts';

export type ReleaseTarget = 'preview' | 'production';

// BEGIN public keys (written by tools/entitlements/sync-public-keys.mjs)
export const PUBLIC_KEYS: Readonly<Record<ReleaseTarget, readonly TokenKey[]>> = {
  preview: [{ kid: 'Cgb4lPBL', jwk: { kty: 'EC', crv: 'P-256', x: 'QWUk6OCz1Zjblm44Uar36Ynkra31V93h0q-I3aN8Hm0', y: 'wsQUrqs16cujiY0fBScyvmA9xvOAFcuO_NCE9ZT4WAU' } }],
  production: [{ kid: 'OHkvCMH5', jwk: { kty: 'EC', crv: 'P-256', x: 'mdepxcO8dFQsID5AekUbzAA8Mj_Pwesw_vnpMNMxDQg', y: 'Aqzx7lTfxWa7wjEQH4aR-0l-phONVci2GAd5uadsP6k' } }],
};
// END public keys

/** The production site and its subdomains; nothing that merely contains the name. */
export function targetOfHost(host: string): ReleaseTarget {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return h === 'bodyarcade.com' || h.endsWith('.bodyarcade.com') ? 'production' : 'preview';
}

export const keysForHost = (host: string): readonly TokenKey[] => PUBLIC_KEYS[targetOfHost(host)];
