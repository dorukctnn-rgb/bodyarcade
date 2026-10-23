// M3 lean with today's lane hysteresis (site/game/pose.js): from the centre, a lean beyond 0.30 W moves to that
// side's lane; it returns to the centre once the lean is back under 0.16 W. Lanes never jump straight from one
// side to the other. Channels: 'lean' (W, positive = the player's right) and 'lane' (-1 left, 0, 1 right).
// Events: holdStart when a side lane is entered, holdEnd when the centre is back. Tracking lost for 600 ms: centre.
import type { BodyProfile, Detector, DetectorFactory, Features, MovementEvent } from '../types/index.ts';

export const LEAN_DEFAULTS = { on: 0.3, off: 0.16, lostMs: 600 } as const;

export const createLeanDetector: DetectorFactory = (_p: BodyProfile, opts = {}): Detector => {
  const o = { ...LEAN_DEFAULTS, ...opts };
  let lane: -1 | 0 | 1 = 0;
  let lean = 0;
  let lastOkT = -Infinity;
  const side = (l: -1 | 1): 'L' | 'R' => (l < 0 ? 'L' : 'R');
  return {
    id: 'lean',
    push(f: Features): MovementEvent[] {
      if (!f.ok) {
        if (f.t - lastOkT > o.lostMs && lane !== 0) {
          const was = lane;
          lane = 0; lean = 0;
          return [{ id: 'lean', kind: 'holdEnd', t: f.t, side: side(was) }];
        }
        return [];
      }
      lastOkT = f.t;
      lean = f.lean;
      if (lane === 0) {
        if (lean > o.on) { lane = 1; return [{ id: 'lean', kind: 'holdStart', t: f.t, side: 'R' }]; }
        if (lean < -o.on) { lane = -1; return [{ id: 'lean', kind: 'holdStart', t: f.t, side: 'L' }]; }
      } else if ((lane === 1 && lean < o.off) || (lane === -1 && lean > -o.off)) {
        const was = lane;
        lane = 0;
        return [{ id: 'lean', kind: 'holdEnd', t: f.t, side: side(was) }];
      }
      return [];
    },
    value: () => lean,
    channels: () => ({ lean, lane }),
    reset() { lane = 0; lean = 0; lastOkT = -Infinity; },
  };
};
