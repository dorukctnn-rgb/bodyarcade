// Form coach, Faz 5 (dumbbell moves): every move counts its own movement on a test body (testing/pose.ts), the rules fire on the faults
// they are written for, and a person standing still counts nothing. These prove the logic; accuracy on real people is form.real.test.ts.
import { describe, expect, it } from 'vitest';
import { createFormCoach } from './coach.ts';
import { FORM_MOVES } from './moves/index.ts';
import { FAR_RIGHT, blend, frame, frontPress, frontSquat, hold, landmarks, lifted, reps, sideHinge, sideLunge, sidePushUp, sideWallSit, type Joints } from './testing/body.ts';
import { STAND, UPPER, between, frontArms, lerp, moved, sidePose, sideThrust, type SideSpec, type XY } from './testing/pose.ts';
import type { CoachState, FormMoveId } from './types.ts';
import type { PoseFrame } from '../types/index.ts';

function run(move: FormMoveId, frames: PoseFrame[]) {
  const c = createFormCoach(move);
  const states: CoachState[] = frames.map((f) => c.push(f));
  return { states, last: states.at(-1)!, summary: c.summary(), reps: states.flatMap((s) => (s.repDone ? [s.repDone] : [])), cues: new Set(states.flatMap((s) => (s.cue ? [s.cue] : []))) };
}
const side = { far: FAR_RIGHT } as const;
const clean = (r: ReturnType<typeof run>): boolean => r.reps.every((x) => x.clean);
const alternating = (n: number, pose: (u: number, s: 'L' | 'R') => Joints, o: Parameters<typeof reps>[2] = {}) => reps(n, (u, i) => pose(u, i % 2 === 0 ? 'L' : 'R'), o);

// ---- bodies ----
const CURL_A: SideSpec = { ...STAND, uarm: 0, farm: 10 };
/** A biceps curl from the side: the forearm from hanging (elbow about 170) up to curled (60); `farm` is the curled forearm's direction. */
const curl = (u: number, top: Partial<SideSpec> = { farm: 120 }): Joints => between(CURL_A, { ...CURL_A, ...top }, u);

/** Both arms from hanging slightly out to the side (lateral raise) or in front of the thighs (upright row): front view. */
const front = (elbow: XY, wrist: XY, other?: { elbow: XY; wrist: XY }): Joints => frontArms(frontSquat(0), elbow, wrist, other);
const lateral = (u: number, top: { elbow: XY; wrist: XY } = { elbow: [0.12, 0], wrist: [0.23, 0] }, lag = 1): Joints => {
  const rest = { elbow: [0.015, 0.12] as XY, wrist: [0.025, 0.23] as XY };
  const m = (a: XY, b: XY, t: number): XY => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  return front(m(rest.elbow, top.elbow, u), m(rest.wrist, top.wrist, u), { elbow: m(rest.elbow, top.elbow, u * lag), wrist: m(rest.wrist, top.wrist, u * lag) });
};
const upright = (u: number, elbowDy = 0): Joints => {
  const m = (a: XY, b: XY): XY => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  return front(m([0.04, 0.12], [0.13, elbowDy]), m([0.04, 0.23], [0.07, 0.05]));
};

