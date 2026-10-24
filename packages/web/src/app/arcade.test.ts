// What the shell hands the arcade and reads back: a round as the record wants it, the week from the days the games kept, the
// streaks as the habit counts them, the recent bests. The arcade is S's real one, on a memory store with a clock the test moves.
import { describe, expect, it } from 'vitest';
import { createArcade, type Arcade } from '../../../core/store/arcade.ts';
import { HABIT } from '../../../core/store/habit.ts';
import { createStore, memoryStorage } from '../../../core/store/store.ts';
import type { RunSummary } from '../../../core/types/index.ts';
import { ACTIVE_DAY_SECONDS, hasPlayed, makeArcade, recentBests, runInputOf, secondsByDay, weekdayIndex, weekStats } from './arcade.ts';

const DAY = 86_400_000;
/** Monday 19 October 2026, noon in UTC: the week of the tests runs from here to Sunday the 25th. */
const MONDAY = Date.UTC(2026, 9, 19, 12);
const GAMES = [
  { id: 'squat-flap', free: true, seated: true, lowImpact: false, durationSec: 90 },
  { id: 'knee-sprint', free: true, seated: true, lowImpact: false, durationSec: 180 },
  { id: 'star-catch', free: true, seated: true, lowImpact: true, durationSec: 180 },
];

function arcadeOn(storage: ReturnType<typeof memoryStorage>, at: number): Arcade {
  return createArcade({ store: createStore({ storage, now: () => at, timeZone: 'UTC' }), games: () => GAMES, can: () => true });
}

const summary = (o: Partial<RunSummary> = {}): RunSummary => ({ score: 20, seconds: 90, metSeconds: 450, log: [], ...o });

describe('a round as the record wants it', () => {
  const game = { durationSec: 90 };

  it('keeps the score, the seconds, the level, and the numbers the game reports under the names the record knows', () => {
    const r = runInputOf({ game, setup: { difficulty: 'hard' }, summary: summary({ reps: 14, hits: 12, cleared: 9, bestStreak: 6, quality: 0.824 }), kcal: 5.4 });
    expect(r).toMatchObject({ score: 20, seconds: 90, difficulty: 'hard', variant: 'default', complete: true });
    expect(r.stats).toEqual({ reps: 14, hits: 12, cleared: 9, bestStreak: 6, bestCombo: 6, quality: 82, kcal: 5 });
  });

  it('leaves out what is not a number, what is negative, and calories nobody can work out', () => {
    const r = runInputOf({ game, setup: { difficulty: 'normal' }, summary: summary({ reps: Number.NaN, hits: -3, quality: 3 }), kcal: null });
    expect(r.stats).toEqual({ quality: 100 });
  });

  it('is complete when the time ran out, not when the last life went early', () => {
    expect(runInputOf({ game, setup: { difficulty: 'normal' }, summary: summary({ seconds: 90 }), kcal: null }).complete).toBe(true);
    expect(runInputOf({ game, setup: { difficulty: 'normal' }, summary: summary({ seconds: 82 }), kcal: null }).complete).toBe(true);
    expect(runInputOf({ game, setup: { difficulty: 'normal' }, summary: summary({ seconds: 40 }), kcal: null }).complete).toBe(false);
  });

  it('is accepted by the record as a round, and a round that is not one is not counted', () => {
    const arcade = arcadeOn(memoryStorage(), MONDAY);
    const ok = arcade.recordRun('squat-flap', runInputOf({ game, setup: { difficulty: 'normal' }, summary: summary(), kcal: null }));
    expect(ok.outcome.saved).toBe(true);
    expect(arcade.progress('squat-flap').best()).toBe(20);
    expect(arcade.recordRun('squat-flap', null).outcome.saved).toBe(false);
  });
});

