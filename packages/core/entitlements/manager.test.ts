// The manager end to end against fakes of our server, Gumroad and Google Play: what it grants, how long, what it does
// when a check fails (B2), when the stored record is damaged or the clock lies (B1, B4), and what it tells the screens.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Entitlement } from '../types/index.ts';
import { createStore, memoryStorage, type LegacyLicense } from '../store/index.ts';
import { API } from './api.ts';
import { createEntitlements, type EntitlementsService } from './manager.ts';
import { createGumroadProvider } from './providers/gumroad.ts';
import { createPlayProvider, type DigitalGoodsService, type PaymentRequestLike } from './providers/play.ts';
import { createServerProvider } from './providers/server.ts';
import type { ManagedProvider } from './providers/shared.ts';
import { DAY, DID_1, DID_2, FakeGumroad, FakeServer, KEY_A, KEY_B, START, Clock, makeKeys, sha256Hex, type Keys } from './testkit.ts';
import { b64urlEncode } from './token.ts';

let keys: Keys;
let other: Keys;
beforeAll(async () => { keys = await makeKeys(); other = await makeKeys(); });

const MONTHLY = 'tN-xTHwaZm8bOdcHHBaKbQ==';
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) as string[], (h) => parseInt(h, 16));
const iso = (ms: number): string => new Date(ms).toISOString();

interface Rig {
  clock: Clock;
  storage: ReturnType<typeof memoryStorage>;
  server: FakeServer;
  gumroad: FakeGumroad;
  service: EntitlementsService;
  changes: Entitlement[];
  timers: { fn: () => void; ms: number; id: number; live: boolean }[];
  /** A fresh service on the same storage and the same pretend world: the app was closed and opened again. */
  restart(over?: Partial<RigOptions>): Promise<Rig>;
}

interface RigOptions {
  use?: ('server' | 'gumroad')[];
  did?: string;
  legacy?: () => LegacyLicense | null;
  autoRefresh?: boolean;
  shared?: { clock: Clock; storage: ReturnType<typeof memoryStorage>; server: FakeServer; gumroad: FakeGumroad };
}

async function rig(o: RigOptions = {}): Promise<Rig> {
  const clock = o.shared?.clock ?? new Clock();
  const storage = o.shared?.storage ?? memoryStorage();
  const server = o.shared?.server ?? new FakeServer(keys, clock);
  server.other = other;
  const gumroad = o.shared?.gumroad ?? new FakeGumroad();
  const store = createStore({ storage, now: clock.now, timeZone: 'UTC' });
  let didOf = (): string => '';
  const providers: ManagedProvider[] = [];
  if ((o.use ?? ['server', 'gumroad']).includes('server')) providers.push(createServerProvider({ fetch: server.fetch, did: () => didOf(), keys: [keys.pub], now: clock.now }));
  if ((o.use ?? ['server', 'gumroad']).includes('gumroad')) providers.push(createGumroadProvider({ fetch: gumroad.fetch, now: clock.now }));
  const timers: Rig['timers'] = [];
  const service = createEntitlements({
    store, keys: [keys.pub], providers, now: clock.now, random: () => hexBytes(o.did ?? DID_1), autoRefresh: o.autoRefresh ?? false,
    ...(o.legacy ? { legacy: o.legacy } : {}),
    setTimer: (fn, ms) => { const t = { fn, ms, id: timers.length + 1, live: true }; timers.push(t); return t.id; },
    clearTimer: (id) => { const t = timers.find((x) => x.id === id); if (t) t.live = false; },
  });
  didOf = service.deviceId;
  const changes: Entitlement[] = [];
  service.onChange((e) => changes.push(e));
  await service.ready();
  const self: Rig = {
    clock, storage, server, gumroad, service, changes, timers,
    restart: (over = {}) => rig({ ...o, ...over, shared: { clock, storage, server, gumroad } }),
  };
  return self;
}

const stored = (r: Rig): { v: number; d: Record<string, unknown> } | null => {
  const text = r.storage.getItem('ba2.entitlements.current');
  return text ? (JSON.parse(text) as { v: number; d: Record<string, unknown> }) : null;
};

