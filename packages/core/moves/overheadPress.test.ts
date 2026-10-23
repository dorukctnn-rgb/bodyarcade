// M11 overhead press (Rocket Press), with both hands drawn by the rig (testing/rig.ts): offsets are from each shoulder
// joint (the right at (0.4, 1), the left at (-0.4, 1)), outward is positive x for both; the arm is 1.15 T, so a hand
// 1.17 T above the shoulder is 1.02 A up. Synthetic numbers show that the code does what the thresholds say.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createOverheadPressDetector, OVERHEAD_PRESS_DEFAULTS } from './overheadPress.ts';
import { chAt, chMax, drive, pick, replayMotion } from './testing/harness.ts';
import { curve, handPaths } from './testing/motions.ts';
import { still, type Motion } from './testing/rig.ts';

interface Press { t0: number; holdMs?: number; topY?: number; topX?: number; rackY?: number }

/** hang -> rack (hands at the shoulders, 0.45 out) -> up over 400 ms -> hold -> back to the rack -> hang, once per start. */
function presses(starts: number[], p: Omit<Press, 't0'> = {}, side: 'both' | 'L' | 'R' = 'both'): Motion {
  const hold = p.holdMs ?? 300, topY = p.topY ?? 1.17, topX = p.topX ?? 0.2, rackY = p.rackY ?? 0;
  const yKeys: Array<readonly [number, number]> = [], xKeys: Array<readonly [number, number]> = [], lowKeys: Array<readonly [number, number]> = [];
  for (const t0 of starts) {
    yKeys.push([t0 - 600, -1.1], [t0, rackY], [t0 + 300, rackY], [t0 + 700, topY], [t0 + 700 + hold, topY], [t0 + 1100 + hold, rackY], [t0 + 1400 + hold, rackY], [t0 + 1900 + hold, -1.1]);
    xKeys.push([t0, 0.45], [t0 + 300, 0.45], [t0 + 700, topX], [t0 + 700 + hold, topX], [t0 + 1100 + hold, 0.45]);
    lowKeys.push([t0 - 600, -1.1], [t0, rackY], [t0 + 1400 + hold, rackY], [t0 + 1900 + hold, -1.1]);
  }
  const y = curve(yKeys), x = curve(xKeys), lowY = curve(lowKeys);
  const yL = side === 'R' ? lowY : y, yR = side === 'L' ? lowY : y;
  return handPaths((t) => ({ x: -x(t), y: yL(t) }), (t) => ({ x: x(t), y: yR(t) }));
}
const press = (p: Press, side: 'both' | 'L' | 'R' = 'both'): Motion => presses([p.t0], p, side);

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('overhead press must explain');
  return d.detector.explain(ms);
};

describe('one press', () => {
  const d = drive(createOverheadPressDetector, press({ t0: 1000 }), { durationMs: 4000 });
  const reps = pick(d.events, { kind: 'rep' });

  it('is one rep, counted when both hands lock out over the head', () => {
    expect(reps).toHaveLength(1);
    expect(reps[0]!.id).toBe('overheadPress');
    expect(reps[0]!.t).toBeGreaterThan(1500);
    expect(reps[0]!.t).toBeLessThan(1800);
    expect(reps[0]!.value).toBe(1);
  });

  it('reports the height of the lower hand in arm lengths and its upward speed', () => {
    expect(reps[0]!.q!.range!).toBeGreaterThanOrEqual(OVERHEAD_PRESS_DEFAULTS.top);
    expect(reps[0]!.q!.range!).toBeLessThan(1.3);
    expect(reps[0]!.q!.speed!).toBeGreaterThan(1);
  });

  it('publishes progress, height, elbow, the rack and the top, and the count', () => {
    expect(chAt(d, 'rack', 1100)).toBe(1);
    expect(chAt(d, 'top', 1100)).toBe(0);
    expect(chAt(d, 'press', 1100)).toBeLessThan(0.3);
    expect(chAt(d, 'top', 1900)).toBe(1);
    expect(chAt(d, 'press', 1900)).toBe(1);
    expect(chAt(d, 'armsUp', 1900)).toBeGreaterThan(0.85);
    expect(chAt(d, 'elbow', 1900)).toBeGreaterThan(150);
    expect(chAt(d, 'torso', 1900)).toBeCloseTo(1, 1);
    expect(chAt(d, 'top', 3800)).toBe(0);
    expect(chAt(d, 'reps', 3800)).toBe(1);
    expect(d.detector.value()).toBeLessThan(0.1);
    expect(why(d)).toBeNull();
  });
});

