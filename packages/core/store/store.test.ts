// core/store: B4 (damaged localStorage), B13 (one date rule), rule 5 of code-audit 11.4 (a bad key resets alone),
// versioned migrations and storage that throws.
import { describe, expect, it } from 'vitest';
import type { Schema } from '../types/index.ts';
import { BAD, p, schemaOf } from './schema.ts';
import { createStore, memoryStorage, type StorageLike, type StoreProblem } from './store.ts';

const Runs = schemaOf(1, p.array(p.object({ score: p.number({ min: 0 }), world: p.string({ max: 20 }) }), { max: 200, lenient: true }));
const Count = schemaOf(1, p.number({ int: true, min: 0 }));

function setup(initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial);
  const problems: StoreProblem[] = [];
  let now = Date.UTC(2026, 9, 23, 12, 0);
  const store = createStore({ storage, now: () => now, timeZone: 'UTC', onProblem: (x) => problems.push(x) });
  return { storage, store, problems, setNow: (t: number) => { now = t; } };
}

describe('namespaced round trip', () => {
  it('stores data under ba2.<namespace>.<key> with the schema version', () => {
    const { storage, store } = setup();
    const ns = store.ns('runner');
    ns.set('count', 7, Count);
    expect(JSON.parse(storage.getItem('ba2.runner.count') as string)).toEqual({ v: 1, d: 7 });
    expect(ns.get('count', Count, 0)).toBe(7);
    ns.remove('count');
    expect(ns.get('count', Count, 0)).toBe(0);
    expect(storage.getItem('ba2.runner.count')).toBeNull();
  });

  it('keeps namespaces apart', () => {
    const { store } = setup();
    store.ns('runner').set('count', 1, Count);
    store.ns('flight').set('count', 2, Count);
    expect(store.ns('runner').get('count', Count, 0)).toBe(1);
    expect(store.ns('flight').get('count', Count, 0)).toBe(2);
  });

  it('hands out a fresh copy of the fallback, so callers cannot damage it', () => {
    const { store } = setup();
    const fallback = { list: [] as number[] };
    const S = schemaOf(1, p.object({ list: p.array(p.number()) }));
    const a = store.ns('g').get('x', S, fallback);
    a.list.push(1);
    expect(store.ns('g').get('x', S, fallback)).toEqual({ list: [] });
    expect(fallback).toEqual({ list: [] });
  });

  it('accepts a fallback factory', () => {
    const { store } = setup();
    let n = 0;
    expect(store.ns('g').get('x', Count, () => ++n)).toBe(1);
    expect(store.ns('g').get('x', Count, () => ++n)).toBe(2);
  });

  it('rejects names that could collide or escape the prefix', () => {
    const { store } = setup();
    for (const bad of ['', 'a.b', 'A', 'x y', '../x', 'a'.repeat(41)]) expect(() => store.ns(bad), bad).toThrow(RangeError);
    for (const bad of ['', '.x', 'a b', 'a'.repeat(61)]) expect(() => store.ns('g').get(bad, Count, 0), bad).toThrow(RangeError);
  });
});

