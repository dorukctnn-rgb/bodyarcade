// M14 steadiness and the one-leg stance (Flamingo, Hot Seat, Tree Garden), with the body drawn by the rig (testing/rig.ts):
// `dx` sways the whole body sideways, `drop` bobs it, `legL` / `legR` lift a knee (k) and so the foot. Synthetic numbers show
// that the code does what the thresholds say; none of the bands is measured on people yet.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createSteadinessDetector, STEADINESS_DEFAULTS } from './steadiness.ts';
import { chAt, chMax, drive, pick, replayMotion } from './testing/harness.ts';
import { curve } from './testing/motions.ts';
import { still, type Motion } from './testing/rig.ts';

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('steadiness must explain');
  return d.detector.explain(ms);
};

/** The body sways sideways by amp T at hz. */
const sways = (amp: number, hz = 1): Motion => (t) => ({ dx: amp * Math.sin((2 * Math.PI * hz * t) / 1000) });

describe('sway', () => {
  it('standing still is no sway and fully steady', () => {
    const d = drive(createSteadinessDetector, still(), { durationMs: 3000 });
    expect(chMax(d, 'sway')).toBe(0);
    expect(chAt(d, 'steady', 2500)).toBe(1);
    expect(chAt(d, 'sway.y', 2500)).toBe(0);
    expect(d.detector.value()).toBe(0);
    expect(why(d)).toBeNull();
  });

  it('a sideways sway of 0.1 T at 1 Hz reads the standard deviation in shoulder widths, for hips and shoulders alike', () => {
    const d = drive(createSteadinessDetector, sways(0.1), { durationMs: 5000 });
    // a sine of amplitude 0.1 T has a standard deviation of 0.0707 T = 0.088 W (W = 0.8 T)
    expect(chAt(d, 'sway.hip', 4500)).toBeCloseTo(0.088, 2);
    expect(chAt(d, 'sway.shoulder', 4500)).toBeCloseTo(0.088, 2);
    expect(chAt(d, 'sway', 4500)).toBeCloseTo(0.088, 2);
    expect(chAt(d, 'steady', 4500)).toBeCloseTo(1 - 0.088 / STEADINESS_DEFAULTS.swayRef, 1);
    expect(chAt(d, 'sway.y', 4500)).toBe(0);
  });

  it('more sway is less steady, and past the limit the miss says to hold still', () => {
    const small = drive(createSteadinessDetector, sways(0.05), { durationMs: 5000 });
    const big = drive(createSteadinessDetector, sways(0.35), { durationMs: 5000 });
    expect(chAt(small, 'steady', 4500)).toBeGreaterThan(chAt(big, 'steady', 4500));
    expect(why(small)).toBeNull();
    const miss = why(big)!;
    expect(miss.code).toBe('hold_still');
    expect(miss.need).toBe(STEADINESS_DEFAULTS.swayMax);
    expect(miss.got!).toBeGreaterThan(STEADINESS_DEFAULTS.swayMax);
    expect(chAt(big, 'steady', 4500)).toBe(0);
  });

  it('only the last two seconds count: a shake that stopped fades out of the window', () => {
    const m: Motion = (t) => (t < 2000 ? sways(0.3)(t) : {});
    const d = drive(createSteadinessDetector, m, { durationMs: 6000 });
    expect(chMax(d, 'sway', 1500, 2000)).toBeGreaterThan(0.2);
    expect(chAt(d, 'sway', 5500)).toBe(0);
  });

  it('bobbing up and down (a wobbling wall sit) reads as vertical sway in torso lengths', () => {
    const bob: Motion = (t) => ({ drop: 0.5 + 0.1 * Math.sin((2 * Math.PI * t) / 1000) });
    const d = drive(createSteadinessDetector, bob, { durationMs: 5000 });
    expect(chAt(d, 'sway.y', 4500)).toBeCloseTo(0.0707, 2);
    expect(chAt(d, 'sway', 4500)).toBeLessThan(0.01);                // sideways it is still
  });

  it('the shoulders alone swaying (a lean with steady hips) shows in the shoulder number only', () => {
    const lean: Motion = (t) => ({ bend: 10 * Math.sin((2 * Math.PI * t) / 1000) });
    const d = drive(createSteadinessDetector, lean, { durationMs: 5000 });
    expect(chAt(d, 'sway.shoulder', 4500)).toBeGreaterThan(0.05);
    expect(chAt(d, 'sway.hip', 4500)).toBeLessThan(0.005);
  });
});

