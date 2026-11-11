// Which way the body faces the camera while the person turns (SPEC 2.5). One 2D camera does not measure the body's turn;
// it is read from the shoulder width against the torso, the face points' visibility and where the nose points, and the
// turn order fixes what one frame cannot: the person turns one way, so after the front and one side the next wide view is
// the back, whatever the face points say (the pose model may "see" a face on a back). No rule leans on the model's own
// left/right labels, which it mixes up from behind.
// Angles (RAW camera image, not mirrored): 0 front, 90 = side with the nose pointing to the image's right (the person's
// right side to the camera), 180 back, 270 = side with the nose to the image's left; 45-steps between.
import { LM, type Landmark } from '../../types/index.ts';

export type Bucket = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;
export const QUICK_BUCKETS: readonly Bucket[] = [0, 90, 180, 270];
export const FULL_BUCKETS: readonly Bucket[] = [0, 45, 90, 135, 180, 225, 270, 315];

/** Thresholds (SPEC 2.5, tuned on the tuning clips only: tools/growth-fixtures). */
export const ANGLE_RULES = {
  wide: 0.55,
  narrow: 0.35,
  face: 0.6,
  faceBack: 0.3,
  /** nose this far (torso lengths) left or right of the shoulders' middle: it points that way */
  nose: 0.04,
  /** a class must hold this long before it counts */
  holdMs: 300,
} as const;

export interface AngleFeatures {
  /** shoulder width (horizontal) / torso */
  r: number;
  /** hip width (horizontal) / torso */
  rh: number;
  face: number;
  /** nose minus shoulders' middle, horizontal, in torso lengths (+ = image right) */
  nose: number;
  /** right ear visibility minus left ear visibility */
  ears: number;
  torso: number;
}

const vis = (p: Landmark | undefined): number => p?.visibility ?? 0;

export function features(lm: readonly Landmark[] | null, aspect: number): AngleFeatures | null {
  if (!lm) return null;
  const ls = lm[LM.leftShoulder], rs = lm[LM.rightShoulder], lh = lm[LM.leftHip], rh = lm[LM.rightHip], nose = lm[LM.nose];
  if (!ls || !rs || !lh || !rh || !nose) return null;
  if (Math.max(vis(ls), vis(rs)) < 0.5 || Math.max(vis(lh), vis(rh)) < 0.5) return null;
  const sx = ((ls.x + rs.x) / 2) * aspect, sy = (ls.y + rs.y) / 2;
  const hx = ((lh.x + rh.x) / 2) * aspect, hy = (lh.y + rh.y) / 2;
  const torso = Math.hypot(sx - hx, sy - hy);
  if (torso < 0.02) return null;
  const faceIdx: number[] = [LM.nose, LM.leftEye, LM.rightEye, LM.leftEar, LM.rightEar];
  return {
    r: Math.abs(ls.x - rs.x) * aspect / torso,
    rh: Math.abs(lh.x - rh.x) * aspect / torso,
    face: faceIdx.reduce((a, i) => a + vis(lm[i]), 0) / faceIdx.length,
    nose: (nose.x * aspect - sx) / torso,
    ears: vis(lm[LM.rightEar]) - vis(lm[LM.leftEar]),
    torso,
  };
}

/** One frame on its own: wide (front or back), narrow (a side), mid (a diagonal), with where the nose points. */
export type RawClass = { kind: 'wide'; faceUp: boolean | null } | { kind: 'narrow' | 'mid'; dir: 1 | -1 | 0 };

/** The body's width against its torso, shoulders with the hips as a second vote (a wide body with the arms across the
 *  chest still has wide hips): about 0.7 facing the camera or the back, under 0.35 from the side. */
export const widthOf = (f: AngleFeatures): number => 0.75 * f.r + 0.25 * Math.min(1.2, f.rh * 1.35);

/** How centred a frame is in its bucket: the widest frame of a front or back, the narrowest of a side, the middle of a diagonal. */
export const centrality = (b: Bucket, w: number): number => (b % 180 === 0 ? w : b % 90 === 0 ? -w : -Math.abs(w - 0.45));

export function rawClass(f: AngleFeatures): RawClass {
  const w = widthOf(f);
  const dir: 1 | -1 | 0 = f.nose > ANGLE_RULES.nose ? 1 : f.nose < -ANGLE_RULES.nose ? -1 : f.ears > 0.25 ? 1 : f.ears < -0.25 ? -1 : 0;
  if (w >= ANGLE_RULES.wide) return { kind: 'wide', faceUp: f.face >= ANGLE_RULES.face ? true : f.face < ANGLE_RULES.faceBack ? false : null };
  if (w <= ANGLE_RULES.narrow) return { kind: 'narrow', dir };
  return { kind: 'mid', dir };
}