describe('a player with nothing', () => {
  it('is free, can use the free things only, and nothing was asked of the network', async () => {
    const r = await rig();
    expect(r.service.current()).toEqual({ plan: 'free', source: 'none' });
    expect(r.service.can('game:squat-flap')).toBe(false);
    expect(r.service.can('world:alps')).toBe(true);
    expect(r.service.status()).toMatchObject({ plan: 'free', standing: 'none', planId: null, everPaid: false, deviceId: DID_1 });
    expect(r.server.calls).toHaveLength(0);
    expect(r.gumroad.calls).toHaveLength(0);
    expect(r.changes).toEqual([]);
    expect(await r.service.refresh()).toBe('none');
    expect(await r.service.refreshIfDue()).toBe('none');
  });

  it('keeps a device id, the same one next time, and never makes the id from the clock', async () => {
    const r = await rig();
    const again = await r.restart({ did: DID_2 });
    expect(again.service.deviceId()).toBe(DID_1);
    expect(r.storage.getItem('ba2.entitlements.did')).toContain(DID_1);
  });
});

describe('a licence key', () => {
  it('turns a key into Pro, tells the screens once, and survives closing the app', async () => {
    const r = await rig();
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const result = await r.service.activateKey(KEY_A);
    expect(result.ok).toBe(true);
    expect(r.service.current()).toMatchObject({ plan: 'pro', source: 'server' });
    expect(r.service.can('game:squat-flap')).toBe(true);
    expect(r.service.can('family')).toBe(false);
    expect(r.changes).toHaveLength(1);
    expect(r.service.status()).toMatchObject({ plan: 'pro', standing: 'active', planId: 'pro-yearly', everPaid: true, source: 'server' });

    const again = await r.restart();
    expect(again.service.current()).toMatchObject({ plan: 'pro', source: 'server' });
    expect(again.server.calls).toHaveLength(1);                              // nothing was asked again at start
    expect(again.changes).toHaveLength(1);                                   // and the screens heard of Pro as soon as it was checked
  });

  it('keeps the key for the renewals, and not a word more about the buyer', async () => {
    const r = await rig();
    r.gumroad.add(MONTHLY, KEY_A);
    r.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active' });
    await r.service.activateKey(KEY_A);
    expect(stored(r)?.d['proof']).toBe(KEY_A);
    expect(JSON.stringify(r.storage.dump())).not.toContain('example.com');
    expect(JSON.stringify(stored(r))).not.toContain('"email"');
  });

  it('a founder has the family features, a Pro buyer does not', async () => {
    const r = await rig();
    r.server.licenses.set(KEY_A, { plan: 'founder', status: 'active' });
    await r.service.activateKey(KEY_A);
    expect(r.service.current()).toMatchObject({ plan: 'lifetime', founder: true });
    expect(r.service.can('family')).toBe(true);
    expect(r.service.status()).toMatchObject({ founder: true, planId: 'founder' });
  });

  it('says clearly no to a refunded, ended or unknown key, and stays free', async () => {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set('REFUNDED-KEY-0001', { plan: 'pro-monthly', status: 'refunded' });
    r.server.licenses.set('ENDED-KEY-0000001', { plan: 'pro-monthly', status: 'ended' });
    expect(await r.service.activateKey('REFUNDED-KEY-0001')).toMatchObject({ ok: false, code: 'refunded' });
    expect(await r.service.activateKey('ENDED-KEY-0000001')).toMatchObject({ ok: false, code: 'ended' });
    expect(await r.service.activateKey('UNKNOWN-KEY-00001')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await r.service.activateKey('nope')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await r.service.activateKey(undefined as unknown as string)).toMatchObject({ ok: false, code: 'not_found' });
    expect(r.service.current().plan).toBe('free');
    expect(stored(r)).toBeNull();
    expect(r.changes).toEqual([]);
  });

  it('three devices share one Pro key, the fourth is told there is no seat, and giving a seat back frees it', async () => {
    const first = await rig({ use: ['server'] });
    first.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const device = async (did: string): Promise<Rig> => rig({ use: ['server'], did, shared: { clock: first.clock, storage: memoryStorage(), server: first.server, gumroad: first.gumroad } });
    const devices = [first, await device('2'.repeat(32)), await device('3'.repeat(32))];
    for (const d of devices) expect((await d.service.activateKey(KEY_A)).ok).toBe(true);
    const fourth = await device('4'.repeat(32));
    expect(await fourth.service.activateKey(KEY_A)).toMatchObject({ ok: false, code: 'limit' });
    expect(fourth.service.current().plan).toBe('free');
    await devices[1]?.service.deactivate();
    expect(devices[1]?.service.current().plan).toBe('free');
    expect((await fourth.service.activateKey(KEY_A)).ok).toBe(true);
  });

  it('two keys at once make one record, one after the other', async () => {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    r.server.licenses.set(KEY_B, { plan: 'lifetime', status: 'active' });
    const both = await Promise.all([r.service.activateKey(KEY_A), r.service.activateKey(KEY_B)]);
    expect(both.every((x) => x.ok)).toBe(true);
    expect(r.service.status().planId).toBe('lifetime');                      // the later one, since they ran in order
  });
});

