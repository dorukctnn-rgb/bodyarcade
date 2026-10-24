// A synthetic body for the whole chain (kit-g1/testing/chain.ts): the runner bot's knees as a figure of the movement library's
// rig, in the picture of a camera. Standing: the legs lift in turn and the body rises over a hurdle. Seated: the arms swing.
// Closed loop: the bot looks at the game to decide when to jump and how fast to go.
import type { Game } from '../../../core/types/index.ts';
import { SHAPE_FULL, SHAPE_UPPER, type FigureSpec, type RigShape } from '../../../core/moves/testing/rig.ts';
import type { ChainPerson } from '../../kit-g1/testing/chain.ts';
import type { SprintGame } from '../game.ts';
import { sprintBot, type BotKind } from './bot.ts';

export interface RunnerPersonOptions {
  kind: BotKind;
  /** Which lane of the game this person runs. */
  lane?: number;
  seed?: number;
  shape?: RigShape;
  /** Swing the arms (the seated variant). */
  arms?: boolean;
  /** Seconds the jump takes, and how high the body rises, in torso lengths. */
  jumpSec?: number;
  jumpRise?: number;
  /** The jump starts this many seconds before the bot's own moment (the detector needs a little of the jump to see it). */
  jumpEarly?: number;
}

/** The rise of a jump at u (0..1): a parabola. */
const arc = (u: number): number => 4 * u * (1 - u);

export function runnerPerson(o: RunnerPersonOptions): ChainPerson {
  const bot = sprintBot(o.kind, o.seed ?? 1);
  const lane = o.lane ?? 0;
  const jumpSec = o.jumpSec ?? 0.5;
  const jumpRise = o.jumpRise ?? 0.45;
  let last = -1;
  let jumpT = -1e9;
  let swing = 0;
  return {
    shape: o.shape ?? (o.arms ? SHAPE_UPPER : SHAPE_FULL),
    body(t, game: Game | null, state) {
      const g = game as SprintGame | null;
      const s = g?.state ?? null;
      if (!s || state !== 'running') { last = t; return {}; }
      const dt = last < 0 ? 1 / 30 : Math.min(0.1, (t - last) / 1000);
      last = t;
      const l = bot.next(s, lane, dt);
      if (o.arms) {
        // The seated runner swings both arms to and fro (a steady stroke; the warm-up measures it).
        if (o.kind === 'idle' || s.phase === 'ready' || s.phase === 'rest' || s.phase === 'finish' || s.lanes[lane]?.finished) return {};
        swing += dt * 1.8;
        const a = 62 + 48 * Math.sin(swing * Math.PI * 2);
        return { armL: { a, f: a }, armR: { a: 124 - a, f: 124 - a } };
      }
      if (l.jumps > 0) jumpT = t - (o.jumpEarly ?? 0) * 1000;
      const u = (t - jumpT) / (jumpSec * 1000);
      const spec: FigureSpec = { legL: { k: bot.knees[0] }, legR: { k: bot.knees[1] } };
      if (u >= 0 && u <= 1) {
        // In the air both legs hang.
        spec.rise = jumpRise * arc(u);
        spec.legL = { k: 0 };
        spec.legR = { k: 0 };
      }
      return spec;
    },
  };
}
