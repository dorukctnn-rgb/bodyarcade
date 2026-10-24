// bootEntitlements: the page that is running decides which providers exist. In the Android app Gumroad does not exist at
// all, not even as a request.
import { beforeAll, describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '../store/index.ts';
import { API } from './api.ts';
import { bootEntitlements, type BootWindow } from './boot.ts';
import { PLAY_BILLING_URL } from './billing-env.ts';
import { GUMROAD_CHECKOUT } from './catalog.ts';
import type { DigitalGoodsService, PaymentRequestLike } from './providers/play.ts';
import { DAY, DID_1, FakeGumroad, FakeServer, KEY_A, START, Clock, makeKeys, type Keys } from './testkit.ts';

let keys: Keys;
beforeAll(async () => { keys = await makeKeys(); });
const MONTHLY = 'tN-xTHwaZm8bOdcHHBaKbQ==';
const hex = (): Uint8Array => Uint8Array.from(DID_1.match(/../g) as string[], (h) => parseInt(h, 16));

function pieces() {
  const clock = new Clock();
  const server = new FakeServer(keys, clock);
  const gumroad = new FakeGumroad();
  // One fetch for both worlds, routed by address, as the real network would.
  const fetch = (url: string, init?: RequestInit): Promise<Response> => (url.includes('gumroad.com') ? gumroad.fetch(url, init) : server.fetch(url, init));
  const store = createStore({ storage: memoryStorage(), now: clock.now });
  return { clock, server, gumroad, fetch, store };
}

const browserWindow = (): BootWindow => ({ location: { search: '' }, document: { referrer: '' } });

describe('in a browser', () => {
  it('has our server and, behind it, Gumroad; no Android calls on the port; the web paywall', async () => {
    const p = pieces();
    p.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: browserWindow(), fetch: p.fetch, now: p.clock.now, legacyStorage: null, autoRefresh: false });
    expect(boot.env.mode).toBe('web');
    expect(boot.service.hasProvider('server')).toBe(true);
    expect(boot.service.hasProvider('gumroad')).toBe(true);
    expect(boot.service.hasProvider('play')).toBe(false);
    expect(boot.port.purchase).toBeUndefined();
    expect(await boot.port.activate(KEY_A)).toEqual({ ok: true, plan: 'pro' });
    const m = boot.paywall({ checkout: { 'pro-monthly': 'https://shop.example/m' } });
    expect(m).toMatchObject({ mode: 'web', purchase: 'web-shop' });
    expect(m.plans.trialEligible).toBe(false);                               // this device has had Pro: no new trial
  });

  it('carries the live site\'s licence over by itself', async () => {
    const p = pieces();
    p.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active' });
    const live = memoryStorage({ ba_license: JSON.stringify({ key: KEY_A, product: 'pro', verifiedAt: START - 3 * DAY, email: 'bu…@example.com' }) });
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: browserWindow(), fetch: p.fetch, now: p.clock.now, legacyStorage: live, autoRefresh: false });
    expect(boot.service.current()).toMatchObject({ plan: 'pro', source: 'server' });
    expect(live.getItem('ba_license')).not.toBeNull();                       // the live site's key is left exactly where it was
  });

  it('keeps the trial promise: the notice in the last two days and the box for the one e-mail', async () => {
    const p = pieces();
    p.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active', trialEnd: p.clock.now() + 7 * DAY });
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: browserWindow(), fetch: p.fetch, now: p.clock.now, legacyStorage: null, autoRefresh: false });
    expect(await boot.trial.view()).toMatchObject({ trialEnds: null, email: 'none', notice: null });   // no purchase yet
    expect(await boot.port.activate(KEY_A)).toEqual({ ok: true, plan: 'pro' });
    expect(await boot.trial.view()).toMatchObject({ email: 'offer', notice: null });
    expect(await boot.trial.setEmail('alice@example.com', 'en')).toEqual({ ok: true, sendAt: p.clock.now() + 5 * DAY });
    p.clock.advance(5 * DAY + 3_600_000);
    expect(boot.trial.notice()).toMatchObject({ where: 'web', cancelled: false, dayOffset: 2 });
    expect(await boot.trial.view()).toMatchObject({ email: 'set', masked: 'a***@example.com' });
  });

  it('offers the plans of the catalog of the repository at their Gumroad addresses, and keeps Family off the page until the shell asks for it', async () => {
    const p = pieces();
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: browserWindow(), fetch: p.fetch, now: p.clock.now, legacyStorage: null, autoRefresh: false });
    const sold = Object.keys(GUMROAD_CHECKOUT);                              // the plans that have a real address today, in the order of the paywall
    const shown = boot.paywall();
    expect(shown.plans.offers.map((o) => o.id)).toEqual(sold.filter((id) => id !== 'family-yearly'));
    for (const o of shown.plans.offers) expect(o.checkout.web, o.id).toBe(GUMROAD_CHECKOUT[o.id]);
    expect(boot.paywall({ family: false }).plans.offers.some((o) => o.id === 'family-yearly')).toBe(false);
    expect(boot.paywall({ family: true }).plans.offers.map((o) => o.id)).toEqual(sold);
    // and the trial is promised only where there is one: Pro yearly, never Family
    expect(boot.paywall({ family: true }).plans.offers.filter((o) => o.trialDays !== undefined).map((o) => o.id)).toEqual(sold.filter((id) => id === 'pro-yearly'));
  });

  it('offers nothing and says so when no plan has an address (the day before the products exist): the key box stays', async () => {
    const p = pieces();
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: browserWindow(), fetch: p.fetch, now: p.clock.now, legacyStorage: null, autoRefresh: false, checkout: {} });
    const m = boot.paywall({ family: true });
    expect(m).toMatchObject({ mode: 'web', purchase: 'none', note: 'unavailable', keyEntry: { visible: true, wording: 'web' } });
    expect(m.plans.offers).toEqual([]);
    expect(boot.paywall({ checkout: { lifetime: 'https://dorukctn.gumroad.com/l/x' } }).plans.offers.map((o) => o.id)).toEqual(['lifetime']);   // what the caller passes wins
  });

  it('works without a window at all (the page generator, a test)', async () => {
    const p = pieces();
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], fetch: p.fetch, now: p.clock.now, legacyStorage: null, autoRefresh: false, window: undefined as unknown as BootWindow });
    expect(boot.env.mode === 'web' || boot.env.hint === 'none').toBe(true);
  });
});

