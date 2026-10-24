// A body in a test that does what a person does when a game asks for headroom (manifest `headroom: 'arms-up'`: Firework Jacks, Limbo
// Bend, Pose Wall): once the body fits and has been held, the calibration asks for both hands up once and checks the picture holds
// them (core/body/headroom.ts). Without it the calibration waits its six seconds and plays on with the check unmade, which is slow in a
// real-time run and says nothing about the check. Test support: nothing in production imports it.
import type { ArmSpec, FigureSpec } from '../../../core/moves/testing/rig.ts';
import type { SessionState } from '../../../core/types/index.ts';

const UP: ArmSpec = { a: 180, f: 180 };

/** How long the body stands still before the hands go up: the calibration holds it for a second first. */
export const HANDS_AFTER_MS = 2400;

/**
 * For the calibration state of a person's `body()`: null when the session is not calibrating (the person's own play goes on), a figure
 * standing still for the first 2.4 s of the calibration and then with both hands up.
 */
export function handsUpWhileCalibrating(): (t: number, state: SessionState) => FigureSpec | null {
  let since = -1;
  return (t, state) => {
    if (state !== 'calibrating') { since = -1; return null; }
    if (since < 0) since = t;
    return t - since > HANDS_AFTER_MS ? { armL: UP, armR: UP } : {};
  };
}
