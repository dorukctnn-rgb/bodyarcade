// The import of the live site's progress (ba_* keys). The live code (site/game/store.js) writes the keys; the import
// reads them and the player must find everything where it was, and then v2 must go on exactly where v1 would have.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { V1_KEYS, importLegacyRunner, readLegacyV1 } from './legacy.ts';
import { createProgress } from './progress.ts';
import { RUNNER_ACHIEVEMENTS, RUNNER_DAILY } from './runner-v1.ts';
import { createStore, memoryStorage, type StorageLike } from './store.ts';

interface V1Run { score: number; dist: number; cleared: number; hits: number; bestCombo: number; coins: number; kcal: number; seconds: number; complete: boolean; diff: string; world: string; ts: number; friend: { name: string; score: number } | null }
interface V1Store {
  afterRun(run: V1Run): { news: string[]; daily: { streak: number } | null };
  dailyGoal(): { seed: number; world: string; kind: string; target: number };
  dailyDone(): boolean;
  dailyStreak(): number;
  totals(): { runs: number; kcal: number; cleared: number; seconds: number };
  best(world?: string): number;
  worldsPlayed(): string[];
  unlocked(): string[];
  runs(): V1Run[];
}

const WORLDS = ['alps', 'desert', 'forest', 'volcano', 'ocean', 'night', 'canyon', 'arctic', 'jungle', 'neon', 'moon'];
const DIFFS = ['easy', 'medium', 'hard', 'insane'];
const LONG = 120_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mem = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
};

