// Form coach, Faz 4 (floor moves): every move counts its own movement on a test body (testing/pose.ts: bodies from joint directions),
// the rules fire on the faults they are written for, holds run their clock, and standing or resting is not counted. These prove the
// logic; accuracy on real people is form.real.test.ts.
import { describe, expect, it } from 'vitest';
import { createFormCoach } from './coach.ts';
import { FORM_MOVES } from './moves/index.ts';
import { FAR_RIGHT, hold, lifted, reps, sideBridge, sidePushUp, type Joints } from './testing/body.ts';
import { STAND, between, elbowFor, fromChain, lerp, moved, sidePose, sideThrust, type SideSpec, type XY } from './testing/pose.ts';
import type { CoachState, FormMoveId } from './types.ts';
import type { PoseFrame } from '../types/index.ts';

function run(move: FormMoveId, frames: PoseFrame[]) {
  const c = createFormCoach(move);
  const states: CoachState[] = frames.map((f) => c.push(f));
  return { states, last: states.at(-1)!, summary: c.summary(), reps: states.flatMap((s) => (s.repDone ? [s.repDone] : [])), cues: new Set(states.flatMap((s) => (s.cue ? [s.cue] : []))) };
}
const side = { far: FAR_RIGHT } as const;
const clean = (r: ReturnType<typeof run>): boolean => r.reps.every((x) => x.clean);

// lying on the back, head to the left, knees bent, feet on the floor
const LYING: SideSpec = { hip: [0.9, 0.82], torso: -90, thigh: 135, shin: 45, uarm: 90, farm: 90 };
const FLAT: SideSpec = { ...LYING, thigh: 90, shin: 90 };
// on hands and knees facing right (toes point back), arms hanging straight down
const QUAD: SideSpec = { hip: [0.5, 0.7], torso: 90, thigh: 0, shin: -90, uarm: 0, farm: 0, foot: -1 };
// a high plank facing right: the line from the shoulder down to the ankle, arms straight
const PLANK: SideSpec = { hip: [0.5, 0.7], torso: 105, thigh: -75, shin: -75, uarm: 0, farm: 0 };
const FOREARM: SideSpec = { ...PLANK, uarm: 0, farm: 90 };

describe('the floor catalogue', () => {
  it('count-only and time-only moves offer no live form rule; held moves hold', () => {
    for (const id of Object.keys(FORM_MOVES) as FormMoveId[]) {
      const m = FORM_MOVES[id];
      if (m.group !== 'floor') continue;
      if (m.label === 'S' || m.label === 'T') expect(m.rules.filter((r) => r.kind === 'live'), id).toHaveLength(0);
      if (m.label === 'H' || m.label === 'T') expect(m.hold, id).toBeTruthy();
    }
  });
});

/** Standing at a wall, hands on it at shoulder height, leaning in (u 0 arms straight, 1 elbows about 100 degrees). */
function sideWall(u: number, shallow = 1): Joints {
  const a = (10 + 5 * u * shallow) * (Math.PI / 180), ankle: XY = [0.78, 0.93];
  const hip: XY = [ankle[0] + 0.38 * Math.sin(a), ankle[1] - 0.38 * Math.cos(a)], sh: XY = [hip[0] + 0.24 * Math.sin(a), hip[1] - 0.24 * Math.cos(a)];
  const rest = 10 * (Math.PI / 180), wr: XY = [ankle[0] + 0.62 * Math.sin(rest) + 0.23, ankle[1] - 0.62 * Math.cos(rest)];
  return fromChain({ sh, elbow: elbowFor(sh, wr, 1), wrist: wr, hip, knee: [(hip[0] + ankle[0]) / 2, (hip[1] + ankle[1]) / 2], ankle, head: [sh[0] + 0.05, sh[1] - 0.08] });
}

/** Pike: hips high, hands and feet fixed; the shoulders come down to the hands (u 0 arms straight, 1 elbows bent). */
function sidePike(u: number): Joints {
  const wr: XY = [0.3, 0.88], hip: XY = [0.62, 0.52], ankle: XY = [0.92, 0.88], sh: XY = [lerp(0.362, 0.4, u), lerp(0.658, 0.77, u)];
  return fromChain({ sh, elbow: elbowFor(sh, wr, -1), wrist: wr, hip, knee: [0.77, 0.7], ankle, head: [sh[0] - 0.08, sh[1] + 0.04] });
}

