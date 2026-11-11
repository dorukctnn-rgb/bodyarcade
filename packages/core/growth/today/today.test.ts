// The Today panel, the progress page and the quests (kol F) on hand-made facts.
import { describe, expect, it } from 'vitest';
import { addDays, type Day } from '../../store/date.ts';
import { generateProgram } from '../program/generate.ts';
import { getTodayPlan, type DailyCheckin } from '../program/checkin.ts';
import { activeDays, bestWeekStreak, gameRecords, historyOf, moveRecords, recordsOn, secondsByDay, sessionsOf, totalMinutes, weekOf, weeklyMinutes, weekStreak, type Facts, type SetFact } from './history.ts';
import { ALL_DONE_BONUS, badgesOf, CHALLENGE_POINTS, dailyQuests, gentle, pointsOf, QUEST_POINTS, questIds, weeklyChallenge } from './quests.ts';
import { coachTip, goalMinutes, pickGame, planSplit, type GameCard } from './today.ts';

const wed: Day = '2026-11-11';
const ok: DailyCheckin = { sleep: 'good', energy: 4, body: 'fine', minutes: 20, priority: 'any' };
const at = (day: Day, h = 18, m = 0): number => Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

/** A program session on a day: `n` sets of a move, each 40 s, a minute apart. */
function session(day: Day, id: string, move: SetFact['move'], values: number[], loadKg?: number): SetFact[] {
  return values.map((v, i) => ({ day, sessionId: id, move, value: v, startedAt: at(day) + i * 60_000, endedAt: at(day) + i * 60_000 + 40_000, ...(loadKg ? { loadKg } : {}) }));
}
const empty = (today: Day = wed): Facts => ({ today, sets: [], runs: [], gameSeconds: {}, checkins: [], photoDays: [], measureDays: [] });

describe('history: sessions, active days, the week and its streak', () => {
  it('sets fold into sessions; a session lasts from its first set to its last', () => {
    const s = sessionsOf([...session(wed, 'a', 'squat', [10, 10, 10]), ...session('2026-11-10', 'b', 'pushUp', [8])]);
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s[0]!.seconds).toBe(160);
    expect(s[0]!.sets).toBe(3);
  });

  it('an active day is three minutes of games and program together', () => {
    const f: Facts = { ...empty(), gameSeconds: { [wed]: 100, '2026-11-10': 200 }, sets: session(wed, 'a', 'squat', [10, 10]) };
    const by = secondsByDay(f);
    expect(by.get(wed)).toEqual({ game: 100, workout: 100, total: 200 });
    expect([...activeDays(f)].sort()).toEqual(['2026-11-10', wed]);
  });

  it('the week: Monday to Sunday, the goal of active days and minutes, what is left', () => {
    const f: Facts = { ...empty(), gameSeconds: { '2026-11-09': 600, '2026-11-10': 900 } };
    const w = weekOf(f, { days: 3, minutes: 30 });
    expect(w.start).toBe('2026-11-09');
    expect(w.days.map((d) => d.active)).toEqual([true, true, false, false, false, false, false]);
    expect(w.activeDays).toBe(2);
    expect(w.daysToGo).toBe(1);
    expect(w.daysLeft).toBe(5);
    expect(w.canStillMeet).toBe(true);
    expect(w.minutesMet).toBe(false);
    expect(w.days.filter((d) => d.future).length).toBe(4);
  });

  it('week streak: the running week counts once met and breaks nothing before; a missed week ends it', () => {
    const active = new Set<Day>();
    for (const monday of ['2026-10-19', '2026-10-26', '2026-11-02']) for (const k of [0, 2, 4]) active.add(addDays(monday, k));
    expect(weekStreak(active, wed)).toBe(3);
    active.add('2026-11-09'); active.add('2026-11-10'); active.add(wed);
    expect(weekStreak(active, wed)).toBe(4);
    expect(bestWeekStreak(active)).toBe(4);
    active.delete('2026-10-28');
    expect(weekStreak(active, wed)).toBe(2);
  });

  it('weekly minutes, oldest first, the running week last; total minutes', () => {
    const f: Facts = { ...empty(), gameSeconds: { '2026-11-02': 1200, [wed]: 600 } };
    const w = weeklyMinutes(f, 3);
    expect(w).toEqual([{ start: '2026-10-26', minutes: 0 }, { start: '2026-11-02', minutes: 20 }, { start: '2026-11-09', minutes: 10 }]);
    expect(totalMinutes(f)).toBe(30);
  });
});

