// Players for the tests and for the end-to-end run: a body that squats and rises in time, as the movement library
// reports it (hip drop D in T, glide while deep, armed while rising, a flap when D comes back under the flap line fast
// enough). 'perfect' looks ahead with the simulation itself and squats as deep as asked; 'sloppy' is late, shallow and
// uneven; 'shallow' and 'slow' make one fault every time (to see the reasons); 'idle' stands still.
import { mulberry32 } from '../../../core/loop/rng.ts';
import { stepFlight, gapCentre, nextPipe, type FlapIn, type FlightState, type LaneIn } from '../sim.ts';

export type BotKind = 'perfect' | 'good' | 'sloppy' | 'shallow' | 'slow' | 'idle';

export interface SquatBot {
  /** The lane's input for the next step (call once per step). */
  next(s: FlightState, lane: number, dt: number): LaneIn;
  /** The body's state, for assertions. */
  readonly phase: Phase;
  readonly drop: number;
  /** How far the body is through its current phase, 0..1 (the arms of the seated bot follow it). */
  readonly progress: number;
}

type Phase = 'stand' | 'down' | 'hold' | 'up';

/** The movement library's glide line and flap line (squatFlap.ts) for a floor of 0.3. */
const DOWN = 0.3;
const FLAP_BELOW = 0.2;

interface Timing { depth: number; down: number; hold: number; up: number }

/** One body: goes down, holds, comes up, and reports what the detector would say at every step. */
class Body {
  phase: Phase = 'stand';
  clock = 0;
  drop = 0;
  armed = false;
  private peakUp = 0;
  private prev = 0;
  private t: Timing = { depth: 0.6, down: 0.7, hold: 0.12, up: 0.5 };

  get progress(): number {
    const t = this.t;
    return this.phase === 'down' ? Math.min(1, this.clock / t.down) : this.phase === 'hold' ? Math.min(1, this.clock / t.hold) : this.phase === 'up' ? Math.min(1, this.clock / t.up) : 0;
  }

  start(t: Timing): void { this.phase = 'down'; this.clock = 0; this.t = t; this.armed = false; this.peakUp = 0; }

  copy(): Body {
    const b = new Body();
    Object.assign(b, this);
    b.t = { ...this.t };
    return b;
  }

  step(dt: number): LaneIn {
    const flaps: FlapIn[] = [];
    this.prev = this.drop;
    this.clock += dt;
    const t = this.t;
    if (this.phase === 'down') {
      this.drop = t.depth * Math.min(1, this.clock / t.down);
      if (this.clock >= t.down) { this.phase = 'hold'; this.clock = 0; }
    } else if (this.phase === 'hold') {
      this.drop = t.depth;
      if (this.clock >= t.hold) { this.phase = 'up'; this.clock = 0; }
    } else if (this.phase === 'up') {
      this.drop = t.depth * Math.max(0, 1 - this.clock / t.up);
      if (this.drop <= 0) { this.phase = 'stand'; this.clock = 0; this.armed = false; this.drop = 0; }
    }
    const glide = this.drop >= DOWN;
    if (glide) this.armed = true;
    if (this.phase === 'up') this.peakUp = Math.max(this.peakUp, Math.max(0, (this.prev - this.drop) / dt));
    if (this.armed && this.phase === 'up' && this.drop < FLAP_BELOW) {
      this.armed = false;
      // The movement library wants a rise of at least 0.6 T/s.
      if (this.peakUp >= 0.6) flaps.push({ power: Math.min(1.2, Math.max(0.6, this.peakUp / 1.5)), depth: this.t.depth });
    }
    if (this.armed && this.phase === 'stand') this.armed = false;
    return { flaps, drop: this.drop, glide, armed: this.armed };
  }
}

/** Seconds ahead the perfect player looks, and the steps it takes to do so. */
const HORIZON = 2.6;
const DT = 1 / 60;

/** The state a look-ahead may change: everything the step touches, copied; the columns and the course are shared. */
function fork(s: FlightState): FlightState {
  return {
    ...s,
    round: { ...s.round },
    warm: { t: s.warm.t, flapTimes: [...s.warm.flapTimes], depths: [...s.warm.depths] },
    lanes: s.lanes.map((l) => ({ ...l, hint: l.hint ? { ...l.hint } : null })),
  };
}

