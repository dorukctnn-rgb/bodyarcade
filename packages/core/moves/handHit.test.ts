// M6 hand and foot targets: the detector's kinematic channels and the game side's HitTester, with hands and feet drawn
// by the rig (testing/rig.ts). Body space numbers: the right shoulder joint sits at (0.4, 1.0), the arm is 1.15 long.
import { describe, expect, it } from 'vitest';
import { createHandHitDetector, FLOOR_TOUCH, HitTester, padAt, reachEnvelope, type HitJudgement, type HitTarget } from './handHit.ts';
import { canExplain } from './kit.ts';
import { chAt, chMax, drive, replayMotion } from './testing/harness.ts';
import { handPaths, legs, pulse, slide } from './testing/motions.ts';
import { absentBetween, keyframes, profileOf, still, type Motion } from './testing/rig.ts';

const SHOULDER_R = { x: 0.4, y: 1 };

/** The right hand reaches (dx, dy) from its shoulder joint between t0 and t1 and stays; before that it hangs. */
const reachR = (dx: number, dy: number, t0 = 500, t1 = 900): Motion =>
  handPaths(undefined, (t) => ({ x: slide(t, t0, t1, 0.05, dx), y: slide(t, t0, t1, -1.1, dy) }));

function play(motion: Motion, targets: (t: number) => HitTarget[], durationMs: number, o: { opts?: Record<string, number>; tester?: HitTester } = {}) {
  const d = drive(createHandHitDetector, motion, { durationMs, ...(o.opts ? { opts: o.opts } : {}) });
  const tester = o.tester ?? new HitTester();
  const hits: HitJudgement[] = [];
  for (const s of d.samples) hits.push(...tester.update(s.ch, targets(s.t)));
  return { d, tester, hits };
}

const firstInside = (d: ReturnType<typeof drive>, tg: HitTarget, key = 'hand.R'): number =>
  d.samples.find((s) => Math.hypot((s.ch[`${key}.x`] ?? 1e9) - tg.x, (s.ch[`${key}.y`] ?? 1e9) - tg.y) <= tg.r)!.t;

describe('hand channels', () => {
  const d = drive(createHandHitDetector, handPaths(undefined, () => ({ x: 1.19, y: 0 })), { durationMs: 600 });

  it('publishes the hand centre in body space and relative to the shoulder midpoint in arm lengths', () => {
    expect(chAt(d, 'hand.R.x', 500)).toBeCloseTo(SHOULDER_R.x + 1.19, 1);
    expect(chAt(d, 'hand.R.y', 500)).toBeCloseTo(SHOULDER_R.y, 1);
    expect(chAt(d, 'hand.R.rx', 500)).toBeCloseTo((SHOULDER_R.x + 1.19) / 1.15, 1);
    expect(chAt(d, 'hand.R.ry', 500)).toBeCloseTo(0, 1);
    expect(chAt(d, 'hand.L.x', 500)).toBeCloseTo(-0.4, 1);
    expect(chAt(d, 'hand.L.y', 500)).toBeLessThan(-0.1);
    expect(chAt(d, 'hand.R.seen', 500)).toBe(1);
  });

  it('publishes the body numbers a game needs to place targets', () => {
    expect(chAt(d, 'body.a', 300)).toBeCloseTo(1.15, 2);
    expect(chAt(d, 'body.w', 300)).toBeCloseTo(0.8, 2);
    expect(chAt(d, 'body.sx', 300)).toBeCloseTo(0, 2);
    expect(chAt(d, 'body.sy', 300)).toBeCloseTo(1, 2);
    expect(chAt(d, 'drop', 300)).toBeCloseTo(0, 2);
    expect(chAt(d, 'hit.t', 300)).toBeGreaterThanOrEqual(300);
  });

  it('measures speed in arm lengths per second: a still hand is 0, a sweep is several', () => {
    const m = handPaths(undefined, (t) => ({ x: slide(t, 500, 800, 0.2, 1.2), y: 0 }));
    const s = drive(createHandHitDetector, m, { durationMs: 1500 });
    expect(chAt(s, 'hand.R.speed', 400)).toBeLessThan(0.1);
    expect(chMax(s, 'hand.R.speed', 500, 900)).toBeGreaterThan(3);
    expect(chMax(s, 'hand.R.speed', 500, 900)).toBeLessThan(5.5);
    expect(chMax(s, 'hand.R.vx', 500, 900)).toBeGreaterThan(3);
    expect(chAt(s, 'hand.R.speed', 1400)).toBeLessThan(0.1);
    expect(chMax(s, 'hand.L.speed')).toBeLessThan(0.1);
    expect(s.detector.value()).toBeLessThan(0.1);
  });

  it('feet only when asked, with the ankle height above the standing floor line', () => {
    expect(chAt(d, 'foot.L.x', 300)).toBe(0);
    const m = legs(pulse(1000, 0.9, 160, 400, 160), () => 0);
    const f = drive(createHandHitDetector, m, { durationMs: 2500, opts: { feet: 1 } });
    expect(chAt(f, 'foot.L.floor', 500)).toBeLessThan(0.02);
    expect(chMax(f, 'foot.L.floor', 1200, 1500)).toBeGreaterThan(0.8);
    expect(chMax(f, 'foot.R.floor')).toBeLessThan(0.02);
    expect(chAt(f, 'foot.L.seen', 500)).toBe(1);
    expect(chAt(f, 'foot.R.y', 500)).toBeCloseTo(-1.85, 1);
  });
});

