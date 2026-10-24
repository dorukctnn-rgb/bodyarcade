// Distance and direction advice from the picture alone. The camera is not calibrated, so the numbers are estimates:
// the shoulder width of an average adult (landmark to landmark) and the field of view of a typical webcam (78 degrees
// diagonal, 45 degrees vertical) turn "the shoulders are this wide in the picture" into "you are about this far".
// Advice therefore comes as a range of steps ("1-2 steps back"), never as a false precision.
import type { CalibrationHint } from '../types/index.ts';
import { SPAN_PER_SHOULDER } from './profile.ts';

/** Shoulder landmark to shoulder landmark, an average adult, metres. */
export const SHOULDER_M = 0.38;
/** Vertical field of view assumed for the camera, degrees (a 78 degree 16:9 webcam is about 45). */
export const VFOV_DEG = 45;
/** distance in metres = DIST_K / shoulder width in image heights. */
export const DIST_K = SHOULDER_M / (2 * Math.tan((VFOV_DEG * Math.PI) / 360));
/** One step of the player, metres. */
export const STEP_M = 0.65;
/** The most steps the screen is asked to say. */
export const MAX_STEPS = 6;

/** Head top to sole over nose to ankle: the figure the picture must hold to show the whole body. */
const HEIGHT_PER_SPAN = 1.13;
/** Share of the picture height the whole body should fill after stepping back, and after stepping closer. */
const FILL_BACK = 0.85;
const FILL_CLOSER = 0.65;
/** Head to hips (head top to hip line) in shoulder widths, and the shares for the 'seated' framing. */
const HEAD_TO_HIPS = 2.7;

/** Shoulder width (image heights) at which the whole body fills `fill` of the picture. */
const fullGoal = (fill: number): number => fill / (HEIGHT_PER_SPAN * SPAN_PER_SHOULDER);

export const GOAL_WV = {
  /** Whole body fits with room to spare (the player steps back to here). */
  fullBack: fullGoal(FILL_BACK),
  /** A comfortable size when the player stands too far (steps closer to here). */
  fullCloser: fullGoal(FILL_CLOSER),
  /** Head to hips fits. */
  seatedBack: FILL_BACK / HEAD_TO_HIPS,
  seatedCloser: FILL_CLOSER / HEAD_TO_HIPS,
  /** A comfortable size for head and shoulders when too far. */
  upperCloser: 0.2,
} as const;

/** The distance to the camera in metres, from the shoulder width in image heights. */
export function distanceM(Wv: number): number {
  return DIST_K / Math.max(Wv, 0.02);
}

/** Steps for a distance, as the two whole numbers around it ("2-3"): a step is about 0.65 m, and at least one is asked. */
export function stepsFor(meters: number): { min: number; max: number } {
  const n = Math.max(0, meters) / STEP_M;
  const min = Math.min(MAX_STEPS, Math.max(1, Math.floor(n)));
  const max = Math.min(MAX_STEPS, Math.max(min, Math.ceil(n)));
  return { min, max };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Moving back or closer from shoulder width `wv` to shoulder width `goal` (both in image heights). */
export function moveHint(action: 'step_back' | 'step_closer', wv: number, goal: number): CalibrationHint {
  const meters = Math.abs(DIST_K * (1 / Math.max(goal, 0.02) - 1 / Math.max(wv, 0.02)));
  return { action, steps: stepsFor(meters), meters: round1(meters) };
}

/**
 * Sideways: the body is cut by the side of the picture; `shift` is how far it must go (image heights) to be inside
 * the margin. Metres follow from the shoulder width: one shoulder width is about 0.38 m.
 */
export function lateralHint(action: 'move_left' | 'move_right', shift: number, wv: number): CalibrationHint {
  const meters = Math.max(0, shift) / Math.max(wv, 0.02) * SHOULDER_M;
  return { action, steps: stepsFor(meters), meters: round1(meters) };
}
