// Scores the turn tracker against hand labels (tests/traces/growth/labels.json): quick mode (four main directions) and
// the 360 mode (eight steps, a neighbouring step allowed, two steps off never). Used by angle.real.test.ts and by
// tools/growth-fixtures/measure.ts (which prints every miss for tuning on the tuning clips only).
import { traceFrames } from '../../pose/trace.ts';
import type { Trace } from '../../types/index.ts';
import { angleDiff, features, TurnTracker, type Bucket } from './angle.ts';

export interface LabelSample { t: number; deg: number; conf: 'high' | 'low' }
export interface Score { main: { n: number; right: number }; full: { n: number; near: number; far: number }; misses: { t: number; deg: number; got: Bucket | null }[] }

export function score(trace: Trace, samples: readonly LabelSample[]): Score {
  const tr = new TurnTracker();
  const out = traceFrames(trace).map((f) => ({ t: f.t, r: tr.push(features(f.landmarks, f.aspect), f.t) }));
  const at = (ms: number): Bucket | null => {
    let best = out[0], d = Infinity;
    for (const o of out) { const x = Math.abs(o.t - ms); if (x < d) { d = x; best = o; } }
    return best?.r.bucket ?? null;
  };
  const s: Score = { main: { n: 0, right: 0 }, full: { n: 0, near: 0, far: 0 }, misses: [] };
  for (const l of samples) {
    if (l.conf !== 'high') continue;
    const got = at(l.t * 1000);
    const main = (Math.round(l.deg / 90) * 90) % 360;
    if (angleDiff(l.deg, main) <= 15) {
      s.main.n++;
      if (got === main) s.main.right++; else s.misses.push({ t: l.t, deg: l.deg, got });
    }
    const step = (Math.round(l.deg / 45) * 45) % 360;
    s.full.n++;
    if (got !== null && angleDiff(got, step) <= 45) s.full.near++;
    if (got === null || angleDiff(got, step) >= 90) s.full.far++;
  }
  return s;
}
