// What the paywall may show, mode by mode. The rule that matters most is a negative one: outside the web there is no web
// shop anywhere in the model, whatever it was given.
import { describe, expect, it } from 'vitest';
import { PLAY_MANAGE_URL, paywallModel, type PaywallInputs, type PaywallMode } from './paywall.ts';
import type { PlayItemDetails } from './plans.ts';

const shop = { 'pro-monthly': 'https://dorukctn.gumroad.com/l/new-monthly', 'pro-yearly': 'https://dorukctn.gumroad.com/l/new-yearly', 'family-yearly': 'https://dorukctn.gumroad.com/l/new-family', lifetime: 'https://dorukctn.gumroad.com/l/new-lifetime' };
const details: PlayItemDetails[] = [
  { itemId: 'bodyarcade_pro_monthly', price: { currency: 'EUR', value: '7.49' }, subscriptionPeriod: 'P1M' },
  { itemId: 'bodyarcade_pro_yearly', price: { currency: 'EUR', value: '37.99' }, subscriptionPeriod: 'P1Y', freeTrialPeriod: 'P7D' },
  { itemId: 'bodyarcade_lifetime', price: { currency: 'EUR', value: '109.99' } },
];

describe('the web', () => {
  it('sells what has a shop page, with a key box for people who bought before', () => {
    const m = paywallModel('web', { checkout: shop });
    expect(m).toMatchObject({ mode: 'web', purchase: 'web-shop', keyEntry: { visible: true, wording: 'web' }, note: null, manageUrl: null });
    expect(m.plans.offers.map((o) => o.id)).toEqual(['pro-monthly', 'pro-yearly', 'lifetime']);
    expect(m.plans.offers.every((o) => typeof o.checkout.web === 'string' && o.checkout.play === undefined)).toBe(true);
  });

  it('says honestly that buying is not open while no product has a page yet', () => {
    expect(paywallModel('web')).toMatchObject({ purchase: 'none', note: 'unavailable', keyEntry: { visible: true } });
    expect(paywallModel('web', { checkout: { lifetime: 'http://insecure.example/x' } }).plans.offers).toEqual([]);
  });

  it('adds the family plan when it is asked for and carries the trial state', () => {
    expect(paywallModel('web', { checkout: shop, family: true }).plans.offers.map((o) => o.id)).toContain('family-yearly');
    expect(paywallModel('web', { checkout: shop, trialEligible: false }).plans.trialEligible).toBe(false);
  });
});

describe('Google Play', () => {
  it('sells through Play at Google\'s prices, with a neutral key box and the link to Play\'s subscription page', () => {
    const m = paywallModel('play', { details });
    expect(m).toMatchObject({ mode: 'play', purchase: 'play', keyEntry: { visible: true, wording: 'neutral' }, note: null, manageUrl: PLAY_MANAGE_URL });
    expect(m.plans.offers.map((o) => [o.id, o.price.currency, o.checkout.play])).toEqual([
      ['pro-monthly', 'EUR', 'bodyarcade_pro_monthly'], ['pro-yearly', 'EUR', 'bodyarcade_pro_yearly'], ['lifetime', 'EUR', 'bodyarcade_lifetime'],
    ]);
    expect(m.plans.trialEligible).toBe(true);
    expect(PLAY_MANAGE_URL).toBe('https://play.google.com/store/account/subscriptions?package=com.peakapps.bodyarcade');
  });

  it('offers nothing until Google has described the products, and says so', () => {
    expect(paywallModel('play')).toMatchObject({ purchase: 'none', note: 'unavailable', keyEntry: { visible: true } });
  });
});

describe('the app that cannot sell, and the moment before the proof', () => {
  it('play-unsupported has no offers, an honest note and the key box', () => {
    expect(paywallModel('play-unsupported', { details, checkout: shop })).toMatchObject({ purchase: 'none', note: 'play-only', keyEntry: { visible: true, wording: 'neutral' }, plans: { offers: [] }, manageUrl: null });
  });

  it('neutral shows nothing to buy and no key box yet', () => {
    expect(paywallModel('neutral', { details, checkout: shop })).toMatchObject({ purchase: 'none', note: 'checking', keyEntry: { visible: false }, plans: { offers: [] } });
  });
});

describe('outside the web there is no web shop, whatever it was given', () => {
  const everything: PaywallInputs = { checkout: shop, details, family: true, trialEligible: true };
  const strings = (x: unknown, out: string[] = []): string[] => {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) for (const v of x) strings(v, out);
    else if (typeof x === 'object' && x !== null) for (const [k, v] of Object.entries(x)) { out.push(k); strings(v, out); }
    return out;
  };

  it.each(['play', 'play-unsupported', 'neutral'] as PaywallMode[])('%s: not a word about Gumroad, no web address but Play\'s own page', (mode) => {
    const model = paywallModel(mode, everything);
    const all = strings(model);
    expect(all.some((s) => /gumroad/i.test(s))).toBe(false);
    expect(all.filter((s) => /^https?:/i.test(s))).toEqual(mode === 'play' ? [PLAY_MANAGE_URL] : []);
    for (const o of model.plans.offers) expect(Object.keys(o.checkout)).toEqual(['play']);
    expect(all).not.toContain('web');
    expect(all).not.toContain('web-shop');
  });

  it('only the web ever carries a shop address', () => {
    expect(strings(paywallModel('web', everything)).some((s) => /gumroad/i.test(s))).toBe(true);
  });
});
