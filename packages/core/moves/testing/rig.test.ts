// The test rig must itself be right: its profile equals what the real calibrator measures on the same figure, its
// features equal the real extractor's at rest, and the arm and knee controls land where they say.
import { describe, expect, it } from 'vitest';
import { createCalibrator } from '../../body/calibrator.ts';
import { createFeatureExtractor } from '../../body/features.ts';
import type { BodyProfile, PoseFrame } from '../../types/index.ts';
import { armTo, keyframes, landmarksOf, plus, profileOf, simulate, SHAPE_FULL, SHAPE_UPPER, still, skeleton, BUILD } from './rig.ts';

const calibrate = (frames: PoseFrame[], framing: 'full' | 'upper'): BodyProfile => {
  const c = createCalibrator({ now: () => 0 });
  c.begin(framing);
  for (const f of frames) if (c.push(f).ready) return c.profile() as BodyProfile;
  throw new Error('did not calibrate');
};

describe('rig profile and features agree with the real calibrator and extractor', () => {
  it('standing figure: profileOf equals the calibrated profile', () => {
    const sim = simulate(still(), { durationMs: 3000 });
    const real = calibrate(sim.frames, 'full');
    const mine = profileOf(SHAPE_FULL, 'full');
    expect(real.T).toBeCloseTo(mine.T, 4);
    expect(real.W).toBeCloseTo(mine.W, 4);
    expect(real.A).toBeCloseTo(mine.A as number, 3);
    expect(real.U).toBeCloseTo(mine.U as number, 3);
    expect(real.rest.hipX).toBeCloseTo(mine.rest.hipX, 4);
    expect(real.rest.hipY).toBeCloseTo(mine.rest.hipY, 4);
    expect(real.rest.shoulderY).toBeCloseTo(mine.rest.shoulderY, 4);
    expect(real.rest.noseY).toBeCloseTo(mine.rest.noseY, 4);
  });

  it('upper framing has no thigh length and the knees are out of view', () => {
    const sim = simulate(still(), { durationMs: 2000, shape: SHAPE_UPPER });
    expect(profileOf(SHAPE_UPPER, 'upper').U).toBeUndefined();
    const f = sim.features.at(-1)!;
    expect(f.ok).toBe(true);
    expect(f.seen.knees).toBe(false);
    expect(f.seen.ankles).toBe(false);
    expect(f.seen.hands).toBe(true);
  });

  it('unfiltered features equal the One Euro extractor on a still figure', () => {
    const sim = simulate(still(), { durationMs: 3000 });
    const fx = createFeatureExtractor();
    let last = sim.features[0]!;
    for (const fr of sim.frames) last = fx.push(fr, sim.profile);
    const mine = sim.features.at(-1)!;
    expect(last.hip.y).toBeCloseTo(mine.hip.y, 2);
    expect(last.head.y).toBeCloseTo(mine.head.y, 2);
    expect(last.hand[0].x).toBeCloseTo(mine.hand[0].x, 2);
    expect(last.knee[1].y).toBeCloseTo(mine.knee[1].y, 2);
    expect(last.shoulderSpan).toBeCloseTo(1, 2);
  });

  it('rest: shoulders at +1 T, the player right is +x, left is -x, ankles at -1.8 T', () => {
    const f = simulate(still(), { durationMs: 200 }).features.at(-1)!;
    expect(f.shoulder.y).toBeCloseTo(1, 3);
    expect(f.shoulders[0].x).toBeCloseTo(-0.4, 3);
    expect(f.shoulders[1].x).toBeCloseTo(0.4, 3);
    expect(f.ankle[0].y).toBeCloseTo(-1.8, 3);
    expect(f.hip.x).toBeCloseTo(0, 3);
    expect(f.rise).toBeCloseTo(0, 3);
    // arms hang: the hand centre is about A + 0.07 T below the shoulder
    expect(f.hand[1].y).toBeLessThan(0.1);
    expect(f.hand[1].y).toBeGreaterThan(-0.5);
  });
});

describe('figure controls', () => {
  it('a jump raises everything and a squat lowers hips and shoulders', () => {
    const j = simulate(still({ rise: 0.3 }), { durationMs: 100 }).features.at(-1)!;
    expect(j.rise).toBeCloseTo(0.3, 3);
    const s = simulate(still({ drop: 0.5 }), { durationMs: 100 }).features.at(-1)!;
    expect(s.drop).toBeCloseTo(0.5, 3);
    expect(s.shoulder.y).toBeCloseTo(1 - 0.5 - 0.06, 3);
  });

  it('side bend moves the shoulders toward + for a positive angle and the lean feature follows', () => {
    const f = simulate(still({ bend: 20 }), { durationMs: 100 }).features.at(-1)!;
    expect(f.shoulder.x).toBeGreaterThan(0.3);
    expect(f.lean).toBeGreaterThan(0.3);
    const g = simulate(still({ bend: -20 }), { durationMs: 100 }).features.at(-1)!;
    expect(g.shoulder.x).toBeLessThan(-0.3);
  });

  it('twist narrows the shoulders by cos', () => {
    const f = simulate(still({ twist: 30 }), { durationMs: 100 }).features.at(-1)!;
    expect(f.shoulderSpan).toBeCloseTo(Math.cos(Math.PI / 6), 2);
  });

  it('knee lift k puts the knee at hip height at k = 1 and leaves the foot above the floor', () => {
    const f = simulate(still({ legL: { k: 1 } }), { durationMs: 100 }).features.at(-1)!;
    expect(f.knee[0].y).toBeCloseTo(0, 3);
    expect(f.knee[1].y).toBeCloseTo(-0.9, 3);
    expect(f.ankle[0].y).toBeGreaterThan(-1.8 + 0.8);
  });

  it('armTo reaches the requested hand centre for both sides', () => {
    for (const side of ['L', 'R'] as const) {
      for (const target of [{ x: 0.5, y: 0.3 }, { x: 0.1, y: 1.0 }, { x: 0.9, y: 0 }, { x: -0.2, y: -0.3 }]) {
        const arm = armTo(side, target);
        const spec = side === 'L' ? { armL: arm } : { armR: arm };
        const f = simulate(still(spec), { durationMs: 100 }).features.at(-1)!;
        const s = side === 'L' ? f.shoulders[0] : f.shoulders[1];
        const h = side === 'L' ? f.hand[0] : f.hand[1];
        expect(h.x - s.x).toBeCloseTo(target.x, 1);
        expect(h.y - s.y).toBeCloseTo(target.y, 1);
      }
    }
  });

  it('keyframes ease between keys and hold at both ends; plus adds independent parts', () => {
    const m = keyframes([[0, {}], [1000, { drop: 0.6 }]]);
    expect(m(-5).drop ?? 0).toBe(0);
    expect(m(500).drop).toBeCloseTo(0.3, 6);
    expect(m(2000).drop).toBeCloseTo(0.6, 6);
    const both = plus(still({ armL: { a: 90 } }), still({ legR: { k: 0.5 } }));
    expect(both(0).armL?.a).toBe(90);
    expect(both(0).legR?.k).toBe(0.5);
  });

  it('hidden groups report low visibility; absent gives no landmarks', () => {
    const lm = landmarksOf({ hide: ['knees'] })!;
    expect(lm[25]!.visibility).toBeLessThan(0.5);
    expect(lm[11]!.visibility).toBeGreaterThan(0.9);
    expect(landmarksOf({ absent: true })).toBeNull();
    expect(skeleton({}, BUILD)).toHaveLength(33);
  });
});
