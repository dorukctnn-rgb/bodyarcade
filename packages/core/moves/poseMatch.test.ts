// M12 pose matching and the pose library, with whole-body poses drawn by the rig (testing/rig.ts). Synthetic numbers show
// that the code does what the thresholds say, not that the authored angles suit real bodies.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import {
  anglesFromChannels, createPoseMatchDetector, fitPose, limbAngles, LIMBS, POSE_MATCH_DEFAULTS, PoseWallJudge, type LimbAngles,
  type PoseWall, type WallJudgement,
} from './poseMatch.ts';
import { needsArms, needsLegs, POSE_NAMES, POSES, poseByName } from './poses.ts';
import { chAt, chMax, drive, pick, replayMotion } from './testing/harness.ts';
import { keyframes, simulate, still, type FigureSpec, type Motion } from './testing/rig.ts';

const T_POSE: FigureSpec = { armL: { a: 90, f: 90 }, armR: { a: 90, f: 90 } };
const HANDS_UP: FigureSpec = { armL: { a: 180, f: 180 }, armR: { a: 180, f: 180 } };
const idx = (name: string): number => POSE_NAMES.indexOf(name);
const tPose = poseByName('tPose')!;

/** Stand, then take `spec` between t0 and t1 and keep it. */
const takes = (spec: FigureSpec, t0 = 1000, t1 = 1300): Motion => keyframes([[t0, {}], [t1, spec]]);

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('pose match must explain');
  return d.detector.explain(ms);
};

const anglesOf = (spec: FigureSpec): LimbAngles => limbAngles(simulate(() => spec, { durationMs: 100 }).features.at(-1)!);

describe('the ten limb directions', () => {
  it('standing with the arms hanging: arms and legs down, torso and neck up', () => {
    const a = anglesOf({});
    for (const l of ['armUpperL', 'armUpperR', 'armLowerL', 'armLowerR', 'thighL', 'thighR', 'shinL', 'shinR'] as const) expect(a[l]).toBeCloseTo(-90, 0);
    expect(a.torso).toBeCloseTo(90, 0);
    expect(a.neck).toBeCloseTo(90, 0);
  });

  it('a T: the right arm points to screen right (0) and the left arm to screen left (180)', () => {
    const a = anglesOf(T_POSE);
    expect(a.armUpperR).toBeCloseTo(0, 0);
    expect(a.armLowerR).toBeCloseTo(0, 0);
    expect(Math.abs(a.armUpperL)).toBeCloseTo(180, 0);
    expect(Math.abs(a.armLowerL)).toBeCloseTo(180, 0);
  });

  it('hands up, a bend to the right and a bent elbow read as they look', () => {
    expect(anglesOf(HANDS_UP).armUpperR).toBeCloseTo(90, 0);
    const bend = anglesOf({ ...HANDS_UP, bend: 30 });
    expect(bend.torso).toBeCloseTo(60, 0);
    expect(bend.armUpperL).toBeCloseTo(60, 0);
    const cactus = anglesOf({ armL: { a: 90, f: 180 }, armR: { a: 90, f: 180 } });
    expect(cactus.armUpperR).toBeCloseTo(0, 0);
    expect(cactus.armLowerR).toBeCloseTo(90, 0);
    expect(cactus.armLowerL).toBeCloseTo(90, 0);
  });

  it('anglesFromChannels reads the published channels, and a missing limb reads as straight down', () => {
    const a = anglesFromChannels({ 'limb.torso': 80, 'limb.neck': 81 });
    expect(a.torso).toBe(80);
    expect(a.neck).toBe(81);
    expect(a.thighL).toBe(-90);
    expect(LIMBS).toHaveLength(10);
  });
});

