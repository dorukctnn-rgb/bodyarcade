// Runners for the tests and for the end-to-end run: a body that lifts its knees in turn, as the movement library reports it
// (each leg's lift k rises and falls once per stride; a stride is counted, with the peak of the lift, when the knee has
// turned down again, and not at all when the peak stays under the march line). 'perfect' runs a little over the pace that
// gives the full speed with its knees high and jumps (or lifts a knee to the hip) at the right moment; 'good' and 'sloppy'
// are slower, lower and late now and then; 'low' lifts its knees but never to the line; 'early' jumps too early;
// 'idle' stands still. Closed loop: the bot looks at the simulation for the hurdles and the pace asked.
import { mulberry32 } from '../../../core/loop/rng.ts';
import { smoothstep } from '../../kit-g1/index.ts';
import { hurdleIn, type LaneIn, type SprintState, type StepIn } from '../sim.ts';

export type BotKind = 'perfect' | 'good' | 'sloppy' | 'low' | 'early' | 'idle';

export interface SprintBot {
  /** The lane's input for the next step (call once per step). */
  next(s: SprintState, lane: number, dt: number): LaneIn;
  /** The lift of each knee now, for the synthetic body of the chain tests. */
  readonly knees: readonly [number, number];
  /** The player's movement energy now (seated). */
  readonly effort: number;
}

const ENTER = 0.5;

interface Style { pace: number; paceNoise: number; peak: number; peakNoise: number; late: number; lateNoise: number; sameLeg: number; effort: number }

const STYLES: Record<Exclude<BotKind, 'idle'>, Style> = {
  perfect: { pace: 1.05, paceNoise: 0, peak: 0.92, peakNoise: 0, late: 0.3, lateNoise: 0, sameLeg: 0, effort: 1.15 },
  good: { pace: 0.9, paceNoise: 0.05, peak: 0.72, peakNoise: 0.08, late: 0.3, lateNoise: 0.12, sameLeg: 0, effort: 0.85 },
  sloppy: { pace: 0.7, paceNoise: 0.2, peak: 0.58, peakNoise: 0.18, late: 0.3, lateNoise: 0.5, sameLeg: 0.08, effort: 0.55 },
  low: { pace: 0.9, paceNoise: 0.05, peak: 0.4, peakNoise: 0.04, late: 0.3, lateNoise: 0.1, sameLeg: 0, effort: 0.5 },
  early: { pace: 1.05, paceNoise: 0, peak: 0.8, peakNoise: 0, late: 0.95, lateNoise: 0.05, sameLeg: 0, effort: 1 },
};

export function sprintBot(kind: BotKind, seed = 1): SprintBot {
  const rnd = mulberry32(seed * 7919 + 11);
  const st = kind === 'idle' ? null : STYLES[kind];
  const knees: [number, number] = [0, 0];
  let leg = 0;
  /** Seconds into the current stride, its length, the peak of its lift, whether the stride is counted, whether it is emitted yet. */
  let u = 0;
  let period = 0.5;
  let peak = 0.8;
  let counted = true;
  let emitted = true;
  let started = false;
  let effort = 0;
  let lead = 0.3;

  const jitter = (v: number, k: number): number => v * (1 + (rnd() * 2 - 1) * k);
  const none = (): LaneIn => ({ steps: [], jumps: 0, effort: 0, knees: [0, 0], torso: 1 });

  function begin(s: SprintState, lane: number): void {
    const style = st as Style;
    const warm = s.phase === 'warmup';
    // The warm-up is an unhurried march; after it, a bit over the pace that gives the full speed.
    const cad = warm ? 105 : s.cadFull * jitter(style.pace, style.paceNoise);
    period = 60 / Math.max(40, cad);
    peak = warm ? 0.8 : Math.max(0.2, style.peak + (rnd() * 2 - 1) * style.peakNoise);
    leg = rnd() < style.sameLeg ? leg : leg ^ 1;
    counted = peak >= ENTER && (kind !== 'sloppy' || rnd() > 0.04);
    // The quiet and the seated ways over a hurdle: when this stride is counted inside the hurdle's window, lift this knee to the hip.
    const arrive = hurdleIn(s, lane);
    const at = 0.55 * period;
    if (!warm && s.quiet && arrive < 2 && arrive - at >= -0.02 && arrive - at <= 0.5 && kind !== 'early' && (kind === 'perfect' || rnd() < 0.75)) { peak = 1.1; counted = true; }
    u = 0;
    emitted = false;
    started = true;
  }

  return {
    get knees() { return knees; },
    get effort() { return effort; },
    next(s, lane, dt) {
      const l = s.lanes[lane];
      if (!st || !l) return none();
      if (s.phase === 'ready' || s.phase === 'rest' || s.phase === 'finish' || l.finished) {
        knees[0] = knees[1] = 0;
        effort = 0;
        started = false;
        return none();
      }
      if (s.seated) {
        // The arms and the knees swing: the energy follows the style's share of the full effort.
        const want = s.effFull * st.effort * jitter(1, st.paceNoise);
        effort += (want - effort) * Math.min(1, dt * 3);
        return { steps: [], jumps: 0, effort, knees: [0, 0], torso: 1 };
      }
      if (!started) begin(s, lane);
      u += dt;
      if (u >= period) begin(s, lane);
      const x = u / period;
      knees[leg] = peak * smoothstep(Math.min(x, 1 - x) * 2);
      knees[leg ^ 1] = 0;
      const steps: StepIn[] = [];
      if (!emitted && x >= 0.55) {
        emitted = true;
        if (counted) steps.push({ k: peak, side: leg === 0 ? 'L' : 'R' });
      }
      // A jump at the right moment before a hurdle (the quiet variant lifts a knee to the hip instead).
      let jumps = 0;
      if (!s.quiet && s.phase === 'play') {
        const arrive = hurdleIn(s, lane);
        if (arrive <= lead && l.sinceAct > 0.7) {
          jumps = 1;
          lead = Math.max(0.05, jitter(st.late, st.lateNoise));
        } else if (arrive > 1.5) lead = Math.max(0.05, jitter(st.late, st.lateNoise));
      }
      return { steps, jumps, effort: 0, knees: [knees[0], knees[1]], torso: 1 };
    },
  };
}
