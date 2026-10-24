// Progress of one game: runs, totals, bests, worlds played, achievements and the daily goal, in that game's namespace.
//
// This replaces v1's recordRun/afterRun (site/game/store.js:95-208). What changed:
// - A best is kept per variant (world) AND difficulty, so an Easy run is no longer compared with an Insane best (B14).
// - Every day is the player's local day from the store's one date rule (B13); the free-run counter of v1 is gone
//   (game-design 4.1: the limit of five runs per day was removed).
// - A streak is only shown while it is alive (today or yesterday); v1 kept showing a dead streak's number.
// - record() never throws: the results screen always appears (B4). A run with impossible numbers is clamped, and a
//   damaged key was already reset by the store.
// - What is not a run is not saved. A round that ended without a summary hands over null (the live site's afterRun
//   met one in the CI log of 24 Oct: "Cannot read properties of null (reading 'kcal')"); a number, an array or an
//   object without a finite score is no better. Such a call stores nothing, counts nothing, unlocks nothing, answers
//   `saved: false` and is reported to the store (kind 'rejected'), so a caller's bug shows up instead of becoming a
//   ghost run of 0 points that unlocks "First run".
import { newlyUnlocked, type AchievementDef } from './achievements.ts';
import { dailyGoalFor, goalText, nextStreak, type DailyGoal, type DailyGoalSpec } from './daily.ts';
import { prevDay, type Day } from './date.ts';
import { p, schemaOf } from './schema.ts';
import type { BodyArcadeStore, StoreNamespace } from './store.ts';

/** What a game hands over when a run ends. `variant` is the world or biome, `stats` the game's own numbers. */
export interface RunInput {
  score: number;
  seconds: number;
  /** Finished, as opposed to ended by running out of lives. */
  complete: boolean;
  variant: string;
  difficulty: string;
  /** Numeric facts of the run: cleared, hits, coins, kcal, reps... Only finite, non-negative numbers are kept. */
  stats?: Readonly<Record<string, number>>;
  /** The score of the friend's challenge this run answers. */
  friend?: { score: number } | null;
}

export interface RunRecord {
  /** Epoch ms of the end of the run. */
  t: number;
  day: Day;
  score: number;
  seconds: number;
  variant: string;
  difficulty: string;
  complete: boolean;
  stats: Record<string, number>;
}

/** Lifetime sums: 'runs', 'seconds', 'score' and every stat key the game reports (kcal, cleared, coins...). */
export type Totals = Record<string, number>;

export interface DayActivity { runs: number; seconds: number; best: number }

export interface DailyState { done: Day | null; n: number; last: Day | null }

export interface RecordOutcome {
  /**
   * False when nothing was stored: what the game handed over was not a run (null, a number, an object without a finite
   * score), or saving failed inside. The results screen is still built from `run` (cleaned, not stored).
   */
  saved: boolean;
  run: RunRecord;
  totals: Totals;
  /** The best for this variant and difficulty before this run (0 when there was none). */
  previousBest: number;
  /** A previous best existed and this run beat it. */
  newBest: boolean;
  /** The first run on this variant and difficulty. */
  firstHere: boolean;
  /** Achievements this run unlocked, in the game's list order. */
  news: AchievementDef[];
  /** Set only when this run met today's goal (streak is the new length). */
  daily: { streak: number; goal: DailyGoal } | null;
}

export interface ProgressOptions {
  achievements: readonly AchievementDef[];
  /**
   * The game's own daily goal (the live runner has one, and a returning player keeps its streak). A game without one has no
   * such goal: its daily is the platform's daily challenge (daily-challenge.ts), and nothing here throws for the lack of it.
   */
  daily?: DailyGoalSpec;
  /** How many runs are kept, newest first. v1 kept 200. */
  maxRuns?: number;
}

export interface DailyView {
  goal: DailyGoal;
  /** The goal sentence in a language. */
  text(locale?: string): string;
  done: boolean;
  streak: number;
}

