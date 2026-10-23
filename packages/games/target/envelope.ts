// Where a player can reach, and where targets may go (game-design.md 0.3 step 2 and the cards of Star Catch, Pad Work
// and Reaction Tag: "targets are placed inside the measured reach envelope", "pads are given in arm lengths from the
// shoulder midpoint").
//
// Everything is body space (types/body.ts): origin at the rest hip midpoint, unit = the torso length T, +x = the
// player's right as seen in the mirror, +y = up. A plan (the list of what appears when) stores positions in ARM LENGTHS
// from the shoulder midpoint, so it does not depend on anybody's body; `spot` turns them into body space for one player.
// That is what lets two players (or a duel, or a ghost) play the same pattern, each inside their own reach.
import type { BodyProfile, Side, Vec2 } from '../../core/types/index.ts';
import { reachEnvelope } from '../../core/moves/handHit.ts';
import { scalesOf } from '../../core/moves/kit.ts';

/** Hands closer than this to the edge of the picture (T) are lost by the pose model, so no target goes there. */
export const FRAME_MARGIN = 0.3;
/** A seated player reaches a little less far and cannot lean or step: arm-length offsets shrink by this much. */
export const SEATED_SCALE = 0.86;
/** The average arm and shoulder proportions plans are written for (arm 1.15 T, shoulder width 0.8 T). */
export const NOMINAL = { arm: 1.15, halfW: 0.4 } as const;

export interface Box { x0: number; x1: number; y0: number; y1: number }

export interface Envelope {
  /** Height of the shoulder midpoint above the rest hip (1 T by the definition of T). */
  shoulderY: number;
  /** Half the shoulder width and the arm length, in T. */
  halfW: number;
  arm: number;
  /** The highest a hand is asked to go (T above the hip): the calibrated hands-up height, or one arm above the shoulders. */
  top: number;
  /** The part of the picture where a hand is tracked well, in body space, with the margin taken off. */
  frame: Box;
  /** Height of a standing foot above or below the hip (T), or null when the framing cannot see feet. */
  floorY: number | null;
  seated: boolean;
  /** Pose frames per second measured at calibration; slow devices get more time. */
  hz: number;
}

export function envelopeOf(p: BodyProfile, o: { seated: boolean }): Envelope {
  const T = Math.max(p.T, 1e-6);
  const sc = scalesOf(p);
  const r = reachEnvelope(p);
  const frame: Box = {
    x0: -p.rest.hipX / T + FRAME_MARGIN,
    x1: (p.aspect - p.rest.hipX) / T - FRAME_MARGIN,
    y0: (p.rest.hipY - 1) / T + FRAME_MARGIN,
    y1: p.rest.hipY / T - FRAME_MARGIN,
  };
  const feet = p.framing === 'full' && p.U !== undefined && p.U > 0;
  // Overhead: the hands-up height measured at calibration when there is one, else a full arm over the shoulders. The
  // top 10 percent of that is left out so a star never asks for the last centimetre of a stretch.
  const top = 1 + (r.up - 1) * 0.9;
  return {
    shoulderY: 1,
    halfW: sc.w / 2,
    arm: sc.a,
    top: Math.min(top, frame.y1),
    frame,
    floorY: feet ? -2 * sc.u : null,
    seated: o.seated,
    hz: p.hz,
  };
}

const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/** Pulls a point inside the part of the picture where a hand can be seen, and under the overhead limit. */
export function fit(env: Envelope, p: Vec2): Vec2 {
  return { x: clamp(p.x, env.frame.x0, env.frame.x1), y: clamp(p.y, env.frame.y0, Math.min(env.frame.y1, env.top)) };
}

/** A point given in arm lengths from the shoulder midpoint (x to the right, y up), for this player: in body space and inside the picture. */
export function spot(env: Envelope, ax: number, ay: number): Vec2 {
  const k = env.seated ? SEATED_SCALE : 1;
  return fit(env, { x: ax * k * env.arm, y: env.shoulderY + ay * k * env.arm });
}

/** The same point without fitting it into the picture (where the plan meant it to be). */
export function spotRaw(env: Envelope, ax: number, ay: number): Vec2 {
  const k = env.seated ? SEATED_SCALE : 1;
  return { x: ax * k * env.arm, y: env.shoulderY + ay * k * env.arm };
}

/** Distance from the player's own shoulder as a share of the arm: at most about 1 for a point the hand can reach standing still. */
export function reachRatio(env: Envelope, side: Side, p: Vec2): number {
  const sx = side === 'L' ? -env.halfW : env.halfW;
  return Math.hypot(p.x - sx, p.y - env.shoulderY) / Math.max(env.arm, 1e-6);
}

/** Where the foot lights sit: on the floor line, `fx` shoulder widths either side of the hip centre. */
export function floorSpot(env: Envelope, fx: number): Vec2 | null {
  if (env.floorY === null) return null;
  const w = env.halfW * 2;
  return { x: clamp(fx * w, env.frame.x0, env.frame.x1), y: Math.max(env.floorY, env.frame.y0) };
}

/** The body a player has when nobody was calibrated (keyboard and touch rounds): the picture's stand-in body. */
export function nominalProfile(o: { seated: boolean; aspect?: number } = { seated: false }): BodyProfile {
  const aspect = o.aspect ?? 4 / 3;
  const T = 0.26;
  return {
    v: 2,
    framing: o.seated ? 'upper' : 'full',
    capturedAt: 0,
    aspect,
    T,
    W: T * NOMINAL.halfW * 2,
    A: T * NOMINAL.arm,
    U: T * 0.9,
    rest: { hipX: aspect / 2, hipY: 0.62, shoulderX: aspect / 2, shoulderY: 0.36, noseY: 0.26 },
    hz: 30,
  };
}
