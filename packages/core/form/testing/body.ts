// Geometric test bodies for the form coach's unit tests: joint positions written in VIEW space (mirrored, image heights) and
// turned into raw landmarks the way the camera gives them. Synthetic: they test the rules' logic, never the coach's accuracy on
// real people (that is form.real.test.ts on traces from real video).
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../../types/index.ts';

export const ASPECT = 16 / 9;
type XY = [number, number];
export type Joints = Partial<Record<keyof typeof LM, XY>>;

/** Raw landmarks from view-space joints; joints not given get visibility 0, `far` names joints seen poorly (0.2). */
export function landmarks(j: Joints, o: { far?: readonly (keyof typeof LM)[]; vis?: number } = {}): Landmark[] {
  const out: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [name, xy] of Object.entries(j) as [keyof typeof LM, XY][]) {
    out[LM[name]] = { x: 1 - xy[0] / ASPECT, y: xy[1], z: 0, visibility: o.far?.includes(name) ? 0.2 : o.vis ?? 0.95 };
  }
  return out;
}

export const frame = (t: number, lm: Landmark[] | null, seq = 0): PoseFrame => ({ seq, t, landmarks: lm, inferenceMs: 5, source: 'test', aspect: ASPECT });

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/**
 * A person facing the camera squatting to depth d (0 standing, 1 thighs level). `kneesIn` moves both knees towards the middle
 * (in image heights) in proportion to the depth; `shift` moves the hips sideways.
 */
export function frontSquat(d: number, o: { kneesIn?: number; shift?: number } = {}): Joints {
  const cx = 0.89, thigh = 0.2;
  const hipY = 0.5 + d * thigh, kneeY = 0.7, ankleY = 0.9;
  const drop = hipY - 0.5;
  const kIn = (o.kneesIn ?? 0) * d, sh = (o.shift ?? 0) * d;
  return {
    nose: [cx, 0.15 + drop], leftEar: [cx - 0.03, 0.14 + drop], rightEar: [cx + 0.03, 0.14 + drop],
    leftShoulder: [cx - 0.085, 0.25 + drop], rightShoulder: [cx + 0.085, 0.25 + drop],
    leftElbow: [cx - 0.1, 0.36 + drop], rightElbow: [cx + 0.1, 0.36 + drop], leftWrist: [cx - 0.08, 0.3 + drop], rightWrist: [cx + 0.08, 0.3 + drop],
    leftHip: [cx - 0.045 + sh, hipY], rightHip: [cx + 0.045 + sh, hipY],
    leftKnee: [cx - 0.06 + kIn, kneeY], rightKnee: [cx + 0.06 - kIn, kneeY],
    leftAnkle: [cx - 0.06, ankleY], rightAnkle: [cx + 0.06, ankleY],
    leftHeel: [cx - 0.06, ankleY + 0.01], rightHeel: [cx + 0.06, ankleY + 0.01], leftFootIndex: [cx - 0.07, ankleY + 0.02], rightFootIndex: [cx + 0.07, ankleY + 0.02],
  };
}

/** The far side of a side view is hidden: the model still places it, with low visibility. */
export const FAR_RIGHT = ['rightShoulder', 'rightElbow', 'rightWrist', 'rightHip', 'rightKnee', 'rightAnkle', 'rightHeel', 'rightFootIndex', 'rightEar'] as const;

function elbowBetween(s: XY, w: XY, len: number): XY {
  const dx = w[0] - s[0], dy = w[1] - s[1], d = Math.hypot(dx, dy);
  const mx = (s[0] + w[0]) / 2, my = (s[1] + w[1]) / 2;
  if (d >= 2 * len) return [mx, my];
  const h = Math.sqrt(len * len - (d / 2) ** 2);
  // the elbow bends towards the feet (+x): of the two perpendiculars take the one pointing right
  let nx = -dy / d, ny = dx / d;
  if (nx < 0) { nx = -nx; ny = -ny; }
  return [mx + h * nx, my + h * ny];
}