describe('star catch: a hand inside the radius for 60 ms', () => {
  const star: HitTarget = { id: 1, x: SHOULDER_R.x + 0.9, y: SHOULDER_R.y + 0.5, r: 0.2, side: 'R', dwellMs: 60 };

  it('the right hand reaching the right-coloured star catches it once, after the dwell time', () => {
    const { d, hits } = play(reachR(0.9, 0.5), () => [star], 1500);
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect(h.side).toBe('R');
    expect(h.limb).toBe('hand');
    expect(h.dist).toBeLessThanOrEqual(0.2);
    expect(h.partial).toBe(false);
    expect(h.t - firstInside(d, star)).toBeGreaterThanOrEqual(60);
    expect(h.t).toBeLessThan(1100);
  });

  it('the wrong hand does not catch it, and the miss says which hand it needed', () => {
    const left: HitTarget = { ...star, side: 'L' };
    const { hits, tester } = play(reachR(0.9, 0.5), () => [left], 1500);
    expect(hits).toHaveLength(0);
    const miss = tester.explain(left)!;
    expect(miss.code).toBe('wrong_hand');
    expect(miss.side).toBe('L');
    expect(miss.target).toBe(1);
  });

  it('a star with no colour rule is caught by either hand', () => {
    const any: HitTarget = { ...star, side: undefined as never };
    delete (any as { side?: unknown }).side;
    const { hits } = play(reachR(0.9, 0.5), () => [any], 1500);
    expect(hits).toHaveLength(1);
  });

  it('a pass through the star that is shorter than the dwell time is too brief, with the contact time measured', () => {
    const slow: HitTarget = { ...star, dwellMs: 400 };
    const fly = handPaths(undefined, (t) => ({ x: slide(t, 500, 800, 0.2, 1.6), y: 0.5 }));
    const { hits, tester } = play(fly, () => [{ ...slow, x: SHOULDER_R.x + 0.9, y: SHOULDER_R.y + 0.5 }], 1500);
    expect(hits).toHaveLength(0);
    const miss = tester.explain(slow)!;
    expect(miss.code).toBe('too_brief');
    expect(miss.need).toBe(400);
    expect(miss.got!).toBeGreaterThan(0);
    expect(miss.got!).toBeLessThan(400);
  });

  it('a star out of reach is not reached, with the closest approach', () => {
    const far: HitTarget = { id: 2, x: 2.6, y: 0.4, r: 0.2, side: 'R', dwellMs: 60 };
    const { hits, tester } = play(reachR(0.9, 0.5), () => [far], 1500);
    expect(hits).toHaveLength(0);
    const miss = tester.explain(far)!;
    expect(miss.code).toBe('not_reached');
    expect(miss.got!).toBeGreaterThan(0.2);
    expect(miss.need).toBe(0.2);
  });

  it('an overhead star above the hand is "grab higher"', () => {
    const high: HitTarget = { id: 3, x: SHOULDER_R.x + 0.1, y: 2.3, r: 0.2, side: 'R', dwellMs: 60 };
    const { hits, tester } = play(reachR(0.1, 0.8), () => [high], 1500);
    expect(hits).toHaveLength(0);
    expect(tester.explain(high)!.code).toBe('grab_higher');
  });

  it('the same pose frame seen twice by a faster game step changes nothing', () => {
    const d = drive(createHandHitDetector, reachR(0.9, 0.5), { durationMs: 1500 });
    const tester = new HitTester();
    const hits: HitJudgement[] = [];
    for (const s of d.samples) for (let k = 0; k < 3; k++) hits.push(...tester.update(s.ch, [star]));
    expect(hits).toHaveLength(1);
    expect(tester.update({}, [star])).toEqual([]);
  });

  it('a hit target stays hit and is not judged again; forget clears what is known', () => {
    const { d, tester } = play(reachR(0.9, 0.5), () => [star], 1500);
    expect(tester.explain(star)).toBeNull();
    tester.forget(1);
    const again = d.samples.flatMap((s) => tester.update(s.ch, [star]));
    expect(again).toHaveLength(1);
  });

  it('hands out of view: nothing is hit, and the miss says the hands were not seen', () => {
    const m = (t: number) => ({ ...reachR(0.9, 0.5)(t), hide: ['hands' as const] });
    const { hits, tester } = play(m, () => [star], 1500);
    expect(hits).toHaveLength(0);
    expect(tester.explain(star)!.code).toBe('hands_out_of_view');
  });
});

