// The 2D scene kit: the canvas, its pixel ratio, the layout of the screen, the mirror view of the camera, the player's
// body (skeleton and silhouette), the small self view, sprites and particles. It implements the contract's Scene2D
// (mirror.show and mirror.project, ctx, resize, dispose) and adds the draw calls the 2D games use, in the order a game
// calls them: begin(), then drawVideo() or the game's own scene, drawBody(), the game's targets, particles, drawPip().
//
// Everything is measured in CSS pixels: after resize() the context carries the scale for the pixel ratio, so a game
// draws in the same units as `project()` returns and as the HUD's rectangles.
import type { BodyProfile, Landmark, PlayerSlot, Rng, Scene2D, Vec2 } from '../types/index.ts';
import { hudMetrics, type DuoAway, type HudMode, type Insets, type MeasuredDuo, type MeasuredHud, type PipPlacement } from '../ui/layout.ts';
import { bodyScale, BODY_STYLES, createPoints, drawSilhouette, drawSkeleton, LandmarkSmoother, toCanvasPoints } from './body.ts';
import { domSurface, type Ctx2D, type SurfaceFactory } from './ctx.ts';
import { layoutDuo, layoutScene, type SceneRects } from './layout2d.ts';
import { createParticles, type Particles } from './particles.ts';
import { drawPip } from './pip.ts';
import { SpriteBank } from './sprites.ts';
import { fitContain, makeProjector, type Projector, type Rect } from './view.ts';

/** The night stage (design/tokens palette.night.900) behind everything. */
export const STAGE_COLOR = '#1A1430';
/** About a 1080p screen: more backing pixels than this make a 2D scene slower for no visible gain. */
export const MAX_BACKING_PIXELS = 2_400_000;