let v1: V1Store;
beforeAll(async () => {
  (globalThis as unknown as { localStorage: typeof fakeLocalStorage }).localStorage = fakeLocalStorage;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));
  v1 = (await import(/* @vite-ignore */ new URL('../../../site/game/store.js', import.meta.url).href)) as unknown as V1Store;
});
afterAll(() => {
  vi.useRealTimers();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** One random run, aimed at today's goal half of the time. Both sides get the same numbers. */
function randomRun(r: () => number): V1Run {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const goal = v1.dailyGoal();
  const meet = r() < 0.5;
  let score = Math.floor(r() * 9000);
  let cleared = Math.floor(r() * 30);
  let coins = Math.floor(r() * 60);
  if (meet) {
    if (goal.kind === 'score') score = Math.max(score, goal.target);
    if (goal.kind === 'cleared') cleared = Math.max(cleared, goal.target);
    if (goal.kind === 'coins') coins = Math.max(coins, goal.target);
  }
  return {
    score, cleared, coins,
    dist: Math.floor(r() * 900), hits: r() < 0.3 ? 0 : Math.floor(r() * 5), bestCombo: Math.floor(r() * 32),
    kcal: Math.round(r() * 120) / 10, seconds: Math.floor(r() * 95), complete: r() < 0.5, diff: pick(DIFFS),
    world: meet ? goal.world : pick(WORLDS), ts: Date.now(), friend: r() < 0.2 ? { name: 'Friend', score: Math.floor(r() * 9000) } : null,
  };
}

function playV1Days(seed: number, from: number, days: number): void {
  const r = mulberry32(seed);
  for (let d = from; d < from + days; d++) {
    if (r() < 0.15) continue;
    const runs = 1 + Math.floor(r() * 4);
    for (let k = 0; k < runs; k++) {
      vi.setSystemTime(new Date(2026, 9, 1 + d, 9 + k * 2, Math.floor(r() * 60), 0));
      v1.afterRun(randomRun(r));
    }
  }
}

const freshFrom = (entries: Iterable<[string, string]>): StorageLike & { dump(): Record<string, string> } => memoryStorage(Object.fromEntries(entries));

describe('a returning player finds everything where v1 left it, and v2 goes on as v1 would have', () => {
  it.each([[11, 40], [12, 90], [13, 12]])('seed %i, %i days of live play, then 30 more days on both', (seed, days) => {
    mem.clear();
    playV1Days(seed, 0, days);
    const storage = freshFrom(mem.entries());
    const store = createStore({ storage });
    const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });

    const report = importLegacyRunner(store, storage, store.ns('runner'));
    expect(report.status).toBe('imported');

    const compareNow = (where: string): void => {
      const lt = v1.totals();
      const t = progress.totals();
      expect([t['runs'], t['kcal'], t['cleared'], t['seconds']], `${where}: totals`).toEqual([lt.runs, lt.kcal, lt.cleared, lt.seconds]);
      expect(progress.variants(), `${where}: worlds`).toEqual(v1.worldsPlayed());
      expect(Object.keys(progress.unlocked()).sort(), `${where}: unlocked`).toEqual([...v1.unlocked()].sort());
      expect(progress.best(), `${where}: best`).toBe(v1.best());
      for (const w of WORLDS) expect(progress.best(w), `${where}: best of ${w}`).toBe(v1.best(w));
      const view = progress.daily() as NonNullable<ReturnType<typeof progress.daily>>;
      const g = v1.dailyGoal();
      expect([view.goal.variant, view.goal.kind, view.goal.target, view.goal.seed], `${where}: goal`).toEqual([g.world, g.kind, g.target, g.seed]);
      expect(view.done, `${where}: done today`).toBe(v1.dailyDone());
      if (view.done) expect(progress.streak(), `${where}: streak`).toBe(v1.dailyStreak());
    };
    compareNow('after the import');
    expect(progress.runs().length).toBe(Math.min(200, v1.runs().length));
    expect(progress.runs()[0]?.score).toBe(v1.runs()[0]?.score);

    // ... and then both sides keep going with the same runs.
    const r = mulberry32(seed * 100);
    for (let d = days; d < days + 30; d++) {
      if (r() < 0.15) continue;
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        vi.setSystemTime(new Date(2026, 9, 1 + d, 9 + k * 2, Math.floor(r() * 60), 0));
        const run = randomRun(r);
        const live = v1.afterRun(run);
        const out = progress.record({ score: run.score, seconds: run.seconds, complete: run.complete, variant: run.world, difficulty: run.diff, stats: { cleared: run.cleared, hits: run.hits, bestCombo: run.bestCombo, coins: run.coins, kcal: run.kcal, dist: run.dist }, friend: run.friend });
        expect(out.news.map((a) => a.id).sort(), `day ${d} run ${k}: new unlocks`).toEqual([...live.news].sort());
        expect(out.daily?.streak ?? null, `day ${d} run ${k}: daily`).toBe(live.daily?.streak ?? null);
        compareNow(`day ${d} run ${k}`);
      }
    }
  }, LONG);

  it('leaves every v1 key exactly as it was, and a second import changes nothing', () => {
    mem.clear();
    playV1Days(21, 0, 20);
    const before = Object.fromEntries(mem.entries());
    const storage = freshFrom(mem.entries());
    const store = createStore({ storage });
    const ns = store.ns('runner');
    expect(importLegacyRunner(store, storage, ns).status).toBe('imported');
    for (const k of V1_KEYS) expect(storage.getItem(k), k).toBe(before[k] ?? null);
    const afterFirst = JSON.stringify(storage.dump());
    expect(importLegacyRunner(store, storage, ns).status).toBe('already');
    expect(JSON.stringify(storage.dump())).toBe(afterFirst);
  });

  it('never overwrites progress made in v2 with an older v1 snapshot, even on the next visit', () => {
    mem.clear();
    playV1Days(22, 0, 10);
    const storage = freshFrom(mem.entries());
    const store = createStore({ storage });
    const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });
    importLegacyRunner(store, storage, store.ns('runner'));
    const before = progress.totals()['runs'] as number;
    progress.record({ score: 10, seconds: 20, complete: false, variant: 'alps', difficulty: 'easy' });
    // the player opens the old site again and plays two more runs there
    playV1Days(23, 11, 2);
    for (const [k, v] of mem.entries()) storage.setItem(k, v);
    expect(importLegacyRunner(store, storage, store.ns('runner')).status).toBe('already');
    expect(progress.totals()['runs']).toBe(before + 1);
  });

  it('files v2 progress that already exists as has-data and imports nothing', () => {
    mem.clear();
    playV1Days(24, 0, 5);
    const storage = freshFrom(mem.entries());
    const store = createStore({ storage });
    const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });
    progress.record({ score: 777, seconds: 30, complete: true, variant: 'alps', difficulty: 'easy' });
    const report = importLegacyRunner(store, storage, store.ns('runner'));
    expect(report.status).toBe('has-data');
    expect(progress.totals()['runs']).toBe(1);
    expect(progress.best()).toBe(777);
    expect(importLegacyRunner(store, storage, store.ns('runner')).status).toBe('already');
  });
});

