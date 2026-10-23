// Test rig for the movement library: an articulated synthetic figure (arms, legs, trunk bend and twist, squat, jump)
// that produces raw MediaPipe landmarks and the body-space Features the detectors read. Test support only; nothing in
// production imports it. Synthetic traces are NOT evidence that a detector works on real bodies
// (trace meta.origin is 'synthetic'); they show that the code does what the thresholds say.
//
// Body space (types/body.ts): origin at the rest hip midpoint, unit = torso length T on both axes, +x = the player's
// right as seen in the mirror, +y = up. The figure is authored in body space and placed into the raw camera image with
// a RigShape (where the hips are, how big T is). Raw x grows toward the player's LEFT (the camera is not mirrored).
import {
  LANDMARK_COUNT, LM, type BodyPart, type BodyProfile, type Features, type Framing, type JointName, type Landmark, type PoseFrame,
  type Side, type Trace, type TraceLabel, type Vec2,
} from '../../types/index.ts';
import { gaussian, mulberry32 } from '../../loop/rng.ts';

// ───────── the figure ─────────

/** Proportions in torso lengths T. Arm A = upperArm + foreArm = 1.15 T and thigh U = 0.9 T, like P's synthetic figure. */
export interface Build {
  /** Shoulder width W. */
  w: number;
  hipHalf: number;
  /** Nose above the shoulder midpoint. */
  neck: number;
  upperArm: number;
  foreArm: number;
  /** Wrist to the hand centre (mean of wrist, index and pinky). */
  hand: number;
  thigh: number;
  shank: number;
}

export const BUILD: Build = { w: 0.8, hipHalf: 0.25, neck: 0.45, upperArm: 0.6, foreArm: 0.55, hand: 0.07, thigh: 0.9, shank: 0.9 };

/** Upper arm and forearm directions in degrees from straight down; positive = away from the body midline, 180 = straight up. */
export interface ArmSpec { a?: number; f?: number }
/** Knee lift k as in game-design.md 0.2 (0 standing, 1 knee at hip height) and the ankle's sideways offset in T. */
export interface LegSpec { k?: number; out?: number }

export interface FigureSpec {
  /** Whole body shifted sideways (T, + = the player's right), jump height, squat depth (hip drop) in T. */
  dx?: number;
  rise?: number;
  drop?: number;
  /** Trunk bent sideways about the hips, degrees, + toward the player's right. */
  bend?: number;
  /** Trunk foreshortened by leaning forward or back, 0..1 (0 upright). */
  fore?: number;
  /** Trunk rotated about the vertical axis, degrees: shoulders narrow by cos, the face turns toward + . */
  twist?: number;
  armL?: ArmSpec; armR?: ArmSpec;
  legL?: LegSpec; legR?: LegSpec;
  /** These landmark groups report low visibility (out of view or hidden). */
  hide?: readonly BodyPart[];
  /** Nobody in view. */
  absent?: boolean;
}

type Pt = { x: number; y: number; v: number };

const out = (side: Side): number => (side === 'L' ? -1 : 1);

