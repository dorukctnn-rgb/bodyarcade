import { describe, expect, it } from 'vitest';
import { PLANS, SOLD_PLAN_IDS, type PlanId } from '../../../core/entitlements/plans.ts';
import { MAX_TOKEN_TTL_S, TOKEN_AUD, TOKEN_ISS } from '../../../core/entitlements/token.ts';
import {
  DAY_S, claimsFor, normalizeKey, sec, seatLimit, sha256Hex, timeToSec, trialEndFor, type PurchaseRow,
} from './rules.ts';

const NOW = 1_792_000_000;                       // epoch seconds, late October 2026

describe('hashing and keys', () => {
  it('sha256Hex is SHA-256 in lower-case hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('ÄÖ')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a key is the same purchase in any case and with spaces around it', () => {
    expect(normalizeKey('  abcd-1234  ')).toBe('ABCD-1234');
    expect(normalizeKey('ABCD-1234')).toBe('ABCD-1234');
  });

  it('sec counts whole seconds', () => {
    expect(sec(1_792_000_000_999)).toBe(1_792_000_000);
    expect(sec(0)).toBe(0);
  });
});

describe('timeToSec: a time from a seller', () => {
  it.each([
    ['2026-10-24T12:00:00Z', 1_792_843_200], ['2026-10-24T12:00:00.123Z', 1_792_843_200], [1_792_843_200_000, 1_792_843_200], [1_792_843_200, 1_792_843_200],
    ['1792843200000', 1_792_843_200], ['1792843200', 1_792_843_200],
  ])('reads %j', (input, expected) => {
    expect(timeToSec(input)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['abc'], ['2026-13-45'], [-5], [0], [Number.NaN], [Number.POSITIVE_INFINITY], [{}], [[]], [true]])('does not read %j', (input) => {
    expect(timeToSec(input)).toBeNull();
  });
});

describe('seats', () => {
  it('are Pro 3, Family 4, Founder 6, and the same for the two plans that are no longer sold', () => {
    const limits = Object.fromEntries((Object.keys(PLANS) as PlanId[]).map((id) => [id, seatLimit(id)]));
    expect(limits).toEqual({ 'pro-monthly': 3, 'pro-yearly': 3, 'family-yearly': 4, lifetime: 3, 'legacy-monthly': 3, founder: 6 });
  });
});

describe('when a free trial runs', () => {
  const base = { now: NOW, known: null, expiry: null, startedAt: null } as const;

  describe('on Gumroad', () => {
    it('is the first week after the purchase, for the plans that have a trial', () => {
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'gumroad', startedAt: NOW - DAY_S })).toBe(NOW + 6 * DAY_S);
    });
    it('is not there after the week, without a purchase time, or for a plan without a trial', () => {
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'gumroad', startedAt: NOW - 7 * DAY_S })).toBeNull();
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'gumroad', startedAt: null })).toBeNull();
      // Pro yearly is the only plan with a trial (24 Oct), so a Family purchase is never "in its trial".
      for (const plan of ['pro-monthly', 'family-yearly', 'lifetime', 'legacy-monthly', 'founder'] as const) expect(trialEndFor({ ...base, plan, src: 'gumroad', startedAt: NOW })).toBeNull();
    });
  });

  describe('on Google Play', () => {
    it('is a first period of about the trial\'s length that has not ended', () => {
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'play', startedAt: NOW - DAY_S, expiry: NOW + 6 * DAY_S })).toBe(NOW + 6 * DAY_S);
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'play', startedAt: NOW - DAY_S, expiry: NOW - DAY_S + 8 * DAY_S })).toBe(NOW + 7 * DAY_S);
    });
    it('is not a period of a year, one that has ended, or one whose times are not known', () => {
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'play', startedAt: NOW - DAY_S, expiry: NOW + 364 * DAY_S })).toBeNull();
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'play', startedAt: NOW - 8 * DAY_S, expiry: NOW - 1 })).toBeNull();
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'play', startedAt: null, expiry: NOW + DAY_S })).toBeNull();
      expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'play', startedAt: NOW, expiry: null })).toBeNull();
      expect(trialEndFor({ ...base, plan: 'pro-monthly', src: 'play', startedAt: NOW, expiry: NOW + 6 * DAY_S })).toBeNull();
      expect(trialEndFor({ ...base, plan: 'family-yearly', src: 'play', startedAt: NOW, expiry: NOW + 6 * DAY_S })).toBeNull();
    });
  });

  it('what was found before is kept, whatever the seller says now', () => {
    expect(trialEndFor({ ...base, plan: 'pro-yearly', src: 'gumroad', known: NOW + 3 * DAY_S, startedAt: NOW - 30 * DAY_S })).toBe(NOW + 3 * DAY_S);
    expect(trialEndFor({ ...base, plan: 'pro-monthly', src: 'gumroad', known: NOW - DAY_S })).toBe(NOW - DAY_S);
  });
});

