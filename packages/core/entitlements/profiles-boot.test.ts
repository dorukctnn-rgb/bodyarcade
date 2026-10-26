// The profile book and the entitlements together, built the way the shell builds them at boot (the recipe in NOTLAR-store.md, "AILE
// PROFILLERI: UI SOZLESMESI"): the book first, because it owns the device store the entitlements live in; the entitlements on that
// store; the book told whenever they say something. Real manager, real providers against the pretend server, real book.
import { beforeAll, describe, expect, it } from 'vitest';
import { createProfileBook, createStore, memoryStorage, watchOnline, type ProfileBook, type ProfileEvent } from '../store/index.ts';
import { bootEntitlements, type BootResult, type BootWindow } from './boot.ts';
import { DAY, FakeServer, KEY_A, KEY_B, Clock, makeKeys, type Keys } from './testkit.ts';

let keys: Keys;
beforeAll(async () => { keys = await makeKeys(); });

const browserWindow = (): BootWindow => ({ location: { search: '' }, document: { referrer: '' } });

interface Shared { storage: ReturnType<typeof memoryStorage>; clock: Clock; server: FakeServer }
const shared = (): Shared => {
  const clock = new Clock();
  return { storage: memoryStorage(), clock, server: new FakeServer(keys, clock) };
};

/** One page: the order is the point. `before` is what the book said while the entitlements were still being read. */
async function page(s: Shared) {
  const store = createStore({ storage: s.storage, now: s.clock.now, timeZone: 'UTC' });
  let ent: BootResult | null = null;
  const book: ProfileBook = createProfileBook({
    store,
    can: (f) => ent?.service.can(f) ?? false,
    known: () => ent !== null,
    ownerName: 'Ayşe',
    recoveredName: (n) => `Profil ${n}`,
    games: () => [],
  });
  const before = book.list().map((v) => v.state);
  ent = await bootEntitlements({
    store: book.device, keys: [keys.pub], window: browserWindow(), fetch: s.server.fetch, now: s.clock.now, legacyStorage: null, autoRefresh: false,
  });
  const stop = ent.service.onChange(() => book.refresh());
  book.refresh();                                                         // "known" has just turned true
  const events: ProfileEvent[] = [];
  book.onChange((e) => events.push(e));
  return { ...s, store, book, ent, before, events, stop };
}

const familyKey = (s: Shared, key = KEY_A): void => { s.server.licenses.set(key, { plan: 'family-yearly', status: 'active' }); };
const gateAnswer = (book: ProfileBook): void => {
  const asked = book.gate.ask();
  if (!asked.ok) throw new Error('gate closed');
  expect(book.gate.answer(asked.question.id, asked.question.a * asked.question.b)).toEqual({ ok: true });
};