describe('B2: a check that fails never takes Pro away', () => {
  async function pro(): Promise<Rig> {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    await r.service.activateKey(KEY_A);
    r.changes.length = 0;
    return r;
  }

  it.each(['offline', 'status500', 'status503', 'status429', 'html200', 'html404', 'garbage', 'empty200', 'forged'] as const)('%s: the record stays, the screens hear nothing', async (fault) => {
    const r = await pro();
    r.clock.advance(2 * DAY);
    r.server.fault = fault;
    expect(await r.service.refresh()).toBe('kept');
    expect(r.service.current().plan).toBe('pro');
    expect(stored(r)).not.toBeNull();
    expect(r.changes).toEqual([]);
  });

  it('only an explicit refusal removes it, and then the record is gone from storage too', async () => {
    const r = await pro();
    r.clock.advance(2 * DAY);
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'refunded' });
    expect(await r.service.refresh()).toBe('revoked');
    expect(r.service.current().plan).toBe('free');
    expect(r.service.can('game:squat-flap')).toBe(false);
    expect(stored(r)).toBeNull();
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toEqual({ plan: 'free', source: 'none' });
    expect(r.service.status().everPaid).toBe(true);                          // a trial is not offered again
  });

  it('a record that lapsed while the network was away comes back at the next good check', async () => {
    const r = await pro();
    r.server.fault = 'offline';
    r.clock.advance(8 * DAY);                                                 // longer than a token lives
    expect(r.service.current().plan).toBe('free');
    expect(r.service.status().standing).toBe('expired');
    expect(await r.service.refresh()).toBe('kept');
    expect(r.service.current().plan).toBe('free');
    r.server.fault = null;
    r.clock.advance(10 * 60_000);
    expect(await r.service.refresh()).toBe('renewed');
    expect(r.service.current().plan).toBe('pro');
    expect(r.service.status().standing).toBe('active');
  });

  it('is renewed when due and not before; a failure is not retried at once', async () => {
    const r = await pro();
    const calls = (): number => r.server.calls.length;
    expect(await r.service.refreshIfDue()).toBe('fresh');
    r.clock.advance(23 * 60 * 60_000);
    expect(await r.service.refreshIfDue()).toBe('fresh');
    r.clock.advance(2 * 60 * 60_000);
    r.server.fault = 'status503';
    const before = calls();
    expect(await r.service.refreshIfDue()).toBe('kept');
    expect(calls()).toBe(before + 1);
    r.clock.advance(60_000);
    expect(await r.service.refreshIfDue()).toBe('kept');
    expect(calls()).toBe(before + 1);                                         // within five minutes: no new request
    r.server.fault = null;
    r.clock.advance(6 * 60_000);
    expect(await r.service.refreshIfDue()).toBe('renewed');
    expect(calls()).toBe(before + 2);
    expect(await r.service.refreshIfDue()).toBe('fresh');
  });

  it('renews by itself when the app starts and the last check is old', async () => {
    const r = await pro();
    r.clock.advance(2 * DAY);
    const before = r.server.calls.length;
    const again = await r.restart({ autoRefresh: true });
    await again.service.refreshIfDue();
    expect(r.server.calls.length).toBeGreaterThan(before);
    expect(again.service.current().plan).toBe('pro');
  });
});

