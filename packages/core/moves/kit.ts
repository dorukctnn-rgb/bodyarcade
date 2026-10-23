// Building blocks shared by the movement library detectors M4..M16 (game-design.md 0.5). Everything here is pure.
//
// Conventions every detector follows
// - Input is `Features` in body space (types/body.ts): origin at the rest hip midpoint, unit = torso length T on both
//   axes, +x = the player's right as seen in the mirror, +y = up. Thresholds written in W (shoulder width), A (arm
//   length) or U (thigh length) in game-design.md are converted with `scalesOf(profile)`; they never depend on pixels.
// - Time is the pose frame time (`Features.t`, ms). Windows and dwell times are in milliseconds, never in frames, so
//   a detector behaves the same at 30, 15 and 10 Hz.
// - Hysteresis everywhere: an enter threshold, a lower exit threshold, and a refractory time where a repeat is possible.
// - A frame with `ok === false` (no person) is skipped; after `lostMs` the state is cleared and open holds end.
// - Every detector can say why nothing happened (`explain`), with a MissCode the UI turns into a spoken sentence
//   (game-design.md 0.1 item 3: "hips not low enough", "wrong hand", "knees out of view").
import type { BodyPart, BodyProfile, Detector, Features, MovementEvent, MovementId, Side, Vec2 } from '../types/index.ts';

// ───────── body scales ─────────

/** Arm length over torso length for an average adult (Drillis and Contini); used until the profile has a measured A. */
export const DEFAULT_ARM_T = 1.15;
/** Thigh (hip to knee, vertical) over torso length; P's synthetic figure uses 0.9, real adults are about 0.85. */
export const DEFAULT_THIGH_T = 0.9;

export interface Scales {
  /** Shoulder width W in torso lengths. */
  w: number;
  /** Arm length A (shoulder to wrist, arms hanging) in torso lengths. */
  a: number;
  /** Thigh length U in torso lengths. */
  u: number;
}

/** The profile's W, A, U expressed in T, the unit of body space. Missing A or U fall back to average proportions. */
export function scalesOf(p: BodyProfile): Scales {
  const T = Math.max(p.T, 1e-6);
  return {
    w: Math.max(p.W / T, 0.2),
    a: p.A !== undefined && p.A > 0 ? p.A / T : DEFAULT_ARM_T,
    u: p.U !== undefined && p.U > 0 ? p.U / T : DEFAULT_THIGH_T,
  };
}

// ───────── numeric options ─────────

export type Opts = Record<string, number> | undefined;

/** A finite numeric option, or undefined. Options are numbers only (DetectorFactory); flags are 0 and 1. */
export const num = (o: Opts, k: string): number | undefined => {
  const v = o?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

export const flag = (o: Opts, k: string, dflt = false): boolean => {
  const v = num(o, k);
  return v === undefined ? dflt : v !== 0;
};

/** Defaults overridden by the finite numbers in `o` whose names exist in `d` (a misspelt option is ignored, not trusted). */
export function withDefaults<D extends Record<string, number>>(d: D, o: Opts): D {
  const out: Record<string, number> = { ...d };
  if (o) for (const k of Object.keys(d)) { const v = num(o, k); if (v !== undefined) out[k] = v; }
  return out as D;
}

// ───────── geometry ─────────

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const RAD = Math.PI / 180;

/** Direction of v in degrees: 0 = +x (screen right), 90 = up, -90 = down; range (-180, 180]. */
export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x) / RAD;

/** Smallest absolute difference between two directions, degrees, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Angle at `b` between the segments b-a and b-c, degrees, 0..180 (180 = straight). */
export function jointAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const u = sub(a, b), v = sub(c, b);
  const lu = len(u), lv = len(v);
  if (lu < 1e-9 || lv < 1e-9) return 180;
  return Math.acos(clamp((u.x * v.x + u.y * v.y) / (lu * lv), -1, 1)) / RAD;
}

export const sideOf = (i: number): Side => (i === 0 ? 'L' : 'R');
export const SIDES: readonly [Side, Side] = ['L', 'R'];

// ───────── time series ─────────

/** Numbers over time, kept for `spanMs` (a detector's short memory: peaks for `explain`, windows for speeds). */
export class Series {
  private t: number[] = [];
  private v: number[] = [];
  readonly spanMs: number;
  constructor(spanMs: number) { this.spanMs = spanMs; }

  push(t: number, v: number): void {
    this.t.push(t); this.v.push(v);
    const cut = t - this.spanMs;
    let n = 0;
    while (n < this.t.length - 1 && (this.t[n] as number) < cut) n++;
    if (n > 0) { this.t.splice(0, n); this.v.splice(0, n); }
  }