describe('B4: damaged or foreign values reset that key and nothing else (rule 5)', () => {
  // What v1 crashed on (`ba_runs = "oops"` froze the results screen), and what a stranger's script could leave behind.
  const damaged: [string, string][] = [
    ['a JSON string', JSON.stringify('oops')],
    ['not JSON at all', '{this is not json'],
    ['an empty string', ''],
    ['null', 'null'],
    ['a number', '12345'],
    ['a bare array (v1 format)', '[{"score":1,"world":"alps"}]'],
    ['an envelope without data', '{"v":1}'],
    ['a string version', '{"v":"1","d":[]}'],
    ['a negative version', '{"v":-1,"d":[]}'],
    ['a fractional version', '{"v":1.5,"d":[]}'],
    ['the wrong shape inside the envelope', '{"v":1,"d":{"score":1}}'],
    ['a boolean payload', '{"v":1,"d":true}'],
  ];

  for (const [label, raw] of damaged) {
    it(`${label}: falls back, removes only that key, reports it`, () => {
      const { storage, store, problems } = setup({
        'ba2.runner.runs': raw,
        'ba2.runner.count': '{"v":1,"d":5}',
        'ba2.flight.runs': '{"v":1,"d":[{"score":3,"world":"sky"}]}',
        'unrelated': 'keep me',
        'ba_runs': JSON.stringify('v1 data stays untouched'),
      });
      const ns = store.ns('runner');
      expect(ns.get('runs', Runs, [])).toEqual([]);                       // no TypeError, a usable value
      expect(storage.getItem('ba2.runner.runs')).toBeNull();               // the damaged key was removed
      expect(problems.some((x) => x.kind === 'corrupt' && x.key === 'ba2.runner.runs')).toBe(true);
      // everything else is exactly as it was
      expect(ns.get('count', Count, 0)).toBe(5);
      expect(store.ns('flight').get('runs', Runs, [])).toEqual([{ score: 3, world: 'sky' }]);
      expect(storage.getItem('unrelated')).toBe('keep me');
      expect(storage.getItem('ba_runs')).toBe(JSON.stringify('v1 data stays untouched'));
      // and the key is writable again straight away
      ns.set('runs', [{ score: 9, world: 'alps' }], Runs);
      expect(ns.get('runs', Runs, [])).toEqual([{ score: 9, world: 'alps' }]);
    });
  }

  it('keeps the good entries of a list when one entry is damaged', () => {
    const { store } = setup({ 'ba2.runner.runs': '{"v":1,"d":[{"score":5,"world":"a"},"junk",{"score":"x","world":"b"},{"score":7,"world":"c"}]}' });
    expect(store.ns('runner').get('runs', Runs, [])).toEqual([{ score: 5, world: 'a' }, { score: 7, world: 'c' }]);
  });

  it('never lets a stored object change prototypes or keep undeclared fields', () => {
    const O = schemaOf(1, p.object({ a: p.number() }));
    const raw = '{"v":1,"d":{"a":1,"__proto__":{"polluted":true},"extra":"x"}}';
    const { store } = setup({ 'ba2.g.o': raw });
    const v = store.ns('g').get('o', O, { a: 0 });
    expect(v).toEqual({ a: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const R = schemaOf(1, p.record(p.number(), { lenient: true }));
    const { store: s2 } = setup({ 'ba2.g.r': '{"v":1,"d":{"__proto__":1,"ok":2}}' });
    expect(s2.ns('g').get('r', R, {})).toEqual({ ok: 2 });
    // strict records refuse the whole value instead
    const Strict = schemaOf(1, p.record(p.number()));
    const { store: s3 } = setup({ 'ba2.g.r': '{"v":1,"d":{"__proto__":1,"ok":2}}' });
    expect(s3.ns('g').get('r', Strict, {})).toEqual({});
  });

  it('never accepts NaN or Infinity (1e999 parses to Infinity)', () => {
    const { store } = setup({ 'ba2.g.n': '{"v":1,"d":1e999}' });
    expect(store.ns('g').get('n', Count, 3)).toBe(3);
  });
});

describe('versions and migrations', () => {
  const V2: Schema<{ best: number; day: string }> = {
    version: 2,
    parse: (raw) => {
      const r = p.object({ best: p.number({ min: 0 }), day: p.day() })(raw);
      return r === BAD ? null : r;
    },
    migrate: (raw, from) => {
      // v1 stored a bare number; v2 stores an object
      if (from === 1 && typeof raw === 'number') return { best: raw, day: '2026-01-01' };
      throw new Error(`cannot migrate from v${from}`);
    },
  };

  it('migrates older data once and writes it back in the new format', () => {
    const { storage, store, problems } = setup({ 'ba2.g.best': '{"v":1,"d":4200}' });
    expect(store.ns('g').get('best', V2, { best: 0, day: '2026-01-01' })).toEqual({ best: 4200, day: '2026-01-01' });
    expect(JSON.parse(storage.getItem('ba2.g.best') as string)).toEqual({ v: 2, d: { best: 4200, day: '2026-01-01' } });
    expect(problems).toEqual([]);
  });

  it('falls back and removes the key when the migration throws or its result does not fit', () => {
    const a = setup({ 'ba2.g.best': '{"v":0,"d":4200}' });                       // migrate() throws for v0
    expect(a.store.ns('g').get('best', V2, { best: 1, day: '2026-02-02' })).toEqual({ best: 1, day: '2026-02-02' });
    expect(a.storage.getItem('ba2.g.best')).toBeNull();
    expect(a.problems.map((x) => x.kind)).toEqual(['migration_failed']);
    const b = setup({ 'ba2.g.best': '{"v":1,"d":"not a number"}' });             // migrate() throws for non-numbers
    expect(b.store.ns('g').get('best', V2, { best: 1, day: '2026-02-02' }).best).toBe(1);
    const c = setup({ 'ba2.g.best': '{"v":1,"d":-5}' });                         // migrate() returns {best:-5}: parse refuses
    expect(c.store.ns('g').get('best', V2, { best: 1, day: '2026-02-02' }).best).toBe(1);
    expect(c.problems.map((x) => x.kind)).toEqual(['migration_failed']);
  });

  it('reads newer data best-effort and never deletes what it cannot read', () => {
    const readable = setup({ 'ba2.g.n': '{"v":9,"d":5}' });
    expect(readable.store.ns('g').get('n', Count, 0)).toBe(5);
    expect(readable.storage.getItem('ba2.g.n')).toBe('{"v":9,"d":5}');
    const unreadable = setup({ 'ba2.g.n': '{"v":9,"d":{"new":"shape"}}' });
    expect(unreadable.store.ns('g').get('n', Count, 0)).toBe(0);
    expect(unreadable.storage.getItem('ba2.g.n')).toBe('{"v":9,"d":{"new":"shape"}}');
  });

  it('a set() on a key never read before writes no version, and a later get() accepts it as current', () => {
    const { storage, store } = setup();
    store.ns('g').set('n', 4);
    expect(JSON.parse(storage.getItem('ba2.g.n') as string)).toEqual({ d: 4 });
    expect(store.ns('g').get('n', Count, 0)).toBe(4);
    store.ns('g').set('n', 5);                                  // the version is known now
    expect(JSON.parse(storage.getItem('ba2.g.n') as string)).toEqual({ v: 1, d: 5 });
  });
});

describe('slots', () => {
  it('bind a key to its schema and fallback', () => {
    const { store } = setup();
    const slot = store.ns('g').slot('n', Count, 0);
    expect(slot.get()).toBe(0);
    slot.set(3);
    expect(slot.update((n) => n + 2)).toBe(5);
    expect(slot.get()).toBe(5);
    slot.remove();
    expect(slot.get()).toBe(0);
  });
});

describe('storage that fails', () => {
  function flaky() {
    const inner = memoryStorage();
    const state = { failWrites: false, failReads: false };
    const storage: StorageLike = {
      getItem: (k) => { if (state.failReads) throw new Error('SecurityError'); return inner.getItem(k); },
      setItem: (k, v) => { if (state.failWrites) throw new DOMException('quota', 'QuotaExceededError'); inner.setItem(k, v); },
      removeItem: (k) => inner.removeItem(k),
      key: (i) => inner.key?.(i) ?? null,
      get length() { return inner.length ?? 0; },
    };
    return { storage, state, inner };
  }

  it('keeps a value that could not be written for the rest of the session and reports it', () => {
    const { storage, state, inner } = flaky();
    const problems: StoreProblem[] = [];
    const store = createStore({ storage, onProblem: (x) => problems.push(x) });
    state.failWrites = true;
    const slot = store.ns('g').slot('n', Count, 0);
    slot.set(8);
    expect(inner.getItem('ba2.g.n')).toBeNull();
    expect(slot.get()).toBe(8);                                  // the game goes on
    expect(problems.map((x) => x.kind)).toEqual(['write_failed']);
    state.failWrites = false;
    slot.set(9);                                                 // storage works again: the memory copy is dropped
    expect(JSON.parse(inner.getItem('ba2.g.n') as string)).toEqual({ v: 1, d: 9 });
    expect(slot.get()).toBe(9);
  });

  it('uses the fallback when storage throws on read', () => {
    const { storage, state } = flaky();
    const store = createStore({ storage });
    state.failReads = true;
    expect(store.ns('g').get('n', Count, 4)).toBe(4);
    expect(store.problems().map((x) => x.kind)).toEqual(['read_failed']);
  });

  it('falls back to memory when there is no localStorage at all', () => {
    const store = createStore({ storage: null });
    const slot = store.ns('g').slot('n', Count, 0);
    slot.set(2);
    expect(slot.get()).toBe(2);
  });

  it('does not throw on values it cannot serialise', () => {
    const store = createStore({ storage: memoryStorage() });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => store.ns('g').set('n', cyclic)).not.toThrow();
    expect(store.problems().map((x) => x.kind)).toEqual(['write_failed']);
  });

  it('a faulty onProblem listener cannot break storage', () => {
    const store = createStore({ storage: memoryStorage({ 'ba2.g.n': 'garbage' }), onProblem: () => { throw new Error('listener'); } });
    expect(store.ns('g').get('n', Count, 1)).toBe(1);
  });
});

describe('B13: one date rule', () => {
  it('day() is the local calendar day of the store clock', () => {
    const { store, setNow } = setup();
    setNow(Date.UTC(2026, 9, 23, 23, 30));
    expect(store.day()).toBe('2026-10-23');
    setNow(Date.UTC(2026, 9, 24, 0, 0, 1));
    expect(store.day()).toBe('2026-10-24');
    const nz = createStore({ storage: memoryStorage(), now: () => Date.UTC(2026, 9, 23, 23, 30), timeZone: 'Pacific/Auckland' });
    expect(nz.day()).toBe('2026-10-24');
  });
});

describe('housekeeping', () => {
  it('lists the keys of a namespace and clears only the keys this store wrote', () => {
    const { storage, store } = setup({ 'ba_runs': '[]', 'other.app': 'x' });
    store.ns('runner').set('a', 1, Count);
    store.ns('runner').set('b', 2, Count);
    store.ns('flight').set('c', 3, Count);
    expect(store.ns('runner').keys().sort()).toEqual(['a', 'b']);
    expect(store.ns('runner').has('a')).toBe(true);
    expect(store.ns('runner').has('zzz')).toBe(false);
    expect(store.clearAll()).toBe(3);
    expect(Object.keys(storage.dump()).sort()).toEqual(['ba_runs', 'other.app']);
  });
});
