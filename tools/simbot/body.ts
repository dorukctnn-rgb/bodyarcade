// Bodies for the simulation bot: a synthetic person that moves at random, seen by the real chain (pose frames, calibration,
// feature extraction, the movement detectors, the input hub) instead of random events. It stands still while the session
// calibrates and counts down, then flails: arms, legs, squats, jumps, bends and twists at random, smoothly, for a game that
// makes no assumption about what its player does. `leaver` also walks out of the picture and comes back, as people do.
import { mix, type FigureSpec, type RigShape } from '../../packages/core/moves/testing/rig.ts';
import { mulberry32 } from '../../packages/core/loop/rng.ts';
import type { ChainPerson } from '../../packages/games/kit-g1/testing/chain.ts';

const between = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r();

/** One random pose: every part of the body gets a value inside what a person can do. */
export function randomFigure(r: () => number, o: { upper?: boolean } = {}): FigureSpec {
  const f: FigureSpec = {
    dx: between(r, -0.6, 0.6), rise: r() < 0.25 ? between(r, 0.1, 0.5) : 0, drop: r() < 0.3 ? between(r, 0.1, 0.7) : 0,
    bend: between(r, -30, 30), fore: r() < 0.2 ? between(r, 0.1, 0.45) : 0, twist: between(r, -70, 70),
    armL: { a: between(r, 0, 180), f: between(r, 0, 180) }, armR: { a: between(r, 0, 180), f: between(r, 0, 180) },
  };
  if (!o.upper) { f.legL = { k: r() < 0.4 ? between(r, 0, 1) : 0, out: between(r, 0, 0.5) }; f.legR = { k: r() < 0.4 ? between(r, 0, 1) : 0, out: between(r, 0, 0.5) }; }
  return f;
}

export interface FlailOptions {
  seed: number;
  shape: RigShape;
  upper?: boolean;
  /** Walks out of the picture for a few seconds now and then. */
  leaver?: boolean;
}

export function flailer(o: FlailOptions): ChainPerson {
  const r = mulberry32(o.seed >>> 0);
  let a: FigureSpec = {};
  let b: FigureSpec = randomFigure(r, { upper: o.upper ?? false });
  let tA = 0;
  let tB = 600;
  let started = -1;
  return {
    shape: o.shape,
    body(t, _game, state) {
      // Still while the session sets up; the moving starts with the round.
      if (state !== 'running') { tA = t; tB = t + 400; return {}; }
      if (started < 0) started = t;
      // Every 21 s of the round the person is out of the picture for 3 s.
      if (o.leaver && (t - started) % 21_000 > 14_000 && (t - started) % 21_000 < 17_000) return { absent: true };
      while (t >= tB) { a = b; b = randomFigure(r, { upper: o.upper ?? false }); tA = tB; tB += between(r, 400, 1500); }
      return mix(a, b, Math.min(1, Math.max(0, (t - tA) / Math.max(1, tB - tA))));
    },
  };
}

/** Somebody who is not moving at all (stands in front of the camera and waits). */
export function stander(shape: RigShape): ChainPerson {
  return { shape, body: () => ({}) };
}
