// The shell's arcade: S's record of everything the player does (core/store/arcade.ts: runs and bests per game, the habit with
// its week and day streaks, the daily challenge, the workout plans), made from the shell's own parts, and the way a finished
// round is handed to it. The record is facts on one store with one date rule; what the screens show is worked out from them.
import { createArcade, type Arcade } from '../../../core/store/arcade.ts';
import { HABIT, type HabitView } from '../../../core/store/habit.ts';
import type { RunInput, RunRecord } from '../../../core/store/progress.ts';
import type { BodyArcadeStore } from '../../../core/store/store.ts';
import type { SyncPort } from '../../../core/store/sync-docs.ts';
import type { RunSummary } from '../../../core/types/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { SetupState } from '../views/setup.ts';
import { addDays, type Day } from '../../../core/store/date.ts';

export interface ShellArcadeOptions {
  store: BodyArcadeStore;
  /** The catalogue as it is now (the manifests carry what the arcade needs: id, free, seated, lowImpact, durationSec). */
  games: () => readonly ShellGame[];
  /** The entitlements' can(): 'plan:<id>' and 'game:<id>'. */
  can: (feature: string) => boolean;
  /** A paid plan is active (two rest days a week instead of one). */
  paid: () => boolean;
  /** The player's seated setting. */
  seated: () => boolean;
  /** The social client once there is a profile (its loadSync and updateSync); null before. */
  syncPort: () => SyncPort | null;
}

export function makeArcade(o: ShellArcadeOptions): Arcade {
  return createArcade({ store: o.store, games: o.games, can: o.can, paid: o.paid, seated: o.seated, syncPort: o.syncPort });
}

/** The world a game was played in, for the record: the shell has one way to play each game, so there is one. */
export const DEFAULT_VARIANT = 'default';

/** A round that ran to the end of its time (or nearly) is complete; one that ended with the last life is not. */
const COMPLETE_SHARE = 0.9;

const nonNegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * What the arcade is told of a round: the score and the seconds, how it ended, the level it was played on, and the game's own
 * numbers under the names the record knows (`bestCombo` is the live runner's name for the best streak). Calories only when the
 * player gave a weight: an estimate with nothing under it is not kept.
 */
export function runInputOf(i: { game: Pick<ShellGame, 'durationSec'>; setup: Pick<SetupState, 'difficulty'>; summary: RunSummary; kcal: number | null }): RunInput {
  const s = i.summary;
  const stats: Record<string, number> = {};
  const put = (key: string, v: unknown): void => { if (nonNegative(v)) stats[key] = v; };
  put('reps', s.reps);
  put('hits', s.hits);
  put('cleared', s.cleared);
  put('bestStreak', s.bestStreak);
  put('bestCombo', s.bestStreak);
  if (nonNegative(s.quality)) stats['quality'] = Math.round(Math.min(1, s.quality) * 100);
  if (nonNegative(i.kcal)) stats['kcal'] = Math.round(i.kcal);
  return {
    score: s.score,
    seconds: s.seconds,
    complete: nonNegative(s.seconds) && s.seconds >= Math.round(i.game.durationSec * COMPLETE_SHARE),
    variant: DEFAULT_VARIANT,
    difficulty: i.setup.difficulty,
    stats,
  };
}

// ---- the week, from the days the games kept --------------------------------------------------------------------------------

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(day: Day): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The chart is drawn up to this many minutes; a longer day fills the bar. */
export const CHART_TOP_MINUTES = 14;
/** Seconds of play that make a day an active day (the habit's own rule). */
export const ACTIVE_DAY_SECONDS = HABIT.activeDaySeconds;

export interface WeekDay {
  /** Monday is 0. */
  index: number;
  day: Day;
  /** Whole minutes played on this device; null for a day that has not come yet. */
  minutes: number | null;
  today: boolean;
  /** An active day: enough play to count. */
  hit: boolean;
}

export interface WeekStats {
  days: WeekDay[];
  totalMinutes: number;
  /** Active days so far this week and the goal, from the habit (days played on another device count there too). */
  activeDays: number;
  goal: number;
  met: boolean;
  daysLeft: number;
  canStillMeet: boolean;
  weekStreak: number;
  dayStreak: number;
}

/** The seconds played on each day, all games together, from the activity every game keeps. */
export function secondsByDay(arcade: Pick<Arcade, 'progress'>, games: readonly Pick<ShellGame, 'id'>[]): Record<Day, number> {
  const out: Record<Day, number> = {};
  for (const g of games) {
    let activity: Record<Day, { seconds: number }> = {};
    try { activity = arcade.progress(g.id).activity(); } catch { activity = {}; }
    for (const [day, a] of Object.entries(activity)) out[day] = (out[day] ?? 0) + a.seconds;
  }
  return out;
}

/** Monday to Sunday of this week against the active-day line, with the streaks as the habit counts them. */
export function weekStats(seconds: Readonly<Record<Day, number>>, today: Day, habit: HabitView): WeekStats {
  const monday = addDays(today, -weekdayIndex(today));
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const future = day > today;
    const s = seconds[day] ?? 0;
    days.push({ index: i, day, minutes: future ? null : Math.round(s / 60), today: day === today, hit: !future && s >= ACTIVE_DAY_SECONDS });
  }
  return {
    days,
    totalMinutes: days.reduce((n, d) => n + (d.minutes ?? 0), 0),
    activeDays: habit.week.days,
    goal: habit.week.goal,
    met: habit.week.met,
    daysLeft: habit.week.daysLeft,
    canStillMeet: habit.week.canStillMeet,
    weekStreak: habit.weekStreak,
    dayStreak: habit.dayStreak,
  };
}

export interface RecentBest { game: string; score: number; day: Day }

/** The latest round of each game, newest first, with that game's best: for "Recent bests". */
export function recentBests(arcade: Pick<Arcade, 'progress'>, games: readonly Pick<ShellGame, 'id'>[], max = 3): RecentBest[] {
  const last: { game: string; run: RunRecord }[] = [];
  for (const g of games) {
    try {
      const run = arcade.progress(g.id).runs(1)[0];
      if (run) last.push({ game: g.id, run });
    } catch { /* a game with a damaged record is left out of the list */ }
  }
  return last
    .sort((a, b) => b.run.t - a.run.t)
    .slice(0, max)
    .map((x) => ({ game: x.game, score: arcade.progress(x.game).best() || x.run.score, day: x.run.day }));
}

/** The player has played at least one round of any game. */
export function hasPlayed(arcade: Pick<Arcade, 'progress'>, games: readonly Pick<ShellGame, 'id'>[]): boolean {
  return games.some((g) => { try { return (arcade.progress(g.id).totals()['runs'] ?? 0) > 0; } catch { return false; } });
}

