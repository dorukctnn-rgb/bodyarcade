// A synthetic body for the whole chain (kit-g1/testing/chain.ts): the squat bot's cycle as a figure of the movement
// library's rig, in the picture of a camera. Standing and squatting for the standing game; arms up, level and down for the
// seated one. Closed loop: the bot looks at the game to decide when to start a squat.
import type { Game } from '../../../core/types/index.ts';
import { SHAPE_FULL, SHAPE_UPPER, type FigureSpec, type RigShape } from '../../../core/moves/testing/rig.ts';
import type { ChainPerson } from '../../kit-g1/testing/chain.ts';
import type { FlightGame } from '../game.ts';
import { squatBot, type BotKind } from './bot.ts';

export interface SquatPersonOptions {
  kind: BotKind;
  /** Which lane of the game this person plays. */
  lane?: number;
  seed?: number;
  shape?: RigShape;
  /** Flap with the arms (the seated variant). */
  arms?: boolean;
}

/** The arms of the seated bot: level while "down", up and then down in the "rise". Degrees from hanging; 90 is level. */
function armsAt(phase: string, u: number): FigureSpec {
  let a = 8;
  if (phase === 'down') a = 8 + 82 * u;
  else if (phase === 'hold') a = 90;
  else if (phase === 'up') a = u < 0.5 ? 90 + 80 * (u / 0.5) : 170 - 162 * ((u - 0.5) / 0.5);
  return { armL: { a, f: a }, armR: { a, f: a } };
}

export function squatPerson(o: SquatPersonOptions): ChainPerson {
  const bot = squatBot(o.kind, o.seed ?? 1);
  const lane = o.lane ?? 0;
  let last = -1;
  return {
    shape: o.shape ?? (o.arms ? SHAPE_UPPER : SHAPE_FULL),
    body(t, game: Game | null, state) {
      const g = game as FlightGame | null;
      const s = g?.state ?? null;
      if (!s || state !== 'running') { last = t; return {}; }
      const dt = last < 0 ? 1 / 30 : Math.min(0.1, (t - last) / 1000);
      last = t;
      bot.next(s, lane, dt);
      return o.arms ? armsAt(bot.phase, bot.progress) : { drop: bot.drop };
    },
  };
}
