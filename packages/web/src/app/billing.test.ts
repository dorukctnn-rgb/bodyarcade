// What the paywall gets from the entitlements: the real one on a pretend server and a pretend browser window, the practice
// one that development and test builds use, and the two stand-ins for the moment before the real one has answered.
import { describe, expect, it } from 'vitest';
import { bootEntitlements, type BootWindow } from '../../../core/entitlements/boot.ts';
import { checkoutOf, GUMROAD_CHECKOUT, placeholdersIn, type GumroadListing } from '../../../core/entitlements/catalog.ts';
import { SOLD_PLAN_IDS, type SoldPlanId } from '../../../core/entitlements/plans.ts';
import { Clock, FakeServer, makeKeys } from '../../../core/entitlements/testkit.ts';
import { createStore, memoryStorage } from '../../../core/store/store.ts';
import { loadPlayDetails, pendingBilling, practiceBilling, PREVIEW_CHECKOUT, realBilling, withPreviewOffers } from './billing.ts';

const HOUR = 3_600_000;
const win = (search = ''): BootWindow => ({ location: { search, hostname: 'bodyarcade.test' }, document: { referrer: '' }, sessionStorage: null });

async function bootOnTestServer(search = '') {
  const clock = new Clock();
  const keys = await makeKeys();
  const server = new FakeServer(keys, clock);
  const boot = await bootEntitlements({ store: createStore({ storage: memoryStorage() }), keys: [keys.pub], window: win(search), fetch: server.fetch, now: clock.now, autoRefresh: false, legacyStorage: null });
  return { boot, clock, server };
}

