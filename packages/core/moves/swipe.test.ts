// M7 swipe trace, the SwipeTester (Slice Storm) and the joined-hands sword (Saber Guard), with hands drawn by the rig
// (testing/rig.ts): the shoulder joints sit at (-0.4, 1) and (0.4, 1), the arm is 1.15 long, 2.0 A per second is 2.3 T per
// second. Synthetic numbers show that the code does what the thresholds say.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { bladeBlocks, createSwipeDetector, distToSegment, SWIPE_DEFAULTS, SwipeTester, type SwipeCut, type SwipeObject } from './swipe.ts';
import { chAt, chMax, drive, pick, replayMotion } from './testing/harness.ts';
import { handPaths, slide } from './testing/motions.ts';
import { still, type Motion } from './testing/rig.ts';

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('swipe must explain');
  return d.detector.explain(ms);
};

/** The right hand moves along x (offset from its shoulder) from x0 to x1 at height y between t0 and t1 (smooth). */
const sweepR = (x0: number, x1: number, t0 = 1000, t1 = 1250, y = 0.2): Motion => handPaths(undefined, (t) => ({ x: slide(t, t0, t1, x0, x1), y }));
/** The same at a constant speed in T per second. */
const driftR = (x0: number, speed: number, t0 = 1000, y = 0.2): Motion => handPaths(undefined, (t) => ({ x: x0 + (speed * Math.max(0, t - t0)) / 1000, y }));

function play(motion: Motion, objects: (t: number) => SwipeObject[], durationMs: number, o: { opts?: Record<string, number> } = {}) {
  const d = drive(createSwipeDetector, motion, { durationMs, ...(o.opts ? { opts: o.opts } : {}) });
  const tester = new SwipeTester();
  const cuts: SwipeCut[] = [];
  for (const s of d.samples) cuts.push(...tester.update(s.ch, objects(s.t)));
  return { d, tester, cuts };
}