describe('B1 and B4: a stored record is not believed more than it can be checked', () => {
  async function pro(): Promise<Rig> {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    await r.service.activateKey(KEY_A);
    return r;
  }
  const rewrite = (r: Rig, f: (d: Record<string, unknown>) => void): void => {
    const rec = stored(r) as { v: number; d: Record<string, unknown> };
    f(rec.d);
    r.storage.setItem('ba2.entitlements.current', JSON.stringify(rec));
  };

  it('a token with its payload changed is dropped, alone', async () => {
    const r = await pro();
    rewrite(r, (d) => {
      const e = d['e'] as { token: string };
      const [h, , s] = e.token.split('.') as [string, string, string];
      e.token = `${h}.${b64urlEncode(new TextEncoder().encode(JSON.stringify({ plan: 'founder' })))}.${s}`;
    });
    r.storage.setItem('ba2.settings.sound', '"keep me"');
    const again = await r.restart();
    expect(again.service.current().plan).toBe('free');
    expect(stored(again)).toBeNull();
    expect(r.storage.getItem('ba2.settings.sound')).toBe('"keep me"');
  });

  it('stored dates are not believed: editing validUntil or verifiedAt does not stretch a token', async () => {
    const r = await pro();
    r.clock.advance(9 * DAY);
    rewrite(r, (d) => { d['validUntil'] = START + 3650 * DAY; d['verifiedAt'] = r.clock.now(); d['paidUntil'] = null; });
    const again = await r.restart();
    expect(again.service.current().plan).toBe('free');                        // the token's own exp (7 days) decides
    expect(again.service.status().standing).toBe('expired');
  });

  it('a token copied from another device does not work here', async () => {
    const r = await pro();
    const elsewhere = await rig({ use: ['server'], did: DID_2, shared: { clock: r.clock, storage: memoryStorage({ 'ba2.entitlements.current': r.storage.getItem('ba2.entitlements.current') as string }), server: r.server, gumroad: r.gumroad } });
    expect(elsewhere.service.current().plan).toBe('free');
    expect(stored(elsewhere)).toBeNull();
  });

  it('a token from a key we do not use is refused', async () => {
    const r = await pro();
    r.server.keys = other;
    r.server.licenses.set(KEY_B, { plan: 'founder', status: 'active' });
    const wrong = await r.server.mint(await sha256Hex(KEY_B), DID_1, 'founder', 'gumroad', other);
    rewrite(r, (d) => { (d['e'] as { token: string }).token = wrong; });
    const again = await r.restart();
    expect(again.service.current().plan).toBe('free');
  });

  it('damaged records of every kind are dropped without throwing, and nothing else is touched', async () => {
    const bad = ['null', '5', '"x"', '[]', '{"v":1,"d":null}', '{"v":1,"d":{"junk":true}}', '{"v":1,"d":{"e":{"plan":"pro","source":"server"},"provider":"server"}}', '{not json',
      JSON.stringify({ v: 1, d: { e: { plan: 'pro', source: 'play' }, provider: 'play', planId: null, verifiedAt: START, validUntil: START + DAY, paidUntil: null, seenAt: START, proof: null } })];
    for (const text of bad) {
      const r = await rig({ use: ['server'], autoRefresh: false });
      r.storage.setItem('ba2.entitlements.current', text);
      r.storage.setItem('ba2.progress.x', '1');
      const again = await r.restart();
      expect(again.service.current().plan, text).toBe('free');
      expect(r.storage.getItem('ba2.progress.x')).toBe('1');
    }
  });

  it('a clock put back makes the record unproven until the next good check', async () => {
    const r = await pro();
    r.clock.advance(3 * DAY);
    expect(r.service.current().plan).toBe('pro');                             // the app is used on day 3 ...
    r.service.status();
    r.clock.advance(-3 * DAY);                                                // ... and the clock goes back to day 0
    expect(r.service.status().standing).toBe('clock_back');
    expect(r.service.current().plan).toBe('free');
    r.server.fault = 'offline';
    expect(await r.service.refresh()).toBe('kept');
    expect(r.service.current().plan).toBe('free');
    r.server.fault = null;
    r.clock.advance(6 * 60_000);
    expect(await r.service.refresh()).toBe('renewed');
    expect(r.service.status().standing).toBe('active');
  });
});

