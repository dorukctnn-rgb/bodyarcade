// The licence rules of the live site (tests/legacy/store.test.mjs, cases 5-7), now over the shared rule functions.
import { describe, expect, it } from 'vitest';
import { judgePurchase, readVerifyAnswer, subscriptionEnd } from './gumroad-rules.ts';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const NULLS = { subscription_ended_at: null, subscription_cancelled_at: null, subscription_failed_at: null };

describe('subscriptionEnd', () => {
  it('the earliest end date wins and an unreadable one counts as over', () => {
    expect(subscriptionEnd({ subscription_cancelled_at: iso(NOW + 5 * DAY), subscription_failed_at: iso(NOW + 2 * DAY) })).toBe(NOW + 2 * DAY);
    expect(subscriptionEnd(NULLS)).toBeNull();
    expect(subscriptionEnd({})).toBeNull();
    expect(subscriptionEnd({ subscription_cancelled_at: 'not a date' })).toBe(0);
    expect(subscriptionEnd({ subscription_ended_at: iso(NOW + DAY), subscription_cancelled_at: 'junk' })).toBe(0);
    expect(subscriptionEnd({ subscription_ended_at: '' })).toBeNull();
  });
});

describe('judgePurchase', () => {
  it('an active monthly plan is active with no end date', () => {
    expect(judgePurchase({ ...NULLS }, NOW)).toEqual({ status: 'active', paidUntil: null });
    expect(judgePurchase({}, NOW)).toEqual({ status: 'active', paidUntil: null });
  });

  it('a cancelled plan stays active until the paid period ends, and that end is reported', () => {
    expect(judgePurchase({ ...NULLS, subscription_cancelled_at: iso(NOW + 10 * DAY) }, NOW)).toEqual({ status: 'active', paidUntil: NOW + 10 * DAY });
    expect(judgePurchase({ ...NULLS, subscription_cancelled_at: iso(NOW + 10 * DAY) }, NOW + 10 * DAY - 1)).toMatchObject({ status: 'active' });
    expect(judgePurchase({ ...NULLS, subscription_cancelled_at: iso(NOW + 10 * DAY) }, NOW + 10 * DAY)).toEqual({ status: 'ended' });
  });

  it('a membership whose end date has passed has ended, whichever field says so', () => {
    for (const field of ['subscription_cancelled_at', 'subscription_failed_at', 'subscription_ended_at']) {
      expect(judgePurchase({ ...NULLS, [field]: iso(NOW - DAY) }, NOW), field).toEqual({ status: 'ended' });
    }
    expect(judgePurchase({ ...NULLS, subscription_ended_at: 'garbage' }, NOW)).toEqual({ status: 'ended' });
  });

  it('a refund, a chargeback or a dispute ends it, even with a paid period ahead', () => {
    for (const field of ['refunded', 'chargebacked', 'disputed']) {
      expect(judgePurchase({ ...NULLS, [field]: true, subscription_cancelled_at: iso(NOW + 9 * DAY) }, NOW), field).toEqual({ status: 'refunded' });
    }
    expect(judgePurchase({ refunded: false, chargebacked: false, disputed: false }, NOW)).toEqual({ status: 'active', paidUntil: null });
  });

  it('a plan restarted before the end shows no end date, so the next check is active with none', () => {
    expect(judgePurchase({ ...NULLS, subscription_cancelled_at: iso(NOW + 2 * DAY) }, NOW)).toMatchObject({ paidUntil: NOW + 2 * DAY });
    expect(judgePurchase({ ...NULLS }, NOW + 2 * DAY + 1000)).toEqual({ status: 'active', paidUntil: null });
  });
});

describe('readVerifyAnswer', () => {
  it('a success carries the purchase', () => {
    expect(readVerifyAnswer(200, { success: true, uses: 1, purchase: { email: 'x@example.com', refunded: false } })).toEqual({ kind: 'found', purchase: { email: 'x@example.com', refunded: false } });
    expect(readVerifyAnswer(200, { success: true })).toEqual({ kind: 'found', purchase: {} });
    expect(readVerifyAnswer(200, { success: true, purchase: 'x' })).toEqual({ kind: 'found', purchase: {} });
  });

  it('a message that the licence does not exist for the product means: try the next product', () => {
    expect(readVerifyAnswer(404, { success: false, message: 'That license does not exist for the provided product.' })).toEqual({ kind: 'not_found' });
    expect(readVerifyAnswer(200, { success: false, message: 'x' })).toEqual({ kind: 'not_found' });
  });

  it('everything else is unreadable, which is never a verdict on the key (B2)', () => {
    for (const [status, body] of [[500, { success: false, message: 'x' }], [502, undefined], [503, '<html>'], [429, { success: false, message: 'slow down' }], [408, {}],
      [200, undefined], [200, null], [200, 'ok'], [200, []], [200, {}], [200, { success: 'true' }], [404, { success: false }], [404, undefined]] as [number, unknown][]) {
      expect(readVerifyAnswer(status, body), `${status} ${JSON.stringify(body)}`).toEqual({ kind: 'unreadable' });
    }
  });
});