export interface CanvasLike {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  getContext(kind: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

export interface Scene2DOptions {
  canvas: CanvasLike;
  /** Size in CSS pixels. Default: the canvas element's own size. */
  size?: () => { width: number; height: number };
  devicePixelRatio?: () => number;
  /** Upper bound for the pixel ratio. Default 2. */
  maxPixelRatio?: number;
  maxBackingPixels?: number;
  /** Offscreen surfaces for sprites. Default: canvas elements. */
  surfaces?: SurfaceFactory;
  /** The game's 'fx' stream: particles never touch the course's randomness. */
  rng: Rng;
  reducedMotion?: boolean;
  /** Safe-area insets in CSS pixels (env(safe-area-inset-*)); typical values when omitted. */
  insets?: Insets;
  /** Give the canvas memory back on dispose (default true). The shell turns it off when it reuses the canvas at once. */
  releaseCanvas?: boolean;
}

export type SelfViewCorner = PipPlacement;

export interface HudSetup {
  mode: HudMode;
  pipCorner: PipPlacement;
  /** The HUD's measured plates. Missing: typical sizes derived from the screen. */
  measured?: MeasuredHud;
}

export interface BodyFrame {
  /** 33 raw landmarks of this player, or null while they are not found. */
  landmarks: readonly Landmark[] | null;
  /** Which player (colours and smoothing); default 1. */
  player?: PlayerSlot;
}

export interface VideoOptions {
  /** Pixel size of the source (video.videoWidth and videoHeight), to keep its aspect. */
  size?: { w: number; h: number } | null;
  /** 0 to 1: darken the picture so targets and the HUD are the brightest things. Default 0.25. */
  dim?: number;
}

export interface Scene2DStats {
  /** Pixel ratio in use and the backing store size. */
  ratio: number;
  backing: { w: number; h: number };
  css: { w: number; h: number };
  surfaces: number;
  particlesAlive: number;
  particleCapacity: number;
  layouts: number;
  resizes: number;
}

export interface Scene2DKit extends Scene2D {
  readonly rects: SceneRects;
  readonly particles: Particles;
  readonly sprites: SpriteBank;
  readonly ratio: number;
  readonly disposed: boolean;
  /** Places the HUD plates, the self view and the play area. Call when the HUD's plates change size, and once at the start. */
  setHud(h: HudSetup): void;
  /** Two players on one camera: lanes, the shared self view. */
  setHudDuo(m: MeasuredDuo, o?: { away?: DuoAway }): void;
  /** Width / height of the camera frame (from the pose frames). */
  setCamera(aspect: number): void;
  /** The calibrated profile; before it, `project` works from a stand-in and `calibrated` is false. */
  setProfile(p: BodyProfile | null): void;
  readonly calibrated: boolean;
  setReducedMotion(r: boolean): void;
  /** Starts a frame: the stage colour over everything. */
  begin(): void;
  /** The camera picture, mirrored, whole, in the mirror rectangle. */
  drawVideo(source: CanvasImageSource | null, o?: VideoOptions): void;
  /** Silhouette and skeleton of one player (whichever mirror.show asked for). `dtMs` feeds the smoother. */
  drawBody(f: BodyFrame, dtMs: number): void;
  /** The small self view in its corner (not in mirror mode, not when hidden). */
  drawPip(source: CanvasImageSource | null, o?: VideoOptions & { frame?: BodyFrame | null }): void;
  /** Body space to canvas pixels without allocating. */
  projectInto(v: Vec2, out: Vec2): Vec2;
  /** Canvas pixels back to body space (touch and mouse). */
  unproject(c: Vec2): Vec2;
  stats(): Scene2DStats;
}

export function createScene2D(options: Scene2DOptions): Scene2DKit {
  const canvas = options.canvas;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('A 2D canvas could not be started on this device');
  const c2: Ctx2D = ctx;
  const sizeOf = options.size ?? ((): { width: number; height: number } => ({ width: canvas.clientWidth || 800, height: canvas.clientHeight || 600 }));
  const dpr = options.devicePixelRatio ?? ((): number => { try { return devicePixelRatio || 1; } catch { return 1; } });
  const maxRatio = options.maxPixelRatio ?? 2;
  const maxPixels = options.maxBackingPixels ?? MAX_BACKING_PIXELS;
  const factory = options.surfaces ?? domSurface;

  let ratio = 1;
  let css = { w: 0, h: 0 };
  let camAspect = 4 / 3;
  let profile: BodyProfile | null = null;
  let hud: HudSetup = { mode: 'scene', pipCorner: 'bottom-right' };
  let duo: { m: MeasuredDuo; away?: DuoAway } | null = null;
  let rects: SceneRects = layoutScene({ w: 800, h: 600, camAspect, mode: 'scene', pipCorner: 'bottom-right', measured: defaultMeasured(800, 600) });
  let projector: Projector = makeProjector(null, rects.mirror, camAspect);
  let show = { silhouette: false, skeleton: false };
  let disposed = false;
  let layouts = 0, resizes = 0;

  const particles = createParticles(options.rng, { amount: options.reducedMotion ? 0.25 : 1 });
  const sprites = new SpriteBank(factory, () => ratio);
  const pts: Record<PlayerSlot, Float32Array> = { 1: createPoints(), 2: createPoints() };
  const smooth: Record<PlayerSlot, LandmarkSmoother> = { 1: new LandmarkSmoother(), 2: new LandmarkSmoother() };
  const pipPts = createPoints();
  const pipSmooth = new LandmarkSmoother();

  function defaultMeasured(w: number, h: number): MeasuredHud {
    const f = hudMetrics({ w, h, ...(options.insets ? { insets: options.insets } : {}) }).font;
    return {
      statusLeft: { w: Math.round(f.numeral * 4), h: Math.round(f.numeral * 1.6) },
      statusRight: { w: Math.round(f.numeral * 3.4), h: Math.round(f.numeral * 1.6) },
      command: { w: Math.round(f.command * 3.2), h: Math.round(f.command * 1.25) },
      reason: { w: Math.round(Math.min(w * 0.6, f.reason * 12)), h: Math.round(f.reason * 2.4) },
    };
  }

  function relayout(): void {
    layouts++;
    if (css.w <= 0 || css.h <= 0) return;
    const insets = options.insets;
    rects = duo
      ? layoutDuo({ w: css.w, h: css.h, ...(insets ? { insets } : {}), camAspect, measured: duo.m, ...(duo.away !== undefined ? { away: duo.away } : {}) })
      : layoutScene({ w: css.w, h: css.h, ...(insets ? { insets } : {}), camAspect, mode: hud.mode, pipCorner: hud.pipCorner, measured: hud.measured ?? defaultMeasured(css.w, css.h) });
    projector = makeProjector(profile, rects.mirror, camAspect);
  }

  function resize(): void {
    if (disposed) return;
    const s = sizeOf();
    const w = Math.max(1, Math.floor(s.width)), h = Math.max(1, Math.floor(s.height));
    const wanted = Math.min(dpr(), maxRatio, Math.sqrt(maxPixels / (w * h)));
    const next = Math.max(0.5, Math.floor(wanted * 100) / 100);   // rounded down: the cap on pixels stays a cap
    const bw = Math.round(w * next), bh = Math.round(h * next);
    // Setting width or height clears the canvas and reallocates it: only when something really changed.
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    if (ratio !== next) { ratio = next; sprites.clear(); }
    css = { w, h };
    c2.setTransform(ratio, 0, 0, ratio, 0, 0);
    resizes++;
    relayout();
  }

  const mirror: Scene2D['mirror'] = {
    show(o) { show = { silhouette: o.silhouette, skeleton: o.skeleton }; },
    project(v) { return projector.project(v); },
  };

  const kit: Scene2DKit = {
    mirror,
    ctx,
    particles,
    sprites,
    get rects() { return rects; },
    get ratio() { return ratio; },
    get disposed() { return disposed; },
    get calibrated() { return projector.calibrated; },
    resize,

    setHud(h) { hud = h; duo = null; relayout(); },
    setHudDuo(m, o = {}) { duo = { m, ...(o.away !== undefined ? { away: o.away } : {}) }; relayout(); },
    setCamera(aspect) {
      if (!(aspect > 0) || Math.abs(aspect - camAspect) < 1e-4) return;
      camAspect = aspect;
      relayout();
    },
    setProfile(p) { profile = p; projector = makeProjector(profile, rects.mirror, camAspect); },
    setReducedMotion(r) { particles.setAmount(r ? 0.25 : 1); },

    begin() {
      if (disposed) return;
      c2.setTransform(ratio, 0, 0, ratio, 0, 0);
      c2.globalAlpha = 1;
      c2.globalCompositeOperation = 'source-over';
      c2.fillStyle = STAGE_COLOR;
      c2.fillRect(0, 0, css.w, css.h);
    },

    drawVideo(source, o = {}) {
      if (disposed || !source) return;
      const m = rects.mirror;
      if (m.w <= 0 || m.h <= 0) return;
      const sw = o.size?.w ?? 0, sh = o.size?.h ?? 0;
      const into: Rect = sw > 0 && sh > 0 ? fitContain(sw / sh, m) : m;
      c2.save();
      c2.translate(into.x + into.w, into.y);
      c2.scale(-1, 1);
      c2.drawImage(source, 0, 0, into.w, into.h);
      c2.restore();
      const dim = o.dim ?? 0.25;
      if (dim > 0) {
        c2.save();
        c2.globalAlpha = Math.min(1, dim);
        c2.fillStyle = STAGE_COLOR;
        c2.fillRect(into.x, into.y, into.w, into.h);
        c2.restore();
      }
    },

    drawBody(f, dtMs) {
      if (disposed || (!show.silhouette && !show.skeleton)) return;
      const slot = f.player ?? 1;
      const p = pts[slot];
      if (!toCanvasPoints(f.landmarks as Landmark[] | null, rects.mirror, p, { smoother: smooth[slot], dtMs })) return;
      const w = bodyScale(p, rects.mirror.h * 0.28);
      c2.save();
      if (show.silhouette) drawSilhouette(c2, p, BODY_STYLES[slot], w);
      if (show.skeleton) drawSkeleton(c2, p, BODY_STYLES[slot], w);
      c2.restore();
    },

    drawPip(source, o = {}) {
      if (disposed || !rects.pip) return;
      let skeleton: { pts: Float32Array; style: typeof BODY_STYLES[1] } | null = null;
      if (o.frame && o.frame.landmarks && toCanvasPoints(o.frame.landmarks as Landmark[], rects.pip, pipPts, { smoother: pipSmooth, dtMs: 33 })) {
        skeleton = { pts: pipPts, style: BODY_STYLES[o.frame.player ?? 1] };
      }
      drawPip(c2, rects.pip, {
        source,
        ...(o.size !== undefined ? { sourceSize: o.size } : {}),
        dim: o.dim ?? 0,
        skeleton,
      });
    },

    projectInto(v, out) { return projector.into(v, out); },
    unproject(c) { return projector.unproject(c); },

    stats() {
      const sp = sprites.stats();
      return { ratio, backing: { w: canvas.width, h: canvas.height }, css: { ...css }, surfaces: sp.surfaces, particlesAlive: particles.alive, particleCapacity: particles.stats().capacity, layouts, resizes };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      sprites.dispose();
      particles.clear();
      if (options.releaseCanvas !== false) { canvas.width = 0; canvas.height = 0; }
    },
  };

  resize();
  return kit;
}
