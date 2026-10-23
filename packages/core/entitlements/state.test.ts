import { describe, expect, it } from 'vitest';
import { CLOCK_SLACK_MS, DAY_MS, DIRECT_GRACE_MS, REFRESH_AFTER_MS, directRecord, isActive, needsRefresh, noteClock, readStored, standingOf, type StoredEntitlement } from './state.ts';

const NOW = Date.UTC(2026, 9, 24, 12);
const rec = (over: Partial<StoredEntitlement> = {}): StoredEntitlement => ({
  e: { plan: 'pro', source: 'server', token: 'tok' }, provider: 'server', planId: 'pro-yearly',
  verifiedAt: NOW - 1000, validUntil: NOW + 6 * DAY_MS, paidUntil: null, seenAt: NOW - 1000, proof: 'AAAAAAAA-BBBBBBBB', ...over,
});

describe('standing', () => {
  it('is none without a record and active with a good one', () => {
    expect(standingOf(null, NOW)).toBe('none');
    expect(standingOf(rec(), NOW)).toBe('active');
    expect(isActive(rec(), NOW)).toBe(true);
    expect(isActive(null, NOW)).toBe(false);
  });

  it('ends exactly when the record runs out', () => {
    expect(standingOf(rec({ validUntil: NOW + 1 }), NOW)).toBe('active');
    expect(standingOf(rec({ validUntil: NOW }), NOW)).toBe('expired');
    expect(standingOf(rec({ validUntil: NOW - DAY_MS }), NOW)).toBe('expired');
  });

  it('B1: a check in the future is no check', () => {
    expect(standingOf(rec({ verifiedAt: NOW + CLOCK_SLACK_MS + 1 }), NOW)).toBe('unverified');
    expect(standingOf(rec({ verifiedAt: NOW + 365 * DAY_MS, validUntil: NOW + 3650 * DAY_MS }), NOW)).toBe('unverified');
    expect(standingOf(rec({ verifiedAt: NOW + CLOCK_SLACK_MS }), NOW)).toBe('active');          // a few minutes of drift are fine
  });

  it('B1: a clock that went back makes the record unproven until the next check', () => {
    expect(standingOf(rec({ seenAt: NOW + 3 * DAY_MS }), NOW)).toBe('clock_back');
    expect(standingOf(rec({ seenAt: NOW + CLOCK_SLACK_MS }), NOW)).toBe('active');
  });

  it('a cancelled membership is active to the end of its paid period and not a moment longer, offline or not', () => {
    const r = rec({ paidUntil: NOW + 10 * DAY_MS, validUntil: NOW + 30 * DAY_MS });
    expect(standingOf(r, NOW + 9 * DAY_MS)).toBe('active');
    expect(standingOf(r, NOW + 10 * DAY_MS - 1)).toBe('active');
    expect(standingOf(r, NOW + 10 * DAY_MS)).toBe('period_over');
    expect(standingOf(r, NOW + 12 * DAY_MS)).toBe('period_over');
  });
});

describe('refreshing', () => {
  it('is due when the last check is a day old, and not before', () => {
    expect(needsRefresh(rec({ verifiedAt: NOW - REFRESH_AFTER_MS + 1 }), NOW)).toBe(false);
    expect(needsRefresh(rec({ verifiedAt: NOW - REFRESH_AFTER_MS }), NOW)).toBe(true);
    expect(needsRefresh(null, NOW)).toBe(false);
  });

  it('is due at once when the record is not active, so a restarted membership or a hiccup heals', () => {
    expect(needsRefresh(rec({ paidUntil: NOW - 1 }), NOW)).toBe(true);
    expect(needsRefresh(rec({ validUntil: NOW - 1 }), NOW)).toBe(true);
    expect(needsRefresh(rec({ verifiedAt: NOW + DAY_MS }), NOW)).toBe(true);
    expect(needsRefresh(rec({ seenAt: NOW + DAY_MS }), NOW)).toBe(true);
  });

  it('the clock note only ever goes up', () => {
    expect(noteClock(rec({ seenAt: 100 }), 200).seenAt).toBe(200);
    expect(noteClock(rec({ seenAt: 300 }), 200).seenAt).toBe(300);
    const r = rec();
    expect(noteClock(r, r.seenAt)).toBe(r);
  });
});

describe('a check made directly with Gumroad', () => {
  it('is good for 30 days without the network and for the paid period when that is shorter', () => {
    const r = directRecord({ plan: 'pro', source: 'gumroad' }, 'KEY-KEY-KEY', NOW);
    expect(r).toMatchObject({ provider: 'gumroad', verifiedAt: NOW, validUntil: NOW + DIRECT_GRACE_MS, paidUntil: null, proof: 'KEY-KEY-KEY' });
    expect(standingOf(r, NOW + 29 * DAY_MS)).toBe('active');
    expect(standingOf(r, NOW + 30 * DAY_MS)).toBe('expired');
    const cancelled = directRecord({ plan: 'pro', source: 'gumroad', exp: NOW + 10 * DAY_MS }, 'KEY-KEY-KEY', NOW);
    expect(standingOf(cancelled, NOW + 10 * DAY_MS)).toBe('period_over');
  });
});

describe('reading a stored record back (B4)', () => {
  it('accepts what was written and drops unknown fields', () => {
    expect(readStored(JSON.parse(JSON.stringify(rec())))).toEqual(rec());
    expect(readStored({ ...rec(), extra: 1, e: { ...rec().e, more: 2 } })).toEqual(rec());
    expect(readStored(JSON.parse(JSON.stringify(rec({ e: { plan: 'lifetime', founder: true, source: 'gumroad' }, planId: null, proof: null }))))).toEqual(rec({ e: { plan: 'lifetime', founder: true, source: 'gumroad' }, planId: null, proof: null }));
  });

  it('refuses everything that is not exactly that', () => {
    const bad: unknown[] = [
      null, 5, 'x', [], {}, { ...rec(), e: null }, { ...rec(), e: { plan: 'free', source: 'server' } }, { ...rec(), e: { plan: 'enterprise', source: 'server' } },
      { ...rec(), e: { plan: 'pro', source: 'paypal' } }, { ...rec(), e: { plan: 'pro', source: 'server', exp: 'x' } }, { ...rec(), e: { plan: 'pro', source: 'server', token: 5 } },
      { ...rec(), e: { plan: 'pro', source: 'server', token: 'x'.repeat(3000) } }, { ...rec(), provider: 'stripe' }, { ...rec(), verifiedAt: 'now' }, { ...rec(), verifiedAt: -1 },
      { ...rec(), validUntil: Number.POSITIVE_INFINITY }, { ...rec(), seenAt: null }, { ...rec(), paidUntil: 'x' }, { ...rec(), proof: 5 }, { ...rec(), proof: 'x'.repeat(200) },
    ];
    for (const b of bad) expect(readStored(JSON.parse(JSON.stringify(b ?? null))), JSON.stringify(b)).toBeNull();
  });

  it('keeps no plan id that is not one', () => {
    expect(readStored({ ...rec(), planId: 'enterprise' })?.planId).toBeNull();
    expect(readStored({ ...rec(), planId: '__proto__' })?.planId).toBeNull();
  });
});
