// The Today panel's rules (kol F): today's plan in three parts ("18 minutes today: 3 warm-up, 12 workout with a game, 3
// stretch"), the BodyArcade game that fits it, today's goal, and the coach's one short tip. All rule based and explainable,
// no free text: the tip is a code with numbers, the page words it. No medical claim: a pain day's tip only says what the plan
// does, and the plan's own note says "if the pain goes on, ask a health professional".
import type { FormMoveId } from '../../form/types.ts';
import type { BodyRegion } from '../../types/index.ts';
import { daySeed, type Day } from '../../store/date.ts';
import { blockSeconds } from '../program/generate.ts';
import type { DailyCheckin, TodayPlan } from '../program/checkin.ts';
import type { Area } from '../program/moves-meta.ts';
import type { MoveState } from '../program/progress.ts';
import type { WeekView } from './history.ts';

/** Minutes of the warm-up, the workout (main and conditioning) and the stretch; they add up to the plan's minutes. */
export interface PlanSplit { total: number; warmup: number; work: number; stretch: number }

export function planSplit(p: Pick<TodayPlan, 'blocks' | 'minutes'>): PlanSplit {
  const s = { warmup: 0, work: 0, stretch: 0 };
  for (const b of p.blocks) {
    if (!b.items.length && !b.game) continue;
    const sec = blockSeconds(b);
    if (b.kind === 'warmup') s.warmup += sec; else if (b.kind === 'cooldown') s.stretch += sec; else s.work += sec;
  }
  const total = Math.max(1, p.minutes);
  const r = (x: number): number => (x > 0 ? Math.max(1, Math.round(x / 60)) : 0);
  let warmup = r(s.warmup), stretch = r(s.stretch);
  if (warmup + stretch >= total) { warmup = Math.min(warmup, Math.max(0, total - 1)); stretch = Math.max(0, Math.min(stretch, total - warmup - (s.work > 0 ? 1 : 0))); }
  return { total, warmup, stretch, work: Math.max(0, total - warmup - stretch) };
}

/** What the panel needs of a game (the catalogue's manifest has all of it). */
export interface GameCard { id: string; free: boolean; regions: readonly BodyRegion[]; lowImpact: boolean; seated: boolean; durationSec: number }

/** Regions a game may not lean on with pain in an area (a planning aid, like the program's avoid list). */
const AVOID_REGIONS: Readonly<Record<Area, readonly BodyRegion[]>> = {
  knee: ['legs', 'cardio'], back: ['core', 'chest-back'], shoulder: ['arms', 'chest-back'], wrist: ['arms'], neck: ['mobility'],
};
const FOCUS_REGIONS: Readonly<Record<TodayPlan['focus'], readonly BodyRegion[]>> = {
  full: ['cardio', 'legs', 'arms', 'core'], upper: ['arms', 'chest-back'], lower: ['legs'], push: ['arms', 'chest-back'], pull: ['arms', 'chest-back'], legs: ['legs'],
  conditioning: ['cardio'], mobility: ['mobility', 'core'],
};

/**
 * The game for today's workout: free games for everyone, every game with Pro; only low-impact games on a low day or a pain
 * day, none that leans on a sore area; the focus's regions first; among equals the day picks (the same game all day).
 */
export function pickGame<G extends GameCard>(games: readonly G[], o: { day: Day; focus: TodayPlan['focus']; low: boolean; painAreas?: readonly Area[]; pro: boolean }): G | null {
  const avoid = new Set((o.painAreas ?? []).flatMap((a) => AVOID_REGIONS[a]));
  const ok = games.filter((g) => (o.pro || g.free) && (!o.low && !o.painAreas?.length ? true : g.lowImpact) && !g.regions.some((r) => avoid.has(r)));
  if (!ok.length) return null;
  const want = FOCUS_REGIONS[o.focus];
  const score = (g: G): number => g.regions.filter((r) => want.includes(r)).length;
  const top = Math.max(...ok.map(score));
  const best = ok.filter((g) => score(g) === top).sort((a, b) => a.id.localeCompare(b.id));
  return best[daySeed(o.day) % best.length]!;
}

/** Today's goal in minutes: what the check-in said, else the program's session length, else 20. */
export function goalMinutes(checkin: DailyCheckin | null | undefined, programMinutes: number | null | undefined): number {
  return Math.max(5, Math.min(120, checkin?.minutes ?? programMinutes ?? 20));
}

export type TipId = 'checkin-first' | 'pain' | 'gentle' | 'rest-day' | 'start' | 'record' | 'form-first' | 'harder' | 'week-met' | 'week-close' | 'steady';
export interface Tip { id: TipId; move?: FormMoveId; game?: string; value?: number; n?: number }

/**
 * One short tip, the first rule that holds:
 *   pain today -> what the plan does about it; a low day -> a short easy day counts; no check-in yet -> do it first;
 *   a rest day; nothing done yet ever -> how to start; a record yesterday or today -> name it; the form gate holds a move ->
 *   form first; a move just stepped up -> say so; the week's goal met -> what comes now is extra; one active day to go ->
 *   say it plainly (never "or you lose your streak"); else keep the rhythm.
 */
export function coachTip(o: {
  checkin: DailyCheckin | null;
  plan: Pick<TodayPlan, 'restDay' | 'intensity' | 'notes'>;
  week: Pick<WeekView, 'daysMet' | 'daysToGo' | 'canStillMeet'>;
  anything: boolean;
  record?: { move?: FormMoveId; game?: string; value: number } | null;
  states?: readonly MoveState[];
}): Tip {
  if (o.plan.notes.includes('see-professional')) return { id: 'pain' };
  if (o.plan.intensity === 'low') return { id: 'gentle' };
  if (!o.checkin) return { id: 'checkin-first' };
  if (o.plan.restDay) return { id: 'rest-day' };
  if (!o.anything) return { id: 'start' };
  if (o.record) return { id: 'record', ...(o.record.move ? { move: o.record.move } : {}), ...(o.record.game ? { game: o.record.game } : {}), value: o.record.value };
  const gate = o.states?.find((s) => s.reason === 'form-gate');
  if (gate) return { id: 'form-first', move: gate.move };
  const up = o.states?.find((s) => s.reason === 'harder-move' || s.reason === 'next-weight');
  if (up) return { id: 'harder', move: up.move };
  if (o.week.daysMet) return { id: 'week-met' };
  if (o.week.canStillMeet && o.week.daysToGo === 1) return { id: 'week-close', n: 1 };
  return { id: 'steady' };
}

/**
 * Rounds of today's game that fill the time the plan leaves: the program engine may come out shorter than the minutes the
 * person has (few moves are measured on real video yet), and the game is the workout's playful part. No rounds when the
 * gap is under about two thirds of a round; at most four; never more than a round past the minutes.
 */
export function gameRounds(game: Pick<GameCard, 'durationSec'> | null, planMinutes: number, goalMinutes: number): number {
  if (!game || game.durationSec <= 0) return 0;
  const gap = (goalMinutes - planMinutes) * 60;
  if (gap < Math.max(90, game.durationSec * 0.6)) return 0;
  return Math.max(1, Math.min(4, Math.floor(gap / game.durationSec + 0.25)));
}