describe('the swipe segment', () => {
  const d = drive(createSwipeDetector, sweepR(-0.6, 1.0), { durationMs: 2000 });

  it('a fast sweep is a stroke: one hit event on that hand, in the direction it went', () => {
    const hits = pick(d.events, { kind: 'hit' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe('swipe');
    expect(hits[0]!.side).toBe('R');
    expect(Math.abs(hits[0]!.value!)).toBeLessThan(15);                // to the right: about 0 degrees
    expect(hits[0]!.q!.speed!).toBeGreaterThanOrEqual(SWIPE_DEFAULTS.minSpeed);
    expect(hits[0]!.t).toBeGreaterThan(1000);
    expect(hits[0]!.t).toBeLessThan(1250);
  });

  it('publishes the last 150 ms of the path as a segment, with speed, direction and stroke count', () => {
    const t = d.samples.find((s) => s.t >= 1130)!;
    const x0 = t.ch['swipe.R.x0']!, x1 = t.ch['swipe.R.x1']!, y0 = t.ch['swipe.R.y0']!, y1 = t.ch['swipe.R.y1']!;
    expect(x1).toBeGreaterThan(x0 + 0.3);
    expect(Math.abs(y1 - y0)).toBeLessThan(0.05);
    expect(t.ch['swipe.R.on']).toBe(1);
    expect(t.ch['swipe.R.speed']!).toBeGreaterThan(3);
    expect(t.ch['swipe.R.id']).toBe(1);
    expect(t.ch['swipe.R.seen']).toBe(1);
    expect(chAt(d, 'swipe.L.on', 1130)).toBe(0);
    expect(chAt(d, 'swipe.R.on', 500)).toBe(0);
    expect(chAt(d, 'swipe.R.on', 1800)).toBe(0);
    expect(chAt(d, 'body.a', 500)).toBeCloseTo(1.15, 2);
    expect(d.detector.value()).toBeLessThan(0.1);
    expect(chMax(d, 'swipe.R.speed')).toBeGreaterThan(3);
  });

  it('2.0 A per second is the line: 1.8 is a drift, 2.2 is a swipe', () => {
    const slow = drive(createSwipeDetector, driftR(-0.6, 1.8 * 1.15), { durationMs: 2000 });
    expect(chMax(slow, 'swipe.R.on', 1100)).toBe(0);
    expect(chMax(slow, 'swipe.R.speed', 1100)).toBeGreaterThan(1.6);
    expect(chMax(slow, 'swipe.R.speed', 1100)).toBeLessThan(2.0);
    const fast = drive(createSwipeDetector, driftR(-0.6, 2.2 * 1.15), { durationMs: 2000 });
    expect(chMax(fast, 'swipe.R.on', 1100)).toBe(1);
    expect(pick(fast.events, { kind: 'hit' })).toHaveLength(1);
  });

  it('two strokes are two hits, and the stroke counter follows', () => {
    const two: Motion = (t) => handPaths(undefined, (u) => ({ x: u < 2000 ? slide(u, 1000, 1250, -0.6, 1.0) : slide(u, 2000, 2250, 1.0, -0.6), y: 0.2 }))(t);
    const m = drive(createSwipeDetector, two, { durationMs: 3200 });
    const hits = pick(m.events, { kind: 'hit' });
    expect(hits).toHaveLength(2);
    expect(Math.abs(Math.abs(hits[1]!.value!) - 180)).toBeLessThan(15);          // back to the left
    expect(chAt(m, 'swipe.R.id', 3000)).toBe(2);
  });

  it('a hand out of view is not swiping', () => {
    const m: Motion = (t) => ({ ...sweepR(-0.6, 1.0)(t), hide: ['hands'] as const });
    const d2 = drive(createSwipeDetector, m, { durationMs: 2000 });
    expect(pick(d2.events, { kind: 'hit' })).toHaveLength(0);
    expect(why(d2)!.code).toBe('hands_out_of_view');
  });

  it('reset forgets the channels and the strokes', () => {
    const d3 = drive(createSwipeDetector, sweepR(-0.6, 1.0), { durationMs: 2000 });
    d3.detector.reset();
    expect(d3.detector.channels!()).toEqual({});
    expect(d3.detector.value()).toBeUndefined();
    expect(why(d3)).toBeNull();
  });
});

describe('cutting objects (Slice Storm)', () => {
  // the right hand path, in the world: x from 0.4 - 0.6 = -0.2 to 0.4 + 1.0 = 1.4, at y = 1.2
  const fruit = (id: number, x: number, o: Partial<SwipeObject> = {}): SwipeObject => ({ id, x, y: 1.2, r: 0.2, ...o });

  it('a swipe through the circle cuts it once, with the direction, the speed and the combo count', () => {
    const { cuts } = play(sweepR(-0.6, 1.0), () => [fruit(1, 0.7)], 2000);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.id).toBe(1);
    expect(cuts[0]!.side).toBe('R');
    expect(Math.abs(cuts[0]!.dir)).toBeLessThan(15);
    expect(cuts[0]!.speed).toBeGreaterThanOrEqual(2);
    expect(cuts[0]!.combo).toBe(1);
    expect(cuts[0]!.t).toBeGreaterThan(1000);
  });

  it('one stroke through several objects is a combo that counts up; a new stroke starts at one again', () => {
    const two: Motion = (t) => handPaths(undefined, (u) => ({ x: u < 2000 ? slide(u, 1000, 1250, -0.6, 1.0) : slide(u, 2000, 2250, 1.0, -0.6), y: 0.2 }))(t);
    const objs = (t: number): SwipeObject[] => (t < 1900 ? [fruit(1, 0.3), fruit(2, 0.8), fruit(3, 1.2)] : [fruit(4, 0.5)]);
    const { cuts } = play(two, objs, 3200);
    expect(cuts.map((c) => c.id)).toEqual([1, 2, 3, 4]);
    expect(cuts.map((c) => c.combo)).toEqual([1, 2, 3, 1]);
    expect(cuts[3]!.stroke).toBe(2);
  });

  it('an arrow must be followed to within 35 degrees: with the swipe the object is cut, against it the miss says wrong direction', () => {
    const right = play(sweepR(-0.6, 1.0), () => [fruit(1, 0.7, { dir: 0 })], 2000);
    expect(right.cuts).toHaveLength(1);
    const against = play(sweepR(-0.6, 1.0), () => [fruit(1, 0.7, { dir: 180 })], 2000);
    expect(against.cuts).toHaveLength(0);
    const miss = against.tester.explain(fruit(1, 0.7, { dir: 180 }))!;
    expect(miss.code).toBe('wrong_direction');
    expect(miss.need).toBe(35);
    expect(miss.got!).toBeGreaterThan(150);
    const side = play(sweepR(-0.6, 1.0), () => [fruit(1, 0.7, { dir: 40 })], 2000);
    expect(side.cuts).toHaveLength(0);                                  // 40 degrees off is outside 35
    expect(play(sweepR(-0.6, 1.0), () => [fruit(1, 0.7, { dir: 30 })], 2000).cuts).toHaveLength(1);
  });

  it('a slow hand through the circle does not cut: "too slow", with the speed it had', () => {
    const { cuts, tester } = play(driftR(-0.6, 1.0), () => [fruit(1, 0.7)], 3000);
    expect(cuts).toHaveLength(0);
    const miss = tester.explain(fruit(1, 0.7))!;
    expect(miss.code).toBe('too_slow');
    expect(miss.need).toBe(2);
    expect(miss.got!).toBeLessThan(2);
    expect(miss.got!).toBeGreaterThan(0.5);
  });

  it('an object off the path is not reached, with the closest approach', () => {
    const away = fruit(1, 0.7, { y: 2.2 });
    const { cuts, tester } = play(sweepR(-0.6, 1.0), () => [away], 2000);
    expect(cuts).toHaveLength(0);
    const miss = tester.explain(away)!;
    expect(miss.code).toBe('not_reached');
    expect(miss.got!).toBeGreaterThan(0.7);
    expect(miss.need).toBe(0.2);
  });

  it('the same pose frame seen twice changes nothing; a cut object is not cut again; forget and reset clear', () => {
    const d = drive(createSwipeDetector, sweepR(-0.6, 1.0), { durationMs: 2000 });
    const tester = new SwipeTester();
    const cuts: SwipeCut[] = [];
    for (const s of d.samples) for (let k = 0; k < 3; k++) cuts.push(...tester.update(s.ch, [fruit(1, 0.7)]));
    expect(cuts).toHaveLength(1);
    expect(tester.explain(fruit(1, 0.7))).toBeNull();
    tester.forget(1);
    expect(tester.update({}, [fruit(1, 0.7)])).toEqual([]);
    tester.reset();
    expect(tester.explain(fruit(1, 0.7))).toBeNull();
  });

  it('the two hands can swipe in turn: each cut says which hand', () => {
    const both: Motion = (t) => handPaths((u) => ({ x: slide(u, 2000, 2250, 0.6, -1.0), y: 0.2 }), (u) => ({ x: slide(u, 1000, 1250, -0.6, 1.0), y: 0.2 }))(t);
    const objs = (t: number): SwipeObject[] => (t < 1900 ? [fruit(1, 0.7)] : [fruit(2, -0.7)]);
    const { cuts } = play(both, objs, 3200);
    expect(cuts.map((c) => c.side)).toEqual(['R', 'L']);
  });
});

describe('geometry', () => {
  it('distToSegment is the distance to the nearest point of the segment, with ends included', () => {
    expect(distToSegment(1, 1, 0, 0, 2, 0)).toBeCloseTo(1, 9);
    expect(distToSegment(-1, 0, 0, 0, 2, 0)).toBeCloseTo(1, 9);
    expect(distToSegment(3, 0, 0, 0, 2, 0)).toBeCloseTo(1, 9);
    expect(distToSegment(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2, 9);
  });
});

describe('the joined-hands sword (Saber Guard)', () => {
  /** The joined hands at (cx, cy) in the world, with a small gap, for the whole motion. */
  const joined = (cx: (t: number) => number, cy: (t: number) => number, gap = 0.04): Motion =>
    handPaths((t) => ({ x: cx(t) - gap / 2 + 0.4, y: cy(t) - 1 }), (t) => ({ x: cx(t) + gap / 2 - 0.4, y: cy(t) - 1 }));
  const opts = { saber: 1 };

  it('hands together are a sword: on, with the blade pointing from the elbows through the hands', () => {
    const d = drive(createSwipeDetector, joined(() => 0, () => 1.3), { durationMs: 1000, opts });
    expect(chAt(d, 'saber.on', 800)).toBe(1);
    expect(chAt(d, 'saber.angle', 800)).toBeGreaterThan(60);
    expect(chAt(d, 'saber.angle', 800)).toBeLessThan(120);
    expect(chAt(d, 'saber.cx', 800)).toBeCloseTo(0, 1);
    expect(chAt(d, 'saber.cy', 800)).toBeCloseTo(1.3, 1);
    expect(chAt(d, 'saber.y', 800)).toBeGreaterThan(1.3 + 0.8);       // the tip is a full arm length beyond the hands
    expect(chAt(d, 'saber.travel', 800)).toBeLessThan(0.1);
  });

  it('hands apart are no sword', () => {
    const apart = drive(createSwipeDetector, still(), { durationMs: 800, opts });
    expect(chAt(apart, 'saber.on', 600)).toBe(0);
    const wide = drive(createSwipeDetector, joined(() => 0, () => 1.0, 0.5), { durationMs: 800, opts });
    expect(chAt(wide, 'saber.on', 600)).toBe(0);
    const off = drive(createSwipeDetector, joined(() => 0, () => 1.3), { durationMs: 800 });
    expect(chAt(off, 'saber.on', 600)).toBe(0);
    expect(Object.keys(off.detector.channels!()).some((k) => k.startsWith('saber.'))).toBe(false);
  });

  it('a slash of at least 0.9 A within 0.35 s is a cut, with its direction; the same path slowly is not', () => {
    const slash = (ms: number): Motion => joined((t) => slide(t, 1000, 1000 + ms, -0.3, 0.3), (t) => slide(t, 1000, 1000 + ms, 0.45, 1.45));
    const fast = drive(createSwipeDetector, slash(300), { durationMs: 2500, opts });
    const cuts = pick(fast.events, { kind: 'hit' }).filter((e) => e.side === undefined);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.value!).toBeGreaterThan(40);                       // up and to the right
    expect(cuts[0]!.value!).toBeLessThan(80);
    expect(cuts[0]!.q!.range!).toBeGreaterThanOrEqual(0.9);
    expect(chMax(fast, 'saber.travel', 1000, 1400)).toBeGreaterThan(0.9);
    const slow = drive(createSwipeDetector, slash(1800), { durationMs: 3500, opts });
    expect(pick(slow.events, { kind: 'hit' }).filter((e) => e.side === undefined)).toHaveLength(0);
  });

  it('a slash with the hands apart is "hands apart"', () => {
    const slash: Motion = (t) => ({ ...joined((u) => slide(u, 1000, 1300, -0.3, 0.3), (u) => slide(u, 1000, 1300, 0.45, 1.45), 0.6)(t) });
    const d = drive(createSwipeDetector, slash, { durationMs: 2500, opts });
    expect(pick(d.events, { kind: 'hit' }).filter((e) => e.side === undefined)).toHaveLength(0);
    expect(why(d)!.code).toBe('hands_apart');
  });

  it('a block: the blade on the line and the hands in the zone', () => {
    const d = drive(createSwipeDetector, joined(() => 0, () => 1.3), { durationMs: 1000, opts });
    const ch = d.samples.at(-1)!.ch;
    expect(bladeBlocks(ch, { angle: 90, x: 0, y: 1.3, r: 0.3 }).ok).toBe(true);
    expect(bladeBlocks(ch, { angle: 270, x: 0, y: 1.3, r: 0.3 }).ok).toBe(true);        // a blade is a line
    const wrongAngle = bladeBlocks(ch, { angle: 45, x: 0, y: 1.3, r: 0.3 });
    expect(wrongAngle.ok).toBe(false);
    expect(wrongAngle.miss).toMatchObject({ code: 'limb_off', limb: 'blade', need: 25 });
    expect(bladeBlocks(ch, { angle: 70, x: 0, y: 1.3, r: 0.3, tol: 30 }).ok).toBe(true);
    const wrongZone = bladeBlocks(ch, { angle: 90, x: 1.0, y: 0.5, r: 0.3 });
    expect(wrongZone.miss!.code).toBe('not_reached');
    expect(wrongZone.zoneError).toBeGreaterThan(1);
    expect(bladeBlocks({}, { angle: 90, x: 0, y: 1.3, r: 0.3 }).miss!.code).toBe('hands_apart');
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15])('a sweep of the right hand at %i Hz is one stroke that cuts the fruit', (hz) => {
    const r = replayMotion(sweepR(-0.6, 1.0, 500, 750), { detectors: [{ id: 'swipe' }], durationMs: 2500, hz });
    expect(r.calibratedAt).not.toBeNull();
    expect(r.events.filter((e) => e.kind === 'hit').map((e) => e.side)).toEqual(['R']);
    const tester = new SwipeTester();
    const cuts: SwipeCut[] = [];
    for (const s of r.samples) cuts.push(...tester.update(s.channels, [{ id: 1, x: 0.7, y: 1.2, r: 0.25 }]));
    expect(cuts).toHaveLength(1);
  });

  it('a person standing still has no strokes', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'swipe' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
