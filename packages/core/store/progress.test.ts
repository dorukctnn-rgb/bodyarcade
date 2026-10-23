// Progress: runs, totals, bests per difficulty (B14), the daily goal and streak on the one date rule (B13),
// achievements, and the guarantee that the results screen always gets an answer (B4).
import { describe, expect, it } from 'vitest';
import type { AchievementDef } from './achievements.ts';
import type { DailyGoalSpec } from './daily.ts';
import { addDays } from './date.ts';
import { createProgress, MAX_RUNS, type RunInput } from './progress.ts';
import { createStore, memoryStorage, type StorageLike } from './store.ts';

const SPEC: DailyGoalSpec = {
  variants: ['alps'],
  kinds: [{ kind: 'score', stat: 'score', base: 1000, step: 0, count: 1, text: 'Score {target}' }],
};

const DEFS: AchievementDef[] = [
  { id: 'first-run', name: 'First', desc: 'x', when: { total: 'runs', gte: 1 } },
  { id: 'runs-3', name: 'Three', desc: 'x', when: { total: 'runs', gte: 3 } },
  { id: 'clean', name: 'Clean', desc: 'x', when: { all: [{ complete: true }, { run: 'hits', eq: 0 }] } },
  { id: 'daily-2', name: 'Two days', desc: 'x', when: { streak: { gte: 2 } } },
  { id: 'rival', name: 'Rival', desc: 'x', when: { beatFriend: true } },
];

const NOON = Date.UTC(2026, 9, 23, 12, 0);
const DAY = 86_400_000;

function setup(o: { timeZone?: string; storage?: StorageLike; start?: number; game?: string } = {}) {
  const storage = o.storage ?? memoryStorage();
  let now = o.start ?? NOON;
  const store = createStore({ storage, now: () => now, timeZone: o.timeZone ?? 'UTC' });
  const progress = createProgress(store, store.ns(o.game ?? 'runner'), { achievements: DEFS, daily: SPEC });
  return { storage, store, progress, setNow: (t: number) => { now = t; }, advance: (ms: number) => { now += ms; } };
}

const run = (over: Partial<RunInput> = {}): RunInput => ({ score: 500, seconds: 60, complete: false, variant: 'alps', difficulty: 'medium', ...over });

describe('runs, totals and variants', () => {
  it('keeps the newest run first and sums the totals, including the stats a game reports', () => {
    const { progress, advance } = setup();
    progress.record(run({ score: 100, seconds: 30, stats: { kcal: 2.5, cleared: 3 } }));
    advance(1000);
    const out = progress.record(run({ score: 200, seconds: 40, variant: 'desert', stats: { kcal: 1.5, cleared: 4 } }));
    expect(progress.runs().map((r) => r.score)).toEqual([200, 100]);
    expect(progress.totals()).toEqual({ runs: 2, seconds: 70, score: 300, kcal: 4, cleared: 7 });
    expect(out.totals).toEqual(progress.totals());
    expect(progress.variants()).toEqual(['alps', 'desert']);
    expect(progress.runs(1)).toHaveLength(1);
    expect(progress.runs(0)).toEqual([]);
  });

  it('stamps every run with the local day of the store', () => {
    const { progress } = setup({ timeZone: 'Pacific/Auckland' });   // 12:00 UTC is 01:00 the next day there
    expect(progress.record(run()).run.day).toBe('2026-10-24');
  });

  it('keeps at most 200 runs, newest first', () => {
    const { progress, advance } = setup();
    for (let i = 0; i < MAX_RUNS + 25; i++) { progress.record(run({ score: i })); advance(10); }
    const list = progress.runs();
    expect(list).toHaveLength(MAX_RUNS);
    expect(list[0]?.score).toBe(MAX_RUNS + 24);
    expect(list.at(-1)?.score).toBe(25);
    expect(progress.totals()['runs']).toBe(MAX_RUNS + 25);   // totals keep counting past the cap
  });

  it('keeps games apart', () => {
    const storage = memoryStorage();
    const a = setup({ storage, game: 'runner' }).progress;
    const b = setup({ storage, game: 'flight' }).progress;
    a.record(run({ score: 900 }));
    expect(b.runs()).toEqual([]);
    expect(b.best()).toBe(0);
    expect(a.best()).toBe(900);
  });
});

