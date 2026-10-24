// A synthetic body for the whole chain (kit-g1/testing/chain.ts): the climber bot's arms, knees and lean as a figure of the
// movement library's rig, in the picture of a camera. The arms are straight and swing between "at the shoulder" and "straight
// up"; the knees lift in turn on a ledge; the trunk bends toward the column the bot moves to. Closed loop: the bot looks at the
// game for the ledge, the breather and the rocks.
import type { Game } from '../../../core/types/index.ts';
import { SHAPE_FULL, SHAPE_UPPER, type FigureSpec, type RigShape } from '../../../core/moves/testing/rig.ts';
import type { ChainPerson } from '../../kit-g1/testing/chain.ts';
import type { ClimbGame } from '../game.ts';
import { climbBot, type BotKind } from './bot.ts';

export interface ClimberPersonOptions {
  kind: BotKind;
  seed?: number;
  shape?: RigShape;
  /** The arms-only ways: only the upper body is in the picture. */
  seated?: boolean;
  /** Degrees the trunk bends to a side in a lean (the lean detector's lane needs about 14). */
  bend?: number;
}

/** The arm angle (degrees from hanging, 180 straight up) of a raise: at the shoulder level a little below it, to straight up. */
export const armAngle = (u: number): number => 70 + 110 * u;

export function climberPerson(o: ClimberPersonOptions): ChainPerson {
  const bot = climbBot(o.kind, o.seed ?? 1);
  let last = -1;
  return {
    shape: o.shape ?? (o.seated ? SHAPE_UPPER : SHAPE_FULL),
    body(t, game: Game | null, state) {
      const g = game as ClimbGame | null;
      const s = g?.state ?? null;
      if (!s || state !== 'running') { last = t; return {}; }
      const dt = last < 0 ? 1 / 30 : Math.min(0.1, (t - last) / 1000);
      last = t;
      bot.next(s, dt);
      const spec: FigureSpec = {
        armL: { a: armAngle(bot.arms[0]), f: armAngle(bot.arms[0]) },
        armR: { a: armAngle(bot.arms[1]), f: armAngle(bot.arms[1]) },
        bend: bot.lean * (o.bend ?? 18),
      };
      if (!o.seated) { spec.legL = { k: bot.knees[0] }; spec.legR = { k: bot.knees[1] }; }
      return spec;
    },
  };
}