export interface Progress {
  record(run: RunInput): RecordOutcome;
  /** Newest first. */
  runs(limit?: number): RunRecord[];
  totals(): Totals;
  /** Without arguments the best over everything; with a variant the best over its difficulties; with both, exact (B14). */
  best(variant?: string, difficulty?: string): number;
  variants(): string[];
  /** Unlocked ids with the time they were unlocked (0 when imported from v1). */
  unlocked(): Record<string, number>;
  achievements(): { def: AchievementDef; unlockedAt: number | null }[];
  /** Today's goal of this game, or null for a game that has none (see ProgressOptions.daily). */
  daily(day?: Day): DailyView | null;
  /** The streak that is alive now: today's or yesterday's, else 0. */
  streak(): number;
  activity(): Record<Day, DayActivity>;
}

export const MAX_RUNS = 200;
const MAX_ACTIVITY_DAYS = 400;
const MAX_VARIANTS = 80;
const MAX_STAT_KEYS = 24;
/** Ids of variants and difficulties: also used to build the 'variant|difficulty' key. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/;
const STAT_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const MAX_VALUE = 1_000_000_000;
/** Marks a best that the v1 import could not tie to a difficulty. It counts for best(variant) but never blocks "new best". */
export const LEGACY_DIFFICULTY = 'legacy';

// ── schemas (one key each; a damaged key resets alone) ──
const statNumber = p.number({ min: 0, max: MAX_VALUE });
const idP = p.string({ pattern: ID_RE, max: 40 });
const runRecordP = p.object({
  t: p.epoch(),
  day: p.day(),
  score: p.number({ min: 0, max: MAX_VALUE }),
  seconds: p.number({ min: 0, max: 86_400 }),
  variant: idP,
  difficulty: idP,
  complete: p.withDefault(p.boolean(), false),
  stats: p.withDefault(p.record(statNumber, { max: MAX_STAT_KEYS, key: STAT_KEY_RE, lenient: true }), () => ({})),
});

export const RunsSchema = schemaOf(1, p.array(runRecordP, { max: MAX_RUNS, lenient: true }));
export const TotalsSchema = schemaOf(1, p.record(p.number({ min: 0, max: 1e15 }), { max: MAX_STAT_KEYS + 4, key: STAT_KEY_RE, lenient: true }));
export const BestsSchema = schemaOf(1, p.record(p.number({ min: 0, max: MAX_VALUE }), { max: 600, key: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}\|[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/, lenient: true }));
export const VariantsSchema = schemaOf(1, p.array(idP, { max: MAX_VARIANTS, lenient: true }));
export const UnlockedSchema = schemaOf(1, p.record(p.epoch(), { max: 200, key: /^[a-z0-9][a-z0-9-]{0,39}$/, lenient: true }));
export const DailySchema = schemaOf(1, p.object({
  done: p.withDefault(p.nullable(p.day()), null),
  n: p.withDefault(p.number({ int: true, min: 0, max: 100_000 }), 0),
  last: p.withDefault(p.nullable(p.day()), null),
}));
export const ActivitySchema = schemaOf(1, p.record(
  p.object({ runs: p.number({ int: true, min: 0, max: 1e7 }), seconds: p.number({ min: 0, max: 1e9 }), best: p.number({ min: 0, max: MAX_VALUE }) }),
  { max: MAX_ACTIVITY_DAYS, key: /^\d{4}-\d{2}-\d{2}$/, lenient: true },
));

export const bestKey = (variant: string, difficulty: string): string => `${variant}|${difficulty}`;

const clampNumber = (x: unknown, max = MAX_VALUE): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : 0);
const safeId = (x: unknown, fallback: string): string => (typeof x === 'string' && ID_RE.test(x) ? x : fallback);

function sanitizeStats(stats: RunInput['stats']): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats || typeof stats !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (!STAT_KEY_RE.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    out[k] = Math.min(v, MAX_VALUE);
    if (++n >= MAX_STAT_KEYS) break;
  }
  return out;
}

/**
 * Is this a run at all: an object with a finite score. A summary that was never produced (null), a number, an array
 * and {} are not; an object whose score is NaN, infinite or a string is not either. Everything else about a run may be
 * damaged and is cleaned by sanitizeRun.
 */
export function isRunInput(x: unknown): x is RunInput {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const score = (x as { score?: unknown }).score;
  return typeof score === 'number' && Number.isFinite(score);
}