/** A push-up from the side (the left side faces the camera), depth d (0 arms straight, 1 chest low); sag lowers the hips. */
export function sidePushUp(d: number, o: { sag?: number; pike?: number; handsForward?: number } = {}): Joints {
  const wrist: XY = [0.6 - (o.handsForward ?? 0), 0.78];
  const shoulderY = 0.58 + d * 0.13;
  const shoulder: XY = [0.6, shoulderY];
  const ankle: XY = [1.35, 0.76];
  const hipLine = shoulderY + ((ankle[1] - shoulderY) * 0.32);
  const hip: XY = [0.84, hipLine + (o.sag ?? 0) - (o.pike ?? 0)];
  const knee: XY = [1.1, (hip[1] + ankle[1]) / 2 + 0.005];
  const elbow = elbowBetween(shoulder, wrist, 0.1);
  const L = { nose: [0.53, shoulderY - 0.01] as XY, leftEar: [0.55, shoulderY - 0.03] as XY, leftShoulder: shoulder, leftElbow: elbow, leftWrist: wrist, leftHip: hip, leftKnee: knee, leftAnkle: ankle, leftHeel: [1.36, 0.74] as XY, leftFootIndex: [1.34, 0.78] as XY };
  return { ...L, rightShoulder: [0.605, shoulderY], rightElbow: elbow, rightWrist: wrist, rightHip: [0.845, hip[1]], rightKnee: knee, rightAnkle: ankle, rightHeel: L.leftHeel, rightFootIndex: L.leftFootIndex, rightEar: L.leftEar };
}

/** A glute bridge from the side, lift u (0 hips on the floor, 1 straight from the shoulders to the knees, more = arching). */
export function sideBridge(u: number, o: { feet?: number } = {}): Joints {
  const shoulder: XY = [0.55, 0.8], knee: XY = [1.0, 0.62];
  const ankle: XY = [1.04 + (o.feet ?? 0), 0.8];
  const lineY = 0.8 - 0.18 * (0.25 / 0.45);
  const hip: XY = [0.8, 0.8 - u * (0.8 - lineY)];
  const L = { nose: [0.47, 0.79] as XY, leftEar: [0.49, 0.78] as XY, leftShoulder: shoulder, leftElbow: [0.62, 0.81] as XY, leftWrist: [0.72, 0.81] as XY, leftHip: hip, leftKnee: knee, leftAnkle: ankle, leftHeel: [ankle[0] + 0.01, 0.81] as XY, leftFootIndex: [ankle[0] + 0.05, 0.81] as XY };
  return { ...L, rightShoulder: [0.555, 0.8], rightElbow: L.leftElbow, rightWrist: L.leftWrist, rightHip: [0.805, hip[1]], rightKnee: knee, rightAnkle: ankle, rightHeel: L.leftHeel, rightFootIndex: L.leftFootIndex, rightEar: L.leftEar };
}

/** A dumbbell press facing the camera: each arm's progress 0 (rack at the shoulders) to 1 (locked out overhead). */
export function frontPress(uL: number, uR: number = uL, o: { lean?: number } = {}): Joints {
  const cx = 0.89, sy = 0.4, lean = o.lean ?? 0;
  const arm = (side: -1 | 1, u: number): { e: XY; w: XY } => {
    const sx = cx + side * 0.09 + lean * 0.5;
    const rackE: XY = [sx + side * 0.07, sy + 0.07], rackW: XY = [sx + side * 0.07, sy - 0.04];
    const topE: XY = [sx + side * 0.03, sy - 0.11], topW: XY = [sx + side * 0.02, sy - 0.22];
    return { e: [lerp(rackE[0], topE[0], u), lerp(rackE[1], topE[1], u)], w: [lerp(rackW[0], topW[0], u), lerp(rackW[1], topW[1], u)] };
  };
  const l = arm(-1, uL), r = arm(1, uR);
  return {
    nose: [cx + lean * 0.6, 0.3], leftEar: [cx - 0.03 + lean * 0.6, 0.29], rightEar: [cx + 0.03 + lean * 0.6, 0.29],
    leftShoulder: [cx - 0.09 + lean * 0.5, sy], rightShoulder: [cx + 0.09 + lean * 0.5, sy], leftElbow: l.e, rightElbow: r.e, leftWrist: l.w, rightWrist: r.w,
    leftHip: [cx - 0.05, 0.66], rightHip: [cx + 0.05, 0.66], leftKnee: [cx - 0.06, 0.82], rightKnee: [cx + 0.06, 0.82], leftAnkle: [cx - 0.06, 0.97], rightAnkle: [cx + 0.06, 0.97],
  };
}

/**
 * Frames of a repeated movement at `hz`: each repetition goes 0 -> 1 -> 0 over `repMs` after `restMs` at 0; `pose(u, i)` gives
 * the joints for progress u in repetition i. Starts with `leadMs` at rest.
 */