/** The figure's landmarks in body space (+y up); `v` is the visibility the model would report. */
export function skeleton(spec: FigureSpec, b: Build = BUILD): Pt[] {
  const dx = spec.dx ?? 0, rise = spec.rise ?? 0, drop = Math.max(0, spec.drop ?? 0);
  const beta = (spec.bend ?? 0) * Math.PI / 180, phi = (spec.twist ?? 0) * Math.PI / 180;
  const fore = spec.fore ?? 0;
  const pts: Pt[] = new Array<Pt>(LANDMARK_COUNT);
  const set = (i: number, x: number, y: number, v = 0.97): void => { pts[i] = { x, y, v }; };

  const hip = { x: dx, y: rise - drop };
  const dir = { x: Math.sin(beta), y: Math.cos(beta) };     // from the hips to the shoulders
  const right = { x: Math.cos(beta), y: -Math.sin(beta) };  // across the shoulders
  const torso = (1 - 0.12 * drop) * (1 - fore);
  const sh = { x: hip.x + dir.x * torso, y: hip.y + dir.y * torso };
  const half = (b.w / 2) * Math.cos(phi);
  const shL = { x: sh.x - right.x * half, y: sh.y - right.y * half };
  const shR = { x: sh.x + right.x * half, y: sh.y + right.y * half };
  set(LM.leftShoulder, shL.x, shL.y); set(LM.rightShoulder, shR.x, shR.y);

  // Head: nose above the shoulders along the trunk, turned with the twist.
  const nose = { x: sh.x + dir.x * b.neck * (1 - fore * 0.5) + 0.1 * Math.sin(phi), y: sh.y + dir.y * b.neck * (1 - fore * 0.5) };
  set(LM.nose, nose.x, nose.y);
  const eye = (dxE: number, dyE: number, i: number): void => set(i, nose.x + dxE, nose.y + dyE);
  eye(-0.035, 0.06, LM.leftEyeInner); eye(-0.06, 0.065, LM.leftEye); eye(-0.085, 0.06, LM.leftEyeOuter);
  eye(0.035, 0.06, LM.rightEyeInner); eye(0.06, 0.065, LM.rightEye); eye(0.085, 0.06, LM.rightEyeOuter);
  eye(-0.15, 0.03, LM.leftEar); eye(0.15, 0.03, LM.rightEar);
  eye(-0.05, -0.08, LM.mouthLeft); eye(0.05, -0.08, LM.mouthRight);

  // Arms: forward kinematics in the trunk frame, so a bent trunk carries its arms.
  const world = (ux: number, uy: number): Vec2 => ({ x: right.x * ux + dir.x * uy, y: right.y * ux + dir.y * uy });
  for (const side of ['L', 'R'] as const) {
    const arm = side === 'L' ? spec.armL : spec.armR;
    const aRad = (arm?.a ?? 0) * Math.PI / 180, fRad = (arm?.f ?? 0) * Math.PI / 180;
    const s = side === 'L' ? shL : shR;
    const u1 = world(out(side) * Math.sin(aRad), -Math.cos(aRad));
    const elbow = { x: s.x + u1.x * b.upperArm, y: s.y + u1.y * b.upperArm };
    const u2 = world(out(side) * Math.sin(fRad), -Math.cos(fRad));
    const wrist = { x: elbow.x + u2.x * b.foreArm, y: elbow.y + u2.y * b.foreArm };
    const L = side === 'L';
    set(L ? LM.leftElbow : LM.rightElbow, elbow.x, elbow.y);
    set(L ? LM.leftWrist : LM.rightWrist, wrist.x, wrist.y);
    // Index and pinky sit beyond the wrist and to either side of the forearm direction; the thumb a little less far.
    const perp = { x: -u2.y, y: u2.x };
    set(L ? LM.leftIndex : LM.rightIndex, wrist.x + u2.x * b.hand * 1.4 + perp.x * 0.02, wrist.y + u2.y * b.hand * 1.4 + perp.y * 0.02, 0.9);
    set(L ? LM.leftPinky : LM.rightPinky, wrist.x + u2.x * b.hand * 1.1 - perp.x * 0.02, wrist.y + u2.y * b.hand * 1.1 - perp.y * 0.02, 0.9);
    set(L ? LM.leftThumb : LM.rightThumb, wrist.x + u2.x * b.hand * 0.8 + perp.x * 0.03, wrist.y + u2.y * b.hand * 0.8 + perp.y * 0.03, 0.9);
  }

  // Legs: hips stay level; the knee goes forward and out in a squat and up with a knee lift; feet stay on the floor
  // unless the knee is lifted.
  for (const side of ['L', 'R'] as const) {
    const leg = side === 'L' ? spec.legL : spec.legR;
    const s = out(side);
    const k = leg?.k ?? 0;
    const hipP = { x: hip.x + s * b.hipHalf, y: hip.y };
    const kneeSquat = rise - (b.thigh + 0.45 * drop);
    const kneeLift = hip.y - b.thigh * (1 - k);
    const kneeY = k > 0 ? Math.max(kneeSquat, kneeLift) : kneeSquat;
    const kneeX = hip.x + s * (b.hipHalf + 0.08 * drop);
    const floorAnkle = rise - (b.thigh + b.shank);
    const ankleY = k > 0 ? Math.max(floorAnkle, kneeY - b.shank * (1 - 0.25 * Math.min(k, 1))) : floorAnkle;
    const ankleX = hip.x + s * (b.hipHalf + (leg?.out ?? 0));
    const L = side === 'L';
    set(L ? LM.leftHip : LM.rightHip, hipP.x, hipP.y);
    set(L ? LM.leftKnee : LM.rightKnee, kneeX, kneeY);
    set(L ? LM.leftAnkle : LM.rightAnkle, ankleX, ankleY, 0.93);
    set(L ? LM.leftHeel : LM.rightHeel, ankleX - s * 0.01, ankleY - 0.06, 0.9);
    set(L ? LM.leftFootIndex : LM.rightFootIndex, ankleX + s * 0.05, ankleY - 0.1, 0.9);
  }
  return pts;
}