describe('B14: a best belongs to a variant and a difficulty', () => {
  it('does not compare an Easy run with an Insane best', () => {
    const { progress } = setup();
    progress.record(run({ score: 16_000, difficulty: 'insane' }));
    const easy1 = progress.record(run({ score: 7000, difficulty: 'easy' }));
    expect(easy1.previousBest).toBe(0);
    expect(easy1.newBest).toBe(false);
    expect(easy1.firstHere).toBe(true);
    const easy2 = progress.record(run({ score: 8000, difficulty: 'easy' }));
    expect(easy2.previousBest).toBe(7000);
    expect(easy2.newBest).toBe(true);
    expect(easy2.firstHere).toBe(false);
    const easy3 = progress.record(run({ score: 8000, difficulty: 'easy' }));
    expect(easy3.newBest).toBe(false);   // a tie is not a new best
  });

  it('answers best() at every level of detail', () => {
    const { progress } = setup();
    progress.record(run({ score: 16_000, difficulty: 'insane' }));
    progress.record(run({ score: 7000, difficulty: 'easy' }));
    progress.record(run({ score: 9000, difficulty: 'easy', variant: 'desert' }));
    expect(progress.best('alps', 'easy')).toBe(7000);
    expect(progress.best('alps', 'insane')).toBe(16_000);
    expect(progress.best('alps')).toBe(16_000);
    expect(progress.best('desert')).toBe(9000);
    expect(progress.best()).toBe(16_000);
    expect(progress.best('forest')).toBe(0);
    expect(progress.best('alps', 'hard')).toBe(0);
  });

  it('a variant whose name starts the same does not leak into best(variant)', () => {
    const { progress } = setup();
    progress.record(run({ score: 5000, variant: 'alps-night' }));
    expect(progress.best('alps')).toBe(0);
  });
});

describe('B13 and the daily goal', () => {
  it('meets the goal once a day, only on the goal variant, only when the stat reaches the target', () => {
    const { progress, advance } = setup();
    expect(progress.record(run({ score: 999 })).daily).toBeNull();                 // below target
    expect(progress.record(run({ score: 5000, variant: 'desert' })).daily).toBeNull(); // wrong variant
    expect(progress.daily().done).toBe(false);
    const hit = progress.record(run({ score: 1000 }));
    expect(hit.daily?.streak).toBe(1);
    expect(hit.daily?.goal.target).toBe(1000);
    expect(progress.daily().done).toBe(true);
    advance(1000);
    expect(progress.record(run({ score: 9000 })).daily).toBeNull();                // already done today
    expect(progress.streak()).toBe(1);
  });

  it('counts a streak across days and restarts it after a missed day', () => {
    const { progress, advance } = setup();
    expect(progress.record(run({ score: 2000 })).daily?.streak).toBe(1);
    advance(DAY);
    expect(progress.record(run({ score: 2000 })).daily?.streak).toBe(2);
    advance(DAY);
    expect(progress.record(run({ score: 2000 })).daily?.streak).toBe(3);
    advance(2 * DAY);                                                              // a day with no goal in between
    expect(progress.streak()).toBe(0);                                             // dead streaks show 0, not 3
    expect(progress.record(run({ score: 2000 })).daily?.streak).toBe(1);
  });

  it('a streak is alive today and yesterday, dead before that', () => {
    const { progress, advance } = setup();
    progress.record(run({ score: 2000 }));
    expect(progress.streak()).toBe(1);
    advance(DAY);
    expect(progress.streak()).toBe(1);        // yesterday's goal can still be extended today
    advance(DAY);
    expect(progress.streak()).toBe(0);
  });

  it('the day changes at the player\'s own midnight, not at UTC midnight', () => {
    // 2026-10-23 23:30 in Honolulu is 2026-10-24 09:30 UTC. One run before and one after local midnight.
    const honolulu = Date.UTC(2026, 9, 24, 9, 30);
    const a = setup({ timeZone: 'Pacific/Honolulu', start: honolulu });
    expect(a.progress.record(run({ score: 2000 })).daily?.streak).toBe(1);
    a.advance(60 * 60_000);                                                        // 00:30 local the next day
    expect(a.progress.daily().done).toBe(false);
    expect(a.progress.record(run({ score: 2000 })).daily?.streak).toBe(2);

    // Same instants in Auckland (UTC+13): both runs are on the same local day.
    const b = setup({ timeZone: 'Pacific/Auckland', start: honolulu });
    expect(b.progress.record(run({ score: 2000 })).daily?.streak).toBe(1);
    b.advance(60 * 60_000);
    expect(b.progress.record(run({ score: 2000 })).daily).toBeNull();
  });

  it('daily() describes any day without changing state', () => {
    const { progress } = setup();
    const tomorrow = addDays('2026-10-23', 1);
    expect(progress.daily(tomorrow).goal.day).toBe(tomorrow);
    expect(progress.daily().text('en')).toBe('Score 1,000');
    expect(progress.daily().done).toBe(false);
  });

  it('a clock that goes back never extends a streak', () => {
    const { progress, setNow } = setup();
    progress.record(run({ score: 2000 }));
    setNow(NOON + DAY);
    progress.record(run({ score: 2000 }));
    expect(progress.streak()).toBe(2);
    setNow(NOON - 5 * DAY);
    expect(progress.record(run({ score: 2000 })).daily?.streak).toBe(1);
  });
});

