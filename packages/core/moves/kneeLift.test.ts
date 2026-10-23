// M4 knee lift, driven by the articulated rig (testing/rig.ts). Synthetic numbers show that the code does what the
// thresholds say, not that the thresholds suit real bodies.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createKneeLiftDetector, KNEE_LIFT_DEFAULTS } from './kneeLift.ts';
import { chAt, chMax, chMin, drive, pick, replayMotion } from './testing/harness.ts';
import { legs, marching, plus, pulse } from './testing/motions.ts';
import { absentBetween, keyframes, still, type Motion } from './testing/rig.ts';

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('knee lift must explain');
  return d.detector.explain(ms);
};

const sides = (d: ReturnType<typeof drive>): string[] => pick(d.events, { kind: 'rep' }).map((e) => e.side as string);

/** One leg only, lifting at each of `starts`. */
const oneLeg = (side: 'L' | 'R', starts: number[], peak = 0.9): Motion => {
  const ps = starts.map((t0) => pulse(t0, peak, 160, 40, 160));
  const f = (t: number): number => ps.reduce((m, p) => Math.max(m, p(t)), 0);
  return side === 'L' ? legs(f, () => 0) : legs(() => 0, f);
};

describe('marching in place', () => {
  const d = drive(createKneeLiftDetector, marching(1000, 3, 500), { durationMs: 4500 });
  const reps = pick(d.events, { kind: 'rep' });

  it('every lift is a step, the legs in turn, each carrying its peak k', () => {
    expect(reps).toHaveLength(6);
    expect(sides(d)).toEqual(['L', 'R', 'L', 'R', 'L', 'R']);
    for (const e of reps) { expect(e.id).toBe('kneeLift'); expect(e.q!.range!).toBeCloseTo(0.9, 1); }
  });

  it('a step lands on the top of the lift and about 500 ms after the previous one', () => {
    const t = reps.map((e) => e.t);
    expect(t[0]!).toBeGreaterThan(1160);
    expect(t[0]!).toBeLessThan(1350);
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBeGreaterThan(450), expect(t[i]! - t[i - 1]!).toBeLessThan(550);
  });

  it('publishes k for each leg, the tempo in steps per minute, the mean k and the step count', () => {
    expect(chMax(d, 'knee.L', 1000, 1400)).toBeCloseTo(0.9, 1);
    expect(chMax(d, 'knee.R', 1000, 1400)).toBeLessThan(0.05);
    expect(chMax(d, 'lifted', 1100, 1300)).toBe(1);
    expect(chAt(d, 'lifted', 800)).toBe(0);
    const c = chAt(d, 'cadence', 3700);
    expect(c).toBeGreaterThan(110);
    expect(c).toBeLessThan(130);
    expect(chAt(d, 'meanK', 3700)).toBeCloseTo(0.9, 1);
    expect(chAt(d, 'steps', 4400)).toBe(6);
    expect(reps.at(-1)!.value!).toBeGreaterThan(110);
  });

  it('the tempo falls back to 0 when the player stops', () => {
    const stop = drive(createKneeLiftDetector, marching(500, 2, 500), { durationMs: 5000 });
    expect(chAt(stop, 'cadence', 2300)).toBeGreaterThan(100);
    expect(chAt(stop, 'cadence', 4800)).toBe(0);
  });

  it('a faster march (300 ms per step) is still every step, and the tempo follows', () => {
    const fast = drive(createKneeLiftDetector, marching(800, 5, 300, 0.8, 100, 20, 100), { durationMs: 4000 });
    expect(pick(fast.events, { kind: 'rep' })).toHaveLength(10);
    expect(chAt(fast, 'cadence', 3000)).toBeGreaterThan(180);
    expect(chAt(fast, 'cadence', 3000)).toBeLessThan(220);
  });
});

