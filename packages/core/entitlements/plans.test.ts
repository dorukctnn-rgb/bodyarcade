import { describe, expect, it } from 'vitest';
import type { PlansConfig } from '../ui/plans.ts';
import {
  GUMROAD_LEGACY_PRODUCTS, PLANS, PLAN_IDS, PLAY_PRODUCTS, SOLD_PLAN_IDS, bestPlan, entitlementFor, isPlanId, isSoldPlanId, isoDays,
  playPlans, webPlans, type PlayItemDetails,
} from './plans.ts';

describe('the catalogue', () => {
  it('lists four sold plans and two that exist only for earlier buyers', () => {
    expect(PLAN_IDS.sort()).toEqual(['family-yearly', 'founder', 'legacy-monthly', 'lifetime', 'pro-monthly', 'pro-yearly']);
    expect(SOLD_PLAN_IDS.every((id) => PLANS[id].sold)).toBe(true);
    expect(PLANS['legacy-monthly'].sold).toBe(false);
    expect(PLANS.founder.sold).toBe(false);
  });

  it('keeps the prices and trials of BUILD-PLAN', () => {
    expect(PLANS['pro-monthly'].price).toBe(7.99);
    expect(PLANS['pro-yearly']).toMatchObject({ price: 39.99, trialDays: 7 });
    expect(PLANS['family-yearly']).toMatchObject({ price: 59.99, trialDays: 7, profiles: 6 });
    expect(PLANS.lifetime.price).toBe(119.99);
    expect(PLANS['pro-monthly'].trialDays).toBeUndefined();
    expect(PLANS['legacy-monthly'].price).toBe(4.99);
    expect(PLANS.founder.price).toBe(99);
  });

  it('allows 3 devices for Pro and Lifetime, 4 for Family and 6 for a Founder', () => {
    expect(PLAN_IDS.map((id) => [id, PLANS[id].devices])).toEqual(expect.arrayContaining([
      ['pro-monthly', 3], ['pro-yearly', 3], ['lifetime', 3], ['legacy-monthly', 3], ['family-yearly', 4], ['founder', 6],
    ]));
  });

  it('gives the founders everything the family plan has', () => {
    expect(PLANS.founder).toMatchObject({ plan: 'lifetime', founder: true, profiles: 6 });
    expect(PLANS.founder.feat).toEqual(expect.arrayContaining(['pro', 'family6']));
  });

  it('maps the two old Gumroad products and the four Play products', () => {
    expect(GUMROAD_LEGACY_PRODUCTS).toEqual({ 'tN-xTHwaZm8bOdcHHBaKbQ==': 'legacy-monthly', 'xIio9_FPmjKjWkdZLQKVxA==': 'founder' });
    expect(PLAY_PRODUCTS).toEqual({
      bodyarcade_pro_monthly: 'pro-monthly', bodyarcade_pro_yearly: 'pro-yearly', bodyarcade_family_yearly: 'family-yearly', bodyarcade_lifetime: 'lifetime',
    });
    for (const id of Object.keys(PLAY_PRODUCTS)) expect(id).toMatch(/^[a-z0-9_]{1,40}$/);          // Play's rule for product ids
  });

  it('recognises plan ids and nothing else', () => {
    expect(isPlanId('founder')).toBe(true);
    expect(isSoldPlanId('founder')).toBe(false);
    expect(isSoldPlanId('lifetime')).toBe(true);
    for (const bad of ['', 'Pro', 'pro_monthly', 'toString', '__proto__', 'constructor', null, 5, {}]) expect(isPlanId(bad), String(bad)).toBe(false);
  });

  it('builds the entitlement the app holds', () => {
    expect(entitlementFor('pro-yearly', 'server', { token: 't', exp: 5 })).toEqual({ plan: 'pro', source: 'server', token: 't', exp: 5 });
    expect(entitlementFor('founder', 'gumroad')).toEqual({ plan: 'lifetime', founder: true, source: 'gumroad' });
    expect(entitlementFor('family-yearly', 'play')).toEqual({ plan: 'family', source: 'play' });
    expect(Object.keys(entitlementFor('lifetime', 'server'))).toEqual(['plan', 'source']);        // nothing set to undefined
  });

  it('gives a person with several purchases the best one', () => {
    expect(bestPlan([])).toBeNull();
    expect(bestPlan(['pro-monthly', 'lifetime', 'pro-yearly'])).toBe('lifetime');
    expect(bestPlan(['pro-yearly', 'family-yearly'])).toBe('family-yearly');
    expect(bestPlan(['lifetime', 'founder'])).toBe('founder');
  });
});