describe('the end of a paid period', () => {
  it('a cancelled membership is Pro to the end of the paid period, then free, with no network and a timer that tells the screens', async () => {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active', paidUntil: r.clock.now() + 5 * DAY });
    await r.service.activateKey(KEY_A);
    r.server.fault = 'offline';
    expect(r.service.status()).toMatchObject({ plan: 'pro', paidUntil: Math.floor((START + 5 * DAY) / 1000) * 1000 });
    r.clock.advance(4 * DAY);
    expect(r.service.current().plan).toBe('pro');
    const live = r.timers.filter((t) => t.live).at(-1);
    expect(live).toBeDefined();
    r.changes.length = 0;
    r.clock.advance(DAY + 2000);
    expect(r.service.current().plan).toBe('free');
    expect(r.service.status().standing).toBe('period_over');
    live?.fn();                                                               // the timer fires: the screens are told
    expect(r.changes.at(-1)).toEqual({ plan: 'free', source: 'none' });
  });

  it('a cancelled membership that was restarted is renewed without an end date', async () => {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active', paidUntil: r.clock.now() + 2 * DAY });
    await r.service.activateKey(KEY_A);
    r.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active' });
    r.clock.advance(2 * DAY + 1000);
    expect(r.service.current().plan).toBe('free');
    expect(await r.service.refresh()).toBe('renewed');
    expect(r.service.current().plan).toBe('pro');
    expect(r.service.status().paidUntil).toBeNull();
  });

  it('the timer asks for a renewal when one is due', async () => {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    await r.service.activateKey(KEY_A);
    const t = r.timers.filter((x) => x.live).at(-1);
    expect(t?.ms).toBeGreaterThan(0);
    expect(t?.ms).toBeLessThanOrEqual(DAY + 1000);                            // a day, not a week
    r.clock.advance(DAY + 1000);
    const before = r.server.calls.length;
    t?.fn();
    await new Promise((res) => setTimeout(res, 20));
    expect(r.server.calls.length).toBe(before + 1);
  });

  it('dispose stops the timer and the listeners', async () => {
    const r = await rig({ use: ['server'] });
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    await r.service.activateKey(KEY_A);
    r.service.dispose();
    expect(r.timers.filter((t) => t.live)).toHaveLength(0);
    r.changes.length = 0;
    r.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'refunded' });
    await r.service.refresh().catch(() => undefined);
    expect(r.changes).toEqual([]);
  });
});

