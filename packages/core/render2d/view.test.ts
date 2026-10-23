// The geometry of the mirror view: contain-fit, the three spaces, and the way back for touch input.
import { describe, expect, it } from 'vitest';
import { toView } from '../body/geometry.ts';
import type { BodyProfile, Landmark } from '../types/index.ts';
import { bodyToView, canvasToView, defaultProfile, fitContain, landmarkToCanvas, makeProjector, torsoPixels, viewToBody, viewToCanvas, type Rect } from './view.ts';

const profile = (aspect = 16 / 9): BodyProfile => ({
  v: 2, framing: 'full', capturedAt: 0, aspect, T: 0.22, W: 0.25, hz: 30,
  rest: { hipX: aspect * 0.5, hipY: 0.58, shoulderX: aspect * 0.5, shoulderY: 0.36, noseY: 0.26 },
});

describe('fitContain', () => {
  it('fits a wide frame into a tall area with bands above and below, centred', () => {
    const r = fitContain(16 / 9, { x: 0, y: 100, w: 360, h: 600 });
    expect(r.w).toBeCloseTo(360, 9);
    expect(r.h).toBeCloseTo(202.5, 9);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(100 + (600 - 202.5) / 2, 9);
  });

  it('fits a tall frame into a wide area with bands left and right', () => {
    const r = fitContain(3 / 4, { x: 10, y: 20, w: 800, h: 400 });
    expect(r.h).toBeCloseTo(400, 9);
    expect(r.w).toBeCloseTo(300, 9);
    expect(r.x).toBeCloseTo(10 + 250, 9);
    expect(r.y).toBeCloseTo(20, 9);
  });

  it('keeps the aspect exactly, never grows past the area, and is empty for nonsense', () => {
    for (const aspect of [0.5, 0.75, 1, 4 / 3, 16 / 9, 2.4]) {
      for (const area of [{ x: 0, y: 0, w: 360, h: 780 }, { x: 5, y: 7, w: 1024, h: 300 }, { x: 0, y: 0, w: 90, h: 90 }]) {
        const r = fitContain(aspect, area);
        expect(r.w / r.h).toBeCloseTo(aspect, 9);
        expect(r.w).toBeLessThanOrEqual(area.w + 1e-9);
        expect(r.h).toBeLessThanOrEqual(area.h + 1e-9);
        expect(r.x).toBeGreaterThanOrEqual(area.x - 1e-9);
        expect(r.y).toBeGreaterThanOrEqual(area.y - 1e-9);
        expect(Math.abs(r.x - area.x - (area.x + area.w - r.x - r.w))).toBeLessThan(1e-9);   // centred
      }
    }
    expect(fitContain(0, { x: 0, y: 0, w: 10, h: 10 }).w).toBe(0);
    expect(fitContain(1.5, { x: 0, y: 0, w: 0, h: 10 }).w).toBe(0);
    expect(fitContain(NaN, { x: 0, y: 0, w: 10, h: 10 }).h).toBe(0);
  });
});

describe('body space and view space', () => {
  it('the rest hip is the origin and +y is up', () => {
    const p = profile();
    const o = bodyToView({ x: 0, y: 0 }, p, { x: 0, y: 0 });
    expect(o).toEqual({ x: p.rest.hipX, y: p.rest.hipY });
    const up = bodyToView({ x: 0, y: 1 }, p, { x: 0, y: 0 });
    expect(up.y).toBeCloseTo(p.rest.hipY - p.T, 12);
    const right = bodyToView({ x: 1, y: 0 }, p, { x: 0, y: 0 });
    expect(right.x).toBeCloseTo(p.rest.hipX + p.T, 12);
  });

  it('is its own inverse', () => {
    const p = profile();
    for (const b of [{ x: 0.3, y: 1.7 }, { x: -2, y: -0.4 }, { x: 0, y: 0 }]) {
      const back = viewToBody(bodyToView(b, p, { x: 0, y: 0 }), p, { x: 0, y: 0 });
      expect(back.x).toBeCloseTo(b.x, 12);
      expect(back.y).toBeCloseTo(b.y, 12);
    }
  });

  it('a raw landmark lands where view space says it does (the mirror flips left and right)', () => {
    const aspect = 4 / 3;
    const rect: Rect = { x: 30, y: 50, w: 400 * aspect, h: 400 };
    for (const l of [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.93, y: 0.77 }] as Landmark[]) {
      const viaView = viewToCanvas(toView({ ...l, z: 0, visibility: 1 }, aspect), rect, { x: 0, y: 0 });
      const direct = landmarkToCanvas(l, rect, { x: 0, y: 0 });
      expect(direct.x).toBeCloseTo(viaView.x, 9);
      expect(direct.y).toBeCloseTo(viaView.y, 9);
    }
    expect(landmarkToCanvas({ x: 0, y: 0 }, rect, { x: 0, y: 0 }).x).toBeCloseTo(rect.x + rect.w, 9);   // image left edge shows on the right of the mirror
  });

  it('canvas and view convert back and forth', () => {
    const rect: Rect = { x: 12, y: 40, w: 640, h: 360 };
    const c = viewToCanvas({ x: 0.9, y: 0.4 }, rect, { x: 0, y: 0 });
    const v = canvasToView(c, rect, { x: 0, y: 0 });
    expect(v.x).toBeCloseTo(0.9, 12);
    expect(v.y).toBeCloseTo(0.4, 12);
  });
});