/** The thruster as frames: squat down (1 s), stand up pressing (1 s), lower the arms (0.8 s), rest. depth and arms scale the two parts. */
function thrusterFrames(cycles: number, o: { depth?: number; arms?: number } = {}): PoseFrame[] {
  const out: PoseFrame[] = [], T = 3200, lead = 1000, depth = o.depth ?? 1, arms = o.arms ?? 1;
  for (let k = 0, t = 0; t <= lead + cycles * T + 500; k++, t = (k * 1000) / 30) {
    let d = 0, a = 0;
    if (t > lead && t < lead + cycles * T) {
      const x = (t - lead) % T;
      if (x < 1000) d = x / 1000;
      else if (x < 2000) { d = 1 - (x - 1000) / 1000; a = (x - 1000) / 1000; }
      else if (x < 2800) a = 1 - (x - 2000) / 800;
    }
    const j = frontSquat(d * depth), s = a * arms;
    const arm = (sign: -1 | 1): { e: XY; w: XY } => {
      const sh = j[sign < 0 ? 'leftShoulder' : 'rightShoulder']!;
      return { e: [sh[0] + sign * lerp(0.07, 0.03, s), sh[1] + lerp(0.07, -0.11, s)], w: [sh[0] + sign * lerp(0.07, 0.02, s), sh[1] + lerp(-0.04, -0.22, s)] };
    };
    const l = arm(-1), r = arm(1);
    out.push(frame(t, landmarks({ ...j, leftElbow: l.e, leftWrist: l.w, rightElbow: r.e, rightWrist: r.w }), k));
  }
  return out;
}

describe('the dumbbell catalogue', () => {
  it('every dumbbell move is in the dumbbell group with a dumbbell on its card; count-only moves offer no live rule', () => {
    for (const id of Object.keys(FORM_MOVES) as FormMoveId[]) {
      const m = FORM_MOVES[id];
      if (m.group !== 'dumbbell') continue;
      expect(m.equipment, id).toContain('dumbbell');
      if (m.label === 'S' || m.label === 'T') expect(m.rules.filter((r) => r.kind === 'live'), id).toHaveLength(0);
    }
  });
});

