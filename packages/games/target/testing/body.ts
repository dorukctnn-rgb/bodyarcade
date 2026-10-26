// A virtual player for tests and tools: two hands with a top speed and an arm that is only so long, a torso that can step
// sideways, feet that can move along the floor, a hip that can drop, a lean, and a pose rate. Each pose frame goes
// through the REAL handHit detector of the movement library, so what the game reads is exactly what a camera round would
// give it (positions in T, speeds in A per second, `hit.t` on a pose clock that is not the simulation clock).
// Test support only; nothing in production imports it.
import type { BodyProfile, Features, InputFrame, Vec2 } from '../../../core/types/index.ts';
import { FIXED_DT } from '../../../core/types/index.ts';
import { stepTime } from '../../../core/loop/clock.ts';
import { createHandHitDetector } from '../../../core/moves/handHit.ts';
import type { ExplainingDetector } from '../../../core/moves/kit.ts';
import { profileOf, SHAPE_FULL, SHAPE_UPPER } from '../../../core/moves/testing/rig.ts';

export type Hand = 'L' | 'R';

export interface BodyOptions {
  profile?: BodyProfile;
  /** Pose frames per second (default 30). */
  hz?: number;
  /** Where the pose clock starts relative to the simulation clock (ms): the two are different clocks in the product. */
  clockOffset?: number;
  /** Feet in view (full framing). */
  feet?: boolean;
}

export interface Goal { x: number; y: number; /** top speed in T per second */ speed: number }

const SIDES = ['L', 'R'] as const;
/** Half the shoulder width and the floor line in T, as the rig's figure has them. */
const HALF_W = 0.4;
const FLOOR_Y = -1.8;

export class VirtualBody {
  readonly profile: BodyProfile;
  readonly hz: number;
  readonly offset: number;
  readonly feet: boolean;
  /** Arm length in T. */
  readonly arm: number;
  /** Hand centres, body space (T). */
  hand: Record<Hand, Vec2> = { L: { x: -0.5, y: 0.1 }, R: { x: 0.5, y: 0.1 } };
  goal: Record<Hand, Goal> = { L: { x: -0.5, y: 0.1, speed: 0 }, R: { x: 0.5, y: 0.1, speed: 0 } };
  /** The torso's sideways step: where it is, where it is going, and how fast (T per second). */
  shift = 0;
  shiftGoal = 0;
  shiftSpeed = 2.5;
  /** Where the feet are along the floor (x, T) and where they are going; null: stay put. */
  foot: Record<Hand, number> = { L: -0.25, R: 0.25 };
  footGoal: Record<Hand, number | null> = { L: null, R: null };
  footSpeed = 4;
  /** Hip drop (T, positive = down) and the lean in shoulder widths, set by the test. */
  drop = 0;
  lean = 0;
  handsSeen = true;
  /** Nobody in view: the detector skips these frames. */
  absent = false;
  private readonly detector: ExplainingDetector;
  private last: Record<string, number> = {};
  private seq = 0;
  private every: number;

  constructor(o: BodyOptions = {}) {
    this.feet = o.feet ?? false;
    this.profile = o.profile ?? profileOf(this.feet ? SHAPE_FULL : SHAPE_UPPER, this.feet ? 'full' : 'upper');
    this.arm = (this.profile.A ?? this.profile.T * 1.15) / this.profile.T;
    this.hz = o.hz ?? 30;
    this.offset = o.clockOffset ?? 123_456;
    this.every = Math.max(1, Math.round(60 / this.hz));
    this.detector = createHandHitDetector(this.profile, { feet: this.feet ? 1 : 0 }) as ExplainingDetector;
  }

  /** Aims a hand at a point; `speed` is the top speed in T per second. */
  aim(h: Hand, x: number, y: number, speed: number): void { this.goal[h] = { x, y, speed }; }

  /** Both hands to rest, by the sides at belly height (following the torso's step). */
  rest(): void {
    this.aim('L', this.shiftGoal - 0.5, 0.1, 6);
    this.aim('R', this.shiftGoal + 0.5, 0.1, 6);
  }

  /** The torso's shoulder for a hand, where the arm hangs from. */
  shoulderOf(h: Hand): Vec2 { return { x: this.shift + (h === 'L' ? -HALF_W : HALF_W), y: 1 - this.drop }; }

