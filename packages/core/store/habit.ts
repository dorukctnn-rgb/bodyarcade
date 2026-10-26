// The habit: how often the player moves, counted so that it never rewards doing too much (game-design 2.3).
//
//   Active day     a day on which the player played this many seconds in all games together (HABIT.activeDaySeconds). The
//                  draft said five minutes, but one ordinary round of the games lasts three to four and a half, so a day on
//                  which a person finished a round must count.
//   Week streak    the main streak: weeks (Monday to Sunday of the player's own calendar) with at least three active days in a
//                  row. Four days of every week are rest, which is what muscles need, and nobody is told that a streak is
//                  about to be lost. The week that is running counts as soon as it has its three days; a week that has not
//                  got them yet breaks nothing until it is over.
//   Day streak     the second, optional number: active days in a row. A day with no play does not break it when a rest day is
//                  available: one a week, two for a paid plan. Rest days are used by themselves when the player comes back
//                  (settle), once, and are never sold.
//
// What is stored are FACTS, never counters: the set of active days and the set of rest days (dayset.ts). The streaks are worked
// out from them whenever they are asked for, so they can be thrown away and made again, and two devices that hold different
// facts agree as soon as they exchange them (merge): the union of what both know. The seconds of the last days stay on the
// device, because a counter cannot be merged without counting something twice.
import { addDays, daysBetween, prevDay, weekStart, type Day } from './date.ts';
import {
  EMPTY_DAYS, countDays, daySetParser, dropAfter, hasDay, lastDay, mergeDays, pruneDays, sameDays, withDay, type DaySet,
} from './dayset.ts';
import { p, schemaOf, type Parser } from './schema.ts';
import type { BodyArcadeStore } from './store.ts';

export const HABIT = {
  /** Seconds of play, in all games together, that make a day an active day. */
  activeDaySeconds: 180,
  /** Active days a week needs for the week streak. */
  weekGoal: 3,
  /** Rest days a week without and with a paid plan. */
  restFree: 1,
  restPaid: 2,
  /** How many months of days are kept (and synced). */
  keepMonths: 14,
  /** The seconds of this many days are kept on the device, so a day can become active over several rounds. */
  keepSecondsDays: 14,
  /** One call cannot add more than a day. */
  maxSeconds: 86_400,
} as const;

export interface HabitWeek {
  /** The Monday and the Sunday of this week. */
  start: Day;
  end: Day;
  /** Active days so far this week (never one that has not come yet). */
  days: number;
  goal: number;
  met: boolean;
  /** Days left this week, today included. */
  daysLeft: number;
  /** The goal can still be reached with the days that are left (always true once it is met). */
  canStillMeet: boolean;
}

export interface HabitView {
  today: Day;
  /** Seconds played today on this device. */
  todaySeconds: number;
  todayActive: boolean;
  /** Weeks in a row that had their active days, this one included once it has them. */
  weekStreak: number;
  week: HabitWeek;
  /** Active days in a row (rest days bridge a gap and are not counted); alive through today or yesterday. */
  dayStreak: number;
  /** Rest days of this week: how many there are, how many are used (by yesterday and before), how many are left. */
  rest: { allowance: number; used: number; available: number };
}

/** The part of the habit that two devices exchange. */
export interface HabitDoc { v: 1; a: DaySet; r: DaySet }

export interface PlayResult {
  day: Day;
  /** Seconds played today on this device, this call included. */
  seconds: number;
  /** This call made the day an active day. */
  becameActive: boolean;
  /** Rest days used by this call (see settle). */
  rested: Day[];
}

export interface Habit {
  /** A finished round of `seconds` seconds, today. Never throws; what is not a number of seconds adds nothing. */
  addPlay(seconds: number): PlayResult;
  /** Uses the rest days for the days that were missed since the player was last here. Returns the days it rested. */
  settle(): Day[];
  view(): HabitView;
  doc(): HabitDoc;
  /** Takes in what another device knows. True when something here changed. */
  merge(remote: unknown): boolean;
}

