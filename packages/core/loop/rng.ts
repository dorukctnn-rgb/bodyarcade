// Seeded random streams. Games get separate streams ('course', 'fx') so cosmetics never shift the course.
import type { Rng, RngFactory } from '../types/index.ts';

/** mulberry32: small, fast, good enough for games and tests; identical on every JS engine. */
export const mulberry32: RngFactory = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A stable seed for a named stream: the same (seed, name) always gives the same stream. */
export function streamSeed(seed: number, name: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
}

export function rngStream(seed: number, name: string): Rng {
  return mulberry32(streamSeed(seed, name));
}

/** Standard normal sample (Box-Muller) from a seeded stream. */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