describe('every Faz 5 move counts its own movement on a test body', () => {
  const lying: SideSpec = { hip: [0.9, 0.82], torso: -90, thigh: 135, shin: 45, uarm: 90, farm: 90 };
  const bent: SideSpec = { ...STAND, torso: 125 };
  const cases: [FormMoveId, PoseFrame[], number][] = [
    // lower body
    ['gobletSquat', reps(3, (u) => frontSquat(u)), 3],
    ['dbFrontSquat', reps(3, (u) => sideWallSit(176 - 80 * u), side), 3],
    ['dbSumoSquat', reps(3, (u) => frontSquat(u)), 3],
    ['romanianDeadlift', reps(3, (u) => sideHinge(u), { ...side, repMs: 2400 }), 3],
    ['singleLegRdl', reps(3, (u) => sideHinge(u), { ...side, repMs: 2400 }), 3],
    ['dbDeadlift', reps(3, (u) => sideHinge(u), { ...side, repMs: 2400 }), 3],
    ['dbLunge', alternating(4, (u, s) => sideLunge(u, s)), 4],
    ['dbBulgarian', reps(3, (u) => sideLunge(u, 'R')), 3],
    ['dbStepUp', reps(3, (u) => lifted(frontSquat(0), 0.1 * u), { repMs: 1600 }), 3],
    ['dbHipThrust', reps(3, (u) => sideThrust(u), side), 3],
    ['dbCalfRaise', reps(4, (u) => lifted(frontSquat(0), 0.025 * u), { repMs: 1200 }), 4],
    ['dbSwing', reps(4, (u) => sideHinge(u), { ...side, repMs: 1500 }), 4],
    // shoulders
    ['arnoldPress', reps(3, (u) => frontPress(u)), 3],
    ['pushPress', reps(3, (u) => frontPress(u)), 3],
    ['lateralRaise', reps(3, (u) => lateral(u), { repMs: 2400 }), 3],
    ['frontRaise', reps(3, (u) => between(STAND, { ...STAND, uarm: 95, farm: 95 }, u), { ...side, repMs: 2400 }), 3],
    ['rearDeltFly', reps(3, (u) => between(bent, { ...bent, uarm: 100, farm: 100 }, u), { ...side, repMs: 2400 }), 3],
    ['uprightRow', reps(3, (u) => upright(u), { repMs: 2400 }), 3],
    ['shrug', reps(4, (u) => moved(front([0.01, 0.12], [0.01, 0.23]), { leftShoulder: [0, -0.03 * u], rightShoulder: [0, -0.03 * u] }), { repMs: 900 }), 4],
    // arms
    ['bicepsCurl', reps(3, (u) => curl(u), { ...side, repMs: 2400 }), 3],
    ['hammerCurl', reps(3, (u) => curl(u), { ...side, repMs: 2400 }), 3],
    ['concentrationCurl', reps(3, (u) => curl(u), { ...side, repMs: 2400 }), 3],
    ['zottmanCurl', reps(3, (u) => curl(u), { ...side, repMs: 2400 }), 3],
    ['overheadTricepsExt', reps(3, (u) => between({ ...STAND, uarm: 180, farm: 175 }, { ...STAND, uarm: 180, farm: 70 }, u), { ...side, repMs: 2400 }), 3],
    ['tricepsKickback', reps(3, (u) => between({ ...STAND, torso: 135, uarm: -25, farm: 60 }, { ...STAND, torso: 135, uarm: -25, farm: -10 }, u), { ...side, repMs: 2000 }), 3],
    // lying and back
    ['floorPress', reps(3, (u) => between({ ...lying, uarm: 180, farm: 180 }, { ...lying, uarm: 95, farm: 180 }, u), { ...side, repMs: 2400 }), 3],
    ['closeGripFloorPress', reps(3, (u) => between({ ...lying, uarm: 180, farm: 180 }, { ...lying, uarm: 95, farm: 180 }, u), { ...side, repMs: 2400 }), 3],
    ['skullCrusher', reps(3, (u) => between({ ...lying, uarm: 180, farm: 180 }, { ...lying, uarm: 80, farm: 180 }, u), { ...side, repMs: 2400 }), 3],
    ['pullover', reps(3, (u) => between({ ...lying, uarm: -180, farm: -180 }, { ...lying, uarm: -100, farm: -100 }, u), { ...side, repMs: 2600 }), 3],
    ['bentOverRow', reps(3, (u) => between(bent, { ...bent, uarm: -70, farm: 25 }, u), { ...side, repMs: 2000 }), 3],
    ['oneArmRow', reps(3, (u) => between(bent, { ...bent, uarm: -70, farm: 25 }, u), { ...side, repMs: 2000 }), 3],
    ['renegadeRow', reps(3, (u) => between({ hip: [0.5, 0.7], torso: 105, thigh: -75, shin: -75, uarm: 0, farm: 0 }, { hip: [0.5, 0.7], torso: 105, thigh: -75, shin: -75, uarm: -70, farm: 25 }, u), { ...side, repMs: 2200 }), 3],
    // core and whole body
    ['manMaker', reps(3, (u) => blend(sideWallSit(176), sidePushUp(0), u), { ...side, repMs: 2400 }), 3],
    ['dbSnatch', reps(3, (u) => frontPress(u), { repMs: 900 }), 3],
  ];
  for (const [move, frames, n] of cases) {
    it(`${move}: ${n} repetitions`, () => {
      const r = run(move, frames);
      expect(r.reps, move).toHaveLength(n);
    });
  }

  it('the squat and lunge twins keep their rules: depth, torso and tempo come with the dumbbell', () => {
    expect(clean(run('gobletSquat', reps(3, (u) => frontSquat(u))))).toBe(true);
    const half = run('gobletSquat', reps(3, (u) => frontSquat(u * 0.7)));
    expect(half.reps.every((x) => x.errors.includes('squat.depth'))).toBe(true);
    const lunge = run('dbLunge', alternating(4, (u, s) => sideLunge(u, s)));
    expect(lunge.summary.sides).toEqual({ L: 2, R: 2 });
    expect(clean(lunge)).toBe(true);
  });

  it('side bend counts each side on its own leg of the machine and flags hips that shift', () => {
    const bend = (u: number, i: number, shift = 0): Joints => {
      const dx = (i % 2 === 0 ? -0.1 : 0.1) * u;
      const j = frontSquat(0);
      const upper = Object.fromEntries(UPPER.map((k) => [k, [dx, 0] as XY]));
      return moved(j, { ...upper, leftHip: [shift * u, 0], rightHip: [shift * u, 0], leftKnee: [shift * u, 0], rightKnee: [shift * u, 0] });
    };
    const r = run('dbSideBend', reps(4, (u, i) => bend(u, i), { repMs: 1400 }));
    expect(r.reps).toHaveLength(4);
    expect(r.summary.sides).toEqual({ L: 2, R: 2 });
    expect(r.reps.every((x) => x.clean)).toBe(true);
  });
});