export interface HabitOptions {
  /** A paid plan is active now (it gives two rest days a week instead of one). */
  paid?: () => boolean;
}

// ───────── the pure part ─────────

/**
 * The days the rest days would be used for, oldest first. They are the days after the last active or rest day (before
 * today) that were missed, one after the other, for as long as their week still has a rest day left. The first missed day
 * without one ends it: a streak that is broken stays broken, and `settledThrough` makes sure that a gap is only judged once
 * (a plan bought afterwards does not bring an old streak back).
 */
export function settlement(active: DaySet, rest: DaySet, today: Day, o: { allowance: number; settledThrough: Day | null }): Day[] {
  const anchor = lastDay(dropAfter(mergeDays(active, rest), prevDay(today)));
  if (anchor === null) return [];
  if (o.settledThrough !== null && o.settledThrough > anchor) return [];
  const out: Day[] = [];
  const used = new Map<Day, number>();
  for (let d = addDays(anchor, 1); d < today; d = addDays(d, 1)) {
    if (hasDay(active, d) || hasDay(rest, d)) continue;
    const w = weekStart(d);
    const n = used.get(w) ?? countDays(rest, w, addDays(w, 6));
    if (n >= o.allowance) break;
    used.set(w, n + 1);
    out.push(d);
  }
  return out;
}

function dayStreakOf(active: DaySet, rest: DaySet, today: Day): number {
  let n = hasDay(active, today) ? 1 : 0;
  let d = prevDay(today);
  for (let i = 0; i < 1500; i++) {
    if (hasDay(active, d)) n++;
    else if (!hasDay(rest, d)) break;
    d = prevDay(d);
  }
  return n;
}

function weekStreakOf(active: DaySet, today: Day, goal: number): number {
  const start = weekStart(today);
  let n = countDays(active, start, today) >= goal ? 1 : 0;
  let w = addDays(start, -7);
  for (let i = 0; i < 400 && countDays(active, w, addDays(w, 6)) >= goal; i++) {
    n++;
    w = addDays(w, -7);
  }
  return n;
}

/** What the screens show, from the facts. `rest` holds the rest days already used and those that settle would use. */
export function describeHabit(active: DaySet, rest: DaySet, today: Day, o: { todaySeconds: number; allowance: number }): HabitView {
  const a = dropAfter(active, today);
  const r = dropAfter(rest, today);
  const start = weekStart(today);
  const end = addDays(start, 6);
  const todayActive = hasDay(a, today);
  const days = countDays(a, start, today);
  const daysLeft = daysBetween(today, end) + 1;
  const met = days >= HABIT.weekGoal;
  const used = countDays(r, start, end);
  return {
    today,
    todaySeconds: o.todaySeconds,
    todayActive,
    weekStreak: weekStreakOf(a, today, HABIT.weekGoal),
    week: { start, end, days, goal: HABIT.weekGoal, met, daysLeft, canStillMeet: met || days + (todayActive ? daysLeft - 1 : daysLeft) >= HABIT.weekGoal },
    dayStreak: dayStreakOf(a, r, today),
    rest: { allowance: o.allowance, used, available: Math.max(0, o.allowance - used) },
  };
}

// ───────── the document two devices exchange ─────────

const docParser: Parser<HabitDoc> = p.object({
  v: p.literal(1),
  a: p.withDefault(daySetParser(HABIT.keepMonths + 2), () => ({})),
  r: p.withDefault(daySetParser(HABIT.keepMonths + 2), () => ({})),
}) as Parser<HabitDoc>;

export const emptyHabitDoc = (): HabitDoc => ({ v: 1, a: EMPTY_DAYS, r: EMPTY_DAYS });

/** A habit document from another device, or null when it is not one (a newer version is not read: it is left alone). */
export function readHabitDoc(raw: unknown): HabitDoc | null {
  const r = docParser(raw);
  return typeof r === 'symbol' ? null : { v: 1, a: r.a, r: r.r };
}