/** A chair dip from the side facing right: hands fixed behind the hips, the shoulders drop (u 0 arms straight, 1 elbows about 90). */
function sideDip(u: number, depth = 0.065): Joints {
  const wr: XY = [0.62, 0.63], sh: XY = [0.62, 0.4 + depth * u], hip: XY = [0.7, sh[1] + 0.2];
  return fromChain({ sh, elbow: elbowFor(sh, wr, 1), wrist: wr, hip, knee: [0.89, hip[1] - 0.03], ankle: [0.9, 0.88], head: [sh[0] + 0.03, sh[1] - 0.09] });
}

describe('every Faz 4 move counts its own movement on a test body', () => {
  const cases: [FormMoveId, PoseFrame[], number][] = [
    ['singleLegBridge', reps(3, (u) => sideBridge(u), side), 3],
    ['hipThrust', reps(3, (u) => sideThrust(u), side), 3],
    ['superman', reps(3, (u) => between({ hip: [0.9, 0.82], torso: -90, thigh: 90, shin: 90, uarm: -90, farm: -90 }, { hip: [0.9, 0.82], torso: -105, thigh: 105, shin: 105, uarm: -105, farm: -105 }, u), { ...side, repMs: 2500 }), 3],
    ['birdDog', reps(3, (u) => between(QUAD, { ...QUAD, thigh: -90, shin: -90, uarm: 90, farm: 90 }, u), { ...side, repMs: 2500 }), 3],
    ['donkeyKick', reps(3, (u) => between(QUAD, { ...QUAD, thigh: -85, shin: 180 }, u), { ...side, repMs: 1500 }), 3],
    ['kneePushUp', reps(3, (u) => sidePushUp(u), side), 3],
    ['inclinePushUp', reps(3, (u) => sidePushUp(u), side), 3],
    ['declinePushUp', reps(3, (u) => sidePushUp(u), side), 3],
    ['widePushUp', reps(3, (u) => sidePushUp(u), side), 3],
    ['diamondPushUp', reps(3, (u) => sidePushUp(u), side), 3],
    ['wallPushUp', reps(3, (u) => sideWall(u), { ...side, repMs: 2000 }), 3],
    ['pikePushUp', reps(3, (u) => sidePike(u), side), 3],
    ['tricepsDip', reps(3, (u) => sideDip(u), { ...side, repMs: 2200 }), 3],
    ['crunch', reps(3, (u) => between(LYING, { ...LYING, torso: -120 }, u), side), 3],
    ['sitUp', reps(3, (u) => between(LYING, { ...LYING, torso: -170 }, u), { ...side, repMs: 2500 }), 3],
    ['legRaise', reps(3, (u) => between(FLAT, { ...FLAT, thigh: 172, shin: 172 }, u), { ...side, repMs: 2600 }), 3],
    ['reverseCrunch', reps(3, (u) => lifted(sidePose(LYING), 0.06 * u), { ...side, repMs: 1800 }), 3],
    ['vUp', reps(3, (u) => between(FLAT, { ...FLAT, torso: -160, thigh: 170, shin: 170 }, u), { ...side, repMs: 2200 }), 3],
  ];
  for (const [move, frames, n] of cases) {
    it(`${move}: ${n} repetitions`, () => {
      const r = run(move, frames);
      expect(r.reps, move).toHaveLength(n);
    });
  }

  it('the push-up variants share the push-up: a clean repetition each, and their cards name the chair', () => {
    for (const id of ['kneePushUp', 'widePushUp', 'diamondPushUp'] as const) expect(clean(run(id, reps(3, (u) => sidePushUp(u), side))), id).toBe(true);
    expect(FORM_MOVES.inclinePushUp.equipment).toEqual(['chair']);
    expect(FORM_MOVES.declinePushUp.equipment).toEqual(['chair']);
  });

  it('alternating legs: bicycle crunch, dead bug and mountain climber count each leg on its own', () => {
    const BIC: SideSpec = { ...LYING, thigh: 100, shin: 100 };
    const bic = run('bicycleCrunch', reps(6, (u, i) => between(BIC, { ...BIC, thigh: i % 2 ? 100 : 190, shin: i % 2 ? 100 : 120, far: { thigh: i % 2 ? 190 : 100, shin: i % 2 ? 120 : 100 } }, u), { repMs: 800, restMs: 120 }));
    expect(bic.reps).toHaveLength(6);
    expect(bic.summary.sides).toEqual({ L: 3, R: 3 });
    const DEAD: SideSpec = { ...LYING, thigh: 180, shin: 90 };
    const dead = run('deadBug', reps(4, (u, i) => between(DEAD, { ...DEAD, thigh: i % 2 ? 180 : 110, shin: i % 2 ? 90 : 110, far: { thigh: i % 2 ? 110 : 180, shin: i % 2 ? 110 : 90 } }, u), { repMs: 1500 }));
    expect(dead.reps).toHaveLength(4);
    expect(dead.summary.sides).toEqual({ L: 2, R: 2 });
    const climb = (knee: number) => run('mountainClimber', reps(8, (u, i) => between(PLANK, { ...PLANK, thigh: i % 2 ? -75 : knee, shin: i % 2 ? -75 : -60, far: { thigh: i % 2 ? knee : -75, shin: i % 2 ? -60 : -75 } }, u), { repMs: 500, restMs: 60 }));
    const full = climb(25);
    expect(full.reps).toHaveLength(8);
    expect(full.summary.sides).toEqual({ L: 4, R: 4 });
    expect(full.reps.every((x) => x.clean)).toBe(true);
    // a half-way knee still counts but is not all the way in: a tip, not a failure
    const half = climb(-20);
    expect(half.reps.length).toBeGreaterThan(0);
    expect(half.reps.every((x) => x.tips.includes('climber.knee'))).toBe(true);
  });

  it('plank shoulder tap counts a hand leaving the floor, and a sagging body line is an error', () => {
    const tapUp = (u: number): Joints => moved(sidePose(PLANK), { leftWrist: [0.02 * u, -0.17 * u] });
    const r = run('plankShoulderTap', reps(4, tapUp, { ...side, repMs: 900 }));
    expect(r.reps).toHaveLength(4);
    const sag = run('plankShoulderTap', reps(3, (u) => moved(tapUp(u), { leftHip: [0, 0.08], leftKnee: [0, 0.04] }), { ...side, repMs: 900 }));
    expect(sag.cues.has('pushUp.hipsUp')).toBe(true);
  });

  it('russian twist counts each turn of the shoulders', () => {
    const twist = (u: number): Joints => {
      const j = sidePose({ hip: [0.89, 0.6], torso: 180, thigh: 90, shin: 90, uarm: 0, farm: 0 });
      const w = 0.085 * (1 - 0.35 * u);
      return { ...j, leftShoulder: [0.89 - w, 0.36], rightShoulder: [0.89 + w, 0.36], leftHip: [0.845, 0.6], rightHip: [0.935, 0.6] };
    };
    expect(run('russianTwist', reps(5, twist, { repMs: 900 })).reps).toHaveLength(5);
    expect(run('dbRussianTwist', reps(5, twist, { repMs: 900 })).reps).toHaveLength(5);
  });

  it('toe touch counts the hand coming to the foot', () => {
    const base: SideSpec = { hip: [0.9, 0.82], torso: -90, thigh: 180, shin: 180, uarm: 90, farm: 90 };
    const pose = (u: number): Joints => {
      const j = sidePose(base), a = j.leftAnkle!, w = j.leftWrist!;
      return { ...j, leftWrist: [lerp(w[0], a[0], u), lerp(w[1], a[1] + 0.02, u)], rightWrist: [lerp(w[0], a[0], u), lerp(w[1], a[1] + 0.02, u)] };
    };
    expect(run('toeTouch', reps(3, pose, { ...side, repMs: 1800 })).reps).toHaveLength(3);
  });
});

