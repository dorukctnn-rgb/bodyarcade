import { describe, expect, it } from 'vitest';
import { addRound, DAILY_GOAL_MINUTES, HISTORY_SCHEMA, MAX_HISTORY, recentBests, weekdayIndex, weekStats, type RoundRecord } from './history.ts';

const r = (day: string, seconds: number, game = 'squat-flap', score = 10): RoundRecord => ({ day, game, score, seconds, at: Date.parse(`${day}T12:00:00Z`) });

describe('the week', () => {
  // 2026-10-22 is a Thursday.
  const today = '2026-10-22';

  it('knows which day of the week a date is, Monday first', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0);
    expect(weekdayIndex('2026-10-22')).toBe(3);
    expect(weekdayIndex('2026-10-25')).toBe(6);
  });

  it('has seven days from Monday, later days empty, today marked', () => {
    const w = weekStats([r('2026-10-19', 240), r('2026-10-20', 720), r('2026-10-21', 660), r(today, 420)], today);
    expect(w.days.map((d) => d.day)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(w.days.map((d) => d.minutes)).toEqual([4, 12, 11, 7, null, null, null]);
    expect(w.days.filter((d) => d.today).map((d) => d.index)).toEqual([3]);
    expect(w.totalMinutes).toBe(34);
  });

  it('counts the days that reached the line and the streak', () => {
    const w = weekStats([r('2026-10-19', 240), r('2026-10-20', 720), r('2026-10-21', 660), r(today, 420)], today);
    expect(w.hits).toBe(2);
    expect(w.streak).toBe(4);
    expect(DAILY_GOAL_MINUTES).toBe(10);
  });

  it('keeps the streak alive until the day is over: yesterday counts while today has no round', () => {
    expect(weekStats([r('2026-10-20', 300), r('2026-10-21', 300)], today).streak).toBe(2);
    expect(weekStats([r('2026-10-19', 300)], today).streak).toBe(0);
  });

  it('adds several rounds of one day, and a streak can reach into the week before', () => {
    const w = weekStats([r('2026-10-18', 120), r('2026-10-19', 120), r('2026-10-19', 120)], '2026-10-19');
    expect(w.days[0]?.minutes).toBe(4);
    expect(w.streak).toBe(2);
  });

  it('is empty for a new player', () => {
    const w = weekStats([], today);
    expect(w.hasAny).toBe(false);
    expect(w.totalMinutes).toBe(0);
    expect(w.streak).toBe(0);
  });
});

describe('recent bests', () => {
  it('lists the latest round of each game, newest first, with the game best', () => {
    const history = [r('2026-10-20', 60, 'star-catch', 41), r('2026-10-21', 60, 'knee-sprint', 212), r('2026-10-22', 60, 'squat-flap', 18), r('2026-10-22', 60, 'squat-flap', 9)];
    const best = (g: string): number | null => ({ 'squat-flap': 18, 'knee-sprint': 212, 'star-catch': 44 }[g] ?? null);
    expect(recentBests(history, best)).toEqual([
      { game: 'squat-flap', score: 18, day: '2026-10-22' },
      { game: 'knee-sprint', score: 212, day: '2026-10-21' },
      { game: 'star-catch', score: 44, day: '2026-10-20' },
    ]);
    expect(recentBests(history, best, 2)).toHaveLength(2);
  });
});

describe('the stored history', () => {
  it('keeps only the newest rounds', () => {
    let h: RoundRecord[] = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = addRound(h, r('2026-10-22', 60, 'g', i));
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h[0]?.score).toBe(5);
  });

  it('is read back safely from damaged storage', () => {
    expect(HISTORY_SCHEMA.parse('x')).toBeNull();
    const parsed = HISTORY_SCHEMA.parse([r('2026-10-22', 60), { day: 'not a day', game: 'a', score: 1, seconds: 1, at: 1 }, null, { day: '2026-10-22', game: 'a', score: 'x', seconds: 1, at: 1 }]);
    expect(parsed).toHaveLength(1);
  });
});
