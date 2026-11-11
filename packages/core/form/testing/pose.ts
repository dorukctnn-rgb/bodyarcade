// Forward-kinematics test bodies for Faz 4 and 5 (floor and dumbbell moves): a body in the picture from joint DIRECTIONS instead of
// coordinates. A direction is an angle in degrees measured from straight down in the picture, turning towards +x (so 0 = down, 90 =
// right, 180 = up, -90 = left; y is down). Segment lengths are fixed (L), so the elbow's angle, the hip's bend and so on come out of
// the directions. Synthetic: these test the logic of the rules, never the accuracy on real people (that is form.real.test.ts).
import { LM } from '../../types/index.ts';
import { sideBridge, type Joints } from './body.ts';

export type XY = [number, number];
const rad = (d: number): number => (d * Math.PI) / 180;
const dir = (deg: number, len: number): XY => [len * Math.sin(rad(deg)), len * Math.cos(rad(deg))];
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** Segment lengths in image heights (a person about 0.95 tall: torso 0.24, thigh and shin 0.19, upper arm 0.12, forearm 0.11). */
export const LEN = { torso: 0.24, thigh: 0.19, shin: 0.19, uarm: 0.12, farm: 0.11 } as const;

export interface Limbs { thigh: number; shin: number; uarm: number; farm: number }
export interface SideSpec extends Limbs {
  /** The near hip. */
  hip: XY;
  /** Hip to shoulder: 180 = straight up, 180 - lean = leaning towards +x, -90 = lying with the head to the left. */
  torso: number;
  /** Which way the toes point (+1 right). */
  foot?: 1 | -1;
  /** The far side's own limb directions (the far leg of a bicycle crunch, the far arm of a row); default: as the near side. */
  far?: Partial<Limbs>;
  /** Where the far side sits (a small offset so the points are not identical). */
  farDx?: number;
}

/** A person seen from the side; the near (left) side and a far (right) side that copies it unless `far` says otherwise. */
export function sidePose(s: SideSpec): Joints {
  const hip = s.hip, sh = add(hip, dir(s.torso, LEN.torso)), foot = s.foot ?? 1;
  const side = (l: Limbs, dx: number) => {
    const h: XY = [hip[0] + dx, hip[1]], p: XY = [sh[0] + dx, sh[1]];
    const knee = add(h, dir(l.thigh, LEN.thigh)), ankle = add(knee, dir(l.shin, LEN.shin));
    const elbow = add(p, dir(l.uarm, LEN.uarm)), wrist = add(elbow, dir(l.farm, LEN.farm));
    return { h, p, knee, ankle, elbow, wrist, heel: [ankle[0] - foot * 0.01, ankle[1] + 0.01] as XY, toe: [ankle[0] + foot * 0.05, ankle[1] + 0.01] as XY };
  };
  const n = side(s, 0), f = side({ ...s, ...s.far }, s.farDx ?? 0.004);
  const head = add(sh, dir(s.torso, 0.1));
  const ear = add(sh, dir(s.torso, 0.085));
  return {
    nose: [head[0] + foot * 0.015, head[1]], leftEar: ear, rightEar: ear,
    leftShoulder: n.p, leftElbow: n.elbow, leftWrist: n.wrist, leftHip: n.h, leftKnee: n.knee, leftAnkle: n.ankle, leftHeel: n.heel, leftFootIndex: n.toe,
    rightShoulder: f.p, rightElbow: f.elbow, rightWrist: f.wrist, rightHip: f.h, rightKnee: f.knee, rightAnkle: f.ankle, rightHeel: f.heel, rightFootIndex: f.toe,
  };
}

/** Standing straight, arms hanging, facing right. */
export const STAND: SideSpec = { hip: [0.8, 0.55], torso: 180, thigh: 0, shin: 0, uarm: 0, farm: 0 };

/** The pose between two specs (every direction and the hip moved by u). */
export function between(a: SideSpec, b: SideSpec, u: number): Joints {
  const m = (x: number, y: number): number => lerp(x, y, u);
  return sidePose({
    hip: [m(a.hip[0], b.hip[0]), m(a.hip[1], b.hip[1])], torso: m(a.torso, b.torso), thigh: m(a.thigh, b.thigh), shin: m(a.shin, b.shin), uarm: m(a.uarm, b.uarm), farm: m(a.farm, b.farm),
    foot: a.foot ?? 1,
    ...(a.far || b.far ? { far: { thigh: m(a.far?.thigh ?? a.thigh, b.far?.thigh ?? b.thigh), shin: m(a.far?.shin ?? a.shin, b.far?.shin ?? b.shin), uarm: m(a.far?.uarm ?? a.uarm, b.far?.uarm ?? b.uarm), farm: m(a.far?.farm ?? a.farm, b.far?.farm ?? b.farm) } } : {}),
  });
}

