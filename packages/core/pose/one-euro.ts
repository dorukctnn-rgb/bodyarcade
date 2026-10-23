// One Euro filter (Casiez, Roussel, Vogel, CHI 2012): little jitter when still, little lag when moving fast.
// Times are milliseconds; `derivScale` converts the derivative into the units that `beta` is tuned in (for example
// 1 / T, so beta works in torso lengths per second whatever the distance to the camera).
import type { OneEuroOptions } from '../types/index.ts';

export const ONE_EURO_DEFAULTS: OneEuroOptions = { minCutoff: 1.2, beta: 0.8, dCutoff: 1.0 };

const alpha = (cutoff: number, dtSec: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSec);
};

export class OneEuro {
  private readonly o: OneEuroOptions;
  private readonly derivScale: number;
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(o: Partial<OneEuroOptions> = {}, derivScale = 1) {
    this.o = { ...ONE_EURO_DEFAULTS, ...o };
    this.derivScale = derivScale;
  }

  /** Filters `v` measured at `tMs`. Samples that do not move time forward return the current value. */
  filter(v: number, tMs: number): number {
    if (this.x === null) { this.x = v; this.dx = 0; this.t = tMs; return v; }
    const dt = (tMs - this.t) / 1000;
    if (!(dt > 0)) return this.x;
    this.t = tMs;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.o.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.o.minCutoff + this.o.beta * Math.abs(this.dx * this.derivScale);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }

  /** The filtered value, or null before the first sample. */
  get value(): number | null { return this.x; }

  /** The filtered rate of change, units per second. */
  get derivative(): number { return this.dx; }

  reset(): void { this.x = null; this.dx = 0; this.t = 0; }
}
