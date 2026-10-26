// Fixed-step clock: steps per display rate, the 50 ms cap (slow down, never skip), resync after a pause.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng.ts';
import { STEP_MS, createFixedStepClock, stepTime } from './clock.ts';

/** Runs frames at `hz` for `ms` of real time; returns the steps of each frame. */
function frames(hz: number, ms: number, clock = createFixedStepClock(), t0 = 1000): number[] {
  const out: number[] = [];
  for (let i = 0; i * (1000 / hz) <= ms; i++) out.push(clock.advance(t0 + i * (1000 / hz)).steps);
  return out;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('FixedStepClock', () => {
  it('the first frame only sets the time; at 60 Hz every later frame runs exactly one step', () => {
    const s = frames(60, 2000);
    expect(s[0]).toBe(0);
    expect(new Set(s.slice(1))).toEqual(new Set([1]));
  });

  it.each([[30, 2], [20, 3]])('at %i Hz every frame runs %i steps', (hz, n) => {
    const s = frames(hz, 2000);
    expect(new Set(s.slice(1))).toEqual(new Set([n]));
  });

  it('at 144 Hz steps come every second or third frame; one second of frames gives 60 steps', () => {
    const clock = createFixedStepClock();
    const s = frames(144, 1000, clock);
    expect(new Set(s)).toEqual(new Set([0, 1]));
    expect(sum(s)).toBeGreaterThanOrEqual(59);
    expect(sum(s)).toBeLessThanOrEqual(60);
  });

  it('alpha is the share of a step waiting, between 0 and 1', () => {
    const clock = createFixedStepClock();
    clock.advance(0);
    expect(clock.advance(STEP_MS * 0.25).alpha).toBeCloseTo(0.25, 6);
    const r = clock.advance(STEP_MS * 1.5);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5, 6);
  });

  it('below 20 fps it slows down: at most 3 steps per frame, the rest is dropped and counted', () => {
    const clock = createFixedStepClock();
    const s = frames(10, 1000, clock);
    expect(new Set(s.slice(1))).toEqual(new Set([3]));
    expect(clock.steps).toBe(30);
    expect(clock.droppedMs).toBeCloseTo(10 * (100 - 3 * STEP_MS), 6);
  });

  it('a long frame (tab switch, debugger) never makes a burst of steps', () => {
    const clock = createFixedStepClock();
    clock.advance(0);
    expect(clock.advance(5000).steps).toBe(3);
  });

  it('resync() after a pause: the paused time gives no steps, the simulation time is kept', () => {
    const clock = createFixedStepClock();
    frames(60, 1000, clock, 0);
    const before = clock.steps;
    clock.resync(60_000);
    expect(clock.advance(60_000 + STEP_MS).steps).toBe(1);
    expect(clock.steps).toBe(before + 1);
    expect(clock.droppedMs).toBe(0);
  });

  it('simulation time comes from the step count: same frames, same steps and times', () => {
    const rng = mulberry32(7);
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 600; i++) { t += 5 + rng() * 40; times.push(t); }
    const run = (): { steps: number[]; sim: number } => {
      const c = createFixedStepClock();
      return { steps: times.map((x) => c.advance(x).steps), sim: c.simMs };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.sim).toBe(stepTime(sum(a.steps)));
    expect(stepTime(60)).toBe(1000);
  });

  it('a clock that goes backwards or a non-finite time runs no steps', () => {
    const clock = createFixedStepClock();
    clock.advance(100);
    expect(clock.advance(50).steps).toBe(0);
    expect(clock.advance(Number.NaN).steps).toBe(0);
    expect(clock.advance(50 + STEP_MS).steps).toBe(1);
  });

  it('reset() starts again from zero', () => {
    const clock = createFixedStepClock();
    frames(10, 500, clock);
    clock.reset();
    expect([clock.steps, clock.simMs, clock.droppedMs]).toEqual([0, 0, 0]);
    expect(clock.advance(123).steps).toBe(0);
  });
});
