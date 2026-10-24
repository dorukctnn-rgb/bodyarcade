// Synthetic bodies for the whole chain (kit-g1/testing/chain.ts) for Firework Jacks and Twist Turbine: the figure of the movement
// library's rig, in the picture of a camera, doing what a player does. Closed loop: the body looks at the game (its simulation)
// to know the beat, the pace and the storm, the way a person looks at the screen. Test support: nothing in production imports it.
// Synthetic bodies show that the parts fit together and what the thresholds do; they are not evidence about real people.
import type { Game } from '../../../core/types/index.ts';
import { armTo, mix, SHAPE_FULL, SHAPE_UPPER, type ArmSpec, type FigureSpec, type RigShape } from '../../../core/moves/testing/rig.ts';
import { smooth } from '../../_shared/util.ts';
import { msOf } from '../../_shared/util.ts';
import type { ChainPerson } from '../../kit-g1/testing/chain.ts';
import type { FireworkSim } from '../fireworks.ts';
import type { TurbineSim } from '../turbine.ts';

const simOf = <S>(game: Game | null): S | null => (game as unknown as { sim?: S | null } | null)?.sim ?? null;

export type PersonKind = 'perfect' | 'late' | 'sloppy' | 'idle';

// ───────── Firework Jacks ─────────

const UP: ArmSpec = { a: 165, f: 165 };
const OPEN: FigureSpec = { armL: UP, armR: UP, legL: { out: 0.45 }, legR: { out: 0.45 } };
/** One foot out to the side, no hop: the gap between the feet is 1.5 W (the step jack asks 1.3 W; the margin is for a camera that is not exact). */
const STEP: FigureSpec = { armL: UP, armR: UP, legL: { out: 0.35 }, legR: { out: 0.35 } };
const ARMS: FigureSpec = { armL: UP, armR: UP };
/** The detector counts a rig jack this long after it starts (measured: 100 to 133 ms at 30 pictures a second). */
const COUNT_AFTER_MS = 117;
/** A jack: open over 160 ms, held for 60 ms, closed again over 160 ms. */
const JACK_MS = [160, 60, 160] as const;

export interface JackPersonOptions {
  /** perfect: on every beat from the second; late: half a beat late (never on the beat); sloppy: arms only, the feet stay (no jack for the standard detector); idle: stands. */
  kind: PersonKind;
  /** Which player of the game this person is (0 or 1). */
  lane?: number;
  seated?: boolean;
  quiet?: boolean;
  shape?: RigShape;
}

export function jackPerson(o: JackPersonOptions): ChainPerson {
  const lane = o.lane ?? 0;
  const open = o.kind === 'sloppy' ? ARMS : o.seated ? ARMS : o.quiet ? STEP : OPEN;
  return {
    shape: o.shape ?? (o.seated ? SHAPE_UPPER : SHAPE_FULL),
    body(_t, game, state) {
      const sim = simOf<FireworkSim>(game);
      if (state !== 'running' || !sim || sim.phase !== 'running' || o.kind === 'idle') return {};
      const seg = sim.segment;
      if (seg.kind !== 'work') return {};
      const period = 60000 / seg.bpm;
      const first = msOf(seg.startK);
      const now = msOf(sim.k) - (o.kind === 'late' ? period / 2 : 0) - lane * 12;
      const n = Math.round((now + COUNT_AFTER_MS - first) / period);
      if (n < 1) return {};
      const u = now - (first + n * period - COUNT_AFTER_MS);
      const [up, hold, down] = JACK_MS;
      if (u < 0 || u > up + hold + down) return {};
      const f = u < up ? smooth(u / up) : u < up + hold ? 1 : 1 - smooth((u - up - hold) / down);
      return mix({}, open, f);
    },
  };
}

// ───────── Twist Turbine ─────────

const W = 0.8;

/** The body turned by v in -1..1: the shoulders 40 degrees, the joined hands at 0.8 W (or `gap` W apart). */
export function turned(v: number, gap = 0.04): FigureSpec {
  const phi = 40 * v;
  const xh = 0.8 * W * v;
  const half = (W / 2) * Math.cos((phi * Math.PI) / 180);
  const g = gap / 2;
  const y = 0.4 - 1;
  return { twist: phi, armL: armTo('L', { x: xh - g + half, y }), armR: armTo('R', { x: xh + g - half, y }) };
}

export interface TwistPersonOptions {
  /** perfect: twists at the middle of the band and answers the storms; sloppy: hands far apart; idle: stands. */
  kind: PersonKind;
  seated?: boolean;
  shape?: RigShape;
}

export function twistPerson(o: TwistPersonOptions): ChainPerson {
  // the body's position (-1 left .. +1 right), where it is heading, and when it may turn round
  let pos = 0;
  let target: -1 | 1 = -1;
  let lastNow = -1;
  let turnAt = 0;
  let wasStorm = false;
  return {
    shape: o.shape ?? (o.seated ? SHAPE_UPPER : SHAPE_FULL),
    body(_t, game, state) {
      const sim = simOf<TurbineSim>(game);
      if (state !== 'running' || !sim || sim.phase !== 'running' || o.kind === 'idle') { lastNow = -1; return {}; }
      const now = msOf(sim.k);
      const dt = lastNow < 0 ? 0 : Math.min(100, now - lastNow);
      lastNow = now;
      if (sim.segment.kind !== 'work') { pos = 0; return {}; }
      const storm = sim.storm;
      const blackout = !!storm && storm.kind === 'blackout';
      const crossMs = blackout ? 700 : 900;
      const mid = (sim.plan.band[0] + sim.plan.band[1]) / 2;
      const period = blackout ? 1000 : Math.max(1100, 60000 / mid);
      if (storm && storm.kind === 'overload') {
        // hold the side that is asked, until the storm is over
        target = storm.side;
        turnAt = now + 800;
      } else if (!storm && wasStorm) turnAt = now + 600;
      wasStorm = !!storm;
      if (Math.abs(pos - target) < 0.001 && now >= turnAt) {
        target = target === 1 ? -1 : 1;
        turnAt = now + period;
      }
      const step = (2 / crossMs) * dt;
      pos = pos < target ? Math.min(target, pos + step) : Math.max(target, pos - step);
      return turned(pos, o.kind === 'sloppy' ? 0.9 : 0.04);
    },
  };
}
