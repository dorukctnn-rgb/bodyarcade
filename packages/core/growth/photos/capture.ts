// The capture's state machine (SPEC 2.4): the person turns slowly; every frame gets a bucket from the turn tracker, and a
// bucket fills with the sharpest frame that passes every check: the needed points are seen, the body is still, it stayed
// on its spot, and it fills 70-85 % of the picture height (with 300 ms hysteresis on "closer / farther"). Codes only: the
// page words them and speaks them. The guide never locks: "take it anyway" fills the current bucket with the best frame.
import { LM, type Landmark } from '../../types/index.ts';
import { centrality, features, FULL_BUCKETS, QUICK_BUCKETS, TurnTracker, widthOf, type Bucket } from './angle.ts';

export type CaptureMode = 'quick' | 'full';
export type CaptureCue = 'start-front' | 'turn' | 'slower' | 'closer' | 'farther' | 'stay' | 'still' | 'same-way' | 'done' | null;

export interface Shot {
  bucket: Bucket;
  t: number;
  /** the frame's points (raw image fractions), kept with the photo for alignment */
  lm: Landmark[];
  aspect: number;
  sharp: number;
  approximate: boolean;
  /** filled with "take it anyway" (some check did not pass) */
  forced: boolean;
}

export interface CaptureState {
  mode: CaptureMode;
  bucket: Bucket | null;
  filled: Bucket[];
  missing: Bucket[];
  cue: CaptureCue;
  done: boolean;
  /** true on the frame that filled a bucket (for the click sound) */
  justFilled: Bucket | null;
  /** this frame is the new best candidate of its bucket: the page keeps its pixels (the shot uses the last one kept) */
  bestChanged: Bucket | null;
  /** body height / picture height, or null */
  fill: number | null;
}

export const CAPTURE_RULES = {
  visibility: 0.6,
  stillMs: 400,
  /** torso lengths per second. SPEC 2.4 says 0.05 for smoothed points; raw pose points jitter about 0.01 torso per frame,
   *  so a still body measures up to ~0.2 over 400 ms (synthetic and real traces, tools/growth-fixtures). */
  stillSpeed: 0.3,
  /** torso lengths from the first spot (SPEC 0.15; turning on small steps moves the hips more, measured up to ~0.35) */
  stay: 0.5,
  fillMin: 0.7,
  fillMax: 0.85,
  distanceHoldMs: 300,
  /** frames a bucket needs that pass the checks before it fills */
  goodFrames: 4,
  /** a bucket fills when the person leaves it, or after this long in it with no more centred frame for `settleMs` */
  dwellMs: 1500,
  settleMs: 500,
} as const;

const NEEDED = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

/** One frame's shoulders and hips (each point, not their middles: a turn moves each shoulder sideways while the middle stays). */
interface Sample { t: number; pts: [number, number][]; hx: number; hy: number; torso: number }

export interface FrameInput {
  t: number;
  lm: Landmark[] | null;
  aspect: number;
  /** sharpness score of this frame (sharp.ts), when the page measured one */
  sharp?: number | null;
}

export class Capture {
  readonly tracker: TurnTracker;
  private shots = new Map<Bucket, Shot>();
  private best = new Map<Bucket, { shot: Shot; good: number; score: number; at: number }>();
  private enteredAt = 0;
  private hist: Sample[] = [];
  private home: { x: number; y: number } | null = null;
  private dist: { hint: 'closer' | 'farther' | null; since: number; shown: 'closer' | 'farther' | null } = { hint: null, since: 0, shown: null };
  private lastBucket: Bucket | null = null;
  private missedAt = -Infinity;
  private lastFrame: { t: number; lm: Landmark[]; aspect: number; sharp: number; bucket: Bucket | null; approximate: boolean } | null = null;
  /** feet needed (false for a test fixture framed to the knees) */
  readonly mode: CaptureMode;
  private readonly opts: { needFeet?: boolean };
  constructor(mode: CaptureMode = 'quick', opts: { needFeet?: boolean } = {}) {
    this.mode = mode; this.opts = opts;
    this.tracker = new TurnTracker();
  }

