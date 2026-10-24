// A set of calendar days, kept as one whole number per month: bit (d - 1) of the number for 'YYYY-MM' is set when day d
// of that month is in the set. A year of days is about a dozen short numbers, which is why the streak, the daily
// challenge and the plans fit the 3,000 characters a synced document may have, and why the set merges the way two
// devices need: the union of two sets (mergeDays) gives the same set whichever one is merged into which, however
// often, and never loses a day either device wrote. Nothing here is a counter, so nothing can be counted twice.
import { addDays, daysBetween, isDay, parseDay, type Day } from './date.ts';
import { BAD, type Parser } from './schema.ts';

/** 'YYYY-MM' -> the days of that month, one bit each. Never holds a month with no day in it. */
export type DaySet = Readonly<Record<string, number>>;

export const EMPTY_DAYS: DaySet = Object.freeze({});
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Day 31 is bit 30: every bitmap is a non-negative 31-bit whole number, so the bit operators never turn it negative. */
const MAX_BITMAP = 0x7fffffff;

const daysIn = (month: string): number => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const maskOf = (month: string): number => {
  const n = daysIn(month);
  return n >= 31 ? MAX_BITMAP : (1 << n) - 1;
};

export function hasDay(set: DaySet, day: Day): boolean {
  const p = parseDay(day);
  if (!p) return false;
  const bits = set[day.slice(0, 7)];
  return bits !== undefined && (bits & (1 << (p.d - 1))) !== 0;
}

/** The set with the day added (the same object when it was there already). A value that is not a day changes nothing. */
export function withDay(set: DaySet, day: Day): DaySet {
  const p = parseDay(day);
  if (!p || hasDay(set, day)) return set;
  const month = day.slice(0, 7);
  return { ...set, [month]: ((set[month] ?? 0) | (1 << (p.d - 1))) >>> 0 };
}

/** The union. Commutative, associative and idempotent, so any number of devices converge on the same set. */
export function mergeDays(a: DaySet, b: DaySet): DaySet {
  const out: Record<string, number> = { ...a };
  for (const [month, bits] of Object.entries(b)) out[month] = ((out[month] ?? 0) | bits) >>> 0;
  return out;
}

/** The days in the set, oldest first. */
export function daysOf(set: DaySet): Day[] {
  const out: Day[] = [];
  for (const month of Object.keys(set).sort()) {
    const bits = set[month] ?? 0;
    for (let d = 1; d <= 31; d++) if (bits & (1 << (d - 1))) out.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/** How many days of the set lie between two days, both included. */
export function countDays(set: DaySet, from: Day, to: Day): number {
  if (!isDay(from) || !isDay(to) || daysBetween(from, to) < 0) return 0;
  let n = 0;
  for (let d = from; ; d = addDays(d, 1)) {
    if (hasDay(set, d)) n++;
    if (d === to) break;
  }
  return n;
}

/** The latest day in the set, or null. */
export function lastDay(set: DaySet): Day | null {
  const all = Object.keys(set).filter((m) => (set[m] ?? 0) !== 0).sort();
  const month = all.at(-1);
  if (month === undefined) return null;
  const bits = set[month] as number;
  for (let d = 31; d >= 1; d--) if (bits & (1 << (d - 1))) return `${month}-${String(d).padStart(2, '0')}`;
  return null;
}

/** Only the newest `months` months that hold a day: how a long-lived set stays small. Idempotent, and a merge of two pruned sets is pruned again. */
export function pruneDays(set: DaySet, months: number): DaySet {
  const keys = Object.keys(set).filter((m) => (set[m] ?? 0) !== 0).sort();
  if (keys.length <= months) return set;
  const keep = new Set(keys.slice(keys.length - Math.max(0, months)));
  return Object.fromEntries(Object.entries(set).filter(([m]) => keep.has(m)));
}

export const sameDays = (a: DaySet, b: DaySet): boolean => {
  const ka = Object.keys(a).filter((m) => (a[m] ?? 0) !== 0);
  const kb = Object.keys(b).filter((m) => (b[m] ?? 0) !== 0);
  return ka.length === kb.length && ka.every((m) => a[m] === b[m]);
};

/**
 * A set read back from storage or from another device: months that are not months and numbers that are not bitmaps are
 * dropped, bits beyond the end of a month are cleared, and no more than `maxMonths` of the newest months are kept.
 * Hostile or damaged input can only ever be a smaller, valid set.
 */
export function daySetParser(maxMonths = 36): Parser<DaySet> {
  return (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return BAD;
    const out: Record<string, number> = {};
    for (const [month, bits] of Object.entries(raw)) {
      if (!MONTH_RE.test(month) || typeof bits !== 'number' || !Number.isInteger(bits) || bits < 0 || bits > MAX_BITMAP) continue;
      const clean = (bits & maskOf(month)) >>> 0;
      if (clean !== 0) out[month] = clean;
    }
    return pruneDays(out, maxMonths);
  };
}

/** The set without the days after `day`: a clock that was set wrong on one device cannot put days into the future of the others. */
export function dropAfter(set: DaySet, day: Day): DaySet {
  const p = parseDay(day);
  if (!p) return set;
  const month = day.slice(0, 7);
  const out: Record<string, number> = {};
  let changed = false;
  for (const [m, bits] of Object.entries(set)) {
    if (m > month) { changed = true; continue; }
    if (m === month) {
      const kept = (bits & (p.d >= 31 ? MAX_BITMAP : (1 << p.d) - 1)) >>> 0;
      if (kept !== bits) changed = true;
      if (kept !== 0) out[m] = kept;
    } else {
      out[m] = bits;
    }
  }
  return changed ? out : set;
}