describe('the week', () => {
  it('knows Monday from Sunday', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0);
    expect(weekdayIndex('2026-10-25')).toBe(6);
  });

  function weekOfPlay(): { storage: ReturnType<typeof memoryStorage>; wednesday: Arcade } {
    const storage = memoryStorage();
    // Monday: a short round (not enough for an active day), Tuesday: an active day, Wednesday: two rounds that add up to one.
    arcadeOn(storage, MONDAY).recordRun('squat-flap', { score: 5, seconds: 90, complete: true, variant: 'default', difficulty: 'normal' });
    arcadeOn(storage, MONDAY + DAY).recordRun('knee-sprint', { score: 120, seconds: 240, complete: true, variant: 'default', difficulty: 'normal' });
    arcadeOn(storage, MONDAY + 2 * DAY).recordRun('squat-flap', { score: 9, seconds: 100, complete: true, variant: 'default', difficulty: 'normal' });
    const wednesday = arcadeOn(storage, MONDAY + 2 * DAY + 3_600_000);
    wednesday.recordRun('star-catch', { score: 30, seconds: 100, complete: true, variant: 'default', difficulty: 'normal' });
    return { storage, wednesday };
  }

  it('adds up the seconds of every game on the day they were played', () => {
    const { wednesday } = weekOfPlay();
    const seconds = secondsByDay(wednesday, GAMES);
    expect(seconds).toEqual({ '2026-10-19': 90, '2026-10-20': 240, '2026-10-21': 200 });
  });

  it('draws Monday to Sunday with minutes for the days gone, nothing for the days to come, and the active days marked', () => {
    const { wednesday } = weekOfPlay();
    const w = weekStats(secondsByDay(wednesday, GAMES), '2026-10-21', wednesday.habit.view());
    expect(w.days.map((d) => d.minutes)).toEqual([2, 4, 3, null, null, null, null]);
    expect(w.days.map((d) => d.hit)).toEqual([false, true, true, false, false, false, false]);
    expect(w.days.map((d) => d.today)).toEqual([false, false, true, false, false, false, false]);
    expect(w.totalMinutes).toBe(9);
    expect(ACTIVE_DAY_SECONDS).toBe(HABIT.activeDaySeconds);
  });

  it('takes the goal and the streaks from the habit: two active days of three, a day streak of two, no week streak yet', () => {
    const { wednesday } = weekOfPlay();
    const w = weekStats(secondsByDay(wednesday, GAMES), '2026-10-21', wednesday.habit.view());
    expect(w).toMatchObject({ activeDays: 2, goal: 3, met: false, canStillMeet: true, weekStreak: 0, dayStreak: 2 });
    expect(w.daysLeft).toBe(5);
  });

  it('reaches the goal on the third active day, and the week counts as a streak of one', () => {
    const { storage } = weekOfPlay();
    const thursday = arcadeOn(storage, MONDAY + 3 * DAY);
    const r = thursday.recordRun('squat-flap', { score: 14, seconds: 200, complete: true, variant: 'default', difficulty: 'normal' });
    expect(r.play?.becameActive).toBe(true);
    const w = weekStats(secondsByDay(thursday, GAMES), '2026-10-22', thursday.habit.view());
    expect(w).toMatchObject({ activeDays: 3, met: true, weekStreak: 1, dayStreak: 3 });
  });
});

describe('what the home page lists', () => {
  it('knows when nothing was ever played', () => {
    const arcade = arcadeOn(memoryStorage(), MONDAY);
    expect(hasPlayed(arcade, GAMES)).toBe(false);
    expect(recentBests(arcade, GAMES)).toEqual([]);
    arcade.recordRun('star-catch', { score: 3, seconds: 70, complete: true, variant: 'default', difficulty: 'normal' });
    expect(hasPlayed(arcade, GAMES)).toBe(true);
  });

  it('lists the latest round of each game, newest first, with the best of that game', () => {
    const storage = memoryStorage();
    arcadeOn(storage, MONDAY).recordRun('squat-flap', { score: 30, seconds: 90, complete: true, variant: 'default', difficulty: 'normal' });
    arcadeOn(storage, MONDAY + DAY).recordRun('knee-sprint', { score: 150, seconds: 90, complete: true, variant: 'default', difficulty: 'normal' });
    arcadeOn(storage, MONDAY + 2 * DAY).recordRun('squat-flap', { score: 12, seconds: 90, complete: true, variant: 'default', difficulty: 'normal' });
    const arcade = arcadeOn(storage, MONDAY + 2 * DAY + 1000);
    expect(recentBests(arcade, GAMES)).toEqual([
      { game: 'squat-flap', score: 30, day: '2026-10-21' },
      { game: 'knee-sprint', score: 150, day: '2026-10-20' },
    ]);
    expect(recentBests(arcade, GAMES, 1)).toHaveLength(1);
  });

  it('makes the shell\'s arcade from its parts without asking anything of a server', () => {
    const arcade = makeArcade({ store: createStore({ storage: memoryStorage(), now: () => MONDAY, timeZone: 'UTC' }), games: () => [], can: () => false, paid: () => false, seated: () => false, syncPort: () => null });
    expect(arcade.today().challenge.challenge).toBeNull();
    expect(arcade.plans.list().length).toBe(5);
  });
});