describe('the rules of the floor moves', () => {
  it('sit-up: coming all the way up is clean, stopping half way is an error and a cue', () => {
    const full = run('sitUp', reps(3, (u) => between(LYING, { ...LYING, torso: -170 }, u), { ...side, repMs: 2500 }));
    expect(clean(full)).toBe(true);
    const half = run('sitUp', reps(3, (u) => between(LYING, { ...LYING, torso: -135 }, u), { ...side, repMs: 2500 }));
    expect(half.reps.length).toBeGreaterThan(0);
    expect(half.reps.every((x) => x.errors.includes('situp.top'))).toBe(true);
  });

  it('leg raise: bent knees and low legs are tips (the repetition stays clean)', () => {
    const good = run('legRaise', reps(3, (u) => between(FLAT, { ...FLAT, thigh: 172, shin: 172 }, u), { ...side, repMs: 2600 }));
    expect(good.reps.every((x) => x.clean && x.tips.length === 0)).toBe(true);
    const bent = run('legRaise', reps(3, (u) => between(FLAT, { ...FLAT, thigh: 172, shin: 120 }, u), { ...side, repMs: 2600 }));
    expect(bent.reps.every((x) => x.clean && x.tips.includes('legRaise.knees'))).toBe(true);
    const low = run('legRaise', reps(3, (u) => between(FLAT, { ...FLAT, thigh: 140, shin: 140 }, u), { ...side, repMs: 2600 }));
    expect(low.reps.every((x) => x.tips.includes('legRaise.top'))).toBe(true);
  });

  it('chair dip: low enough is clean, a shallow dip is an error', () => {
    expect(clean(run('tricepsDip', reps(3, (u) => sideDip(u), { ...side, repMs: 2200 })))).toBe(true);
    const shallow = run('tricepsDip', reps(3, (u) => sideDip(u, 0.045), { ...side, repMs: 2200 }));
    expect(shallow.reps.length).toBeGreaterThan(0);
    expect(shallow.reps.every((x) => x.errors.includes('dip.depth'))).toBe(true);
  });

  it('wall push-up: close to the wall is clean, a shallow lean is an error', () => {
    expect(clean(run('wallPushUp', reps(3, (u) => sideWall(u), { ...side, repMs: 2000 })))).toBe(true);
    const shallow = run('wallPushUp', reps(3, (u) => sideWall(u, 0.5), { ...side, repMs: 2000 }));
    expect(shallow.reps.length).toBeGreaterThan(0);
    expect(shallow.reps.every((x) => x.errors.includes('wallPush.depth'))).toBe(true);
  });

  it('bird dog: reaching with the arm only counts but is a tip; the back out of level is a tip', () => {
    const arm = run('birdDog', reps(3, (u) => between(QUAD, { ...QUAD, uarm: 90, farm: 90 }, u), { ...side, repMs: 2500 }));
    expect(arm.reps).toHaveLength(3);
    expect(arm.reps.every((x) => x.clean && x.tips.includes('bird.top'))).toBe(true);
    const sag = run('birdDog', reps(3, (u) => between(QUAD, { ...QUAD, thigh: -90, shin: -90, uarm: 90, farm: 90, torso: 65 }, u), { ...side, repMs: 2500 }));
    expect(sag.reps.some((x) => x.tips.includes('bird.level'))).toBe(true);
  });
});