describe('what is in a browser that never saw v1', () => {
  it('has nothing to import and writes nothing', () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    expect(readLegacyV1(storage)).toBeNull();
    expect(importLegacyRunner(store, storage, store.ns('runner')).status).toBe('nothing');
    expect(storage.dump()).toEqual({});
  });

  it('keys that hold only empty things are nothing too, and a later visit to v1 can still be imported', () => {
    const storage = memoryStorage({ ba_runs: '[]', ba_best: '{}', ba_achievements: '[]', ba_worlds: '[]', ba_settings: '{"sound":false}' });
    const store = createStore({ storage });
    expect(importLegacyRunner(store, storage, store.ns('runner')).status).toBe('nothing');
    storage.setItem('ba_worlds', '["alps"]');
    expect(importLegacyRunner(store, storage, store.ns('runner')).status).toBe('imported');
  });
});

describe('B4: damaged and hostile v1 keys', () => {
  const HOSTILE = ['null', '5', '"text"', '[]', '{}', '[null,5,"x",[],{}]', '{"__proto__":{"polluted":1}}', '{not json', '', 'true', '{"a":{"b":{"c":{}}}}'];

  it.each(V1_KEYS.map((k) => [k]))('%s: nothing in it can throw or write rubbish', (key) => {
    for (const text of HOSTILE) {
      const storage = memoryStorage({ [key]: text });
      const store = createStore({ storage });
      const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });
      expect(() => readLegacyV1(storage), `${key}=${text}`).not.toThrow();
      expect(() => importLegacyRunner(store, storage, store.ns('runner')), `${key}=${text}`).not.toThrow();
      expect(progress.runs().length, `${key}=${text}`).toBeLessThanOrEqual(200);
      expect(Object.values(progress.totals()).every((n) => Number.isFinite(n) && n >= 0), `${key}=${text}`).toBe(true);
      expect(() => progress.record({ score: 1, seconds: 1, complete: false, variant: 'alps', difficulty: 'easy' })).not.toThrow();
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    }
  });

  it('a storage that throws on read or write is survived', () => {
    const broken: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } };
    const store = createStore({ storage: memoryStorage() });
    expect(readLegacyV1(broken)).toBeNull();
    expect(importLegacyRunner(store, broken, store.ns('runner')).status).toBe('nothing');
    const writeBroken = memoryStorage({ ba_runs: JSON.stringify([{ world: 'alps', diff: 'easy', score: 5, ts: 1_700_000_000_000, seconds: 10 }]) });
    const s2 = createStore({ storage: { getItem: (k) => writeBroken.getItem(k), setItem: () => { throw new Error('full'); }, removeItem: () => undefined } });
    expect(() => importLegacyRunner(s2, writeBroken, s2.ns('runner'))).not.toThrow();
  });

  it('keeps the good runs among bad ones and clamps what is absurd', () => {
    const ts = Date.UTC(2026, 9, 20, 10);
    const runs = [
      { world: 'alps', diff: 'hard', score: 900, ts, seconds: 50, cleared: 4, kcal: 3.5, hits: 0, coins: 2, bestCombo: 3, dist: 80, complete: true },
      null, 5, 'run', [], {},
      { world: '<img src=x>', diff: 'easy', score: 1, ts },
      { world: 'alps', diff: 'easy', score: 1, ts: -5 },
      { world: 'alps', diff: 'easy', score: 1, ts: 9e15 },
      { world: 'desert', diff: '', score: 1e30, ts: ts + 1, seconds: 9e9, cleared: -3, kcal: 'lots', coins: 1e12 },
      { world: 'forest', score: -40, ts: ts + 2, seconds: Number.NaN },
    ];
    const snap = readLegacyV1(memoryStorage({ ba_runs: JSON.stringify(runs) }));
    expect(snap?.runs.map((r) => r.variant)).toEqual(['alps', 'desert', 'forest']);
    const [a, b, c] = snap?.runs ?? [];
    expect(a).toMatchObject({ score: 900, seconds: 50, difficulty: 'hard', complete: true, day: expect.stringMatching(/^2026-10-2\d$/), stats: { cleared: 4, kcal: 3.5, hits: 0, coins: 2, bestCombo: 3, dist: 80 } });
    expect(b?.score).toBe(1e9);
    expect(b?.seconds).toBe(86_400);
    expect(b?.stats).toEqual({});               // a negative, a string and 1e12 coins are not numbers worth keeping
    expect(b?.difficulty).toBe('unknown');
    expect(c).toMatchObject({ score: 0, seconds: 0 });
  });

  it('caps a handmade history at 200 runs and dedupes ids', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ world: 'alps', diff: 'easy', score: i, ts: 1_700_000_000_000 + i }));
    const snap = readLegacyV1(memoryStorage({ ba_runs: JSON.stringify(many), ba_achievements: JSON.stringify(['first-run', 'first-run', 'Bad Id', 5, 'runs-10']), ba_worlds: JSON.stringify(['alps', 'alps', '<x>', 'desert']) }));
    expect(snap?.runs).toHaveLength(200);
    expect(snap?.achievements).toEqual(['first-run', 'runs-10']);
    expect(snap?.worlds).toEqual(['alps', 'desert']);
  });

  it('drops impossible totals, bests and streaks field by field', () => {
    const snap = readLegacyV1(memoryStorage({
      ba_totals: JSON.stringify({ runs: 12, seconds: -5, kcal: 'x', cleared: 1e15, extra: 9 }),
      ba_best: JSON.stringify({ alps: 5000.4, desert: -1, '<x>': 9, forest: 'high', canyon: 0, neon: 1e12 }),
      ba_daily_done: '20261020',
      ba_daily_streak: JSON.stringify({ n: -4, last: 20261019 }),
    }));
    expect(snap?.totals).toEqual({ runs: 12 });
    expect(snap?.bests).toEqual({ alps: 5000 });
    expect(snap?.daily).toEqual({ done: '2026-10-20', streak: { n: 0, last: '2026-10-19' } });
    const bad = readLegacyV1(memoryStorage({ ba_daily_done: '20261340', ba_daily_streak: JSON.stringify({ n: 1e9, last: 'x' }) }));
    expect(bad?.daily).toEqual({ done: null, streak: { n: 100_000, last: null } });
  });

  it('the profile and settings are checked, not trusted', () => {
    const snap = readLegacyV1(memoryStorage({
      ba_profile: JSON.stringify({ name: 'A'.repeat(50), weight: 500 }),
      ba_settings: JSON.stringify({ world: 'night', diff: '<b>', sound: 'yes', input: 'teleport', skin: 'runner' }),
    }));
    expect(snap?.profile).toEqual({ name: 'A'.repeat(20), weight: null });
    expect(snap?.settings).toEqual({ world: 'night', skin: 'runner' });
    expect(readLegacyV1(memoryStorage({ ba_profile: JSON.stringify({ name: 'Ayşe', weight: 62.5 }) }))?.profile).toEqual({ name: 'Ayşe', weight: 62.5 });
  });
});

