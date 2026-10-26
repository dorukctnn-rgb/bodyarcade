// M9 side bend and the gate judge (Limbo Bend), with the trunk drawn by the rig (testing/rig.ts): `bend` tilts the trunk
// about the hips, `dx` slides the whole body, `fore` folds the torso forward. Synthetic numbers show that the code does
// what the thresholds say, not that they suit real bodies.
import { describe, expect, it } from 'vitest';
import type { BodyProfile } from '../types/index.ts';
import { canExplain } from './kit.ts';
import { baseAngle, BendTester, createSideBendDetector, SIDE_BEND_DEFAULTS, type BendGate, type BendJudgement } from './sideBend.ts';
import { chAt, chMax, chMin, drive, pick, replayMotion } from './testing/harness.ts';
import { keyframes, plus, profileOf, still, type FigureSpec, type Motion } from './testing/rig.ts';

/** Bend to `deg` between t0 and t1, hold until t2, come back by t3. */
const bendTo = (deg: number, t0 = 1000, t1 = 1400, t2 = 2600, t3 = 3000, extra: FigureSpec = {}): Motion =>
  keyframes([[t0, {}], [t1, { bend: deg, ...extra }], [t2, { bend: deg, ...extra }], [t3, {}]]);

const UP = { armL: { a: 170, f: 170 }, armR: { a: 170, f: 170 } };

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('side bend must explain');
  return d.detector.explain(ms);
};

function judge(motion: Motion, gates: (t: number) => BendGate[], durationMs: number, o: { tester?: BendTester; opts?: Record<string, number> } = {}) {
  const d = drive(createSideBendDetector, motion, { durationMs, ...(o.opts ? { opts: o.opts } : {}) });
  const tester = o.tester ?? new BendTester();
  const passes: BendJudgement[] = [];
  for (const s of d.samples) passes.push(...tester.update(s.ch, gates(s.t)));
  return { d, tester, passes };
}