describe('low stars ask for a squat', () => {
  it('a hit without the asked depth is partial; with the squat it is full', () => {
    // standing: the hanging hand reaches down to about -0.2
    const stand: HitTarget = { id: 1, x: 0.45, y: -0.15, r: 0.2, side: 'R', dwellMs: 60, needDrop: 0.3 };
    const a = play(handPaths(undefined, () => ({ x: 0.05, y: -1.15 })), () => [stand], 1200);
    expect(a.hits).toHaveLength(1);
    expect(a.hits[0]!.partial).toBe(true);
    // squatting 0.4: the shoulder is at about 0.55, the hand reaches the same star lower down
    const low: HitTarget = { ...stand, y: -0.5 };
    const squat = (t: number) => ({ drop: 0.4, ...handPaths(undefined, () => ({ x: 0.05, y: -1.05 }))(t) });
    const b = play(squat, () => [low], 1200);
    expect(b.hits).toHaveLength(1);
    expect(b.hits[0]!.partial).toBe(false);
  });
});

describe('pad work: a fast hand inside the pad', () => {
  const ch = { 'body.sx': 0, 'body.sy': 1, 'body.a': 1.15 };
  const pad = (ax: number, ay: number): HitTarget => ({ id: 1, ...padAt(ch, ax, ay), r: 0.2 * 1.15, side: 'R', minSpeed: 1.5 });

  it('padAt places a pad in arm lengths from the shoulder midpoint', () => {
    expect(padAt(ch, 1, 0)).toEqual({ x: 1.15, y: 1 });
    expect(padAt(ch, 0, 1)).toEqual({ x: 0, y: 1 + 1.15 });
    expect(padAt({}, 1, 1)).toEqual({ x: 1.15, y: 1 + 1.15 });
  });

  it('a punch lands the pad; the same position reached slowly does not', () => {
    const target = pad(1.0, 0);
    // punch: from the chest to a straight arm in 150 ms
    const punch = handPaths(undefined, (t) => ({ x: slide(t, 600, 750, -0.2, 1.19), y: 0 }));
    const p = play(punch, () => [target], 1500);
    expect(p.hits).toHaveLength(1);
    expect(p.hits[0]!.speed).toBeGreaterThanOrEqual(1.5);
    expect(p.hits[0]!.side).toBe('R');
    // drift: 3 s to get there
    const drift = handPaths(undefined, (t) => ({ x: slide(t, 300, 3300, -0.2, 1.19), y: 0 }));
    const s = play(drift, () => [target], 4000);
    expect(s.hits).toHaveLength(0);
    const miss = s.tester.explain(target)!;
    expect(miss.code).toBe('too_slow');
    expect(miss.need).toBe(1.5);
    expect(miss.got!).toBeLessThan(1.5);
  });

  it('a punch that stops short of the pad is not reached', () => {
    const target = pad(1.0, 0);
    const short = handPaths(undefined, (t) => ({ x: slide(t, 600, 750, -0.2, 0.3), y: 0 }));
    const r = play(short, () => [target], 1500);
    expect(r.hits).toHaveLength(0);
    expect(r.tester.explain(target)!.code).toBe('not_reached');
  });
});

