// Arithmetic the simulations use. Only +, -, *, / and comparisons: no Math.sin or Math.cos (their last digits differ
// between JavaScript engines, and a replay must be identical on every device).
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export const smoothstep = (u: number): number => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };

/** A smooth triangle wave in -1..1 with period 1. */
export function wave(p: number): number {
  const f = p - Math.floor(p);
  const tri = f < 0.5 ? f * 4 - 1 : 3 - f * 4;
  return tri * (1.5 - 0.5 * tri * tri);
}

export const median = (a: readonly number[]): number => {
  if (a.length === 0) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? (b[m] as number) : ((b[m - 1] as number) + (b[m] as number)) / 2;
};

/** Rounds to a number of decimals (for summaries: the same numbers on every device). */
export const round = (v: number, decimals = 2): number => { const k = 10 ** decimals; return Math.round(v * k) / k; };