describe('several presses', () => {
  it('three presses, each back through the rack, are three reps', () => {
    const d = drive(createOverheadPressDetector, presses([1000, 4000, 7000]), { durationMs: 9500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(3);
  });

  it('pressing again without coming back to the shoulders is no rep: "arms not down"', () => {
    // up, down only to 0.7 T over the shoulders (0.6 A: above the rack), up again
    const m = handPaths((t) => ({ x: -0.25, y: curve([[500, -1.1], [800, 0], [1200, 1.17], [1800, 1.17], [2300, 0.75], [2500, 0.75], [2900, 1.17], [3600, 1.17]])(t) }),
      (t) => ({ x: 0.25, y: curve([[500, -1.1], [800, 0], [1200, 1.17], [1800, 1.17], [2300, 0.75], [2500, 0.75], [2900, 1.17], [3600, 1.17]])(t) }));
    const d = drive(createOverheadPressDetector, m, { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
    const miss = why(d)!;
    expect(miss.code).toBe('arms_not_down');
    expect(miss.need).toBe(OVERHEAD_PRESS_DEFAULTS.rackBand);
    expect(miss.got!).toBeGreaterThan(OVERHEAD_PRESS_DEFAULTS.rackBand);
  });
});

describe('holding the lockout (the afterburner)', () => {
  it('two seconds up is a hold, with the time at its end', () => {
    const d = drive(createOverheadPressDetector, press({ t0: 1000, holdMs: 3200 }), { durationMs: 7000 });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(1);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(1);
    expect(pick(d.events, { kind: 'holdStart' })[0]!.t).toBeGreaterThan(3500);
    expect(pick(d.events, { kind: 'holdEnd' })[0]!.value!).toBeGreaterThan(2800);
    expect(chMax(d, 'held', 3600, 4500)).toBeGreaterThan(2000);
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
  });

  it('a press held for less than two seconds is no hold, and holdMs 0 turns holds off', () => {
    const d = drive(createOverheadPressDetector, press({ t0: 1000, holdMs: 1200 }), { durationMs: 5000 });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    const off = drive(createOverheadPressDetector, press({ t0: 1000, holdMs: 3200 }), { durationMs: 7000, opts: { holdMs: 0 } });
    expect(pick(off.events, { kind: 'holdStart' })).toHaveLength(0);
  });
});

describe('what is not a press, and why', () => {
  it('hands that stop under the lockout height are "arms not up", with how high they got', () => {
    const d = drive(createOverheadPressDetector, press({ t0: 1000, topY: 0.75 }), { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('arms_not_up');
    expect(miss.need).toBe(OVERHEAD_PRESS_DEFAULTS.top);
    expect(miss.got!).toBeGreaterThan(0.5);
    expect(miss.got!).toBeLessThan(0.85);
  });

  it('hands high enough but with bent elbows are "elbows bent", with the angle', () => {
    const d = drive(createOverheadPressDetector, press({ t0: 1000, topY: 1.0, topX: 0.5 }), { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('elbows_bent');
    expect(miss.got!).toBeLessThan(150);
    expect(miss.need).toBe(OVERHEAD_PRESS_DEFAULTS.elbow);
  });

  it('one arm pressing and the other staying at the shoulder is "use both arms", naming the arm that stayed', () => {
    const d = drive(createOverheadPressDetector, press({ t0: 1000 }, 'R'), { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('use_both_arms');
    expect(miss.side).toBe('L');
  });

  it('an arched back (a short torso at lockout) is noted, and the press still counts', () => {
    const arch: Motion = (t) => ({ fore: t > 1500 && t < 2500 ? 0.2 : 0, ...press({ t0: 1000, holdMs: 800 })(t) });
    const d = drive(createOverheadPressDetector, arch, { durationMs: 3600 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('body_not_straight');
    expect(miss.got!).toBeLessThan(OVERHEAD_PRESS_DEFAULTS.archMin);
  });

  it('hands or elbows out of view: nothing counts, and the miss says so', () => {
    const hands: Motion = (t) => ({ ...press({ t0: 1000 })(t), hide: ['hands'] as const });
    const a = drive(createOverheadPressDetector, hands, { durationMs: 4000 });
    expect(pick(a.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(a)!.code).toBe('hands_out_of_view');
    const elbows: Motion = (t) => ({ ...press({ t0: 1000 })(t), hide: ['elbows'] as const });
    const b = drive(createOverheadPressDetector, elbows, { durationMs: 4000 });
    expect(pick(b.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(b)!.code).toBe('elbows_out_of_view');
  });

  it('a person standing still has nothing to explain', () => {
    const d = drive(createOverheadPressDetector, still(), { durationMs: 3000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)).toBeNull();
  });
});

describe('reset', () => {
  it('forgets the count, the arming and the miss', () => {
    const d = drive(createOverheadPressDetector, press({ t0: 1000 }), { durationMs: 4000 });
    expect(d.detector.channels!().reps).toBe(1);
    d.detector.reset();
    expect(d.detector.channels!()).toEqual({});
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15])('three presses at %i Hz are three reps', (hz) => {
    const r = replayMotion(presses([500, 3500, 6500]), { detectors: [{ id: 'overheadPress' }], durationMs: 9000, hz });
    expect(r.calibratedAt).not.toBeNull();
    expect(r.events.filter((e) => e.kind === 'rep')).toHaveLength(3);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'overheadPress' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
