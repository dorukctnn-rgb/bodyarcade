// Fixed-step clock (code-audit 11.4, WP6). The simulation always advances in steps of FIXED_DT, whatever the display
// rate; advance(now) turns the real time of an animation frame into a number of steps plus the render alpha.
// - At most maxSteps per frame (default 3 = 50 ms, today's runner clamps dt to 0.05 s): below 20 fps the game slows
//   down instead of skipping, so a slow device plays the same course in simulation time. The real time given up is
//   counted in droppedMs.
// - resync(now) after a pause or a countdown: the time in between never turns into a burst of steps.
// - Step k (1-based) happens at simulation time stepTime(k) = k x 1000 / 60 ms, computed from the integer count, so
//   the same number of steps always gives the same times.
import { FIXED_DT, type Ms } from '../types/index.ts';

export const STEP_MS = FIXED_DT * 1000;

export const CLOCK_DEFAULTS = { maxSteps: 3 } as const;

/** Simulation time of step k (k = 1 is the first step of a run). */
export const stepTime = (k: number): Ms => (k * 1000) / 60;

export interface FixedStepClock {
  /** Steps to run for this frame, and the render alpha (0..1) between the last two steps. */
  advance(now: Ms): { steps: number; alpha: number };
  /** Steps run since reset(). */
  readonly steps: number;
  /** Simulation time of the last step (stepTime(steps)). */
  readonly simMs: Ms;
  /** Real time given up because frames came too slowly. */
  readonly droppedMs: Ms;
  /** The next advance() measures from `now`, keeping the simulation time. */
  resync(now: Ms): void;
  /** Back to zero steps. */
  reset(): void;
}

export function createFixedStepClock(o: { maxSteps?: number } = {}): FixedStepClock {
  const maxSteps = Math.max(1, Math.floor(o.maxSteps ?? CLOCK_DEFAULTS.maxSteps));
  let last: number | null = null;
  let acc = 0;
  let steps = 0;
  let dropped = 0;

  return {
    advance(now: Ms): { steps: number; alpha: number } {
      if (last === null || !Number.isFinite(now)) {
        if (Number.isFinite(now)) last = now;
        return { steps: 0, alpha: 0 };
      }
      const dt = now - last;
      last = now;
      if (dt > 0) acc += dt;
      // The epsilon keeps 16.666... + 16.666... from counting as one step through rounding.
      let n = Math.floor(acc / STEP_MS + 1e-9);
      if (n > maxSteps) {
        dropped += (n - maxSteps) * STEP_MS;
        acc -= (n - maxSteps) * STEP_MS;
        n = maxSteps;
      }
      acc = Math.max(0, acc - n * STEP_MS);
      steps += n;
      return { steps: n, alpha: Math.min(1, acc / STEP_MS) };
    },
    get steps() { return steps; },
    get simMs() { return stepTime(steps); },
    get droppedMs() { return dropped; },
    resync(now: Ms): void {
      last = now;
      acc = 0;
    },
    reset(): void {
      last = null;
      acc = 0;
      steps = 0;
      dropped = 0;
    },
  };
}