// ───────── placing the figure in the camera image ─────────

export interface RigShape {
  /** Hip centre in the raw image: x (0..1) and y (0..1, down). */
  cx: number;
  hipY: number;
  /** Torso length in image heights. */
  T: number;
  /** Image width / height. */
  aspect: number;
}

/** A standing person seen head to ankles (hips at 52 percent of the image height), like P's synthetic default. */
export const SHAPE_FULL: RigShape = { cx: 0.5, hipY: 0.52, T: 0.2, aspect: 4 / 3 };
/** Seated at a desk: head to hips in view, knees and feet below the image. */
export const SHAPE_UPPER: RigShape = { cx: 0.5, hipY: 0.8, T: 0.26, aspect: 4 / 3 };

const BODY_PART_LANDMARKS: Record<BodyPart, readonly number[]> = {
  head: [LM.nose],
  shoulders: [LM.leftShoulder, LM.rightShoulder],
  elbows: [LM.leftElbow, LM.rightElbow],
  hands: [LM.leftWrist, LM.rightWrist],
  hips: [LM.leftHip, LM.rightHip],
  knees: [LM.leftKnee, LM.rightKnee],
  ankles: [LM.leftAnkle, LM.rightAnkle],
  feet: [LM.leftFootIndex, LM.rightFootIndex],
};

/** Raw MediaPipe landmarks of the figure, or null when absent. Points outside the image report visibility 0.05. */
export function landmarksOf(spec: FigureSpec, shape: RigShape = SHAPE_FULL, b: Build = BUILD): Landmark[] | null {
  if (spec.absent) return null;
  const pts = skeleton(spec, b);
  const hidden = new Set<number>();
  for (const part of spec.hide ?? []) for (const i of BODY_PART_LANDMARKS[part]) hidden.add(i);
  return pts.map((p, i) => {
    const x = shape.cx - (p.x * shape.T) / shape.aspect;
    const y = shape.hipY - p.y * shape.T;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    return { x, y, z: 0, visibility: hidden.has(i) ? 0.1 : inside ? p.v : 0.05 };
  });
}

/** The profile a calibration of this standing figure would give (rest pose = no spec fields). */
export function profileOf(shape: RigShape = SHAPE_FULL, framing: Framing = 'full', b: Build = BUILD): BodyProfile {
  const viewHipX = (1 - shape.cx) * shape.aspect;
  const p: BodyProfile = {
    v: 2, framing, capturedAt: 0, aspect: shape.aspect,
    T: shape.T, W: b.w * shape.T, A: (b.upperArm + b.foreArm) * shape.T,
    rest: { hipX: viewHipX, hipY: shape.hipY, shoulderX: viewHipX, shoulderY: shape.hipY - shape.T, noseY: shape.hipY - shape.T - b.neck * shape.T },
    hz: 30,
  };
  if (framing === 'full') p.U = b.thigh * shape.T;
  return p;
}

