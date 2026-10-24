// core/store: what the profiles stand on. One storage can hold several stores under different key prefixes (one per profile),
// a store can be made read-only (a profile whose plan ended, a look at someone else's record), and a store can refuse the
// namespaces that belong to the device (the entitlements, the profile list) or accept nothing else. None of these
// restrictions can be undone by asking the store for another store.
import { describe, expect, it } from 'vitest';
import { p, schemaOf } from './schema.ts';
import { createStore, memoryStorage, type StorageLike, type StoreProblem } from './store.ts';

const Count = schemaOf(1, p.number({ int: true, min: 0 }));
const CountV2 = schemaOf(2, p.number({ int: true, min: 0 }), (raw) => (raw as number) * 10);

function rig(initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial);
  const problems: StoreProblem[] = [];
  const store = createStore({ storage, now: () => Date.UTC(2026, 9, 24, 23, 30), timeZone: 'Europe/Istanbul', onProblem: (x) => problems.push(x) });
  return { storage, store, problems };
}

describe('withPrefix: one storage, one store per profile', () => {
  it('writes under its own prefix and reads only its own keys', () => {
    const { storage, store } = rig();
    const child = store.withPrefix('ba2p2');
    child.ns('runner').set('count', 5, Count);
    store.ns('runner').set('count', 1, Count);
    expect(Object.keys(storage.dump()).sort()).toEqual(['ba2.runner.count', 'ba2p2.runner.count']);
    expect(child.prefix).toBe('ba2p2');
    expect(child.ns('runner').get('count', Count, 0)).toBe(5);
    expect(store.ns('runner').get('count', Count, 0)).toBe(1);
    expect(child.ns('runner').keys()).toEqual(['count']);
  });

  it('accepts only plain prefixes: no dot (it could reach into another prefix), no capitals, no odd characters', () => {
    const { store } = rig();
    for (const bad of ['', 'a', 'Ba2', 'ba2.p2', 'ba 2', '../x', 'ba2p2.', 'x'.repeat(21), '2ba']) expect(() => store.withPrefix(bad), JSON.stringify(bad)).toThrow(RangeError);
    for (const good of ['ba2', 'ba2p2', 'ba2p123', 'ab']) expect(() => store.withPrefix(good), good).not.toThrow();
  });

  it('shares the clock, the time zone and the problem log with the store it came from', () => {
    const { storage, store, problems } = rig({ 'ba2p3.runner.count': '{not json' });
    const child = store.withPrefix('ba2p3');
    expect(child.now()).toBe(store.now());
    expect(child.day()).toBe('2026-10-25');           // 23:30 UTC is already the 25th in Istanbul
    expect(child.ns('runner').get('count', Count, 9)).toBe(9);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'corrupt', key: 'ba2p3.runner.count' });
    expect(store.problems()).toHaveLength(1);
    expect(child.problems()).toHaveLength(1);
    expect(storage.getItem('ba2p3.runner.count')).toBeNull();
  });

  it('clearAll removes the keys of its own prefix only: ba2 and ba2p2 never reach into each other', () => {
    const { storage, store } = rig();
    const a = store.withPrefix('ba2p2');
    const b = store.withPrefix('ba2p22');
    store.ns('x').set('k', 1, Count);
    a.ns('x').set('k', 2, Count);
    b.ns('x').set('k', 3, Count);
    expect(a.clearAll()).toBe(1);
    expect(Object.keys(storage.dump()).sort()).toEqual(['ba2.x.k', 'ba2p22.x.k']);
    expect(store.clearAll()).toBe(1);
    expect(Object.keys(storage.dump())).toEqual(['ba2p22.x.k']);
  });

  it('a value the storage refused stays in the memory of the store that wrote it, not in a sibling', () => {
    const base = memoryStorage();
    const full: StorageLike = { ...base, getItem: base.getItem, removeItem: base.removeItem, setItem: () => { throw new Error('quota'); } };
    const store = createStore({ storage: full });
    const a = store.withPrefix('ba2p2');
    const b = store.withPrefix('ba2p3');
    a.ns('x').set('k', 4, Count);
    expect(a.ns('x').get('k', Count, 0)).toBe(4);
    expect(b.ns('x').get('k', Count, 0)).toBe(0);
  });
});

describe('scanPrefixes: which profiles left something behind', () => {
  it('lists the distinct prefixes in the storage that match, sorted', () => {
    const { store } = rig({
      'ba2.runner.count': '{"v":1,"d":1}', 'ba2p5.runner.count': '{"v":1,"d":1}', 'ba2p5.habit.days': '{"v":1,"d":1}', 'ba2p2.x.y': '{"v":1,"d":1}',
      'ba_runs': '[]', 'other.thing': '1', 'ba2pX.x.y': '1',
    });
    expect(store.scanPrefixes(/^ba2p\d+$/)).toEqual(['ba2p2', 'ba2p5']);
    expect(store.scanPrefixes(/^ba2$/)).toEqual(['ba2']);
  });

  it('is not fooled by a pattern with the global flag', () => {
    const { store } = rig({ 'ba2p2.x.y': '1', 'ba2p3.x.y': '1', 'ba2p4.x.y': '1' });
    expect(store.scanPrefixes(/^ba2p\d+$/g)).toEqual(['ba2p2', 'ba2p3', 'ba2p4']);
  });

  it('says nothing when the storage cannot be listed, and when listing throws', () => {
    const bare: StorageLike = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    expect(createStore({ storage: bare }).scanPrefixes(/.*/)).toEqual([]);
    const broken: StorageLike = { ...bare, length: 3, key: () => { throw new Error('denied'); } };
    expect(createStore({ storage: broken }).scanPrefixes(/.*/)).toEqual([]);
  });
});

