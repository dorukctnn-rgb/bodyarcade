// Synthetic landmark traces: a parametric stick figure that stands, jumps, squats, leans and raises its arms,
// with seeded noise and dropouts. For unit tests and examples only. Synthetic traces are NOT evidence that a
// detector works on real bodies (meta.origin = 'synthetic'); real recordings are (game-design.md, code-audit 11.9).
import { LANDMARK_COUNT, LM, type Framing, type Landmark, type Trace, type TraceLabel, type TraceMeta } from '../types/index.ts';
import { gaussian, mulberry32 } from '../loop/rng.ts';

/** Body placement in the RAW camera image. T and W in image heights (the same unit on both axes). */
export interface BodyShape {
  /** Hip centre, raw image x (0..1). */
  cx: number;
  /** Hip centre, raw image y (0..1, down). */
  hipY: number;
  /** Torso length: vertical shoulder-midpoint to hip-midpoint distance. */
  T: number;
  /** Shoulder width. */
  W: number;
  /** Image width / height. */
  aspect: number;
}

/** What the figure is doing at one moment. All zero = standing still, arms down. */
export interface PoseParams {
  /** Whole body lifted (airborne), in T. */
  rise?: number;
  /** Squat: hip drop in T (feet stay on the floor). */
  drop?: number;
  /** Side lean in W, the runner's lean signal (tilt + 0.7 x shift); positive = toward the player's right. */
  lean?: number;
  /** Arms: 0 hanging, 1 straight overhead. */
  armsUp?: number;
  /** Whole figure moved sideways in the raw image, in image heights (positive = raw image right). */
  shiftX?: number;
  /** Person absent this frame (landmarks null). */
  absent?: boolean;
}

export const DEFAULT_SHAPE: BodyShape = { cx: 0.5, hipY: 0.52, T: 0.2, W: 0.16, aspect: 4 / 3 };

type P = { hx: number; y: number; z: number; v: number };

/**
 * The figure in "person space": hx in image heights, positive toward the person's LEFT side (which is the raw image's
 * right when they face the camera), y down from the hip centre in image heights.
 */