// ───────── landmarks to features (unfiltered; the One Euro version is core/body/features.ts) ─────────

const GROUPS = {
  head: [[LM.nose], [LM.nose]],
  shoulder: [[LM.leftShoulder], [LM.rightShoulder]],
  elbow: [[LM.leftElbow], [LM.rightElbow]],
  hand: [[LM.leftWrist, LM.leftIndex, LM.leftPinky], [LM.rightWrist, LM.rightIndex, LM.rightPinky]],
  wrist: [[LM.leftWrist], [LM.rightWrist]],
  hip: [[LM.leftHip], [LM.rightHip]],
  knee: [[LM.leftKnee], [LM.rightKnee]],
  ankle: [[LM.leftAnkle], [LM.rightAnkle]],
  foot: [[LM.leftAnkle, LM.leftFootIndex], [LM.rightAnkle, LM.rightFootIndex]],
} as const;

/** Body-space Features exactly as the extractor defines them, without the One Euro filter and without rest drift. */
export function featuresOf(f: PoseFrame, p: BodyProfile, prev?: Features | null): Features {
  const lm = f.landmarks;
  const seen = {} as Record<BodyPart, boolean>;
  for (const part of Object.keys(BODY_PART_LANDMARKS) as BodyPart[]) seen[part] = lm !== null && BODY_PART_LANDMARKS[part].every((i) => (lm[i]?.visibility ?? 0) >= 0.5);
  const zero: Vec2 = { x: 0, y: 0 };
  const pair: [Vec2, Vec2] = [zero, zero];
  const ok = lm !== null && seen.shoulders && seen.hips;
  if (!lm || !ok) {
    if (prev) return { ...prev, t: f.t, seq: f.seq, ok: false, seen };
    return { t: f.t, seq: f.seq, ok: false, seen, head: zero, shoulder: zero, hip: zero, shoulders: pair, hips: pair, elbow: pair, hand: pair, knee: pair, ankle: pair, foot: pair, rise: 0, drop: 0, headDrop: 0, lean: 0, shoulderSpan: 1, vel: {} };
  }
  const T = p.T, W = p.W;
  const viewOf = (i: number): Vec2 => ({ x: (1 - (lm[i] as Landmark).x) * f.aspect, y: (lm[i] as Landmark).y });
  const meanView = (idx: readonly number[]): Vec2 => {
    let x = 0, y = 0;
    for (const i of idx) { const v = viewOf(i); x += v.x; y += v.y; }
    return { x: x / idx.length, y: y / idx.length };
  };
  const body = (v: Vec2): Vec2 => ({ x: (v.x - p.rest.hipX) / T, y: (p.rest.hipY - v.y) / T });
  const pairOf = (g: readonly [readonly number[], readonly number[]]): [Vec2, Vec2] => [body(meanView(g[0])), body(meanView(g[1]))];
  const midV = (g: readonly [readonly number[], readonly number[]]): Vec2 => { const a = meanView(g[0]), c = meanView(g[1]); return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }; };
  const hipV = midV(GROUPS.hip), shV = midV(GROUPS.shoulder), headV = viewOf(LM.nose);
  const shL = viewOf(LM.leftShoulder), shR = viewOf(LM.rightShoulder);
  const rise = (p.rest.hipY - hipV.y) / T;
  const features: Features = {
    t: f.t, seq: f.seq, ok: true, seen,
    head: body(headV), shoulder: body(shV), hip: body(hipV),
    shoulders: pairOf(GROUPS.shoulder), hips: pairOf(GROUPS.hip), elbow: pairOf(GROUPS.elbow), hand: pairOf(GROUPS.hand),
    knee: pairOf(GROUPS.knee), ankle: pairOf(GROUPS.ankle), foot: pairOf(GROUPS.foot),
    rise, drop: -rise, headDrop: (headV.y - p.rest.noseY) / T,
    lean: ((shV.x - hipV.x) - (p.rest.shoulderX - p.rest.hipX)) / W + (0.7 * (hipV.x - p.rest.hipX)) / W,
    shoulderSpan: Math.abs(shR.x - shL.x) / W,
    vel: {},
  };
  if (prev && prev.ok && f.t > prev.t) {
    const dt = (f.t - prev.t) / 1000;
    const joints: Record<JointName, [Vec2, Vec2]> = {
      nose: [features.head, features.head], shoulder: features.shoulders, elbow: features.elbow, wrist: pairOf(GROUPS.wrist), hand: features.hand,
      hip: features.hips, knee: features.knee, ankle: features.ankle, foot: features.foot,
    };
    const before: Record<JointName, [Vec2, Vec2]> = {
      nose: [prev.head, prev.head], shoulder: prev.shoulders, elbow: prev.elbow, wrist: joints.wrist, hand: prev.hand,
      hip: prev.hips, knee: prev.knee, ankle: prev.ankle, foot: prev.foot,
    };
    for (const j of Object.keys(joints) as JointName[]) {
      const a = joints[j], c = before[j];
      features.vel[j] = [{ x: (a[0].x - c[0].x) / dt, y: (a[0].y - c[0].y) / dt }, { x: (a[1].x - c[1].x) / dt, y: (a[1].y - c[1].y) / dt }];
    }
  }
  return features;
}

