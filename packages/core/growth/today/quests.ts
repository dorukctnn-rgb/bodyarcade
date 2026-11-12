// Quests, the weekly challenge, points and badges (kol F), worked out from the facts (history.ts), never from a counter: a
// quest is done when what it asks for happened that day, and the points are the sum over the days. Rules that keep it
// healthy (game-design 2.3 and the habit's spirit):
//   - on a gentle day (low energy, short sleep, tired or in pain, from that day's check-in) the quests ask only for the
//     check-in and five easy minutes: no record to beat, no extra minutes;
//   - points never go down and nothing is lost by missing a day; there is no "do it or lose it" message;
//   - the weekly challenge is one of a few, picked by the week, and can be met in three ordinary days.
import { addDays, daySeed, weekStart, type Day } from '../../store/date.ts';
import type { DailyCheckin } from '../program/checkin.ts';
import { activeDays, bestWeekStreak, firstDay, recordsOn, secondsByDay, sessionsOf, type Facts } from './history.ts';

export type QuestId = 'checkin' | 'move10' | 'move20' | 'game' | 'workout' | 'new-best' | 'easy5';
export interface Quest { id: QuestId; done: boolean; value: number; goal: number; points: number }

export const QUEST_POINTS = 10;
export const ALL_DONE_BONUS = 10;
export const CHALLENGE_POINTS = 50;

/** Low energy, short sleep, a tired body or pain: the day asks for little. */
export const gentle = (a: DailyCheckin | null | undefined): boolean => !!a && (a.energy <= 2 || a.sleep === 'poor' || a.body === 'tired' || a.body === 'pain');

/** The second and third quests of an ordinary day, in turn by the date. */
const PAIRS: readonly [QuestId, QuestId][] = [['workout', 'move10'], ['game', 'move20'], ['workout', 'game'], ['move10', 'new-best'], ['game', 'move10'], ['workout', 'move20']];

export function questIds(day: Day, checkin: DailyCheckin | null | undefined): QuestId[] {
  if (gentle(checkin)) return ['checkin', 'easy5'];
  return ['checkin', ...PAIRS[daySeed(day) % PAIRS.length]!];
}

interface DayFacts { checkin: DailyCheckin | null; seconds: number; sets: number; rounds: number; record: boolean }

function dayFacts(f: Facts, day: Day, by = secondsByDay(f)): DayFacts {
  const r = recordsOn(f, day);
  return {
    checkin: f.checkins.find((c) => c.day === day)?.a ?? null,
    seconds: by.get(day)?.total ?? 0,
    sets: f.sets.filter((s) => s.day === day).length,
    rounds: f.runs.filter((x) => x.day === day).length + ((f.gameSeconds[day] ?? 0) > 0 && !f.runs.some((x) => x.day === day) ? 1 : 0),
    record: r.moves.length + r.games.length > 0,
  };
}

function judge(id: QuestId, d: DayFacts): { done: boolean; value: number; goal: number } {
  switch (id) {
    case 'checkin': return { done: !!d.checkin, value: d.checkin ? 1 : 0, goal: 1 };
    case 'move10': return { done: d.seconds >= 600, value: Math.floor(d.seconds / 60), goal: 10 };
    case 'move20': return { done: d.seconds >= 1200, value: Math.floor(d.seconds / 60), goal: 20 };
    case 'easy5': return { done: d.seconds >= 300, value: Math.floor(d.seconds / 60), goal: 5 };
    case 'game': return { done: d.rounds >= 1, value: Math.min(1, d.rounds), goal: 1 };
    case 'workout': return { done: d.sets >= 1, value: Math.min(1, d.sets), goal: 1 };
    case 'new-best': return { done: d.record, value: d.record ? 1 : 0, goal: 1 };
  }
}

export function dailyQuests(f: Facts, day: Day = f.today): Quest[] {
  const d = dayFacts(f, day);
  return questIds(day, d.checkin).map((id) => ({ id, ...judge(id, d), points: QUEST_POINTS }));
}

export type ChallengeId = 'days' | 'minutes' | 'games' | 'workouts' | 'photo' | 'measure';
export interface Challenge { id: ChallengeId; start: Day; goal: number; value: number; done: boolean; points: number }

const CHALLENGES: readonly { id: ChallengeId; goal: number; adult?: boolean }[] = [
  { id: 'days', goal: 3 }, { id: 'minutes', goal: 60 }, { id: 'games', goal: 3 }, { id: 'workouts', goal: 2 }, { id: 'photo', goal: 1, adult: true }, { id: 'measure', goal: 1 },
];

