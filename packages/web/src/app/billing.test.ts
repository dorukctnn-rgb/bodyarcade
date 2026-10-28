// What the paywall gets from the entitlements: the real one on a pretend server and a pretend browser window, the practice
// one that development and test builds use, and the two stand-ins for the moment before the real one has answered.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootEntitlements, type BootWindow } from '../../../core/entitlements/boot.ts';
import { checkoutOf, GUMROAD_CHECKOUT, placeholdersIn, type GumroadListing } from '../../../core/entitlements/catalog.ts';
import { paywallModel } from '../../../core/entitlements/paywall.ts';
import { PLANS, SOLD_PLAN_IDS, playProductOf, type PlayItemDetails, type SoldPlanId } from '../../../core/entitlements/plans.ts';
import { Clock, FakeServer, makeKeys } from '../../../core/entitlements/testkit.ts';
import { createStore, memoryStorage } from '../../../core/store/store.ts';
import { createPlayDetails, pendingBilling, practiceBilling, PREVIEW_CHECKOUT, realBilling, withPreviewOffers } from './billing.ts';

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

});

// ---- Google Play's products on a cold start (28 Oct phone test: the first open showed "Pro cannot be bought here right now") ----------

const PRODUCTS: PlayItemDetails[] = SOLD_PLAN_IDS.map((id) => ({
  itemId: playProductOf(id),
  price: { currency: 'TRY', value: String(PLANS[id].price) },
  ...(id === 'pro-yearly' ? { freeTrialPeriod: 'P7D' } : {}),
}));

/** The Digital Goods service of a phone: each call is answered by the script, and the calls are counted. */
function digitalGoods(script: (call: number) => Promise<PlayItemDetails[]> | PlayItemDetails[]) {
  const seen = { calls: 0 };
  return { seen, mode: 'play' as const, service: { getDetails: async (_ids: string[]) => script(++seen.calls), listPurchases: async () => [] } };
}
const never = (): Promise<PlayItemDetails[]> => new Promise(() => undefined);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** What the Pro page is given by the real billing in the Android app while Google is asked (the paywall model of mode 'play'). */
const proPage = (loader: ReturnType<typeof createPlayDetails>) => realBilling(
  { paywall: (inputs) => paywallModel('play', { family: true, ...inputs }), trial: pendingBilling('checking').trial },
  { family: true, details: loader },
).paywall();