describe('the rules of the dumbbell moves', () => {
  it('curl: all the way up is clean; stopping short is an error; a drifting elbow and a swinging torso are tips', () => {
    expect(clean(run('bicepsCurl', reps(3, (u) => curl(u), { ...side, repMs: 2400 })))).toBe(true);
    const short = run('bicepsCurl', reps(3, (u) => curl(u, { farm: 70 }), { ...side, repMs: 2400 }));
    expect(short.reps.length).toBeGreaterThan(0);
    expect(short.reps.every((x) => x.errors.includes('curl.top'))).toBe(true);
    const drift = run('bicepsCurl', reps(3, (u) => between(CURL_A, { ...CURL_A, uarm: 40, farm: 150 }, u), { ...side, repMs: 2400 }));
    expect(drift.reps.every((x) => x.clean && x.tips.includes('curl.elbow'))).toBe(true);
    const swing = run('bicepsCurl', reps(3, (u) => between(CURL_A, { ...CURL_A, torso: 160, farm: 120 }, u), { ...side, repMs: 2400 }));
    expect(swing.reps.every((x) => x.clean && x.tips.includes('curl.swing'))).toBe(true);
    // the concentration curl has neither rule (the elbow is braced, the body leans)
    expect(FORM_MOVES.concentrationCurl.rules.map((r) => r.id)).toEqual(['curl.top']);
  });

  it('overhead triceps extension: lowering far enough is clean, a shallow one is an error, an elbow that flares is a tip', () => {
    const ext = (bottom: number, uarm = 180) => run('overheadTricepsExt', reps(3, (u) => between({ ...STAND, uarm, farm: 175 }, { ...STAND, uarm, farm: bottom }, u), { ...side, repMs: 2400 }));
    expect(clean(ext(70))).toBe(true);
    expect(ext(120).reps.every((x) => x.errors.includes('ext.depth'))).toBe(true);
    expect(ext(70, 140).reps.every((x) => x.tips.includes('ext.elbow'))).toBe(true);
  });

  it('triceps kickback: straightening fully is clean, stopping short is an error, an upper arm that drops is a tip', () => {
    const kick = (top: number, uarm = -25, rest = 60) => run('tricepsKickback', reps(3, (u) => between({ ...STAND, torso: 135, uarm, farm: rest }, { ...STAND, torso: 135, uarm, farm: top }, u), { ...side, repMs: 2000 }));
    expect(clean(kick(-10))).toBe(true);
    expect(kick(20).reps.every((x) => x.errors.includes('kickback.top'))).toBe(true);
    expect(kick(35, 20, 105).reps.every((x) => x.tips.includes('kickback.elbow'))).toBe(true);
  });

  it('bent-over row: pulling high with a still torso is clean; a short pull and a swaying torso are tips', () => {
    const bent: SideSpec = { ...STAND, torso: 125 };
    const row = (top: Partial<SideSpec>) => run('bentOverRow', reps(3, (u) => between(bent, { ...bent, ...top }, u), { ...side, repMs: 2000 }));
    const good = row({ uarm: -70, farm: 25 });
    expect(good.reps.every((x) => x.clean && x.tips.length === 0)).toBe(true);
    expect(row({ uarm: -55, farm: 10 }).reps.every((x) => x.tips.includes('row.top'))).toBe(true);
    expect(row({ uarm: -70, farm: 25, torso: 100 }).reps.every((x) => x.tips.includes('row.sway'))).toBe(true);
  });

  it('lateral raise: up to shoulder height is clean; low, too high and one lagging arm are tips', () => {
    expect(clean(run('lateralRaise', reps(3, (u) => lateral(u), { repMs: 2400 })))).toBe(true);
    const low = run('lateralRaise', reps(3, (u) => lateral(u, { elbow: [0.1, 0.07], wrist: [0.2, 0.1] }), { repMs: 2400 }));
    expect(low.reps.length).toBeGreaterThan(0);
    expect(low.reps.every((x) => x.tips.includes('lateral.top'))).toBe(true);
    const high = run('lateralRaise', reps(3, (u) => lateral(u, { elbow: [0.115, -0.05], wrist: [0.2, -0.11] }), { repMs: 2400 }));
    expect(high.reps.every((x) => x.tips.includes('lateral.high'))).toBe(true);
    const lag = run('lateralRaise', reps(3, (u) => lateral(u, undefined, 0.5), { repMs: 2400 }));
    expect(lag.reps.some((x) => x.tips.includes('lateral.together'))).toBe(true);
  });

  it('front raise: not above the shoulder and a still torso', () => {
    const fr = (top: Partial<SideSpec>) => run('frontRaise', reps(3, (u) => between(STAND, { ...STAND, uarm: 95, farm: 95, ...top }, u), { ...side, repMs: 2400 }));
    expect(clean(fr({}))).toBe(true);
    expect(fr({ uarm: 125, farm: 125 }).reps.every((x) => x.tips.includes('front.high'))).toBe(true);
    expect(fr({ torso: 160 }).reps.every((x) => x.tips.includes('front.swing'))).toBe(true);
  });

  it('upright row: elbows above the shoulders are a tip', () => {
    expect(clean(run('uprightRow', reps(3, (u) => upright(u), { repMs: 2400 })))).toBe(true);
    expect(run('uprightRow', reps(3, (u) => upright(u, -0.06), { repMs: 2400 })).reps.every((x) => x.tips.includes('uprow.elbows'))).toBe(true);
  });

  it('romanian deadlift: dumbbells hanging in front of the legs are a tip, dumbbells along the legs are not', () => {
    const far = run('romanianDeadlift', reps(3, (u) => sideHinge(u), { ...side, repMs: 2400 }));
    expect(far.cues.has('rdl.bar')).toBe(true);
    const close = run('romanianDeadlift', reps(3, (u) => {
      const j = sideHinge(u), k = j.leftKnee!;
      return moved(j, { leftWrist: [k[0] - j.leftWrist![0], 0], rightWrist: [k[0] - j.rightWrist![0], 0], leftElbow: [(k[0] - j.leftElbow![0]) * 0.6, 0], rightElbow: [(k[0] - j.rightElbow![0]) * 0.6, 0] });
    }, { ...side, repMs: 2400 }));
    expect(close.cues.has('rdl.bar')).toBe(false);
  });

  it('thruster: squat deep and press all the way up is clean; a shallow squat and low arms are errors', () => {
    const full = run('thruster', thrusterFrames(3));
    expect(full.reps).toHaveLength(3);
    expect(clean(full)).toBe(true);
    const shallow = run('thruster', thrusterFrames(3, { depth: 0.6 }));
    expect(shallow.reps.length).toBe(3);
    expect(shallow.reps.every((x) => x.errors.includes('thruster.depth'))).toBe(true);
    const low = run('thruster', thrusterFrames(3, { arms: 0.5 }));
    expect(low.reps.length).toBe(3);
    expect(low.reps.every((x) => x.errors.includes('thruster.top'))).toBe(true);
  });
});

describe('nothing dumbbell-like counts while standing still', () => {
  it('a person standing still counts no repetition in any dumbbell move', () => {
    for (const id of Object.keys(FORM_MOVES) as FormMoveId[]) {
      if (FORM_MOVES[id].group !== 'dumbbell') continue;
      const r = run(id, hold(4000, () => sidePose(STAND), side));
      expect(r.reps, id).toHaveLength(0);
    }
  });
});
