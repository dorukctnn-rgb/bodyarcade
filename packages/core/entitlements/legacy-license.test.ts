// The live site's own rule as a fallback record (site/game/store.js isPro): 30 days after its last check, to the end of a
// cancelled membership's paid period, and nothing for a check time that lies in the future (B1).
import { describe, expect, it } from 'vitest';
import type { LegacyLicense } from '../store/index.ts';
import { legacyFallback, planOfLegacy } from './legacy-license.ts';
import { DIRECT_GRACE_MS, standingOf } from './state.ts';

const NOW = Date.UTC(2026, 9, 24, 12);
const DAY = 86_400_000;
const lic = (o: Partial<LegacyLicense> = {}): LegacyLicense => ({ key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', product: 'pro', verifiedAt: NOW - 5 * DAY, futureVerifiedAt: false, ...o });

describe('legacyFallback', () => {
  it('maps the two old products to the two plans that exist only for them', () => {
    expect(planOfLegacy({ product: 'pro' })).toBe('legacy-monthly');
    expect(planOfLegacy({ product: 'lifetime' })).toBe('founder');
    expect(legacyFallback(lic(), NOW)?.e).toEqual({ plan: 'pro', source: 'gumroad' });
    expect(legacyFallback(lic({ product: 'lifetime' }), NOW)?.e).toEqual({ plan: 'lifetime', founder: true, source: 'gumroad' });
  });

  it('counts 30 days from the last check the live site made, not from now', () => {
    const r = legacyFallback(lic(), NOW);
    expect(r).toMatchObject({ provider: 'gumroad', verifiedAt: NOW - 5 * DAY, validUntil: NOW - 5 * DAY + DIRECT_GRACE_MS, paidUntil: null, proof: lic().key, seenAt: NOW });
    expect(standingOf(r, NOW + 24 * DAY)).toBe('active');
    expect(standingOf(r, NOW + 25 * DAY)).toBe('expired');
    expect(legacyFallback(lic({ verifiedAt: NOW - 30 * DAY }), NOW)).toBeNull();
    expect(legacyFallback(lic({ verifiedAt: NOW - 30 * DAY + 1 }), NOW)).not.toBeNull();
  });

  it('keeps the end of a cancelled membership', () => {
    const r = legacyFallback(lic({ endsAt: NOW + 3 * DAY }), NOW);
    expect(r?.e.exp).toBe(NOW + 3 * DAY);
    expect(r?.paidUntil).toBe(NOW + 3 * DAY);
    expect(standingOf(r, NOW + 3 * DAY)).toBe('period_over');
    expect(legacyFallback(lic({ endsAt: NOW }), NOW)).toBeNull();
    expect(legacyFallback(lic({ endsAt: NOW - DAY }), NOW)).toBeNull();
  });

  it('B1: nothing for a check time that is missing, in the future, or flagged as such', () => {
    expect(legacyFallback(lic({ verifiedAt: 0 }), NOW)).toBeNull();
    expect(legacyFallback(lic({ verifiedAt: -5 }), NOW)).toBeNull();
    expect(legacyFallback(lic({ verifiedAt: NOW + DAY }), NOW)).toBeNull();
    expect(legacyFallback(lic({ verifiedAt: 0, futureVerifiedAt: true }), NOW)).toBeNull();
    expect(legacyFallback(lic({ futureVerifiedAt: true }), NOW)).toBeNull();
  });
});