describe('projector', () => {
  const aspect = 16 / 9;
  const rect: Rect = { x: 0, y: 200, w: 360, h: 360 / aspect };

  it('puts the rest hip where the player stood on screen and a point one torso up one torso length higher', () => {
    const p = profile(aspect);
    const pr = makeProjector(p, rect, aspect);
    expect(pr.calibrated).toBe(true);
    const hip = pr.project({ x: 0, y: 0 });
    expect(hip.x).toBeCloseTo(rect.x + p.rest.hipX * rect.h, 9);
    expect(hip.y).toBeCloseTo(rect.y + p.rest.hipY * rect.h, 9);
    const up = pr.project({ x: 0, y: 1 });
    expect(hip.y - up.y).toBeCloseTo(p.T * rect.h, 9);
    expect(up.x).toBeCloseTo(hip.x, 9);
  });

  it('a body at a given pixel size is the same game for a near and a far player', () => {
    // The same star one torso up from the hip is the same number of torso lengths away on screen, whatever T is.
    for (const T of [0.15, 0.22, 0.3]) {
      const p = { ...profile(aspect), T };
      const pr = makeProjector(p, rect, aspect);
      const a = pr.project({ x: 0, y: 0 }), b = pr.project({ x: 0, y: 1 });
      expect((a.y - b.y) / (T * rect.h)).toBeCloseTo(1, 9);
    }
  });

  it('into() writes the given object and project() a new one; unproject() is the way back', () => {
    const pr = makeProjector(profile(aspect), rect, aspect);
    const out = { x: 0, y: 0 };
    const r = pr.into({ x: 0.5, y: 1.2 }, out);
    expect(r).toBe(out);
    const a = pr.project({ x: 0.5, y: 1.2 });
    expect(a).not.toBe(out);
    expect(a).toEqual(out);
    const back = pr.unproject(a);
    expect(back.x).toBeCloseTo(0.5, 9);
    expect(back.y).toBeCloseTo(1.2, 9);
  });

  it('works before calibration with a stand-in profile and says so', () => {
    const pr = makeProjector(null, rect, aspect);
    expect(pr.calibrated).toBe(false);
    const hip = pr.project({ x: 0, y: 0 });
    expect(hip.x).toBeCloseTo(rect.x + rect.w / 2, 9);
    expect(defaultProfile(aspect).T).toBeGreaterThan(0.1);
    expect(torsoPixels(null, rect)).toBeCloseTo(0.26 * rect.h, 9);
    expect(torsoPixels({ T: 0.3 }, rect)).toBeCloseTo(0.3 * rect.h, 9);
  });

  it('a window of a different shape moves everything with the rectangle', () => {
    const p = profile(aspect);
    const r1: Rect = { x: 0, y: 0, w: 640, h: 360 }, r2: Rect = { x: 100, y: 50, w: 1280, h: 720 };
    const a = makeProjector(p, r1, aspect).project({ x: 1, y: 1 });
    const b = makeProjector(p, r2, aspect).project({ x: 1, y: 1 });
    expect((b.x - r2.x) / r2.h).toBeCloseTo((a.x - r1.x) / r1.h, 9);
    expect((b.y - r2.y) / r2.h).toBeCloseTo((a.y - r1.y) / r1.h, 9);
  });
});