/** What was handed over, in words and without its contents (a report must not carry a player's data around). */
function describeInput(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'an array';
  if (typeof x === 'object') return 'an object without a finite score';
  return typeof x === 'undefined' ? 'undefined' : `a ${typeof x}`;
}

/** Everything a run is allowed to say, cleaned. Impossible numbers become safe ones; nothing here throws. */
export function sanitizeRun(raw: RunInput, t: number, day: Day): RunRecord {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<RunInput>;
  return {
    t,
    day,
    score: Math.round(clampNumber(input.score)),
    seconds: clampNumber(input.seconds, 86_400),
    variant: safeId(input.variant, 'unknown'),
    difficulty: safeId(input.difficulty, 'unknown'),
    complete: input.complete === true,
    stats: sanitizeStats(input.stats),
  };
}

function statOf(run: RunRecord, name: string): number | undefined {
  if (name === 'score') return run.score;
  if (name === 'seconds') return run.seconds;
  return run.stats[name];
}

export function createProgress(store: BodyArcadeStore, ns: StoreNamespace, options: ProgressOptions): Progress {
  const maxRuns = Math.max(1, Math.min(options.maxRuns ?? MAX_RUNS, MAX_RUNS));
  const runsSlot = ns.slot<RunRecord[]>('runs', RunsSchema, () => []);
  const totalsSlot = ns.slot<Totals>('totals', TotalsSchema, () => ({}));
  const bestsSlot = ns.slot<Record<string, number>>('bests', BestsSchema, () => ({}));
  const variantsSlot = ns.slot<string[]>('variants', VariantsSchema, () => []);
  const unlockedSlot = ns.slot<Record<string, number>>('ach', UnlockedSchema, () => ({}));
  const dailySlot = ns.slot<DailyState>('daily', DailySchema, () => ({ done: null, n: 0, last: null }));
  const activitySlot = ns.slot<Record<Day, DayActivity>>('activity', ActivitySchema, () => ({}));

  const aliveStreak = (d: DailyState, today: Day): number => (d.last === today || d.last === prevDay(today) ? d.n : 0);

  /** The goal spec when it can make a goal: it needs a world and a kind to draw from. */
  const spec: DailyGoalSpec | null = options.daily && options.daily.kinds.length > 0 && options.daily.variants.length > 0 ? options.daily : null;

  function dailyView(day: Day): DailyView | null {
    if (!spec) return null;
    const goal = dailyGoalFor(day, spec);
    const state = dailySlot.get();
    return {
      goal,
      text: (locale = 'en') => goalText(goal, spec, locale),
      done: state.done === day,
      streak: aliveStreak(state, day),
    };
  }

  function pruneActivity(a: Record<Day, DayActivity>): Record<Day, DayActivity> {
    const days = Object.keys(a).sort();
    if (days.length <= MAX_ACTIVITY_DAYS) return a;
    for (const d of days.slice(0, days.length - MAX_ACTIVITY_DAYS)) delete a[d];
    return a;
  }

  function recordUnsafe(input: RunInput): RecordOutcome {
    const day = store.day();
    const run = sanitizeRun(input, store.now(), day);

    // Bests are decided before the run is added, so the answer is "against what was there".
    const bests = bestsSlot.get();
    const key = bestKey(run.variant, run.difficulty);
    const previousBest = bests[key] ?? 0;
    const hadAny = key in bests || runsSlot.get().some((r) => r.variant === run.variant && r.difficulty === run.difficulty);
    if (run.score > previousBest) bests[key] = run.score;
    bestsSlot.set(bests);

    runsSlot.update((list) => [run, ...list].slice(0, maxRuns));

    const totals = totalsSlot.get();
    totals['runs'] = (totals['runs'] ?? 0) + 1;
    totals['seconds'] = (totals['seconds'] ?? 0) + run.seconds;
    totals['score'] = (totals['score'] ?? 0) + run.score;
    for (const [k, v] of Object.entries(run.stats)) {
      if (k === 'runs' || k === 'seconds' || k === 'score') continue;
      if (!(k in totals) && Object.keys(totals).length >= MAX_STAT_KEYS + 4) continue;   // the stored record has a key budget
      totals[k] = (totals[k] ?? 0) + v;
    }
    totalsSlot.set(totals);

    const variants = variantsSlot.get();
    if (!variants.includes(run.variant) && variants.length < MAX_VARIANTS) {
      variants.push(run.variant);
      variantsSlot.set(variants);
    }

    const activity = activitySlot.get();
    const a = activity[day] ?? { runs: 0, seconds: 0, best: 0 };
    a.runs += 1;
    a.seconds += run.seconds;
    a.best = Math.max(a.best, run.score);
    activity[day] = a;
    activitySlot.set(pruneActivity(activity));

    // Daily goal: only on the goal's variant, only once a day, and the stat must reach the target.
    let daily: RecordOutcome['daily'] = null;
    if (spec) {
      const goal = dailyGoalFor(day, spec);
      const dstate = dailySlot.get();
      if (run.variant === goal.variant && dstate.done !== day) {
        const value = statOf(run, goal.stat);
        if (value !== undefined && value >= goal.target) {
          const n = nextStreak({ n: dstate.n, last: dstate.last }, day, prevDay(day));
          dailySlot.set({ done: day, n, last: day });
          daily = { streak: n, goal };
        }
      }
    }
    const afterDaily = dailySlot.get();
    const streakToday = afterDaily.done === day ? afterDaily.n : 0;

    const already = unlockedSlot.get();
    const news = newlyUnlocked(
      options.achievements,
      {
        run: { score: run.score, seconds: run.seconds, complete: run.complete, difficulty: run.difficulty, stats: run.stats },
        totals,
        variants,
        streak: streakToday,
        friend: input.friend && typeof input.friend.score === 'number' && Number.isFinite(input.friend.score) ? { score: input.friend.score } : null,
      },
      new Set(Object.keys(already)),
    );
    if (news.length > 0) {
      for (const def of news) already[def.id] = run.t;
      unlockedSlot.set(already);
    }

    return { saved: true, run, totals: { ...totals }, previousBest, newBest: previousBest > 0 && run.score > previousBest, firstHere: !hadAny, news, daily };
  }

  return {
    record(input) {
      if (!isRunInput(input)) {
        // No run happened, so nothing is written, counted or unlocked. The caller still gets an outcome it can show.
        store.report({ kind: 'rejected', key: `${ns.name}.runs`, detail: `record() was handed ${describeInput(input)}, which is not a run; nothing was stored` });
        return { saved: false, run: sanitizeRun(input, store.now(), store.day()), totals: {}, previousBest: 0, newBest: false, firstHere: false, news: [], daily: null };
      }
      try {
        return recordUnsafe(input);
      } catch (e) {
        // The results screen must still show (B4). A storage that throws is already handled inside the store; this is
        // for bugs, and it leaves the run unrecorded rather than the game frozen.
        store.report({ kind: 'write_failed', key: `${ns.name}.runs`, detail: `record() failed: ${e instanceof Error ? e.message : String(e)}` });
        const day = store.day();
        const run = sanitizeRun(input, store.now(), day);
        return { saved: false, run, totals: {}, previousBest: 0, newBest: false, firstHere: false, news: [], daily: null };
      }
    },
    runs: (limit) => runsSlot.get().slice(0, limit === undefined ? maxRuns : Math.max(0, limit)),
    totals: () => ({ ...totalsSlot.get() }),
    best(variant, difficulty) {
      const bests = bestsSlot.get();
      if (variant !== undefined && difficulty !== undefined) return bests[bestKey(variant, difficulty)] ?? 0;
      let top = 0;
      for (const [k, v] of Object.entries(bests)) {
        if (variant === undefined || k.startsWith(`${variant}|`)) top = Math.max(top, v);
      }
      return top;
    },
    variants: () => variantsSlot.get().slice(),
    unlocked: () => ({ ...unlockedSlot.get() }),
    achievements() {
      const got = unlockedSlot.get();
      return options.achievements.map((def) => ({ def, unlockedAt: got[def.id] ?? null }));
    },
    daily: (day) => dailyView(day ?? store.day()),
    streak: () => aliveStreak(dailySlot.get(), store.day()),
    activity: () => ({ ...activitySlot.get() }),
  };
}
