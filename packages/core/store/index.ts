// core/store: the public surface. Games and the shell import from here; the rest of the folder is the store's own parts.
//
//   createStore(...)        namespaced, schema-checked local storage with one date rule (B4, B13)
//   createProgress(...)     runs, totals, bests per variant and difficulty (B14), achievements and the daily goal
//   importLegacyRunner(...) the live site's ba_* keys, once
//   challengeLink/readChallenge  friend challenge links
//   createArcade(...)       all of it behind one object, and recordRun(): the one call for the moment a round ends
//   createHabit / createChallengeBook / createPlanBook   the streaks, the daily challenge, the workout plans (also on their own)
//   createDocSync(...)      the three of them on a second device, through the social client's documents
//   createProfileBook(...)  up to six players on one device (the Family plan), a record each; the parent gate; who has the online identity
export { dayOf, addDays, prevDay, daysBetween, daySeed, dayFromSeed, parseDay, isDay, weekdayIndex, weekStart, monthOf, type Day } from './date.ts';
export {
  EMPTY_DAYS, hasDay, withDay, mergeDays, daysOf, countDays, lastDay, pruneDays, dropAfter, sameDays, daySetParser, type DaySet,
} from './dayset.ts';
export {
  HABIT, createHabit, describeHabit, settlement, emptyHabitDoc, readHabitDoc, mergeHabitDocs,
  type Habit, type HabitDoc, type HabitOptions, type HabitView, type HabitWeek, type PlayResult,
} from './habit.ts';
export {
  CHALLENGE, createChallengeBook, dailyChallengeFor, meetsChallenge, emptyChallengeDoc, readChallengeDoc, mergeChallengeDocs, hash32,
  type ChallengeBook, type ChallengeDay, type ChallengeDoc, type ChallengeGame, type ChallengeOptions, type ChallengeResult, type ChallengeRun,
  type ChallengeToday, type DailyChallenge,
} from './daily-challenge.ts';
export {
  FREE_PLAN_ID, WORKOUT_PLANS, WORKOUT_PLAN_IDS, PLANS_DOC_BUDGET, createPlanBook, resolvePlan, planById, planFeature, seatedFor, isWorkoutPlanId,
  emptyPlansDoc, readPlansDoc, mergePlansDocs,
  type PlanAudience, type PlanBook, type PlanBookOptions, type PlanCard, type PlanGame, type PlanProgress, type PlanRun, type PlanRunView, type PlanSeating,
  type PlanStep, type PlanStepResult, type PlansDoc, type ResolvedPlan, type ResolvedStep, type SkippedStep, type StartResult, type StepDifficulty,
  type WorkoutPlan, type WorkoutPlanId,
} from './workout-plans.ts';
export {
  DOC_KEYS, createDocSync, type DocKey, type DocSync, type DocSyncOptions, type SyncFailure, type SyncPort, type SyncReport, type SyncSources, type SyncedDocument,
} from './sync-docs.ts';
export {
  createArcade, namespaceOf, GAME_NAMESPACE,
  type Arcade, type ArcadeGame, type ArcadeOptions, type GameContent, type PlanStepReport, type RunReport, type TodayView,
} from './arcade.ts';
export {
  GATE, createParentGate,
  type GateAnswer, type GateAsk, type GateQuestion, type ParentGate, type ParentGateOptions,
} from './parent-gate.ts';
export {
  MAX_PROFILES, PROFILES_FEATURE, OWNER_ID, DEVICE_NAMESPACES, AVATARS, NAME_MAX, REMOVAL_VALID_MS, TOUCH_EVERY_MS,
  createProfileBook, rulesFor, defaultsFor, normalizeName, watchOnline,
  type AvatarId, type Capacity, type CreateFailure, type CreateResult, type FamilyEntry, type MigrationReport, type NameFailure, type NewProfile,
  type OnlinePort, type PickerModel, type ProfileBook, type ProfileBookOptions, type ProfileDefaults, type ProfileEvent, type ProfileEventKind, type ProfilePatch,
  type ProfileRules, type ProfileSpace, type ProfileState, type ProfileView, type RemovalFailure, type RemovalPlan, type RemovalSummary,
  type RemoveFailure, type RemoveResult, type SpaceArcadeOptions, type SwitchFailure, type SwitchResult, type UpdateFailure, type UpdateResult,
} from './profiles.ts';
export { p, schemaOf, BAD, type Parser, type Infer } from './schema.ts';
export {
  createStore, memoryStorage, browserStorage,
  type BodyArcadeStore, type Slot, type StorageLike, type StoreAccess, type StoreNamespace, type StoreOptions, type StoreProblem,
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
