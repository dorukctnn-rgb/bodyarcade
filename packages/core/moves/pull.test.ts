// M10 grab and pull (Summit Climb), with hands drawn by the rig (testing/rig.ts): the shoulder joints sit at y = 1,
// the nose at 1.45, the arm is 1.15 long. Synthetic numbers show that the code does what the thresholds say.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../types/index.ts';
import { canExplain } from './kit.ts';
import { createPullDetector, PULL_DEFAULTS } from './pull.ts';
import { chAt, chMax, drive, pick, replayMotion } from './testing/harness.ts';
import { curve, handPaths, plus } from './testing/motions.ts';
import { keyframes, still, type Motion } from './testing/rig.ts';

type Side = 'L' | 'R';

/** A hand's offset from its shoulder joint over time: leaning outward by 0.3 T, height from `keys` [t, y]. */
const hand = (side: Side, keys: ReadonlyArray<readonly [number, number]>): ((t: number) => Vec2) => {
  const y = curve(keys);
  return (t) => ({ x: side === 'R' ? 0.3 : -0.3, y: y(t) });
};

/** Reach up over 500 ms, hold 200 ms, pull to the shoulder line over `pullMs`, rest 300 ms, let the arm hang. */
const climbKeys = (t0: number, pullMs = 500, top = 1.05, low = -0.05): Array<readonly [number, number]> =>
  [[t0 - 1, -1.1], [t0, -1.1], [t0 + 500, top], [t0 + 700, top], [t0 + 700 + pullMs, low], [t0 + 1000 + pullMs, low], [t0 + 1500 + pullMs, -1.1]];

/** One hand pulling at each of `starts` (one key list: two motions on the same arm must not be added up). */
const pullsBy = (side: Side, starts: number[], pullMs?: number, top?: number, low?: number): Motion => {
  const keys = starts.flatMap((t0) => climbKeys(t0, pullMs, top, low));
  return side === 'R' ? handPaths(undefined, hand('R', keys)) : handPaths(hand('L', keys), undefined);
};
const pullBy = (side: Side, t0: number, pullMs?: number, top?: number, low?: number): Motion => pullsBy(side, [t0], pullMs, top, low);

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('pull must explain');
  return d.detector.explain(ms);
};

describe('one pull', () => {
  const d = drive(createPullDetector, pullBy('R', 1000), { durationMs: 4000 });
  const reps = pick(d.events, { kind: 'rep' });

  it('is one rep on the pulling hand, counted when the hand gets down to the shoulder line', () => {
    expect(reps).toHaveLength(1);
    expect(reps[0]!.id).toBe('pull');
    expect(reps[0]!.side).toBe('R');
    expect(reps[0]!.t).toBeGreaterThan(1800);
    expect(reps[0]!.t).toBeLessThan(2300);
  });

  it('reports the amplitude in arm lengths, the downward speed and a full-value rep', () => {
    // from 1.05 above the shoulders down to 0.1 above them: (1.05 - 0.1) / 1.15
    expect(reps[0]!.q!.range!).toBeCloseTo((1.05 - 0.1) / 1.15, 1);
    expect(reps[0]!.q!.speed!).toBeGreaterThan(1.5);
    expect(reps[0]!.value).toBe(1);
    expect(reps[0]!.warn).toBeUndefined();
  });

  it('publishes grab, progress, reach height, the climb and the count', () => {
    expect(chAt(d, 'grab.R', 500)).toBe(0);
    expect(chAt(d, 'grab.R', 1600)).toBe(1);              // holding on at the top
    expect(chAt(d, 'grab.L', 1600)).toBe(0);
    expect(chMax(d, 'reach.R', 1500, 1800)).toBeGreaterThan(0.5);
    expect(chMax(d, 'pull.R', 1700, 2300)).toBeGreaterThan(0.8);
    expect(chAt(d, 'pull.R', 3500)).toBe(0);
    expect(chAt(d, 'reps', 3500)).toBe(1);
    expect(chAt(d, 'climb', 3500)).toBeCloseTo(0.83, 1);
  });
});