/** The week's challenge (picked by the week's Monday; no photo challenge under 18). */
export function weeklyChallenge(f: Facts, o: { minor?: boolean } = {}, day: Day = f.today): Challenge {
  const start = weekStart(day);
  const pool = CHALLENGES.filter((c) => !(c.adult && o.minor));
  const c = pool[Math.floor(daySeed(start) / 7) % pool.length]!;
  const end = addDays(start, 6);
  const inWeek = (d: Day): boolean => d >= start && d <= end && d <= f.today;
  const by = secondsByDay(f);
  let value = 0;
  if (c.id === 'days') value = [...activeDays(f)].filter(inWeek).length;
  else if (c.id === 'minutes') { for (const [d, v] of by) if (inWeek(d)) value += v.total; value = Math.floor(value / 60); }
  else if (c.id === 'games') value = new Set(f.runs.filter((r) => inWeek(r.day)).map((r) => r.game)).size;
  else if (c.id === 'workouts') value = sessionsOf(f.sets).filter((s) => inWeek(s.day)).length;
  else if (c.id === 'photo') value = f.photoDays.filter(inWeek).length;
  else value = f.measureDays.filter(inWeek).length;
  return { id: c.id, start, goal: c.goal, value: Math.min(value, c.goal * 10), done: value >= c.goal, points: CHALLENGE_POINTS };
}

/** Points: every quest done on every day (and the bonus for a day with all done), every weekly challenge met. */
export function pointsOf(f: Facts, o: { minor?: boolean } = {}): { total: number; week: number; today: number } {
  const first = firstDay(f);
  if (!first) return { total: 0, week: 0, today: 0 };
  const by = secondsByDay(f);
  const monday = weekStart(f.today);
  let total = 0, week = 0, today = 0;
  let d = first < addDays(f.today, -400) ? addDays(f.today, -400) : first;
  for (let k = 0; k < 401 && d <= f.today; k++, d = addDays(d, 1)) {
    const facts = dayFacts(f, d, by);
    const qs = questIds(d, facts.checkin).map((id) => judge(id, facts));
    let p = qs.filter((q) => q.done).length * QUEST_POINTS;
    if (qs.every((q) => q.done)) p += ALL_DONE_BONUS;
    total += p;
    if (d >= monday) week += p;
    if (d === f.today) today = p;
  }
  for (let w = weekStart(first); w <= monday; w = addDays(w, 7)) {
    const c = weeklyChallenge(f, o, w);
    if (c.done) { total += c.points; if (w === monday) week += c.points; }
  }
  return { total, week, today };
}

export type BadgeId = 'first-checkin' | 'checkins-7' | 'first-workout' | 'workouts-10' | 'minutes-100' | 'minutes-1000' | 'week-streak-3' | 'week-streak-8' | 'games-5' | 'first-record' | 'first-photo' | 'first-measure';
export interface Badge { id: BadgeId; earned: boolean; value: number; goal: number }

/** The badges, earned or with how far along they are (the photo badge is not shown under 18). */
export function badgesOf(f: Facts, o: { minor?: boolean; weekGoalDays?: number } = {}): Badge[] {
  const sessions = sessionsOf(f.sets).length;
  const minutes = Math.floor([...secondsByDay(f).values()].reduce((a, v) => a + v.total, 0) / 60);
  const streak = bestWeekStreak(activeDays(f), o.weekGoalDays);
  const games = new Set([...f.runs.map((r) => r.game), ...(f.gameBests ?? []).filter((b) => b.best > 0).map((b) => b.game)]).size;
  const days = [...new Set([...f.sets.map((s) => s.day), ...f.runs.map((r) => r.day)])].sort();
  const record = days.some((d) => { const r = recordsOn(f, d); return r.moves.length + r.games.length > 0; });
  const list: [BadgeId, number, number][] = [
    ['first-checkin', f.checkins.length, 1], ['checkins-7', f.checkins.length, 7],
    ['first-workout', sessions, 1], ['workouts-10', sessions, 10],
    ['minutes-100', minutes, 100], ['minutes-1000', minutes, 1000],
    ['week-streak-3', streak, 3], ['week-streak-8', streak, 8],
    ['games-5', games, 5], ['first-record', record ? 1 : 0, 1],
    ...(o.minor ? [] : [['first-photo', f.photoDays.length, 1] as [BadgeId, number, number]]),
    ['first-measure', f.measureDays.length, 1],
  ];
  return list.map(([id, value, goal]) => ({ id, earned: value >= goal, value: Math.min(value, goal), goal }));
}