describe('the one-leg stance', () => {
  const opts = { stance: 1 };
  /** Left foot up from t0 (over 300 ms) until t1, then down. */
  const leftUp = (t0: number, t1: number, k = 0.6): Motion => {
    const lift = curve([[t0, 0], [t0 + 300, k], [t1, k], [t1 + 300, 0]]);
    return (t) => ({ legL: { k: lift(t) } });
  };

  it('a lifted foot for 0.3 s starts a stance on that foot; putting it down for 0.3 s ends it, with the time held', () => {
    const d = drive(createSteadinessDetector, leftUp(1000, 5000), { durationMs: 7000, opts });
    const [start] = pick(d.events, { kind: 'holdStart' }), [end] = pick(d.events, { kind: 'holdEnd' });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(1);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(1);
    expect(start!.side).toBe('L');
    expect(start!.t).toBeGreaterThan(1300);
    expect(start!.t).toBeLessThan(1700);
    expect(end!.side).toBe('L');
    expect(end!.t).toBeGreaterThan(5300);
    expect(end!.value!).toBeGreaterThan(3800);
    expect(end!.value!).toBeLessThan(4600);
  });

  it('publishes which foot is up, how high, the knee lifts and the hold time', () => {
    const d = drive(createSteadinessDetector, leftUp(1000, 5000), { durationMs: 7000, opts });
    expect(chAt(d, 'stance', 500)).toBe(0);
    expect(chAt(d, 'stance', 3000)).toBe(-1);
    expect(chAt(d, 'lift', 3000)).toBeGreaterThan(0.5);
    expect(chAt(d, 'k.L', 3000)).toBeCloseTo(0.6, 1);
    expect(chAt(d, 'k.R', 3000)).toBeCloseTo(0, 1);
    expect(chAt(d, 'held', 3000)).toBeGreaterThan(1500);
    expect(chAt(d, 'floor', 500)).toBe(1);
    expect(chAt(d, 'floor', 3000)).toBe(0);
    expect(chAt(d, 'floor', 6800)).toBe(1);
    expect(chAt(d, 'stance', 6800)).toBe(0);
  });

  it('the right foot lifting is the stance on the right foot', () => {
    const d = drive(createSteadinessDetector, (t) => ({ legR: { k: curve([[1000, 0], [1300, 0.6], [3000, 0.6]])(t) } }), { durationMs: 4000, opts });
    expect(pick(d.events, { kind: 'holdStart' })[0]!.side).toBe('R');
    expect(chAt(d, 'stance', 3500)).toBe(1);
  });

  it('a foot that comes up less than 0.15 T is no lift, and the miss says how high it got', () => {
    const d = drive(createSteadinessDetector, leftUp(1000, 4000, 0.1), { durationMs: 5500, opts });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    const miss = why(d)!;
    expect(miss.code).toBe('knee_not_high');
    expect(miss.need).toBe(STEADINESS_DEFAULTS.liftT);
    expect(miss.got!).toBeGreaterThan(0.05);
    expect(miss.got!).toBeLessThan(0.15);
  });

  it('a lift too short to count (under 0.3 s) is no stance', () => {
    const d = drive(createSteadinessDetector, leftUp(1000, 1100), { durationMs: 3000, opts });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
  });

  it('a toe tap shorter than the touch time does not end the stance; a longer one does', () => {
    const tap = (downMs: number): Motion => {
      const lift = curve([[1000, 0], [1300, 0.6], [3000, 0.6], [3150, 0], [3150 + downMs, 0], [3300 + downMs, 0.6], [6000, 0.6]]);
      return (t) => ({ legL: { k: lift(t) } });
    };
    const light = drive(createSteadinessDetector, tap(150), { durationMs: 7000, opts });
    expect(pick(light.events, { kind: 'holdEnd' })).toHaveLength(0);
    expect(pick(light.events, { kind: 'holdStart' })).toHaveLength(1);
    const long = drive(createSteadinessDetector, tap(900), { durationMs: 7000, opts });
    expect(pick(long.events, { kind: 'holdEnd' }).length).toBeGreaterThanOrEqual(1);
    const supported = drive(createSteadinessDetector, tap(900), { durationMs: 7000, opts: { ...opts, touchMs: 1500 } });
    expect(pick(supported.events, { kind: 'holdEnd' })).toHaveLength(0);
  });

  it('switching feet ends one stance and starts the other', () => {
    const m: Motion = (t) => ({ legL: { k: curve([[1000, 0], [1300, 0.6], [3000, 0.6], [3300, 0]])(t) }, legR: { k: curve([[3000, 0], [3300, 0.6], [5000, 0.6]])(t) } });
    const d = drive(createSteadinessDetector, m, { durationMs: 6000, opts });
    expect(pick(d.events, { kind: 'holdStart' }).map((e) => e.side)).toEqual(['L', 'R']);
    expect(pick(d.events, { kind: 'holdEnd' }).map((e) => e.side)).toEqual(['L']);
  });

  it('the stance is off unless asked for', () => {
    const d = drive(createSteadinessDetector, leftUp(1000, 5000), { durationMs: 6000 });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(chAt(d, 'stance', 3000)).toBe(0);
    expect(chAt(d, 'sway', 3000)).toBeGreaterThan(-1);
  });

  it('legs out of view: no stance, and the miss says so', () => {
    const m: Motion = (t) => ({ ...leftUp(1000, 5000)(t), hide: ['knees', 'ankles', 'feet'] as const });
    const d = drive(createSteadinessDetector, m, { durationMs: 6000, opts });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(why(d)!.code).toBe('knees_out_of_view');
  });

  it('sway while standing on one foot is still read, and a steady stance has nothing to explain', () => {
    const d = drive(createSteadinessDetector, (t) => ({ ...leftUp(500, 6000)(t), ...sways(0.1)(t) }), { durationMs: 6000, opts });
    expect(chAt(d, 'sway', 5500)).toBeCloseTo(0.088, 2);
    expect(why(d)).toBeNull();
  });
});

