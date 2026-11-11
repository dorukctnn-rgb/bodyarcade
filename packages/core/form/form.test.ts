// Form coach: geometry, the repetition machine, the rules' logic and the cue choice, on geometric test bodies (testing/body.ts).
// These prove the logic; accuracy on real people is form.real.test.ts.
import { describe, expect, it } from 'vitest';
import { angleAt, bendFromFloor, fromVertical, viewOf, type P } from './geometry.ts';
import { RepMachine } from './reps.ts';
import { createFormCoach } from './coach.ts';
import { FORM_MOVES } from './moves/index.ts';
import { FAR_RIGHT, frame, frontPress, frontSquat, landmarks, reps, sidePushUp, sideBridge } from './testing/body.ts';
import { PointSmoother } from './smooth.ts';
import type { CoachState, FormMoveId } from './types.ts';
import type { PoseFrame } from '../types/index.ts';

const p = (x: number, y: number, v = 1): P => ({ x, y, v });

function run(move: FormMoveId, frames: PoseFrame[]): { last: CoachState; states: CoachState[] } {
  const c = createFormCoach(move);
  const states = frames.map((f) => c.push(f));
  return { last: states.at(-1) as CoachState, states };
}
const repList = (s: CoachState[]) => s.flatMap((x) => (x.repDone ? [x.repDone] : []));

describe('geometry', () => {
  it('measures joint angles, the bend from the floor side and angles against the vertical', () => {
    expect(angleAt(p(0, 0), p(0, 1), p(1, 1))).toBeCloseTo(90, 5);
    expect(angleAt(p(0, 0), p(1, 0), p(2, 0))).toBeCloseTo(180, 5);
    // y grows downwards: a hip below the shoulder-ankle line sags (< 180), above it is piked (> 180)
    expect(bendFromFloor(p(0, 0), p(1, 0.2), p(2, 0))).toBeLessThan(180);
    expect(bendFromFloor(p(0, 0), p(1, -0.2), p(2, 0))).toBeGreaterThan(180);
    expect(fromVertical(p(0, 0), p(0, 1))).toBeCloseTo(0, 5);
    expect(fromVertical(p(0, 0), p(1, 1))).toBeCloseTo(45, 5);
  });

  it('tells the camera angle from the shoulder width against the torso', () => {
    const sm = new PointSmoother();
    expect(viewOf(sm.push(landmarks(frontSquat(0)), 0, 16 / 9))).toBe('front');
    sm.reset();
    expect(viewOf(sm.push(landmarks(sidePushUp(0), { far: FAR_RIGHT }), 0, 16 / 9))).toBe('side');
    expect(viewOf([])).toBeNull();
  });
});

describe('repetition machine', () => {
  const o = { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 500 };
  const feed = (m: RepMachine, ps: (number | null)[], dt = 33) => ps.flatMap((v, i) => m.push(v, i * dt));
  const wave = (peak: number, n = 40) => Array.from({ length: n }, (_, i) => peak * Math.sin((Math.PI * i) / (n - 1)));

  it('counts a full repetition once, with its depth', () => {
    const ev = feed(new RepMachine(o), [0, 0, ...wave(1.2), 0, 0]);
    const ends = ev.filter((e) => e.kind === 'end');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.maxP).toBeGreaterThan(1.1);
  });

  it('counts a half repetition (it is judged by the depth rule) and ignores fidgeting', () => {
    const half = feed(new RepMachine(o), [0, ...wave(0.7), 0]).filter((e) => e.kind === 'end');
    expect(half).toHaveLength(1);
    expect(half[0]!.maxP).toBeLessThan(1);
    expect(feed(new RepMachine(o), [0, ...wave(0.35), 0, ...wave(0.4), 0]).filter((e) => e.kind === 'end')).toHaveLength(0);
  });

  it('needs the start position first, drops too-short repetitions and cancels when the person is gone', () => {
    // starts at the bottom: no repetition until the start position was seen
    expect(feed(new RepMachine(o), [1, 1, 0.8, 0.5, 0.1, 0]).filter((e) => e.kind === 'end')).toHaveLength(0);
    expect(feed(new RepMachine(o), [0, 0.6, 0.9, 0.1], 60).filter((e) => e.kind === 'end')).toHaveLength(0);
    const m = new RepMachine(o);
    const ev = [...feed(m, [0, 0, 0.6, 0.9]), ...[null, null].flatMap((v, i) => m.push(v, 2000 + i * 400)), m.push(0, 3000)].flat();
    expect(ev.some((e) => e.kind === 'cancel')).toBe(true);
    expect(ev.some((e) => e.kind === 'end')).toBe(false);
  });

  it('says so when the next repetition starts without going back to the start position', () => {
    const ev = feed(new RepMachine(o), [0, ...wave(1.1).slice(0, 25), 0.6, 0.5, 0.45, 0.5, 0.7, 0.9, 1.0]);
    expect(ev.some((e) => e.kind === 'notReturned')).toBe(true);
  });
});