describe("Google Play's products: the looks do not end with one slow or empty answer", () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a first answer that takes longer than its wait is not the end: the Pro page says it is checking, and shows the plans once they come', async () => {
    vi.useFakeTimers();
    const dg = digitalGoods((n) => (n === 1 ? never() : PRODUCTS));        // the cold connection: nothing for the first ask, fine for the next
    const loader = createPlayDetails(dg);
    const changes = vi.fn();
    loader.onChange(changes);
    await tick(3000);                                                      // the old code had settled on "nothing" at 2.5 s and never asked again
    expect(loader.status()).toBe('loading');
    expect(proPage(loader).info).toMatchObject({ mode: 'play', note: 'checking' });
    expect(proPage(loader).plans.offers).toEqual([]);
    await tick(2500);                                                      // first wait over at 4 s, second ask at 5 s
    expect(dg.seen.calls).toBe(2);
    expect(loader.status()).toBe('ready');
    expect(changes).toHaveBeenCalledTimes(1);                              // the page is drawn again once, with the plans
    const page = proPage(loader);
    expect(page.info.note).toBeNull();
    expect(page.plans.offers.map((o) => o.checkout.play)).toEqual(PRODUCTS.map((p) => p.itemId));
    expect(vi.getTimerCount()).toBe(0);                                    // nothing keeps asking once the products are there
    loader.dispose();
  });

  it('a late answer to the first ask is taken even after the next ask has started', async () => {
    vi.useFakeTimers();
    let late: (d: PlayItemDetails[]) => void = () => undefined;
    const dg = digitalGoods((n) => (n === 1 ? new Promise<PlayItemDetails[]>((r) => { late = r; }) : never()));
    const loader = createPlayDetails(dg);
    await tick(6000);
    expect(dg.seen.calls).toBe(2);
    expect(loader.status()).toBe('loading');
    late(PRODUCTS);
    await tick(0);
    expect(loader.status()).toBe('ready');
    expect(loader.get()).toEqual(PRODUCTS);
    loader.dispose();
  });

  it('an empty or failed answer is asked again with growing pauses, and "cannot be bought" comes only after the last look', async () => {
    vi.useFakeTimers();
    const dg = digitalGoods((n) => { if (n === 2) throw new Error('service not connected'); return []; });
    const loader = createPlayDetails(dg);
    const changes = vi.fn();
    loader.onChange(changes);
    await tick(0);
    expect(dg.seen.calls).toBe(1);
    await tick(1000);                                                      // pauses of 1 s, 2.5 s and 5 s: looks at 0, 1, 3.5 and 8.5 s
    expect(dg.seen.calls).toBe(2);
    await tick(2500);
    expect(dg.seen.calls).toBe(3);
    await tick(4900);
    expect(dg.seen.calls).toBe(3);
    expect(proPage(loader).info.note).toBe('checking');                    // still not a verdict
    expect(changes).not.toHaveBeenCalled();
    await tick(200);
    expect(dg.seen.calls).toBe(4);
    expect(loader.status()).toBe('none');
    expect(proPage(loader).info.note).toBe('unavailable');
    expect(proPage(loader).plans.offers).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(1);                              // drawn again once, now with the honest note
    await tick(60_000);
    expect(dg.seen.calls).toBe(4);                                         // and then it leaves Google alone
    loader.dispose();
  });

  it('when the Pro page opens (or the app comes back to the front) after the looks ended, it looks again and finds the plans', async () => {
    vi.useFakeTimers();
    let healthy = false;
    const dg = digitalGoods(() => (healthy ? PRODUCTS : []));
    const loader = createPlayDetails(dg);
    const changes = vi.fn();
    loader.onChange(changes);
    await tick(10_000);
    expect(loader.status()).toBe('none');
    const asked = dg.seen.calls;
    healthy = true;
    expect(loader.refresh()).toBe(true);                                   // the page is drawn next: it says "checking" for this look
    expect(loader.status()).toBe('loading');
    expect(proPage(loader).info.note).toBe('checking');
    expect(loader.refresh()).toBe(false);                                  // a second call while a look runs asks nothing more
    await tick(0);
    expect(dg.seen.calls).toBe(asked + 1);
    expect(loader.status()).toBe('ready');
    expect(proPage(loader).plans.offers).toHaveLength(SOLD_PLAN_IDS.length);
    expect(changes).toHaveBeenCalledTimes(2);                              // the end of the first looks, and the products
    expect(loader.refresh()).toBe(false);                                  // with the plans there Google is not asked again
    await tick(60_000);
    expect(dg.seen.calls).toBe(asked + 1);
    loader.dispose();
  });

  it('a look that ends empty again leaves the page honest, and the next open can look once more', async () => {
    vi.useFakeTimers();
    const dg = digitalGoods(() => []);
    const loader = createPlayDetails(dg);
    await tick(10_000);
    expect(loader.refresh()).toBe(true);
    await tick(10_000);
    expect(loader.status()).toBe('none');
    expect(dg.seen.calls).toBe(8);
    expect(loader.refresh()).toBe(true);
    loader.dispose();
  });

  it('keeps only what it asked for and can show: a product that is not ours, or one without a price, is not "ready"', async () => {
    vi.useFakeTimers();
    const junk = [{ itemId: 'someone_elses_product', price: { currency: 'USD', value: '1.00' } }, { itemId: 'bodyarcade_lifetime' }] as unknown as PlayItemDetails[];
    const dg = digitalGoods(() => junk);
    const loader = createPlayDetails(dg);
    await tick(10_000);
    expect(loader.status()).toBe('none');
    expect(loader.get()).toEqual([]);
    expect(proPage(loader).info.note).toBe('unavailable');                // and the paywall never meets a product without a price
    loader.dispose();
  });

  it('never throws and never leaves a timer behind: a service that throws at once, one that returns garbage, one that is missing', async () => {
    vi.useFakeTimers();
    const throwing = createPlayDetails({ mode: 'play', service: { getDetails: () => { throw new Error('sync'); }, listPurchases: async () => [] } });
    const garbage = createPlayDetails(digitalGoods(() => 'nonsense' as unknown as PlayItemDetails[]));
    await tick(30_000);
    expect(throwing.status()).toBe('none');
    expect(garbage.status()).toBe('none');
    const missing = createPlayDetails({ mode: 'play', service: null });
    expect(missing.status()).toBe('none');
    expect(missing.refresh()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the web is untouched: nothing is asked, no timer runs, the status is "none" and the web paywall never says "checking"', async () => {
    vi.useFakeTimers();
    const dg = digitalGoods(() => PRODUCTS);
    const loader = createPlayDetails({ mode: 'web', service: dg.service });
    expect(loader.status()).toBe('none');
    expect(loader.refresh()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await tick(30_000);
    expect(dg.seen.calls).toBe(0);
    const web = realBilling({ paywall: (inputs) => paywallModel('web', { checkout: {}, ...inputs }), trial: pendingBilling('checking').trial }, { family: true, details: loader }).paywall();
    expect(web.info).toMatchObject({ mode: 'web', note: 'unavailable' });
    // and the old shape of the options still works for a caller that only has a list
    expect(realBilling({ paywall: (inputs) => paywallModel('play', inputs), trial: pendingBilling('checking').trial }, { family: true, details: () => PRODUCTS }).paywall().plans.offers).toHaveLength(SOLD_PLAN_IDS.length);
  });

  it('a listener that breaks does not stop the others, and a disposed loader is silent', async () => {
    vi.useFakeTimers();
    const loader = createPlayDetails(digitalGoods(() => PRODUCTS));
    loader.onChange(() => { throw new Error('a listener that breaks'); });
    const second = vi.fn();
    loader.onChange(second);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await tick(0);
    expect(second).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
    const gone = createPlayDetails(digitalGoods(() => PRODUCTS));
    const heard = vi.fn();
    gone.onChange(heard);
    gone.dispose();
    await tick(60_000);
    expect(heard).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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