  get size(): number { return this.t.length; }
  get last(): number | undefined { return this.v[this.v.length - 1]; }
  get lastT(): number | undefined { return this.t[this.t.length - 1]; }
  clear(): void { this.t = []; this.v = []; }

  /** Values from the last `windowMs` (all when omitted), measured back from the newest sample. */
  values(windowMs?: number): number[] {
    if (windowMs === undefined || this.t.length === 0) return this.v.slice();
    const cut = (this.t[this.t.length - 1] as number) - windowMs;
    const out: number[] = [];
    for (let i = 0; i < this.t.length; i++) if ((this.t[i] as number) >= cut) out.push(this.v[i] as number);
    return out;
  }

  max(windowMs?: number): number | undefined { const a = this.values(windowMs); return a.length ? Math.max(...a) : undefined; }
  min(windowMs?: number): number | undefined { const a = this.values(windowMs); return a.length ? Math.min(...a) : undefined; }
  mean(windowMs?: number): number | undefined { const a = this.values(windowMs); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : undefined; }

  /** Population standard deviation; undefined with fewer than 3 samples. */
  std(windowMs?: number): number | undefined {
    const a = this.values(windowMs);
    if (a.length < 3) return undefined;
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
  }
}

/** A point over time, with velocities from displacements over a short window (robust against jitter at any rate). */
export class Track {
  private t: number[] = [];
  private x: number[] = [];
  private y: number[] = [];
  readonly spanMs: number;
  constructor(spanMs = 600) { this.spanMs = spanMs; }

  push(t: number, p: Vec2): void {
    this.t.push(t); this.x.push(p.x); this.y.push(p.y);
    const cut = t - this.spanMs;
    let n = 0;
    while (n < this.t.length - 2 && (this.t[n] as number) < cut) n++;
    if (n > 0) { this.t.splice(0, n); this.x.splice(0, n); this.y.splice(0, n); }
  }

  get size(): number { return this.t.length; }
  clear(): void { this.t = []; this.x = []; this.y = []; }
  get last(): Vec2 | undefined { const i = this.t.length - 1; return i < 0 ? undefined : { x: this.x[i] as number, y: this.y[i] as number }; }
  get lastT(): number | undefined { return this.t[this.t.length - 1]; }

  /** Index of the oldest sample not older than `windowMs`; when only the newest qualifies, its predecessor if it is at most 2.5 windows old. */
  private from(windowMs: number): number {
    const n = this.t.length;
    if (n < 2) return -1;
    const now = this.t[n - 1] as number;
    for (let i = 0; i < n - 1; i++) if (now - (this.t[i] as number) <= windowMs + 1e-6) return i;
    return now - (this.t[n - 2] as number) <= windowMs * 2.5 ? n - 2 : -1;
  }

  /** Velocity in units per second over about `windowMs`; zero when the window holds no earlier sample. */
  velocity(windowMs = 120): Vec2 {
    const j = this.from(windowMs);
    if (j < 0) return { x: 0, y: 0 };
    const n = this.t.length - 1;
    const dt = ((this.t[n] as number) - (this.t[j] as number)) / 1000;
    if (dt < 0.02) return { x: 0, y: 0 };
    return { x: ((this.x[n] as number) - (this.x[j] as number)) / dt, y: ((this.y[n] as number) - (this.y[j] as number)) / dt };
  }

  speed(windowMs = 120): number { return len(this.velocity(windowMs)); }

  /** The segment covered in the last `windowMs`: where it started and where it is now (the swipe trace of M7). */
  segment(windowMs = 150): { from: Vec2; to: Vec2; ms: number } | null {
    const j = this.from(windowMs);
    if (j < 0) return null;
    const n = this.t.length - 1;
    return { from: { x: this.x[j] as number, y: this.y[j] as number }, to: { x: this.x[n] as number, y: this.y[n] as number }, ms: (this.t[n] as number) - (this.t[j] as number) };
  }
}

// ───────── visibility with a grace period ─────────

/**
 * `Features.seen` flickers when a landmark sits near the visibility threshold; a hand blurred for one frame must not
 * cancel a hit. A part counts as seen while it was seen within the grace period, and `unseenFor` says for how long
 * it has been missing (tech.md 4.1: below 0.5 for more than 0.5 s means "step back into view").
 */
export class Visibility {
  private last: Partial<Record<BodyPart, number>> = {};
  private first = -Infinity;

  update(f: Features): void {
    if (this.first === -Infinity) this.first = f.t;
    for (const k of Object.keys(f.seen) as BodyPart[]) if (f.seen[k]) this.last[k] = f.t;
  }