describe('the bend angle', () => {
  const d = drive(createSideBendDetector, bendTo(20), { durationMs: 3500 });

  it('reads the trunk angle in degrees, positive toward the player right, and the body numbers around it', () => {
    expect(chAt(d, 'bend', 500)).toBeCloseTo(0, 1);
    expect(chAt(d, 'bend', 2000)).toBeCloseTo(20, 0);
    expect(chAt(d, 'torso', 2000)).toBeCloseTo(1, 1);
    expect(chAt(d, 'hipShift', 2000)).toBeCloseTo(0, 1);
    expect(chMax(d, 'rate', 1100, 1300)).toBeGreaterThan(30);
    expect(chAt(d, 'bend.t', 2000)).toBeGreaterThanOrEqual(2000);
    expect(d.detector.value()).toBeCloseTo(0, 0);
  });

  it('the left bend is negative', () => {
    const l = drive(createSideBendDetector, bendTo(-25), { durationMs: 3500 });
    expect(chMin(l, 'bend')).toBeCloseTo(-25, 0);
    expect(chMax(l, 'bend')).toBeLessThan(1);
  });

  it('the base angle of the calibrated stance is taken off', () => {
    const p: BodyProfile = { ...profileOf() };
    p.rest = { ...p.rest, shoulderX: p.rest.hipX + 0.1 * p.T };
    expect(baseAngle(profileOf())).toBeCloseTo(0, 6);
    expect(baseAngle(p)).toBeCloseTo((Math.atan2(0.1, 1) * 180) / Math.PI, 3);
    const tilted = drive(createSideBendDetector, still(), { durationMs: 500, profile: p });
    expect(chAt(tilted, 'bend', 400)).toBeCloseTo(-baseAngle(p), 1);
  });

  it('a held bend is one hold with its side, angle and time; it ends when the body comes back', () => {
    const starts = pick(d.events, { kind: 'holdStart' }), ends = pick(d.events, { kind: 'holdEnd' });
    expect(starts).toHaveLength(1);
    expect(starts[0]!.side).toBe('R');
    expect(starts[0]!.value!).toBeGreaterThan(10);
    expect(starts[0]!.t).toBeGreaterThan(1500);
    expect(starts[0]!.t).toBeLessThan(1900);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.side).toBe('R');
    expect(ends[0]!.value!).toBeGreaterThan(600);
    expect(chMax(d, 'held', 1900, 2500)).toBeGreaterThan(300);
    expect(chAt(d, 'held', 3300)).toBe(0);
  });

  it('a bend that keeps moving is no hold until it settles', () => {
    const slow = keyframes([[1000, {}], [3000, { bend: 30 }], [3600, { bend: 30 }], [4000, {}]]);
    const m = drive(createSideBendDetector, slow, { durationMs: 4500 });
    const [start] = pick(m.events, { kind: 'holdStart' });
    expect(pick(m.events, { kind: 'holdStart' })).toHaveLength(1);
    expect(start!.t).toBeGreaterThan(2800);                       // not while it was still rolling over
  });

  it('a bend under 10 degrees is no hold, and holdMs 0 turns holds off', () => {
    const small = drive(createSideBendDetector, bendTo(8), { durationMs: 3500 });
    expect(pick(small.events, { kind: 'holdStart' })).toHaveLength(0);
    const off = drive(createSideBendDetector, bendTo(20), { durationMs: 3500, opts: { holdMs: 0 } });
    expect(pick(off.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(chAt(off, 'bend', 2000)).toBeCloseTo(20, 0);
  });

  it('a bend to one side then to the other is two holds', () => {
    const m = keyframes([[1000, {}], [1400, { bend: 20 }], [2400, { bend: 20 }], [2900, { bend: -20 }], [3900, { bend: -20 }], [4300, {}]]);
    const two = drive(createSideBendDetector, m, { durationMs: 4800 });
    expect(pick(two.events, { kind: 'holdStart' }).map((e) => e.side)).toEqual(['R', 'L']);
    expect(pick(two.events, { kind: 'holdEnd' }).map((e) => e.side)).toEqual(['R', 'L']);
  });
});

describe('form notes', () => {
  it('folding forward shortens the torso and is "bending forward"', () => {
    const d = drive(createSideBendDetector, bendTo(20, 1000, 1400, 2600, 3000, { fore: 0.3 }), { durationMs: 3500 });
    expect(chMin(d, 'torso')).toBeLessThan(0.8);
    const miss = why(d)!;
    expect(miss.code).toBe('bending_forward');
    expect(miss.need).toBe(SIDE_BEND_DEFAULTS.forwardMin);
  });

  it('sliding the hips instead of bending is "hips shifted"', () => {
    const d = drive(createSideBendDetector, bendTo(20, 1000, 1400, 2600, 3000, { dx: 0.5 }), { durationMs: 3500 });
    expect(chMax(d, 'hipShift')).toBeGreaterThan(0.5);
    const miss = why(d)!;
    expect(miss.code).toBe('hips_shifted');
    expect(miss.need).toBe(SIDE_BEND_DEFAULTS.hipMax);
  });

  it('a clean bend, and standing still, have nothing to explain', () => {
    expect(why(drive(createSideBendDetector, bendTo(20), { durationMs: 2400 }))).toBeNull();
    expect(why(drive(createSideBendDetector, still(), { durationMs: 2000 }))).toBeNull();
  });
});

describe('judging a gate', () => {
  const gate = (o: Partial<BendGate> = {}): BendGate => ({ id: 1, target: 20, ...o });

  it('leaning to the gate angle and staying 0.3 s passes it, with the precision of the lean', () => {
    const { passes } = judge(bendTo(20), () => [gate()], 3500);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.id).toBe(1);
    expect(passes[0]!.t).toBeGreaterThan(1300);
    expect(passes[0]!.t).toBeLessThan(1900);
    expect(passes[0]!.precision).toBeGreaterThan(0.6);
    const exact = judge(bendTo(20, 500, 700, 2600, 3000), () => [gate()], 3500);
    expect(exact.passes[0]!.precision).toBeGreaterThan(0.85);
    expect(Math.abs(exact.passes[0]!.error)).toBeLessThan(2);
  });

  it('a gate straight ahead (angle 0) is passed by standing straight', () => {
    const { passes } = judge(still(), () => [gate({ target: 0 })], 1500);
    expect(passes).toHaveLength(1);
  });

  it('the easy tolerance (10) takes a lean that the normal one (7) refuses; the miss says it leaned too far', () => {
    const m = bendTo(29, 500, 700, 2600, 3000);
    const easy = judge(m, () => [gate({ tol: 10 })], 3200);
    expect(easy.passes).toHaveLength(1);
    const hard = judge(m, () => [gate()], 3200);
    expect(hard.passes).toHaveLength(0);
    const miss = hard.tester.explain(gate())!;
    expect(miss.code).not.toBe('person_out');
    expect(['held_too_short', 'bend_less']).toContain(miss.code);
  });

  it('a lean that is not enough is "bend more", with the angle reached', () => {
    const { passes, tester } = judge(bendTo(10), () => [gate({ target: 25 })], 3500);
    expect(passes).toHaveLength(0);
    const miss = tester.explain(gate({ target: 25 }))!;
    expect(miss.code).toBe('bend_more');
    expect(miss.got!).toBeCloseTo(10, 0);
    expect(miss.need).toBe(18);
  });

  it('a lean to the wrong side is "wrong side"', () => {
    const { passes, tester } = judge(bendTo(-20), () => [gate()], 3500);
    expect(passes).toHaveLength(0);
    expect(tester.explain(gate())!.code).toBe('wrong_side');
  });

  it('a left gate is passed by a left lean', () => {
    const { passes } = judge(bendTo(-20), () => [gate({ target: -20 })], 3500);
    expect(passes).toHaveLength(1);
  });

  it('a lean held for less than 0.3 s is "held too short", with the time', () => {
    const quick = keyframes([[1000, {}], [1150, { bend: 20 }], [1250, { bend: 20 }], [1400, {}]]);
    const { passes, tester } = judge(quick, () => [gate()], 2200);
    expect(passes).toHaveLength(0);
    const miss = tester.explain(gate())!;
    expect(miss.code).toBe('held_too_short');
    expect(miss.need).toBe(300);
    expect(miss.got!).toBeLessThan(300);
  });

  it('sliding the hips to the angle does not pass: "hips shifted"', () => {
    const { passes, tester } = judge(bendTo(20, 1000, 1400, 2600, 3000, { dx: 0.5 }), () => [gate()], 3500);
    expect(passes).toHaveLength(0);
    const miss = tester.explain(gate())!;
    expect(miss.code).toBe('hips_shifted');
    expect(miss.got!).toBeGreaterThan(0.35);
  });

  it('a tall gate needs both hands above the nose by 0.3 T', () => {
    const tall = gate({ tall: true });
    const down = judge(bendTo(20), () => [tall], 3500);
    expect(down.passes).toHaveLength(0);
    expect(down.tester.explain(tall)!.code).toBe('arms_not_up');
    const up = judge(plus(bendTo(20), () => UP), () => [tall], 3500);
    expect(up.passes).toHaveLength(1);
  });

  it('folding forward on the way to the gate is "bending forward"', () => {
    const { passes, tester } = judge(keyframes([[1000, {}], [1400, { fore: 0.35 }], [2600, { fore: 0.35 }], [3000, {}]]), () => [gate()], 3500);
    expect(passes).toHaveLength(0);
    expect(tester.explain(gate())!.code).toBe('bending_forward');
  });

  it('double gates: right then left, each judged in its own time', () => {
    const m = keyframes([[500, {}], [900, { bend: 20 }], [1900, { bend: 20 }], [2300, { bend: -20 }], [3300, { bend: -20 }], [3700, {}]]);
    const gates = (t: number): BendGate[] => (t < 2000 ? [{ id: 1, target: 20 }] : [{ id: 2, target: -20 }]);
    const { passes } = judge(m, gates, 4000);
    expect(passes.map((p) => p.id)).toEqual([1, 2]);
  });

  it('the same pose frame seen twice changes nothing; forget and reset clear what is known', () => {
    const d = drive(createSideBendDetector, bendTo(20), { durationMs: 3500 });
    const tester = new BendTester();
    const passes: BendJudgement[] = [];
    for (const s of d.samples) for (let k = 0; k < 3; k++) passes.push(...tester.update(s.ch, [gate()]));
    expect(passes).toHaveLength(1);
    expect(tester.explain(gate())).toBeNull();                 // passed
    tester.forget(1);
    expect(tester.update({}, [gate()])).toEqual([]);
    tester.reset();
    expect(tester.explain(gate())).toBeNull();
  });
});

describe('losing the person', () => {
  it('reset forgets the angle and the hold', () => {
    const d = drive(createSideBendDetector, bendTo(20), { durationMs: 2300 });
    expect(d.detector.value()).toBeCloseTo(20, 0);
    d.detector.reset();
    expect(d.detector.channels!()).toEqual({});
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('a 20 degree lean at %i Hz passes a 20 degree gate', (hz) => {
    const r = replayMotion(bendTo(20, 500, 900, 2500, 3000), { detectors: [{ id: 'sideBend' }], durationMs: 4000, hz });
    expect(r.calibratedAt).not.toBeNull();
    const tester = new BendTester();
    const passes: BendJudgement[] = [];
    for (const s of r.samples) passes.push(...tester.update(s.channels, [{ id: 1, target: 20 }]));
    expect(passes).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'holdStart').map((e) => e.side)).toEqual(['R']);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'sideBend' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