/** The elbow that joins shoulder and wrist for the two segments, bending towards `side` (+1 or -1 of the shoulder-to-wrist line). */
export function elbowFor(sh: XY, wr: XY, side: 1 | -1 = 1): XY {
  const dx = wr[0] - sh[0], dy = wr[1] - sh[1], d = Math.min(Math.hypot(dx, dy), LEN.uarm + LEN.farm - 1e-6);
  const a = (LEN.uarm ** 2 - LEN.farm ** 2 + d ** 2) / (2 * d), h = Math.sqrt(Math.max(0, LEN.uarm ** 2 - a ** 2));
  const ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy);
  return [sh[0] + a * ux + side * h * -uy, sh[1] + a * uy + side * h * ux];
}

/** A copy of the joints with some points moved. */
export const moved = (j: Joints, by: Partial<Record<keyof typeof LM, XY>>): Joints => {
  const out: Joints = { ...j };
  for (const [k, d] of Object.entries(by) as [keyof typeof LM, XY][]) { const p = j[k]; if (p) out[k] = [p[0] + d[0], p[1] + d[1]]; }
  return out;
};

/** The upper body's joints (head, shoulders, arms) of both sides. */
export const UPPER = ['nose', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'] as const;

/** Both arms placed from each shoulder: offsets (outward, down) of the elbow and of the wrist, mirrored on the two sides. */
export function frontArms(j: Joints, elbow: XY, wrist: XY, other?: { elbow: XY; wrist: XY }): Joints {
  const ls = j.leftShoulder!, rs = j.rightShoulder!, o = other ?? { elbow, wrist };
  return {
    ...j,
    leftElbow: [ls[0] - elbow[0], ls[1] + elbow[1]], leftWrist: [ls[0] - wrist[0], ls[1] + wrist[1]],
    rightElbow: [rs[0] + o.elbow[0], rs[1] + o.elbow[1]], rightWrist: [rs[0] + o.wrist[0], rs[1] + o.wrist[1]],
  };
}

/** A person from explicit joint points (near side), the far side copying it: for bodies that are held by a fixed hand or foot. */
export function fromChain(c: { sh: XY; elbow: XY; wrist: XY; hip: XY; knee: XY; ankle: XY; foot?: 1 | -1; head?: XY }): Joints {
  const foot = c.foot ?? 1;
  const heel: XY = [c.ankle[0] - foot * 0.01, c.ankle[1] + 0.01], toe: XY = [c.ankle[0] + foot * 0.05, c.ankle[1] + 0.01];
  const d = (p: XY): XY => [p[0] + 0.004, p[1]];
  const head = c.head ?? [c.sh[0] + 0.03, c.sh[1] - 0.09];
  return {
    nose: head, leftEar: [head[0] - 0.02, head[1] + 0.01], rightEar: [head[0] - 0.02, head[1] + 0.01],
    leftShoulder: c.sh, leftElbow: c.elbow, leftWrist: c.wrist, leftHip: c.hip, leftKnee: c.knee, leftAnkle: c.ankle, leftHeel: heel, leftFootIndex: toe,
    rightShoulder: d(c.sh), rightElbow: d(c.elbow), rightWrist: d(c.wrist), rightHip: d(c.hip), rightKnee: d(c.knee), rightAnkle: d(c.ankle), rightHeel: d(heel), rightFootIndex: d(toe),
  };
}

/** Hip thrust from the side, shoulders on a bench: the hip from low (hip angle about 109) up onto the line from the shoulder to the knee. */
export function sideThrust(u: number): Joints {
  const j = sideBridge(0);
  const sh: XY = [0.55, 0.66], hip: XY = [0.8, lerp(0.8, 0.638, u)];
  return {
    ...j, leftShoulder: sh, rightShoulder: [sh[0] + 0.005, sh[1]], leftHip: hip, rightHip: [hip[0] + 0.005, hip[1]],
    nose: [0.47, 0.65], leftEar: [0.49, 0.64], rightEar: [0.49, 0.64], leftElbow: [0.62, 0.7], rightElbow: [0.62, 0.7], leftWrist: [0.72, 0.78], rightWrist: [0.72, 0.78],
  };
}
