// The 2D scene kit with a fake canvas: pixel ratio and size limits, the mirrored video, body drawing in the order and
// colours asked for, the self view and project() on the ten screens, and a clean dispose (no leak over sessions).
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../loop/rng.ts';
import { DEFAULT_SHAPE, synthPose } from '../pose/synth.ts';
import type { BodyProfile } from '../types/index.ts';
import { BREAKPOINTS } from '../ui/layout.ts';
import { BODY_STYLES } from './body.ts';
import { createScene2D, MAX_BACKING_PIXELS, STAGE_COLOR, type CanvasLike, type Scene2DKit } from './scene2d.ts';
import { fakeSurfaces, recorder, type Recorder } from './testing/recorder.ts';

interface FakeCanvas extends CanvasLike { ctx: Recorder; sets: number }

function fakeCanvas(w: number, h: number): FakeCanvas {
  const ctx = recorder();
  let width = 0, height = 0, sets = 0;
  const c = {
    ctx,
    get sets() { return sets; },
    get width() { return width; }, set width(v: number) { width = v; sets++; },
    get height() { return height; }, set height(v: number) { height = v; sets++; },
    clientWidth: w, clientHeight: h,
    getContext: () => ctx as unknown as CanvasRenderingContext2D,
  };
  return c as unknown as FakeCanvas;
}

const profile = (aspect: number): BodyProfile => ({
  v: 2, framing: 'full', capturedAt: 0, aspect, T: 0.22, W: 0.25, hz: 30,
  rest: { hipX: aspect / 2, hipY: 0.58, shoulderX: aspect / 2, shoulderY: 0.36, noseY: 0.26 },
});

function make(w = 390, h = 844, o: { dpr?: number; reduced?: boolean } = {}): { s: Scene2DKit; c: FakeCanvas; surf: ReturnType<typeof fakeSurfaces>; size: { width: number; height: number } } {
  const c = fakeCanvas(w, h);
  const surf = fakeSurfaces();
  const size = { width: w, height: h };
  const s = createScene2D({ canvas: c, size: () => size, devicePixelRatio: () => o.dpr ?? 2, surfaces: surf.factory, rng: mulberry32(1), reducedMotion: o.reduced ?? false });
  return { s, c, surf, size };
}