/** How badly a way of playing goes over the next seconds: hits cost a lot, distance from the gap's middle a little. */
function cost(s: FlightState, lane: number, body: Body, timing: Timing, squatAfter: number): number {
  const f = fork(s);
  const b = body.copy();
  const hits0 = (f.lanes[lane] as { hits: number }).hits;
  let c = 0;
  let wait = squatAfter;
  for (let i = 0; i < Math.round(HORIZON / DT); i++) {
    if (b.phase === 'stand' && wait >= 0) { wait -= DT; if (wait <= 0) { b.start(timing); wait = -1; } }
    const inp = b.step(DT);
    stepFlight(f, DT, f.lanes.map((_, k) => (k === lane ? inp : { flaps: [], drop: 0, glide: false, armed: false })));
    const l = f.lanes[lane] as { y: number; hits: number; next: number };
    const p = f.pipes[l.next];
    if (p) {
      const d = p.x - f.scroll;
      if (d < 0.32 && d > -0.12) c += (l.y - gapCentre(p, f.active)) ** 2 * 4;
    }
    if (l.hits > hits0) { c += 100; break; }
  }
  return c;
}

export function squatBot(kind: BotKind, seed = 1): SquatBot {
  const rnd = mulberry32(seed * 7919 + 3);
  const body = new Body();
  let wait = 0;
  let sinceThink = 0;

  /** The squat that was planned, and the one the body then does (people are not exact). */
  const nominal = (s: FlightState): Timing => ({ depth: Math.min(0.85, s.need * 1.25 + 0.05), down: 0.7, hold: 0.12, up: 0.5 });
  const noise = kind === 'good' ? 0.12 : kind === 'sloppy' ? 0.3 : 0;
  const timingFor = (s: FlightState): Timing => {
    // Shallow: deep in the warm-up (so the depth asked stays), then barely past the glide line.
    if (kind === 'shallow') return { depth: s.phase === 'warmup' ? 0.9 : Math.max(0.31, s.need * 0.55), down: 0.6, hold: 0.1, up: 0.5 };
    if (kind === 'slow') return { depth: s.need * 1.3, down: 0.8, hold: 0.2, up: 1.9 };
    const n = nominal(s);
    if (noise === 0) return n;
    const j = (v: number, k: number): number => v * (1 + (rnd() * 2 - 1) * noise * k);
    const t: Timing = { depth: Math.max(0.31, n.depth + (rnd() * 2 - 1) * noise * 0.4), down: j(n.down, 1), hold: j(n.hold, 1.5), up: j(n.up, 1) };
    // A sloppy body sometimes does not get up fast enough, or does not go down far enough.
    if (kind === 'sloppy') { const r = rnd(); if (r < 0.1) t.up = 1.6; else if (r < 0.25) t.depth = Math.max(0.31, s.need * 0.6); }
    return t;
  };
  let lag = 0;

  return {
    get phase() { return body.phase; },
    get drop() { return body.drop; },
    get progress() { return body.progress; },
    next(s, lane, dt) {
      if (kind === 'idle') return { flaps: [], drop: 0, glide: false, armed: false };
      const l = s.lanes[lane];
      if (!l) return { flaps: [], drop: 0, glide: false, armed: false };
      if (body.phase === 'stand') {
        wait = Math.max(0, wait - dt);
        sinceThink += dt;
        if (s.phase === 'warmup') {
          // An unhurried person: a squat, a stand, a breath.
          if (wait <= 0 && l.y > 0.4) { body.start(timingFor(s)); wait = 0.9; }
        } else if (kind === 'perfect' || kind === 'good' || kind === 'sloppy') {
          if (lag > 0) {
            lag -= dt;
            if (lag <= 0) body.start(timingFor(s));
          } else if (sinceThink >= (kind === 'sloppy' ? 0.3 : 0.1)) {
            sinceThink = 0;
            const timing = nominal(s);
            const options = [0, 0.2, 0.45, 0.8, -1];
            let best = Infinity, pick = -1;
            for (const o of options) {
              const c = cost(s, lane, body, timing, o) + (o < 0 ? 0.02 : 0);
              if (c < best - 1e-9) { best = c; pick = o; }
            }
            // A person reacts a little late: the squat begins after a moment.
            if (pick === 0) { lag = noise === 0 ? 0 : rnd() * noise * 1.2; if (lag <= 0) body.start(timingFor(s)); }
          }
        } else {
          const p = nextPipe(s, lane);
          const target = p ? gapCentre(p, s.active) : 0.5;
          if (l.y > target + 0.035 && wait <= 0) { body.start(timingFor(s)); wait = 0.05; }
        }
      }
      return body.step(dt);
    },
  };
}
