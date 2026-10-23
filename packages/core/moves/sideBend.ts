// M9 side bend (game-design.md 0.5; card 19 Limbo Bend): the trunk leans left or right about the hips.
//
// theta = the angle between the line hip midpoint -> shoulder midpoint and the vertical, in degrees, minus the base angle
// of the calibrated stance; positive = the shoulders lean toward the player's right (as seen in the mirror).
//   channels  bend (theta, degrees), bend.t (time of the pose frame), rate (degrees per second), torso (length of the
//             hip-shoulder line in T: about 1 in a side bend, shorter when the body folds forward), hipShift (hip
//             midpoint x in W: sliding the hips is not bending), armsUp (lower hand minus nose, T), held (ms the
//             current bend has been steady)
//   events    holdStart / holdEnd (with `holdMs` > 0, default 300): a bend of at least `minBend` degrees that stays
//             within `steadyTol` degrees of where it settled; side L or R, value = the angle at holdStart and the
//             hold time in ms at holdEnd
// Why a bend is not right (`explain`): bending_forward (torso under `forwardMin`), hips_shifted (hips more than 0.35 W
// off while bending). The gates of the game are judged by `BendTester`, which also names bend_more, bend_less,
// wrong_side, arms_not_up and held_too_short.
import type { BodyProfile, DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, Series, Track, Visibility, clamp, ev, len, scalesOf, sub, withDefaults, RAD, type ExplainingDetector, type Miss } from './kit.ts';

export const SIDE_BEND_DEFAULTS = {
  minBend: 10,        // degrees: a hold needs at least this bend
  steadyTol: 4,       // degrees: "steady" (unmeasured)
  holdMs: 300,        // M9 / card 19: 0.3 s; 0 turns the hold events off
  forwardMin: 0.85,   // torso shorter than this share of T: folding forward (unmeasured)
  hipMax: 0.35,       // hips off centre, W (card 19)
  graceMs: 250,
  lostMs: 600,
} as const;

/** The base angle of the calibrated stance (the line hips to shoulders against the vertical), degrees. */
export function baseAngle(p: BodyProfile): number {
  const T = Math.max(p.T, 1e-6);
  return Math.atan2((p.rest.shoulderX - p.rest.hipX) / T, (p.rest.hipY - p.rest.shoulderY) / T) / RAD;
}