  seen(part: BodyPart, t: number, graceMs = 250): boolean {
    const s = this.last[part];
    return s !== undefined && t - s <= graceMs;
  }

  /** Milliseconds the part has been missing; 0 while seen; since the first frame when never seen. */
  unseenFor(part: BodyPart, t: number): number {
    const s = this.last[part];
    return s === undefined ? Math.max(0, t - this.first) : Math.max(0, t - s);
  }

  reset(): void { this.last = {}; this.first = -Infinity; }
}

/** Frame gate: skips frames without a person and says when the person has been gone for `lostMs` (state is cleared once). */
export class PersonGate {
  private lastOk = -Infinity;
  private lostReported = false;
  readonly lostMs: number;
  constructor(lostMs = 600) { this.lostMs = lostMs; }

  /** 'ok' for a usable frame, 'gap' while the person is briefly missing, 'lost' exactly once when the gap passes lostMs. */
  step(f: Features): 'ok' | 'gap' | 'lost' {
    if (f.ok) { this.lastOk = f.t; this.lostReported = false; return 'ok'; }
    if (!this.lostReported && f.t - this.lastOk > this.lostMs) { this.lostReported = true; return 'lost'; }
    return 'gap';
  }

  reset(): void { this.lastOk = -Infinity; this.lostReported = false; }
}

// ───────── hysteresis ─────────

/** A Schmitt trigger: becomes true at `on` or above, back to false below `off` (off < on). */
export class Schmitt {
  state = false;
  readonly on: number;
  readonly off: number;
  constructor(on: number, off: number) { this.on = on; this.off = off; }
  update(v: number): boolean {
    if (this.state) { if (v < this.off) this.state = false; } else if (v >= this.on) this.state = true;
    return this.state;
  }
  reset(): void { this.state = false; }
}

// ───────── why a move did not happen ─────────

/**
 * Reason codes for a miss or a form note. The UI maps each code to one spoken sentence (i18n key `miss.<code>`);
 * `got` and `need` carry the measured and the required value in the detector's own unit (degrees, T, A per second ...).
 */
export type MissCode =
  // visibility
  | 'person_out' | 'head_out_of_view' | 'hands_out_of_view' | 'elbows_out_of_view' | 'hips_out_of_view' | 'knees_out_of_view' | 'feet_out_of_view'
  // legs and hips
  | 'hips_not_low' | 'hips_not_up' | 'knee_not_high' | 'same_leg_twice' | 'feet_not_wide' | 'feet_not_together' | 'foot_not_down'
  // arms
  | 'arms_not_up' | 'arms_not_down' | 'arms_not_out' | 'use_both_arms' | 'wrong_hand' | 'hands_apart' | 'elbows_bent'
  // reaching and hitting
  | 'not_reached' | 'too_slow' | 'too_brief' | 'grab_higher' | 'pull_more' | 'pull_faster'
  // trunk
  | 'turn_more' | 'turn_shoulders' | 'bend_more' | 'wrong_side' | 'hips_shifted' | 'bending_forward' | 'body_not_straight'
  // poses and holds
  | 'limb_off' | 'move_more' | 'hold_still' | 'held_too_short';

export interface Miss {
  code: MissCode;
  /** What was reached, in the detector's unit. */
  got?: number;
  /** What was needed. */
  need?: number;
  side?: Side;
  /** The limb or part that is off (poseMatch), e.g. 'armUpperL'. */
  limb?: string;
  /** The target (handHit). */
  target?: number;
}

export interface Explains {
  /** Why the last attempt in the last `windowMs` did not count (or the form note), or null when there is nothing to say. */
  explain(windowMs?: number): Miss | null;
}

export type ExplainingDetector = Detector & Explains;

export const canExplain = (d: Detector): d is ExplainingDetector => typeof (d as Partial<Explains>).explain === 'function';

/** The part a MissCode about missing visibility refers to, for `Visibility.unseenFor`. */
export const VISIBILITY_MISS: Partial<Record<BodyPart, MissCode>> = {
  head: 'head_out_of_view', hands: 'hands_out_of_view', elbows: 'elbows_out_of_view', hips: 'hips_out_of_view',
  knees: 'knees_out_of_view', ankles: 'feet_out_of_view', feet: 'feet_out_of_view', shoulders: 'person_out',
};

// ───────── events ─────────

export function ev(id: MovementId, kind: MovementEvent['kind'], t: number, rest: Omit<Partial<MovementEvent>, 'id' | 'kind' | 't'> = {}): MovementEvent {
  return { id, kind, t, ...rest };
}

/** Which landmark groups a movement needs to be seen (tech.md 4.1 gate): `step back into view` when missing for 0.5 s. */
export type Needs = readonly BodyPart[];
