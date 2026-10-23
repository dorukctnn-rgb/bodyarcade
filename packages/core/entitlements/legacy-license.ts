// A returning player's licence key from the live site (ba_license). The silent move to v2 sends it to our server like
// a key typed in. When nothing can be reached, the live site's own rule stays as the fallback: the key counts for 30
// days after the last check it made, to the end of a cancelled membership's paid period (B1: a check time in the
// future counts for nothing, so a hand-edited record cannot buy time).
import type { LegacyLicense } from '../store/index.ts';
import type { Entitlement } from '../types/index.ts';
import { DIRECT_GRACE_MS, type StoredEntitlement } from './state.ts';
import { entitlementFor, type PlanId } from './plans.ts';

export const planOfLegacy = (l: Pick<LegacyLicense, 'product'>): PlanId => (l.product === 'lifetime' ? 'founder' : 'legacy-monthly');

/** The record v1's isPro() would have honoured, or null when it would not have. */
export function legacyFallback(l: LegacyLicense, now: number): StoredEntitlement | null {
  if (l.futureVerifiedAt || l.verifiedAt <= 0 || l.verifiedAt > now) return null;
  if (l.endsAt !== undefined && now >= l.endsAt) return null;
  const validUntil = l.verifiedAt + DIRECT_GRACE_MS;
  if (now >= validUntil) return null;
  const e: Entitlement = entitlementFor(planOfLegacy(l), 'gumroad', l.endsAt !== undefined ? { exp: l.endsAt } : {});
  return { e, provider: 'gumroad', planId: planOfLegacy(l), verifiedAt: l.verifiedAt, validUntil, paidUntil: l.endsAt ?? null, seenAt: now, proof: l.key };
}
