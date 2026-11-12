// Aligning two photos of the same direction (SPEC 2.6): the same torso length (shoulders' middle to hips' middle) and the
// hips' middle on the same spot of the canvas (horizontal middle, 55 % down). Non-destructive: the photo never changes; the
// transform is computed when drawn. The body is never rotated to match (posture differences must stay visible); only a
// saved phone tilt is undone. A second measure, the body height, warns when posture or camera height differ (> 8 %).
import { LM, type Landmark } from '../../types/index.ts';

export interface PhotoPose {
  /** raw image fractions */
  lm: readonly Landmark[];
  /** pixel size of the stored photo */
  w: number;
  h: number;
  /** phone tilt (DeviceOrientation gamma, degrees) when it was taken, if known */
  tilt?: number | null;
  /** the person's own fine-tuning on top (scale and pixel shift on the canvas) */
  tweak?: { s: number; dx: number; dy: number } | null;
}

export interface DrawTransform {
  /** canvas pixels per photo pixel */
  scale: number;
  /** canvas position of the photo's top-left corner, before rotation */
  x: number;
  y: number;
  /** rotation about the hips' middle, radians (only the saved tilt) */
  rot: number;
  /** canvas point the hips' middle lands on */
  ax: number;
  ay: number;
}

export const ALIGN = { anchorX: 0.5, anchorY: 0.55, torsoShare: 0.27, warnRatio: 0.08 } as const;

function torsoPx(p: PhotoPose): { hx: number; hy: number; torso: number; height: number | null } | null {
  const g = (i: number): { x: number; y: number; v: number } | null => { const l = p.lm[i]; return l ? { x: l.x * p.w, y: l.y * p.h, v: l.visibility } : null; };
  const ls = g(LM.leftShoulder), rs = g(LM.rightShoulder), lh = g(LM.leftHip), rh = g(LM.rightHip);
  if (!ls || !rs || !lh || !rh) return null;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2, hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
  const torso = Math.abs(hy - sy) || Math.hypot(hx - sx, hy - sy);
  if (torso < 4) return null;
  const nose = g(LM.nose), la = g(LM.leftAnkle), ra = g(LM.rightAnkle);
  const feet = [la, ra].filter((a): a is { x: number; y: number; v: number } => !!a && a.v >= 0.5);
  const height = nose && feet.length ? Math.max(...feet.map((a) => a.y)) - nose.y : null;
  return { hx, hy, torso, height };
}

/** Where to draw a photo on a canvas of `cw` x `ch` so its body matches every other aligned photo. Null: no body points. */
export function alignTransform(p: PhotoPose, cw: number, ch: number): DrawTransform | null {
  const t = torsoPx(p);
  if (!t) return null;
  const tw = p.tweak ?? { s: 1, dx: 0, dy: 0 };
  const scale = ((ALIGN.torsoShare * ch) / t.torso) * tw.s;
  const ax = ALIGN.anchorX * cw + tw.dx, ay = ALIGN.anchorY * ch + tw.dy;
  return { scale, x: ax - t.hx * scale, y: ay - t.hy * scale, rot: p.tilt ? (-p.tilt * Math.PI) / 180 : 0, ax, ay };
}

/** Do two photos disagree on body height against torso length (posture or camera height changed)? */
export function postureDiffers(a: PhotoPose, b: PhotoPose): boolean {
  const ta = torsoPx(a), tb = torsoPx(b);
  if (!ta || !tb || ta.height === null || tb.height === null) return false;
  const ra = ta.height / ta.torso, rb = tb.height / tb.torso;
  return Math.abs(ra - rb) / Math.max(ra, rb) > ALIGN.warnRatio;
}

/** Applies a transform to a canvas 2D context (call inside save/restore, then drawImage(img, 0, 0)). */
export function applyTransform(ctx: Pick<CanvasRenderingContext2D, 'translate' | 'rotate' | 'scale'>, t: DrawTransform): void {
  ctx.translate(t.ax, t.ay);
  if (t.rot) ctx.rotate(t.rot);
  ctx.translate(-t.ax, -t.ay);
  ctx.translate(t.x, t.y);
  ctx.scale(t.scale, t.scale);
}

/** The thin outline of an earlier photo's body, for the ghost on the live camera (canvas points of the main joints). */
export function ghostLines(p: PhotoPose, cw: number, ch: number): [number, number, number, number][] {
  const t = alignTransform(p, cw, ch);
  if (!t) return [];
  const pairs: [number, number][] = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];
  const at = (i: number): [number, number] | null => { const l = p.lm[i]; return l && l.visibility >= 0.5 ? [t.x + l.x * p.w * t.scale, t.y + l.y * p.h * t.scale] : null; };
  return pairs.flatMap(([a, b]) => { const pa = at(a), pb = at(b); return pa && pb ? [[pa[0], pa[1], pb[0], pb[1]] as [number, number, number, number]] : []; });
}