// ───────── motions: the figure over time ─────────

export type Motion = (tMs: number) => FigureSpec;

const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, c: number, u: number): number => a + (c - a) * u;
const n0 = (v: number | undefined): number => v ?? 0;

function mixArm(a: ArmSpec | undefined, c: ArmSpec | undefined, u: number): ArmSpec | undefined {
  if (!a && !c) return undefined;
  return { a: lerp(n0(a?.a), n0(c?.a), u), f: lerp(n0(a?.f), n0(c?.f), u) };
}
function mixLeg(a: LegSpec | undefined, c: LegSpec | undefined, u: number): LegSpec | undefined {
  if (!a && !c) return undefined;
  return { k: lerp(n0(a?.k), n0(c?.k), u), out: lerp(n0(a?.out), n0(c?.out), u) };
}

/** Blend two specs: numbers move with u; `hide` and `absent` switch at the middle. */
export function mix(a: FigureSpec, c: FigureSpec, u: number): FigureSpec {
  const r: FigureSpec = {
    dx: lerp(n0(a.dx), n0(c.dx), u), rise: lerp(n0(a.rise), n0(c.rise), u), drop: lerp(n0(a.drop), n0(c.drop), u),
    bend: lerp(n0(a.bend), n0(c.bend), u), fore: lerp(n0(a.fore), n0(c.fore), u), twist: lerp(n0(a.twist), n0(c.twist), u),
  };
  const aL = mixArm(a.armL, c.armL, u), aR = mixArm(a.armR, c.armR, u), lL = mixLeg(a.legL, c.legL, u), lR = mixLeg(a.legR, c.legR, u);
  if (aL) r.armL = aL;
  if (aR) r.armR = aR;
  if (lL) r.legL = lL;
  if (lR) r.legR = lR;
  const pick = u < 0.5 ? a : c;
  if (pick.hide) r.hide = pick.hide;
  if (pick.absent) r.absent = true;
  return r;
}

/** Keyframes [timeMs, spec]: the figure eases (smoothstep) from one key to the next and holds the first and last. */
export function keyframes(keys: ReadonlyArray<readonly [number, FigureSpec]>): Motion {
  const ks = keys.slice().sort((x, y) => x[0] - y[0]);
  return (t) => {
    const first = ks[0], last = ks[ks.length - 1];
    if (!first || !last) return {};
    if (t <= first[0]) return first[1];
    if (t >= last[0]) return last[1];
    let i = 0;
    while (i < ks.length - 2 && (ks[i + 1] as readonly [number, FigureSpec])[0] <= t) i++;
    const a = ks[i] as readonly [number, FigureSpec], c = ks[i + 1] as readonly [number, FigureSpec];
    return mix(a[1], c[1], smooth((t - a[0]) / (c[0] - a[0])));
  };
}

