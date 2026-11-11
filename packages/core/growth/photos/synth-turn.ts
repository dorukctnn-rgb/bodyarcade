// A synthetic person turning in place (tests and the e2e fake trace only; meta.origin 'synthetic' is never evidence for
// real bodies: the real-video measurement is tools/growth-fixtures). A stick body in 3D, turned about the vertical axis by
// `deg` (0 front, 90 = nose to the RAW image's right), projected without perspective, with seeded noise. `backFace` sets
// the face points' visibility seen from behind (the pose model sometimes keeps a face on a back).
import { LANDMARK_COUNT, LM, type Landmark } from '../../types/index.ts';
import { mulberry32 } from '../../loop/rng.ts';

type V3 = [number, number, number];
/** Person space, metres: x = the person's own left, y up, z forward. */
const BODY: Partial<Record<number, V3>> = {
  [LM.nose]: [0, 1.6, 0.1], [LM.leftEye]: [0.035, 1.64, 0.085], [LM.rightEye]: [-0.035, 1.64, 0.085],
  [LM.leftEyeInner]: [0.02, 1.64, 0.09], [LM.rightEyeInner]: [-0.02, 1.64, 0.09], [LM.leftEyeOuter]: [0.05, 1.64, 0.08], [LM.rightEyeOuter]: [-0.05, 1.64, 0.08],
  [LM.leftEar]: [0.075, 1.62, 0], [LM.rightEar]: [-0.075, 1.62, 0], [LM.mouthLeft]: [0.025, 1.55, 0.09], [LM.mouthRight]: [-0.025, 1.55, 0.09],
  [LM.leftShoulder]: [0.19, 1.44, 0], [LM.rightShoulder]: [-0.19, 1.44, 0], [LM.leftElbow]: [0.24, 1.15, -0.02], [LM.rightElbow]: [-0.24, 1.15, -0.02],
  [LM.leftWrist]: [0.26, 0.9, 0.02], [LM.rightWrist]: [-0.26, 0.9, 0.02], [LM.leftPinky]: [0.27, 0.84, 0.02], [LM.rightPinky]: [-0.27, 0.84, 0.02],
  [LM.leftIndex]: [0.26, 0.83, 0.04], [LM.rightIndex]: [-0.26, 0.83, 0.04], [LM.leftThumb]: [0.25, 0.86, 0.05], [LM.rightThumb]: [-0.25, 0.86, 0.05],
  [LM.leftHip]: [0.15, 0.95, 0], [LM.rightHip]: [-0.15, 0.95, 0], [LM.leftKnee]: [0.13, 0.52, 0.02], [LM.rightKnee]: [-0.13, 0.52, 0.02],
  [LM.leftAnkle]: [0.12, 0.09, -0.01], [LM.rightAnkle]: [-0.12, 0.09, -0.01], [LM.leftHeel]: [0.12, 0.04, -0.05], [LM.rightHeel]: [-0.12, 0.04, -0.05],
  [LM.leftFootIndex]: [0.13, 0.02, 0.14], [LM.rightFootIndex]: [-0.13, 0.02, 0.14],
};
const FACE = new Set<number>([LM.nose, LM.leftEye, LM.rightEye, LM.leftEyeInner, LM.rightEyeInner, LM.leftEyeOuter, LM.rightEyeOuter, LM.mouthLeft, LM.mouthRight]);

export interface TurnBodyOptions {
  aspect?: number;
  /** share of the picture height the body takes (head to feet) */
  fill?: number;
  /** hip middle, raw x fraction */
  cx?: number;
  /** face visibility from behind (default 0.15) */
  backFace?: number;
  noise?: number;
}

export function turnBody(deg: number, rng: () => number = Math.random, o: TurnBodyOptions = {}): Landmark[] {
  const aspect = o.aspect ?? 16 / 9, fill = o.fill ?? 0.78, cx = o.cx ?? 0.5, noise = o.noise ?? 0.002;
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const scale = fill / 1.72;
  const out: Landmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = BODY[i] ?? [0, 1.5, 0];
    const ix = p[0] * c + p[2] * s;
    const depth = -p[0] * s + p[2] * c;
    const n = (): number => (rng() - 0.5) * 2 * noise;
    let v = 0.95;
    if (FACE.has(i)) v = c > 0.15 ? 0.97 : c > -0.2 ? 0.55 : (o.backFace ?? 0.15);
    else if (i === LM.leftEar || i === LM.rightEar) {
      const outward = i === LM.leftEar ? -s : s;
      v = c < -0.3 ? (o.backFace ?? 0.15) : outward > -0.3 ? 0.9 : 0.2;
    }
    out.push({ x: cx + (ix * scale) / aspect + n(), y: 0.1 + (1.72 - p[1]) * scale + n(), z: -depth * scale, visibility: v });
  }
  return out;
}

/** A whole turn as timed frames: `degPerS` (negative = the other way), starting at `start` degrees, with a still start. */
export function turnFrames(o: { seconds: number; degPerS: number; start?: number; fps?: number; seed?: number; stillS?: number } & TurnBodyOptions): { t: number; deg: number; lm: Landmark[] }[] {
  const fps = o.fps ?? 30, rng = mulberry32(o.seed ?? 7), still = o.stillS ?? 1;
  const out: { t: number; deg: number; lm: Landmark[] }[] = [];
  for (let k = 0; k <= o.seconds * fps; k++) {
    const t = (k * 1000) / fps;
    const moving = Math.max(0, t / 1000 - still);
    const deg = ((((o.start ?? 0) + o.degPerS * moving) % 360) + 360) % 360;
    out.push({ t, deg, lm: turnBody(deg, rng, o) });
  }
  return out;
}