export function reps(n: number, pose: (u: number, i: number) => Joints, o: { hz?: number; repMs?: number; restMs?: number; leadMs?: number; far?: readonly (keyof typeof LM)[] } = {}): PoseFrame[] {
  const hz = o.hz ?? 30, repMs = o.repMs ?? 2000, restMs = o.restMs ?? 600, lead = o.leadMs ?? 1000;
  const total = lead + n * (repMs + restMs) + 500;
  const out: PoseFrame[] = [];
  for (let k = 0, t = 0; t <= total; k++, t = (k * 1000) / hz) {
    let u = 0, i = 0;
    if (t > lead) {
      const x = t - lead;
      i = Math.floor(x / (repMs + restMs));
      const inRep = x - i * (repMs + restMs);
      if (i < n && inRep < repMs) u = Math.sin((Math.PI * inRep) / repMs);
    }
    out.push(frame(t, landmarks(pose(u, Math.min(i, n - 1)), o.far ? { far: o.far } : {}), k));
  }
  return out;
}

const rad = (d: number): number => (d * Math.PI) / 180;

/**
 * A lunge from the side (facing +x), depth u (0 standing, 1 front thigh level and back knee near the floor); `front` names the
 * leg in front. Both legs are seen. `lean` tilts the torso forward (degrees).
 */
export function sideLunge(u: number, front: 'L' | 'R', o: { lean?: number } = {}): Joints {
  const T = 0.2, S = 0.2, cx = 0.9;
  const a = rad(90 * u), b = rad(20 * u);
  const fKnee: XY = [cx + 0.05 * u + T * Math.sin(a), 0];
  fKnee[1] = 0.9 - S;
  const hip: XY = [cx + 0.05 * u, fKnee[1] - T * Math.cos(a)];
  const fAnkle: XY = [fKnee[0], 0.9];
  const bKnee: XY = [hip[0] - T * Math.sin(b), hip[1] + T * Math.cos(b)];
  const c = rad(Math.max(0, 90 * u - 5));
  const bAnkle: XY = [bKnee[0] - S * Math.sin(c), Math.min(0.9, bKnee[1] + S * Math.cos(c))];
  const lean = rad(o.lean ?? 0);
  const sh: XY = [hip[0] + 0.3 * Math.sin(lean), hip[1] - 0.3 * Math.cos(lean)];
  const legs = (k: XY, an: XY): [XY, XY, XY, XY] => [k, an, [an[0] - 0.01, an[1] + 0.01], [an[0] + 0.05, an[1] + 0.01]];
  const [fk, fa, fh, ft] = legs(fKnee, fAnkle), [bk, ba, bh, bt] = legs(bKnee, bAnkle);
  const L = front === 'L' ? { k: fk, a: fa, h: fh, t: ft } : { k: bk, a: ba, h: bh, t: bt };
  const R = front === 'L' ? { k: bk, a: ba, h: bh, t: bt } : { k: fk, a: fa, h: fh, t: ft };
  return {
    nose: [sh[0] + 0.04, sh[1] - 0.09], leftEar: [sh[0] + 0.01, sh[1] - 0.1], rightEar: [sh[0] + 0.012, sh[1] - 0.1],
    leftShoulder: sh, rightShoulder: [sh[0] + 0.005, sh[1]], leftElbow: [sh[0] + 0.03, sh[1] + 0.12], rightElbow: [sh[0] + 0.035, sh[1] + 0.12],
    leftWrist: [sh[0] + 0.07, sh[1] + 0.1], rightWrist: [sh[0] + 0.075, sh[1] + 0.1],
    leftHip: hip, rightHip: [hip[0] + 0.005, hip[1]],
    leftKnee: L.k, leftAnkle: L.a, leftHeel: L.h, leftFootIndex: L.t, rightKnee: R.k, rightAnkle: R.a, rightHeel: R.h, rightFootIndex: R.t,
  };
}

/** Facing the camera with each knee raised: uL, uR from 0 (standing) to 1 (thigh level). */
export function frontKnees(uL: number, uR: number): Joints {
  const j = frontSquat(0);
  const knee = (side: -1 | 1, u: number): { k: XY; a: XY } => {
    const hip = j[side < 0 ? 'leftHip' : 'rightHip']!;
    const k: XY = [hip[0] + side * 0.015, hip[1] + 0.2 * Math.cos(rad(90 * u))];
    return { k, a: [k[0], k[1] + 0.2] };
  };
  const l = knee(-1, uL), r = knee(1, uR);
  return { ...j, leftKnee: l.k, leftAnkle: l.a, leftHeel: [l.a[0], l.a[1] + 0.01], leftFootIndex: [l.a[0] - 0.01, l.a[1] + 0.02], rightKnee: r.k, rightAnkle: r.a, rightHeel: [r.a[0], r.a[1] + 0.01], rightFootIndex: [r.a[0] + 0.01, r.a[1] + 0.02] };
}

