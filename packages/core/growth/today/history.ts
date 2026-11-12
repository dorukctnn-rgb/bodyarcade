// What the person has done, from facts only (kol F: the Today panel, the progress page, the quests): the program's sets
// (the vault's logs), the games' rounds and seconds (the arcade), the check-ins, and the days photos and measurements were
// taken. Nothing here keeps a counter: every number is worked out again from the facts, so it cannot drift, and the same
// facts always give the same answer. Codes and numbers only; the pages word them.
//
// An active day follows the games' habit rule (core/store/habit.ts): three minutes of movement in all, games and program
// sessions together. The week streak is the habit's too: weeks (Monday to Sunday) with the week's goal of active days; the
// week that is running counts once it has them and breaks nothing until it is over. Nobody is told a streak is about to go.
import type { FormMoveId } from '../../form/types.ts';
import { addDays, weekdayIndex, weekStart, type Day } from '../../store/date.ts';
import { HABIT } from '../../store/habit.ts';
import { MOVE_META } from '../program/moves-meta.ts';
import type { DailyCheckin } from '../program/checkin.ts';

/** One program set: `value` is what counts for its target (setValue: reps, the weaker side, or seconds held). */
export interface SetFact { day: Day; sessionId: string; move: FormMoveId; value: number; loadKg?: number; startedAt: number; endedAt: number }
/** One game round. */
export interface RunFact { day: Day; game: string; t: number; score: number; seconds: number }

export interface Facts {
  today: Day;
  sets: readonly SetFact[];
  /** game rounds the arcade keeps (the newest 200 of each game) */
  runs: readonly RunFact[];
  /** seconds of game play per day, all games together (the arcade keeps 400 days) */
  gameSeconds: Readonly<Record<Day, number>>;
  /** each game's best score over everything it kept (the runs above may be fewer) */
  gameBests?: readonly { game: string; best: number }[];
  checkins: readonly { day: Day; a: DailyCheckin }[];
  photoDays: readonly Day[];
  measureDays: readonly Day[];
}

export interface WeekGoal { days: number; minutes: number }
export const DEFAULT_WEEK_GOAL: WeekGoal = { days: HABIT.weekGoal, minutes: 90 };
/** Choices the progress page offers (chips). */
export const WEEK_GOAL_DAYS: readonly number[] = [2, 3, 4, 5];
export const WEEK_GOAL_MINUTES: readonly number[] = [60, 90, 120, 150, 180];

/** A session of the program: its sets folded together. Seconds run from the first set's start to the last set's end. */
export interface Session { id: string; day: Day; start: number; end: number; seconds: number; sets: number; moves: FormMoveId[] }

const MAX_SESSION_S = 3 * 3600;

export function sessionsOf(sets: readonly SetFact[]): Session[] {
  const by = new Map<string, SetFact[]>();
  for (const s of sets) { const a = by.get(s.sessionId) ?? []; a.push(s); by.set(s.sessionId, a); }
  const out: Session[] = [];
  for (const [id, ss] of by) {
    const start = Math.min(...ss.map((s) => s.startedAt)), end = Math.max(...ss.map((s) => s.endedAt));
    const first = ss.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    out.push({ id, day: first.day, start, end, seconds: Math.max(0, Math.min(MAX_SESSION_S, Math.round((end - start) / 1000))), sets: ss.length, moves: [...new Set(ss.map((s) => s.move))] });
  }
  return out.sort((a, b) => b.start - a.start);
}

/** Seconds moved per day: games and program sessions. */
export function secondsByDay(f: Facts): Map<Day, { game: number; workout: number; total: number }> {
  const out = new Map<Day, { game: number; workout: number; total: number }>();
  const add = (d: Day, k: 'game' | 'workout', s: number): void => {
    const cur = out.get(d) ?? { game: 0, workout: 0, total: 0 };
    cur[k] += s; cur.total += s; out.set(d, cur);
  };
  for (const [d, s] of Object.entries(f.gameSeconds)) if (Number.isFinite(s) && s > 0) add(d, 'game', Math.min(s, 86_400));
  for (const s of sessionsOf(f.sets)) add(s.day, 'workout', s.seconds);
  return out;
}

export const isActive = (seconds: number): boolean => seconds >= HABIT.activeDaySeconds;

