// One date rule for the whole platform (B13). A "day" is the calendar date in the player's own time zone,
// written 'YYYY-MM-DD'. Free-run counters, the daily goal, streaks and the activity log all use it, so a player at
// UTC+13 and a player at UTC-10 each get their day change at their own midnight, and no two modules disagree.
// v1 used the UTC date for free runs (store.js:14) and the local date for the daily goal (store.js:138).

export type Day = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
const format = (y: number, m: number, d: number): Day => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** Splits a day into numbers, or null when it is not a real calendar date between 1970 and 2200. */
export function parseDay(day: unknown): { y: number; m: number; d: number } | null {
  if (typeof day !== 'string') return null;
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();   // days in that month
  if (d > dim) return null;
  return { y, m: mo, d };
}

export const isDay = (x: unknown): x is Day => parseDay(x) !== null;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The local calendar day of an instant. Without `timeZone` it is the device's time zone (what players mean by "today");
 * tests and the server pass an IANA zone such as 'Pacific/Auckland' to be independent of the machine.
 */
export function dayOf(ms: number, timeZone?: string): Day {
  if (!Number.isFinite(ms)) throw new RangeError('dayOf needs a finite time in milliseconds');
  if (!timeZone) {
    const d = new Date(ms);
    return format(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  let y = 0;
  let m = 0;
  let d = 0;
  for (const part of formatterFor(timeZone).formatToParts(ms)) {
    if (part.type === 'year') y = Number(part.value);
    else if (part.type === 'month') m = Number(part.value);
    else if (part.type === 'day') d = Number(part.value);
  }
  return format(y, m, d);
}

/** Calendar arithmetic on days. It never touches clocks, so daylight saving cannot skip or repeat a day. */
export function addDays(day: Day, n: number): Day {
  const p = parseDay(day);
  if (!p) throw new RangeError(`not a day: ${String(day)}`);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + Math.trunc(n)));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const prevDay = (day: Day): Day => addDays(day, -1);

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: Day, b: Day): number {
  const x = parseDay(a);
  const y = parseDay(b);
  if (!x || !y) throw new RangeError('daysBetween needs two days');
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / MS_PER_DAY);
}

/**
 * The seed v1's daily goal used: year * 10000 + month * 100 + day. Keeping it means a returning player sees the
 * same goal on a given date that the live site would have shown.
 */
export function daySeed(day: Day): number {
  const p = parseDay(day);
  if (!p) throw new RangeError(`not a day: ${String(day)}`);
  return p.y * 10_000 + p.m * 100 + p.d;
}

/** Inverse of daySeed, for importing v1's stored seeds. Null for anything that is not a plausible seed. */
export function dayFromSeed(seed: unknown): Day | null {
  if (typeof seed !== 'number' || !Number.isInteger(seed)) return null;
  const y = Math.floor(seed / 10_000);
  const m = Math.floor((seed % 10_000) / 100);
  const d = seed % 100;
  const day = format(y, m, d);
  return parseDay(day) ? day : null;
}

/** 0 for Monday to 6 for Sunday: the week of the player's calendar starts on Monday. */
export function weekdayIndex(day: Day): number {
  const p = parseDay(day);
  if (!p) throw new RangeError(`not a day: ${String(day)}`);
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week a day is in. */
export const weekStart = (day: Day): Day => addDays(day, -weekdayIndex(day));

/** 'YYYY-MM' of a day: the key of the month bitmaps (dayset.ts). */
export function monthOf(day: Day): string {
  if (!parseDay(day)) throw new RangeError(`not a day: ${String(day)}`);
  return day.slice(0, 7);
}