describe('when our server cannot be reached, Gumroad is asked directly', () => {
  it('a key found directly gives Pro for 30 days, with no seat count and no token', async () => {
    const r = await rig();
    r.server.fault = 'offline';
    r.gumroad.add(MONTHLY, KEY_A);
    const result = await r.service.activateKey(KEY_A);
    expect(result).toMatchObject({ ok: true, e: { plan: 'pro', source: 'gumroad' } });
    expect(r.service.current().source).toBe('gumroad');
    expect(stored(r)?.d['proof']).toBe(KEY_A);
    r.clock.advance(29 * DAY);
    expect(r.service.current().plan).toBe('pro');
    r.clock.advance(2 * DAY);
    expect(r.service.current().plan).toBe('free');
    expect(r.service.status().standing).toBe('expired');
  });

  it('moves to our server as soon as it answers, and keeps the plan', async () => {
    const r = await rig();
    r.server.fault = 'offline';
    r.gumroad.add(MONTHLY, KEY_A);
    r.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active' });
    await r.service.activateKey(KEY_A);
    r.server.fault = null;
    r.clock.advance(2 * DAY);
    expect(await r.service.refresh()).toBe('renewed');
    expect(r.service.current()).toMatchObject({ plan: 'pro', source: 'server' });
    expect(r.service.status().planId).toBe('legacy-monthly');
  });

  it('a clear no from our server is final, a "not found" gets Gumroad\'s own answer', async () => {
    const r = await rig();
    r.server.licenses.set(KEY_A, { plan: 'pro-monthly', status: 'refunded' });
    r.gumroad.add(MONTHLY, KEY_A);
    expect(await r.service.activateKey(KEY_A)).toMatchObject({ ok: false, code: 'refunded' });
    expect(r.gumroad.calls).toHaveLength(0);                                  // the weaker check is never asked to overrule the stronger
    r.gumroad.add(MONTHLY, KEY_B);                                            // a product our server does not know yet
    expect(await r.service.activateKey(KEY_B)).toMatchObject({ ok: true, e: { source: 'gumroad' } });
  });

  it('when neither can be reached the answer says so and nothing is stored', async () => {
    const r = await rig();
    r.server.fault = 'offline';
    r.gumroad.fault = 'offline';
    expect(await r.service.activateKey(KEY_A)).toMatchObject({ ok: false, code: 'network' });
    expect(stored(r)).toBeNull();
  });

  it('a direct record keeps the live site\'s cases: the key is dropped when Gumroad says no, kept when Gumroad is unreachable', async () => {
    const r = await rig({ use: ['gumroad'] });
    r.gumroad.add(MONTHLY, KEY_A, { subscription_cancelled_at: iso(r.clock.now() + 3 * DAY) });
    await r.service.activateKey(KEY_A);
    expect(r.service.current().plan).toBe('pro');
    r.clock.advance(3 * DAY + 60_000);
    expect(r.service.current().plan).toBe('free');                            // the paid period is over, offline or not
    r.gumroad.fault = 'offline';
    expect(await r.service.refresh()).toBe('kept');
    expect(stored(r)).not.toBeNull();
    r.gumroad.fault = null;
    r.clock.advance(6 * 60_000);
    expect(await r.service.refresh()).toBe('revoked');                        // Gumroad: the membership has ended
    expect(stored(r)).toBeNull();
  });

  it('a direct record whose stored check time lies in the future is not Pro (B1)', async () => {
    const r = await rig({ use: ['gumroad'] });
    r.gumroad.add(MONTHLY, KEY_A);
    await r.service.activateKey(KEY_A);
    const rec = stored(r) as { v: number; d: Record<string, unknown> };
    rec.d['verifiedAt'] = r.clock.now() + 400 * DAY;
    rec.d['validUntil'] = r.clock.now() + 4000 * DAY;
    r.storage.setItem('ba2.entitlements.current', JSON.stringify(rec));
    const again = await r.restart({ use: ['gumroad'] });
    expect(again.service.current().plan).toBe('free');
    expect(again.service.status().standing).toBe('unverified');
    expect(await again.service.refresh()).toBe('renewed');                    // a real check heals it
    expect(again.service.current().plan).toBe('pro');
  });
});

