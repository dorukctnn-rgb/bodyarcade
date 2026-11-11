// Progression (SPEC 3.4): after each session, each move's next target with the reason as a code the page words.
// Double progression: repetitions first, then a harder move (or the next dumbbell); the "clean repetition" gate holds
// progress while the form coach sees the same error; two failures step back; a long break starts one step lower.
// Deload: planned (every 6th week for beginners, 5th otherwise) and suggested (2+ failed moves in a week, or "very tired").
import type { FormMoveId } from '../../form/types.ts';
import { FORM_MOVES } from '../../form/moves/index.ts';
import { easierOf, MOVE_META } from './moves-meta.ts';
import type { Prescription } from './generate.ts';

/** How one move went in one session. rir: the answer to "how many more could you have done?" (0, 1-2 -> 1, 3+ -> 3). */
export interface MoveResult {
  move: FormMoveId;
  date: string;
  /** per set: repetitions (per side for one-sided moves) or seconds held */
  done: number[];
  /** per set: clean share 0..1, or null for count-only moves and corrected counts */
  clean: (number | null)[];
  rir: (0 | 1 | 3)[];
  loadKg?: number;
  topError?: string | null;
}

export type Reason = 'add-rep' | 'top-of-range' | 'harder-move' | 'next-weight' | 'add-seconds' | 'hold' | 'tired' | 'form-gate' | 'failed' | 'step-back' | 'after-break' | 'start';

export interface MoveState {
  move: FormMoveId;
  target: number;
  range: [number, number];
  unit: 'reps' | 'seconds';
  loadKg?: number;
  /** consecutive sessions: at the top of the range, failed, under the form gate */
  topStreak: number;
  failStreak: number;
  formStreak: number;
  lastDate: string | null;
  reason: Reason;
  /** the form coach's most frequent error that held progress (for "form first: <error>") */
  formError?: string | null;
  /** a lighter variant was offered by the form gate (the person chooses) */
  offerEasier?: FormMoveId | null;
}

export const PROGRESS_RULES = { cleanOk: 0.8, cleanGate: 0.7, breakDays: 10, holdStep: 5, holdSwitch: 60 } as const;

export function startState(p: Prescription): MoveState {
  return { move: p.move, target: p.target, range: [...p.range], unit: p.unit, ...(p.loadKg !== undefined ? { loadKg: p.loadKg } : {}), topStreak: 0, failStreak: 0, formStreak: 0, lastDate: null, reason: 'start' };
}

const days = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Before a session: a move not done for 10+ days starts one step back. */
export function beforeSession(s: MoveState, today: string): MoveState {
  if (!s.lastDate || days(s.lastDate, today) < PROGRESS_RULES.breakDays) return s;
  const step = s.unit === 'seconds' ? PROGRESS_RULES.holdStep : 2;
  return { ...s, target: Math.max(s.range[0], s.target - step), reason: 'after-break' };
}