describe('squat', () => {
  it('counts deep squats as clean and colours the thighs green at depth', () => {
    const { states } = run('squat', reps(3, (u) => frontSquat(u)));
    const r = repList(states);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.clean)).toBe(true);
    expect(states.some((s) => s.segments.thighL === 'ok' && s.segments.thighR === 'ok')).toBe(true);
    expect(states.every((s) => !Object.values(s.segments).includes('bad'))).toBe(true);
  });

  it('flags half squats at the end of the repetition (depth) with the thighs red and the cue', () => {
    const { states } = run('squat', reps(2, (u) => frontSquat(u * 0.6)));
    const r = repList(states);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.errors.includes('squat.depth'))).toBe(true);
    expect(states.some((s) => s.segments.thighL === 'bad' && s.cue === 'squat.deeper')).toBe(true);
  });

  it('flags knees caving in, on the shin of each leg, from the front only', () => {
    const { states } = run('squat', reps(2, (u) => frontSquat(u, { kneesIn: 0.045 })));
    const r = repList(states);
    expect(r.every((x) => x.errors.includes('squat.kneesIn'))).toBe(true);
    expect(states.some((s) => s.segments.shinL === 'bad' && s.segments.shinR === 'bad' && s.cue === 'squat.kneesOut')).toBe(true);
  });

  it('flags the weight shifting to one side as a tip', () => {
    const r = repList(run('squat', reps(2, (u) => frontSquat(u, { shift: 0.06 }))).states);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.tips.includes('squat.shift'))).toBe(true);
  });

  it('never shows red for a part it cannot see (visibility below the rule gate)', () => {
    const c = createFormCoach('squat');
    const frames = reps(2, (u) => frontSquat(u, { kneesIn: 0.05 }));
    const states = frames.map((f) => c.push({ ...f, landmarks: f.landmarks!.map((l, i) => (i >= 25 && i <= 28 ? { ...l, visibility: 0.55 } : l)) }));
    expect(states.every((s) => s.segments.shinL !== 'bad' && s.segments.shinR !== 'bad')).toBe(true);
    expect(states.some((s) => s.segments.shinL === 'unknown')).toBe(true);
  });
});

describe('push-up', () => {
  const pu = (o: Parameters<typeof sidePushUp>[1] = {}, depth = 1) => reps(3, (u) => sidePushUp(u * depth, o), { far: FAR_RIGHT });

  it('counts clean push-ups from the side', () => {
    const r = repList(run('pushUp', pu()).states);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.clean)).toBe(true);
  });

  it('flags sagging hips and piked hips with their own cues, and shallow push-ups by depth', () => {
    const sag = run('pushUp', pu({ sag: 0.06 }));
    expect(repList(sag.states).every((x) => x.errors.includes('pushUp.line'))).toBe(true);
    expect(sag.states.some((s) => s.cue === 'pushUp.hipsUp' && s.segments.torso === 'bad')).toBe(true);
    const pike = run('pushUp', pu({ pike: 0.07 }));
    expect(pike.states.some((s) => s.cue === 'pushUp.hipsDown')).toBe(true);
    const shallow = repList(run('pushUp', pu({}, 0.2)).states);
    expect(shallow.every((x) => x.errors.includes('pushUp.depth'))).toBe(true);
  });

  it('does not count arm bends while standing (no plank), and not from the front', () => {
    expect(repList(run('pushUp', reps(3, (u) => frontPress(u))).states)).toHaveLength(0);
    const front = run('pushUp', reps(2, (u) => frontSquat(u)));
    expect(front.last.guide.checks.find((c) => c.id === 'view')?.ok).toBe(false);
  });
});