describe('achievements', () => {
  it('unlocks once, in list order, and remembers when', () => {
    const { progress, advance } = setup();
    const first = progress.record(run({ complete: true, stats: { hits: 0 } }));
    expect(first.news.map((d) => d.id)).toEqual(['first-run', 'clean']);
    advance(1000);
    const second = progress.record(run({ complete: true, stats: { hits: 0 } }));
    expect(second.news.map((d) => d.id)).toEqual([]);
    advance(1000);
    expect(progress.record(run()).news.map((d) => d.id)).toEqual(['runs-3']);
    const list = progress.achievements();
    expect(list.map((a) => a.def.id)).toEqual(DEFS.map((d) => d.id));
    expect(list.find((a) => a.def.id === 'first-run')?.unlockedAt).toBe(NOON);
    expect(list.find((a) => a.def.id === 'rival')?.unlockedAt).toBeNull();
    expect(Object.keys(progress.unlocked()).sort()).toEqual(['clean', 'first-run', 'runs-3']);
  });

  it('a streak achievement unlocks on the run that extends the streak, not on an ordinary run later', () => {
    const { progress, advance } = setup();
    progress.record(run({ score: 2000 }));
    advance(DAY);
    expect(progress.record(run({ score: 2000 })).news.map((d) => d.id)).toContain('daily-2');
  });

  it('a friend challenge is beaten only with a higher score', () => {
    const { progress } = setup();
    expect(progress.record(run({ score: 500, friend: { score: 500 } })).news.map((d) => d.id)).not.toContain('rival');
    expect(progress.record(run({ score: 501, friend: { score: 500 } })).news.map((d) => d.id)).toContain('rival');
    expect(progress.record(run({ score: 900, friend: { score: Number.NaN } })).news.map((d) => d.id)).toEqual(['runs-3']);
  });
});

describe('activity', () => {
  it('sums runs, seconds and the best score per local day', () => {
    const { progress, advance } = setup();
    progress.record(run({ score: 100, seconds: 30 }));
    progress.record(run({ score: 400, seconds: 20 }));
    advance(DAY);
    progress.record(run({ score: 50, seconds: 10 }));
    expect(progress.activity()).toEqual({
      '2026-10-23': { runs: 2, seconds: 50, best: 400 },
      '2026-10-24': { runs: 1, seconds: 10, best: 50 },
    });
  });

  it('keeps about a year and drops the oldest days', () => {
    const { progress, advance } = setup();
    for (let i = 0; i < 420; i++) { progress.record(run()); advance(DAY); }
    const days = Object.keys(progress.activity()).sort();
    expect(days).toHaveLength(400);
    expect(days[0]).toBe(addDays('2026-10-23', 20));
  });
});