export const createSideBendDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(SIDE_BEND_DEFAULTS, opts);
  const base = baseAngle(p);
  const { w } = scalesOf(p);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const angleTrack = new Track(400);
  const torsoSeries = new Series(3000);
  const hipSeries = new Series(3000);
  const bendSeries = new Series(3000);
  let ch: Record<string, number> = {};
  let theta = 0, nowT = 0, any = false;
  // hold: where the bend settled and since when
  let settled: { angle: number; since: number } | null = null;
  let holding = false;
  let holdSince = 0, holdLastT = 0, holdSide: Side = 'R';

  function endHold(t: number, out: MovementEvent[]): void {
    if (holding) out.push(ev('sideBend', 'holdEnd', t, { side: holdSide, value: holdLastT - holdSince }));
    holding = false; settled = null;
  }

  return {
    id: 'sideBend',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { endHold(f.t, out); angleTrack.clear(); ch = {}; return out; }
      if (g !== 'ok') return out;
      const v = sub(f.shoulder, f.hip);
      theta = Math.atan2(v.x, v.y) / RAD - base;
      const torso = len(v);
      const hipShift = f.hip.x / w;
      const armsUp = Math.min(f.hand[0].y, f.hand[1].y) - f.head.y;
      angleTrack.push(f.t, { x: theta, y: 0 });
      torsoSeries.push(f.t, torso); hipSeries.push(f.t, hipShift); bendSeries.push(f.t, theta);
      const handsSeen = vis.seen('hands', f.t, o.graceMs);

      if (o.holdMs > 0) {
        const bent = Math.abs(theta) >= o.minBend;
        // A hold starts when the angle stays within the tolerance of where it settled for holdMs; once held, the
        // anchor follows the angle slowly and the hold lets go at 1.5 times the tolerance.
        const tol = holding ? 1.5 * o.steadyTol : o.steadyTol;
        if (!bent) endHold(f.t, out);
        else if (!settled || Math.abs(theta - settled.angle) > tol) {
          if (holding) endHold(f.t, out);
          settled = { angle: theta, since: f.t };
        } else {
          if (holding) settled.angle += 0.35 * (theta - settled.angle);
          holdLastT = f.t;
          if (!holding && f.t - settled.since >= o.holdMs) {
            holding = true; holdSince = settled.since; holdSide = theta > 0 ? 'R' : 'L';
            out.push(ev('sideBend', 'holdStart', f.t, { side: holdSide, value: theta }));
          }
        }
      }
      ch = {
        bend: theta, 'bend.t': f.t, rate: angleTrack.velocity(150).x, torso, hipShift,
        armsUp: handsSeen ? armsUp : -2, held: holding ? holdLastT - holdSince : 0,
      };
      return out;
    },
    value: () => (any && Object.keys(ch).length ? theta : undefined),
    channels: () => ch,
    explain(windowMs = 2000): Miss | null {
      if (!any || !Object.keys(ch).length) return null;
      const peak = Math.max(Math.abs(bendSeries.max(windowMs) ?? 0), Math.abs(bendSeries.min(windowMs) ?? 0));
      if (peak < 5) return null;                                  // not bending: nothing to say
      const shortest = torsoSeries.min(windowMs) ?? 1;
      if (shortest < o.forwardMin) return { code: 'bending_forward', got: shortest, need: o.forwardMin };
      const shift = Math.max(Math.abs(hipSeries.max(windowMs) ?? 0), Math.abs(hipSeries.min(windowMs) ?? 0));
      if (shift > o.hipMax) return { code: 'hips_shifted', got: shift, need: o.hipMax };
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); angleTrack.clear(); torsoSeries.clear(); hipSeries.clear(); bendSeries.clear();
      ch = {}; theta = 0; nowT = 0; any = false; settled = null; holding = false; holdSince = 0; holdLastT = 0;
    },
  } satisfies ExplainingDetector;
};

// ───────── the game's side: judging gates ─────────

export interface BendGate {
  id: number;
  /** The angle the gate asks for, degrees; positive = toward the player's right. */
  target: number;
  /** Default 7 (10 on the easy level). */
  tol?: number;
  /** Time to stay inside, ms. Default 300. */
  holdMs?: number;
  /** A tall gate: both hands at least 0.3 T above the nose (card 19). */
  tall?: boolean;
}

export interface BendJudgement {
  kind: 'pass';
  id: number;
  t: number;
  /** 1 for an exact angle, 0 at the edge of the tolerance: 1 - mean error / tolerance during the hold. */
  precision: number;
  /** Mean angle error during the hold, degrees (signed: + = leaned more to the right than asked). */
  error: number;
}

interface GateState {
  frames: number; run: number; runSince: number; longest: number; sumAbs: number; sumErr: number; n: number;
  hipBlocked: number; armsBlocked: number; torsoMin: number; hipMax: number; armsMin: number; thetaMax: number; thetaMin: number; done: boolean;
}

/** Judges Limbo Bend style gates from the detector's channels: the angle inside the tolerance, with the hips still. */
export class BendTester {
  private gates = new Map<number, GateState>();
  private lastT = -Infinity;
  private readonly hipMax: number;
  private readonly forwardMin: number;
  private readonly tallAbove: number;

  constructor(o: { hipMax?: number; forwardMin?: number; tallAbove?: number } = {}) {
    this.hipMax = o.hipMax ?? SIDE_BEND_DEFAULTS.hipMax;
    this.forwardMin = o.forwardMin ?? SIDE_BEND_DEFAULTS.forwardMin;
    this.tallAbove = o.tallAbove ?? 0.3;
  }

  private state(id: number): GateState {
    let s = this.gates.get(id);
    if (!s) {
      if (this.gates.size >= 64) this.gates.delete(this.gates.keys().next().value as number);
      s = { frames: 0, run: 0, runSince: 0, longest: 0, sumAbs: 0, sumErr: 0, n: 0, hipBlocked: 0, armsBlocked: 0, torsoMin: Infinity, hipMax: 0, armsMin: Infinity, thetaMax: -Infinity, thetaMin: Infinity, done: false };
      this.gates.set(id, s);
    }
    return s;
  }