describe('the claims of a token', () => {
  const row = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
    sub: 'a'.repeat(64), src: 'gumroad', plan: 'pro-yearly', product: 'P', status: 'active', paid_until: null, checked_at: NOW - 60, first_seen: NOW - 9999,
    started_at: null, trial_end: null, test: 0, ...over,
  });
  const DID = 'b'.repeat(32);

  it('are the seven days of a plain purchase, checked now', () => {
    expect(claimsFor(row({ checked_at: NOW }), DID, NOW)).toEqual({
      iss: TOKEN_ISS, aud: TOKEN_AUD, sub: 'a'.repeat(64), did: DID, plan: 'pro-yearly', src: 'gumroad', feat: ['pro'], chk: NOW, iat: NOW, exp: NOW + MAX_TOKEN_TTL_S,
    });
  });

  it('give each plan its features', () => {
    for (const id of [...SOLD_PLAN_IDS, 'legacy-monthly', 'founder'] as PlanId[]) expect(claimsFor(row({ plan: id }), DID, NOW).feat).toEqual([...PLANS[id].feat]);
    const c = claimsFor(row({ plan: 'family-yearly' }), DID, NOW);
    c.feat.push('x');
    expect(PLANS['family-yearly'].feat).toEqual(['pro', 'family6']);        // the plan table is not shared with the claims
  });

  it('never run past the end of a paid period, and say when it is', () => {
    const c = claimsFor(row({ paid_until: NOW + 2 * DAY_S }), DID, NOW);
    expect(c).toMatchObject({ pe: NOW + 2 * DAY_S, exp: NOW + 2 * DAY_S });
    expect(claimsFor(row({ paid_until: NOW + 30 * DAY_S }), DID, NOW)).toMatchObject({ pe: NOW + 30 * DAY_S, exp: NOW + MAX_TOKEN_TTL_S });
  });

  it('can be capped (the stale path) and carry the old check time, never one from the future', () => {
    expect(claimsFor(row({ checked_at: NOW - 10 * DAY_S }), DID, NOW, { expCap: NOW - 10 * DAY_S + 14 * DAY_S })).toMatchObject({ chk: NOW - 10 * DAY_S, exp: NOW + 4 * DAY_S });
    expect(claimsFor(row({ checked_at: NOW + 500 }), DID, NOW).chk).toBe(NOW);
  });

  it('carry the trial only while it runs, and the test flag only for a test purchase', () => {
    expect(claimsFor(row({ trial_end: NOW + DAY_S }), DID, NOW).tr).toBe(NOW + DAY_S);
    expect(claimsFor(row({ trial_end: NOW }), DID, NOW).tr).toBeUndefined();
    expect(claimsFor(row({ trial_end: NOW - DAY_S }), DID, NOW).tr).toBeUndefined();
    expect(claimsFor(row({ test: 1 }), DID, NOW).test).toBe(true);
    expect(claimsFor(row(), DID, NOW)).not.toHaveProperty('test');
  });

  it('refuse to make a token that would be dead on arrival', () => {
    expect(() => claimsFor(row({ paid_until: NOW }), DID, NOW)).toThrow(RangeError);
    expect(() => claimsFor(row({ paid_until: NOW - 5 }), DID, NOW)).toThrow(RangeError);
    expect(() => claimsFor(row(), DID, NOW, { expCap: NOW })).toThrow(RangeError);
  });
});
