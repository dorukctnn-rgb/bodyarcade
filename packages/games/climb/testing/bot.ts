// Climbers for the tests and for the end-to-end run: a body that climbs hand over hand, as the movement library reports it
// (each hand rises above the nose, takes hold, and is pulled down to the shoulder; the pull is counted when the stroke is
// done), climbs a ledge with its knees, and leans out of the way of a falling rock. 'perfect' climbs fast with full reaches
// and is quick to move away from a rock; 'good' and 'sloppy' are slower, reach less, repeat a hand now and then and are
// late (or never) out of the way; 'short' reaches for a hold but never high enough; 'idle' hangs. Closed loop: the bot looks at
// the simulation for the ledge, the breather and the rocks.
import { mulberry32 } from '../../../core/loop/rng.ts';
import { smoothstep } from '../../kit-g1/index.ts';
import { pendingRock, type ClimbIn, type ClimbState, type HandIn, type PullIn, type StepIn } from '../sim.ts';

export type BotKind = 'perfect' | 'good' | 'sloppy' | 'short' | 'idle';

export interface ClimbBot {
  /** The input for the next step (call once per step). */
  next(s: ClimbState, dt: number): ClimbIn;
  /** How high each arm is raised now, 0 (at the shoulder) to 1 (straight up), for the synthetic body of the chain tests. */
  readonly arms: readonly [number, number];
  /** The lift of each knee now (a ledge). */
  readonly knees: readonly [number, number];
  /** The lean now, -1 (left) to 1 (right), and the column it makes. */
  readonly lean: number;
  readonly lane: -1 | 0 | 1;
}

interface Style {
  /** Seconds between two pulls, and its noise (share). */
  gap: number; gapNoise: number;
  /** The pull's length in arm lengths and its noise. */
  amp: number; ampNoise: number;
  /** Chance of pulling the same hand twice. */
  same: number;
  /** Steps per second on a ledge, and the lift of a step. */
  stride: number; lift: number;
  /** Seconds before a rock's warning is acted on, its noise, and the chance of not acting at all. */
  react: number; reactNoise: number; miss: number;
}

const STYLES: Record<Exclude<BotKind, 'idle'>, Style> = {
  perfect: { gap: 0.9, gapNoise: 0, amp: 0.9, ampNoise: 0, same: 0, stride: 2.6, lift: 0.8, react: 0.3, reactNoise: 0, miss: 0 },
  good: { gap: 1.12, gapNoise: 0.08, amp: 0.82, ampNoise: 0.06, same: 0, stride: 2.1, lift: 0.75, react: 0.6, reactNoise: 0.25, miss: 0 },
  sloppy: { gap: 1.55, gapNoise: 0.25, amp: 0.7, ampNoise: 0.12, same: 0.12, stride: 1.5, lift: 0.65, react: 1.0, reactNoise: 0.3, miss: 0.25 },
  short: { gap: 1.2, gapNoise: 0, amp: 0.8, ampNoise: 0, same: 0, stride: 2, lift: 0.75, react: 0.5, reactNoise: 0, miss: 0 },
};

/** The hand above the nose (T) for an arm raised by u, as the synthetic figure's straight arm gives it (shoulder level at u 0.23). */
const REACH = [-0.843, -0.63, -0.41, -0.19, 0.018, 0.21, 0.377, 0.514, 0.616, 0.679, 0.7];
export const reachOf = (u: number): number => {
  const x = Math.min(1, Math.max(0, u)) * 10;
  const i = Math.min(9, Math.floor(x));
  return (REACH[i] as number) + ((REACH[i + 1] as number) - (REACH[i] as number)) * (x - i);
};
/** The raise at which the hand is in the grip zone (0.25 T above the nose). */
const GRIP_U = 0.53;

interface Plan { at: number; side: 0 | 1; amp: number; gap: number }