/** A jumping jack facing the camera: arms from hanging (0) to straight overhead (1), feet from together (0) to wide (1). */
export function frontJack(arms: number, feet: number = arms): Joints {
  const j = frontSquat(0);
  const cx = 0.89, sy = 0.25;
  const arm = (side: -1 | 1): { e: XY; w: XY } => {
    const a = rad(180 * arms); // 0 hanging, 180 straight up, swung out sideways
    const sx = cx + side * 0.085;
    return { e: [sx + side * 0.13 * Math.sin(a), sy + 0.13 * Math.cos(a)], w: [sx + side * 0.26 * Math.sin(a), sy + 0.26 * Math.cos(a)] };
  };
  const l = arm(-1), r = arm(1);
  const fx = 0.06 + 0.12 * feet;
  return {
    ...j, leftElbow: l.e, leftWrist: l.w, rightElbow: r.e, rightWrist: r.w,
    leftKnee: [cx - 0.045 - fx * 0.4, 0.7], rightKnee: [cx + 0.045 + fx * 0.4, 0.7], leftAnkle: [cx - fx, 0.9], rightAnkle: [cx + fx, 0.9],
    leftHeel: [cx - fx, 0.91], rightHeel: [cx + fx, 0.91], leftFootIndex: [cx - fx - 0.01, 0.92], rightFootIndex: [cx + fx + 0.01, 0.92],
  };
}

/** A wall sit from the side (left side to the camera): knee angle `knee` degrees, torso `lean` degrees off the vertical. */
export function sideWallSit(knee: number, lean = 0): Joints {
  const ankle: XY = [0.8, 0.9], k: XY = [0.8, 0.7];
  const th = rad(180 - knee); // the thigh's angle from the vertical
  const hip: XY = [k[0] - 0.2 * Math.sin(th), k[1] - 0.2 * Math.cos(th)];
  const sh: XY = [hip[0] + 0.3 * Math.sin(rad(lean)), hip[1] - 0.3 * Math.cos(rad(lean))];
  const L = { nose: [sh[0] + 0.04, sh[1] - 0.09] as XY, leftEar: [sh[0] + 0.01, sh[1] - 0.1] as XY, leftShoulder: sh, leftElbow: [sh[0] + 0.02, sh[1] + 0.13] as XY, leftWrist: [sh[0] + 0.04, sh[1] + 0.24] as XY, leftHip: hip, leftKnee: k, leftAnkle: ankle, leftHeel: [0.79, 0.91] as XY, leftFootIndex: [0.85, 0.91] as XY };
  return { ...L, rightShoulder: [sh[0] + 0.005, sh[1]], rightElbow: L.leftElbow, rightWrist: L.leftWrist, rightHip: [hip[0] + 0.005, hip[1]], rightKnee: k, rightAnkle: ankle, rightHeel: L.leftHeel, rightFootIndex: L.leftFootIndex, rightEar: L.leftEar };
}

/** Frames holding `pose(t)` for `ms` at `hz`, from t0. */
export function hold(ms: number, pose: (t: number) => Joints, o: { hz?: number; t0?: number; far?: readonly (keyof typeof LM)[] } = {}): PoseFrame[] {
  const hz = o.hz ?? 30, t0 = o.t0 ?? 0, out: PoseFrame[] = [];
  for (let k = 0, t = 0; t <= ms; k++, t = (k * 1000) / hz) out.push(frame(t0 + t, landmarks(pose(t), o.far ? { far: o.far } : {}), k));
  return out;
}

/** Every joint of `a` moved towards `b` by u (joints missing in either are taken from `a`). */
export function blend(a: Joints, b: Joints, u: number): Joints {
  const out: Joints = {};
  for (const [k, p] of Object.entries(a) as [keyof typeof LM, XY][]) {
    const q = b[k] ?? p;
    out[k] = [lerp(p[0], q[0], u), lerp(p[1], q[1], u)];
  }
  return out;
}