describe('reaction tag: reaction time and feet on the floor', () => {
  it('the reaction time is the first contact minus the appearance minus the system latency', () => {
    const light: HitTarget = { id: 1, x: SHOULDER_R.x + 0.8, y: SHOULDER_R.y + 0.6, r: 0.15, shownAt: 1000 };
    const fly = reachR(0.8, 0.6, 1200, 1500);
    const { d, hits } = play(fly, () => [light], 2500, { tester: new HitTester({ latencyMs: 80 }) });
    expect(hits).toHaveLength(1);
    const first = firstInside(d, light);
    expect(hits[0]!.t).toBe(first);                      // no dwell: the first frame inside is the hit
    expect(hits[0]!.reactMs).toBeCloseTo(first - 1000 - 80, 6);
    expect(hits[0]!.reactMs!).toBeGreaterThan(250);
    expect(hits[0]!.reactMs!).toBeLessThan(700);
  });

  it('a foot slid onto the floor target counts; the radius is 0.35 W and the ankle must be near the floor', () => {
    const slideOut: Motion = (t) => ({ legL: { out: slide(t, 1000, 1300, 0, 0.6) } });
    const target: HitTarget = { id: 1, x: -0.875, y: -1.85, r: 0.35 * 0.8, limb: 'foot', side: 'L', floorOnly: true, shownAt: 800 };
    const { hits } = play(slideOut, () => [target], 2500, { opts: { feet: 1 } });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.limb).toBe('foot');
    expect(hits[0]!.side).toBe('L');
    expect(hits[0]!.reactMs!).toBeGreaterThan(0);
  });

  it('a foot held above the floor over the target is "foot not down", with its height', () => {
    const lifted: Motion = (t) => ({ legL: { k: 0.25, out: slide(t, 1000, 1300, 0, 0.6) } });
    const target: HitTarget = { id: 1, x: -0.875, y: -1.85, r: 0.4, limb: 'foot', side: 'L', floorOnly: true };
    const { hits, tester } = play(lifted, () => [target], 2500, { opts: { feet: 1 } });
    expect(hits).toHaveLength(0);
    const miss = tester.explain(target)!;
    expect(miss.code).toBe('foot_not_down');
    expect(miss.got!).toBeGreaterThan(FLOOR_TOUCH);
    expect(miss.need).toBe(FLOOR_TOUCH);
  });

  it('a hand target is not touched by a foot, and a foot target is not touched by a hand', () => {
    const slideOut: Motion = (t) => ({ legL: { out: slide(t, 1000, 1300, 0, 0.6) } });
    const handTarget: HitTarget = { id: 1, x: -0.875, y: -1.85, r: 0.3 };
    const r = play(slideOut, () => [handTarget], 2000, { opts: { feet: 1 } });
    expect(r.hits).toHaveLength(0);
  });
});

describe('the profile gives the reach envelope', () => {
  it('overhead is the calibrated hands-up height when there is one, torso plus arm otherwise', () => {
    const p = profileOf();
    expect(reachEnvelope(p).up).toBeCloseTo(1 + 1.15, 6);
    expect(reachEnvelope(p).side).toBeCloseTo(0.4 + 1.15, 6);
    expect(reachEnvelope({ ...p, reachY: p.rest.hipY - 2.0 * p.T }).up).toBeCloseTo(2.0, 6);
  });
});

describe('losing the person', () => {
  it('channels disappear after the person has been gone for a while, so no stale hand can hit', () => {
    const m = (t: number) => ({ ...reachR(0.9, 0.5)(t), ...absentBetween(1000, 2500)(t) });
    const d = drive(createHandHitDetector, m, { durationMs: 3000 });
    expect(Object.keys(d.detector.channels!())).not.toEqual([]);   // back again at the end
    expect(d.samples.find((s) => s.t > 1900 && s.t < 2400)!.ch).toEqual({});
    expect(new HitTester().update({}, [{ id: 1, x: 0, y: 0, r: 1 }])).toEqual([]);
  });

  it('reset forgets everything and the detector can explain hands out of view', () => {
    const d = drive(createHandHitDetector, (t) => ({ ...still()(t), hide: ['hands' as const] }), { durationMs: 1500 });
    if (!canExplain(d.detector)) throw new Error('must explain');
    expect(d.detector.explain()!.code).toBe('hands_out_of_view');
    d.detector.reset();
    expect(d.detector.channels!()).toEqual({});
    expect(d.detector.value()).toBeUndefined();
    expect(d.detector.explain()).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('a star reached by the right hand is one catch at %i Hz', (hz) => {
    const star: HitTarget = { id: 1, x: SHOULDER_R.x + 0.9, y: SHOULDER_R.y + 0.5, r: 0.2, side: 'R', dwellMs: 60 };
    const r = replayMotion(reachR(0.9, 0.5, 400, 800), { detectors: [{ id: 'handHit' }], durationMs: 2500, hz });
    expect(r.calibratedAt).not.toBeNull();
    const tester = new HitTester();
    const hits: HitJudgement[] = [];
    for (const s of r.samples) hits.push(...tester.update(s.channels, [star]));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.side).toBe('R');
  });

  it('a person standing still hits nothing and has near-zero hand speed', () => {
    const r = replayMotion(keyframes([[0, {}]]), { detectors: [{ id: 'handHit' }], durationMs: 4000 });
    const tester = new HitTester();
    let hits = 0, maxSpeed = 0;
    for (const s of r.samples) {
      hits += tester.update(s.channels, [{ id: 1, x: 0.4, y: 0.3, r: 0.15, dwellMs: 60 }]).length;
      maxSpeed = Math.max(maxSpeed, s.channels['hand.R.speed'] ?? 0, s.channels['hand.L.speed'] ?? 0);
    }
    expect(hits).toBe(0);
    expect(maxSpeed).toBeLessThan(0.6);
  });
});