describe('the real billing', () => {
  it('takes its links from the Gumroad catalogue and from nowhere else: the plans that have a real link, with that link', async () => {
    const { boot } = await bootOnTestServer();
    const { plans, info } = realBilling(boot, { family: true, details: () => [] }).paywall();
    const real = SOLD_PLAN_IDS.filter((id) => GUMROAD_CHECKOUT[id] !== undefined);
    expect(plans.offers.map((o) => o.id)).toEqual(real);
    for (const o of plans.offers) expect(o.checkout, o.id).toEqual({ web: GUMROAD_CHECKOUT[o.id] });
    // a placeholder of the catalogue never reaches the page; where nothing is real yet the page says so honestly and keeps the key box
    for (const o of plans.offers) expect(o.checkout.web, o.id).toMatch(/^https:\/\/[a-z0-9-]+\.gumroad\.com\//);
    expect(info).toMatchObject({ mode: 'web', note: real.length === 0 ? 'unavailable' : null, preview: false, manageUrl: null, keyEntry: { visible: true, wording: 'web' } });
    boot.service.dispose();
  });

  it('Family stays off the page until the shell sells it, whatever the catalogue holds', async () => {
    const { boot } = await bootOnTestServer();
    expect(realBilling(boot, { family: false, details: () => [] }).paywall().plans.offers.map((o) => o.id)).not.toContain('family-yearly');
    boot.service.dispose();
  });

  it('a catalogue that still holds placeholders offers nothing, and a real link is told from a placeholder or a typo', () => {
    const placeholders = Object.fromEntries(SOLD_PLAN_IDS.map((id) => [id, { productId: '<GUMROAD_PRODUCT_ID>', checkout: '<GUMROAD_CHECKOUT>' }])) as Record<SoldPlanId, GumroadListing>;
    expect(checkoutOf(placeholders)).toEqual({});
    expect(placeholdersIn(placeholders)).toHaveLength(SOLD_PLAN_IDS.length * 2);
    expect(checkoutOf({ ...placeholders, lifetime: { productId: 'abcdefgh12345678', checkout: 'https://someone.gumroad.com/l/x' } })).toEqual({ lifetime: 'https://someone.gumroad.com/l/x' });
    expect(checkoutOf({ ...placeholders, lifetime: { productId: 'abcdefgh12345678', checkout: 'https://evil.example/l/x' } })).toEqual({});
  });

  it('hands the trial of the entitlements through as it is', async () => {
    const { boot } = await bootOnTestServer();
    const b = realBilling(boot, { family: false, details: () => [] });
    expect(b.trial).toBe(boot.trial);
    expect(b.trial.notice()).toBeNull();
    boot.service.dispose();
  });

  it('inside the Android app with a strong hint but no Play, nothing is sold and the page says to update Chrome', async () => {
    const { boot } = await bootOnTestServer('?src=twa');
    const b = realBilling(boot, { family: true, details: () => [] });
    expect(boot.env.mode).toBe('play-unsupported');
    expect(b.paywall().plans.offers).toEqual([]);
    expect(b.paywall().info).toMatchObject({ mode: 'play-unsupported', note: 'play-only', manageUrl: null });
    boot.service.dispose();
  });

  it('asks Google Play for its products once and never throws, with or without an answer', async () => {
    const answer = [{ itemId: 'bodyarcade_pro_yearly', price: { currency: 'EUR', value: '39.99' } }];
    const service = { getDetails: async (ids: string[]) => { expect(ids).toContain('bodyarcade_pro_monthly'); return answer; }, listPurchases: async () => [] };
    expect(await loadPlayDetails({ mode: 'play', service })).toEqual(answer);
    expect(await loadPlayDetails({ mode: 'web', service: null })).toEqual([]);
    expect(await loadPlayDetails({ mode: 'play', service: { getDetails: async () => { throw new Error('no'); }, listPurchases: async () => [] } })).toEqual([]);
    expect(await loadPlayDetails({ mode: 'play', service: { getDetails: () => new Promise(() => undefined), listPurchases: async () => [] } }, 20)).toEqual([]);
  });
});

describe('made-up offers', () => {
  it('a build made to look at the design gets four preview plans where the real ones are missing, and the buy button knows it', async () => {
    const { boot } = await bootOnTestServer();
    // the real boot on a catalogue with no real link yet (whatever the catalogue holds today)
    const real = realBilling({ ...boot, paywall: (i) => boot.paywall({ ...i, checkout: {} }) }, { family: false, details: () => [] });
    expect(real.paywall().plans.offers).toEqual([]);
    const { plans, info } = withPreviewOffers(real).paywall();
    expect(plans.offers.map((o) => o.id)).toEqual(['pro-monthly', 'pro-yearly', 'family-yearly', 'lifetime']);
    expect(info.preview).toBe(true);
    expect(info.note).toBeNull();
    for (const o of plans.offers) expect(o.checkout.web, o.id).toBe(PREVIEW_CHECKOUT[o.id]);
    boot.service.dispose();
  });

  it('real offers are never replaced, and the Android app is never given web offers', () => {
    const real = practiceBilling();
    const live = { trial: real.trial, paywall: () => ({ plans: real.paywall().plans, info: { ...real.paywall().info, preview: false } }) };
    expect(withPreviewOffers(live).paywall().info.preview).toBe(false);
    const play = pendingBilling('unavailable');
    const inPlay = { trial: play.trial, paywall: () => { const p = play.paywall(); return { plans: p.plans, info: { ...p.info, mode: 'play' as const } }; } };
    expect(withPreviewOffers(inPlay).paywall().plans.offers).toEqual([]);
  });

  it('the practice billing is a preview in every way: four offers, none with an address that exists', () => {
    const { plans, info } = practiceBilling().paywall();
    expect(plans.offers).toHaveLength(4);
    expect(info.preview).toBe(true);
    for (const o of plans.offers) expect(o.checkout.web, o.id).toMatch(/^https:\/\/checkout\.invalid\//);
    expect(plans.offers.find((o) => o.id === 'pro-yearly')?.trialDays).toBe(7);
    expect(plans.offers.find((o) => o.id === 'family-yearly')?.trialDays).toBeUndefined();
  });

  it('a player who used a trial already is offered none in the practice billing either', () => {
    expect(practiceBilling({ trialEligible: false }).paywall().plans).toMatchObject({ trialEligible: false, trialReminder: false });
  });
});

describe('before the real billing has answered', () => {
  it('"checking" is neutral and has no key box; "unavailable" says so and keeps the key box', () => {
    const c = pendingBilling('checking').paywall();
    expect(c.plans.offers).toEqual([]);
    expect(c.info).toMatchObject({ mode: 'neutral', note: 'checking', keyEntry: { visible: false } });
    const u = pendingBilling('unavailable').paywall();
    expect(u.info).toMatchObject({ mode: 'web', note: 'unavailable', keyEntry: { visible: true } });
  });

  it('has no trial and takes no e-mail address', async () => {
    const t = pendingBilling('checking').trial;
    expect(t.notice()).toBeNull();
    expect((await t.view()).trialEnds).toBeNull();
    expect(await t.setEmail('a@example.com', 'en')).toEqual({ ok: false, code: 'not_offered' });
    expect(await t.clearEmail()).toEqual({ ok: true, sendAt: null });
  });
});

describe('the practice trial', () => {
  // 24 October 2026, noon in UTC; the notice counts its days in UTC so the answer is the same on every machine
  const at = (hours: number, more: Parameters<typeof practiceBilling>[0] = {}) => {
    let now = Date.UTC(2026, 9, 24, 12);
    const b = practiceBilling({ now: () => now, timeZone: 'UTC', trial: { endsInMs: hours * HOUR }, ...more });
    return { b, move: (h: number) => { now += h * HOUR; } };
  };

  it('has no notice before the last two days, then names the day, and none after it has ended', () => {
    const { b, move } = at(100);                           // ends on the 28th at 16:00
    expect(b.trial.notice()).toBeNull();
    move(40);                                              // 60 hours left on the 26th
    expect(b.trial.notice()).toBeNull();
    move(20);                                              // 40 hours left, on the 27th
    expect(b.trial.notice()).toMatchObject({ dayOffset: 1, where: 'web', cancelled: false });
    move(25);                                              // 15 hours left, on the 28th: the day the trial ends
    expect(b.trial.notice()).toMatchObject({ dayOffset: 0 });
    move(20);                                              // over
    expect(b.trial.notice()).toBeNull();
  });

  it('says Google Play for a Play purchase and "cancelled" when it was cancelled', () => {
    expect(at(30, { trial: { endsInMs: 30 * HOUR, where: 'play' } }).b.trial.notice()).toMatchObject({ where: 'play' });
    expect(at(30, { trial: { endsInMs: 30 * HOUR, cancelled: true } }).b.trial.notice()).toMatchObject({ cancelled: true });
  });

  it('takes one e-mail address, keeps only the masked form, and gives it back', async () => {
    const { b } = at(30);
    const v0 = await b.trial.view();
    expect(v0).toMatchObject({ email: 'offer', masked: null, sendAt: null });
    expect(await b.trial.setEmail('not an address', 'en')).toEqual({ ok: false, code: 'bad_email' });
    const saved = await b.trial.setEmail('alice@example.com', 'en');
    expect(saved.ok).toBe(true);
    const v1 = await b.trial.view();
    expect(v1).toMatchObject({ email: 'set', masked: 'a***@example.com' });
    expect(v1.sendAt).toBe((v1.trialEnds as number) - 2 * 86_400_000);
    expect(JSON.stringify(v1)).not.toContain('alice');
    expect(await b.trial.clearEmail()).toEqual({ ok: true, sendAt: null });
    expect(await b.trial.view()).toMatchObject({ email: 'offer', masked: null });
  });

  it('offers no box in Google Play, for a cancelled membership, or when the server has no mail service', async () => {
    for (const trial of [{ endsInMs: 30 * HOUR, where: 'play' as const }, { endsInMs: 30 * HOUR, cancelled: true }, { endsInMs: 30 * HOUR, email: 'none' as const }]) {
      const { b } = at(30, { trial });
      expect((await b.trial.view()).email).toBe('none');
      expect(await b.trial.setEmail('alice@example.com', 'en')).toEqual({ ok: false, code: 'not_offered' });
    }
  });

  it('has no trial at all unless one is placed', async () => {
    const b = practiceBilling();
    expect(b.trial.notice()).toBeNull();
    expect((await b.trial.view()).trialEnds).toBeNull();
  });
});
