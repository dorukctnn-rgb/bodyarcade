// The capture's state machine (SPEC 2.4): the person turns slowly; every frame gets a bucket from the turn tracker, and a
// bucket fills with the sharpest frame that passes every check: the needed points are seen, the body is still, it stayed
// on its spot, and it fills 70-85 % of the picture height (with 300 ms hysteresis on "closer / farther"). Codes only: the
// page words them and speaks them. The guide never locks: "take it anyway" fills the current bucket with the best frame.
//
// The 360 mode (eight directions) is step by step (SPEC 2.4 mode B; coordinator, 11 Nov): nothing is taken while the person
// turns. The page asks for one direction ("turn to front right and stop"); in it, a "stop" sign shows while the body comes to
// rest, and once it has held still for STEP_RULES.holdMs with the direction, distance and spot checks passing, that frame is
// taken and waits on a small preview for "retake" or "continue". Measured on stock clips that turn without stopping, the
// diagonal photos of a continuous turn could be ~25 degrees off; a stop removes most of that. The quick mode is unchanged.
import { LM, type Landmark } from '../../types/index.ts';
import { ANGLE_RULES, centrality, features, FULL_BUCKETS, isMain, QUICK_BUCKETS, TurnTracker, widthOf, type AngleFeatures, type Bucket } from './angle.ts';

export type CaptureMode = 'quick' | 'full';
export type CaptureCue = 'start-front' | 'turn' | 'slower' | 'closer' | 'farther' | 'stay' | 'still' | 'same-way' | 'turn-to' | 'hold' | 'check' | 'done' | null;

/** The 360 mode's step: where the person is asked to turn, how long they have held still there, the photo waiting for an answer. */
export interface StepState {
  /** directions asked for now: one, or two right after the front (the person may turn either way) */
  targets: Bucket[];
  /** 0..1 of the hold that takes the photo */
  hold: number;
  /** a photo taken and waiting for "retake" or "continue" */
  pending: Bucket | null;
}

export const STEP_RULES = {
  /** SPEC 2.4 mode B: one second still in the direction */
  holdMs: 1000,
  /** A slow turn barely moves the hips and shoulders (the "still" check passes at 15 degrees a second) but it changes the
   *  body's width and where the nose points: over the hold, the spread of their 4-frame means must stay under these
   *  (torso lengths; a 10 deg/s turn spreads the width ~0.09 a second at a diagonal, standing still spreads it ~0.02). */
  turnWidth: 0.06,
  turnNose: 0.04,
  /** a diagonal: the body's width against the front photo's, about 32 to 60 degrees of turn (|cos| 0.85 to 0.5) */
  diagBand: [0.5, 0.85],
} as const;