export const still = (spec: FigureSpec = {}): Motion => () => spec;

/** Sum of motions that touch different parts of the body (numbers add; hide and absent combine). */
export function plus(...ms: Motion[]): Motion {
  return (t) => {
    const r: FigureSpec = {};
    for (const m of ms) {
      const s = m(t);
      for (const k of ['dx', 'rise', 'drop', 'bend', 'fore', 'twist'] as const) if (s[k] !== undefined) r[k] = n0(r[k]) + (s[k] as number);
      for (const k of ['armL', 'armR'] as const) if (s[k]) r[k] = { a: n0(r[k]?.a) + n0(s[k]?.a), f: n0(r[k]?.f) + n0(s[k]?.f) };
      for (const k of ['legL', 'legR'] as const) if (s[k]) r[k] = { k: n0(r[k]?.k) + n0(s[k]?.k), out: n0(r[k]?.out) + n0(s[k]?.out) };
      if (s.hide) r.hide = [...(r.hide ?? []), ...s.hide];
      if (s.absent) r.absent = true;
    }
    return r;
  };
}

/** Repeats a motion defined over [0, periodMs) `count` times starting at `t0`; the figure is neutral outside. */
export const repeat = (cycle: Motion, periodMs: number, count: number, t0 = 0): Motion => (t) => {
  const d = t - t0;
  if (d < 0 || d >= periodMs * count) return {};
  return cycle(d % periodMs);
};

/** Shifts a motion in time. */
export const delayed = (m: Motion, t0: number): Motion => (t) => m(t - t0);

/** Nobody in view between t0 and t1. */
export const absentBetween = (t0: number, t1: number): Motion => (t) => (t >= t0 && t < t1 ? { absent: true } : {});

// ───────── arms by hand position ─────────

/** The arm angles (a, f) that put the HAND CENTRE at `hand`, an offset from the shoulder joint in the trunk frame (T, + = right, + = up). */
export function armTo(side: Side, hand: Vec2, b: Build = BUILD): ArmSpec {
  const s = out(side);
  // Work in the arm's own frame where outward is +x. The hand centre (mean of wrist, index, pinky) lies 0.83 hand
  // lengths beyond the wrist along the forearm, so the wrist target depends on the forearm direction: iterate.
  const target = { x: hand.x * s, y: hand.y };
  const handCentre = b.hand * (0 + 1.4 + 1.1) / 3;
  const reach = b.upperArm + b.foreArm - 1e-4;
  const solve = (w: Vec2): { elbow: Vec2; wrist: Vec2 } => {
    let d = Math.hypot(w.x, w.y);
    let wrist = w;
    if (d > reach) { wrist = { x: (w.x / d) * reach, y: (w.y / d) * reach }; d = reach; }
    d = Math.max(d, Math.abs(b.upperArm - b.foreArm) + 1e-4);
    const cosA = (b.upperArm * b.upperArm + d * d - b.foreArm * b.foreArm) / (2 * b.upperArm * d);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const base = Math.atan2(wrist.y, wrist.x);
    // Two elbow solutions; take the lower one (elbows hang), the outer one on ties.
    const e1 = { x: Math.cos(base + alpha) * b.upperArm, y: Math.sin(base + alpha) * b.upperArm };
    const e2 = { x: Math.cos(base - alpha) * b.upperArm, y: Math.sin(base - alpha) * b.upperArm };
    const elbow = e1.y < e2.y - 1e-9 ? e1 : e2.y < e1.y - 1e-9 ? e2 : e1.x > e2.x ? e1 : e2;
    return { elbow, wrist };
  };
  let sol = solve(target);
  for (let it = 0; it < 12; it++) {
    const fx = sol.wrist.x - sol.elbow.x, fy = sol.wrist.y - sol.elbow.y;
    const fl = Math.hypot(fx, fy) || 1e-9;
    sol = solve({ x: target.x - (fx / fl) * handCentre, y: target.y - (fy / fl) * handCentre });
  }
  const u1 = sol.elbow, u2 = { x: sol.wrist.x - sol.elbow.x, y: sol.wrist.y - sol.elbow.y };
  const ang = (v: Vec2): number => Math.atan2(v.x, -v.y) * 180 / Math.PI;   // in the outward frame: x outward, y up
  return { a: ang(u1), f: ang(u2) };
}