  get wanted(): readonly Bucket[] { return this.mode === 'quick' ? QUICK_BUCKETS : FULL_BUCKETS; }
  get result(): Shot[] { return this.wanted.flatMap((b) => { const s = this.shots.get(b); return s ? [s] : []; }); }

  private bodyFill(lm: Landmark[]): number | null {
    const nose = lm[LM.nose], la = lm[LM.leftAnkle], ra = lm[LM.rightAnkle];
    if (!nose || !la || !ra) return null;
    const feetY = Math.max(la.visibility >= 0.5 ? la.y : 0, ra.visibility >= 0.5 ? ra.y : 0);
    if (feetY <= 0) return null;
    // the head reaches above the nose by about one third of the nose-to-shoulder drop, plus hair
    const sh = ((lm[LM.leftShoulder]?.y ?? nose.y) + (lm[LM.rightShoulder]?.y ?? nose.y)) / 2;
    const top = nose.y - Math.max(0.02, (sh - nose.y) * 0.9);
    return (feetY - top) + 0.02;
  }

  push(f: FrameInput): CaptureState {
    let justFilled: Bucket | null = null;
    let bestChanged: Bucket | null = null;
    const feat = features(f.lm, f.aspect);
    const reading = this.tracker.push(feat, f.t);
    let cue: CaptureCue = null;
    let fill: number | null = null;
    if (!f.lm || !feat) {
      this.hist = [];
      return this.state(reading.bucket, this.tracker.path.length ? 'turn' : 'start-front', null, null, null);
    }
    const lm = f.lm;
    const ls = lm[LM.leftShoulder]!, rs = lm[LM.rightShoulder]!, lh = lm[LM.leftHip]!, rh = lm[LM.rightHip]!;
    const s: Sample = { t: f.t, pts: [ls, rs, lh, rh].map((p) => [p.x * f.aspect, p.y] as [number, number]), hx: ((lh.x + rh.x) / 2) * f.aspect, hy: (lh.y + rh.y) / 2, torso: feat.torso };
    this.hist.push(s);
    while (this.hist.length && f.t - this.hist[0]!.t > CAPTURE_RULES.stillMs) this.hist.shift();
    this.home ??= { x: s.hx, y: s.hy };

    // checks
    const needFeet = this.opts.needFeet ?? true;
    const needed = needFeet ? NEEDED : NEEDED.slice(0, 6);
    const seenOk = needed.every((i) => (lm[i]?.visibility ?? 0) >= CAPTURE_RULES.visibility);
    const first = this.hist[0]!;
    const span = Math.max(1, f.t - first.t) / 1000;
    const speed = Math.max(...s.pts.map((p, i) => Math.hypot(p[0] - first.pts[i]![0], p[1] - first.pts[i]![1]))) / s.torso / span;
    const still = f.t - first.t >= CAPTURE_RULES.stillMs * 0.75 && speed < CAPTURE_RULES.stillSpeed;
    const stayed = Math.hypot(s.hx - this.home.x, s.hy - this.home.y) / s.torso < CAPTURE_RULES.stay;
    fill = needFeet ? this.bodyFill(lm) : null;
    let hint: 'closer' | 'farther' | null = null;
    if (fill !== null) hint = fill < CAPTURE_RULES.fillMin ? 'closer' : fill > CAPTURE_RULES.fillMax ? 'farther' : null;
    if (hint !== this.dist.hint) this.dist = { ...this.dist, hint, since: f.t };
    if (f.t - this.dist.since >= CAPTURE_RULES.distanceHoldMs) this.dist.shown = this.dist.hint;
    const framed = !needFeet || (fill !== null && this.dist.shown === null && hint === null);

    const b = reading.bucket;
    const sharp = f.sharp ?? 0;
    this.lastFrame = { t: f.t, lm, aspect: f.aspect, sharp, bucket: b, approximate: reading.approximate };
    // leaving a bucket fills it with its most centred good frame (the widest front, the narrowest side)
    if (this.lastBucket !== null && b !== this.lastBucket && this.wanted.includes(this.lastBucket) && !this.shots.has(this.lastBucket)) {
      const cand = this.best.get(this.lastBucket);
      if (cand && cand.good >= CAPTURE_RULES.goodFrames) { this.shots.set(this.lastBucket, cand.shot); justFilled = this.lastBucket; }
      else this.missedAt = f.t;
    }
    if (b !== this.lastBucket) this.enteredAt = f.t;
    if (b !== null && this.wanted.includes(b) && !this.shots.has(b)) {
      const ok = seenOk && still && stayed && framed && (this.mode === 'full' || !reading.approximate);
      if (ok) {
        const score = centrality(b, widthOf(feat));
        const cur = this.best.get(b);
        const shot: Shot = { bucket: b, t: f.t, lm: lm.map((p) => ({ ...p })), aspect: f.aspect, sharp, approximate: reading.approximate, forced: false };
        // sharpness decides between frames that are about as centred
        if (!cur) { this.best.set(b, { shot, good: 1, score, at: f.t }); bestChanged = b; }
        else {
          cur.good++;
          if (score > cur.score + 0.01 || (score > cur.score - 0.01 && sharp > cur.shot.sharp)) { if (score > cur.score + 0.01) cur.at = f.t; cur.shot = shot; cur.score = Math.max(score, cur.score); bestChanged = b; }
        }
        // standing in a bucket (the start, a step-by-step capture, a very slow turn): it fills once no frame got more centred for a while
        const now = this.best.get(b)!;
        if (now.good >= CAPTURE_RULES.goodFrames && f.t - this.enteredAt >= CAPTURE_RULES.dwellMs && f.t - now.at >= CAPTURE_RULES.settleMs && justFilled === null) { this.shots.set(b, now.shot); justFilled = b; }
      }
    }
    this.lastBucket = b;

    if (this.tracker.path.length === 0) cue = 'start-front';
    else if (reading.reversed) cue = 'same-way';
    else if (!stayed) cue = 'stay';
    else if (this.dist.shown) cue = this.dist.shown;
    else if (f.t - this.missedAt < 2500) cue = 'slower';
    else if (b !== null && !this.shots.has(b) && this.wanted.includes(b) && !still) cue = 'still';
    else cue = 'turn';
    if (this.isDone()) cue = 'done';
    return this.state(b, cue, justFilled, fill, bestChanged);
  }

