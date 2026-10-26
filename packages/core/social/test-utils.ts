// Test helpers shared by the social tests (not imported by any production code).
import type { RandomBytes } from './codes.ts';

/** A small deterministic random source for tests (mulberry32). */
export function seeded(seed: number): RandomBytes {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
}
