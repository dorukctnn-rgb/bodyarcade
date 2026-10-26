// M2 jump, with today's thresholds (site/game/pose.js): hips rise more than 0.20 T above rest while not crouching
// (crouch < 0.35) fires one jump; it re-arms when the hips are back under 0.08 T and 350 ms have passed.
// Tracking lost for more than 600 ms re-arms it (today's behaviour resets the inputs after 0.6 s).
import type { BodyProfile, Detector, DetectorFactory, Features, MovementEvent } from '../types/index.ts';
import { crouchLevel } from '../body/features.ts';

export const JUMP_DEFAULTS = { rise: 0.2, rearm: 0.08, refractoryMs: 350, maxCrouch: 0.35, lostMs: 600 } as const;

export const createJumpDetector: DetectorFactory = (_p: BodyProfile, opts = {}): Detector => {
  const o = { ...JUMP_DEFAULTS, ...opts };
  let armed = true;
  let lastJumpT = -Infinity;
  let lastOkT = -Infinity;
  let rise: number | undefined;
  return {
    id: 'jump',
    push(f: Features): MovementEvent[] {
      if (!f.ok) {
        if (f.t - lastOkT > o.lostMs) { armed = true; rise = undefined; }
        return [];
      }
      lastOkT = f.t;
      rise = f.rise;
      const crouch = crouchLevel(f.drop, f.headDrop);
      if (armed && f.rise > o.rise && crouch < o.maxCrouch) {
        armed = false;
        lastJumpT = f.t;
        return [{ id: 'jump', kind: 'rep', t: f.t, q: { speed: f.vel.hip ? (f.vel.hip[0].y + f.vel.hip[1].y) / 2 : 0 } }];
      }
      if (!armed && f.rise < o.rearm && f.t - lastJumpT > o.refractoryMs) armed = true;
      return [];
    },
    value: () => rise,
    channels: () => ({ rise: rise ?? 0 }),
    reset() { armed = true; lastJumpT = -Infinity; lastOkT = -Infinity; rise = undefined; },
  };
};