describe('the Gumroad key in the snapshot (the entitlements module decides what it is worth)', () => {
  const NOW = Date.UTC(2026, 9, 24, 12);
  const lic = (o: Record<string, unknown>): string => JSON.stringify({ key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', product: 'pro', verifiedAt: NOW - 86_400_000, email: 'bu…@example.com', ...o });
  const read = (o: Record<string, unknown>) => readLegacyV1(memoryStorage({ ba_license: lic(o) }), { now: NOW })?.license ?? null;

  it('keeps key, product, check time and end of the paid period, and never the email', () => {
    expect(read({})).toEqual({ key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', product: 'pro', verifiedAt: NOW - 86_400_000, futureVerifiedAt: false });
    expect(read({ product: 'lifetime', endsAt: NOW + 5 * 86_400_000 })).toMatchObject({ product: 'lifetime', endsAt: NOW + 5 * 86_400_000 });
    expect(JSON.stringify(read({}))).not.toContain('example.com');
  });

  it('marks a check time in the future and does not carry it (B1)', () => {
    expect(read({ verifiedAt: NOW + 10 * 86_400_000 })).toMatchObject({ verifiedAt: 0, futureVerifiedAt: true });
    expect(read({ verifiedAt: NOW + 60_000 })).toMatchObject({ verifiedAt: NOW + 60_000, futureVerifiedAt: false });   // a minute of clock drift is fine
    expect(read({ verifiedAt: 'yesterday' })).toMatchObject({ verifiedAt: 0, futureVerifiedAt: false });
    expect(read({ verifiedAt: -4 })).toMatchObject({ verifiedAt: 0 });
  });

  it('refuses a key that cannot be one and a product that does not exist', () => {
    expect(read({ key: 'short' })).toBeNull();
    expect(read({ key: 'has spaces and <tags> in it' })).toBeNull();
    expect(read({ key: 'A'.repeat(81) })).toBeNull();
    expect(read({ key: 12345678 })).toBeNull();
    expect(read({ product: 'enterprise' })).toBeNull();
    expect(read({ product: undefined })).toBeNull();
  });
});

describe('days follow the player\'s own midnight (B13)', () => {
  const ts = Date.UTC(2026, 9, 23, 22, 30);
  const day = (timeZone: string): string | undefined => readLegacyV1(memoryStorage({ ba_runs: JSON.stringify([{ world: 'alps', diff: 'easy', score: 5, ts }]) }), { timeZone })?.runs[0]?.day;
  it('the same moment is a different day in different places', () => {
    expect(day('Europe/Istanbul')).toBe('2026-10-24');
    expect(day('America/Los_Angeles')).toBe('2026-10-23');
    expect(day('UTC')).toBe('2026-10-23');
  });
});

describe('bests', () => {
  it('a v1 best older than the kept runs is kept under its own bucket and never blocks a new best', () => {
    const ts = Date.UTC(2026, 9, 20, 10);
    const storage = memoryStorage({
      ba_runs: JSON.stringify([{ world: 'alps', diff: 'hard', score: 300, ts }, { world: 'alps', diff: 'easy', score: 200, ts: ts - 1 }]),
      ba_best: JSON.stringify({ alps: 9000, desert: 400 }),
    });
    const store = createStore({ storage, now: () => ts + 86_400_000, timeZone: 'UTC' });
    const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });
    expect(importLegacyRunner(store, storage, store.ns('runner'), { timeZone: 'UTC' }).status).toBe('imported');
    expect(progress.best('alps')).toBe(9000);            // the old record is not lost
    expect(progress.best('alps', 'hard')).toBe(300);     // exact where a kept run proves the difficulty
    expect(progress.best('alps', 'easy')).toBe(200);
    expect(progress.best('desert')).toBe(400);
    const out = progress.record({ score: 350, seconds: 40, complete: true, variant: 'alps', difficulty: 'hard' });
    expect(out.newBest).toBe(true);                      // beats the Hard best (300), not the unplaceable 9000
    expect(progress.best('alps')).toBe(9000);
  });

  it('totals are computed from the kept runs when v1 never kept totals', () => {
    const ts = Date.UTC(2026, 9, 20, 10);
    const storage = memoryStorage({ ba_runs: JSON.stringify([{ world: 'alps', diff: 'easy', score: 5, ts, seconds: 30, kcal: 2, cleared: 3, dist: 100 }, { world: 'alps', diff: 'easy', score: 6, ts: ts - 1, seconds: 20, kcal: 1.5, cleared: 1, dist: 50 }]) });
    const store = createStore({ storage });
    const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });
    importLegacyRunner(store, storage, store.ns('runner'));
    expect(progress.totals()).toEqual({ runs: 2, seconds: 50, kcal: 3.5, cleared: 4 });
  });
});