describe('readOnly: a look that leaves no mark', () => {
  const seeded = (): Record<string, string> => ({
    'ba2p2.runner.count': JSON.stringify({ v: 1, d: 7 }),
    'ba2p2.runner.old': JSON.stringify({ v: 1, d: 3 }),
    'ba2p2.runner.bad': '{broken',
  });

  it('reads what is there', () => {
    const { store } = rig(seeded());
    const ro = store.withPrefix('ba2p2', { readOnly: true });
    expect(ro.readOnly).toBe(true);
    expect(store.readOnly).toBe(false);
    expect(ro.ns('runner').get('count', Count, 0)).toBe(7);
    expect(ro.ns('runner').has('count')).toBe(true);
    expect(ro.ns('runner').keys().sort()).toEqual(['bad', 'count', 'old']);
    expect(ro.day()).toBe(store.day());
  });

  it('refuses every write, reports it, and the storage stays exactly as it was', () => {
    const { storage, store, problems } = rig(seeded());
    const before = JSON.stringify(storage.dump());
    const ro = store.withPrefix('ba2p2', { readOnly: true });
    const ns = ro.ns('runner');
    const slot = ns.slot('count', Count, 0);
    ns.set('count', 99, Count);
    ns.set('fresh', 1, Count);
    ns.remove('count');
    slot.set(50);
    expect(slot.update((n) => n + 1)).toBe(7);        // the answer is what is stored, the change was not made
    slot.remove();
    expect(ro.clearAll()).toBe(0);
    expect(JSON.stringify(storage.dump())).toBe(before);
    expect(ns.get('count', Count, 0)).toBe(7);
    expect(ns.get('fresh', Count, 0)).toBe(0);
    expect(problems.filter((x) => x.kind === 'rejected')).toHaveLength(7);
  });

  it('does not repair anything while reading: a damaged key stays, an old format is not written back', () => {
    const { storage, store } = rig(seeded());
    const ro = store.withPrefix('ba2p2', { readOnly: true });
    expect(ro.ns('runner').get('bad', Count, 4)).toBe(4);
    expect(storage.getItem('ba2p2.runner.bad')).toBe('{broken');
    expect(ro.ns('runner').get('old', CountV2, 0)).toBe(30);       // migrated in memory for this reading
    expect(JSON.parse(storage.getItem('ba2p2.runner.old') as string)).toEqual({ v: 1, d: 3 });
  });

  it('cannot be turned back into a writable store by asking for another one', () => {
    const { storage, store } = rig(seeded());
    const ro = store.withPrefix('ba2p2', { readOnly: true });
    const again = ro.withPrefix('ba2p2', { readOnly: false });
    expect(again.readOnly).toBe(true);
    again.ns('runner').set('count', 1, Count);
    expect(JSON.parse(storage.getItem('ba2p2.runner.count') as string)).toEqual({ v: 1, d: 7 });
  });
});

describe('deny and allow: the namespaces that belong to the device', () => {
  const seeded = (): Record<string, string> => ({
    'ba2.entitlements.current': '{"v":1,"d":1}', 'ba2.profiles.book': '{"v":1,"d":1}', 'ba2.runner.count': '{"v":1,"d":5}', 'ba2.shell.settings': '{"v":1,"d":1}',
  });

  it('a store that denies a namespace will not open it', () => {
    const { store } = rig(seeded());
    const mine = store.withPrefix('ba2', { deny: ['entitlements', 'profiles'] });
    expect(() => mine.ns('entitlements')).toThrow(RangeError);
    expect(() => mine.ns('profiles')).toThrow(RangeError);
    expect(mine.ns('runner').get('count', Count, 0)).toBe(5);
  });

  it('clearAll on it leaves what it denies', () => {
    const { storage, store } = rig(seeded());
    const mine = store.withPrefix('ba2', { deny: ['entitlements', 'profiles'] });
    expect(mine.clearAll()).toBe(2);
    expect(Object.keys(storage.dump()).sort()).toEqual(['ba2.entitlements.current', 'ba2.profiles.book']);
  });

  it('a store that allows only some namespaces opens those and clears only those', () => {
    const { storage, store } = rig(seeded());
    const device = store.withPrefix('ba2', { allow: ['entitlements', 'profiles'] });
    expect(() => device.ns('runner')).toThrow(RangeError);
    expect(() => device.ns('shell')).toThrow(RangeError);
    expect(device.ns('entitlements').has('current')).toBe(true);
    expect(device.clearAll()).toBe(2);
    expect(Object.keys(storage.dump()).sort()).toEqual(['ba2.runner.count', 'ba2.shell.settings']);
  });

  it('the restrictions only grow: no store derived from a restricted one is freer than it', () => {
    const { store } = rig(seeded());
    const mine = store.withPrefix('ba2', { deny: ['entitlements'] });
    expect(() => mine.withPrefix('ba2', { deny: [] }).ns('entitlements')).toThrow(RangeError);
    expect(() => mine.withPrefix('ba2').ns('entitlements')).toThrow(RangeError);
    const device = store.withPrefix('ba2', { allow: ['entitlements', 'profiles'] });
    expect(() => device.withPrefix('ba2', { allow: ['runner', 'entitlements'] }).ns('runner')).toThrow(RangeError);
    expect(device.withPrefix('ba2', { allow: ['runner', 'entitlements'] }).ns('entitlements').has('current')).toBe(true);
    expect(() => device.withPrefix('ba2p2').ns('runner')).toThrow(RangeError);
  });
});
