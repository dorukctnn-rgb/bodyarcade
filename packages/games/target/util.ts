// Small helpers the rules share. Pure.
import type { Rng } from '../../core/types/index.ts';
import type { Miss } from '../../core/moves/kit.ts';

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * clamp(k, 0, 1);

/** An integer from lo to hi, both included. */
export const between = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

/** A number from lo up to (not including) hi. */
export const range = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;

/** True with probability p. Always draws one number, so a plan's random stream does not depend on p. */
export const chance = (rng: Rng, p: number): boolean => rng() < p;

/** The reason a target was missed, from the judge, or the given code when the judge never saw the hands. */
export const missCode = (m: Miss | null, fallback = 'hands_out_of_view'): string => m?.code ?? fallback;

/** Whole milliseconds, so plans read the same on every machine. */
export const ms = (v: number): number => Math.round(v);

/** Slow pose rates (a weak phone) get more time: at 24 Hz and above nothing changes, at 12 Hz the time is 1.5 times longer. */
export const slowFactor = (hz: number): number => clamp(24 / Math.max(hz, 6), 1, 1.5);