describe('records and history', () => {
  const sets = [...session('2026-11-02', 'a', 'squat', [8, 9]), ...session('2026-11-05', 'b', 'squat', [10, 12]), ...session(wed, 'c', 'gobletSquat', [10, 8], 8), ...session(wed, 'd', 'gobletSquat', [6], 10)];
  const runs = [
    { day: '2026-11-03', game: 'squat-flap', t: at('2026-11-03'), score: 900, seconds: 240 },
    { day: wed, game: 'squat-flap', t: at(wed, 19), score: 1200, seconds: 250 },
    { day: wed, game: 'star-catch', t: at(wed, 20), score: 300, seconds: 190 },
  ];
  const f: Facts = { ...empty(), sets, runs };

  it('the best set of each move and its heaviest load', () => {
    const r = moveRecords(sets);
    const sq = r.find((x) => x.move === 'squat')!;
    expect(sq.best).toBe(12); expect(sq.day).toBe('2026-11-05');
    const gb = r.find((x) => x.move === 'gobletSquat')!;
    expect(gb.load).toEqual({ kg: 10, value: 6, day: wed });
  });

  it('game bests, also the ones the arcade kept but the rounds list lost', () => {
    const g = gameRecords({ ...f, gameBests: [{ game: 'pad-work', best: 5000 }] });
    expect(g.find((x) => x.game === 'squat-flap')).toMatchObject({ best: 1200, runs: 2, day: wed });
    expect(g.find((x) => x.game === 'pad-work')).toMatchObject({ best: 5000, runs: 0, day: null });
  });

  it('a record beats an earlier best; a first time is not a record', () => {
    expect(recordsOn(f, '2026-11-05').moves).toEqual([{ move: 'squat', value: 12 }]);
    expect(recordsOn(f, wed).games).toEqual([{ game: 'squat-flap', score: 1200 }]);
    expect(recordsOn(f, wed).moves).toEqual([]);
  });

  it('the history list is newest first and mixes sessions and rounds', () => {
    const h = historyOf(f, 3);
    expect(h.map((x) => x.kind)).toEqual(['game', 'game', 'workout']);
  });
});

describe('quests, the weekly challenge, points, badges', () => {
  it('a gentle day asks for the check-in and five easy minutes only', () => {
    expect(gentle({ ...ok, energy: 2 })).toBe(true);
    expect(gentle({ ...ok, body: 'pain', painAreas: ['knee'] })).toBe(true);
    expect(gentle(ok)).toBe(false);
    expect(questIds(wed, { ...ok, sleep: 'poor' })).toEqual(['checkin', 'easy5']);
    const ids = questIds(wed, ok);
    expect(ids[0]).toBe('checkin'); expect(ids).toHaveLength(3); expect(ids).not.toContain('easy5');
  });

  it('quests are done by what happened that day', () => {
    const f: Facts = { ...empty(), checkins: [{ day: wed, a: ok }], gameSeconds: { [wed]: 1300 }, runs: [{ day: wed, game: 'star-catch', t: at(wed), score: 10, seconds: 200 }], sets: session(wed, 'a', 'squat', [10]) };
    const q = dailyQuests(f);
    expect(q.every((x) => x.done)).toBe(true);
    expect(q[0]).toMatchObject({ id: 'checkin', done: true, points: QUEST_POINTS });
    const none = dailyQuests({ ...empty(), checkins: [{ day: wed, a: ok }] });
    expect(none.filter((x) => x.done).map((x) => x.id)).toEqual(['checkin']);
  });

  it('the same day always gives the same quests', () => {
    expect(questIds(wed, ok)).toEqual(questIds(wed, { ...ok, minutes: 45 }));
    const days = Array.from({ length: 12 }, (_, k) => questIds(addDays(wed, k), ok).join());
    expect(new Set(days).size).toBeGreaterThan(2);
  });

  it('points: quests and the all-done bonus each day, the weekly challenge; nothing is taken away', () => {
    const f: Facts = { ...empty(), checkins: [{ day: '2026-11-10', a: ok }, { day: wed, a: { ...ok, energy: 1 } }], gameSeconds: { [wed]: 400 } };
    const p = pointsOf(f);
    // Tuesday: the check-in only (one of three); Wednesday is gentle: check-in + five minutes, all done
    expect(p.today).toBe(2 * QUEST_POINTS + ALL_DONE_BONUS);
    expect(p.week).toBe(QUEST_POINTS + p.today);
    expect(p.total).toBe(p.week);
    const more = pointsOf({ ...f, gameSeconds: { [wed]: 400, '2026-11-09': 1300 } });
    expect(more.total).toBeGreaterThanOrEqual(p.total);
    expect(CHALLENGE_POINTS).toBeGreaterThan(QUEST_POINTS);
  });

  it('the weekly challenge is the same all week and counts only this week', () => {
    const a = weeklyChallenge(empty('2026-11-09'));
    const b = weeklyChallenge(empty('2026-11-15'));
    expect(a.id).toBe(b.id);
    expect(a.start).toBe('2026-11-09');
    const kinds = new Set(Array.from({ length: 12 }, (_, k) => weeklyChallenge(empty(addDays(wed, 7 * k))).id));
    expect(kinds.size).toBeGreaterThan(3);
    for (let k = 0; k < 12; k++) expect(weeklyChallenge(empty(addDays(wed, 7 * k)), { minor: true }).id).not.toBe('photo');
  });

  it('badges: earned from the facts, with how far along; no photo badge under 18', () => {
    const f: Facts = { ...empty(), checkins: [{ day: wed, a: ok }], sets: session(wed, 'a', 'squat', [10]), measureDays: [wed] };
    const b = badgesOf(f);
    expect(b.find((x) => x.id === 'first-checkin')?.earned).toBe(true);
    expect(b.find((x) => x.id === 'first-workout')?.earned).toBe(true);
    expect(b.find((x) => x.id === 'workouts-10')).toMatchObject({ earned: false, value: 1, goal: 10 });
    expect(b.find((x) => x.id === 'first-measure')?.earned).toBe(true);
    expect(badgesOf(f, { minor: true }).some((x) => x.id === 'first-photo')).toBe(false);
  });
});