describe('march against high knees', () => {
  it('a 0.6 lift is a march step but not a high knee, and the miss says how high it got', () => {
    const m = marching(1000, 2, 500, 0.6);
    const march = drive(createKneeLiftDetector, m, { durationMs: 3500 });
    expect(pick(march.events, { kind: 'rep' })).toHaveLength(4);
    const high = drive(createKneeLiftDetector, m, { durationMs: 3500, opts: { enter: 0.75 } });
    expect(pick(high.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(high)!;
    expect(miss.code).toBe('knee_not_high');
    expect(miss.got!).toBeCloseTo(0.6, 1);
    expect(miss.need).toBe(0.75);
  });

  it('a lift that reaches 0.9 is a high knee', () => {
    const d = drive(createKneeLiftDetector, marching(1000, 2, 500, 0.9), { durationMs: 3500, opts: { enter: 0.75 } });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(4);
  });

  it('a lift under 0.15 is no attempt and needs no explanation', () => {
    const d = drive(createKneeLiftDetector, marching(1000, 2, 500, 0.1), { durationMs: 3500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)).toBeNull();
  });
});

describe('what does not count, and why', () => {
  it('the same leg twice in a row is one step; the miss names the leg', () => {
    const d = drive(createKneeLiftDetector, oneLeg('L', [1000, 2000, 3000]), { durationMs: 4200 });
    expect(sides(d)).toEqual(['L']);
    const miss = why(d, 1500)!;
    expect(miss.code).toBe('same_leg_twice');
    expect(miss.side).toBe('L');
  });

  it('with alternate 0 (Summit Climb step) every lift counts, whichever leg', () => {
    const d = drive(createKneeLiftDetector, oneLeg('L', [1000, 2000, 3000]), { durationMs: 4200, opts: { alternate: 0 } });
    expect(sides(d)).toEqual(['L', 'L', 'L']);
  });

  it('after a long pause the same leg may start again', () => {
    const d = drive(createKneeLiftDetector, oneLeg('R', [1000, 3500]), { durationMs: 5000 });
    expect(sides(d)).toEqual(['R', 'R']);
  });

  it('a jump with both knees tucked is no step: the other foot must stay down', () => {
    const p = pulse(1000, 0.9, 160, 60, 160);
    const d = drive(createKneeLiftDetector, legs(p, p), { durationMs: 2500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)!.code).toBe('foot_not_down');
  });

  it('a jump with hanging legs and a squat are no steps (k stays under 0.5; a squat is negative)', () => {
    const jump = keyframes([[1000, {}], [1200, { rise: 0.35 }], [1400, {}]]);
    const j = drive(createKneeLiftDetector, jump, { durationMs: 2500 });
    expect(pick(j.events, { kind: 'rep' })).toHaveLength(0);
    expect(chMax(j, 'kneeMax')).toBeLessThan(0.5);
    const squat = keyframes([[1000, {}], [1600, { drop: 0.9 }], [2400, { drop: 0.9 }], [3000, {}]]);
    const s = drive(createKneeLiftDetector, squat, { durationMs: 3500 });
    expect(pick(s.events, { kind: 'rep' })).toHaveLength(0);
    expect(chMin(s, 'knee.L')).toBeLessThan(-0.2);
  });

  it('a step during a two-frame blip of the other knee is not lost: the lift keeps its peak', () => {
    // a single leg lifting to 0.9 while the other knee wobbles by 0.1: still a step
    const wobble: Motion = (t) => ({ legL: { k: pulse(1000, 0.9, 160, 40, 160)(t) }, legR: { k: 0.1 * Math.sin(t / 40) ** 2 } });
    const d = drive(createKneeLiftDetector, wobble, { durationMs: 2200 });
    expect(sides(d)).toEqual(['L']);
  });
});

describe('seeing the knees', () => {
  it('knees out of view: no steps, and the miss says so after half a second', () => {
    const m = plus(marching(1000, 3, 500), () => ({ hide: ['knees'] as const }));
    const d = drive(createKneeLiftDetector, m, { durationMs: 4500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)!.code).toBe('knees_out_of_view');
  });

  it('a single frame of lost knee tracking does not drop the lift', () => {
    const lift = pulse(1000, 0.9, 160, 40, 160);
    const m: Motion = (t) => ({ legL: { k: lift(t) }, ...(t > 1100 && t < 1140 ? { hide: ['knees' as const] } : {}) });
    const d = drive(createKneeLiftDetector, m, { durationMs: 2200 });
    expect(sides(d)).toEqual(['L']);
  });

  it('nobody in view: the open lift is dropped, nothing is counted, and the person coming back starts clean', () => {
    const m = plus(oneLeg('L', [1000]), absentBetween(1100, 2600), oneLeg('R', [3000]));
    const d = drive(createKneeLiftDetector, m, { durationMs: 4200 });
    expect(sides(d)).toEqual(['R']);
  });
});

describe('form note', () => {
  it('a torso that looks short while stepping (leaning back) is noted as the body not straight', () => {
    const lean: Motion = (t) => ({ fore: 0.25, ...marching(1000, 2, 500)(t) });
    const d = drive(createKneeLiftDetector, lean, { durationMs: 3500 });
    expect(pick(d.events, { kind: 'rep' }).length).toBeGreaterThan(0);
    const miss = why(d)!;
    expect(miss.code).toBe('body_not_straight');
    expect(miss.got!).toBeLessThan(KNEE_LIFT_DEFAULTS.leanBack);
  });

  it('upright stepping has nothing to explain', () => {
    const d = drive(createKneeLiftDetector, marching(1000, 2, 500), { durationMs: 3500 });
    expect(why(d)).toBeNull();
  });
});

describe('reset', () => {
  it('forgets every step, tempo and miss', () => {
    const d = drive(createKneeLiftDetector, marching(500, 2, 500), { durationMs: 3000 });
    expect(d.detector.channels!().steps).toBe(4);
    d.detector.reset();
    expect(d.detector.channels!().steps).toBe(0);
    expect(d.detector.channels!().cadence).toBe(0);
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('six marching steps at %i Hz are six steps, legs in turn', (hz) => {
    const r = replayMotion(marching(500, 3, 500), { detectors: [{ id: 'kneeLift' }], durationMs: 4500, hz });
    expect(r.calibratedAt).not.toBeNull();
    const reps = r.events.filter((e) => e.kind === 'rep');
    expect(reps).toHaveLength(6);
    expect(reps.map((e) => e.side)).toEqual(['L', 'R', 'L', 'R', 'L', 'R']);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'kneeLift' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