describe('hands in turn', () => {
  it('right, left, right: every pull is a full climb step, on its own side', () => {
    const d = drive(createPullDetector, plus(pullsBy('R', [1000, 5600]), pullBy('L', 3300)), { durationMs: 8500 });
    const reps = pick(d.events, { kind: 'rep' });
    expect(reps.map((e) => e.side)).toEqual(['R', 'L', 'R']);
    expect(reps.map((e) => e.value)).toEqual([1, 1, 1]);
    expect(chAt(d, 'climb', 8400)).toBeCloseTo(3 * 0.83, 1);
  });

  it('the same hand twice in a row counts half the second time', () => {
    const d = drive(createPullDetector, pullsBy('R', [1000, 3300]), { durationMs: 6000 });
    const reps = pick(d.events, { kind: 'rep' });
    expect(reps.map((e) => e.side)).toEqual(['R', 'R']);
    expect(reps.map((e) => e.value)).toEqual([1, 0.5]);
    expect(chAt(d, 'climb', 5900)).toBeCloseTo(0.83 * 1.5, 1);
  });

  it('both hands pulling together are two reps', () => {
    const d = drive(createPullDetector, plus(pullBy('R', 1000), pullBy('L', 1000)), { durationMs: 4000 });
    const reps = pick(d.events, { kind: 'rep' });
    expect(reps).toHaveLength(2);
    expect(new Set(reps.map((e) => e.side))).toEqual(new Set(['L', 'R']));
    expect(reps.map((e) => e.value)).toEqual([1, 1]);
  });

  it('a shorter reach is a shorter rep', () => {
    const lowReach = drive(createPullDetector, pullBy('R', 1000, 500, 0.8), { durationMs: 4000 });
    expect(pick(lowReach.events, { kind: 'rep' })[0]!.q!.range!).toBeCloseTo((0.8 - 0.1) / 1.15, 1);
  });
});

describe('what is not a pull, and why', () => {
  it('a pull that takes five seconds is too slow, with the time it took', () => {
    const d = drive(createPullDetector, pullBy('R', 1000, 5000), { durationMs: 8500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 8000)!;
    expect(miss.code).toBe('pull_faster');
    expect(miss.side).toBe('R');
    expect(miss.need).toBe(PULL_DEFAULTS.pullMs);
    expect(miss.got!).toBeGreaterThan(PULL_DEFAULTS.pullMs);
  });

  it('a pull that stops half way and goes back up is "pull more", with the distance in arm lengths', () => {
    const keys: Array<readonly [number, number]> = [[999, -1.1], [1000, -1.1], [1500, 1.05], [1700, 1.05], [2200, 0.55], [2500, 0.55], [3000, 1.05], [4500, 1.05]];
    const d = drive(createPullDetector, handPaths(undefined, hand('R', keys)), { durationMs: 4500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);          // the hand stays up: no second stroke
    const miss = why(d, 4000)!;
    expect(miss.code).toBe('pull_more');
    expect(miss.got!).toBeLessThan(miss.need!);
    expect(miss.need!).toBeCloseTo((1.05 - 0.1) / 1.15, 1);
  });

  it('a reach that does not get above the nose by 0.25 is "grab higher", with how far above it got', () => {
    const d = drive(createPullDetector, pullBy('R', 1000, 500, 0.55), { durationMs: 4000 });   // hand 0.1 above the nose
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('grab_higher');
    expect(miss.got!).toBeCloseTo(0.1, 1);
    expect(miss.need).toBe(PULL_DEFAULTS.grabAbove);
  });

  it('a hand that never goes above the shoulders is not trying: nothing to explain', () => {
    const d = drive(createPullDetector, still(), { durationMs: 3000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)).toBeNull();
  });

  it('hands out of view: no rep, and the miss says so', () => {
    const m: Motion = (t) => ({ ...pullBy('R', 1000)(t), hide: ['hands'] as const });
    const d = drive(createPullDetector, m, { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)!.code).toBe('hands_out_of_view');
  });
});

describe('form note', () => {
  it('shoulders that rise during the pull are noted as a shrug (never a penalty: the rep still counts)', () => {
    const body = keyframes([[0, {}], [1500, {}], [2000, { rise: 0.25 }], [3200, {}]]);
    const d = drive(createPullDetector, plus(pullBy('R', 1000), body), { durationMs: 4000 });
    const reps = pick(d.events, { kind: 'rep' });
    expect(reps).toHaveLength(1);
    expect(reps[0]!.warn).toEqual(['shrug']);
  });
});

describe('losing the person', () => {
  it('reset forgets the climb, the count and the miss', () => {
    const d = drive(createPullDetector, pullBy('R', 1000), { durationMs: 4000 });
    expect(d.detector.channels!().reps).toBe(1);
    d.detector.reset();
    expect(d.detector.channels!().reps).toBe(0);
    expect(d.detector.channels!().climb).toBe(0);
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15])('three pulls (right, left, right) at %i Hz are three reps', (hz) => {
    const m = plus(pullsBy('R', [500, 5100]), pullBy('L', 2800));
    const r = replayMotion(m, { detectors: [{ id: 'pull' }], durationMs: 8000, hz });
    expect(r.calibratedAt).not.toBeNull();
    const reps = r.events.filter((e) => e.kind === 'rep');
    expect(reps.map((e) => e.side)).toEqual(['R', 'L', 'R']);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'pull' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