export function climbBot(kind: BotKind, seed = 1): ClimbBot {
  const rnd = mulberry32(seed * 6151 + 5);
  const st = kind === 'idle' ? null : STYLES[kind];
  const jitter = (v: number, k: number): number => v * (1 + (rnd() * 2 - 1) * k);
  const arms: [number, number] = [0, 0];
  const knees: [number, number] = [0, 0];
  const plans: (Plan | null)[] = [null, null];
  let lean = 0;
  let lane: -1 | 0 | 1 = 0;
  let decided = -1;
  let active = false;
  let willAt = 0;
  let target: -1 | 0 | 1 = 0;
  let backAt = 0;
  let pulled = -1;
  // A ledge: seconds into the stride, its length, the leg, whether its step has been given.
  let u = 0;
  let period = 0.4;
  let leg = 0;
  let emitted = true;
  let striding = false;

  function planNext(now: number, afterPull: boolean): void {
    const style = st as Style;
    const gap = Math.max(0.4, jitter(style.gap, style.gapNoise));
    const last: 0 | 1 = pulled < 0 ? 1 : (pulled as 0 | 1);
    const side: 0 | 1 = rnd() < style.same ? last : (last ^ 1) as 0 | 1;
    const amp = Math.max(0.3, jitter(style.amp, style.ampNoise));
    const at = now + (afterPull ? gap : gap * 0.6);
    plans[0] = plans[1] = null;
    plans[side] = { at, side, amp: kind === 'short' ? 0 : amp, gap };
  }

  /** How high the arm of a hand is raised for its pending pull: up, held, and down to the shoulder. */
  function raise(p: Plan, now: number): number {
    const r0 = p.at - p.gap * 0.95, r1 = p.at - p.gap * 0.45, r2 = p.at - p.gap * 0.4;
    const top = kind === 'short' ? 0.42 : 1;
    if (now < r0) return 0;
    if (now < r1) return top * smoothstep((now - r0) / (r1 - r0));
    if (now < r2) return top;
    return top * (1 - smoothstep((now - r2) / Math.max(0.05, p.at - r2)));
  }

  const hand = (i: 0 | 1, active: boolean): HandIn => {
    const a = arms[i] as number;
    return { have: true, reach: active ? reachOf(a) : -0.84, prog: active && a < GRIP_U && a > 0 ? Math.min(1, 1 - a / GRIP_U) : 0, grab: active && a >= GRIP_U };
  };

  return {
    get arms() { return arms; },
    get knees() { return knees; },
    get lean() { return lean; },
    get lane() { return lane; },
    next(s, dt) {
      const c = s.c;
      const now = s.t;
      const none: ClimbIn = { pulls: [], steps: [], lane: 0, hands: [hand(0, false), hand(1, false)] };
      if (!st) { arms[0] = arms[1] = 0; return none; }
      const pulls: PullIn[] = [];
      const steps: StepIn[] = [];
      const climbing = s.phase === 'climb' || s.phase === 'warmup';
      const onLedge = s.phase === 'climb' && c.on === 'ledge';
      const resting = s.phase === 'climb' && (c.breath > 0 || c.on === 'rest');
      // New strokes are planned only while the hands have something to do; a stroke that is under way is always finished (a hand
      // let down from above the nose is a pull to the detector, so it is a pull here too, and the game ignores it when it must).
      const can = climbing && !onLedge && !resting;
      if (can && !plans[0] && !plans[1]) planNext(now, false);
      for (const i of [0, 1] as const) {
        const p = plans[i];
        if (!p) { arms[i] += (0 - arms[i]) * Math.min(1, dt * 8); continue; }
        arms[i] = raise(p, now);
        if (now >= p.at) {
          // The same hand twice in a row counts half (the movement library's value 0.5).
          if (p.amp > 0) { pulls.push({ side: i === 0 ? 'L' : 'R', amp: pulled === i ? p.amp * 0.5 : p.amp, shrug: false }); pulled = i; }
          arms[i] = 0;
          plans[i] = null;
          if (can) planNext(now, true);
        }
      }

      if (onLedge) {
        if (!striding) { striding = true; u = 0; period = 1 / jitter(st.stride, 0.05); leg = leg ^ 1; emitted = false; }
        u += dt;
        if (u >= period) { u = 0; period = 1 / jitter(st.stride, 0.05); leg ^= 1; emitted = false; }
        const x = u / period;
        knees[leg] = st.lift * smoothstep(Math.min(x, 1 - x) * 2);
        knees[leg ^ 1] = 0;
        if (!emitted && x >= 0.55) { emitted = true; steps.push({ k: st.lift, side: leg === 0 ? 'L' : 'R' }); }
      } else {
        striding = false;
        knees[0] = knees[1] = 0;
      }

      if (!climbing || resting) {
        lean += (0 - lean) * Math.min(1, dt * 6);
        lane = 0;
        decided = -1;
        active = false;
        return { pulls, steps, lane: 0, hands: [hand(0, plans[0] !== null), hand(1, plans[1] !== null)] };
      }

      // Rocks: act on the warning after a reaction time, and be back in the middle a moment after it landed.
      if (s.phase === 'climb') {
        const pr = pendingRock(s);
        if (pr && pr.warned && decided !== c.rock) {
          decided = c.rock;
          active = true;
          const closed = pr.rock.closed;
          const safe = ([-1, 0, 1] as const).filter((k) => !closed[k + 1]);
          const pick: -1 | 0 | 1 = safe.includes(0) ? 0 : safe.length === 1 ? (safe[0] as -1 | 1) : rnd() < 0.5 ? -1 : 1;
          target = rnd() < st.miss ? lane : pick;
          willAt = s.setT + Math.max(0.05, jitter(st.react, st.reactNoise));
          backAt = pr.rock.t + 0.35;
        }
        if (active) {
          if (s.setT >= backAt) { lane = 0; active = false; }
          else if (s.setT >= willAt) lane = target;
        }
      }
      lean += (lane - lean) * Math.min(1, dt * 7);
      return { pulls, steps, lane, hands: [hand(0, plans[0] !== null || pulls.length > 0), hand(1, plans[1] !== null || pulls.length > 0)] };
    },
  };
}
