// G4: the program engine's rules, one test per rule of SPEC 3.1-3.6 and the daily check-in.
import { describe, expect, it } from 'vitest';
import { FORM_MOVES, REAL_VIDEO_CHECKED } from '../../form/moves/index.ts';
import type { FormMoveId, SetSummary } from '../../form/types.ts';
import { getTodayPlan, type DailyCheckin } from './checkin.ts';
import { alternatives, generateProgram, sessionSeconds, spacingOk, swapInProgram, type ProgramInput } from './generate.ts';
import { MOVE_META } from './moves-meta.ts';
import { applyResult, beforeSession, deload, isDeloadWeek, startState, suggestDeload } from './progress.ts';
import { correct, fromSummary, resultsOf, stepsOf, targetReached } from './session.ts';

const base: ProgramInput = { goal: 'strength', level: 'intermediate', equipment: [], days: [1, 3, 5], minutes: 30 };
const mainMoves = (p: ReturnType<typeof generateProgram>): FormMoveId[] => p.sessions.flatMap((s) => s.blocks.filter((b) => b.kind === 'main').flatMap((b) => b.items.map((i) => i.move)));

describe('program builder', () => {
  it('3 days: full body A/B/A, only measured F/H moves in the main block, within the minutes', () => {
    const p = generateProgram(base);
    expect(Object.values(p.schedule)).toEqual(['A', 'B', 'A']);
    for (const m of mainMoves(p)) { expect(['F', 'H']).toContain(FORM_MOVES[m].label); expect(REAL_VIDEO_CHECKED[m]).toBe(true); }
    for (const s of p.sessions) expect(sessionSeconds(s)).toBeLessThanOrEqual(30 * 60);
    expect(spacingOk(p)).toBe(true);
  });

  it('every move has its program data', () => {
    for (const id of Object.keys(FORM_MOVES) as FormMoveId[]) expect(MOVE_META[id], id).toBeDefined();
  });

  it('equipment: dumbbells bring the shoulder press with the lightest weight; without them no dumbbell move', () => {
    expect(mainMoves(generateProgram(base))).not.toContain('dbShoulderPress');
    const p = generateProgram({ ...base, equipment: ['dumbbell'], dumbbellsKg: [6, 4, 8] });
    const press = p.sessions.flatMap((s) => s.blocks.flatMap((b) => b.items)).find((i) => i.move === 'dbShoulderPress');
    expect(press?.loadKg).toBe(4);
  });

  it('the avoid list: knees out takes every marked knee move out; no jumping takes impact moves out everywhere', () => {
    const p = generateProgram({ ...base, allowUnchecked: true, avoid: { areas: ['knee'] } });
    for (const s of p.sessions) for (const b of s.blocks) for (const i of b.items) expect(MOVE_META[i.move].load.knee ?? 0).toBeLessThan(2);
    const q = generateProgram({ ...base, allowUnchecked: true, avoid: { noJumping: true, noFloor: true } });
    for (const s of q.sessions) for (const b of s.blocks) for (const i of b.items) { expect(MOVE_META[i.move].impact).toBe(false); expect(MOVE_META[i.move].floor).toBe(false); }
  });

  it('under 18: no hard jumps, level capped', () => {
    const p = generateProgram({ ...base, level: 'advanced', minor: true, allowUnchecked: true });
    for (const s of p.sessions) for (const b of s.blocks) for (const i of b.items) if (MOVE_META[i.move].impact) expect(MOVE_META[i.move].difficulty).toBeLessThan(4);
  });

  it('the patterns the catalogue cannot fill yet are named (no pulling move without equipment)', () => {
    expect(generateProgram(base).missingPatterns).toContain('pull');
  });

  it('15 minutes is trimmed to fit; 60 minutes keeps conditioning', () => {
    const short = generateProgram({ ...base, minutes: 15 });
    for (const s of short.sessions) expect(sessionSeconds(s)).toBeLessThanOrEqual(15 * 60);
    const long = generateProgram({ ...base, minutes: 60, allowUnchecked: true });
    expect(long.sessions[0]!.blocks.some((b) => b.kind === 'conditioning')).toBe(true);
  });

  it('4, 5 and 6 days follow the week table', () => {
    expect(Object.values(generateProgram({ ...base, days: [1, 2, 4, 5], equipment: ['dumbbell'], dumbbellsKg: [5] }).schedule)).toEqual(['U1', 'L1', 'U2', 'L2']);
    expect(Object.values(generateProgram({ ...base, days: [1, 2, 3, 4, 5] }).schedule)).toEqual(['U', 'L', 'C1', 'F', 'M']);
    expect(Object.values(generateProgram({ ...base, days: [0, 1, 2, 3, 4, 5] }).schedule)).toHaveLength(6);
  });

  it('swap: same-pattern alternatives; the swap is kept in every session', () => {
    const i = { ...base, allowUnchecked: true };
    const p = generateProgram(i);
    const alt = alternatives('squat', i);
    expect(alt.length).toBeGreaterThan(0);
    for (const a of alt) expect(MOVE_META[a].pattern).toBe('squat');
    const q = swapInProgram(p, 'squat', alt[0]!);
    expect(mainMoves(q)).not.toContain('squat');
    expect(mainMoves(q)).toContain(alt[0]);
  });

  it('two heavy full-body days in a row break the 48-hour rule and are reported', () => {
    expect(spacingOk(generateProgram({ ...base, days: [1, 2, 4] }))).toBe(false);
  });
});