describe('holds: plank, high plank and the time-only holds', () => {
  const standing = (): Joints => sidePose(STAND);

  it('a forearm plank runs the clock; sagging hips stop it and are the top error', () => {
    const good = run('plank', [...hold(1500, standing, side), ...hold(4500, () => sidePose(FOREARM), { ...side, t0: 1534 })]);
    expect(good.last.holdMs).toBeGreaterThan(3600);
    expect(good.reps).toHaveLength(0);
    const sag = run('plank', [
      ...hold(1500, standing, side),
      ...hold(2000, () => sidePose(FOREARM), { ...side, t0: 1534 }),
      ...hold(2500, () => moved(sidePose(FOREARM), { leftHip: [0, 0.08], leftKnee: [0, 0.04], rightHip: [0, 0.08], rightKnee: [0, 0.04] }), { ...side, t0: 3567 }),
    ]);
    expect(sag.last.holdMs).toBeLessThan(2400);
    expect(sag.summary.top?.id).toBe('plank.line');
    expect(sag.states.some((s) => s.segments.torso === 'bad')).toBe(true);
  });

  it('a high plank runs the clock only with the arms straight', () => {
    const arms = run('highPlank', [...hold(1500, standing, side), ...hold(4000, () => sidePose(PLANK), { ...side, t0: 1534 })]);
    expect(arms.last.holdMs).toBeGreaterThan(3000);
    const forearms = run('highPlank', [...hold(1500, standing, side), ...hold(4000, () => sidePose(FOREARM), { ...side, t0: 1534 })]);
    expect(forearms.last.holdMs).toBe(0);
  });

  it('time-only holds: side plank, hollow hold, bear hold and flutter kicks run while in position, not standing', () => {
    const sidePlank = (): Joints => ({
      nose: [0.2, 0.55], leftEar: [0.22, 0.56], rightEar: [0.22, 0.56], leftShoulder: [0.3, 0.58], rightShoulder: [0.31, 0.64], leftElbow: [0.31, 0.78], rightElbow: [0.32, 0.8], leftWrist: [0.4, 0.8], rightWrist: [0.41, 0.82],
      leftHip: [0.55, 0.7], rightHip: [0.56, 0.74], leftKnee: [0.72, 0.74], rightKnee: [0.73, 0.78], leftAnkle: [0.88, 0.78], rightAnkle: [0.89, 0.8], leftHeel: [0.87, 0.79], rightHeel: [0.88, 0.81], leftFootIndex: [0.92, 0.79], rightFootIndex: [0.93, 0.81],
    });
    const noFar = {} as const;
    const cases: [FormMoveId, () => Joints, typeof side | typeof noFar][] = [
      ['sidePlank', sidePlank, noFar],
      ['hollowHold', () => sidePose({ hip: [0.9, 0.82], torso: -105, thigh: 105, shin: 105, uarm: -105, farm: -105 }), side],
      ['bearHold', () => sidePose({ hip: [0.55, 0.66], torso: 90, thigh: 0, shin: -90, uarm: 0, farm: 0, foot: -1 }), side],
      ['flutterKicks', () => sidePose({ ...LYING, thigh: 105, shin: 105 }), side],
    ];
    for (const [move, pose, o] of cases) {
      const held = run(move, [...hold(1500, standing, o), ...hold(4000, pose, { ...o, t0: 1534 })]);
      expect(held.last.holdMs, move).toBeGreaterThan(3000);
      expect(run(move, hold(4000, standing, o)).last.holdMs, `${move} standing`).toBe(0);
    }
  });
});