  update(ch: Readonly<Record<string, number>>, gates: readonly BendGate[]): BendJudgement[] {
    const t = ch['bend.t'], theta = ch.bend;
    if (t === undefined || theta === undefined || t === this.lastT) return [];
    this.lastT = t;
    const out: BendJudgement[] = [];
    const hips = Math.abs(ch.hipShift ?? 0), armsUp = ch.armsUp ?? 0, torso = ch.torso ?? 1;
    for (const g of gates) {
      const s = this.state(g.id);
      if (s.done) continue;
      const tol = g.tol ?? 7, hold = g.holdMs ?? 300;
      s.frames++;
      s.torsoMin = Math.min(s.torsoMin, torso); s.hipMax = Math.max(s.hipMax, hips); s.armsMin = Math.min(s.armsMin, armsUp);
      s.thetaMax = Math.max(s.thetaMax, theta); s.thetaMin = Math.min(s.thetaMin, theta);
      const err = theta - g.target;
      const angleOk = Math.abs(err) <= tol;
      const hipsOk = hips <= this.hipMax;
      const armsOk = !g.tall || armsUp >= this.tallAbove;
      if (angleOk && !hipsOk) s.hipBlocked++;
      if (angleOk && hipsOk && !armsOk) s.armsBlocked++;
      if (angleOk && hipsOk && armsOk) {
        if (s.run === 0) { s.runSince = t; s.sumAbs = 0; s.sumErr = 0; s.n = 0; }
        s.run++;
        s.sumAbs += Math.abs(err); s.sumErr += err; s.n++;
        s.longest = Math.max(s.longest, t - s.runSince);
        if (t - s.runSince >= hold) {
          s.done = true;
          out.push({ kind: 'pass', id: g.id, t, precision: clamp(1 - s.sumAbs / s.n / tol, 0, 1), error: s.sumErr / s.n });
        }
      } else s.run = 0;
    }
    return out;
  }

  /** Why the gate was not passed so far (call it when the gate has gone by); null when passed or nothing is known. */
  explain(g: BendGate): Miss | null {
    const s = this.gates.get(g.id);
    if (!s || s.done) return null;
    const tol = g.tol ?? 7, hold = g.holdMs ?? 300;
    if (s.frames === 0) return { code: 'person_out' };
    if (s.longest === 0 && s.hipBlocked === 0 && s.armsBlocked === 0 && s.torsoMin < this.forwardMin) return { code: 'bending_forward', got: s.torsoMin, need: this.forwardMin, target: g.id };
    if (s.hipBlocked > 0 && s.longest < hold) return { code: 'hips_shifted', got: s.hipMax, need: this.hipMax, target: g.id };
    if (s.armsBlocked > 0 && s.longest < hold) return { code: 'arms_not_up', got: s.armsMin, need: this.tallAbove, target: g.id };
    if (s.longest > 0) return { code: 'held_too_short', got: s.longest, need: hold, target: g.id };
    // Never inside the tolerance: where did the player get to, against the target?
    if (g.target === 0) return { code: 'bend_less', got: Math.min(Math.abs(s.thetaMax), Math.abs(s.thetaMin)), need: tol, target: g.id };
    const toward = g.target >= 0 ? s.thetaMax : s.thetaMin;        // the most the player leaned the way the gate asks
    const away = g.target >= 0 ? s.thetaMin : s.thetaMax;
    if (g.target !== 0 && Math.abs(away) > Math.abs(toward) && Math.sign(away) !== Math.sign(g.target)) return { code: 'wrong_side', target: g.id };
    const need = g.target >= 0 ? g.target - tol : g.target + tol;
    const short = g.target >= 0 ? toward < need : toward > need;
    if (short) return { code: 'bend_more', got: toward, need, target: g.id };
    return { code: 'bend_less', got: toward, need: g.target >= 0 ? g.target + tol : g.target - tol, target: g.id };
  }

  forget(id: number): void { this.gates.delete(id); }
  reset(): void { this.gates.clear(); this.lastT = -Infinity; }
}
