// Skeleton and silhouette of the player (replaces drawPreview in site/game/app.js:222).
//
// Everything works on packed points: 33 landmarks as [x, y, visibility] in canvas pixels, already mirrored, in a
// Float32Array that is reused every frame (no allocation in the draw loop). toCanvasPoints() fills it from a pose
// frame, optionally through a light smoother, so a jittery landmark does not make the skeleton shake.
import { LM, POSE_CONNECTIONS, type Landmark, type PlayerSlot } from '../types/index.ts';
import type { Ctx2D } from './ctx.ts';
import type { Rect } from './view.ts';

export const LANDMARKS = 33;
export const MIN_VISIBILITY = 0.5;

export interface BodyStyle {
  /** Bones. */
  bone: string;
  /** A darker line under the bones so they read on a bright window as well as in a dark room. null: none. */
  outline: string | null;
  joint: string;
  /** The filled silhouette. */
  silhouette: string;
}

/** design/tokens/tokens.json hud.skeleton, hud.skeleton-joint, hud.ghost and the two side colours. Parity is tested. */
export const BODY_STYLES: Record<PlayerSlot, BodyStyle> = {
  1: { bone: '#F4F2F8', outline: 'rgba(20, 15, 39, 0.55)', joint: '#FF4F6E', silhouette: '#46B4FF' },
  2: { bone: '#FFE9A8', outline: 'rgba(20, 15, 39, 0.55)', joint: '#FFC53A', silhouette: '#FF4F6E' },
};

/** Packed points, canvas pixels: x, y, visibility per landmark. */
export function createPoints(): Float32Array { return new Float32Array(LANDMARKS * 3); }

/**
 * Follows the landmarks a little behind, to calm the jitter of the raw pose output. A landmark that appears or jumps
 * (a new person, a swap) is taken as it is. Works in raw image fractions, so a resized canvas does not disturb it.
 */
export class LandmarkSmoother {
  private readonly s = new Float32Array(LANDMARKS * 3);
  private seen = new Uint8Array(LANDMARKS);
  /** Time constant in milliseconds: about how long the skeleton takes to cover two thirds of a jump. */
  readonly tauMs: number;
  private readonly jump: number;
  constructor(tauMs = 45, jump = 0.25) { this.tauMs = tauMs; this.jump = jump; }

  reset(): void { this.seen.fill(0); }

  /** Returns the smoothed value of landmark i as a [x, y, vis] view into the internal buffer (valid until the next call). */
  push(lm: readonly Landmark[], dtMs: number): Float32Array {
    const k = this.tauMs <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dtMs) / this.tauMs);
    const s = this.s;
    for (let i = 0; i < LANDMARKS; i++) {
      const p = lm[i];
      if (!p) { this.seen[i] = 0; s[i * 3 + 2] = 0; continue; }
      const j = i * 3;
      if (!this.seen[i] || Math.abs(p.x - s[j]!) > this.jump || Math.abs(p.y - s[j + 1]!) > this.jump) {
        s[j] = p.x; s[j + 1] = p.y; s[j + 2] = p.visibility;
        this.seen[i] = p.visibility >= MIN_VISIBILITY ? 1 : 0;
      } else {
        s[j] = s[j]! + (p.x - s[j]!) * k;
        s[j + 1] = s[j + 1]! + (p.y - s[j + 1]!) * k;
        s[j + 2] = p.visibility;
      }
    }
    return s;
  }
}

/** Raw landmarks (or smoothed [x, y, vis] triples) to canvas pixels in the mirror rectangle. Returns false when there is no body. */
export function toCanvasPoints(lm: readonly Landmark[] | null, rect: Rect, out: Float32Array, smooth?: { smoother: LandmarkSmoother; dtMs: number }): boolean {
  if (!lm || lm.length < LANDMARKS) { for (let i = 0; i < LANDMARKS; i++) out[i * 3 + 2] = 0; return false; }
  if (smooth) {
    const s = smooth.smoother.push(lm, smooth.dtMs);
    for (let i = 0; i < LANDMARKS; i++) {
      out[i * 3] = rect.x + (1 - s[i * 3]!) * rect.w;
      out[i * 3 + 1] = rect.y + s[i * 3 + 1]! * rect.h;
      out[i * 3 + 2] = s[i * 3 + 2]!;
    }
    return true;
  }
  for (let i = 0; i < LANDMARKS; i++) {
    const p = lm[i]!;
    out[i * 3] = rect.x + (1 - p.x) * rect.w;
    out[i * 3 + 1] = rect.y + p.y * rect.h;
    out[i * 3 + 2] = p.visibility;
  }
  return true;
}

