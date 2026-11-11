// Measurements shared by the standing moves (Faz 3): how far a thigh has come up to level, a knee's bend, how far a shin has
// folded up behind, the hands' height, the feet's width, the torso's lean. All in VIEW space (image heights, y down) and in the
// player's own lengths, so the distance to the camera does not matter. Vertical drops do not depend on which way the player
// faces either: a thigh going from vertical to level shortens its vertical extent from the front, at an angle and from the side
// alike, which is why the thigh-level progress counts a lunge or a high knee from any of the three camera angles.
import { angleAt, fromVertical, type Side } from '../geometry.ts';
import type { BodyCtx } from '../types.ts';
import { all, at, pair } from './kit.ts';

type B = Pick<BodyCtx, 'pts' | 'near' | 'view' | 'len'>;

/**
 * How far the knee of side s hangs below its hip, in thigh lengths: 1 with the thigh vertical (standing), 0 with the thigh
 * level (the front leg of a lunge, a high knee), below 0 with the knee above the hip. Null when the points are not seen.
 */
export function thighDrop(b: B, s: Side, count = true): number | null {
  const hip = at(b, s, 'hip', count), knee = at(b, s, 'knee', count);
  if (!hip || !knee || b.len.thigh <= 0) return null;
  return (knee.y - hip.y) / b.len.thigh;
}

/** Progress of a thigh coming up to level: 0 standing, 1 when the knee hangs only `target` thigh lengths below the hip. */
export function thighLevelProgress(b: B, s: Side, target: number, count = true): number | null {
  const d = thighDrop(b, s, count);
  return d === null ? null : Math.max(0, Math.min(1.5, (1 - d) / (1 - target)));
}

/** The knee's angle (hip-knee-ankle), degrees. */
export function kneeAngle(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, s: Side, count = false): number | null {
  const p = all(b, s, ['hip', 'knee', 'ankle'], count);
  return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
}

/** The hip's angle (shoulder-hip-knee), degrees: 180 standing straight, smaller when bending forward. */
export function hipAngle(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, s: Side, count = false): number | null {
  const p = all(b, s, ['shoulder', 'hip', 'knee'], count);
  return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
}

/** How far the ankle hangs below its knee, in shin lengths: 1 standing, 0 with the shin level behind (a butt kick). */
export function shinDrop(b: B, s: Side, count = true): number | null {
  const knee = at(b, s, 'knee', count), ankle = at(b, s, 'ankle', count);
  if (!knee || !ankle || b.len.shin <= 0) return null;
  return (ankle.y - knee.y) / b.len.shin;
}

/** The torso's lean from the vertical, degrees: from the side the near shoulder and hip, otherwise the midpoints. */
export function torsoLean(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>): number | null {
  if (b.view === 'side') {
    const sh = at(b, b.near, 'shoulder'), hip = at(b, b.near, 'hip');
    return sh && hip ? fromVertical(hip, sh) : null;
  }
  const sh = pair(b, 'shoulder'), hip = pair(b, 'hip');
  return sh && hip ? fromVertical(hip, sh) : null;
}

/** Each hand's height over its shoulder in arm lengths (-1 hanging, 0 at the shoulder, about 1 straight up). */
export function handHeight(b: B, s: Side, count = true): number | null {
  const sh = at(b, s, 'shoulder', count), wr = at(b, s, 'wrist', count);
  const arm = b.len.upperArm + b.len.forearm;
  return sh && wr && arm > 0 ? (sh.y - wr.y) / arm : null;
}

/** The lower hand's height (both hands must be up), or null. */
export function lowerHand(b: B, count = true): number | null {
  const l = handHeight(b, 'L', count), r = handHeight(b, 'R', count);
  return l === null || r === null ? null : Math.min(l, r);
}

/** The ankles' distance in shoulder widths (front view): about 0.6-0.9 with the feet under the hips. */
export function feetWidth(b: B, count = true): number | null {
  const l = at(b, 'L', 'ankle', count), r = at(b, 'R', 'ankle', count);
  if (!l || !r || b.len.shoulders <= 0) return null;
  return Math.abs(l.x - r.x) / b.len.shoulders;
}

/** The whole body's tilt from the vertical, near shoulder to near ankle, degrees: about 0 standing, 70-90 in a plank. */
export function bodyTilt(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, count = true): number | null {
  const sh = at(b, b.near, 'shoulder', count), an = at(b, b.near, 'ankle', count);
  return sh && an ? fromVertical(an, sh) : null;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
