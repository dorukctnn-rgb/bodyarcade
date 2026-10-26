// Small numeric helpers for the strength and gate/pose games. Pure: no DOM, no clock, no Math.random.
import type { Rng } from '../../core/types/index.ts';

/** The fixed step of Game.step: 60 per second (FIXED_DT in core/types). */
export const STEPS_PER_SECOND = 60;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const smooth = (u: number): number => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };
export const round = (v: number, digits = 2): number => { const k = 10 ** digits; return Math.round(v * k) / k; };

/** Whole steps in a number of seconds. Every length in a game is a whole number of steps, so a run never drifts. */
export const stepsOf = (seconds: number): number => Math.round(seconds * STEPS_PER_SECOND);
/** Seconds after a number of steps. */
export const secondsOf = (steps: number): number => steps / STEPS_PER_SECOND;
/** Milliseconds after a number of steps (the same value as stepTime() in core/loop/clock). */
export const msOf = (steps: number): number => (steps * 1000) / STEPS_PER_SECOND;

export const randRange = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);
export const randInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('Nothing to pick from.');
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;
}

/** A shuffled copy (Fisher-Yates) from a seeded stream. */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** A plain-data deep copy: snapshots and restores never share objects with the live state. */
export function copyData<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Mean of a list, 0 for none. */
export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** The value in the middle of a sorted copy of the list, 0 for none. */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