/** The spread (max - min) of the means of consecutive groups of four values: a slow drift shows, a frame's jitter does not. */
export function driftOf(v: readonly number[]): number {
  if (v.length < 4) return 0;
  const means: number[] = [];
  for (let i = 0; i + 4 <= v.length; i += 2) means.push((v[i]! + v[i + 1]! + v[i + 2]! + v[i + 3]!) / 4);
  return Math.max(...means) - Math.min(...means);
}

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
  /** the 360 mode's step (null in the quick mode) */
  step: StepState | null;
  /** true on the frame that took a 360 photo now waiting for an answer (the page keeps its pixels and shows the preview) */
  justPending: Bucket | null;
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
  // the 360 mode's step
  private targets: Bucket[] = [0];
  private stepDir: 1 | -1 | 0 = 0;
  private holdSince: number | null = null;
  private pendingShot: Shot | null = null;
  private holdHist: { w: number; n: number }[] = [];
  private lastAccepted: Bucket | null = null;
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
      this.holdSince = null;
      const idle: CaptureCue = this.pendingShot ? 'check' : this.tracker.path.length ? (this.mode === 'full' ? 'turn-to' : 'turn') : 'start-front';
      return this.state(reading.bucket, idle, null, null, null);
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
    if (this.mode === 'full') return this.stepFrame(f, lm, feat, b, reading.approximate, reading.reversed, { seenOk, still, stayed, framed }, fill);
    // leaving a bucket fills it with its most centred good frame (the widest front, the narrowest side)
    if (this.lastBucket !== null && b !== this.lastBucket && this.wanted.includes(this.lastBucket) && !this.shots.has(this.lastBucket)) {
      const cand = this.best.get(this.lastBucket);
      if (cand && cand.good >= CAPTURE_RULES.goodFrames) { this.shots.set(this.lastBucket, cand.shot); justFilled = this.lastBucket; }
      else this.missedAt = f.t;
    }
    if (b !== this.lastBucket) this.enteredAt = f.t;
    if (b !== null && this.wanted.includes(b) && !this.shots.has(b)) {
      const ok = seenOk && still && stayed && framed && !reading.approximate; // the quick mode takes exact readings only (the 360 mode returned above)
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

  /** "Take it anyway": the current bucket (or, before any, the front) gets the last frame. In the 360 mode the frame waits on
   *  the preview like any other (the direction the person is in when it is one asked for, else the first one asked for). */
  force(): Bucket | null {
    const f = this.lastFrame;
    if (!f) return null;
    if (this.mode === 'full') {
      if (this.pendingShot || !this.targets.length) return null;
      const b = f.bucket !== null && this.targets.includes(f.bucket) ? f.bucket : this.targets[0]!;
      this.pendingShot = { bucket: b, t: f.t, lm: f.lm.map((p) => ({ ...p })), aspect: f.aspect, sharp: f.sharp, approximate: f.approximate, forced: true };
      return b;
    }
    const b = f.bucket ?? (this.shots.has(0) ? null : 0);
    if (b === null || !this.wanted.includes(b) || this.shots.has(b)) return null;
    this.shots.set(b, { bucket: b, t: f.t, lm: f.lm.map((p) => ({ ...p })), aspect: f.aspect, sharp: f.sharp, approximate: f.approximate, forced: true });
    return b;
  }

  /** Re-take one direction from the review screen (in the 360 mode it becomes the direction asked for). */
  clear(b: Bucket): void {
    this.shots.delete(b); this.best.delete(b);
    if (this.mode === 'full') {
      this.pendingShot = null; this.holdSince = null; this.targets = [b];
      // the steps start again at b: its neighbour before it counts as the last photo (diagonalAt)
      this.lastAccepted = ((((b - 45 * (this.stepDir || 1)) % 360) + 360) % 360) as Bucket;
    }
  }

  /** The 360 photo waiting on the preview, if any. */
  get pending(): Shot | null { return this.pendingShot; }

  /** "Continue": the waiting 360 photo is kept and the next direction is asked for. Returns its direction. */
  accept(): Bucket | null {
    const s = this.pendingShot;
    if (!s) return null;
    this.shots.set(s.bucket, s);
    this.pendingShot = null; this.holdSince = null; this.lastAccepted = s.bucket;
    // the turn's way: the first direction after the front says it (front right, right side, back right: the angles grow)
    if (this.stepDir === 0 && s.bucket !== 0 && s.bucket !== 180) this.stepDir = s.bucket < 180 ? 1 : -1;
    if (this.isDone()) { this.targets = []; return s.bucket; }
    if (this.stepDir === 0) {
      this.targets = ([45, 315] as Bucket[]).filter((x) => !this.shots.has(x));
      if (this.targets.length) return s.bucket;
      this.stepDir = 1;
    }
    let next = s.bucket;
    for (let k = 0; k < 8; k++) { next = ((((next + 45 * this.stepDir) % 360) + 360) % 360) as Bucket; if (!this.shots.has(next)) break; }
    this.targets = [next];
    return s.bucket;
  }

  /**
   * Is the body at a diagonal asked for? Its width against the front photo's width (the same person, the same clothes):
   * |cos 45| = 0.71, so STEP_RULES.diagBand (about 32 to 60 degrees). Which diagonal it is comes from the steps: the photo
   * before it was its main neighbour (the tracker's own class runs ahead at a diagonal: at the back right the body is as
   * wide as its "wide" class, so it may already say "back"); right after the front, where the nose points says which way.
   */
  private diagonalAt(feat: AngleFeatures): Bucket | null {
    const diags = this.targets.filter((t) => !isMain(t));
    if (!diags.length) return null;
    const front = this.shots.get(0);
    const w0 = front ? widthOf(features(front.lm, front.aspect) ?? feat) : null;
    if (w0 === null || w0 <= 0) return null;
    const ratio = widthOf(feat) / w0;
    if (ratio < STEP_RULES.diagBand[0] || ratio > STEP_RULES.diagBand[1]) return null;
    for (const t of diags) {
      const d = this.stepDir !== 0 ? this.stepDir : t === 45 ? 1 : -1;
      const before = ((((t - 45 * d) % 360) + 360) % 360) as Bucket;
      if (this.lastAccepted !== before) continue;
      if (this.stepDir === 0) {
        // front right or front left: the nose (seen from the front half, the face is there)
        const side = feat.nose > ANGLE_RULES.nose ? 45 : feat.nose < -ANGLE_RULES.nose ? 315 : null;
        if (side !== t) continue;
      }
      return t;
    }
    return null;
  }

  /** "Retake": the waiting 360 photo is dropped; the same direction is asked for again. */
  retake(): void { this.pendingShot = null; this.holdSince = null; }

  isDone(): boolean { return this.wanted.every((b) => this.shots.has(b)); }

  /** One frame of the 360 mode: no photo while turning; in a direction asked for, a still hold of STEP_RULES.holdMs takes one. */
  private stepFrame(f: FrameInput, lm: Landmark[], feat: AngleFeatures, b: Bucket | null, approximate: boolean, reversed: boolean, ok: { seenOk: boolean; still: boolean; stayed: boolean; framed: boolean }, fill: number | null): CaptureState {
    if (this.pendingShot) return this.state(b, 'check', null, fill, null);
    // the direction is right: a main direction read from its own view (not from the turn order alone); a diagonal by the
    // person's own width (diagonalAt), which does not flicker at the edge of the tracker's classes
    const diag = this.diagonalAt(feat);
    const at: Bucket | null = diag ?? (b !== null && isMain(b) && !approximate && this.targets.includes(b) ? b : null);
    const inTarget = at !== null;
    const good = inTarget && ok.seenOk && ok.stayed && ok.framed;
    let justPending: Bucket | null = null;
    if (good && ok.still) {
      if (this.holdSince === null) { this.holdSince = f.t; this.holdHist = []; }
      this.holdHist.push({ w: widthOf(feat), n: feat.nose });
      // still turning, slowly: the hold starts again from this frame
      if (driftOf(this.holdHist.map((h) => h.w)) > STEP_RULES.turnWidth || driftOf(this.holdHist.map((h) => h.n)) > STEP_RULES.turnNose) { this.holdSince = f.t; this.holdHist = this.holdHist.slice(-1); }
    } else { this.holdSince = null; this.holdHist = []; }
    if (good && ok.still && this.holdSince !== null && f.t - this.holdSince >= STEP_RULES.holdMs) {
      this.pendingShot = { bucket: at!, t: f.t, lm: lm.map((p) => ({ ...p })), aspect: f.aspect, sharp: f.sharp ?? 0, approximate: !isMain(at!), forced: false };
      justPending = at;
    }
    let cue: CaptureCue;
    if (this.isDone()) cue = 'done';
    else if (justPending !== null) cue = 'check';
    else if (this.tracker.path.length === 0) cue = 'start-front';
    else if (!ok.stayed) cue = 'stay';
    else if (this.dist.shown) cue = this.dist.shown;
    else if (inTarget) cue = 'hold';
    else if (reversed && this.stepDir !== 0) cue = 'same-way';
    else cue = 'turn-to';
    return this.state(b, cue, null, fill, justPending, justPending);
  }

  private state(bucket: Bucket | null, cue: CaptureCue, justFilled: Bucket | null, fill: number | null, bestChanged: Bucket | null, justPending: Bucket | null = null): CaptureState {
    const filled = this.wanted.filter((b) => this.shots.has(b));
    const hold = this.pendingShot ? 1 : this.holdSince === null || !this.lastFrame ? 0 : Math.min(1, (this.lastFrame.t - this.holdSince) / STEP_RULES.holdMs);
    const step: StepState | null = this.mode === 'full' ? { targets: [...this.targets], hold, pending: this.pendingShot?.bucket ?? null } : null;
    return { mode: this.mode, bucket, filled, missing: this.wanted.filter((b) => !this.shots.has(b)), cue, done: this.isDone(), justFilled, fill, bestChanged, step, justPending };
  }
}

/** Step-by-step order (SPEC 2.4 B): the 360 mode asks for these one by one, either way round after the front. */
export const STEP_ORDER: Record<CaptureMode, readonly Bucket[]> = { quick: [0, 90, 180, 270], full: [0, 45, 90, 135, 180, 225, 270, 315] };
