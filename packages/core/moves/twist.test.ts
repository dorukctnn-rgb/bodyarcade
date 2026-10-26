// M8 trunk twist, drawn by the articulated rig (testing/rig.ts): the shoulders turn up to 40 degrees (they narrow by the
// cosine) while the joined hands swing to tau = 0.8 W. Synthetic numbers show that the code does what the thresholds
// say, not that they suit real bodies.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createTwistDetector, TWIST_DEFAULTS } from './twist.ts';
import { chAt, chMax, chMin, drive, pick, replayMotion } from './testing/harness.ts';
import { curve } from './testing/motions.ts';
import { armTo, still, type Motion } from './testing/rig.ts';

const W = 0.8;

interface Turn { turn?: number; tau?: number; handsGap?: number; y?: number }

/** The body turned by v in -1..1: shoulders `turn` degrees (default 40), the joined hands at tau W (default 0.8). */
const turning = (v: (t: number) => number, o: Turn = {}): Motion => (t) => {
  const s = v(t);
  const phi = (o.turn ?? 40) * s;
  const xh = (o.tau ?? 0.8) * W * s;
  const half = (W / 2) * Math.cos((phi * Math.PI) / 180);
  const g = (o.handsGap ?? 0.04) / 2;
  const y = (o.y ?? 0.4) - 1;
  return { twist: phi, armL: armTo('L', { x: xh - g + half, y }), armR: armTo('R', { x: xh + g - half, y }) };
};

/** Left for a while, across in 900 ms, right for a while, across and back (two crossings). */
const SWING = curve([[0, 0], [500, 0], [1000, -1], [2000, -1], [2900, 1], [3700, 1], [4600, -1], [5400, -1]]);

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('twist must explain');
  return d.detector.explain(ms);
};

describe('crossing from one side to the other', () => {
  const d = drive(createTwistDetector, turning(SWING), { durationMs: 6000 });
  const reps = pick(d.events, { kind: 'rep' });

  it('every crossing is a rep, on the side reached; arriving at the first side is none', () => {
    expect(reps).toHaveLength(2);
    expect(reps.map((e) => e.side)).toEqual(['R', 'L']);
    expect(reps[0]!.t).toBeGreaterThan(2300);
    expect(reps[0]!.t).toBeLessThan(2800);
    expect(reps[1]!.t).toBeGreaterThan(4000);
    expect(reps[1]!.t).toBeLessThan(4600);
    for (const e of reps) expect(e.id).toBe('twist');
  });

  it('reports how far the body went on the side it left, how fast it crossed and the tempo', () => {
    expect(reps[0]!.q!.range!).toBeCloseTo(0.8, 1);
    expect(reps[0]!.q!.speed!).toBeGreaterThan(1.8);
    expect(reps[0]!.q!.speed!).toBeLessThan(4);
    expect(reps[0]!.value).toBe(0);                      // one crossing makes no tempo yet
    expect(reps[1]!.value!).toBeGreaterThan(25);
    expect(reps[1]!.value!).toBeLessThan(45);            // two crossings 1.7 s apart: about 35 per minute
  });

  it('publishes tau, the shoulder width ratio, the hand gap, the side and the count', () => {
    expect(chAt(d, 'tau', 1500)).toBeCloseTo(-0.8, 1);
    expect(chAt(d, 'span', 1500)).toBeCloseTo(Math.cos((40 * Math.PI) / 180), 1);
    expect(chAt(d, 'gap', 1500)).toBeLessThan(0.1);
    expect(chAt(d, 'side', 1500)).toBe(-1);
    expect(chAt(d, 'side', 3300)).toBe(1);
    expect(chAt(d, 'side', 250)).toBe(0);
    expect(chAt(d, 'reps', 5800)).toBe(2);
    expect(chMax(d, 'tau')).toBeCloseTo(0.8, 1);
    expect(chMin(d, 'tau')).toBeCloseTo(-0.8, 1);
    expect(d.detector.value()).toBeCloseTo(-0.8, 1);
  });
});

