// Landmarks to smoothed view-space points for the form coach. One Euro filter per coordinate (pose/one-euro.ts): little jitter
// when the body is still, little lag when it moves. The filters restart after the person was gone for `resetMs`, so a person
// who walks back in does not slide in from where the last one stood. Points are reused between frames (no allocation per frame).
import type { Landmark } from '../types/index.ts';
import { LANDMARK_COUNT } from '../types/index.ts';
import { OneEuro } from '../pose/one-euro.ts';
import type { P } from './geometry.ts';

/** Tuned in image heights per second (a squat moves the hips about 0.3 image heights in half a second). */
export const FORM_SMOOTHING = { minCutoff: 1.5, beta: 2.0, dCutoff: 1.0 } as const;

export class PointSmoother {
  private readonly fx: OneEuro[] = [];
  private readonly fy: OneEuro[] = [];
  readonly pts: P[] = [];
  private lastT = -Infinity;
  private readonly resetMs: number;

  constructor(o: { minCutoff?: number; beta?: number; resetMs?: number } = {}) {
    const opts = { ...FORM_SMOOTHING, ...(o.minCutoff !== undefined ? { minCutoff: o.minCutoff } : {}), ...(o.beta !== undefined ? { beta: o.beta } : {}) };
    this.resetMs = o.resetMs ?? 300;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      this.fx.push(new OneEuro(opts));
      this.fy.push(new OneEuro(opts));
      this.pts.push({ x: 0, y: 0, v: 0 });
    }
  }

  reset(): void {
    for (let i = 0; i < LANDMARK_COUNT; i++) { this.fx[i]!.reset(); this.fy[i]!.reset(); this.pts[i]!.v = 0; }
    this.lastT = -Infinity;
  }

  /** Filters one frame of raw landmarks (raw image fractions, not mirrored) taken at `t` ms; returns the view-space points. */
  push(lm: readonly Landmark[], t: number, aspect: number): readonly P[] {
    if (t - this.lastT > this.resetMs) this.reset();
    this.lastT = t;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const raw = lm[i];
      const p = this.pts[i]!;
      if (!raw) { p.v = 0; continue; }
      p.x = this.fx[i]!.filter((1 - raw.x) * aspect, t);
      p.y = this.fy[i]!.filter(raw.y, t);
      p.v = raw.visibility;
    }
    return this.pts;
  }
}