const vis = (pts: Float32Array, i: number, min = MIN_VISIBILITY): boolean => pts[i * 3 + 2]! >= min;
const dist = (pts: Float32Array, a: number, b: number): number => Math.hypot(pts[a * 3]! - pts[b * 3]!, pts[a * 3 + 1]! - pts[b * 3 + 1]!);

/**
 * How big this body is on screen, as one length: the shoulder width in pixels. The hips stand in when the shoulders
 * are not seen, and a fraction of the frame when nothing is. All line widths and radii follow it.
 */
export function bodyScale(pts: Float32Array, fallback: number): number {
  let w = 0;
  if (vis(pts, LM.leftShoulder) && vis(pts, LM.rightShoulder)) w = dist(pts, LM.leftShoulder, LM.rightShoulder);
  else if (vis(pts, LM.leftHip) && vis(pts, LM.rightHip)) w = dist(pts, LM.leftHip, LM.rightHip) * 1.25;
  return Math.min(400, Math.max(8, w > 0 ? w : fallback));
}

const scratch = new Float32Array(POSE_CONNECTIONS.length * 4);

/** Bones whose two ends are both seen, as x1, y1, x2, y2 in `out`. Returns how many. */
export function skeletonSegments(pts: Float32Array, out: Float32Array = scratch, min = MIN_VISIBILITY): number {
  let n = 0;
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!vis(pts, a, min) || !vis(pts, b, min)) continue;
    out[n * 4] = pts[a * 3]!; out[n * 4 + 1] = pts[a * 3 + 1]!;
    out[n * 4 + 2] = pts[b * 3]!; out[n * 4 + 3] = pts[b * 3 + 1]!;
    n++;
  }
  return n;
}

/** The landmarks that get a joint dot: shoulders to ankles. */
export const JOINTS: readonly number[] = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

export interface SkeletonSize { bone: number; joint: number; head: number }

export function skeletonSize(w: number): SkeletonSize {
  return { bone: Math.min(8, Math.max(2, w * 0.07)), joint: Math.min(9, Math.max(2.5, w * 0.075)), head: w * 0.34 };
}

/** Bones, joints and a ring for the head. Two strokes and one fill, however many bones there are. */
export function drawSkeleton(ctx: Ctx2D, pts: Float32Array, style: BodyStyle, w: number): number {
  const n = skeletonSegments(pts);
  const size = skeletonSize(w);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n > 0) {
    const trace = (): void => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) { ctx.moveTo(scratch[i * 4]!, scratch[i * 4 + 1]!); ctx.lineTo(scratch[i * 4 + 2]!, scratch[i * 4 + 3]!); }
    };
    if (style.outline) { trace(); ctx.strokeStyle = style.outline; ctx.lineWidth = size.bone + 3; ctx.stroke(); }
    trace();
    ctx.strokeStyle = style.bone;
    ctx.lineWidth = size.bone;
    ctx.stroke();
  }
  ctx.beginPath();
  for (const j of JOINTS) {
    if (!vis(pts, j)) continue;
    const x = pts[j * 3]!, y = pts[j * 3 + 1]!;
    ctx.moveTo(x + size.joint, y);
    ctx.arc(x, y, size.joint, 0, Math.PI * 2);
  }
  ctx.fillStyle = style.joint;
  ctx.fill();
  if (vis(pts, LM.nose)) {
    ctx.beginPath();
    ctx.arc(pts[LM.nose * 3]!, pts[LM.nose * 3 + 1]!, size.head, 0, Math.PI * 2);
    ctx.strokeStyle = style.bone;
    ctx.lineWidth = size.bone;
    ctx.stroke();
  }
  return n;
}