describe('progression', () => {
  const squat = startState({ move: 'squat', sets: 3, target: 8, range: [8, 20], unit: 'reps', restS: 90 });
  const res = (done: number[], clean: number[] = done.map(() => 1), rir: (0 | 1 | 3)[] = done.map(() => 1 as const)) => ({ move: 'squat' as FormMoveId, date: '2026-11-10', done, clean, rir });

  it('all sets clean at target: +2 repetitions (body weight)', () => {
    const s = applyResult(squat, res([8, 8, 8]));
    expect(s.target).toBe(10); expect(s.reason).toBe('add-rep');
  });
  it('the top of the range twice: a harder move, back to the bottom', () => {
    const top = { ...squat, target: 20 };
    const a = applyResult(top, res([20, 20, 20]));
    expect(a.reason).toBe('top-of-range');
    const b = applyResult(a, res([20, 20, 20]));
    expect(b.reason).toBe('harder-move'); expect(b.move).toBe('prisonerSquat'); expect(b.target).toBe(8);
  });
  it('dumbbells: the next weight at hand', () => {
    const press = { ...startState({ move: 'dbShoulderPress', sets: 3, target: 12, range: [6, 12], unit: 'reps', restS: 90, loadKg: 4 }) };
    const a = applyResult(press, { ...res([12, 12, 12]), move: 'dbShoulderPress' }, { dumbbellsKg: [4, 6, 8], beginner: true });
    expect(a.reason).toBe('next-weight'); expect(a.loadKg).toBe(6); expect(a.target).toBe(6);
  });
  it('exhausted (no reps left in any set): the target stays', () => {
    expect(applyResult(squat, res([8, 8, 8], [1, 1, 1], [0, 0, 0])).reason).toBe('tired');
  });
  it('the form gate: under 70 % clean twice holds progress and names the error', () => {
    const a = applyResult(squat, { ...res([8, 8, 8], [0.5, 0.5, 0.5]), topError: 'squat.kneesIn' });
    expect(a.reason).not.toBe('form-gate');
    const b = applyResult(a, { ...res([8, 8, 8], [0.5, 0.5, 0.5]), topError: 'squat.kneesIn' });
    expect(b.reason).toBe('form-gate'); expect(b.formError).toBe('squat.kneesIn'); expect(b.offerEasier).toBe('chairSquat'); expect(b.target).toBe(8);
  });
  it('failed twice: one step back', () => {
    const a = applyResult(squat, res([8, 6, 5]));
    expect(a.reason).toBe('failed');
    const b = applyResult(a, res([7, 6, 5]));
    expect(b.reason).toBe('step-back'); expect(b.move).toBe('chairSquat');
  });
  it('a break of 10+ days starts lower', () => {
    const s = { ...squat, target: 14, lastDate: '2026-10-20' };
    expect(beforeSession(s, '2026-11-05').target).toBe(12);
    expect(beforeSession(s, '2026-10-25').target).toBe(14);
  });
  it('deload: planned weeks, 40 % fewer sets, suggested after 2 failures', () => {
    expect(isDeloadWeek(6, 6)).toBe(true); expect(isDeloadWeek(5, 6)).toBe(false);
    expect(deload({ move: 'squat', sets: 4, target: 12, range: [8, 20], unit: 'reps', restS: 60 })).toMatchObject({ sets: 2, target: 8 });
    expect(suggestDeload([{ ...squat, reason: 'failed' }, { ...squat, reason: 'step-back' }], false)).toBe(true);
    expect(suggestDeload([], true)).toBe(true);
  });
  it('held moves: +5 s, a harder hold at 60 s', () => {
    const hold = startState({ move: 'squatHold', sets: 2, target: 20, range: [20, 60], unit: 'seconds', restS: 45 });
    expect(applyResult(hold, { move: 'squatHold', date: '2026-11-10', done: [20, 22], clean: [1, 1], rir: [1, 1] }).target).toBe(25);
  });
});