function figure(s: BodyShape, p: PoseParams): P[] {
  const T = s.T, W = s.W;
  const rise = p.rise ?? 0, drop = Math.max(0, p.drop ?? 0), up = Math.min(1, Math.max(0, p.armsUp ?? 0));
  // Lean: hips shift 0.3 W, shoulders 0.3 W + tilt so that tilt + 0.7 * shift = lean. Toward the player's right
  // means toward the raw image's left, so hx decreases.
  const lean = p.lean ?? 0;
  const hipShift = -0.3 * lean * W;
  const shoulderShift = hipShift - (lean - 0.7 * 0.3 * lean) * W;
  const kneeShift = hipShift * 0.5;
  const hipY = drop * T;                              // hips go down in a squat
  const shY = hipY - T + 0.12 * drop * T;              // chest tips forward a little, so shoulders drop a bit more
  const noseY = shY - 0.45 * T + 0.05 * drop * T;
  const pts: P[] = new Array<P>(LANDMARK_COUNT);
  const set = (i: number, hx: number, y: number, z = 0, v = 0.97): void => { pts[i] = { hx, y, z, v }; };

  const hs = shoulderShift * 1.15;                    // head follows the shoulders a bit further
  set(LM.nose, hs, noseY, -0.25);
  set(LM.leftEyeInner, hs + 0.035 * T, noseY - 0.06 * T, -0.23); set(LM.leftEye, hs + 0.06 * T, noseY - 0.065 * T, -0.23);
  set(LM.leftEyeOuter, hs + 0.085 * T, noseY - 0.06 * T, -0.22); set(LM.rightEyeInner, hs - 0.035 * T, noseY - 0.06 * T, -0.23);
  set(LM.rightEye, hs - 0.06 * T, noseY - 0.065 * T, -0.23); set(LM.rightEyeOuter, hs - 0.085 * T, noseY - 0.06 * T, -0.22);
  set(LM.leftEar, hs + 0.15 * T, noseY - 0.03 * T, -0.1); set(LM.rightEar, hs - 0.15 * T, noseY - 0.03 * T, -0.1);
  set(LM.mouthLeft, hs + 0.05 * T, noseY + 0.08 * T, -0.22); set(LM.mouthRight, hs - 0.05 * T, noseY + 0.08 * T, -0.22);

  set(LM.leftShoulder, shoulderShift + W / 2, shY, -0.05); set(LM.rightShoulder, shoulderShift - W / 2, shY, -0.05);
  // Arms: hanging (elbow 0.6 T below the shoulder, wrist 1.15 T) to overhead (elbow 0.55 T above, wrist 1.1 T above).
  for (const side of [1, -1] as const) {
    const sx = shoulderShift + side * W / 2;
    const ex = sx + side * (0.08 * T * (1 - up) + 0.02 * T * up), ey = shY + (0.6 - 1.15 * up) * T;
    const wx = sx + side * (0.1 * T * (1 - up) + 0.03 * T * up), wy = shY + (1.15 - 2.25 * up) * T;
    const handDir = 1 - 2 * up;                       // fingers point down when hanging, up when overhead
    const L = side === 1;
    set(L ? LM.leftElbow : LM.rightElbow, ex, ey, -0.05);
    set(L ? LM.leftWrist : LM.rightWrist, wx, wy, -0.08);
    set(L ? LM.leftPinky : LM.rightPinky, wx + side * 0.03 * T, wy + handDir * 0.1 * T, -0.09, 0.9);
    set(L ? LM.leftIndex : LM.rightIndex, wx, wy + handDir * 0.12 * T, -0.1, 0.9);
    set(L ? LM.leftThumb : LM.rightThumb, wx - side * 0.03 * T, wy + handDir * 0.08 * T, -0.1, 0.9);
  }
  // Legs: hips 0.25 T either side; knees bend forward and out in a squat; feet stay put.
  set(LM.leftHip, hipShift + 0.25 * T, hipY, 0); set(LM.rightHip, hipShift - 0.25 * T, hipY, 0);
  const kneeY = 0.9 * T + 0.45 * drop * T, kneeOut = 0.25 * T + 0.08 * drop * T;
  set(LM.leftKnee, kneeShift + kneeOut, kneeY, -0.05 - 0.2 * drop); set(LM.rightKnee, kneeShift - kneeOut, kneeY, -0.05 - 0.2 * drop);
  set(LM.leftAnkle, 0.25 * T, 1.8 * T, 0.05, 0.93); set(LM.rightAnkle, -0.25 * T, 1.8 * T, 0.05, 0.93);
  set(LM.leftHeel, 0.24 * T, 1.86 * T, 0.12, 0.9); set(LM.rightHeel, -0.24 * T, 1.86 * T, 0.12, 0.9);
  set(LM.leftFootIndex, 0.3 * T, 1.9 * T, -0.1, 0.9); set(LM.rightFootIndex, -0.3 * T, 1.9 * T, -0.1, 0.9);

  for (const q of pts) q.y -= rise * T;               // airborne: everything goes up
  return pts;
}

/** One frame of landmarks in raw image coordinates, without noise. Points outside the image get low visibility. */
export function synthPose(s: BodyShape, p: PoseParams = {}): Landmark[] {
  return figure(s, p).map((q) => {
    const x = s.cx + (q.hx + (p.shiftX ?? 0)) / s.aspect;
    const y = s.hipY + q.y;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    return { x, y, z: q.z, visibility: inside ? q.v : 0.05 };
  });
}

// ───────── motions (functions of time in ms, combined by adding their params) ─────────

export type Motion = (tMs: number) => PoseParams;

const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Jump: takes off at t0, airborne for `durMs`, peak `height` T (a parabola). */
export const jumpAt = (t0: number, height = 0.45, durMs = 450): Motion => (t) => {
  const u = (t - t0) / durMs;
  return u > 0 && u < 1 ? { rise: height * 4 * u * (1 - u) } : {};
};