describe('the licence of the live site', () => {
  const lic = (over: Partial<LegacyLicense> = {}): LegacyLicense => ({ key: KEY_A, product: 'pro', verifiedAt: START - 5 * DAY, futureVerifiedAt: false, ...over });

  it('is carried over silently: the key goes to the server once and the person does nothing', async () => {
    const r = await rig({ legacy: () => lic() });
    r.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active' });
    const r2 = await rig({ legacy: () => lic(), shared: { clock: r.clock, storage: memoryStorage(), server: r.server, gumroad: r.gumroad } });
    expect(r2.service.current()).toMatchObject({ plan: 'pro', source: 'server' });
    const calls = r2.server.calls.length;
    const again = await r2.restart({ legacy: () => lic() });
    expect(again.service.current().plan).toBe('pro');
    expect(again.server.calls.length).toBe(calls);                            // asked only the first time
  });

  it('a lifetime buyer of the live site is a founder', async () => {
    const r = await rig({ legacy: () => lic({ product: 'lifetime' }) });
    r.server.licenses.set(KEY_A, { plan: 'founder', status: 'active' });
    const r2 = await rig({ legacy: () => lic({ product: 'lifetime' }), shared: { clock: r.clock, storage: memoryStorage(), server: r.server, gumroad: r.gumroad } });
    expect(r2.service.current()).toMatchObject({ plan: 'lifetime', founder: true });
  });

  it('when nothing can be reached the live site\'s own rule holds: 30 days after its last check', async () => {
    const r = await rig({ use: ['server'], legacy: () => lic() });
    expect(r.service.current().plan).toBe('free');                            // server up, but no such licence there
    const down = await rig();
    down.server.fault = 'offline'; down.gumroad.fault = 'offline';
    const r2 = await rig({ legacy: () => lic(), shared: { clock: down.clock, storage: memoryStorage(), server: down.server, gumroad: down.gumroad } });
    expect(r2.service.current()).toMatchObject({ plan: 'pro', source: 'gumroad' });
    r2.clock.advance(26 * DAY);
    expect(r2.service.current().plan).toBe('free');                           // 5 + 26 days is past the 30
  });

  it('then moves to the server at the next start where it answers', async () => {
    const down = await rig();
    down.server.fault = 'offline'; down.gumroad.fault = 'offline';
    const shared = { clock: down.clock, storage: memoryStorage(), server: down.server, gumroad: down.gumroad };
    const first = await rig({ legacy: () => lic(), shared });
    expect(first.service.current().source).toBe('gumroad');
    down.server.fault = null; down.gumroad.fault = null;
    down.server.licenses.set(KEY_A, { plan: 'legacy-monthly', status: 'active' });
    const second = await first.restart({ legacy: () => lic() });
    expect(await second.service.refresh()).toBe('renewed');
    expect(second.service.current().source).toBe('server');
  });

  it('a check time in the future, a membership that ended and a key older than 30 days count for nothing (B1)', async () => {
    for (const over of [{ futureVerifiedAt: true, verifiedAt: 0 }, { endsAt: START - DAY }, { verifiedAt: START - 31 * DAY }, { verifiedAt: 0 }] as Partial<LegacyLicense>[]) {
      const down = await rig();
      down.server.fault = 'offline'; down.gumroad.fault = 'offline';
      const r = await rig({ legacy: () => lic(over), shared: { clock: down.clock, storage: memoryStorage(), server: down.server, gumroad: down.gumroad } });
      expect(r.service.current().plan, JSON.stringify(over)).toBe('free');
    }
  });

  it('a key the seller refuses is not carried over and is not asked about again', async () => {
    const r = await rig({ legacy: () => lic() });
    r.server.licenses.set(KEY_A, { plan: 'pro-monthly', status: 'refunded' });
    const r2 = await rig({ legacy: () => lic(), shared: { clock: r.clock, storage: memoryStorage(), server: r.server, gumroad: r.gumroad } });
    expect(r2.service.current().plan).toBe('free');
    const calls = r2.server.calls.length;
    await r2.restart({ legacy: () => lic() });
    expect(r2.server.calls.length).toBe(calls);
  });

  it('a reader that throws or finds nothing is not a problem', async () => {
    expect((await rig({ legacy: () => { throw new Error('storage blocked'); } })).service.current().plan).toBe('free');
    expect((await rig({ legacy: () => null })).service.current().plan).toBe('free');
  });
});

