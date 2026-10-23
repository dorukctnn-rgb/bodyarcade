// FeatureExtractor: body space, signs and units against the synthetic figure, missing frames, drift.
import { describe, expect, it } from 'vitest';
import type { BodyProfile, Features, PoseFrame } from '../types/index.ts';
import { OneEuro } from '../pose/one-euro.ts';
import { combine, jumpAt, leanAt, squatAt, synthTrace } from '../pose/synth.ts';
import { traceFrames } from '../pose/trace.ts';
import { createCalibrator } from './calibrator.ts';
import { createFeatureExtractor, crouchLevel } from './features.ts';

function calibrated(frames: PoseFrame[]): { profile: BodyProfile; rest: PoseFrame[] } {
  const c = createCalibrator({ now: () => 0 });
  c.begin('full');
  for (let i = 0; i < frames.length; i++) {
    if (c.push(frames[i] as PoseFrame).ready) return { profile: c.profile() as BodyProfile, rest: frames.slice(i + 1) };
  }
  throw new Error('did not calibrate');
}

function featuresOf(motion: Parameters<typeof synthTrace>[0]['motion'], ms = 6000, o: { noise?: number } = {}): Features[] {
  const t = synthTrace({ id: 'f', durationMs: ms, fps: 30, seed: 5, noise: o.noise ?? 0.001, ...(motion ? { motion } : {}) });
  const { profile, rest } = calibrated(traceFrames(t));
  const fx = createFeatureExtractor();
  return rest.map((f) => fx.push(f, profile));
}

const near = (fs: Features[], t0: number, t1: number): Features[] => fs.filter((f) => f.t >= t0 && f.t <= t1);

describe('One Euro filter', () => {
  it('removes jitter at rest and follows a fast move with little lag', () => {
    const f = new OneEuro({ minCutoff: 1.2, beta: 0.8 });
    let maxJitter = 0;
    for (let i = 0; i < 60; i++) {
      const v = f.filter(i % 2 ? 0.01 : -0.01, i * 33.3);   // +-0.01 alternating: pure jitter
      if (i >= 10) maxJitter = Math.max(maxJitter, Math.abs(v));
    }
    expect(maxJitter).toBeLessThan(0.005);
    // a step of 1 unit at 30 Hz: past 80% within 5 frames
    let v = 0;
    for (let i = 60; i < 65; i++) v = f.filter(1, i * 33.3);
    expect(v).toBeGreaterThan(0.8);
    expect(f.derivative).toBeGreaterThan(0);
  });
});

describe('features', () => {
  it('standing still: everything near rest, in body space (origin rest hip, unit T, +x player right, +y up)', () => {
    const fs = featuresOf(undefined, 4000);
    const f = fs.at(-1)!;
    expect(f.ok).toBe(true);
    expect(f.seen).toMatchObject({ head: true, shoulders: true, hips: true, knees: true, ankles: true });
    expect(Math.abs(f.rise)).toBeLessThan(0.03);
    expect(Math.abs(f.lean)).toBeLessThan(0.05);
    expect(Math.abs(f.headDrop)).toBeLessThan(0.03);
    expect(f.shoulderSpan).toBeCloseTo(1, 1);
    expect(f.hip.x).toBeCloseTo(0, 1);
    expect(f.hip.y).toBeCloseTo(0, 1);
    expect(f.shoulder.y).toBeCloseTo(1, 1);
    expect(f.head.y).toBeCloseTo(1.45, 1);
    expect(f.ankle[0].y).toBeCloseTo(-1.8, 1);
    // the player's own left is on the left of the mirror view: negative x
    expect(f.shoulders[0].x).toBeCloseTo(-0.4, 1);
    expect(f.shoulders[1].x).toBeCloseTo(0.4, 1);
    expect(f.hand[0].x).toBeLessThan(0);
    expect(f.hand[1].x).toBeGreaterThan(0);
  });

  it('a jump shows as rise in T with an upward hip velocity', () => {
    const fs = featuresOf(jumpAt(3000, 0.45, 450));
    const air = near(fs, 3000, 3500);
    const peak = Math.max(...air.map((f) => f.rise));
    expect(peak).toBeGreaterThan(0.35);
    expect(peak).toBeLessThan(0.5);
    const takeoff = near(fs, 3030, 3150);
    expect(Math.max(...takeoff.map((f) => f.vel.hip![0].y))).toBeGreaterThan(1);
  });

  it('a squat shows as drop and head drop; crouch level reaches 1 at 0.6 T', () => {
    const fs = featuresOf(squatAt(3000, 0.6, 500, 400, 500));
    const bottom = near(fs, 3500, 3900);
    expect(Math.max(...bottom.map((f) => f.drop))).toBeCloseTo(0.6, 1);
    expect(Math.max(...bottom.map((f) => crouchLevel(f.drop, f.headDrop)))).toBe(1);
    expect(Math.min(...bottom.map((f) => f.drop + f.rise))).toBe(0);
  });

  it('a lean to the player\'s right is a positive lean of the size given in W', () => {
    const right = featuresOf(leanAt(3000, 0.5, 300, 900, 300));
    expect(Math.max(...near(right, 3400, 4100).map((f) => f.lean))).toBeCloseTo(0.5, 1);
    const left = featuresOf(leanAt(3000, -0.5, 300, 900, 300));
    expect(Math.min(...near(left, 3400, 4100).map((f) => f.lean))).toBeCloseTo(-0.5, 1);
  });

  it('missing frames keep the last positions with ok = false', () => {
    const t = synthTrace({ id: 'gap', durationMs: 5000, fps: 30, seed: 1, motion: combine((tm) => (tm > 3000 && tm < 3500 ? { absent: true } : {})) });
    const { profile, rest } = calibrated(traceFrames(t));
    const fx = createFeatureExtractor();
    const fs = rest.map((f) => fx.push(f, profile));
    const gap = near(fs, 3050, 3450);
    expect(gap.length).toBeGreaterThan(5);
    expect(gap.every((f) => !f.ok && f.seen.hips === false)).toBe(true);
    expect(gap[0]!.hip.y).toBeCloseTo(0, 1);
    expect(near(fs, 3600, 5000).every((f) => f.ok)).toBe(true);
  });

  it('drift: a camera nudge of 0.1 T while standing is absorbed within about 8 s', () => {
    const t = synthTrace({ id: 'nudge', durationMs: 30000, fps: 30, seed: 8, motion: (tm) => (tm > 3000 ? { rise: -0.05 } : {}) });
    const { profile, rest } = calibrated(traceFrames(t));
    const fx = createFeatureExtractor();
    const fs = rest.map((f) => fx.push(f, profile));
    expect(near(fs, 3500, 3600)[0]!.rise).toBeCloseTo(-0.05, 1);
    expect(Math.abs(near(fs, 29000, 30000).at(-1)!.rise)).toBeLessThan(0.01);
    const off = createFeatureExtractor({ driftSeconds: 0 });
    const still = rest.map((f) => off.push(f, profile));
    expect(still.at(-1)!.rise).toBeCloseTo(-0.05, 1);
  });
});