/** Squat: goes down over `downMs`, holds, comes back up over `upMs`; `depth` is hip drop in T. */
export const squatAt = (t0: number, depth = 0.6, downMs = 600, holdMs = 300, upMs = 600): Motion => (t) => {
  const d = t - t0;
  if (d <= 0 || d >= downMs + holdMs + upMs) return {};
  const u = d < downMs ? smooth(d / downMs) : d < downMs + holdMs ? 1 : 1 - smooth((d - downMs - holdMs) / upMs);
  return { drop: depth * u };
};

/** Lean to one side and back: `amount` in W, positive = toward the player's right. */
export const leanAt = (t0: number, amount = 0.5, inMs = 300, holdMs = 800, outMs = 300): Motion => (t) => {
  const d = t - t0;
  if (d <= 0 || d >= inMs + holdMs + outMs) return {};
  const u = d < inMs ? smooth(d / inMs) : d < inMs + holdMs ? 1 : 1 - smooth((d - inMs - holdMs) / outMs);
  return { lean: amount * u };
};

/** Arms raised overhead and lowered again. */
export const armsUpAt = (t0: number, inMs = 400, holdMs = 600, outMs = 400): Motion => (t) => {
  const d = t - t0;
  if (d <= 0 || d >= inMs + holdMs + outMs) return {};
  const u = d < inMs ? smooth(d / inMs) : d < inMs + holdMs ? 1 : 1 - smooth((d - inMs - holdMs) / outMs);
  return { armsUp: u };
};

/** Nobody in view between t0 and t1. */
export const absentBetween = (t0: number, t1: number): Motion => (t) => (t >= t0 && t < t1 ? { absent: true } : {});

export function combine(...ms: Motion[]): Motion {
  return (t) => {
    const out: PoseParams = {};
    for (const m of ms) {
      const p = m(t);
      for (const k of ['rise', 'drop', 'lean', 'armsUp', 'shiftX'] as const) {
        const v = p[k];
        if (v !== undefined) out[k] = (out[k] ?? 0) + v;
      }
      if (p.absent) out.absent = true;
    }
    return out;
  };
}

export interface SynthTraceOptions {
  id: string;
  durationMs: number;
  fps?: number;
  shape?: Partial<BodyShape>;
  motion?: Motion;
  /** Gaussian landmark noise, in image heights (default 0.002, about 1 px at 480 p). */
  noise?: number;
  /** Frame time jitter, ms (default 0). */
  jitterMs?: number;
  seed?: number;
  framing?: Framing;
  labels?: TraceLabel[];
  notes?: string;
}

export function synthTrace(o: SynthTraceOptions): Trace {
  const shape: BodyShape = { ...DEFAULT_SHAPE, ...o.shape };
  const fps = o.fps ?? 30;
  const rng = mulberry32(o.seed ?? 1);
  const noise = o.noise ?? 0.002;
  const motion: Motion = o.motion ?? (() => ({}));
  const frames: Trace['frames'] = [];
  const n = Math.floor((o.durationMs * fps) / 1000) + 1;
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const ideal = (i * 1000) / fps;
    const t = Math.max(lastT + 0.1, ideal + (o.jitterMs ? (rng() * 2 - 1) * o.jitterMs : 0), 0);
    lastT = t;
    const p = motion(ideal);
    if (p.absent) { frames.push({ t, lm: null }); continue; }
    const lm = synthPose(shape, p).map((q) => (noise > 0
      ? { x: q.x + (gaussian(rng) * noise) / shape.aspect, y: q.y + gaussian(rng) * noise, z: q.z, visibility: q.visibility }
      : q));
    frames.push({ t, lm });
  }
  const meta: TraceMeta = { id: o.id, origin: 'synthetic', framing: o.framing ?? 'full', model: 'synthetic stick figure (core/pose/synth.ts)' };
  if (o.notes) meta.notes = o.notes;
  return { fps, aspect: shape.aspect, meta, labels: o.labels ?? [], frames };
}
