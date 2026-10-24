// The arcade: everything the shell keeps about the player, behind one object, and ONE call for the moment a round ends.
//
//   recordRun(game, run)   the round is written to that game's progress (runs, bests per difficulty, achievements), its seconds
//                          go to the habit (an active day, the rest days), and the daily challenge is told. What comes back is
//                          what the results screen needs: the game's own outcome, whether this round made the day active,
//                          whether the daily challenge is done, and the streaks as they stand now. It never throws and it
//                          never counts a round that is not one (a summary that was never made, a number, an object without a score).
//   today()                what the home screen shows: the streaks, the challenge, the plan that is running.
//   plans, challenge, habit, progress(game)   the parts themselves.
//   sync                   the streak, the challenge and the plans on a second device (sync-docs.ts).
//
// The pieces are built on one store, so a player has one record and one date rule (B13). The entitlements are not imported:
// `can` and `paid` are passed in, so this module does not depend on how somebody became Pro.
import { RUNNER_ACHIEVEMENTS, RUNNER_DAILY } from './runner-v1.ts';
import type { AchievementDef } from './achievements.ts';
import { createChallengeBook, type ChallengeBook, type ChallengeResult, type ChallengeToday } from './daily-challenge.ts';
import type { DailyGoalSpec } from './daily.ts';
import type { Day } from './date.ts';
import { createHabit, type Habit, type HabitView, type PlayResult } from './habit.ts';
import { importLegacyRunner, type ImportReport } from './legacy.ts';
import { createProgress, sanitizeRun, type Progress, type RecordOutcome, type RunInput } from './progress.ts';
import type { BodyArcadeStore, StorageLike } from './store.ts';
import { createDocSync, type DocSync, type SyncPort } from './sync-docs.ts';
import { createPlanBook, type PlanBook, type PlanGame, type PlanProgress, type PlanRunView } from './workout-plans.ts';

/** What of a game the arcade needs: the manifest has all of it. */
export type ArcadeGame = PlanGame;

/** A game may bring its own achievements, and the runner its daily goal of the live site. */
export interface GameContent { achievements?: readonly AchievementDef[]; daily?: DailyGoalSpec }

/**
 * Where a game keeps its record. Almost always under its own name; Road Run is the live site's runner, and what a returning
 * player brought over from the live site (importLegacy) lives in the namespace the runner always had.
 */
export const GAME_NAMESPACE: Readonly<Record<string, string>> = { 'road-run': 'runner' };

/** What a game starts with when nobody said otherwise: the runner has the live site's fifteen achievements and its daily goal. */
const BUILT_IN: Readonly<Record<string, GameContent>> = { 'road-run': { achievements: RUNNER_ACHIEVEMENTS, daily: RUNNER_DAILY } };

export interface ArcadeOptions {
  store: BodyArcadeStore;
  /** The games of the catalogue right now (the manifests). Asked each time: the catalogue grows. */
  games: () => readonly ArcadeGame[];
  /** The entitlements' can(): 'plan:<id>' and 'game:<id>'. */
  can: (feature: string) => boolean;
  /** A paid plan is active (two rest days a week instead of one). */
  paid?: () => boolean;
  /** The seated setting of the player, when there is one. */
  seated?: () => boolean | null;
  content?: Readonly<Record<string, GameContent>>;
  /** The social client once there is a profile (its loadSync and updateSync); null before. */
  syncPort?: () => SyncPort | null;
  /**
   * False when nothing can be written (the profile is locked, or gone): a round is then answered as not saved, truthfully, instead of
   * being counted by modules whose writes the store refuses. Default: always.
   */
  writable?: () => boolean;
  now?: () => number;
}

export interface RunReport {
  /** The game's own record of the round; `saved` is false for something that was not a round. */
  outcome: RecordOutcome;
  /** The seconds counted for today, whether this round made the day active, rest days used; null when nothing was saved. */
  play: PlayResult | null;
  /** The daily challenge after this round; null when nothing was saved. */
  challenge: ChallengeResult | null;
  /** The streaks as they stand now. */
  habit: HabitView;
}

export interface PlanStepReport {
  /** What recordRun answered for the round of this step. */
  report: RunReport;
  /** The plan after this step; null when the round was not a round, so the step is still to be played (or skipped). */
  progress: PlanProgress | null;
}