export function activeDays(f: Facts): Set<Day> {
  const out = new Set<Day>();
  for (const [d, v] of secondsByDay(f)) if (isActive(v.total)) out.add(d);
  return out;
}

export interface WeekView {
  start: Day;
  days: { day: Day; seconds: number; active: boolean; future: boolean }[];
  activeDays: number;
  seconds: number;
  goal: WeekGoal;
  daysMet: boolean;
  minutesMet: boolean;
  /** days left this week, today included */
  daysLeft: number;
  /** active days still to go for the goal (0 once met) */
  daysToGo: number;
  canStillMeet: boolean;
}

export function weekOf(f: Facts, goal: WeekGoal = DEFAULT_WEEK_GOAL, day: Day = f.today): WeekView {
  const start = weekStart(day);
  const by = secondsByDay(f);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const s = d > f.today ? 0 : by.get(d)?.total ?? 0;
    return { day: d, seconds: s, active: isActive(s), future: d > f.today };
  });
  const active = days.filter((d) => d.active).length;
  const seconds = days.reduce((a, d) => a + d.seconds, 0);
  const daysLeft = day === f.today ? 7 - weekdayIndex(f.today) : 0;
  const todayActive = days.find((d) => d.day === f.today)?.active ?? false;
  const daysToGo = Math.max(0, goal.days - active);
  return {
    start, days, activeDays: active, seconds, goal, daysMet: active >= goal.days, minutesMet: seconds >= goal.minutes * 60,
    daysLeft, daysToGo, canStillMeet: daysToGo === 0 || daysToGo <= daysLeft - (todayActive ? 1 : 0),
  };
}

/** Weeks in a row that had the goal's active days; the running week counts once it has them, and breaks nothing before. */
export function weekStreak(active: ReadonlySet<Day>, today: Day, goalDays: number = HABIT.weekGoal): number {
  const met = (monday: Day): boolean => { let n = 0; for (let i = 0; i < 7; i++) if (active.has(addDays(monday, i))) n++; return n >= goalDays; };
  let w = weekStart(today), n = 0;
  if (met(w)) n++;
  for (let k = 0; k < 120; k++) { w = addDays(w, -7); if (!met(w)) break; n++; }
  return n;
}

/** The longest week streak there ever was (a badge). */
export function bestWeekStreak(active: ReadonlySet<Day>, goalDays: number = HABIT.weekGoal): number {
  const days = [...active].sort();
  if (!days.length) return 0;
  let w = weekStart(days[0]!), best = 0, run = 0;
  const last = weekStart(days.at(-1)!);
  for (let k = 0; k < 800 && w <= last; k++) {
    let n = 0; for (let i = 0; i < 7; i++) if (active.has(addDays(w, i))) n++;
    run = n >= goalDays ? run + 1 : 0;
    best = Math.max(best, run);
    w = addDays(w, 7);
  }
  return best;
}

/** Minutes moved per week, oldest first, the running week last. */
export function weeklyMinutes(f: Facts, weeks = 8): { start: Day; minutes: number }[] {
  const by = secondsByDay(f);
  const now = weekStart(f.today);
  return Array.from({ length: weeks }, (_, k) => {
    const start = addDays(now, -7 * (weeks - 1 - k));
    let s = 0;
    for (let i = 0; i < 7; i++) s += by.get(addDays(start, i))?.total ?? 0;
    return { start, minutes: Math.round(s / 60) };
  });
}

export const totalMinutes = (f: Facts): number => Math.round([...secondsByDay(f).values()].reduce((a, v) => a + v.total, 0) / 60);

/** The best set of each move (reps, the weaker side, or seconds held) and its heaviest load, newest record first. */
export interface MoveRecord { move: FormMoveId; unit: 'reps' | 'seconds'; best: number; day: Day; load?: { kg: number; value: number; day: Day } }