describe('size and pixel ratio', () => {
  it('backs the canvas with CSS size times the ratio and scales the context so games draw in CSS pixels', () => {
    const { s, c } = make(390, 844, { dpr: 2 });
    expect([c.width, c.height]).toEqual([780, 1688]);
    expect(s.ratio).toBe(2);
    const t = c.ctx.calls.filter((x) => x.name === 'setTransform').pop()!;
    expect(t.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('caps the ratio at 2 and the backing store at about 1080p', () => {
    const phone = make(390, 844, { dpr: 3 });
    expect(phone.s.ratio).toBe(2);
    const tv = make(1920, 1080, { dpr: 2 });
    expect(tv.c.width * tv.c.height).toBeLessThanOrEqual(MAX_BACKING_PIXELS * 1.001);
    expect(tv.s.ratio).toBeLessThan(2);
    expect(tv.s.ratio).toBeGreaterThanOrEqual(1);
    const big = make(3840, 2160, { dpr: 1 });
    expect(big.c.width * big.c.height).toBeLessThanOrEqual(MAX_BACKING_PIXELS * 1.001);
  });

  it('touches the canvas size only when it really changes (a write clears the canvas)', () => {
    const { s, c, size } = make();
    const before = c.sets;
    s.resize(); s.resize();
    expect(c.sets).toBe(before);
    size.width = 844; size.height = 390;
    s.resize();
    expect(c.sets).toBeGreaterThan(before);
    expect([c.width, c.height]).toEqual([1688, 780]);
  });

  it('a new pixel ratio repaints the sprites (they are made at the screen\'s sharpness)', () => {
    const { s, surf } = make();
    s.sprites.get('star', 40);
    expect(surf.live()).toBe(1);
    (s as unknown as { ratio: number }).ratio;
    s.resize();
    expect(surf.live()).toBe(1);          // same ratio: kept
  });

  it('survives a zero-sized or odd canvas', () => {
    const { s } = make(0, 0);
    expect(s.ratio).toBeGreaterThan(0);
    expect(() => s.begin()).not.toThrow();
  });
});

describe('the stage and the mirrored picture', () => {
  it('begin() paints the stage colour over the whole canvas in CSS pixels', () => {
    const { s, c } = make();
    c.ctx.reset();
    s.begin();
    const r = c.ctx.calls.find((x) => x.name === 'fillRect')!;
    expect(r.args).toEqual([0, 0, 390, 844]);
    expect(c.ctx.log.find((l) => l.name === 'fillRect')!.fillStyle).toBe(STAGE_COLOR);
  });

  it('draws the video mirrored, whole, in the mirror rectangle, dimmed a little', () => {
    const { s, c } = make(844, 390);
    s.setHud({ mode: 'mirror', pipCorner: 'hidden' });
    s.setCamera(16 / 9);
    c.ctx.reset();
    const video = {} as CanvasImageSource;
    s.drawVideo(video, { size: { w: 1280, h: 720 } });
    const m = s.rects.mirror;
    expect(c.ctx.calls.find((x) => x.name === 'translate')!.args).toEqual([m.x + m.w, m.y]);
    expect(c.ctx.calls.find((x) => x.name === 'scale')!.args).toEqual([-1, 1]);
    const d = c.ctx.calls.find((x) => x.name === 'drawImage')!;
    expect(d.args[1]).toBe(0);
    expect(d.args[3]).toBeCloseTo(m.w, 6);
    expect(d.args[4]).toBeCloseTo(m.h, 6);
    expect(c.ctx.count('save')).toBe(c.ctx.count('restore'));
    expect(c.ctx.log.some((l) => l.name === 'fillRect' && l.fillStyle === STAGE_COLOR && l.globalAlpha === 0.25)).toBe(true);
  });

  it('keeps the aspect of a source that is not the camera shape the layout assumed', () => {
    const { s, c } = make(844, 390);
    s.setHud({ mode: 'mirror', pipCorner: 'hidden' });
    s.setCamera(4 / 3);
    c.ctx.reset();
    s.drawVideo({} as CanvasImageSource, { size: { w: 1920, h: 1080 }, dim: 0 });
    const d = c.ctx.calls.find((x) => x.name === 'drawImage')!;
    expect((d.args[3] as number) / (d.args[4] as number)).toBeCloseTo(16 / 9, 6);
    expect(c.ctx.count('fillRect')).toBe(0);
  });

  it('draws nothing without a source', () => {
    const { s, c } = make();
    c.ctx.reset();
    s.drawVideo(null);
    expect(c.ctx.calls.length).toBe(0);
  });
});

describe('body', () => {
  const lm = synthPose({ ...DEFAULT_SHAPE, aspect: 4 / 3 }, {});

  it('draws what mirror.show asks for, the silhouette under the skeleton, nothing by default', () => {
    const { s, c } = make();
    c.ctx.reset();
    s.drawBody({ landmarks: lm }, 33);
    expect(c.ctx.calls.length).toBe(0);
    s.mirror.show({ silhouette: true, skeleton: true });
    s.drawBody({ landmarks: lm }, 33);
    const strokes = c.ctx.log.filter((l) => l.name === 'stroke').map((l) => l.strokeStyle);
    const first = strokes.findIndex((x) => x === BODY_STYLES[1].silhouette);
    const bone = strokes.findIndex((x) => x === BODY_STYLES[1].bone);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(bone).toBeGreaterThan(first);
    expect(c.ctx.count('save')).toBe(c.ctx.count('restore'));
  });

  it('only the skeleton, or only the silhouette', () => {
    const { s, c } = make();
    s.mirror.show({ silhouette: false, skeleton: true });
    c.ctx.reset();
    s.drawBody({ landmarks: lm }, 33);
    expect(c.ctx.log.some((l) => l.strokeStyle === BODY_STYLES[1].silhouette)).toBe(false);
    s.mirror.show({ silhouette: true, skeleton: false });
    c.ctx.reset();
    s.drawBody({ landmarks: lm }, 33);
    expect(c.ctx.log.some((l) => l.strokeStyle === BODY_STYLES[1].bone)).toBe(false);
  });

  it('the second player has their own colours', () => {
    const { s, c } = make();
    s.mirror.show({ silhouette: false, skeleton: true });
    c.ctx.reset();
    s.drawBody({ landmarks: lm, player: 2 }, 33);
    expect(c.ctx.log.some((l) => l.strokeStyle === BODY_STYLES[2].bone)).toBe(true);
    expect(c.ctx.log.some((l) => l.strokeStyle === BODY_STYLES[1].bone)).toBe(false);
  });

  it('no body, nothing drawn', () => {
    const { s, c } = make();
    s.mirror.show({ silhouette: true, skeleton: true });
    c.ctx.reset();
    s.drawBody({ landmarks: null }, 33);
    expect(c.ctx.log.length).toBe(0);
  });
});

describe('self view', () => {
  it('draws into the corner the layout gave it, mirrored, with the skeleton on top when given a body', () => {
    const { s, c } = make();
    s.setHud({ mode: 'scene', pipCorner: 'bottom-left' });
    const win = s.rects.pip!;
    expect(win.x).toBeLessThan(195);
    c.ctx.reset();
    s.drawPip({} as CanvasImageSource, { size: { w: 640, h: 480 }, frame: { landmarks: synthPose({ ...DEFAULT_SHAPE, aspect: 4 / 3 }, {}) } });
    expect(c.ctx.count('drawImage')).toBe(1);
    expect(c.ctx.calls.find((x) => x.name === 'scale')!.args).toEqual([-1, 1]);
    expect(c.ctx.log.some((l) => l.strokeStyle === BODY_STYLES[1].bone)).toBe(true);
    expect(c.ctx.count('save')).toBe(c.ctx.count('restore'));
  });

  it('is not drawn when hidden, in mirror mode, or when there is no window', () => {
    const { s, c } = make();
    for (const h of [{ mode: 'scene', pipCorner: 'hidden' }, { mode: 'mirror', pipCorner: 'bottom-right' }] as const) {
      s.setHud(h);
      c.ctx.reset();
      s.drawPip({} as CanvasImageSource);
      expect(c.ctx.calls.length).toBe(0);
    }
  });

  it('an empty window (camera not ready) is drawn without a picture', () => {
    const { s, c } = make();
    s.setHud({ mode: 'scene', pipCorner: 'bottom-right' });
    c.ctx.reset();
    s.drawPip(null);
    expect(c.ctx.count('drawImage')).toBe(0);
    expect(c.ctx.count('fill')).toBeGreaterThan(0);
  });
});

describe.each(BREAKPOINTS.map((b) => [b.label, b] as const))('on %s', (_label, b) => {
  it('lays the screen out without a problem, for every mode and corner, and the mirror and window follow resizes', () => {
    const { s, size } = make(b.w, b.h);
    for (const mode of ['scene', 'mirror', 'live'] as const) for (const corner of ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'hidden'] as const) {
      s.setHud({ mode, pipCorner: corner });
      const r = s.rects;
      expect(r.w).toBe(b.w);
      expect(r.h).toBe(b.h);
      if (mode === 'scene' && corner !== 'hidden') expect(r.pip).not.toBeNull();
      expect(r.mirror.w).toBeGreaterThan(0);
    }
    size.width = b.h; size.height = b.w;           // the phone is turned
    s.resize();
    expect(s.rects.w).toBe(b.h);
    expect(s.rects.h).toBe(b.w);
  });

  it('project(): the rest hip lands where the player stood inside the mirror, and a point above the head lands higher', () => {
    const { s } = make(b.w, b.h);
    s.setHud({ mode: 'mirror', pipCorner: 'hidden' });
    s.setCamera(4 / 3);
    s.setProfile(profile(4 / 3));
    expect(s.calibrated).toBe(true);
    const hip = s.mirror.project({ x: 0, y: 0 });
    const up = s.mirror.project({ x: 0, y: 2 });
    const m = s.rects.mirror;
    expect(hip.x).toBeCloseTo(m.x + (4 / 3 / 2) * m.h, 6);
    expect(hip.y).toBeCloseTo(m.y + 0.58 * m.h, 6);
    expect(up.y).toBeLessThan(hip.y);
    expect(hip.x).toBeGreaterThanOrEqual(m.x);
    expect(hip.x).toBeLessThanOrEqual(m.x + m.w);
    const back = s.unproject(up);
    expect(back.x).toBeCloseTo(0, 6);
    expect(back.y).toBeCloseTo(2, 6);
  });
});

describe('project() and profiles', () => {
  it('works before calibration from a stand-in and says so; a profile makes it real; a new camera shape moves the mirror', () => {
    const { s } = make(844, 390);
    s.setHud({ mode: 'mirror', pipCorner: 'hidden' });
    expect(s.calibrated).toBe(false);
    const before = s.mirror.project({ x: 0, y: 0 });
    s.setProfile(profile(4 / 3));
    expect(s.calibrated).toBe(true);
    const after = s.mirror.project({ x: 0, y: 0 });
    expect(after.y).not.toBe(before.y);
    const wide = s.rects.mirror.w;
    s.setCamera(16 / 9);
    expect(s.rects.mirror.w).toBeGreaterThanOrEqual(wide - 1);
    expect(s.rects.mirror.w / s.rects.mirror.h).toBeCloseTo(16 / 9, 1);
  });

  it('projectInto reuses the object it is given', () => {
    const { s } = make();
    const out = { x: 0, y: 0 };
    expect(s.projectInto({ x: 1, y: 1 }, out)).toBe(out);
  });

  it('ignores a nonsense camera aspect', () => {
    const { s } = make();
    const m = s.rects.mirror;
    s.setCamera(0); s.setCamera(NaN); s.setCamera(-2);
    expect(s.rects.mirror).toEqual(m);
  });
});

describe('two players', () => {
  it('lays out lanes and one shared self view', () => {
    const { s } = make(1280, 800);
    s.setHudDuo({ statusP1: { w: 120, h: 50 }, statusP2: { w: 120, h: 50 }, timer: { w: 90, h: 50 }, command: { w: 200, h: 70 } });
    expect(s.rects.lanes).toBeDefined();
    expect(s.rects.pip).not.toBeNull();
    s.setHud({ mode: 'scene', pipCorner: 'bottom-right' });
    expect(s.rects.lanes).toBeUndefined();
  });
});

describe('particles and reduced motion', () => {
  it('reduced motion makes a quarter of the particles, and can be turned off again', () => {
    const a = make(390, 844, { reduced: true });
    expect(a.s.particles.burst(0, 0, 40)).toBe(10);
    a.s.setReducedMotion(false);
    expect(a.s.particles.burst(0, 0, 40)).toBe(40);
  });
});

describe('dispose', () => {
  it('gives sprites, particles and the canvas memory back, and is safe twice', () => {
    const { s, c, surf } = make();
    s.sprites.get('star', 30); s.sprites.get('ring', 30);
    s.particles.burst(0, 0, 50);
    s.dispose(); s.dispose();
    expect(s.disposed).toBe(true);
    expect(surf.live()).toBe(0);
    expect(s.particles.alive).toBe(0);
    expect([c.width, c.height]).toEqual([0, 0]);
    c.ctx.reset();
    s.begin(); s.drawVideo({} as CanvasImageSource); s.drawBody({ landmarks: null }, 1); s.drawPip(null); s.resize();
    expect(c.ctx.calls.length).toBe(0);
  });

  it('can leave the canvas as it is when the shell reuses it', () => {
    const c = fakeCanvas(390, 844);
    const s = createScene2D({ canvas: c, size: () => ({ width: 390, height: 844 }), rng: mulberry32(1), releaseCanvas: false, surfaces: fakeSurfaces().factory });
    s.dispose();
    expect(c.width).toBeGreaterThan(0);
  });

  it('five sessions in a row leave nothing behind: same live surfaces and canvas size after each', () => {
    const surf = fakeSurfaces();
    const live: number[] = [];
    for (let i = 0; i < 5; i++) {
      const c = fakeCanvas(390, 844);
      const s = createScene2D({ canvas: c, size: () => ({ width: 390, height: 844 }), devicePixelRatio: () => 2, rng: mulberry32(i), surfaces: surf.factory });
      s.setHud({ mode: 'scene', pipCorner: 'bottom-right' });
      for (let f = 0; f < 120; f++) { s.begin(); s.particles.burst(100, 100, 4); s.particles.update(1 / 60); s.particles.draw(c.ctx); s.sprites.stamp(c.ctx, 'star', 50 + f, 90, 40); }
      live.push(surf.live());
      s.dispose();
      live.push(surf.live());
    }
    expect(live.filter((_, i) => i % 2 === 1)).toEqual([0, 0, 0, 0, 0]);
    expect(new Set(live.filter((_, i) => i % 2 === 0)).size).toBe(1);
  });

  it('refuses a context that is not there', () => {
    const c = { ...fakeCanvas(10, 10), getContext: () => null } as unknown as CanvasLike;
    expect(() => createScene2D({ canvas: c, rng: mulberry32(1) })).toThrow(/2D canvas/);
  });
});
