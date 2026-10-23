// M1 squat depth. Channel 'crouch' is today's crouch level (site/game/pose.js): the deeper of hip drop / 0.55 T and
// head drop / 0.8 T, 0..1; the runner reads it for duck (0.4) and squat (0.7) obstacles. Reps follow
// game-design.md 0.5: down when the hip drop D reaches `down` (0.35 T by default), counted when it comes back
// under `up` (0.12 T); q.depth is the deepest D of the rep. Tracking lost for 600 ms resets the channel to 0.
import type { BodyProfile, Detector, DetectorFactory, Features, MovementEvent } from '../types/index.ts';
import { crouchLevel } from '../body/features.ts';

export const SQUAT_DEFAULTS = { full: 0.55, headFull: 0.8, down: 0.35, up: 0.12, minDownMs: 150, lostMs: 600 } as const;

export const createSquatDetector: DetectorFactory = (_p: BodyProfile, opts = {}): Detector => {
  const o = { ...SQUAT_DEFAULTS, ...opts };
  let crouch = 0;
  let down = false;
  let downSince = 0;
  let deepest = 0;
  let lastOkT = -Infinity;
  return {
    id: 'squat',
    push(f: Features): MovementEvent[] {
      if (!f.ok) {
        if (f.t - lastOkT > o.lostMs) { crouch = 0; down = false; deepest = 0; }
        return [];
      }
      lastOkT = f.t;
      crouch = crouchLevel(f.drop, f.headDrop, o.full, o.headFull);
      if (!down && f.drop >= o.down) { down = true; downSince = f.t; deepest = f.drop; return []; }
      if (down) {
        deepest = Math.max(deepest, f.drop);
        if (f.drop < o.up) {
          down = false;
          if (f.t - downSince >= o.minDownMs) return [{ id: 'squat', kind: 'rep', t: f.t, q: { depth: deepest } }];
        }
      }
      return [];
    },
    value: () => crouch,
    channels: () => ({ crouch }),
    reset() { crouch = 0; down = false; downSince = 0; deepest = 0; lastOkT = -Infinity; },
  };
};