export function moveRecords(sets: readonly SetFact[]): MoveRecord[] {
  const by = new Map<FormMoveId, MoveRecord>();
  const sorted = [...sets].sort((a, b) => a.startedAt - b.startedAt);
  for (const s of sorted) {
    if (!MOVE_META[s.move] || !(s.value > 0)) continue;
    const cur = by.get(s.move) ?? { move: s.move, unit: MOVE_META[s.move].unit, best: 0, day: s.day };
    if (s.value > cur.best) { cur.best = s.value; cur.day = s.day; }
    if (s.loadKg && s.loadKg > 0 && (!cur.load || s.loadKg > cur.load.kg || (s.loadKg === cur.load.kg && s.value > cur.load.value))) cur.load = { kg: s.loadKg, value: s.value, day: s.day };
    by.set(s.move, cur);
  }
  return [...by.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.move.localeCompare(b.move)));
}

/** Each game's best score, the day it was made (when the kept rounds still have it) and the rounds kept. */
export interface GameRecord { game: string; best: number; day: Day | null; runs: number; seconds: number }

export function gameRecords(f: Facts): GameRecord[] {
  const by = new Map<string, GameRecord>();
  for (const r of [...f.runs].sort((a, b) => a.t - b.t)) {
    const cur = by.get(r.game) ?? { game: r.game, best: 0, day: null, runs: 0, seconds: 0 };
    cur.runs++; cur.seconds += r.seconds;
    if (r.score > cur.best) { cur.best = r.score; cur.day = r.day; }
    by.set(r.game, cur);
  }
  for (const b of f.gameBests ?? []) {
    const cur = by.get(b.game) ?? { game: b.game, best: 0, day: null, runs: 0, seconds: 0 };
    if (b.best > cur.best) { cur.best = b.best; cur.day = null; }
    by.set(b.game, cur);
  }
  return [...by.values()].filter((g) => g.best > 0 || g.runs > 0).sort((a, b) => b.runs - a.runs || a.game.localeCompare(b.game));
}

/** Personal records made on a day: a set or a round better than every one before it (a first time is not a record). */
export function recordsOn(f: Facts, day: Day): { moves: { move: FormMoveId; value: number }[]; games: { game: string; score: number }[] } {
  const moves: { move: FormMoveId; value: number }[] = [];
  const before = new Map<FormMoveId, number>();
  for (const s of f.sets) if (s.day < day) before.set(s.move, Math.max(before.get(s.move) ?? 0, s.value));
  const best = new Map<FormMoveId, number>();
  for (const s of f.sets) if (s.day === day) best.set(s.move, Math.max(best.get(s.move) ?? 0, s.value));
  for (const [m, v] of best) { const b = before.get(m); if (b !== undefined && b > 0 && v > b) moves.push({ move: m, value: v }); }
  const games: { game: string; score: number }[] = [];
  const gBefore = new Map<string, number>();
  for (const r of f.runs) if (r.day < day) gBefore.set(r.game, Math.max(gBefore.get(r.game) ?? 0, r.score));
  const gBest = new Map<string, number>();
  for (const r of f.runs) if (r.day === day) gBest.set(r.game, Math.max(gBest.get(r.game) ?? 0, r.score));
  for (const [g, v] of gBest) { const b = gBefore.get(g); if (b !== undefined && b > 0 && v > b) games.push({ game: g, score: v }); }
  return { moves, games };
}

/** The history list, newest first: program sessions and game rounds. */
export type HistoryItem =
  | { kind: 'workout'; at: number; day: Day; seconds: number; sets: number; moves: FormMoveId[] }
  | { kind: 'game'; at: number; day: Day; seconds: number; game: string; score: number };

export function historyOf(f: Facts, limit = 30): HistoryItem[] {
  const items: HistoryItem[] = [
    ...sessionsOf(f.sets).map((s) => ({ kind: 'workout' as const, at: s.start, day: s.day, seconds: s.seconds, sets: s.sets, moves: s.moves })),
    ...f.runs.map((r) => ({ kind: 'game' as const, at: r.t, day: r.day, seconds: r.seconds, game: r.game, score: r.score })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Days since the first fact (a check-in, a set, a round, a photo, a measurement), or null when there is none. */
export function firstDay(f: Facts): Day | null {
  const all: Day[] = [...f.sets.map((s) => s.day), ...f.runs.map((r) => r.day), ...Object.keys(f.gameSeconds), ...f.checkins.map((c) => c.day), ...f.photoDays, ...f.measureDays];
  if (!all.length) return null;
  return all.sort()[0]!;
}

