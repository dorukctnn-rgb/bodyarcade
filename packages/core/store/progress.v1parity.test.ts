// Differential test: the runner's achievements and daily goal, as data run through createProgress, must behave exactly
// like the live site's afterRun (site/game/store.js) over a long simulated history: same unlocked ids, same daily
// goal, same streaks, same totals, same worlds, same best per world. Anything v2 does differently on purpose
// (bests per difficulty, a dead streak showing 0, no free-run counter) is not compared here and has its own test.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProgress } from './progress.ts';
import { RUNNER_ACHIEVEMENTS, RUNNER_DAILY } from './runner-v1.ts';
import { createStore, memoryStorage } from './store.ts';

interface V1Run { score: number; dist: number; cleared: number; hits: number; bestCombo: number; coins: number; kcal: number; seconds: number; complete: boolean; diff: string; world: string; ts: number; friend: { name: string; score: number } | null }
interface V1Store {
  afterRun(run: V1Run): { news: string[]; daily: { streak: number } | null };
  dailyGoal(): { seed: number; world: string; kind: string; target: number; text: string };
  dailyDone(): boolean;
  dailyStreak(): number;
  totals(): { runs: number; kcal: number; cleared: number; seconds: number };
  best(world?: string): number;
  worldsPlayed(): string[];
  unlocked(): string[];
}

/** The simulations are heavy on a busy machine (the default 5 s is not enough); same 60 s idea as the other long unit tests. */
const LONG = 120_000;

const WORLDS = ['alps', 'desert', 'forest', 'volcano', 'ocean', 'night', 'canyon', 'arctic', 'jungle', 'neon', 'moon'];
const DIFFS = ['easy', 'medium', 'hard', 'insane'];

/** A small deterministic generator, so a failure can be replayed. */
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
  const url = new URL('../../../site/game/store.js', import.meta.url).href;
  v1 = (await import(/* @vite-ignore */ url)) as unknown as V1Store;
});

afterAll(() => {
  vi.useRealTimers();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function simulate(seed: number, days: number, skipChance: number): void {
  mem.clear();
  const r = mulberry32(seed);
  const storage = memoryStorage();
  const store = createStore({ storage });          // local time zone, the same clock the live code reads
  const progress = createProgress(store, store.ns('runner'), { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY });
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  let compared = 0;

  for (let d = 0; d < days; d++) {
    if (r() < skipChance) continue;                 // a missed day breaks the streak
    const runsToday = 1 + Math.floor(r() * 4);
    for (let k = 0; k < runsToday; k++) {
      vi.setSystemTime(new Date(2026, 9, 1 + d, 9 + k * 2, Math.floor(r() * 60), 0));
      const goal = v1.dailyGoal();
      const meetGoal = r() < 0.5;
      const world = meetGoal ? goal.world : pick(WORLDS);
      let score = Math.floor(r() * 9000);
      let cleared = Math.floor(r() * 30);
      let coins = Math.floor(r() * 60);
      if (meetGoal) {
        if (goal.kind === 'score') score = Math.max(score, goal.target + Math.floor(r() * 500));
        if (goal.kind === 'cleared') cleared = Math.max(cleared, goal.target);
        if (goal.kind === 'coins') coins = Math.max(coins, goal.target);
      }
      const hits = r() < 0.3 ? 0 : Math.floor(r() * 5);
      const complete = r() < 0.5;
      const diff = pick(DIFFS);
      const bestCombo = Math.floor(r() * 32);
      const kcal = Math.round(r() * 120) / 10;
      const seconds = Math.floor(r() * 95);
      const dist = Math.floor(r() * 900);
      const friend = r() < 0.2 ? { name: 'Friend', score: Math.floor(r() * 9000) } : null;

      const live = v1.afterRun({ score, dist, cleared, hits, bestCombo, coins, kcal, seconds, complete, diff, world, ts: Date.now(), friend });
      const out = progress.record({ score, seconds, complete, variant: world, difficulty: diff, stats: { cleared, hits, bestCombo, coins, kcal, dist }, friend });

      const where = `seed ${seed}, day ${d}, run ${k}`;
      expect([...out.news.map((a) => a.id)].sort(), `${where}: unlocked now`).toEqual([...live.news].sort());
      expect(out.daily?.streak ?? null, `${where}: daily`).toBe(live.daily?.streak ?? null);

      const lt = v1.totals();
      const t = progress.totals();
      expect(t['runs'], `${where}: runs`).toBe(lt.runs);
      expect(t['cleared'], `${where}: cleared`).toBe(lt.cleared);
      expect(t['seconds'], `${where}: seconds`).toBe(lt.seconds);
      expect(t['kcal'], `${where}: kcal`).toBe(lt.kcal);

      expect(progress.best(world), `${where}: best of ${world}`).toBe(v1.best(world));
      expect(progress.best(), `${where}: best overall`).toBe(v1.best());
      expect(progress.variants(), `${where}: worlds played`).toEqual(v1.worldsPlayed());
      expect(Object.keys(progress.unlocked()).sort(), `${where}: all unlocked`).toEqual([...v1.unlocked()].sort());

      const view = progress.daily() as NonNullable<ReturnType<typeof progress.daily>>;
      const g = v1.dailyGoal();
      expect([view.goal.variant, view.goal.kind, view.goal.target, view.goal.seed], `${where}: goal`).toEqual([g.world, g.kind, g.target, g.seed]);
      expect(view.done, `${where}: done`).toBe(v1.dailyDone());
      if (view.done) expect(progress.streak(), `${where}: streak`).toBe(v1.dailyStreak());
      compared++;
    }
  }
  expect(compared).toBeGreaterThan(days);           // the simulation really ran
}

describe('createProgress with the runner data matches the live site (site/game/store.js)', () => {
  it('over 150 simulated days with a missed day now and then', () => { simulate(1, 150, 0.2); }, LONG);
  it('over 150 simulated days of near-daily play (long streaks, daily-3 and daily-7)', () => { simulate(2, 150, 0.03); }, LONG);
  it('over 60 days of heavy play (50 and more runs, all worlds, kcal thresholds)', () => { simulate(3, 60, 0); }, LONG);
  it('over three more seeds', () => { simulate(4, 90, 0.1); simulate(5, 90, 0.1); simulate(6, 90, 0.1); }, LONG);

  it('the unlocked daily streak achievements really appear in the simulation (the test is not vacuous)', () => {
    simulate(2, 150, 0.03);
    const ids = v1.unlocked();
    expect(ids).toContain('daily-3');
    expect(ids).toContain('daily-7');
    expect(ids).toContain('all-free');
  }, LONG);
});