describe('today: plan split, the game, the goal, the tip', () => {
  const program = generateProgram({ goal: 'general', level: 'beginner', equipment: [], days: [3], minutes: 30 });

  it('the plan in three parts that add up to its minutes', () => {
    for (const minutes of [10, 15, 20, 30]) {
      const p = getTodayPlan({ program, date: wed, checkin: { ...ok, minutes } });
      const s = planSplit(p);
      expect(s.warmup + s.work + s.stretch).toBe(p.minutes);
      expect(s.work).toBeGreaterThan(0);
    }
  });

  const games: GameCard[] = [
    { id: 'squat-flap', free: true, regions: ['legs'], lowImpact: true, seated: true, durationSec: 270 },
    { id: 'road-run', free: true, regions: ['cardio', 'legs'], lowImpact: false, seated: true, durationSec: 90 },
    { id: 'star-catch', free: true, regions: ['arms'], lowImpact: true, seated: true, durationSec: 196 },
    { id: 'pad-work', free: false, regions: ['arms', 'core'], lowImpact: true, seated: true, durationSec: 420 },
    { id: 'twist-turbine', free: true, regions: ['core'], lowImpact: true, seated: true, durationSec: 180 },
  ];

  it('the game: free unless Pro, low impact on a low or pain day, nothing on a sore area, the focus first, fixed for the day', () => {
    expect(pickGame(games, { day: wed, focus: 'lower', low: false, pro: false })?.id).toBe('squat-flap');
    expect(pickGame(games, { day: wed, focus: 'lower', low: false, pro: false, painAreas: ['knee'] })?.regions).not.toContain('legs');
    const low = pickGame(games, { day: wed, focus: 'conditioning', low: true, pro: false });
    expect(low?.lowImpact).toBe(true);
    for (let k = 0; k < 10; k++) expect(pickGame(games, { day: addDays(wed, k), focus: 'upper', low: false, pro: false })?.free).toBe(true);
    expect(pickGame(games, { day: wed, focus: 'upper', low: false, pro: false })).toEqual(pickGame(games, { day: wed, focus: 'upper', low: false, pro: false }));
    expect(pickGame([games[1]!], { day: wed, focus: 'full', low: false, pro: false, painAreas: ['knee'] })).toBeNull();
  });

  it('the goal: the check-in minutes, else the program, else 20', () => {
    expect(goalMinutes({ ...ok, minutes: 15 }, 30)).toBe(15);
    expect(goalMinutes(null, 30)).toBe(30);
    expect(goalMinutes(null, null)).toBe(20);
  });

  it('the tip follows its order: pain, low day, check-in, rest day, first time, record, form, step up, week', () => {
    const plan = { restDay: false, intensity: 'normal' as const, notes: [] as ('see-professional' | 'rest-is-fine')[] };
    const week = { daysMet: false, daysToGo: 2, canStillMeet: true };
    expect(coachTip({ checkin: ok, plan: { ...plan, notes: ['see-professional'] }, week, anything: true }).id).toBe('pain');
    expect(coachTip({ checkin: ok, plan: { ...plan, intensity: 'low' }, week, anything: true }).id).toBe('gentle');
    expect(coachTip({ checkin: null, plan, week, anything: true }).id).toBe('checkin-first');
    expect(coachTip({ checkin: ok, plan: { ...plan, restDay: true }, week, anything: true }).id).toBe('rest-day');
    expect(coachTip({ checkin: ok, plan, week, anything: false }).id).toBe('start');
    expect(coachTip({ checkin: ok, plan, week, anything: true, record: { move: 'squat', value: 12 } })).toEqual({ id: 'record', move: 'squat', value: 12 });
    expect(coachTip({ checkin: ok, plan, week: { ...week, daysToGo: 1 }, anything: true }).id).toBe('week-close');
    expect(coachTip({ checkin: ok, plan, week: { ...week, daysMet: true, daysToGo: 0 }, anything: true }).id).toBe('week-met');
    expect(coachTip({ checkin: ok, plan, week, anything: true }).id).toBe('steady');
  });
});
