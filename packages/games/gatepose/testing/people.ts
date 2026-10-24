// Synthetic bodies for the whole chain (kit-g1/testing/chain.ts) for Limbo Bend and Pose Wall: the figure of the movement library's
// rig, in the picture of a camera, leaning to the next gate or making the shape of the next wall. Closed loop: the body looks at the
// game (its simulation) to know what is coming, the way a person looks at the screen. Test support: nothing in production imports
// it. Synthetic bodies show that the parts fit together and what the thresholds do; they are not evidence about real people.
import type { Game } from '../../../core/types/index.ts';
import { mix, SHAPE_FULL, SHAPE_UPPER, type ArmSpec, type FigureSpec, type RigShape } from '../../../core/moves/testing/rig.ts';
import { clamp, smooth } from '../../_shared/util.ts';
import { msOf } from '../../_shared/util.ts';
import type { ChainPerson } from '../../kit-g1/testing/chain.ts';
import { handsUpWhileCalibrating } from '../../_shared/testing/hands.ts';
import type { LimboSim } from '../limbo.ts';
import type { PoseWallSim } from '../posewall.ts';

const simOf = <S>(game: Game | null): S | null => (game as unknown as { sim?: S | null } | null)?.sim ?? null;

export type PersonKind = 'perfect' | 'sloppy' | 'idle';

const UP: ArmSpec = { a: 180, f: 180 };
const SIDE: ArmSpec = { a: 90, f: 90 };
const DOWN: ArmSpec = { a: 0, f: 0 };

// ───────── Limbo Bend ─────────

export interface BendPersonOptions {
  /** perfect: leans to each gate; sloppy: leans to the other side; idle: stands. */
  kind: PersonKind;
  /** Which player of the game this person is (0 or 1). */
  lane?: 0 | 1;
  seated?: boolean;
  shape?: RigShape;
}

export function bendPerson(o: BendPersonOptions): ChainPerson {
  const lane = o.lane ?? 0;
  let bend = 0;
  let arms = 0;
  let last = -1;
  const calibration = handsUpWhileCalibrating();
  return {
    shape: o.shape ?? (o.seated ? SHAPE_UPPER : SHAPE_FULL),
    body(t, game, state) {
      const calibrating = calibration(t, state);
      if (calibrating) return calibrating;
      const sim = simOf<LimboSim>(game);
      if (state !== 'running' || !sim || sim.phase !== 'running' || o.kind === 'idle') { last = -1; bend = 0; arms = 0; return {}; }
      const now = msOf(sim.k);
      const dt = last < 0 ? 0 : Math.min(100, now - last);
      last = now;
      const g = sim.segment.kind === 'work' ? sim.nextGate(lane) : null;
      // the gate is looked at when it is about 2.3 s away: the lean goes to it at up to 70 degrees a second, the hands in 0.3 s
      const near = !!g && g.arriveK - sim.k < 140;
      const want = near && g ? (o.kind === 'sloppy' ? -g.target : g.target) : 0;
      const wantArms = near && g?.tall ? 1 : 0;
      const stepB = 0.07 * dt;
      bend = bend < want ? Math.min(want, bend + stepB) : Math.max(want, bend - stepB);
      arms = clamp(arms + (wantArms > arms ? 1 : -1) * (dt / 300), 0, 1);
      const a = 180 * smooth(arms);
      return { bend, armL: { a, f: a }, armR: { a, f: a } };
    },
  };
}

// ───────── Pose Wall ─────────

/** The shapes a rig figure can make (arms and a bent trunk; the shapes that ask for the legs are out of its reach). */
export const RIG_SHAPES: Readonly<Record<string, FigureSpec>> = {
  tPose: { armL: SIDE, armR: SIDE },
  handsUp: { armL: UP, armR: UP },
  cactus: { armL: { a: 90, f: 180 }, armR: { a: 90, f: 180 } },
  raiseRight: { armL: DOWN, armR: UP },
  raiseLeft: { armL: UP, armR: DOWN },
  yPose: { armL: { a: 150, f: 150 }, armR: { a: 150, f: 150 } },
  diagonalRight: { armL: { a: 45, f: 45 }, armR: { a: 135, f: 135 } },
  diagonalLeft: { armL: { a: 135, f: 135 }, armR: { a: 45, f: 45 } },
  bendRight: { bend: 30, armL: UP, armR: UP },
  bendLeft: { bend: -30, armL: UP, armR: UP },
};

export interface PosePersonOptions {
  /** perfect: makes the shape of each wall (the ones the rig can make); sloppy: the left arm 50 degrees low in every shape; idle: stands. */
  kind: PersonKind;
  lane?: 0 | 1;
  seated?: boolean;
  shape?: RigShape;
}

export function posePerson(o: PosePersonOptions): ChainPerson {
  const lane = o.lane ?? 0;
  let from: FigureSpec = {};
  let to: FigureSpec = {};
  let toName = '';
  let startedAt = -1;
  let cur: FigureSpec = {};
  const calibration = handsUpWhileCalibrating();
  return {
    shape: o.shape ?? (o.seated ? SHAPE_UPPER : SHAPE_FULL),
    body(t, game, state) {
      const calibrating = calibration(t, state);
      if (calibrating) return calibrating;
      const sim = simOf<PoseWallSim>(game);
      if (state !== 'running' || !sim || sim.phase !== 'running' || o.kind === 'idle') { from = to = cur = {}; toName = ''; startedAt = -1; return {}; }
      const now = msOf(sim.k);
      const w = sim.segment.kind === 'work' ? sim.nextWall(lane) : null;
      // the wall is looked at when it is about 1.6 s away, and the shape is made in 0.45 s
      const near = !!w && w.arriveK - sim.k < 96;
      const name = near && w ? w.pose : '';
      if (name !== toName) {
        from = cur;
        toName = name;
        const spec = (name && RIG_SHAPES[name]) || {};
        to = o.kind === 'sloppy' && name && spec.armL ? { ...spec, armL: { a: Math.max(0, (spec.armL.a ?? 0) - 50), f: Math.max(0, (spec.armL.f ?? 0) - 50) } } : spec;
        startedAt = now;
      }
      const u = smooth((now - startedAt) / 450);
      cur = mix(from, to, u);
      return cur;
    },
  };
}