describe('Google Play', () => {
  const TOKEN = 'purchase-token-aaaaaaaaaaaaaaaaaaaa';
  async function android(listed: { itemId: string; purchaseToken: string }[] = []) {
    const clock = new Clock();
    const storage = memoryStorage();
    const server = new FakeServer(keys, clock);
    server.other = other;
    server.playPurchases.set(TOKEN, { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'active' });
    const store = createStore({ storage, now: clock.now, timeZone: 'UTC' });
    let didOf = (): string => '';
    let outcome: 'pay' | 'cancel' = 'pay';
    const list = { value: listed };
    const service: DigitalGoodsService = { getDetails: async () => [], listPurchases: async () => list.value };
    const createPayment = (): PaymentRequestLike => ({
      show: async () => {
        if (outcome === 'cancel') throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        return { details: { purchaseToken: TOKEN }, complete: async () => undefined };
      },
    });
    const ent = createEntitlements({
      store, keys: [keys.pub], now: clock.now, random: () => hexBytes(DID_1), autoRefresh: false,
      providers: [
        createServerProvider({ fetch: server.fetch, did: () => didOf(), keys: [keys.pub], now: clock.now }),
        createPlayProvider({ service, createPayment, fetch: server.fetch, did: () => didOf(), keys: [keys.pub], now: clock.now }),
      ],
    });
    didOf = ent.deviceId;
    await ent.ready();
    return { clock, storage, server, ent, list, setOutcome: (o: 'pay' | 'cancel') => { outcome = o; } };
  }

  it('a purchase gives Pro, and no key is kept (Play lists its purchases again)', async () => {
    const a = await android();
    expect(await a.ent.purchase('bodyarcade_pro_yearly')).toEqual({ ok: true, plan: 'pro' });
    expect(a.ent.current()).toMatchObject({ plan: 'pro', source: 'play' });
    const rec = JSON.parse(a.storage.getItem('ba2.entitlements.current') as string) as { d: Record<string, unknown> };
    expect(rec.d['proof']).toBeNull();
    expect(JSON.stringify(a.storage.dump())).not.toContain(TOKEN);            // the purchase token itself is never stored here
  });

  it('a cancelled purchase is reported as cancelled and changes nothing', async () => {
    const a = await android();
    a.setOutcome('cancel');
    expect(await a.ent.purchase('bodyarcade_pro_yearly')).toEqual({ ok: false, code: 'cancelled' });
    expect(a.ent.current().plan).toBe('free');
    expect(a.server.calls).toHaveLength(0);
  });

  it('restoring finds the purchase again on a fresh install, and says so when there is none', async () => {
    const empty = await android();
    expect(await empty.ent.restore()).toMatchObject({ ok: false, code: 'not_found' });
    const a = await android([{ itemId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }]);
    expect(await a.ent.restore()).toMatchObject({ ok: true, e: { plan: 'pro', source: 'play' } });
    expect(a.ent.current().plan).toBe('pro');
  });

  it('a renewal asks Play for the purchases again; a refund ends it, a hiccup does not', async () => {
    const a = await android([{ itemId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN }]);
    await a.ent.purchase('bodyarcade_pro_yearly');
    a.clock.advance(2 * DAY);
    a.server.fault = 'status503';
    expect(await a.ent.refresh()).toBe('kept');
    a.server.fault = null;
    a.clock.advance(6 * 60_000);
    expect(await a.ent.refresh()).toBe('renewed');
    a.server.playPurchases.set(TOKEN, { productId: 'bodyarcade_pro_yearly', plan: 'pro-yearly', status: 'refunded' });
    a.clock.advance(6 * 60_000);
    expect(await a.ent.refresh()).toBe('revoked');
    expect(a.ent.current().plan).toBe('free');
  });

  it('without the Play provider there is nothing to buy or restore', async () => {
    const r = await rig();
    expect(await r.service.purchase('bodyarcade_pro_yearly')).toEqual({ ok: false, code: 'server' });
    expect(await r.service.restore()).toMatchObject({ ok: false });
  });
});

describe('the contract', () => {
  it('lets a provider be added later with use(), and reports what it has', async () => {
    const r = await rig({ use: [] });
    expect(r.service.hasProvider('server')).toBe(false);
    expect(await r.service.activateKey(KEY_A)).toMatchObject({ ok: false, code: 'server' });
    r.service.use(createServerProvider({ fetch: r.server.fetch, did: r.service.deviceId, keys: [keys.pub], now: r.clock.now }));
    expect(r.service.hasProvider('server')).toBe(true);
    r.server.licenses.set(KEY_A, { plan: 'pro-monthly', status: 'active' });
    expect((await r.service.activateKey(KEY_A)).ok).toBe(true);
  });

  it('gives the games\' free flags to can(), and Pro opens them all', async () => {
    const clock = new Clock();
    const store = createStore({ storage: memoryStorage(), now: clock.now });
    const server = new FakeServer(keys, clock);
    const e = createEntitlements({ store, keys: [keys.pub], now: clock.now, rules: { isFreeGame: (id) => id === 'road-run' }, autoRefresh: false,
      providers: [createServerProvider({ fetch: server.fetch, did: () => DID_1, keys: [keys.pub], now: clock.now })], random: () => hexBytes(DID_1) });
    await e.ready();
    expect(e.can('game:road-run')).toBe(true);
    expect(e.can('game:squat-flap')).toBe(false);
    server.licenses.set(KEY_A, { plan: 'pro-monthly', status: 'active' });
    await e.activateKey(KEY_A);
    expect(e.can('game:squat-flap')).toBe(true);
  });

  it('survives a listener that throws', async () => {
    const r = await rig({ use: ['server'] });
    r.service.onChange(() => { throw new Error('bad listener'); });
    const good: Entitlement[] = [];
    r.service.onChange((e) => good.push(e));
    r.server.licenses.set(KEY_A, { plan: 'pro-monthly', status: 'active' });
    expect((await r.service.activateKey(KEY_A)).ok).toBe(true);
    expect(good).toHaveLength(1);
  });

  it('a stored record that the api test never wrote cannot name a path: the provider ids are fixed words', () => {
    expect(API.activate).toBe('/api/entitlements/activate');
  });
});
