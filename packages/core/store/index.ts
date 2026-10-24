// core/store: the public surface. Games and the shell import from here; the rest of the folder is the store's own parts.
//
//   createStore(...)        namespaced, schema-checked local storage with one date rule (B4, B13)
//   createProgress(...)     runs, totals, bests per variant and difficulty (B14), achievements and the daily goal
//   importLegacyRunner(...) the live site's ba_* keys, once
//   challengeLink/readChallenge  friend challenge links
export { dayOf, addDays, prevDay, daysBetween, daySeed, dayFromSeed, parseDay, isDay, type Day } from './date.ts';
export { p, schemaOf, BAD, type Parser, type Infer } from './schema.ts';
export {
  createStore, memoryStorage, browserStorage,
  type BodyArcadeStore, type Slot, type StorageLike, type StoreNamespace, type StoreOptions, type StoreProblem,
} from './store.ts';
export {
  newlyUnlocked, holds, isCond, assertAchievementDefs,
  type AchievementContext, type AchievementDef, type Cond,
} from './achievements.ts';
export {
  dailyGoalFor, goalText, nextStreak, lcg,
  type DailyGoal, type DailyGoalKind, type DailyGoalSpec,
} from './daily.ts';
export {
  createProgress, sanitizeRun, isRunInput, bestKey, MAX_RUNS, LEGACY_DIFFICULTY,
  type DailyState, type DailyView, type DayActivity, type Progress, type ProgressOptions, type RecordOutcome, type RunInput, type RunRecord, type Totals,
} from './progress.ts';
export { RUNNER_ACHIEVEMENTS, RUNNER_DAILY } from './runner-v1.ts';
export {
  importLegacyRunner, readLegacyV1, V1_KEYS,
  type ImportReport, type LegacyLicense, type LegacyOptions, type LegacyV1,
} from './legacy.ts';
export { challengeLink, readChallenge, MAX_CHALLENGE_SCORE, CHALLENGE_NAME_MAX, type Challenge, type ChallengeInput } from './challenge.ts';