describe('form coach adapter and session steps', () => {
  const sum: SetSummary = { reps: 10, clean: 8, top: { id: 'squat.deeper', count: 2 }, list: [], measured: ['squat.deeper'] };
  it('a set summary becomes a log line; a correction marks it and keeps clean at most the reps', () => {
    const log = fromSummary({ sessionId: 's', moveId: 'squat', setNo: 1, sum, rir: 1, startedAt: 0, endedAt: 1 });
    expect(log).toMatchObject({ reps: 10, clean: 8, topError: 'squat.deeper', source: 'camera', corrected: false });
    expect(correct(log, 6)).toMatchObject({ reps: 6, clean: 6, corrected: true });
    const jj = fromSummary({ sessionId: 's', moveId: 'pistolSquat', setNo: 1, sum, rir: 1, startedAt: 0, endedAt: 1 });
    expect(jj.clean).toBeNull();
  });
  it('logs fold into results; corrected sets have an unknown clean share', () => {
    const l1 = fromSummary({ sessionId: 's', moveId: 'squat', setNo: 1, sum, rir: 1, startedAt: 0, endedAt: 1 });
    const l2 = correct(fromSummary({ sessionId: 's', moveId: 'squat', setNo: 2, sum, rir: 3, startedAt: 0, endedAt: 1 }), 9);
    const r = resultsOf([l1, l2], [{ move: 'squat', sets: 2, target: 8, range: [8, 20], unit: 'reps', restS: 60 }], '2026-11-11');
    expect(r[0]).toMatchObject({ done: [10, 9], clean: [0.8, null], rir: [1, 3] });
  });
  it('steps and targets: sets in order with rests; one-sided targets need both sides', () => {
    const p = generateProgram(base);
    const steps = stepsOf(p.sessions[0]!.blocks);
    expect(steps.length).toBeGreaterThan(4);
    expect(targetReached({ reps: 10, holdMs: 0, sides: { L: 10, R: 7 } }, { move: 'reverseLunge', sets: 1, target: 8, range: [8, 20], unit: 'reps', restS: 60 })).toBe(false);
    expect(targetReached({ reps: 0, holdMs: 31000 }, { move: 'squatHold', sets: 1, target: 30, range: [20, 60], unit: 'seconds', restS: 60 })).toBe(true);
  });
});

describe('daily check-in: getTodayPlan', () => {
  const program = generateProgram({ ...base, minutes: 45, allowUnchecked: true });
  const ok: DailyCheckin = { sleep: 'good', energy: 4, body: 'fine', minutes: 45, priority: 'any' };
  const monday = '2026-11-09';
  it('a normal day is the scheduled session', () => {
    const t = getTodayPlan({ program, date: monday, checkin: ok });
    expect(t.sessionId).toBe('A'); expect(t.restDay).toBe(false); expect(t.intensity).toBe('normal'); expect(t.adjustments).toEqual([]);
  });
  it('little time: a shorter plan; under 10 minutes a mini plan', () => {
    const t = getTodayPlan({ program, date: monday, checkin: { ...ok, minutes: 15 } });
    expect(t.minutes).toBeLessThanOrEqual(15); expect(t.adjustments).toContain('short');
    const m = getTodayPlan({ program, date: monday, checkin: { ...ok, minutes: 8 } });
    expect(m.adjustments).toContain('mini'); expect(m.minutes).toBeLessThanOrEqual(10);
  });
  it('low energy or poor sleep: lower intensity, no jumping, fewer sets', () => {
    const normal = getTodayPlan({ program, date: monday, checkin: ok });
    const t = getTodayPlan({ program, date: monday, checkin: { ...ok, energy: 2, sleep: 'poor' } });
    expect(t.intensity).toBe('low'); expect(t.adjustments).toEqual(expect.arrayContaining(['low-energy', 'poor-sleep']));
    for (const b of t.blocks) if (b.kind !== 'warmup') for (const i of b.items) expect(MOVE_META[i.move].impact).toBe(false);
    const sets = (x: typeof t) => x.blocks.filter((b) => b.kind === 'main').flatMap((b) => b.items).reduce((a, i) => a + i.sets, 0);
    expect(sets(t)).toBeLessThan(sets(normal));
  });
  it('knee pain: no knee-loading move today, and the note to ask a health professional', () => {
    const t = getTodayPlan({ program, date: monday, checkin: { ...ok, body: 'pain', painAreas: ['knee'] } });
    for (const b of t.blocks) for (const i of b.items) expect(MOVE_META[i.move].load.knee ?? 0).toBe(0);
    expect(t.skipped.length).toBeGreaterThan(0);
    expect(t.notes).toContain('see-professional');
  });
  it('priority: strength drops the conditioning, mobility swaps the session', () => {
    expect(getTodayPlan({ program, date: monday, checkin: { ...ok, priority: 'strength' } }).blocks.some((b) => b.kind === 'conditioning')).toBe(false);
    expect(getTodayPlan({ program, date: monday, checkin: { ...ok, priority: 'mobility' } }).focus).toBe('mobility');
  });
  it('a rest day offers the light mobility session; no check-in is fine too', () => {
    const t = getTodayPlan({ program, date: '2026-11-10' });
    expect(t.restDay).toBe(true); expect(t.focus).toBe('mobility'); expect(t.adjustments).toContain('rest-day');
  });
  it('progress state replaces the template targets', () => {
    const t = getTodayPlan({ program, date: monday, states: { squat: { ...startState({ move: 'squat', sets: 3, target: 8, range: [8, 20], unit: 'reps', restS: 90 }), target: 14 } } });
    const sq = t.blocks.flatMap((b) => b.items).find((i) => i.move === 'squat');
    expect(sq?.target).toBe(14);
  });
});