const norm = (a: number): Bucket => ((((Math.round(a / 45) * 45) % 360) + 360) % 360) as Bucket;

export interface TurnReading {
  /** The bucket this frame is in (null: not known yet / no person), and whether it came from the turn order alone. */
  bucket: Bucket | null;
  approximate: boolean;
  /** +1: angles grow (0, 90, 180, 270), -1: they shrink; 0 until two buckets were seen. */
  direction: 1 | -1 | 0;
  /** The person went back the way they came (not allowed: the page says "keep turning the same way"). */
  reversed: boolean;
}

/**
 * Follows a turn frame by frame. Starts at the front (the guide asks for it; a start from any other view waits for the
 * first wide view with a face). Main buckets need ANGLE_RULES.holdMs of the same class; diagonals are placed between the
 * last main bucket and the next one in the turn's direction, and marked approximate.
 */
export class TurnTracker {
  private main: Bucket | null = null;
  private dir: 1 | -1 | 0 = 0;
  private pending: { key: string; since: number } | null = null;
  private reversed = false;
  /** main buckets seen, in order */
  readonly path: Bucket[] = [];

  constructor(opts: { startAt?: Bucket | null } = {}) {
    if (opts.startAt !== undefined && opts.startAt !== null) { this.main = opts.startAt; this.path.push(opts.startAt); }
  }

  get direction(): 1 | -1 | 0 { return this.dir; }

  /** The main bucket this frame's class would mean, given where the turn is. */
  private target(c: RawClass): Bucket | null {
    const at = this.main;
    if (c.kind === 'wide') {
      if (at === null) return c.faceUp === true ? 0 : null;
      if (at === 0 || at === 180) return at; // still on the same wide view
      // coming from a side: the turn order decides (front -> side -> back); without a direction, the face does
      if (this.dir !== 0) return norm(at + 90 * this.dir);
      return c.faceUp === false ? 180 : 0;
    }
    if (c.kind === 'narrow') {
      if (at === null) return null;
      if (at === 90 || at === 270) {
        // a side again: the same one, unless the nose clearly points the other way (still the same side: no jump)
        return at;
      }
      // from a wide view: the nose says which side (it points the same way whether the person came from the front or the
      // back); only when the nose is unclear does the turn's direction decide
      if (c.dir !== 0) return c.dir === 1 ? 90 : 270;
      if (this.dir !== 0) return norm(at + 90 * this.dir);
      return null;
    }
    return null;
  }

  push(f: AngleFeatures | null, t: number): TurnReading {
    if (!f) { this.pending = null; return { bucket: null, approximate: false, direction: this.dir, reversed: this.reversed }; }
    const c = rawClass(f);
    const want = this.target(c);
    if (want !== null && want !== this.main) {
      const key = String(want);
      if (!this.pending || this.pending.key !== key) this.pending = { key, since: t };
      if (t - this.pending.since >= ANGLE_RULES.holdMs) {
        const prev = this.main;
        if (prev !== null && this.dir === 0) {
          const d = ((want - prev + 540) % 360) - 180;
          if (Math.abs(d) === 90) this.dir = d > 0 ? 1 : -1;
        } else if (prev !== null && this.dir !== 0) {
          const d = ((want - prev + 540) % 360) - 180;
          if (d !== 0 && Math.sign(d) !== this.dir) { this.reversed = true; this.dir = Math.sign(d) as 1 | -1; }
        }
        this.main = want; this.path.push(want); this.pending = null;
      }
    } else if (want === this.main) this.pending = null;
    if (this.main === null) return { bucket: null, approximate: false, direction: this.dir, reversed: this.reversed };
    if (c.kind === 'mid') {
      // between this bucket and the next one: the turn's direction, or before it is known, where the nose points
      // (near the front a nose to the image's right means 45; near the back it means 135)
      let step: number = this.dir;
      if (step === 0) step = this.main === 0 ? c.dir : this.main === 180 ? -c.dir : 0;
      if (step === 0) return { bucket: this.main, approximate: true, direction: this.dir, reversed: this.reversed };
      return { bucket: norm(this.main + 45 * step), approximate: true, direction: this.dir, reversed: this.reversed };
    }
    if (want === null || want !== this.main) return { bucket: this.main, approximate: true, direction: this.dir, reversed: this.reversed };
    return { bucket: this.main, approximate: false, direction: this.dir, reversed: this.reversed };
  }
}

/** For the quick mode: a 45-degree reading counts toward the nearer main bucket only when exact. */
export const isMain = (b: Bucket): boolean => b % 90 === 0;
export const angleDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
