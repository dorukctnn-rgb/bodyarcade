// The slow re-centring of the rest pose (the 8 s drift) and turned shoulders. Found by G3 in the browser on 24 Oct: after
// about 15 s of steady twisting (or one long overload hold) the twist detector never counted again, because the drift moved
// the rest shoulder width to the turned, narrower width. A turn must not be re-centred on; a small change of distance still is.
import { describe, expect, it } from 'vitest';
import type { BodyProfile, Features, Framing, PoseFrame } from '../types/index.ts';
import { DEFAULT_SHAPE, DESK_SHAPE, synthFrames, type BodyShape } from '../pose/synth.ts';
import { createCalibrator } from './calibrator.ts';
import { createFeatureExtractor } from './features.ts';

/** Calibrates on the start of the frames, then runs the extractor over the rest; returns the shoulder span over time. */
function spans(frames: PoseFrame[], want: Framing, o: { driftSeconds?: number } = {}): { t: number; span: number }[] {
  const c = createCalibrator({ now: () => 0 });
  c.begin(want);
  let from = -1;
  for (let i = 0; i < frames.length; i++) if (c.push(frames[i] as PoseFrame).ready) { from = i + 1; break; }
  if (from < 0) throw new Error('did not calibrate');
  const profile = c.profile() as BodyProfile;
  const fx = createFeatureExtractor(o);
  return frames.slice(from).map((f) => { const x: Features = fx.push(f, profile); return { t: f.t, span: x.shoulderSpan }; });
}

const at = (s: { t: number; span: number }[], ms: number): number => (s.find((x) => x.t >= ms) ?? s.at(-1)!).span;

/** A twist, as the camera sees it: the shoulders narrow, the torso keeps its length. */
const twisted = (base: BodyShape, share: number): BodyShape => ({ ...base, W: base.W * share });
/** A step back: everything narrows by the same share (the shoulders and the torso alike), about the hip. */
const further = (base: BodyShape, share: number): BodyShape => ({ ...base, T: base.T * share, W: base.W * share });

const run = (shapeAt: (t: number) => BodyShape): PoseFrame[] => synthFrames({ durationMs: 40_000, shapeAt, seed: 4, noise: 0.001 });

describe('drift does not follow a turn', () => {
  it('a held twist (shoulders at 80%): after 35 s the span is still 80%, the twist is still there to be counted', () => {
    const s = spans(run((t) => (t < 2000 ? DEFAULT_SHAPE : twisted(DEFAULT_SHAPE, 0.8))), 'full');
    expect(at(s, 4000)).toBeCloseTo(0.8, 1);
    expect(at(s, 20_000)).toBeCloseTo(0.8, 1);
    expect(at(s, 38_000)).toBeCloseTo(0.8, 1);
  });

  it('at a desk, where the torso is only estimated from the shoulders, a held turn is not re-centred either', () => {
    const s = spans(run((t) => (t < 2000 ? DESK_SHAPE : twisted(DESK_SHAPE, 0.8))), 'upper');
    expect(at(s, 38_000)).toBeCloseTo(0.8, 1);
  });

  it('a span just under the limit (90%) is a turn too, and one just over it (95%) is not', () => {
    expect(at(spans(run((t) => (t < 2000 ? DEFAULT_SHAPE : twisted(DEFAULT_SHAPE, 0.9))), 'full'), 38_000)).toBeCloseTo(0.9, 1);
    expect(Math.abs(at(spans(run((t) => (t < 2000 ? DEFAULT_SHAPE : twisted(DEFAULT_SHAPE, 0.95))), 'full'), 38_000) - 1)).toBeLessThan(0.03);
  });
});

describe('drift still follows a small change of distance and a nudge', () => {
  it('a step back of 5% (everything narrower, same proportions): the rest follows within about 30 s and the span is back to 1', () => {
    const s = spans(run((t) => (t < 2000 ? DEFAULT_SHAPE : further(DEFAULT_SHAPE, 0.95))), 'full');
    expect(at(s, 4000)).toBeCloseTo(0.95, 1);
    expect(Math.abs(at(s, 38_000) - 1)).toBeLessThan(0.03);
  });

  it('a step closer of 5%: the same', () => {
    const s = spans(run((t) => (t < 2000 ? DEFAULT_SHAPE : further(DEFAULT_SHAPE, 1.05))), 'full');
    expect(at(s, 4000)).toBeCloseTo(1.05, 1);
    expect(Math.abs(at(s, 38_000) - 1)).toBeLessThan(0.03);
  });

  it('standing still: nothing moves, the span stays 1', () => {
    const s = spans(run(() => DEFAULT_SHAPE), 'full');
    expect(at(s, 38_000)).toBeCloseTo(1, 1);
  });
});
