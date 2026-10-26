// Side framing (Framing 'side': push-ups, planks, balance seen from the side). From the side the far half of the body
// hides behind the near half and its visibility drops below 0.5: the calibration, the features (ok, seen, pairs,
// near), the presence gate of PoseFeed and a side detector (M15 sideLine) must still work on the near side alone.
import { describe, expect, it } from 'vitest';
import { LM, type BodyProfile, type Landmark, type PoseFrame } from '../types/index.ts';
import { createInputHub } from '../input/hub.ts';
import { createPoseFeed, type PresenceChange } from '../input/pose-feed.ts';
import { createMovementEngine } from '../moves/engine.ts';
import { ALL_DETECTORS } from '../moves/library.ts';
import { synthPose } from '../pose/synth.ts';
import { createCalibrator } from './calibrator.ts';
import { createFeatureExtractor } from './features.ts';
import { bodySeen, nearSide } from './geometry.ts';

const ASPECT = 16 / 9;
/** Landmarks on the player's left (odd indices from 11 on, and 1-3, 7, 9). */
const LEFT = new Set([1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]);
const RIGHT = new Set([4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]);

/**
 * A person standing side-on to the camera: the front pose collapsed to one vertical line (left and right almost on
 * top of each other), the `near` side clearly visible and the far side at `farVis`.
 */
function sideOn(near: 'L' | 'R', farVis = 0.2, o: { hideNear?: number[]; cx?: number } = {}): Landmark[] {
  const cx = o.cx ?? 0.5;
  const front = synthPose({ cx, hipY: 0.55, T: 0.18, W: 0.14, aspect: ASPECT });
  return front.map((p, i) => {
    const isFar = near === 'L' ? RIGHT.has(i) : LEFT.has(i);
    const forward = i === LM.nose || i === LM.leftFootIndex || i === LM.rightFootIndex ? 0.03 : 0;
    let visibility = isFar ? farVis : 0.95;
    if (o.hideNear?.includes(i)) visibility = 0.1;
    return { x: cx + forward + (isFar ? 0.006 : 0), y: p.y, z: 0, visibility };
  });
}

const frame = (t: number, lm: Landmark[] | null): PoseFrame => ({ seq: Math.round(t / 33), t, landmarks: lm, inferenceMs: 20, source: 'test', aspect: ASPECT });

function sideProfile(near: 'L' | 'R' = 'L'): BodyProfile {
  const c = createCalibrator({ now: () => 0 });
  c.begin('side');
  for (let t = 0; t < 4000; t += 33) {
    if (c.push(frame(t, sideOn(near))).ready) return c.profile() as BodyProfile;
  }
  throw new Error('side calibration did not finish');
}

describe('side framing', () => {
  it('geometry: one seen side is enough in side framing, never in front framing; the near side is the one seen best', () => {
    const lm = sideOn('L');
    expect(bodySeen(lm, 'side')).toBe(true);
    expect(bodySeen(lm, 'full')).toBe(false);
    expect(bodySeen(lm, 'upper')).toBe(false);
    expect(nearSide(lm)).toBe('L');
    expect(nearSide(sideOn('R'))).toBe('R');
    expect(bodySeen(sideOn('L', 0.2, { hideNear: [LM.leftHip] }), 'side')).toBe(false);
    expect(bodySeen(null, 'side')).toBe(false);
  });

  it('calibrates side-on with the far side hidden; torso length from the near side', () => {
    const p = sideProfile();
    expect(p.framing).toBe('side');
    expect(p.T).toBeGreaterThan(0.12);
    expect(p.T).toBeLessThan(0.24);
  });

  it("features: ok on the near side alone; hidden far entries follow the near side; seen counts either side; near; lean 0", () => {
    const x = createFeatureExtractor();
    const p = sideProfile();
    let f = x.push(frame(0, sideOn('L')), p);
    for (let t = 33; t < 600; t += 33) f = x.push(frame(t, sideOn('L')), p);
    expect(f.ok).toBe(true);
    expect(f.near).toBe('L');
    expect(f.shoulders[1]).toEqual(f.shoulders[0]);
    expect(f.hips[1]).toEqual(f.hips[0]);
    expect(f.ankle[1]).toEqual(f.ankle[0]);
    expect(f.seen).toMatchObject({ shoulders: true, hips: true, knees: true, ankles: true, head: true });
    expect(f.lean).toBe(0);
    expect(f.shoulderSpan).toBe(1);
    expect(Math.abs(f.hip.x)).toBeLessThan(0.05);
    expect(Math.abs(f.rise)).toBeLessThan(0.05);
  });

  it('the same side-on frames with a front profile are not ok (what side framing fixes)', () => {
    const c = createCalibrator({ now: () => 0 });
    c.begin('full');
    const front = synthPose({ cx: 0.5, hipY: 0.55, T: 0.18, W: 0.14, aspect: ASPECT });
    let p: BodyProfile | null = null;
    for (let t = 0; t < 4000 && !p; t += 33) if (c.push(frame(t, front)).ready) p = c.profile();
    const f = createFeatureExtractor().push(frame(5000, sideOn('L')), p as BodyProfile);
    expect(f.ok).toBe(false);
  });

  it('with both sides seen nothing is replaced; a player who turns around changes the near side', () => {
    const x = createFeatureExtractor();
    const p = sideProfile();
    const both = x.push(frame(0, sideOn('L', 0.9)), p);
    expect(both.ok).toBe(true);
    expect(both.shoulders[1].x).not.toBe(both.shoulders[0].x);
    expect(x.push(frame(33, sideOn('R')), p).near).toBe('R');
  });

  it('no shoulder and hip on either side: not ok', () => {
    const p = sideProfile();
    const f = createFeatureExtractor().push(frame(0, sideOn('L', 0.2, { hideNear: [LM.leftShoulder] })), p);
    expect(f.ok).toBe(false);
  });

  it('PoseFeed: a side-on player with a side profile stays present; with a front profile the gate would lose them', () => {
    const run = (profile: BodyProfile): PresenceChange[] => {
      const hub = createInputHub();
      const feed = createPoseFeed({ hub });
      feed.setProfiles({ 1: profile });
      const out: PresenceChange[] = [];
      feed.onPresence((e) => out.push(e));
      for (let t = 0; t < 2000; t += 33) feed.push(frame(t, sideOn('L')));
      return out;
    };
    expect(run(sideProfile())).toEqual([]);
    expect(run({ ...sideProfile(), framing: 'full' }).map((e) => e.present)).toEqual([false]);
  });

  it('the side line detector (M15) gets every side-on frame: a standing body reads as a straight line', () => {
    const m = createMovementEngine({ registry: ALL_DETECTORS });
    m.use([{ id: 'sideLine' }]);
    m.setProfile(sideProfile());
    let ok = 0;
    for (let t = 0; t < 1500; t += 33) if (m.push(frame(t, sideOn('L'))).ok) ok++;
    expect(ok).toBe(Math.ceil(1500 / 33));
    const line = m.channel('line');
    expect(line).toBeGreaterThan(170);
    expect(line).toBeLessThan(190);
  });
});
