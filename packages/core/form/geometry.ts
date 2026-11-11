// Form coach geometry: 2D angles and alignments in VIEW space (the mirrored picture the player sees, both axes in image
// heights, y down; see types/body.ts). One camera sees one plane, so every rule is written for the view it can be measured
// from (SPEC.md section 3): joint bends and body lines from the side, knee tracking and left/right symmetry from the front.
import { LM } from '../types/index.ts';

/** A smoothed landmark in view space with its visibility (0..1). */
export interface P { x: number; y: number; v: number }

/** Below this visibility a point is not used by any form rule (stricter than the games' 0.5: a red line costs more). */
export const RULE_VISIBILITY = 0.6;
/** Below this a point is not used for counting either. */
export const COUNT_VISIBILITY = 0.5;

export type View = 'front' | 'diag' | 'side';
export type Side = 'L' | 'R';

export const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
export const seen = (p: P | undefined, min = RULE_VISIBILITY): p is P => p !== undefined && p.v >= min;

/** The angle at b between b->a and b->c, degrees 0..180. */
export function angleAt(a: P, b: P, c: P): number {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (n === 0) return 180;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** The angle of the segment a->b against the vertical, degrees 0..90 (direction does not matter). */
export function fromVertical(a: P, b: P): number {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** The angle of the segment a->b against the horizontal, degrees 0..90. */
export const fromHorizontal = (a: P, b: P): number => 90 - fromVertical(a, b);

/**
 * How far p lies off the line a->b, in the units of the picture: positive on the side the normal (rotated a->b by -90
 * degrees in a y-down picture, i.e. "up" for a line drawn left to right) points to.
 */
export function offLine(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const n = Math.hypot(dx, dy);
  if (n === 0) return 0;
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / n;
}

/** The vertical gap of p below the straight line through a and b at p's x (y down: positive = p is lower than the line). */
export function belowLine(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return 0;
  const yAt = a.y + ((p.x - a.x) * (b.y - a.y)) / dx;
  return p.y - yAt;
}

/**
 * The bend at b measured on the floor side: 180 for a straight line, less when b sags below the line a-c (y down), more when
 * b rises above it (a hip pushed up past straight). From the side, for push-ups, planks and bridges.
 */
export function bendFromFloor(a: P, b: P, c: P): number {
  const ang = angleAt(a, b, c);
  return belowLine(b, a, c) > 0 ? ang : 360 - ang;
}

export const LEFT = { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle, heel: LM.leftHeel, toe: LM.leftFootIndex, ear: LM.leftEar } as const;
export const RIGHT = { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle, heel: LM.rightHeel, toe: LM.rightFootIndex, ear: LM.rightEar } as const;
export type SideIdx = { readonly [K in keyof typeof LEFT]: number };
export const SIDE_IDX: { readonly L: SideIdx; readonly R: SideIdx } = { L: LEFT, R: RIGHT };

/**
 * Which way the player faces the camera: the shoulder width against the torso length. Facing the camera the shoulders are
 * about 0.69 of the torso (T = 1.45 W, body/profile.ts); turned 90 degrees they overlap. A body lying along the picture
 * (push-up, bridge) has a long torso and stacked shoulders and reads as 'side'.
 */
export function viewOf(pts: readonly P[]): View | null {
  const ls = pts[LM.leftShoulder], rs = pts[LM.rightShoulder], lh = pts[LM.leftHip], rh = pts[LM.rightHip];
  if (!ls || !rs || !lh || !rh) return null;
  if (Math.max(ls.v, rs.v) < COUNT_VISIBILITY || Math.max(lh.v, rh.v) < COUNT_VISIBILITY) return null;
  const torso = dist(mid(ls, rs), mid(lh, rh));
  if (torso <= 0) return null;
  const r = dist(ls, rs) / torso;
  return r >= 0.55 ? 'front' : r <= 0.32 ? 'side' : 'diag';
}

/** The side facing the camera from the side: the one whose shoulder, hip, knee, ankle, elbow and wrist are seen best. */
export function nearSideScore(pts: readonly P[]): number {
  const sum = (s: SideIdx): number => [s.shoulder, s.hip, s.knee, s.ankle, s.elbow, s.wrist].reduce((a, i) => a + (pts[i]?.v ?? 0), 0);
  return sum(LEFT) - sum(RIGHT);
}