export function applyResult(s: MoveState, r: MoveResult, opts: { dumbbellsKg?: readonly number[]; beginner?: boolean; harderAllowed?: (id: FormMoveId) => boolean } = {}): MoveState {
  const next: MoveState = { ...s, lastDate: r.date, formError: null, offerEasier: null };
  const formed = FORM_MOVES[s.move].label === 'F' || FORM_MOVES[s.move].label === 'H';
  const cleans = r.clean.filter((c): c is number => c !== null);
  const cleanShare = cleans.length ? cleans.reduce((a, b) => a + b, 0) / cleans.length : 1;
  const allHit = r.done.length > 0 && r.done.every((d) => d >= s.target);
  const anyUnder = r.done.some((d) => d < s.range[0]);
  const allTop = r.done.length > 0 && r.done.every((d) => d >= s.range[1]);
  const exhausted = r.rir.length > 0 && r.rir.every((x) => x === 0);

  // the form gate: clean share under 0.7 two sessions running holds progress
  if (formed && cleans.length && cleanShare < PROGRESS_RULES.cleanGate) {
    next.formStreak = s.formStreak + 1;
    if (next.formStreak >= 2) {
      next.reason = 'form-gate'; next.formError = r.topError ?? null; next.offerEasier = easierOf(s.move); next.topStreak = 0;
      return next;
    }
  } else next.formStreak = 0;

  if (anyUnder) {
    next.failStreak = s.failStreak + 1; next.topStreak = 0;
    if (next.failStreak >= 2) return stepBack(next, opts);
    next.reason = 'failed';
    return next;
  }
  next.failStreak = 0;
  if (exhausted) { next.reason = 'tired'; next.topStreak = 0; return next; }

  if (s.unit === 'seconds') {
    if (allHit && cleanShare >= PROGRESS_RULES.cleanOk) {
      if (s.target + PROGRESS_RULES.holdStep > PROGRESS_RULES.holdSwitch) return harder(next, opts);
      next.target = s.target + PROGRESS_RULES.holdStep; next.reason = 'add-seconds';
    } else next.reason = 'hold';
    return next;
  }
  if (allTop) {
    next.topStreak = s.topStreak + 1;
    if (next.topStreak >= (opts.beginner ? 1 : 2)) return harder(next, opts);
    next.reason = 'top-of-range';
    return next;
  }
  next.topStreak = 0;
  if (allHit && cleanShare >= PROGRESS_RULES.cleanOk) {
    const bodyweight = !FORM_MOVES[s.move].equipment?.includes('dumbbell');
    next.target = Math.min(s.range[1], s.target + (bodyweight ? 2 : 1));
    next.reason = 'add-rep';
  } else next.reason = 'hold';
  return next;
}

function harder(s: MoveState, opts: { dumbbellsKg?: readonly number[]; harderAllowed?: (id: FormMoveId) => boolean }): MoveState {
  const out = { ...s, topStreak: 0, failStreak: 0 };
  if (s.loadKg !== undefined) {
    const w = [...(opts.dumbbellsKg ?? [])].sort((a, b) => a - b).find((k) => k > s.loadKg!);
    if (w !== undefined) return { ...out, loadKg: w, target: s.range[0], reason: 'next-weight' };
    return { ...out, target: s.range[1], reason: 'top-of-range' };
  }
  const h = MOVE_META[s.move].harder;
  if (h && (opts.harderAllowed?.(h) ?? true)) {
    const unit = MOVE_META[h].unit;
    return { ...out, move: h, unit, target: unit === 'seconds' ? 20 : s.range[0], range: unit === 'seconds' ? [20, 60] : s.range, reason: 'harder-move' };
  }
  if (s.unit === 'seconds') return { ...out, target: PROGRESS_RULES.holdSwitch, reason: 'top-of-range' };
  return { ...out, target: s.range[1], reason: 'top-of-range' };
}

function stepBack(s: MoveState, opts: { dumbbellsKg?: readonly number[] }): MoveState {
  const out = { ...s, failStreak: 0, topStreak: 0, reason: 'step-back' as Reason };
  if (s.loadKg !== undefined) {
    const w = [...(opts.dumbbellsKg ?? [])].sort((a, b) => b - a).find((k) => k < s.loadKg!);
    if (w !== undefined) return { ...out, loadKg: w, target: s.range[0] };
  }
  const e = easierOf(s.move);
  if (e) return { ...out, move: e, unit: MOVE_META[e].unit, target: s.range[0] };
  return { ...out, target: Math.max(1, s.range[0] - 2) };
}

/** Planned deload weeks: week numbers start at 1. */
export const isDeloadWeek = (week: number, every: number): boolean => week > 0 && week % every === 0;

/** Suggested deload (the person confirms): 2+ moves failed in the same week, or the person said "very tired". */
export const suggestDeload = (weekResults: readonly MoveState[], veryTired: boolean): boolean =>
  veryTired || weekResults.filter((s) => s.reason === 'failed' || s.reason === 'step-back').length >= 2;

/** A deload session: 40 % fewer sets, targets at the bottom of the range. */
export function deload(p: Prescription): Prescription {
  return { ...p, sets: Math.max(1, Math.round(p.sets * 0.6)), target: p.range[0] };
}