describe('the web offers', () => {
  const urls = { 'pro-monthly': 'https://shop.example/m', 'pro-yearly': 'https://shop.example/y', 'family-yearly': 'https://shop.example/f', lifetime: 'https://shop.example/l' };

  it('lists the plans that have a checkout address, in paywall order, family only when asked', () => {
    const cfg = webPlans({ checkout: urls });
    expect(cfg.offers.map((o) => o.id)).toEqual(['pro-monthly', 'pro-yearly', 'lifetime']);
    expect(webPlans({ checkout: urls, family: true }).offers.map((o) => o.id)).toEqual(['pro-monthly', 'pro-yearly', 'family-yearly', 'lifetime']);
  });

  it('shows list prices in dollars, the trial only where there is one, and features the yearly plan', () => {
    const [m, y, l] = webPlans({ checkout: urls }).offers;
    expect(m).toMatchObject({ plan: 'pro', period: 'month', price: { amount: 7.99, currency: 'USD' }, checkout: { web: 'https://shop.example/m' } });
    expect(m?.trialDays).toBeUndefined();
    expect(y).toMatchObject({ period: 'year', price: { amount: 39.99, currency: 'USD' }, trialDays: 7, featured: true });
    expect(l).toMatchObject({ plan: 'lifetime', period: 'once', price: { amount: 119.99, currency: 'USD' } });
    expect(webPlans({ checkout: urls, family: true }).offers[2]).toMatchObject({ plan: 'family', profiles: 6, devices: 4, trialDays: 7 });
  });

  it('offers nothing it cannot sell: no address, a plain http address or a script address', () => {
    expect(webPlans({ checkout: {} }).offers).toEqual([]);
    const bad = webPlans({ checkout: { 'pro-monthly': 'http://shop.example/m', 'pro-yearly': 'javascript:alert(1)', lifetime: '' } });
    expect(bad.offers).toEqual([]);
  });

  it('carries the trial state, and promises the reminder only where a trial applies', () => {
    expect(webPlans({ checkout: urls }).trialEligible).toBe(true);
    expect(webPlans({ checkout: urls, trialEligible: false }).trialEligible).toBe(false);
    expect(webPlans({ checkout: urls }).trialReminder).toBe(true);
    expect(webPlans({ checkout: urls, trialEligible: false }).trialReminder).toBe(false);
    expect(webPlans({ checkout: { 'pro-monthly': urls['pro-monthly'], lifetime: urls.lifetime } }).trialReminder).toBe(false);
    for (const o of webPlans({ checkout: urls }).offers) expect(o.checkout.play).toBeUndefined();
  });

  it('has the shape core/ui expects', () => {
    const cfg: PlansConfig = webPlans({ checkout: urls, family: true });
    expect(cfg.offers).toHaveLength(4);
  });
});

describe('the Play offers', () => {
  const details = (over: Partial<Record<string, Partial<PlayItemDetails>>> = {}): PlayItemDetails[] => [
    { itemId: 'bodyarcade_pro_monthly', price: { currency: 'EUR', value: '7.49' }, subscriptionPeriod: 'P1M', ...over['bodyarcade_pro_monthly'] },
    { itemId: 'bodyarcade_pro_yearly', price: { currency: 'EUR', value: '37.99' }, subscriptionPeriod: 'P1Y', freeTrialPeriod: 'P7D', ...over['bodyarcade_pro_yearly'] },
    { itemId: 'bodyarcade_lifetime', price: { currency: 'EUR', value: '109.99' }, ...over['bodyarcade_lifetime'] },
    { itemId: 'bodyarcade_family_yearly', price: { currency: 'EUR', value: '55.99' }, subscriptionPeriod: 'P1Y', ...over['bodyarcade_family_yearly'] },
  ];

  it('takes the price, the currency and the trial from Play, and the product id as the checkout', () => {
    const cfg = playPlans(details());
    expect(cfg.offers.map((o) => [o.id, o.price, o.trialDays, o.checkout])).toEqual([
      ['pro-monthly', { amount: 7.49, currency: 'EUR' }, undefined, { play: 'bodyarcade_pro_monthly' }],
      ['pro-yearly', { amount: 37.99, currency: 'EUR' }, 7, { play: 'bodyarcade_pro_yearly' }],
      ['lifetime', { amount: 109.99, currency: 'EUR' }, undefined, { play: 'bodyarcade_lifetime' }],
    ]);
    expect(cfg.trialEligible).toBe(true);
    expect(cfg.trialReminder).toBe(true);
  });

  it('says nothing about a trial when Play reports none for this buyer', () => {
    const cfg = playPlans(details({ bodyarcade_pro_yearly: { freeTrialPeriod: '' } }));
    expect(cfg.trialEligible).toBe(false);
    expect(cfg.trialReminder).toBe(false);
    expect(cfg.offers.every((o) => o.trialDays === undefined)).toBe(true);
    expect(playPlans(details({ bodyarcade_pro_yearly: { freeTrialPeriod: 'P1M' } })).offers[1]?.trialDays).toBe(30);
  });

  it('does not offer a product Play did not describe or described without a usable price', () => {
    expect(playPlans([]).offers).toEqual([]);
    const cfg = playPlans(details({ bodyarcade_lifetime: { price: { currency: 'EUR', value: '0' } }, bodyarcade_pro_monthly: { price: { currency: 'euro', value: '7' } } }));
    expect(cfg.offers.map((o) => o.id)).toEqual(['pro-yearly']);
    expect(playPlans(details({ bodyarcade_pro_yearly: { price: { currency: 'EUR', value: 'abc' } } })).offers.map((o) => o.id)).toEqual(['pro-monthly', 'lifetime']);
  });

  it('hides the family plan until it is asked for', () => {
    expect(playPlans(details()).offers.map((o) => o.id)).not.toContain('family-yearly');
    expect(playPlans(details(), { family: true }).offers.map((o) => o.id)).toContain('family-yearly');
  });

  it('contains no address and no web shop at all', () => {
    const text = JSON.stringify(playPlans(details(), { family: true })).toLowerCase();
    expect(text).not.toContain('gumroad');
    expect(text).not.toContain('http');
    expect(text).not.toContain('"web"');
    for (const o of playPlans(details()).offers) expect(Object.keys(o.checkout)).toEqual(['play']);
  });

  it('has the shape core/ui expects', () => {
    const cfg: PlansConfig = playPlans(details());
    expect(cfg.offers.length).toBeGreaterThan(0);
  });
});

describe('isoDays', () => {
  it('reads a trial length', () => {
    expect(isoDays('P7D')).toBe(7);
    expect(isoDays('P1W')).toBe(7);
    expect(isoDays('P2W3D')).toBe(17);
    expect(isoDays('P1M')).toBe(30);
    for (const bad of ['', 'P', 'PT1H', 'P1Y', '7 days', undefined]) expect(isoDays(bad as string | undefined), String(bad)).toBeNull();
  });
});