/** The whole body moved up by dy image heights (a calf raise, a hop, a step up). */
export function lifted(j: Joints, dy: number): Joints {
  const out: Joints = {};
  for (const [k, p] of Object.entries(j) as [keyof typeof LM, XY][]) out[k] = [p[0], p[1] - dy];
  return out;
}

/** Facing the camera, one knee bent out to the side (lateral lunge, Cossack squat): side s's knee angle goes 178 -> `deep`. */
export function frontSideLunge(u: number, s: 'L' | 'R', deep = 90): Joints {
  const j = frontSquat(0);
  const cx = 0.89, out = s === 'L' ? -1 : 1;
  const ankleW = 0.2; // feet wide
  const bend = rad(lerp(178, deep, u));
  // the bent leg: shin vertical over its ankle, the thigh swinging up and in towards the hips as the knee bends
  const bAnkle: XY = [cx + out * ankleW, 0.9], bKnee: XY = [bAnkle[0], 0.7];
  const thighDir = Math.PI - bend; // the thigh's angle from the vertical
  const hipDrop = 0.2 * (1 - Math.cos(thighDir));
  const hipX = bKnee[0] - out * 0.2 * Math.sin(thighDir);
  const hipY = bKnee[1] - 0.2 * Math.cos(thighDir);
  const midX = hipX - out * 0.045, dy = hipY - 0.5;
  const sAnkle: XY = [cx - out * ankleW, 0.9];
  const sHip: XY = [midX - out * 0.045, hipY];
  const sKnee: XY = [(sHip[0] + sAnkle[0]) / 2, (sHip[1] + sAnkle[1]) / 2];
  void hipDrop;
  const shift = (p: XY): XY => [p[0] + (midX - cx), p[1] + dy];
  const bent = { hip: [hipX, hipY] as XY, knee: bKnee, ankle: bAnkle }, straight = { hip: sHip, knee: sKnee, ankle: sAnkle };
  const L = s === 'L' ? bent : straight, R = s === 'L' ? straight : bent;
  return {
    nose: shift(j.nose!), leftEar: shift(j.leftEar!), rightEar: shift(j.rightEar!), leftShoulder: shift(j.leftShoulder!), rightShoulder: shift(j.rightShoulder!),
    leftElbow: shift(j.leftElbow!), rightElbow: shift(j.rightElbow!), leftWrist: shift(j.leftWrist!), rightWrist: shift(j.rightWrist!),
    leftHip: L.hip, rightHip: R.hip, leftKnee: L.knee, rightKnee: R.knee, leftAnkle: L.ankle, rightAnkle: R.ankle,
    leftHeel: [L.ankle[0], 0.91], rightHeel: [R.ankle[0], 0.91], leftFootIndex: [L.ankle[0] - 0.01, 0.92], rightFootIndex: [R.ankle[0] + 0.01, 0.92],
  };
}

/** Facing the camera, the shin of side s folding up behind (a butt kick, u 0 -> 1) with the thigh vertical. */
export function frontKick(uL: number, uR: number): Joints {
  const j = frontSquat(0);
  const kick = (side: -1 | 1, u: number): XY => { const k = j[side < 0 ? 'leftKnee' : 'rightKnee']!; return [k[0], k[1] + 0.2 * Math.cos(rad(160 * u))]; };
  const l = kick(-1, uL), r = kick(1, uR);
  return { ...j, leftAnkle: l, rightAnkle: r, leftHeel: [l[0], l[1] + 0.01], rightHeel: [r[0], r[1] + 0.01], leftFootIndex: [l[0], l[1] + 0.02], rightFootIndex: [r[0], r[1] + 0.02] };
}

/** A hip hinge from the side (good morning): the torso tips forward from upright (u 0) to 60 degrees (u 1), knees `knee`. */
export function sideHinge(u: number, knee = 165): Joints {
  const base = sideWallSit(knee);
  const hip = base.leftHip!, lean = rad(60 * u);
  const sh: XY = [hip[0] + 0.3 * Math.sin(lean), hip[1] - 0.3 * Math.cos(lean)];
  return { ...base, leftShoulder: sh, rightShoulder: [sh[0] + 0.005, sh[1]], nose: [sh[0] + 0.08, sh[1] - 0.06], leftEar: [sh[0] + 0.05, sh[1] - 0.08], rightEar: [sh[0] + 0.05, sh[1] - 0.08], leftElbow: [sh[0], sh[1] + 0.13], rightElbow: [sh[0], sh[1] + 0.13], leftWrist: [sh[0], sh[1] + 0.24], rightWrist: [sh[0], sh[1] + 0.24] };
}