describe('in the Android app', () => {
  const service: DigitalGoodsService = {
    getDetails: async (ids) => ids.map((itemId) => ({ itemId, price: { currency: 'EUR', value: '9.99' }, ...(itemId === 'bodyarcade_pro_yearly' ? { freeTrialPeriod: 'P7D' } : {}) })),
    listPurchases: async () => [],
  };
  class FakePayment implements PaymentRequestLike {
    static sku = '';
    constructor(methods: unknown, _details: unknown) { FakePayment.sku = String((methods as { data: { sku: string } }[])[0]?.data.sku); }
    async show() { return { details: { purchaseToken: 'purchase-token-aaaaaaaaaaaaaaaaaaaa' }, complete: async () => undefined }; }
  }
  const appWindow = (over: Partial<BootWindow> = {}): BootWindow => ({
    location: { search: '?src=twa' }, document: { referrer: '' }, sessionStorage: null,
    getDigitalGoodsService: async (u: string) => { expect(u).toBe(PLAY_BILLING_URL); return service; },
    PaymentRequest: FakePayment, ...over,
  });

  it('has our server and Google Play and never Gumroad, not even to look a key up', async () => {
    const p = pieces();
    p.server.playPurchases.set('purchase-token-aaaaaaaaaaaaaaaaaaaa', { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'active' });
    p.gumroad.add(MONTHLY, KEY_A);                                           // a key that Gumroad would accept
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: appWindow(), fetch: p.fetch, now: p.clock.now, autoRefresh: false });
    expect(boot.env.mode).toBe('play');
    expect(boot.service.hasProvider('gumroad')).toBe(false);
    expect(boot.service.hasProvider('play')).toBe(true);
    expect(await boot.port.activate(KEY_A)).toMatchObject({ ok: false });    // not in our server's table: "not found", and Gumroad is not consulted
    expect(p.gumroad.calls).toHaveLength(0);
    expect(typeof boot.port.purchase).toBe('function');
    expect(await boot.port.purchase?.('bodyarcade_pro_yearly')).toBe(true);
    expect(FakePayment.sku).toBe('bodyarcade_pro_yearly');
    expect(boot.port.plan()).toBe('pro');
    expect(p.gumroad.calls).toHaveLength(0);
  });

  it('asks for no address and calls no reminder route: Google Play sends its own reminder', async () => {
    const p = pieces();
    p.server.playPurchases.set('purchase-token-aaaaaaaaaaaaaaaaaaaa', { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'active', trialEnd: p.clock.now() + 7 * DAY });
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: appWindow(), fetch: p.fetch, now: p.clock.now, autoRefresh: false });
    expect(await boot.port.purchase?.('bodyarcade_pro_yearly')).toBe(true);
    p.clock.advance(6 * DAY);
    const v = await boot.trial.view();
    expect(v.email).toBe('none');
    expect(v.notice).toMatchObject({ where: 'play', dayOffset: 1 });         // the notice itself is still kept, naming Play
    expect(await boot.trial.setEmail('alice@example.com', 'en')).toEqual({ ok: false, code: 'not_offered' });
    expect(p.server.calls.filter((c) => c.path === API.reminder || c.path === API.key)).toEqual([]);
    expect(p.gumroad.calls).toHaveLength(0);
  });

  it('does not read the live site\'s licence (no Gumroad in the app)', async () => {
    const p = pieces();
    let read = false;
    const live = { getItem: () => { read = true; return null; }, setItem: () => undefined, removeItem: () => undefined };
    await bootEntitlements({ store: p.store, keys: [keys.pub], window: appWindow(), fetch: p.fetch, now: p.clock.now, legacyStorage: live, autoRefresh: false });
    expect(read).toBe(false);
  });

  it('offers what Google describes, and nothing that names another shop', async () => {
    const p = pieces();
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: appWindow(), fetch: p.fetch, now: p.clock.now, autoRefresh: false });
    const details = await (boot.service.hasProvider('play') ? service.getDetails(['bodyarcade_pro_monthly', 'bodyarcade_pro_yearly', 'bodyarcade_lifetime']) : Promise.resolve([]));
    const m = boot.paywall({ details, checkout: { lifetime: 'https://dorukctn.gumroad.com/l/x' } });
    expect(m.mode).toBe('play');
    expect(m.plans.offers).toHaveLength(3);
    expect(JSON.stringify(m)).not.toMatch(/gumroad/i);
    expect(m.plans.trialEligible).toBe(true);
  });

  it('an app whose Play service does not answer can sell nothing, says so, and has no Play provider and no Gumroad', async () => {
    const p = pieces();
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: appWindow({ getDigitalGoodsService: async () => { throw new Error('unsupported'); } }), fetch: p.fetch, now: p.clock.now, autoRefresh: false });
    expect(boot.env.mode).toBe('play-unsupported');
    expect(boot.service.hasProvider('gumroad')).toBe(false);
    expect(boot.service.hasProvider('play')).toBe(false);
    expect(boot.port.purchase).toBeUndefined();
    expect(boot.paywall()).toMatchObject({ mode: 'play-unsupported', note: 'play-only', purchase: 'none' });
  });

  it('a Play service without the payment request API cannot sell either', async () => {
    const p = pieces();
    const boot = await bootEntitlements({ store: p.store, keys: [keys.pub], window: appWindow({ PaymentRequest: undefined }), fetch: p.fetch, now: p.clock.now, autoRefresh: false });
    expect(boot.service.hasProvider('play')).toBe(false);
  });
});
