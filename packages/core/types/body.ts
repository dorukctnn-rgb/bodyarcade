// core/body: calibration, the body profile and per-frame features.
//
// Coordinate spaces (game-design.md 0.2):
// - VIEW space: the mirrored camera image as the player sees it. x grows to the right of the screen, y grows
//   downwards, and BOTH axes are measured in image heights (x_view = (1 - x_raw) * aspect, y_view = y_raw), so
//   distances that mix x and y are correct. BodyProfile is stored in view space.
// - BODY space: origin at the calibrated rest hip midpoint, unit = the player's torso length T on both axes,
//   +x = the player's right as seen in the mirror (screen right), +y = UP. Features positions use body space, so
//   tall and short players, near or far from the camera, follow the same rules.
import type { BodyPart, JointName, Ms, Vec2 } from './common.ts';
import type { PoseFrame } from './pose.ts';

export type Framing = 'full' | 'upper' | 'side';

export interface BodyProfile {
  v: 2;
  framing: Framing;
  /** Epoch ms (Date.now()); only for display and for "re-check after a while". */
  capturedAt: number;
  /** Width / height of the image at capture; a different aspect means the profile must be checked again. */
  aspect: number;
  /** Torso (shoulder midpoint to hip midpoint, vertical), shoulder width, arm, thigh; view units (image heights). */
  T: number;
  W: number;
  A?: number;
  U?: number;
  /** Rest positions, view space. */
  rest: Record<'hipX' | 'hipY' | 'shoulderX' | 'shoulderY' | 'noseY', number>;
  /** Hands-up height in view space (smaller is higher), for target games. */
  reachY?: number;
  /** Pose frames per second measured while calibrating (device check: fast full-body games need 15 Hz or more). */
  hz: number;
}

export type CalibrationCode =
  | 'no_person'
  | 'too_close'
  | 'too_far'
  | 'head_out'
  | 'hips_out'
  | 'knees_out'
  | 'feet_out'
  | 'move_still'
  | 'hold'
  | 'ok'
  | 'too_slow';

export interface CalibrationStatus {
  /** 0..1 of the hold time. */
  progress: number;
  ready: boolean;
  /** Steady samples collected in the current hold. */
  samples: number;
  code: CalibrationCode;
  /** Measured pose rate so far. */
  hz: number;
}

export interface CalibratorOptions {
  /** Default 1.2 s, as today. */
  holdSeconds?: number;
  /** Default 5: completes at slow rates too (B7). */
  minSamples?: number;
  /** Default 20 s; then the status is 'too_slow' so the UI can offer keyboard or touch. */
  maxSeconds?: number;
}

export interface Calibrator {
  // Time-based and rate-aware: it completes after the hold time with at least minSamples samples, and reports
  // 'too_slow' after maxSeconds so the UI can offer keyboard or touch (B7). It never waits for ever.
  begin(f: Framing, o?: CalibratorOptions): void;
  push(f: PoseFrame): CalibrationStatus;
  profile(): BodyProfile | null;
  reset(): void;
}

export interface Features {
  t: Ms;
  seq: number;
  /** Shoulders and hips are visible: the minimum for any game. */
  ok: boolean;
  /** Which landmark groups are visible (visibility >= 0.5) in this frame. */
  seen: Record<BodyPart, boolean>;
  // Positions in body space (see the top of this file), One Euro filtered. Pairs are [L, R] (the player's own sides).
  head: Vec2;
  shoulder: Vec2;
  hip: Vec2;
  shoulders: [Vec2, Vec2];
  hips: [Vec2, Vec2];
  elbow: [Vec2, Vec2];
  /** Hand centre: mean of wrist, index and pinky (game-design.md 0.2). */
  hand: [Vec2, Vec2];
  knee: [Vec2, Vec2];
  ankle: [Vec2, Vec2];
  /** Foot: mean of ankle and foot tip. */
  foot: [Vec2, Vec2];
  /** Hip rise above rest, in T (positive = up). */
  rise: number;
  /** Hip drop below rest, in T (positive = down); always -rise. */
  drop: number;
  /** Nose drop below rest, in T (positive = down). */
  headDrop: number;
  /** Shoulder-over-hip tilt plus 0.7 x hip shift, relative to rest, in W; positive = toward the player's right. */
  lean: number;
  /** Current shoulder width / W (drops when the player turns; M8 twist). */
  shoulderSpan: number;
  /** Velocities in T per second, body space, [L, R] for paired joints (both entries equal for midline joints). */
  vel: Partial<Record<JointName, [Vec2, Vec2]>>;
}

export interface OneEuroOptions { minCutoff: number; beta: number; dCutoff: number }

export interface FeatureExtractorOptions {
  /** Per-coordinate filter; tech.md 4.1 starts at minCutoff 1.0-1.5 Hz and beta 0.5-1.0. */
  filter?: Partial<OneEuroOptions>;
  /** Slow re-centring of the rest pose while standing still (today's 8 s drift); 0 turns it off. */
  driftSeconds?: number;
}

export interface FeatureExtractor {
  push(f: PoseFrame, p: BodyProfile): Features;
  reset(): void;
}
