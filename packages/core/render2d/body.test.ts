// Skeleton and silhouette: bones follow the visible landmarks, left stays on the left of the mirror, nothing is drawn
// for what is not seen, and a smoother calms jitter without lagging real moves.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE, synthPose } from '../pose/synth.ts';
import { LM, POSE_CONNECTIONS, type Landmark } from '../types/index.ts';
import { BODY_STYLES, bodyScale, createPoints, drawSilhouette, drawSkeleton, JOINTS, LandmarkSmoother, LANDMARKS, skeletonSegments, skeletonSize, toCanvasPoints } from './body.ts';
import { recorder } from './testing/recorder.ts';
import type { Rect } from './view.ts';

const rect: Rect = { x: 20, y: 100, w: 640 * 0.6, h: 360 * 0.6 };
const aspect = rect.w / rect.h;
const pose = (p = {}): Landmark[] => synthPose({ ...DEFAULT_SHAPE, aspect }, p);
const pts = (lm: Landmark[] | null = pose()): Float32Array => { const out = createPoints(); toCanvasPoints(lm, rect, out); return out; };
const at = (p: Float32Array, i: number): [number, number, number] => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];

describe('toCanvasPoints', () => {
  it('mirrors: the left shoulder of the player is on the left of the screen', () => {
    const p = pts();
    expect(at(p, LM.leftShoulder)[0]).toBeLessThan(at(p, LM.rightShoulder)[0]);
    expect(at(p, LM.leftHip)[0]).toBeLessThan(at(p, LM.rightHip)[0]);
  });

  it('puts every landmark inside the mirror rectangle for a body inside the frame', () => {
    const p = pts();
    for (let i = 0; i < LANDMARKS; i++) {
      const [x, y] = at(p, i);
      expect(x).toBeGreaterThanOrEqual(rect.x); expect(x).toBeLessThanOrEqual(rect.x + rect.w);
      expect(y).toBeGreaterThanOrEqual(rect.y); expect(y).toBeLessThanOrEqual(rect.y + rect.h);
    }
  });

  it('copies visibility and reports no body for null or short input', () => {
    const out = createPoints();
    expect(toCanvasPoints(pose(), rect, out)).toBe(true);
    expect(out[LM.nose * 3 + 2]).toBeGreaterThan(0.9);
    expect(toCanvasPoints(null, rect, out)).toBe(false);
    for (let i = 0; i < LANDMARKS; i++) expect(out[i * 3 + 2]).toBe(0);
    expect(toCanvasPoints(pose().slice(0, 20), rect, out)).toBe(false);
  });
});

describe('skeleton', () => {
  it('draws every bone of a fully seen body: one stroke for the outline, one for the bones, one for the head ring, one fill for the joints', () => {
    const c = recorder();
    const n = drawSkeleton(c, pts(), BODY_STYLES[1], 100);
    expect(n).toBe(POSE_CONNECTIONS.length);
    expect(c.count('moveTo')).toBe(POSE_CONNECTIONS.length * 2 + JOINTS.length);
    expect(c.log.filter((l) => l.name === 'stroke').map((l) => l.strokeStyle)).toEqual([BODY_STYLES[1].outline, BODY_STYLES[1].bone, BODY_STYLES[1].bone]);
    expect(c.log.filter((l) => l.name === 'fill').map((l) => l.fillStyle)).toEqual([BODY_STYLES[1].joint]);
    expect(c.count('arc')).toBe(JOINTS.length + 1);
  });

  it('leaves out bones with an unseen end and joints that are not seen', () => {
    const lm = pose();
    for (const i of [LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex]) lm[i] = { ...lm[i]!, visibility: 0.1 };
    const p = pts(lm);
    expect(skeletonSegments(p)).toBeLessThan(POSE_CONNECTIONS.length);
    const c = recorder();
    drawSkeleton(c, p, BODY_STYLES[1], 100);
    expect(c.count('arc')).toBe(JOINTS.length - 2 + 1);   // no left knee and no left ankle
  });

  it('draws nothing but a head when only the head is seen, and nothing at all for no body', () => {
    const lm = pose().map((l, i) => (i === LM.nose ? l : { ...l, visibility: 0 }));
    const c = recorder();
    expect(drawSkeleton(c, pts(lm), BODY_STYLES[1], 100)).toBe(0);
    expect(c.count('arc')).toBe(1);
    const none = recorder();
    drawSkeleton(none, pts(null), BODY_STYLES[1], 100);
    expect(none.count('arc')).toBe(0);
    expect(none.count('stroke')).toBe(0);
  });

  it('segments connect the right landmarks (the first bone runs between the shoulders)', () => {
    const p = pts();
    const out = new Float32Array(POSE_CONNECTIONS.length * 4);
    const n = skeletonSegments(p, out);
    const first = POSE_CONNECTIONS[0]!;
    expect([out[0], out[1], out[2], out[3]]).toEqual([p[first[0] * 3], p[first[0] * 3 + 1], p[first[1] * 3], p[first[1] * 3 + 1]]);
    expect(n).toBe(POSE_CONNECTIONS.length);
  });

  it('line widths follow the size of the body and stay within sane limits', () => {
    expect(skeletonSize(10).bone).toBe(2);
    expect(skeletonSize(300).bone).toBe(8);
    expect(skeletonSize(100).bone).toBeCloseTo(7, 9);
    expect(skeletonSize(100).head).toBeCloseTo(34, 9);
  });

  it('player two has its own colours', () => {
    expect(BODY_STYLES[1].joint).not.toBe(BODY_STYLES[2].joint);
    expect(BODY_STYLES[1].bone).not.toBe(BODY_STYLES[2].bone);
  });
});