  /** "Take it anyway": the current bucket (or, before any, the front) gets the last frame. */
  force(): Bucket | null {
    const f = this.lastFrame;
    if (!f) return null;
    const b = f.bucket ?? (this.shots.has(0) ? null : 0);
    if (b === null || !this.wanted.includes(b) || this.shots.has(b)) return null;
    this.shots.set(b, { bucket: b, t: f.t, lm: f.lm.map((p) => ({ ...p })), aspect: f.aspect, sharp: f.sharp, approximate: f.approximate, forced: true });
    return b;
  }

  /** Re-take one direction from the review screen. */
  clear(b: Bucket): void { this.shots.delete(b); this.best.delete(b); }

  isDone(): boolean { return this.wanted.every((b) => this.shots.has(b)); }

  private state(bucket: Bucket | null, cue: CaptureCue, justFilled: Bucket | null, fill: number | null, bestChanged: Bucket | null): CaptureState {
    const filled = this.wanted.filter((b) => this.shots.has(b));
    return { mode: this.mode, bucket, filled, missing: this.wanted.filter((b) => !this.shots.has(b)), cue, done: this.isDone(), justFilled, fill, bestChanged };
  }
}

/** Step-by-step mode (SPEC 2.4 B): the page asks for one direction; it fills after 1 s still in it. */
export const STEP_ORDER: Record<CaptureMode, readonly Bucket[]> = { quick: [0, 90, 180, 270], full: [0, 45, 90, 135, 180, 225, 270, 315] };