describe('B4: the results screen always gets an answer', () => {
  it('survives every damaged key and resets only that key', () => {
    const keys = ['runs', 'totals', 'bests', 'variants', 'ach', 'daily', 'activity'];
    for (const key of keys) {
      const storage = memoryStorage();
      const { progress } = setup({ storage });
      progress.record(run({ score: 700, stats: { cleared: 2 } }));
      const before = storage.dump();
      storage.setItem(`ba2.runner.${key}`, JSON.stringify({ v: 1, d: 'oops' }));
      const out = progress.record(run({ score: 800 }));
      expect(out.run.score, key).toBe(800);
      for (const other of keys) {
        if (other === key || !(`ba2.runner.${other}` in before)) continue;
        expect(JSON.parse(storage.getItem(`ba2.runner.${other}`) ?? 'null'), `${key} damaged, ${other} untouched`).not.toBeNull();
      }
    }
  });

  it('survives a v1-style bare string and a bare array in the keys', () => {
    const storage = memoryStorage({ 'ba2.runner.runs': '"oops"', 'ba2.runner.totals': '[1,2]', 'ba2.runner.bests': 'null' });
    const { progress } = setup({ storage });
    const out = progress.record(run({ score: 321 }));
    expect(out.run.score).toBe(321);
    expect(progress.runs().map((r) => r.score)).toEqual([321]);
  });

  it('drops one damaged run and keeps the rest of the history', () => {
    const good = { t: NOON, day: '2026-10-23', score: 10, seconds: 5, variant: 'alps', difficulty: 'easy', complete: false, stats: {} };
    const storage = memoryStorage({ 'ba2.runner.runs': JSON.stringify({ v: 1, d: [good, { nope: true }, { ...good, score: 20 }, 'x'] }) });
    const { progress } = setup({ storage });
    expect(progress.runs().map((r) => r.score)).toEqual([10, 20]);
  });

  it('never throws, whatever a game hands over', () => {
    const { progress } = setup();
    const garbage: unknown[] = [
      null, undefined, 5, 'x', [], {},
      { score: Number.NaN, seconds: -5, variant: 7, difficulty: null, complete: 'yes', stats: 5 },
      { score: Number.POSITIVE_INFINITY, seconds: Number.POSITIVE_INFINITY, variant: '__proto__', difficulty: '../x', stats: { __proto__: 1, 'a b': 2, ok: 3, bad: Number.NaN } },
      { score: 1e30, seconds: 1e30, variant: 'x'.repeat(500), difficulty: '' },
    ];
    for (const g of garbage) expect(() => progress.record(g as RunInput)).not.toThrow();
    const last = progress.runs()[0];
    expect(last?.score).toBeLessThanOrEqual(1_000_000_000);
    for (const r of progress.runs()) {
      expect(Number.isFinite(r.score) && r.score >= 0).toBe(true);
      expect(Number.isFinite(r.seconds) && r.seconds >= 0 && r.seconds <= 86_400).toBe(true);
    }
  });

  it('clamps stats to finite non-negative numbers with safe names', () => {
    const { progress } = setup();
    const out = progress.record(run({ stats: { ok: 3, neg: -1, nan: Number.NaN, 'bad key': 1, '9x': 1, huge: 1e30 } }));
    expect(out.run.stats).toEqual({ ok: 3, huge: 1_000_000_000 });
  });

  it('keeps working when the storage refuses every write', () => {
    const real = memoryStorage();
    const failing: StorageLike = { getItem: (k) => real.getItem(k), setItem: () => { throw new Error('quota'); }, removeItem: (k) => real.removeItem(k) };
    const { progress, store } = setup({ storage: failing });
    const out = progress.record(run({ score: 640 }));
    expect(out.run.score).toBe(640);
    expect(progress.runs().map((r) => r.score)).toEqual([640]);   // held in memory for the session
    expect(store.problems().some((p) => p.kind === 'write_failed')).toBe(true);
  });
});