describe('glute bridge (geometry only: no real video yet)', () => {
  const br = (lift: number, o: Parameters<typeof sideBridge>[1] = {}) => reps(3, (u) => sideBridge(u * lift, o), { far: FAR_RIGHT, repMs: 2400 });
  it('counts full bridges, flags a low bridge, an over-arch and the feet too far', () => {
    expect(repList(run('gluteBridge', br(1)).states).every((x) => x.clean)).toBe(true);
    expect(repList(run('gluteBridge', br(1)).states)).toHaveLength(3);
    expect(repList(run('gluteBridge', br(0.55)).states).every((x) => x.errors.includes('bridge.height'))).toBe(true);
    expect(repList(run('gluteBridge', br(1.6)).states).every((x) => x.tips.includes('bridge.arch'))).toBe(true);
    expect(repList(run('gluteBridge', br(1, { feet: 0.25 })).states).some((x) => x.tips.includes('bridge.feet'))).toBe(true);
  });
});

describe('dumbbell shoulder press', () => {
  it('counts full presses, flags a lagging arm on that arm and presses that stop short', () => {
    expect(repList(run('dbShoulderPress', reps(3, (u) => frontPress(u))).states).every((x) => x.clean)).toBe(true);
    const lag = run('dbShoulderPress', reps(3, (u) => frontPress(u, u * 0.45)));
    expect(repList(lag.states).every((x) => x.errors.includes('press.together'))).toBe(true);
    expect(lag.states.some((s) => s.segments.forearmR === 'bad' && s.segments.forearmL !== 'bad')).toBe(true);
    expect(repList(run('dbShoulderPress', reps(3, (u) => frontPress(u * 0.7))).states).every((x) => x.errors.includes('press.top'))).toBe(true);
  });
});

describe('coach', () => {
  it('a person standing still gets no repetition, no red and no cue, for every move', () => {
    for (const id of Object.keys(FORM_MOVES) as FormMoveId[]) {
      const frames = Array.from({ length: 300 }, (_, i) => frame((i * 1000) / 30, landmarks(frontSquat(0)), i));
      const { states } = run(id, frames);
      expect(repList(states), id).toHaveLength(0);
      expect(states.every((s) => !Object.values(s.segments).includes('bad')), id).toBe(true);
    }
  });

  it('keeps a cue on screen for at least 1.5 s, and an empty frame clears nothing at once', () => {
    const { states } = run('squat', reps(2, (u) => frontSquat(u, { kneesIn: 0.05 })));
    const shown = states.map((s) => s.cue);
    const first = shown.indexOf('squat.kneesOut');
    expect(first).toBeGreaterThan(0);
    expect(shown.slice(first, first + 44).every((c) => c === 'squat.kneesOut')).toBe(true);
  });

  it('summarises the set: repetitions, clean ones and the most frequent error', () => {
    const c = createFormCoach('squat');
    for (const f of [...reps(2, (u) => frontSquat(u)), ...reps(3, (u) => frontSquat(u, { kneesIn: 0.05 }), { leadMs: 0 }).map((f) => ({ ...f, t: f.t + 7000 }))]) c.push(f);
    const s = c.summary();
    expect(s.reps).toBe(5);
    expect(s.clean).toBe(2);
    expect(s.top).toEqual({ id: 'squat.kneesIn', count: 3 });
    expect(s.measured).toContain('squat.kneesIn');
  });
});
