// Kol F (11 Nov): a pain day keeps the minutes the person has. Knee pain on a 20-minute day used to leave a 5-minute plan,
// because every lower-body move went out and nothing took its place. Now the moves that stay get a set more, a low-impact
// circuit of moves that do not load the sore area at all goes in, and a few such stretches close the session.
import { describe, expect, it } from 'vitest';
import { AREAS, MOVE_META, type Area } from './moves-meta.ts';
import { getTodayPlan, SAFE_CIRCUIT, SAFE_STRETCH, type DailyCheckin } from './checkin.ts';
import { blockSeconds, generateProgram, type Equip, type Goal, type Level, type Weekday } from './generate.ts';

const wednesday = '2026-11-11';
const wd = 3 as Weekday;
const day = (minutes: number, areas: Area[]): DailyCheckin => ({ sleep: 'good', energy: 3, body: 'pain', painAreas: areas, minutes, priority: 'any' });
const seconds = (blocks: { kind: string }[]): number => blocks.reduce((a, b) => a + blockSeconds(b as never), 0);

describe('pain day: the time is made up with moves that spare the area', () => {
  it('knee pain, 20 minutes: the plan is at least 15 minutes and nothing loads the knee', () => {
    for (const goal of ['strength', 'general', 'conditioning'] as Goal[]) for (const level of ['beginner', 'intermediate', 'advanced'] as Level[]) for (const equipment of [[], ['chair', 'wall']] as Equip[][]) {
      const program = generateProgram({ goal, level, equipment, days: [wd], minutes: 30 });
      const t = getTodayPlan({ program, date: wednesday, checkin: day(20, ['knee']) });
      const label = `${goal}/${level}/${equipment.join('+') || 'none'}`;
      expect(t.minutes, label).toBeGreaterThanOrEqual(15);
      expect(t.minutes, label).toBeLessThanOrEqual(20);
      for (const b of t.blocks) for (const i of b.items) expect(MOVE_META[i.move].load.knee ?? 0, `${label} ${i.move}`).toBe(0);
      expect(t.adjustments, label).toEqual(expect.arrayContaining(['pain-skip', 'pain-fill']));
      expect(t.notes, label).toContain('see-professional');
    }
  });

  it('every area at 20 and 30 minutes: never under three quarters of the time, never a move that loads the area', () => {
    for (const area of AREAS) for (const minutes of [20, 30]) {
      const program = generateProgram({ goal: 'general', level: 'beginner', equipment: ['chair', 'wall'], days: [wd], minutes: 30 });
      const t = getTodayPlan({ program, date: wednesday, checkin: day(minutes, [area]) });
      if (!t.skipped.length) continue;
      expect(t.minutes, `${area} ${minutes}`).toBeGreaterThanOrEqual(Math.floor(minutes * 0.75));
      expect(t.minutes, `${area} ${minutes}`).toBeLessThanOrEqual(minutes);
      for (const b of t.blocks) for (const i of b.items) expect(MOVE_META[i.move].load[area] ?? 0, `${area} ${i.move}`).toBe(0);
    }
  });

  it('the circuit is low impact, marked safe, and run by the session (a conditioning block)', () => {
    const program = generateProgram({ goal: 'strength', level: 'beginner', equipment: [], days: [wd], minutes: 30 });
    const t = getTodayPlan({ program, date: wednesday, checkin: day(20, ['knee']) });
    const circuit = t.blocks.find((b) => b.safe);
    expect(circuit?.kind).toBe('conditioning');
    expect(circuit!.items.length).toBeGreaterThan(0);
    for (const i of circuit!.items) { expect(MOVE_META[i.move].impact).toBe(false); expect(SAFE_CIRCUIT).toContain(i.move); }
    const cool = t.blocks.find((b) => b.kind === 'cooldown');
    expect(cool?.items.some((i) => SAFE_STRETCH.includes(i.move))).toBe(true);
  });

  it('no floor: the circuit stands', () => {
    const program = generateProgram({ goal: 'general', level: 'beginner', equipment: ['wall'], days: [wd], minutes: 30, avoid: { noFloor: true } });
    const t = getTodayPlan({ program, date: wednesday, checkin: day(20, ['knee']) });
    for (const b of t.blocks) for (const i of b.items) expect(MOVE_META[i.move].floor, i.move).toBe(false);
  });

  it('a low day stays low: no extra sets on the main moves, still made up with the circuit', () => {
    const program = generateProgram({ goal: 'strength', level: 'beginner', equipment: [], days: [wd], minutes: 30 });
    const normal = getTodayPlan({ program, date: wednesday, checkin: { ...day(20, ['knee']), energy: 3 } });
    const low = getTodayPlan({ program, date: wednesday, checkin: { ...day(20, ['knee']), energy: 1 } });
    const sets = (x: typeof low): number => x.blocks.filter((b) => b.kind === 'main').flatMap((b) => b.items).reduce((a, i) => a + i.sets, 0);
    expect(low.intensity).toBe('low');
    expect(sets(low)).toBeLessThan(sets(normal));
    expect(low.adjustments).toContain('pain-fill');
    expect(low.minutes).toBeGreaterThanOrEqual(12);
  });

  it('a short slot is not filled (mini plan under 10 minutes), a pain-free day is untouched', () => {
    const program = generateProgram({ goal: 'strength', level: 'beginner', equipment: [], days: [wd], minutes: 30 });
    const mini = getTodayPlan({ program, date: wednesday, checkin: day(8, ['knee']) });
    expect(mini.adjustments).toContain('mini');
    expect(mini.adjustments).not.toContain('pain-fill');
    const fine = getTodayPlan({ program, date: wednesday, checkin: { ...day(20, []), body: 'fine' } });
    expect(fine.adjustments).not.toContain('pain-fill');
    expect(fine.blocks.some((b) => b.safe)).toBe(false);
  });

  it('the plan never asks for more than the minutes of the day', () => {
    for (const minutes of [10, 15, 20, 30, 45]) {
      const program = generateProgram({ goal: 'conditioning', level: 'intermediate', equipment: ['chair'], days: [wd], minutes: 30 });
      const t = getTodayPlan({ program, date: wednesday, checkin: day(minutes, ['knee', 'wrist']) });
      expect(seconds(t.blocks)).toBeLessThanOrEqual(minutes * 60 + 30);
    }
  });
});