describe('the book and the entitlements, built the way the shell builds them', () => {
  it('a free device has room for one profile; a Family key, activated, makes room for six without anybody telling the book', async () => {
    const s = shared();
    familyKey(s);
    const p = await page(s);
    expect(p.book.capacity()).toMatchObject({ max: 1, canAdd: false, why: 'plan' });
    expect(p.book.create({ name: 'Defne', kid: true })).toEqual({ ok: false, code: 'plan' });
    expect((await p.ent.service.activateKey(KEY_A)).ok).toBe(true);
    expect(p.book.capacity()).toMatchObject({ max: 6, canAdd: true, why: null });
    for (let i = 2; i <= 6; i++) expect(p.book.create({ name: `Kişi ${i}`, kid: i === 2 }).ok, `profile ${i}`).toBe(true);
    expect(p.book.create({ name: 'Yedinci' })).toEqual({ ok: false, code: 'full' });
    expect(p.book.list()).toHaveLength(6);
  });

  it('the entitlements live in the device\'s part of the storage and nowhere a profile can reach', async () => {
    const s = shared();
    familyKey(s);
    const p = await page(s);
    await p.ent.service.activateKey(KEY_A);
    p.book.create({ name: 'Defne', kid: true });
    const kid = p.book.switchTo('p2');
    expect(kid.ok).toBe(true);
    const keysNow = Object.keys(s.storage.dump());
    expect(keysNow.filter((k) => k.startsWith('ba2.entitlements.')).length).toBeGreaterThan(0);
    expect(keysNow.filter((k) => /^ba2p\d/.test(k) && k.includes('.entitlements.'))).toEqual([]);
    const space = p.book.open();
    expect(() => space.store.ns('entitlements')).toThrow(RangeError);
    expect(() => space.store.ns('profiles')).toThrow(RangeError);
    expect(() => p.book.device.ns('shell')).toThrow(RangeError);
    expect(() => p.book.device.ns('entitlements')).not.toThrow();
  });

  it('the next page reads the plan offline and keeps the profiles unlocked while it is still reading', async () => {
    const s = shared();
    familyKey(s);
    const first = await page(s);
    await first.ent.service.activateKey(KEY_A);
    first.book.create({ name: 'Defne', kid: true });
    first.book.switchTo('p2');
    s.server.fault = 'offline';                                           // no network for the next page
    const next = await page(s);
    expect(next.before).toEqual(['ready', 'ready']);                      // what the plan allowed last time holds until the entitlements answer
    expect(next.book.list().map((v) => v.state)).toEqual(['ready', 'ready']);
    expect(next.book.active().id).toBe('p2');
    expect(next.book.capacity().max).toBe(6);
  });

  it('a refund takes the plan away at the next renewal: the extra profiles lock, nothing is deleted, and a child is not handed to the owner\'s online identity', async () => {
    const s = shared();
    familyKey(s);
    const p = await page(s);
    await p.ent.service.activateKey(KEY_A);
    p.book.create({ name: 'Defne', kid: true });
    p.book.create({ name: 'Emre' });
    const closed: string[] = [];
    watchOnline(p.book, { open: () => { closed.push('open'); }, close: () => { closed.push('close'); } });
    expect(closed).toEqual(['open']);
    p.book.switchTo('p2');
    expect(closed).toEqual(['open', 'close']);
    const kept = Object.keys(s.storage.dump()).filter((k) => k.startsWith('ba2p2.') || k.startsWith('ba2p3.')).sort();
    s.server.licenses.set(KEY_A, { plan: 'family-yearly', status: 'refunded' });
    s.clock.advance(8 * DAY);
    expect(await p.ent.service.refresh()).toBe('revoked');
    expect(p.book.list().map((v) => [v.id, v.state])).toEqual([['p1', 'ready'], ['p2', 'locked'], ['p3', 'locked']]);
    expect(p.book.active().id).toBe('p1');
    expect(p.book.guarded).toBe(true);
    expect(p.book.online()).toBe(false);
    expect(closed).toEqual(['open', 'close']);                            // the owner's online identity stays closed behind the gate
    expect(p.events.at(-1)).toMatchObject({ kind: 'switched', reason: 'plan', guarded: true, online: false });
    expect(Object.keys(s.storage.dump()).filter((k) => k.startsWith('ba2p2.') || k.startsWith('ba2p3.')).sort()).toEqual(kept);
    gateAnswer(p.book);
    expect(p.book.guarded).toBe(false);
    expect(p.book.online()).toBe(true);
    expect(closed).toEqual(['open', 'close', 'open']);
    // and a new key (a new purchase) gives everything back
    familyKey(s, KEY_B);
    expect((await p.ent.service.activateKey(KEY_B)).ok).toBe(true);
    expect(p.book.list().map((v) => v.state)).toEqual(['ready', 'ready', 'ready']);
  });

  it('a Pro key (not the Family plan) gives one profile, and what the kid profiles may not do is not given back by it', async () => {
    const s = shared();
    s.server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const p = await page(s);
    expect((await p.ent.service.activateKey(KEY_A)).ok).toBe(true);
    expect(p.book.capacity()).toMatchObject({ max: 1, canAdd: false, why: 'plan' });
    expect(p.book.open().can('live:ranked')).toBe(true);                  // Pro, and the owner: online play is theirs
    expect(p.book.canPurchase()).toBe(true);
  });

  it('a kid\'s profile on a Family device never has the online features, though the plan is paid for', async () => {
    const s = shared();
    familyKey(s);
    const p = await page(s);
    await p.ent.service.activateKey(KEY_A);
    p.book.create({ name: 'Defne', kid: true });
    expect(p.ent.service.can('live:ranked')).toBe(true);                  // the device is paid up
    const kid = (p.book.switchTo('p2') as { space: ReturnType<ProfileBook['open']> }).space;
    expect(kid.can('live:ranked')).toBe(false);
    expect(kid.can('friends:list')).toBe(false);
    expect(kid.can('game:squat-flap')).toBe(true);
    expect(p.book.canPurchase()).toBe(false);                             // every purchase screen waits for the parent gate
    expect(p.book.active().rules).toMatchObject({ online: false, purchase: 'parent_gate', autoPaywall: false });
  });
});