// ───────── making frames and traces ─────────

export interface SimOptions {
  durationMs: number;
  fps?: number;
  shape?: RigShape;
  framing?: Framing;
  build?: Build;
  /** Gaussian landmark noise in image heights (default 0: exact). */
  noise?: number;
  /** Frame time jitter in ms. */
  jitterMs?: number;
  seed?: number;
  t0?: number;
}

export interface Sim {
  profile: BodyProfile;
  frames: PoseFrame[];
  features: Features[];
}

/** Runs a motion at `fps` and returns the frames and their unfiltered body-space features. */
export function simulate(motion: Motion, o: SimOptions): Sim {
  const shape = o.shape ?? SHAPE_FULL, b = o.build ?? BUILD, fps = o.fps ?? 30;
  const framing = o.framing ?? (shape === SHAPE_UPPER ? 'upper' : 'full');
  const profile = profileOf(shape, framing, b);
  const rng = mulberry32(o.seed ?? 7);
  const noise = o.noise ?? 0;
  const jitter = o.jitterMs ?? 0;
  const frames: PoseFrame[] = [];
  const features: Features[] = [];
  const n = Math.floor((o.durationMs * fps) / 1000) + 1;
  let prev: Features | null = null;
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const ideal = (i * 1000) / fps;
    const t = Math.max(lastT + 0.1, ideal + (jitter ? (rng() * 2 - 1) * jitter : 0));
    lastT = t;
    let lm = landmarksOf(motion(ideal), shape, b);
    if (lm && noise > 0) lm = lm.map((q) => ({ x: q.x + (gaussian(rng) * noise) / shape.aspect, y: q.y + gaussian(rng) * noise, z: q.z, visibility: q.visibility }));
    const frame: PoseFrame = { seq: i, t: (o.t0 ?? 0) + t, landmarks: lm, inferenceMs: 0, source: 'test', aspect: shape.aspect };
    frames.push(frame);
    prev = featuresOf(frame, profile, prev);
    features.push(prev);
  }
  return { profile, frames, features };
}

export interface RigTraceOptions extends SimOptions {
  id: string;
  labels?: TraceLabel[];
  notes?: string;
}

/** The same motion as a Trace (meta.origin 'synthetic'), for replay tests through the real calibrator and extractor. */
export function rigTrace(motion: Motion, o: RigTraceOptions): Trace {
  const shape = o.shape ?? SHAPE_FULL, b = o.build ?? BUILD, fps = o.fps ?? 30;
  const rng = mulberry32(o.seed ?? 7);
  const noise = o.noise ?? 0.0015, jitter = o.jitterMs ?? 0;
  const frames: Trace['frames'] = [];
  const n = Math.floor((o.durationMs * fps) / 1000) + 1;
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const ideal = (i * 1000) / fps;
    const t = Math.max(lastT + 0.1, ideal + (jitter ? (rng() * 2 - 1) * jitter : 0));
    lastT = t;
    let lm = landmarksOf(motion(ideal), shape, b);
    if (lm && noise > 0) lm = lm.map((q) => ({ x: q.x + (gaussian(rng) * noise) / shape.aspect, y: q.y + gaussian(rng) * noise, z: q.z, visibility: q.visibility }));
    frames.push({ t, lm });
  }
  return {
    fps, aspect: shape.aspect, labels: o.labels ?? [],
    meta: { id: o.id, origin: 'synthetic', framing: o.framing ?? (shape === SHAPE_UPPER ? 'upper' : 'full'), model: 'articulated rig (core/moves/testing/rig.ts)', ...(o.notes ? { notes: o.notes } : {}) },
    frames,
  };
}
