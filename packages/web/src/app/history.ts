// The player's rounds, kept on the device: what this week looks like against the daily line, the streak, and the most
// recent bests. Pure functions over a short list; nothing here is a guess, every number is added up from finished rounds.
import type { Schema } from '../../../core/types/index.ts';
import { addDays, dayOf, daysBetween, isDay, type Day } from '../../../core/store/date.ts';

export interface RoundRecord {
  day: Day;
  game: string;
  score: number;
  seconds: number;
  /** Epoch ms when the round ended. */
  at: number;
}

export const MAX_HISTORY = 120;
/** The daily line: this many minutes of play counts as a day that reached it. */
export const DAILY_GOAL_MINUTES = 10;
/** The week chart is drawn up to this many minutes; a longer day fills the bar. */
export const CHART_TOP_MINUTES = 14;

export const HISTORY_SCHEMA: Schema<RoundRecord[]> = {
  version: 1,
  parse(raw) {
    if (!Array.isArray(raw)) return null;
    const out: RoundRecord[] = [];
    for (const r of raw as unknown[]) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      if (!isDay(o['day']) || typeof o['game'] !== 'string' || typeof o['score'] !== 'number' || typeof o['seconds'] !== 'number' || typeof o['at'] !== 'number') continue;
      if (!Number.isFinite(o['score']) || !Number.isFinite(o['seconds']) || o['seconds'] < 0) continue;
      out.push({ day: o['day'], game: o['game'], score: o['score'], seconds: o['seconds'], at: o['at'] });
    }
    return out.slice(-MAX_HISTORY);
  },
};

/** Adds a round and keeps the newest MAX_HISTORY. */
export function addRound(history: readonly RoundRecord[], r: RoundRecord): RoundRecord[] {
  return [...history, r].slice(-MAX_HISTORY);
}

export interface WeekDay {
  /** Monday is 0. */
  index: number;
  day: Day;
  /** Whole minutes played; null for a day that has not come yet. */
  minutes: number | null;
  today: boolean;
  /** Reached the daily line. */
  hit: boolean;
}

export interface WeekStats {
  days: WeekDay[];
  totalMinutes: number;
  /** Days in a row with a round, counting back from today (or from yesterday while today has none). */
  streak: number;
  /** Days of this week that reached the line. */
  hits: number;
  hasAny: boolean;
}

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(day: Day): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function weekStats(history: readonly RoundRecord[], today: Day, goal = DAILY_GOAL_MINUTES): WeekStats {
  const secondsOf = new Map<Day, number>();
  for (const r of history) secondsOf.set(r.day, (secondsOf.get(r.day) ?? 0) + r.seconds);
  const minutesOf = (d: Day): number => Math.round((secondsOf.get(d) ?? 0) / 60);
  const monday = addDays(today, -weekdayIndex(today));
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const future = daysBetween(today, d) > 0;
    const minutes = future ? null : minutesOf(d);
    days.push({ index: i, day: d, minutes, today: d === today, hit: minutes !== null && minutes >= goal });
  }
  let streak = 0;
  let cursor: Day = (secondsOf.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  while ((secondsOf.get(cursor) ?? 0) > 0) { streak += 1; cursor = addDays(cursor, -1); }
  return {
    days,
    totalMinutes: days.reduce((n, d) => n + (d.minutes ?? 0), 0),
    streak,
    hits: days.filter((d) => d.hit).length,
    hasAny: history.length > 0,
  };
}

export interface RecentBest { game: string; score: number; day: Day }

/** The latest round of each game, newest first: for "Recent bests". Scores are the game's best, not the round's. */
export function recentBests(history: readonly RoundRecord[], bestOf: (game: string) => number | null, max = 3): RecentBest[] {
  const seen = new Set<string>();
  const out: RecentBest[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
    const r = history[i] as RoundRecord;
    if (seen.has(r.game)) continue;
    seen.add(r.game);
    out.push({ game: r.game, score: bestOf(r.game) ?? r.score, day: r.day });
  }
  return out;
}

export { dayOf };
