import { describe, expect, it } from 'vitest';
import { createI18n } from './i18n/index.ts';
import {
  describeOffer, perMonth, shouldShowPaywallAfterRound, STUB_PLANS, trialApplies, yearlySavingsPercent, type PaywallContext,
} from './plans.ts';

const yearly = STUB_PLANS.offers.find((o) => o.id === 'pro-yearly')!;
const monthly = STUB_PLANS.offers.find((o) => o.id === 'pro-monthly')!;

describe('plans', () => {
  it('shows a trial only when the offer has one and the player is eligible', () => {
    expect(trialApplies(yearly, { trialEligible: true, trialReminder: true })).toBe(true);
    expect(trialApplies(yearly, { trialEligible: false, trialReminder: false })).toBe(false);
    // the entitlements say whether a trial is on offer at all: without that the words are not shown
    expect(trialApplies(yearly, { trialEligible: true, trialReminder: false })).toBe(false);
    expect(trialApplies(monthly, { trialEligible: true, trialReminder: true })).toBe(false);
    // Family has no trial, whatever a config says
    const family = STUB_PLANS.offers.find((o) => o.id === 'family-yearly')!;
    expect(family.trialDays).toBeUndefined();
    expect(trialApplies({ ...family, trialDays: 7 }, { trialEligible: true, trialReminder: true })).toBe(false);
  });

  it('computes honest figures from the config', () => {
    expect(perMonth(yearly)).toBe(3.33);
    expect(perMonth(monthly)).toBeNull();
    expect(yearlySavingsPercent(STUB_PLANS)).toBe(58);
  });

  it('describes offers in English and Turkish without a trial line when it does not apply', () => {
    const en = createI18n('en');
    const a = describeOffer(yearly, en, { trialEligible: true, trialReminder: true });
    expect(a.priceLine).toBe('$39.99 a year');
    expect(a.trialLine).toContain('7 days free');
    expect(a.detail).toContain('$3.33');
    const b = describeOffer(yearly, en, { trialEligible: false, trialReminder: false });
    expect(b.trialLine).toBeNull();
    expect(b.cta).not.toMatch(/free/i);
    const tr = describeOffer(yearly, createI18n('tr'), { trialEligible: true, trialReminder: true });
    expect(tr.trialLine).toContain('7 gün ücretsiz');
  });
});

describe('when the paywall may appear on its own', () => {
  const base: PaywallContext = {
    now: 10 * 86_400_000, entitlementPlan: 'free', child: false, good: true, lastShownAt: null, priorRounds: 1,
    round: { activeSeconds: 75, completed: true, live: false },
  };
  it('after the first good round', () => expect(shouldShowPaywallAfterRound(base)).toBe(true));
  it('never before a first round exists, in a short round, a live match or a poor round', () => {
    expect(shouldShowPaywallAfterRound({ ...base, priorRounds: 0 })).toBe(false);
    expect(shouldShowPaywallAfterRound({ ...base, round: { activeSeconds: 40, completed: true, live: false } })).toBe(false);
    expect(shouldShowPaywallAfterRound({ ...base, round: { activeSeconds: 75, completed: true, live: true } })).toBe(false);
    expect(shouldShowPaywallAfterRound({ ...base, good: false })).toBe(false);
    expect(shouldShowPaywallAfterRound({ ...base, round: { activeSeconds: 75, completed: false, live: false } })).toBe(false);
  });
  it('never for Pro owners or child profiles', () => {
    expect(shouldShowPaywallAfterRound({ ...base, entitlementPlan: 'pro' })).toBe(false);
    expect(shouldShowPaywallAfterRound({ ...base, child: true })).toBe(false);
  });
  it('stays quiet for three days after it appeared', () => {
    expect(shouldShowPaywallAfterRound({ ...base, lastShownAt: base.now - 2 * 86_400_000 })).toBe(false);
    expect(shouldShowPaywallAfterRound({ ...base, lastShownAt: base.now - 3 * 86_400_000 })).toBe(true);
  });
});