describe('fitting one pose to one frame', () => {
  const exact: LimbAngles = { armUpperL: 180, armUpperR: 0, armLowerL: 180, armLowerR: 0, thighL: -90, thighR: -90, shinL: -90, shinR: -90, torso: 90, neck: 90 };

  it('an exact pose is similarity 1 and matched', () => {
    const f = fitPose(exact, tPose);
    expect(f.similarity).toBe(1);
    expect(f.matched).toBe(true);
    expect(f.worstError).toBe(0);
  });

  it('a limb off by 20 degrees still fits at 22, scores less than 1, and the miss names the worst limb at 25', () => {
    const near = fitPose({ ...exact, armUpperR: 20 }, tPose);
    expect(near.matched).toBe(true);
    expect(near.similarity).toBeLessThan(1);
    expect(near.similarity).toBeGreaterThan(0.95);
    const off = fitPose({ ...exact, armUpperR: 25 }, tPose);
    expect(off.matched).toBe(false);
    expect(off.worst).toBe('armUpperR');
    expect(off.worstError).toBe(25);
    expect(off.errors.armUpperR).toBe(25);
  });

  it('the tolerance is per level: 30 easy, 22 normal, 15 hard', () => {
    const ten = { ...exact, shinL: -100 };
    const eighteen = { ...exact, shinL: -108 };
    const twentyEight = { ...exact, shinL: -118 };
    expect(fitPose(eighteen, tPose, 15).matched).toBe(false);
    expect(fitPose(eighteen, tPose, 22).matched).toBe(true);
    expect(fitPose(twentyEight, tPose, 22).matched).toBe(false);
    expect(fitPose(twentyEight, tPose, 30).matched).toBe(true);
    expect(fitPose(ten, tPose, 15).matched).toBe(true);
  });

  it('directions wrap around: 179 and -179 are 2 degrees apart', () => {
    const f = fitPose({ ...exact, armUpperL: -179 }, tPose);
    expect(f.errors.armUpperL).toBe(1);
    expect(f.matched).toBe(true);
  });

  it('only the limbs the pose defines count (an upper body pose ignores the legs)', () => {
    const cactus = poseByName('cactus')!;
    const f = fitPose({ ...exact, armLowerR: 90, armLowerL: 90, thighL: 10, shinR: 45 }, cactus);
    expect(f.matched).toBe(true);
    expect(Object.keys(f.errors).sort()).toEqual(['armLowerL', 'armLowerR', 'armUpperL', 'armUpperR', 'neck', 'torso']);
    expect(fitPose(exact, { name: 'empty', limbs: {} }).matched).toBe(false);
  });
});

describe('the pose library', () => {
  it('has the front-readable poses, each with a name, and each fits itself exactly', () => {
    expect(POSES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(POSE_NAMES).size).toBe(POSES.length);
    for (const p of POSES) {
      const angles = { armUpperL: -90, armUpperR: -90, armLowerL: -90, armLowerR: -90, thighL: -90, thighR: -90, shinL: -90, shinR: -90, torso: 90, neck: 90, ...p.limbs } as LimbAngles;
      expect(fitPose(angles, p).similarity, p.name).toBe(1);
    }
  });

  it('no two poses can be fitted by the same body at the normal tolerance', () => {
    const full = (p: (typeof POSES)[number]): LimbAngles => ({ armUpperL: -90, armUpperR: -90, armLowerL: -90, armLowerR: -90, thighL: -90, thighR: -90, shinL: -90, shinR: -90, torso: 90, neck: 90, ...p.limbs }) as LimbAngles;
    for (const a of POSES) for (const b of POSES) {
      if (a === b || a.name === 'squatT' || b.name === 'squatT') continue;     // squatT is the T with a squat: depth tells them apart
      expect(fitPose(full(a), b).matched, `${a.name} as ${b.name}`).toBe(false);
    }
  });

  it('knows which poses need the legs and which are upper body poses (they work seated)', () => {
    expect(needsLegs(poseByName('tPose')!)).toBe(true);
    expect(needsLegs(poseByName('cactus')!)).toBe(false);
    expect(needsLegs(poseByName('squatT')!)).toBe(false);
    expect(needsArms(poseByName('tPose')!)).toBe(true);
    expect(poseByName('nope')).toBeUndefined();
    expect(poseByName('squatT')!.minDrop).toBeGreaterThan(0);
  });
});

