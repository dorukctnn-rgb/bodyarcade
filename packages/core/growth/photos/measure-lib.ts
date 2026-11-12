// Scores the turn tracker against hand labels (tests/traces/growth/labels.json): quick mode (four main directions) and
// the 360 mode (eight steps, a neighbouring step allowed, two steps off never). Used by angle.real.test.ts and by
// tools/growth-fixtures/measure.ts (which prints every miss for tuning on the tuning clips only). photoScore: which frame
// each direction's photo would be.
import { traceFrames } from '../../pose/trace.ts';
import type { Trace } from '../../types/index.ts';
import { angleDiff, centrality, features, FULL_BUCKETS, QUICK_BUCKETS, TurnTracker, widthOf, type Bucket } from './angle.ts';

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

/** The labelled body angle at a time: the two nearest labels, along the shorter way round. */
export function labelAt(samples: readonly LabelSample[], ms: number): number {
  const t = ms / 1000;
  const s = [...samples].sort((a, b) => a.t - b.t);
  if (t <= s[0]!.t) return s[0]!.deg;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (t > b.t) continue;
    const d = ((b.deg - a.deg + 540) % 360) - 180;
    return (((a.deg + d * ((t - a.t) / (b.t - a.t || 1))) % 360) + 360) % 360;
  }
  return s[s.length - 1]!.deg;
}

export interface PhotoScore {
  /** directions the capture should fill, and how many it filled */
  wanted: number;
  filled: number;
  /** filled photos whose labelled angle is within `tol` degrees of their direction */
  right: number;
  photos: { bucket: Bucket; t: number; deg: number; off: number }[];
}

/**
 * Which frame each direction's photo would be: the guided capture's own choice (capture.ts: the most centred frame the turn
 * tracker put in that direction; the quick mode takes exact readings only), checked against the labelled angle at its time.
 * The capture's other checks (stillness, feet, distance) are left out: the stock clips turn faster than the guide asks and
 * are framed to the thighs, so those checks are tested on the synthetic trace. Tolerance 22.5 degrees: the photo is nearer
 * its own direction than any other 45-degree step.
 */
export function photoScore(trace: Trace, samples: readonly LabelSample[], mode: 'quick' | 'full', tol = 22.5): PhotoScore {
  const wanted = mode === 'quick' ? QUICK_BUCKETS : FULL_BUCKETS;
  const tr = new TurnTracker();
  const best = new Map<Bucket, { t: number; score: number }>();
  for (const f of traceFrames(trace)) {
    const feat = features(f.landmarks, f.aspect);
    const r = tr.push(feat, f.t);
    if (!feat || r.bucket === null || !wanted.includes(r.bucket) || (mode === 'quick' && r.approximate)) continue;
    const sc = centrality(r.bucket, widthOf(feat));
    const cur = best.get(r.bucket);
    if (!cur || sc > cur.score + 0.01) best.set(r.bucket, { t: f.t, score: sc });
  }
  const photos = wanted.flatMap((b) => {
    const c = best.get(b);
    if (!c) return [];
    const deg = labelAt(samples, c.t);
    return [{ bucket: b, t: Math.round(c.t) / 1000, deg: Math.round(deg), off: Math.round(angleDiff(deg, b)) }];
  });
  return { wanted: wanted.length, filled: photos.length, right: photos.filter((p) => p.off <= tol).length, photos };
}