describe('a steady twisting rhythm', () => {
  it('a crossing every 1.2 s reads about 50 per minute', () => {
    const keys: Array<readonly [number, number]> = [[0, 0], [500, 0]];
    for (let k = 0; k < 7; k++) keys.push([1000 + 1200 * k, k % 2 === 0 ? -1 : 1], [1300 + 1200 * k, k % 2 === 0 ? -1 : 1]);
    const d = drive(createTwistDetector, turning(curve(keys)), { durationMs: 10500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(6);
    const last = pick(d.events, { kind: 'rep' }).at(-1)!;
    expect(last.value!).toBeGreaterThan(45);
    expect(last.value!).toBeLessThan(55);
    expect(chAt(d, 'rate', 10300)).toBeGreaterThan(45);
    expect(chAt(d, 'rate', 10300)).toBeLessThan(55);
  });
});

describe('holding a twist', () => {
  it('with holdMs a twist held that long is a hold, with its side and length, and it ends when the body comes back', () => {
    const d = drive(createTwistDetector, turning(SWING), { durationMs: 6000, opts: { holdMs: 1000 } });
    const starts = pick(d.events, { kind: 'holdStart' }), ends = pick(d.events, { kind: 'holdEnd' });
    expect(starts.map((e) => e.side)).toEqual(['L', 'R', 'L']);
    expect(ends.map((e) => e.side)).toEqual(['L', 'R']);   // the last one is still held when the motion stops
    expect(starts[0]!.t).toBeGreaterThan(1700);
    expect(starts[0]!.t).toBeLessThan(2000);
    expect(ends[0]!.value!).toBeGreaterThan(1200);
    expect(ends[0]!.value!).toBeLessThan(1700);
    expect(chMax(d, 'held', 1850, 2000)).toBeGreaterThan(1000);
    expect(chAt(d, 'held', 2800)).toBe(0);
  });

  it('holds are off unless asked for', () => {
    const d = drive(createTwistDetector, turning(SWING), { durationMs: 6000 });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
  });

  it('a twist that is shorter than the hold time is no hold', () => {
    const quick = curve([[0, 0], [500, 0], [900, -1], [1300, -1], [1700, 0], [3000, 0]]);
    const d = drive(createTwistDetector, turning(quick), { durationMs: 3500, opts: { holdMs: 1000 } });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(0);
  });
});

describe('what is not a twist, and why', () => {
  it('swinging the arms with the shoulders square to the camera is "turn the shoulders"', () => {
    const d = drive(createTwistDetector, turning(SWING, { turn: 0 }), { durationMs: 6000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(chMax(d, 'side')).toBe(0);
    const miss = why(d, 6000)!;
    expect(miss.code).toBe('turn_shoulders');
    expect(miss.got!).toBeGreaterThan(TWIST_DEFAULTS.maxSpan);
    expect(miss.need).toBe(TWIST_DEFAULTS.maxSpan);
  });

  it('turning only a little (tau 0.45) is "turn more", with the tau reached', () => {
    const d = drive(createTwistDetector, turning(SWING, { tau: 0.45, turn: 25, handsGap: 0.3 }), { durationMs: 6000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 6000)!;
    expect(miss.code).toBe('turn_more');
    expect(miss.got!).toBeCloseTo(0.45, 1);
    expect(miss.need).toBe(TWIST_DEFAULTS.turn);
  });

  it('hands held apart are no twist: "hands apart" with the gap', () => {
    const d = drive(createTwistDetector, turning(SWING, { handsGap: 0.5 }), { durationMs: 6000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 6000)!;
    expect(miss.code).toBe('hands_apart');
    expect(miss.got!).toBeGreaterThan(0.5);
  });

  it('a jerk across in a quarter of a second is not a rep, and is "too fast"', () => {
    const jerk = curve([[0, 0], [500, 0], [1000, -1], [2000, -1], [2250, 1], [3500, 1]]);
    const d = drive(createTwistDetector, turning(jerk), { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('too_fast');
    expect(miss.need).toBe(TWIST_DEFAULTS.minMs);
    expect(miss.got!).toBeLessThan(TWIST_DEFAULTS.minMs);
  });

  it('a crossing that takes five seconds is "too slow"; a level that allows four seconds counts it', () => {
    const slow = curve([[0, 0], [500, 0], [1000, -1], [2000, -1], [7000, 1], [8000, 1]]);
    const d = drive(createTwistDetector, turning(slow), { durationMs: 8500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d, 3000)!;
    expect(miss.code).toBe('too_slow');
    expect(miss.need).toBe(TWIST_DEFAULTS.maxMs);
    expect(miss.got!).toBeGreaterThan(TWIST_DEFAULTS.maxMs);
    const easy = drive(createTwistDetector, turning(slow), { durationMs: 8500, opts: { maxMs: 4000 } });
    expect(pick(easy.events, { kind: 'rep' })).toHaveLength(1);       // the 2.8 s between the two stays is within 4 s
  });

  it('twisting to the same side twice is not a crossing', () => {
    const same = curve([[0, 0], [500, 0], [1000, -1], [1800, -1], [2300, 0], [2800, 0], [3300, -1], [4000, -1]]);
    const d = drive(createTwistDetector, turning(same), { durationMs: 4500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
  });

  it('a person standing still has nothing to explain', () => {
    const d = drive(createTwistDetector, still(), { durationMs: 3000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)).toBeNull();
  });
});

describe('seeing the hands', () => {
  it('hands out of view: nothing counts and the miss says so', () => {
    const m: Motion = (t) => ({ ...turning(SWING)(t), hide: ['hands'] as const });
    const d = drive(createTwistDetector, m, { durationMs: 6000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)!.code).toBe('hands_out_of_view');
  });

  it('reset forgets the count, the sides and the miss', () => {
    const d = drive(createTwistDetector, turning(SWING), { durationMs: 6000 });
    expect(d.detector.channels!().reps).toBe(2);
    d.detector.reset();
    expect(d.detector.channels!().reps).toBe(0);
    expect(d.detector.channels!().rate).toBe(0);
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15])('two crossings at %i Hz are two reps, on the right sides', (hz) => {
    const r = replayMotion(turning(SWING), { detectors: [{ id: 'twist' }], durationMs: 6500, hz });
    expect(r.calibratedAt).not.toBeNull();
    const reps = r.events.filter((e) => e.kind === 'rep');
    expect(reps.map((e) => e.side)).toEqual(['R', 'L']);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'twist' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