describe('the detector with one pose to hold', () => {
  const opts = { pose: idx('tPose') };

  it('a T held for 0.3 s is a hold, with the similarity, and it ends when the arms come down', () => {
    const m = keyframes([[1000, {}], [1300, T_POSE], [2500, T_POSE], [2800, {}]]);
    const d = drive(createPoseMatchDetector, m, { durationMs: 3500, opts });
    const [start] = pick(d.events, { kind: 'holdStart' });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(1);
    expect(pick(d.events, { kind: 'holdEnd' })).toHaveLength(1);
    expect(start!.t).toBeGreaterThan(1500);
    expect(start!.t).toBeLessThan(1900);
    expect(start!.value!).toBeGreaterThan(0.95);
    expect(chAt(d, 'matched', 2000)).toBe(1);
    expect(chAt(d, 'similarity', 2000)).toBeGreaterThan(0.95);
    expect(chAt(d, 'matched', 3300)).toBe(0);
    expect(chMax(d, 'held', 1900, 2400)).toBeGreaterThan(300);
    expect(d.detector.value()).toBeCloseTo(0.6, 1);                  // arms down: the six other limbs still fit
  });

  it('publishes the ten limb channels with or without a target pose', () => {
    const d = drive(createPoseMatchDetector, takes(T_POSE), { durationMs: 2000 });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(d.detector.value()).toBeUndefined();
    expect(chAt(d, 'limb.armUpperR', 1800)).toBeCloseTo(0, 0);
    expect(chAt(d, 'limb.torso', 1800)).toBeCloseTo(90, 0);
    expect(chAt(d, 'pose.arms', 1800)).toBe(1);
    expect(chAt(d, 'pose.legs', 1800)).toBe(1);
    expect(chAt(d, 'pose.t', 1800)).toBeGreaterThanOrEqual(1800);
    expect(Object.keys(d.detector.channels!()).filter((k) => k.startsWith('limb.'))).toHaveLength(10);
  });

  it('the wrong pose is not a hold, and the miss names the limb furthest off', () => {
    const d = drive(createPoseMatchDetector, takes(HANDS_UP), { durationMs: 2500, opts });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    const miss = why(d)!;
    expect(miss.code).toBe('limb_off');
    expect(miss.limb).toMatch(/^armUpper|^armLower/);
    expect(miss.got!).toBeGreaterThan(60);
    expect(miss.need).toBe(POSE_MATCH_DEFAULTS.tol);
  });

  it('the tolerance is an option: an arm 25 degrees off fails at 22 and passes at 30', () => {
    const lowArm: FigureSpec = { armL: { a: 90, f: 90 }, armR: { a: 65, f: 65 } };    // the right arm 25 degrees below horizontal
    const normal = drive(createPoseMatchDetector, takes(lowArm), { durationMs: 2500, opts });
    expect(pick(normal.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(why(normal)!.limb).toMatch(/armUpperR|armLowerR/);
    const easy = drive(createPoseMatchDetector, takes(lowArm), { durationMs: 2500, opts: { ...opts, tol: 30 } });
    expect(pick(easy.events, { kind: 'holdStart' })).toHaveLength(1);
  });

  it('a squat variant also needs the depth: the arms alone are "hips not low"', () => {
    const o = { pose: idx('squatT') };
    const standing = drive(createPoseMatchDetector, takes(T_POSE), { durationMs: 2500, opts: o });
    expect(pick(standing.events, { kind: 'holdStart' })).toHaveLength(0);
    const miss = why(standing)!;
    expect(miss.code).toBe('hips_not_low');
    expect(miss.need).toBe(0.35);
    const squatting = drive(createPoseMatchDetector, takes({ ...T_POSE, drop: 0.5 }), { durationMs: 2500, opts: o });
    expect(pick(squatting.events, { kind: 'holdStart' })).toHaveLength(1);
  });

  it('an upper body pose works with the legs out of view; a whole body pose does not', () => {
    const hidden = (spec: FigureSpec): Motion => (t) => ({ ...takes(spec)(t), hide: ['knees', 'ankles', 'feet'] as const });
    const cactus: FigureSpec = { armL: { a: 90, f: 180 }, armR: { a: 90, f: 180 } };
    const up = drive(createPoseMatchDetector, hidden(cactus), { durationMs: 2500, opts: { pose: idx('cactus') } });
    expect(pick(up.events, { kind: 'holdStart' })).toHaveLength(1);
    const whole = drive(createPoseMatchDetector, hidden(T_POSE), { durationMs: 2500, opts });
    expect(pick(whole.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(why(whole)!.code).toBe('knees_out_of_view');
  });

  it('hands out of view: no hold, and the miss says so', () => {
    const m: Motion = (t) => ({ ...takes(T_POSE)(t), hide: ['hands'] as const });
    const d = drive(createPoseMatchDetector, m, { durationMs: 2500, opts });
    expect(pick(d.events, { kind: 'holdStart' })).toHaveLength(0);
    expect(why(d)!.code).toBe('hands_out_of_view');
  });

  it('reset forgets the channels and the hold', () => {
    const d = drive(createPoseMatchDetector, takes(T_POSE), { durationMs: 2500, opts });
    d.detector.reset();
    expect(d.detector.channels!()).toEqual({});
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('a wall to fit (Pose Wall)', () => {
  const wall = (o: Partial<PoseWall> = {}): PoseWall => ({ id: 1, pose: tPose, dueAt: 2000, ...o });

  function run(motion: Motion, walls: (t: number) => PoseWall[], durationMs = 2600, opts?: Record<string, number>) {
    const d = drive(createPoseMatchDetector, motion, { durationMs, ...(opts ? { opts } : {}) });
    const judge = new PoseWallJudge();
    const passes: WallJudgement[] = [];
    for (const s of d.samples) passes.push(...judge.update(s.ch, walls(s.t)));
    return { d, judge, passes };
  }

  it('a pose held for 0.3 s within the 0.8 s before the wall passes it, with the similarity and the hold', () => {
    const { passes, judge } = run(takes(T_POSE, 1000, 1300), () => [wall()]);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.id).toBe(1);
    expect(passes[0]!.t).toBeGreaterThan(1450);
    expect(passes[0]!.t).toBeLessThan(1800);
    expect(passes[0]!.similarity).toBeGreaterThan(0.95);
    expect(passes[0]!.heldMs).toBeGreaterThanOrEqual(300);
    const r = judge.result(wall());
    expect(r.passed).toBe(true);
    expect(r.fit).toBeGreaterThan(0.95);
    expect(judge.explain(wall())).toBeNull();
  });

  it('a pose taken only 100 ms before the wall is "held too short", and the wall still scores its fit', () => {
    const { passes, judge } = run(takes(T_POSE, 1700, 1850), () => [wall()]);
    expect(passes).toHaveLength(0);
    const r = judge.result(wall());
    expect(r.passed).toBe(false);
    expect(r.fit).toBeGreaterThan(0.9);
    expect(r.heldMs).toBeLessThan(300);
    const miss = judge.explain(wall())!;
    expect(miss.code).toBe('held_too_short');
    expect(miss.need).toBe(300);
    expect(miss.got!).toBeLessThan(300);
  });

  it('a pose held only before the 0.8 s window does not count', () => {
    const early = keyframes([[500, {}], [700, T_POSE], [1100, T_POSE], [1300, {}]]);
    const { passes, judge } = run(early, () => [wall()]);
    expect(passes).toHaveLength(0);
    expect(judge.result(wall()).heldMs).toBe(0);
  });

  it('the wrong pose names the limb furthest off', () => {
    const { passes, judge } = run(takes(HANDS_UP, 500, 800), () => [wall()]);
    expect(passes).toHaveLength(0);
    const miss = judge.explain(wall())!;
    expect(miss.code).toBe('limb_off');
    expect(miss.limb).toMatch(/^arm/);
    expect(miss.got!).toBeGreaterThan(60);
    expect(miss.target).toBe(1);
    expect(judge.result(wall()).fit).toBeLessThan(0.9);
  });

  it('a harder wall (15 degrees) refuses what a normal one (22) takes', () => {
    const slightlyOff: FigureSpec = { armL: { a: 90, f: 90 }, armR: { a: 72, f: 72 } };   // the right arm 18 degrees low
    expect(run(takes(slightlyOff, 500, 800), () => [wall()]).passes).toHaveLength(1);
    expect(run(takes(slightlyOff, 500, 800), () => [wall({ tol: 15 })]).passes).toHaveLength(0);
  });

  it('a squat wall needs the depth, and says the hips were not low', () => {
    const squatWall = wall({ pose: poseByName('squatT')! });
    const high = run(takes(T_POSE, 500, 800), () => [squatWall]);
    expect(high.passes).toHaveLength(0);
    expect(high.judge.explain(squatWall)!.code).toBe('hips_not_low');
    const low = run(takes({ ...T_POSE, drop: 0.5 }, 500, 800), () => [squatWall]);
    expect(low.passes).toHaveLength(1);
  });

  it('a whole body wall with the legs out of view says so; an upper body wall does not mind', () => {
    const noLegs = (spec: FigureSpec): Motion => (t) => ({ ...takes(spec, 500, 800)(t), hide: ['knees', 'ankles', 'feet'] as const });
    const whole = run(noLegs(T_POSE), () => [wall()]);
    expect(whole.passes).toHaveLength(0);
    expect(whole.judge.explain(wall())!.code).toBe('knees_out_of_view');
    const cactusSpec: FigureSpec = { armL: { a: 90, f: 180 }, armR: { a: 90, f: 180 } };
    const upper = run(noLegs(cactusSpec), () => [wall({ pose: poseByName('cactus')! })]);
    expect(upper.passes).toHaveLength(1);
  });

  it('two walls in a row are judged in their own windows', () => {
    const m = keyframes([[500, {}], [800, T_POSE], [2400, T_POSE], [2700, HANDS_UP], [4500, HANDS_UP]]);
    const walls = (_t: number): PoseWall[] => [wall({ id: 1, dueAt: 2000 }), wall({ id: 2, dueAt: 4000, pose: poseByName('handsUp')! })];
    const { passes } = run(m, walls, 4600);
    expect(passes.map((p) => p.id)).toEqual([1, 2]);
  });

  it('the same pose frame seen twice changes nothing; forget and reset clear what is known', () => {
    const d = drive(createPoseMatchDetector, takes(T_POSE, 500, 800), { durationMs: 2600 });
    const judge = new PoseWallJudge();
    const passes: WallJudgement[] = [];
    for (const s of d.samples) for (let k = 0; k < 3; k++) passes.push(...judge.update(s.ch, [wall()]));
    expect(passes).toHaveLength(1);
    judge.forget(1);
    expect(judge.result(wall())).toEqual({ passed: false, fit: 0, heldMs: 0 });
    expect(judge.update({}, [wall()])).toEqual([]);
    judge.reset();
    expect(judge.explain(wall())).toBeNull();
  });

  it('a frame that does not say the arms were seen counts as arms out of view, and a wall never in play has nothing to explain', () => {
    const judge = new PoseWallJudge();
    expect(judge.update({ 'pose.t': 1500 }, [wall()])).toEqual([]);
    expect(judge.explain(wall())!.code).toBe('hands_out_of_view');
    expect(new PoseWallJudge().explain(wall())).toBeNull();
    expect(new PoseWallJudge().result(wall())).toEqual({ passed: false, fit: 0, heldMs: 0 });
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('a T held for a second at %i Hz is one hold', (hz) => {
    const m = keyframes([[500, {}], [800, T_POSE], [2200, T_POSE], [2500, {}]]);
    const r = replayMotion(m, { detectors: [{ id: 'poseMatch', opts: { pose: idx('tPose') } }], durationMs: 4000, hz });
    expect(r.calibratedAt).not.toBeNull();
    expect(r.events.filter((e) => e.kind === 'holdStart')).toHaveLength(1);
    expect(r.events.filter((e) => e.kind === 'holdEnd')).toHaveLength(1);
  });

  it('a person standing still holds no pose', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'poseMatch', opts: { pose: idx('tPose') } }], durationMs: 4000 });
    expect(r.events).toEqual([]);
  });
});