describe('nothing floor-like counts while standing or walking about', () => {
  it('a person standing still counts no repetition in any floor move', () => {
    for (const id of Object.keys(FORM_MOVES) as FormMoveId[]) {
      if (FORM_MOVES[id].group !== 'floor') continue;
      const r = run(id, hold(4000, () => sidePose(STAND), side));
      expect(r.reps, id).toHaveLength(0);
      expect(r.last.holdMs, id).toBe(0);
    }
  });
});

describe('stretching: time only, the clock runs while the person holds still in view', () => {
  const ids = (Object.keys(FORM_MOVES) as FormMoveId[]).filter((id) => FORM_MOVES[id].group === 'stretch');
  it('all ten stretches are time-only holds without any form rule', () => {
    expect(ids).toHaveLength(10);
    for (const id of ids) { expect(FORM_MOVES[id].label, id).toBe('T'); expect(FORM_MOVES[id].rules, id).toHaveLength(0); }
  });
  it('holding still runs the clock after a second; moving about does not', () => {
    for (const id of ids) {
      const still = run(id, hold(5000, () => sidePose(STAND), side));
      expect(still.last.holdMs, id).toBeGreaterThan(2500);
      const moving = run(id, hold(5000, (t) => moved(sidePose(STAND), { nose: [0.06 * Math.sin(t / 300), 0], leftShoulder: [0.06 * Math.sin(t / 300), 0], leftHip: [0.06 * Math.sin(t / 300), 0] }), side));
      expect(moving.last.holdMs, `${id} moving`).toBe(0);
    }
  });
});