/** The union of two documents, pruned to what is kept. Commutative, associative and idempotent. */
export function mergeHabitDocs(x: HabitDoc, y: HabitDoc): HabitDoc {
  return { v: 1, a: pruneDays(mergeDays(x.a, y.a), HABIT.keepMonths), r: pruneDays(mergeDays(x.r, y.r), HABIT.keepMonths) };
}

// ───────── the stored part ─────────

const SetSchema = schemaOf<DaySet>(1, daySetParser(HABIT.keepMonths + 2));
const SecondsSchema = schemaOf<Record<Day, number>>(1, p.record(p.number({ min: 0, max: HABIT.maxSeconds }), { max: HABIT.keepSecondsDays + 4, key: /^\d{4}-\d{2}-\d{2}$/, lenient: true }));
const SettledSchema = schemaOf<Day | null>(1, p.nullable(p.day()));

export function createHabit(store: BodyArcadeStore, o: HabitOptions = {}): Habit {
  const ns = store.ns('habit');
  const activeSlot = ns.slot<DaySet>('active', SetSchema, () => ({}));
  const restSlot = ns.slot<DaySet>('rest', SetSchema, () => ({}));
  const secondsSlot = ns.slot<Record<Day, number>>('seconds', SecondsSchema, () => ({}));
  const settledSlot = ns.slot<Day | null>('settled', SettledSchema, null);
  const allowance = (): number => (o.paid?.() === true ? HABIT.restPaid : HABIT.restFree);
  /** Tomorrow may already be today on another device's clock, so one day ahead is let through and nothing more. */
  const horizon = (): Day => addDays(store.day(), 1);

  function plan(today: Day): Day[] {
    return settlement(dropAfter(activeSlot.get(), today), dropAfter(restSlot.get(), today), today, { allowance: allowance(), settledThrough: settledSlot.get() });
  }

  function settle(): Day[] {
    const today = store.day();
    const marks = plan(today);
    if (marks.length > 0) restSlot.set(pruneDays(marks.reduce<DaySet>(withDay, restSlot.get()), HABIT.keepMonths));
    const through = prevDay(today);
    if (settledSlot.get() !== through) settledSlot.set(through);
    return marks;
  }

  return {
    addPlay(seconds) {
      const day = store.day();
      const add = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, HABIT.maxSeconds) : 0;
      const rested = settle();
      const all = secondsSlot.get();
      const total = Math.min(HABIT.maxSeconds, (all[day] ?? 0) + add);
      if (add > 0) {
        const oldest = addDays(day, -HABIT.keepSecondsDays);
        const kept = Object.fromEntries(Object.entries(all).filter(([d]) => d >= oldest));
        kept[day] = total;
        secondsSlot.set(kept);
      }
      let becameActive = false;
      if (total >= HABIT.activeDaySeconds && !hasDay(activeSlot.get(), day)) {
        activeSlot.set(pruneDays(withDay(activeSlot.get(), day), HABIT.keepMonths));
        becameActive = true;
      }
      return { day, seconds: total, becameActive, rested };
    },

    settle,

    view() {
      const today = store.day();
      const a = dropAfter(activeSlot.get(), today);
      const r = plan(today).reduce<DaySet>(withDay, dropAfter(restSlot.get(), today));
      return describeHabit(a, r, today, { todaySeconds: secondsSlot.get()[today] ?? 0, allowance: allowance() });
    },

    doc() {
      const h = horizon();
      return { v: 1, a: pruneDays(dropAfter(activeSlot.get(), h), HABIT.keepMonths), r: pruneDays(dropAfter(restSlot.get(), h), HABIT.keepMonths) };
    },

    merge(remote) {
      const doc = readHabitDoc(remote);
      if (!doc) return false;
      const h = horizon();
      const a = pruneDays(dropAfter(mergeDays(activeSlot.get(), doc.a), h), HABIT.keepMonths);
      const r = pruneDays(dropAfter(mergeDays(restSlot.get(), doc.r), h), HABIT.keepMonths);
      let changed = false;
      if (!sameDays(a, activeSlot.get())) { activeSlot.set(a); changed = true; }
      if (!sameDays(r, restSlot.get())) { restSlot.set(r); changed = true; }
      return changed;
    },
  };
}
