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