describe('reset', () => {
  it('forgets the sway, the stance and the miss', () => {
    const d = drive(createSteadinessDetector, sways(0.3), { durationMs: 4000, opts: { stance: 1 } });
    d.detector.reset();
    expect(d.detector.channels!()).toEqual({});
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('a stance held for four seconds at %i Hz is one hold on the right foot', (hz) => {
    const lift = curve([[500, 0], [800, 0.7], [4800, 0.7], [5100, 0]]);
    const r = replayMotion((t) => ({ legL: { k: lift(t) } }), { detectors: [{ id: 'steadiness', opts: { stance: 1 } }], durationMs: 7000, hz });
    expect(r.calibratedAt).not.toBeNull();
    expect(r.events.filter((e) => e.kind === 'holdStart').map((e) => e.side)).toEqual(['L']);
    expect(r.events.filter((e) => e.kind === 'holdEnd')).toHaveLength(1);
  });

  it('a person standing still is steady: a small sway number, no stance', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'steadiness', opts: { stance: 1 } }], durationMs: 6000 });
    const after = r.samples.filter((s) => s.t > r.calibratedAt! + 2500);
    expect(Math.max(...after.map((s) => s.channels.sway ?? 0))).toBeLessThan(0.02);
    expect(Math.min(...after.map((s) => s.channels.steady ?? 0))).toBeGreaterThan(0.9);
    expect(r.events).toEqual([]);
  });
});