export interface TodayView {
  day: Day;
  habit: HabitView;
  challenge: ChallengeToday;
  /** The workout plan that is going (it began today), or null. */
  plan: PlanRunView | null;
}

export interface Arcade {
  readonly store: BodyArcadeStore;
  /** The record of one game: runs, totals, bests per variant and difficulty, achievements. Throws only for a name that is not a game id. */
  progress(game: string): Progress;
  habit: Habit;
  challenge: ChallengeBook;
  plans: PlanBook;
  sync: DocSync;
  recordRun(game: string, run: RunInput | null): RunReport;
  /**
   * A round of the step a workout plan is on has ended: recordRun for that step's game, and the plan moves on. A summary that
   * was never made does not move it (a step is not played because a game handed over nothing). Null when no plan is running.
   */
  finishPlanStep(run: RunInput | null): PlanStepReport | null;
  today(): TodayView;
  /** The live site's record, once, into the runner's place (a returning player). */
  importLegacy(storage: StorageLike): ImportReport;
}

export const namespaceOf = (game: string): string => GAME_NAMESPACE[game] ?? game;

export function createArcade(o: ArcadeOptions): Arcade {
  const { store } = o;
  const games = (): readonly ArcadeGame[] => {
    try { return o.games(); } catch { return []; }
  };
  const habit = createHabit(store, { ...(o.paid ? { paid: o.paid } : {}) });
  const challenge = createChallengeBook(store, { games });
  const plans = createPlanBook(store, { games, can: o.can, ...(o.seated ? { seated: o.seated } : {}) });
  const sync = createDocSync({
    port: o.syncPort ?? (() => null), sources: { habit, challenge, plans }, ...(o.now ? { now: o.now } : {}),
  });
  const cache = new Map<string, Progress>();

  function progress(game: string): Progress {
    let p = cache.get(game);
    if (!p) {
      const content = { ...BUILT_IN[game], ...o.content?.[game] };
      p = createProgress(store, store.ns(namespaceOf(game)), {
        achievements: content.achievements ?? [],
        ...(content.daily ? { daily: content.daily } : {}),
      });
      cache.set(game, p);
    }
    return p;
  }

  // The rest days are used when the player comes back, once, before anything else is shown.
  try { habit.settle(); } catch { /* the streaks are worked out from facts either way */ }

  const unsaved = (run: unknown): RecordOutcome => ({
    saved: false, run: sanitizeRun((run ?? {}) as RunInput, store.now(), store.day()), totals: {}, previousBest: 0, newBest: false, firstHere: false, news: [], daily: null,
  });

  const writable = (): boolean => {
    try { return o.writable ? o.writable() !== false : true; } catch { return false; }
  };

  function recordRun(game: string, run: RunInput | null): RunReport {
    if (!writable()) {
      store.report({ kind: 'rejected', key: `arcade.${String(game).slice(0, 40)}`, detail: 'nothing can be written here (a locked profile): the round was not saved' });
      return { outcome: unsaved(run), play: null, challenge: null, habit: habit.view() };
    }
    let outcome: RecordOutcome;
    try {
      outcome = progress(game).record(run as RunInput);
    } catch (e) {
      store.report({ kind: 'rejected', key: `arcade.${String(game).slice(0, 40)}`, detail: `recordRun failed: ${e instanceof Error ? e.message : String(e)}` });
      outcome = unsaved(run);
    }
    let play: PlayResult | null = null;
    let ch: ChallengeResult | null = null;
    if (outcome.saved) {
      try { play = habit.addPlay(outcome.run.seconds); } catch { /* the round is saved; the streak catches up with the next one */ }
      try { ch = challenge.record({ game, seconds: outcome.run.seconds, newBest: outcome.newBest }); } catch { /* same */ }
    }
    return { outcome, play, challenge: ch, habit: habit.view() };
  }

  return {
    store, progress, habit, challenge, plans, sync, recordRun,

    finishPlanStep(run) {
      const step = plans.active()?.current;
      if (!step) return null;
      const report = recordRun(step.game, run);
      if (!report.outcome.saved) return { report, progress: null };
      return { report, progress: plans.finishStep({ score: report.outcome.run.score, seconds: report.outcome.run.seconds }) };
    },

    today() {
      return { day: store.day(), habit: habit.view(), challenge: challenge.today(), plan: plans.active() };
    },

    importLegacy: (storage) => importLegacyRunner(store, storage, store.ns(namespaceOf('road-run'))),
  };
}