describe('body scale', () => {
  it('is the shoulder width in pixels, the hips stand in without shoulders, a fallback without both', () => {
    const p = pts();
    const w = Math.hypot(p[LM.leftShoulder * 3]! - p[LM.rightShoulder * 3]!, p[LM.leftShoulder * 3 + 1]! - p[LM.rightShoulder * 3 + 1]!);
    expect(bodyScale(p, 50)).toBeCloseTo(w, 6);
    const noShoulders = pts(pose().map((l, i) => (i === LM.leftShoulder || i === LM.rightShoulder ? { ...l, visibility: 0 } : l)));
    const hipW = Math.hypot(noShoulders[LM.leftHip * 3]! - noShoulders[LM.rightHip * 3]!, noShoulders[LM.leftHip * 3 + 1]! - noShoulders[LM.rightHip * 3 + 1]!);
    expect(bodyScale(noShoulders, 50)).toBeCloseTo(hipW * 1.25, 6);
    expect(bodyScale(pts(null), 50)).toBe(50);
    expect(bodyScale(pts(null), 1)).toBe(8);
    expect(bodyScale(pts(null), 1000)).toBe(400);
  });
});

describe('silhouette', () => {
  it('draws the torso, four limbs per side, hands, feet, neck and head of a full body in its own colour', () => {
    const c = recorder();
    const parts = drawSilhouette(c, pts(), BODY_STYLES[1], 100);
    expect(parts).toBe(1 + 4 + 4 + 2 + 2 + 1);   // torso, four arm parts, four leg parts, two feet, two hands, head
    expect(c.log.every((l) => (l.name === 'stroke' ? l.strokeStyle === BODY_STYLES[1].silhouette : l.fillStyle === BODY_STYLES[1].silhouette))).toBe(true);
  });

  it('draws fewer parts for a half body and none for no body', () => {
    const full = drawSilhouette(recorder(), pts(), BODY_STYLES[1], 100);
    const lm = pose().map((l, i) => (i >= LM.leftHip ? { ...l, visibility: 0 } : l));
    const upper = drawSilhouette(recorder(), pts(lm), BODY_STYLES[1], 100);
    expect(upper).toBeLessThan(full);
    expect(upper).toBeGreaterThan(0);
    const c = recorder();
    expect(drawSilhouette(c, pts(null), BODY_STYLES[1], 100)).toBe(0);
    expect(c.count('stroke') + c.count('fill')).toBe(0);
  });

  it('the head is a filled circle at the nose, sized by the body', () => {
    const c = recorder();
    const p = pts();
    drawSilhouette(c, p, BODY_STYLES[1], 100);
    const arc = c.calls.find((x) => x.name === 'arc')!;
    expect(arc.args[0]).toBeCloseTo(p[LM.nose * 3]!, 6);
    expect(arc.args[1]).toBeCloseTo(p[LM.nose * 3 + 1]!, 6);
    expect(arc.args[2]).toBeCloseTo(44, 6);
  });

  it('raised arms reach above the head on screen', () => {
    const up = pts(pose({ armsUp: 1 }));
    expect(up[LM.leftWrist * 3 + 1]!).toBeLessThan(up[LM.nose * 3 + 1]!);
  });
});

describe('smoother', () => {
  const jitter = (n: number): Landmark[] => pose({ shiftX: n % 2 ? 0.004 : -0.004 });

  it('takes the first frame as it is', () => {
    const s = new LandmarkSmoother();
    const out = createPoints();
    toCanvasPoints(pose(), rect, out, { smoother: s, dtMs: 33 });
    const raw = pts();
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(raw[i]!, 2);
  });

  it('calms a jittering body: the smoothed track moves less than the raw one', () => {
    const s = new LandmarkSmoother(60);
    const a = createPoints(), b = createPoints();
    let rawTravel = 0, smoothTravel = 0, lastRaw = 0, lastSmooth = 0;
    for (let n = 0; n < 120; n++) {
      toCanvasPoints(jitter(n), rect, a);
      toCanvasPoints(jitter(n), rect, b, { smoother: s, dtMs: 33 });
      if (n > 10) { rawTravel += Math.abs(a[LM.nose * 3]! - lastRaw); smoothTravel += Math.abs(b[LM.nose * 3]! - lastSmooth); }
      lastRaw = a[LM.nose * 3]!; lastSmooth = b[LM.nose * 3]!;
    }
    expect(smoothTravel).toBeLessThan(rawTravel * 0.6);
  });

  it('follows a real move within a few frames and snaps on a jump (another person)', () => {
    const s = new LandmarkSmoother(45);
    const out = createPoints();
    toCanvasPoints(pose(), rect, out, { smoother: s, dtMs: 33 });
    const target = pose({ shiftX: 0.1 });
    for (let i = 0; i < 12; i++) toCanvasPoints(target, rect, out, { smoother: s, dtMs: 33 });
    const raw = pts(target);
    expect(Math.abs(out[LM.nose * 3]! - raw[LM.nose * 3]!)).toBeLessThan(2);
    const far = pose({ shiftX: 0.7 });
    toCanvasPoints(far, rect, out, { smoother: s, dtMs: 33 });
    expect(out[LM.nose * 3]).toBeCloseTo(pts(far)[LM.nose * 3]!, 4);
  });

  it('reset forgets the last body', () => {
    const s = new LandmarkSmoother(1000);
    const out = createPoints();
    toCanvasPoints(pose(), rect, out, { smoother: s, dtMs: 33 });
    s.reset();
    toCanvasPoints(pose({ shiftX: 0.05 }), rect, out, { smoother: s, dtMs: 33 });
    expect(out[LM.nose * 3]).toBeCloseTo(pts(pose({ shiftX: 0.05 }))[LM.nose * 3]!, 4);
  });
});
