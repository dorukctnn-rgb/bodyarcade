// Measurements shared by the floor (Faz 4) and dumbbell (Faz 5) moves: the elbow's bend, how far an arm is lifted from hanging,
// the upper arm's lean, which way a side view faces, how far a wrist has risen above where it rested. All in VIEW space and in
// the player's own lengths (see legs.ts).
import { angleAt, fromVertical, type Side } from '../geometry.ts';
import type { BodyCtx } from '../types.ts';
import { all, at, nose } from './kit.ts';

type B = Pick<BodyCtx, 'pts' | 'near' | 'view'>;

export const clampP = (v: number, hi = 1.5): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The elbow's angle (shoulder-elbow-wrist), degrees: 180 straight, smaller when bent. */
export function elbowAngle(b: B, s: Side, count = false): number | null {
  const p = all(b, s, ['shoulder', 'elbow', 'wrist'], count);
  return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
}

/** The arm's lift from hanging, degrees: the angle at the shoulder between the hip and the wrist (0 hanging, 90 level, 180 overhead). */
export function armRaise(b: B, s: Side, count = false): number | null {
  const p = all(b, s, ['hip', 'shoulder', 'wrist'], count);
  return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
}

/** The upper arm's lean from the vertical, degrees 0-90. */
export function upperArmLean(b: B, s: Side, count = false): number | null {
  const p = all(b, s, ['shoulder', 'elbow'], count);
  return p ? fromVertical(p[0]!, p[1]!) : null;
}

/** The hip's angle for a lying or planked body (shoulder-hip-ankle), degrees. */
export function bodyBend(b: B, s: Side, count = false): number | null {
  const p = all(b, s, ['shoulder', 'hip', 'ankle'], count);
  return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
}

/**
 * Which way the player faces in a side view: +1 towards the right of the picture, -1 towards the left. `feet` (standing, sitting):
 * the toes against the heel of the near foot. `head` (lying, on hands and knees, where the toes point back): the nose against the
 * near hip. Null when the points do not say.
 */
export function facing(b: B, by: 'feet' | 'head' = 'feet'): 1 | -1 | null {
  if (by === 'feet') {
    const toe = at(b, b.near, 'toe', true), heel = at(b, b.near, 'heel', true);
    if (toe && heel && Math.abs(toe.x - heel.x) > 0.012) return toe.x > heel.x ? 1 : -1;
  }
  const n = nose(b, true), hip = at(b, b.near, 'hip', true);
  if (n && hip && Math.abs(n.x - hip.x) > 0.02) return n.x > hip.x ? 1 : -1;
  return null;
}

/** A wrist's rise above where it rested, in arm lengths: the rest is the lowest the wrist was in the last `ms`. */
export function wristRiser(ms: number): (b: Pick<BodyCtx, 't' | 'pts' | 'near' | 'view' | 'len'>, s: Side) => number | null {
  const rings: Record<Side, { t: number; y: number }[]> = { L: [], R: [] };
  return (b, s) => {
    const wr = at(b, s, 'wrist', true);
    const arm = b.len.upperArm + b.len.forearm;
    if (!wr || arm <= 0) return null;
    const ring = rings[s];
    ring.push({ t: b.t, y: wr.y });
    while (ring.length && ring[0]!.t < b.t - ms) ring.shift();
    let rest = -Infinity;
    for (const r of ring) if (r.y > rest) rest = r.y;
    return (rest - wr.y) / arm;
  };
}