  /** Moves the body for step k (dt = 1/60) and, on the steps a pose frame is due, runs the detector. Returns this step's channels. */
  step(k: number): Record<string, number> {
    const mv = (v: number, goal: number, speed: number): number => { const d = goal - v; const r = speed * FIXED_DT; return Math.abs(d) <= r ? goal : v + Math.sign(d) * r; };
    this.shift = mv(this.shift, this.shiftGoal, this.shiftSpeed);
    for (const h of SIDES) {
      const p = this.hand[h], g = this.goal[h];
      const dx = g.x - p.x, dy = g.y - p.y;
      const d = Math.hypot(dx, dy);
      const reach = g.speed * FIXED_DT;
      if (d <= reach || d < 1e-9) { p.x = g.x; p.y = g.y; } else { p.x += (dx / d) * reach; p.y += (dy / d) * reach; }
      // an arm is only so long
      const s = this.shoulderOf(h);
      const ax = p.x - s.x, ay = p.y - s.y;
      const len = Math.hypot(ax, ay);
      if (len > this.arm) { p.x = s.x + (ax / len) * this.arm; p.y = s.y + (ay / len) * this.arm; }
      const fg = this.footGoal[h];
      if (fg !== null) this.foot[h] = mv(this.foot[h], fg, this.footSpeed);
    }
    if (k % this.every === 0) {
      const f = this.features(stepTime(k) + this.offset);
      this.detector.push(f);
      this.last = { ...(this.detector.channels?.() ?? {}), lean: this.lean };
    }
    return this.last;
  }

  private features(t: number): Features {
    const z: Vec2 = { x: 0, y: 0 };
    const hipY = -this.drop;
    const s = this.shift;
    const hand: [Vec2, Vec2] = [{ ...this.hand.L }, { ...this.hand.R }];
    const ankle: [Vec2, Vec2] = [{ x: this.foot.L, y: FLOOR_Y }, { x: this.foot.R, y: FLOOR_Y }];
    return {
      t, seq: this.seq++, ok: !this.absent,
      seen: { head: true, shoulders: true, elbows: true, hands: this.handsSeen, hips: true, knees: this.feet, ankles: this.feet, feet: this.feet },
      head: { x: s, y: 1.45 + hipY }, shoulder: { x: s, y: 1 + hipY }, hip: { x: s, y: hipY },
      shoulders: [{ x: s - HALF_W, y: 1 + hipY }, { x: s + HALF_W, y: 1 + hipY }],
      hips: [{ x: s - 0.25, y: hipY }, { x: s + 0.25, y: hipY }],
      elbow: [{ x: s - 0.5, y: 0.6 + hipY }, { x: s + 0.5, y: 0.6 + hipY }],
      hand,
      knee: [{ x: s - 0.25, y: -0.9 }, { x: s + 0.25, y: -0.9 }],
      ankle,
      foot: [{ x: ankle[0].x, y: FLOOR_Y - 0.05 }, { x: ankle[1].x, y: FLOOR_Y - 0.05 }],
      rise: -this.drop, drop: this.drop, headDrop: this.drop, lean: this.lean, shoulderSpan: 1, vel: { nose: [z, z] },
    };
  }
}

/** The InputFrame of step k for one player's channels (what the InputHub hands the game). */
export function frameOf(k: number, channels: Readonly<Record<string, number>>, o: { ok?: boolean } = {}): InputFrame {
  return { t: stepTime(k), source: 'test', tracking: o.ok === false ? { ok: false, code: 'no_person' } : { ok: true }, channels, events: [] };
}

/** Local2: two players' channels in one frame (the top level mirrors Player 1, as the hub does). */
export function frame2(k: number, c1: Readonly<Record<string, number>>, c2: Readonly<Record<string, number>>, o: { ok1?: boolean; ok2?: boolean } = {}): InputFrame {
  const t1 = o.ok1 === false ? { ok: false as const, code: 'player_missing' as const } : { ok: true as const };
  const t2 = o.ok2 === false ? { ok: false as const, code: 'player_missing' as const } : { ok: true as const };
  return {
    t: stepTime(k), source: 'test', tracking: t1, channels: c1, events: [],
    players: { 1: { tracking: t1, channels: c1, events: [] }, 2: { tracking: t2, channels: c2, events: [] } },
  };
}
