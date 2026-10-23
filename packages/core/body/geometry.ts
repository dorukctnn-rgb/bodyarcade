// Landmark helpers shared by calibration and feature extraction. View space: the mirrored image as the player
// sees it, both axes in image heights (see packages/core/types/body.ts).
import { LM, type BodyPart, type Landmark, type Vec2 } from '../types/index.ts';

export const MIN_VISIBILITY = 0.5;

/** Landmark groups per body part; a part is "seen" when every landmark in it is visible. */
export const BODY_PARTS: Record<BodyPart, readonly number[]> = {
  head: [LM.nose],
  shoulders: [LM.leftShoulder, LM.rightShoulder],
  elbows: [LM.leftElbow, LM.rightElbow],
  hands: [LM.leftWrist, LM.rightWrist],
  hips: [LM.leftHip, LM.rightHip],
  knees: [LM.leftKnee, LM.rightKnee],
  ankles: [LM.leftAnkle, LM.rightAnkle],
  feet: [LM.leftFootIndex, LM.rightFootIndex],
};

export function isVisible(lm: readonly Landmark[], i: number, min = MIN_VISIBILITY): boolean {
  const p = lm[i];
  return p !== undefined && p.visibility >= min;
}

export function partSeen(lm: readonly Landmark[], part: BodyPart): boolean {
  return BODY_PARTS[part].every((i) => isVisible(lm, i));
}

export function seenParts(lm: readonly Landmark[] | null): Record<BodyPart, boolean> {
  const out = {} as Record<BodyPart, boolean>;
  for (const part of Object.keys(BODY_PARTS) as BodyPart[]) out[part] = lm !== null && partSeen(lm, part);
  return out;
}

/** Raw image landmark to view space (mirrored, image heights). */
export function toView(p: Landmark, aspect: number): Vec2 {
  return { x: (1 - p.x) * aspect, y: p.y };
}

export function viewOf(lm: readonly Landmark[], i: number, aspect: number): Vec2 {
  const p = lm[i];
  return p ? toView(p, aspect) : { x: 0, y: 0 };
}

export function meanView(lm: readonly Landmark[], idx: readonly number[], aspect: number): Vec2 {
  let x = 0, y = 0;
  for (const i of idx) { const v = viewOf(lm, i, aspect); x += v.x; y += v.y; }
  return { x: x / idx.length, y: y / idx.length };
}

export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