/** Widths of the silhouette parts, in shoulder widths (a person is about 3 of them tall below the head). */
export const SILHOUETTE = { upperArm: 0.36, foreArm: 0.3, thigh: 0.46, shin: 0.36, foot: 0.26, hand: 0.19, head: 0.44, neck: 0.3, torsoPad: 0.16 } as const;

/**
 * A filled body made of round-capped limbs, a torso polygon and a head, one colour, opaque. Limbs whose ends are not
 * seen are left out, so a half-visible player gets a half body, not a smear. Returns how many parts were drawn.
 */
export function drawSilhouette(ctx: Ctx2D, pts: Float32Array, style: BodyStyle, w: number): number {
  let parts = 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.silhouette;
  ctx.fillStyle = style.silhouette;
  const limb = (a: number, b: number, width: number): void => {
    if (!vis(pts, a) || !vis(pts, b)) return;
    ctx.beginPath();
    ctx.moveTo(pts[a * 3]!, pts[a * 3 + 1]!);
    ctx.lineTo(pts[b * 3]!, pts[b * 3 + 1]!);
    ctx.lineWidth = Math.max(2, width * w);
    ctx.stroke();
    parts++;
  };
  // torso: shoulders and hips, padded outward so the trunk is wider than the line between its corners
  const ls = LM.leftShoulder, rs = LM.rightShoulder, lh = LM.leftHip, rh = LM.rightHip;
  if (vis(pts, ls) && vis(pts, rs) && vis(pts, lh) && vis(pts, rh)) {
    ctx.beginPath();
    ctx.moveTo(pts[ls * 3]!, pts[ls * 3 + 1]!);
    ctx.lineTo(pts[rs * 3]!, pts[rs * 3 + 1]!);
    ctx.lineTo(pts[rh * 3]!, pts[rh * 3 + 1]!);
    ctx.lineTo(pts[lh * 3]!, pts[lh * 3 + 1]!);
    ctx.closePath();
    ctx.lineWidth = SILHOUETTE.torsoPad * 2 * w;
    ctx.stroke();
    ctx.fill();
    parts++;
  } else {
    limb(ls, rs, SILHOUETTE.upperArm);
    limb(lh, rh, SILHOUETTE.thigh);
    limb(ls, lh, SILHOUETTE.torsoPad * 2);
    limb(rs, rh, SILHOUETTE.torsoPad * 2);
  }
  limb(ls, LM.leftElbow, SILHOUETTE.upperArm); limb(LM.leftElbow, LM.leftWrist, SILHOUETTE.foreArm);
  limb(rs, LM.rightElbow, SILHOUETTE.upperArm); limb(LM.rightElbow, LM.rightWrist, SILHOUETTE.foreArm);
  limb(lh, LM.leftKnee, SILHOUETTE.thigh); limb(LM.leftKnee, LM.leftAnkle, SILHOUETTE.shin);
  limb(rh, LM.rightKnee, SILHOUETTE.thigh); limb(LM.rightKnee, LM.rightAnkle, SILHOUETTE.shin);
  limb(LM.leftAnkle, LM.leftFootIndex, SILHOUETTE.foot); limb(LM.rightAnkle, LM.rightFootIndex, SILHOUETTE.foot);
  for (const [wrist, index] of [[LM.leftWrist, LM.leftIndex], [LM.rightWrist, LM.rightIndex]] as const) limb(wrist, index, SILHOUETTE.hand * 2);
  if (vis(pts, LM.nose)) {
    const nx = pts[LM.nose * 3]!, ny = pts[LM.nose * 3 + 1]!;
    if (vis(pts, ls) && vis(pts, rs)) {
      const mx = (pts[ls * 3]! + pts[rs * 3]!) / 2, my = (pts[ls * 3 + 1]! + pts[rs * 3 + 1]!) / 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(nx, ny);
      ctx.lineWidth = SILHOUETTE.neck * w; ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(nx, ny, SILHOUETTE.head * w, 0, Math.PI * 2);
    ctx.fill();
    parts++;
  }
  return parts;
}
