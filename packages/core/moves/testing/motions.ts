// Reusable rig motions for detector tests: hands that follow a path, a leg that lifts, arms that point. Test support
// only. Everything is in body units: offsets from the shoulder joint in torso lengths T (+x = the player's right as seen
// in the mirror, +y = up), angles in degrees.
import type { Vec2 } from '../../types/index.ts';
import { armTo, plus, type ArmSpec, type FigureSpec, type Motion } from './rig.ts';

export const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** 0 before t0, 1 after t1, smooth in between. */
export const ramp = (t: number, t0: number, t1: number): number => smooth((t - t0) / Math.max(t1 - t0, 1e-9));

/** A value that goes a -> b between t0 and t1 and holds. */
export const slide = (t: number, t0: number, t1: number, a: number, b: number): number => lerp(a, b, ramp(t, t0, t1));

/** A piecewise-smooth value over time: keys [t, v] sorted by t, holding the first and last. */
export function curve(keys: ReadonlyArray<readonly [number, number]>): (t: number) => number {
  return (t) => {
    const first = keys[0], last = keys[keys.length - 1];
    if (!first || !last) return 0;
    if (t <= first[0]) return first[1];
    if (t >= last[0]) return last[1];
    let i = 0;
    while (i < keys.length - 2 && (keys[i + 1] as readonly [number, number])[0] <= t) i++;
    const a = keys[i] as readonly [number, number], b = keys[i + 1] as readonly [number, number];
    return lerp(a[1], b[1], smooth((t - a[0]) / (b[0] - a[0])));
  };
}

/** Both hands follow their own paths (offsets from their shoulders); the arms are solved frame by frame. */
export function handPaths(left: ((t: number) => Vec2) | undefined, right: ((t: number) => Vec2) | undefined): Motion {
  return (t) => {
    const spec: FigureSpec = {};
    if (left) spec.armL = armTo('L', left(t));
    if (right) spec.armR = armTo('R', right(t));
    return spec;
  };
}

/** A straight arm pointing in a screen direction (degrees, 0 = right, 90 = up): the hand centre `reach` torso lengths from the shoulder (a straight rig arm reaches 1.2; under 1.11 the elbow is bent more than 30 degrees). */
export const pointAt = (deg: number, reach = 1.19): Vec2 => ({ x: Math.cos(deg * Math.PI / 180) * reach, y: Math.sin(deg * Math.PI / 180) * reach });

/** Hanging arms (the rest pose of the rig). */
export const HANG: ArmSpec = { a: 0, f: 0 };

/** Both arms at an angle spec for the whole motion, e.g. both straight up. */
export const arms = (l: ArmSpec, r: ArmSpec): Motion => () => ({ armL: l, armR: r });

/** Knee lift k over time for each leg (0 standing, 1 knee at hip height). */
export const legs = (l: (t: number) => number, r: (t: number) => number): Motion => (t) => ({ legL: { k: l(t) }, legR: { k: r(t) } });

/** A pulse of height `peak` starting at t0: up over upMs, held holdMs, down over downMs. */
export const pulse = (t0: number, peak: number, upMs: number, holdMs: number, downMs: number): ((t: number) => number) =>
  curve([[t0, 0], [t0 + upMs, peak], [t0 + upMs + holdMs, peak], [t0 + upMs + holdMs + downMs, 0]]);

/** Alternating pulses on the two legs: `count` steps every `periodMs`, starting with the left leg at t0. */
export function marching(t0: number, count: number, periodMs: number, peak = 0.9, riseMs = 160, holdMs = 40, fallMs = 160): Motion {
  const pulses = (offset: number): ((t: number) => number) => {
    const ps = Array.from({ length: count }, (_, i) => pulse(t0 + offset + i * periodMs * 2, peak, riseMs, holdMs, fallMs));
    return (t) => ps.reduce((m, p) => Math.max(m, p(t)), 0);
  };
  return legs(pulses(0), pulses(periodMs));
}

export { plus };
