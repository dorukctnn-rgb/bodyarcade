// The replay of a miss on the results screen: the skeleton of the window (replay.ts) drawn on a canvas, the way the game draws the
// player (core/render2d/body.ts: the same bones and joints, the picture mirrored as the game shows it), played once when the
// screen opens and again when the player presses the button. A player who asked for less motion gets one still picture instead: the
// pose at the moment of the miss with the poses before it faint behind it. The canvas holds only what was drawn; the landmarks are the clip's.
import { BODY_STYLES, bodyScale, drawSkeleton, createPoints } from '../../../core/render2d/body.ts';
import type { Ctx2D } from '../../../core/render2d/ctx.ts';
import { LANDMARK_COUNT, LM } from '../../../core/types/index.ts';
import { MIN_VISIBILITY, type ReplayClip, type ReplayFrame } from './replay.ts';

/** The colour behind the skeleton (design/ui-kit/pages.css .k-replay .view). */
export const BACKDROP = '#1A1430';
/** Frames are drawn at most this often (milliseconds apart): about thirty a second is smooth for a second of movement and light on a slow phone. */
export const DRAW_EVERY_MS = 30;
/** The empty margin around the body inside the picture, as a share of its width and height. */
export const MARGIN = 0.12;

const STRIDE = 3;

/** Where the body was over the whole window, in picture units: the width as the camera's aspect, the height 1, mirrored. */
export interface Bounds { minU: number; maxU: number; minV: number; maxV: number }

/** The ring that is drawn round the head is this wide, in widths of the shoulders (core/render2d/body.ts skeletonSize: 0.34, and the line); the box makes room for it. */
const HEAD_RING = 0.36;

/** The box the body moved in over the window (the joints that were seen, and the ring round the head), so that the picture does not jump or zoom while it plays. */
export function boundsOf(clip: ReplayClip): Bounds {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const seen = (p: Float32Array, i: number): boolean => (p[i * STRIDE + 2] as number) >= MIN_VISIBILITY;
  const u = (p: Float32Array, i: number): number => (1 - (p[i * STRIDE] as number)) * clip.aspect;
  const grow = (a: number, b: number, c: number, d: number): void => {
    if (a < minU) minU = a;
    if (b > maxU) maxU = b;
    if (c < minV) minV = c;
    if (d > maxV) maxV = d;
  };
  for (const f of clip.frames) {
    const p = f.p;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      if (!seen(p, i)) continue;
      const x = u(p, i);
      const y = p[i * STRIDE + 1] as number;
      grow(x, x, y, y);
    }
    // the width the game draws the body by: the shoulders, or the hips a little wider when the shoulders are not in view
    const width = seen(p, LM.leftShoulder) && seen(p, LM.rightShoulder) ? Math.abs(u(p, LM.leftShoulder) - u(p, LM.rightShoulder))
      : seen(p, LM.leftHip) && seen(p, LM.rightHip) ? Math.abs(u(p, LM.leftHip) - u(p, LM.rightHip)) * 1.25 : 0;
    if (width > 0 && seen(p, LM.nose)) {
      const r = HEAD_RING * width;
      const x = u(p, LM.nose);
      const y = p[LM.nose * STRIDE + 1] as number;
      grow(x - r, x + r, y - r, y + r);
    }
  }
  if (!Number.isFinite(minU)) return { minU: 0, maxU: clip.aspect, minV: 0, maxV: 1 };
  return { minU, maxU, minV, maxV };
}

/** How picture units become pixels: one scale for both axes (a body is never stretched), the body centred. */
export interface Fit { scale: number; ox: number; oy: number; minU: number; minV: number }

export function fitTo(b: Bounds, w: number, h: number): Fit {
  const bw = Math.max(b.maxU - b.minU, 0.2);
  const bh = Math.max(b.maxV - b.minV, 0.2);
  const scale = Math.max(1e-6, Math.min((w * (1 - 2 * MARGIN)) / bw, (h * (1 - 2 * MARGIN)) / bh));
  return { scale, minU: b.minU, minV: b.minV, ox: (w - (b.maxU - b.minU) * scale) / 2, oy: (h - (b.maxV - b.minV) * scale) / 2 };
}

/** The pose `t` milliseconds into the window (between the two frames around it), as packed points in pixels: x, y, visibility of the 33 landmarks. */
export function poseAt(clip: ReplayClip, t: number, fit: Fit, out: Float32Array = createPoints()): Float32Array {
  const frames = clip.frames;
  const last = frames.length - 1;
  if (last < 0) { out.fill(0); return out; }
  const at = Math.min(Math.max(0, t), (frames[last] as ReplayFrame).t);
  let i = 0;
  while (i < last - 1 && (frames[i + 1] as ReplayFrame).t <= at) i++;
  const a = frames[i] as ReplayFrame;
  const b = frames[Math.min(last, i + 1)] as ReplayFrame;
  const span = b.t - a.t;
  const k = span > 0 ? Math.min(1, Math.max(0, (at - a.t) / span)) : 0;
  for (let j = 0; j < LANDMARK_COUNT; j++) {
    const x = (a.p[j * STRIDE] as number) + ((b.p[j * STRIDE] as number) - (a.p[j * STRIDE] as number)) * k;
    const y = (a.p[j * STRIDE + 1] as number) + ((b.p[j * STRIDE + 1] as number) - (a.p[j * STRIDE + 1] as number)) * k;
    out[j * STRIDE] = fit.ox + ((1 - x) * clip.aspect - fit.minU) * fit.scale;
    out[j * STRIDE + 1] = fit.oy + (y - fit.minV) * fit.scale;
    // a joint that either frame did not see is not drawn
    out[j * STRIDE + 2] = Math.min(a.p[j * STRIDE + 2] as number, b.p[j * STRIDE + 2] as number);
  }
  return out;
}

/** What the player needs from its surroundings; the page gives the browser's, tests give their own. */
export interface ReplayHost {
  /** The size of the picture in CSS pixels, and the pixels the canvas has per CSS pixel. */
  size(): { w: number; h: number; ratio: number };
  /** Sets the canvas's own size (pixels). */
  resize(w: number, h: number): void;
  ctx: Ctx2D;
  now(): number;
  raf(cb: () => void): number;
  caf(id: number): void;
  /** Where it stands, for the track under the picture and for tests: 0 to 1, and the state. */
  report(p: { progress: number; state: ReplayState }): void;
}

export type ReplayState = 'playing' | 'done' | 'still';

export interface ReplayPlayerOptions {
  clip: ReplayClip;
  host: ReplayHost;
  /** One still picture, no motion (the player asked for less). */
  still?: boolean;
  /** Plays when started (the screen has just opened). Without it the picture shows the moment of the miss until the button is pressed. */
  autoplay?: boolean;
  /** Called once when the player is let go of (the page takes its canvas and its observer away there). */
  onDispose?: () => void;
}

export class ReplayPlayer {
  private readonly clip: ReplayClip;
  private readonly host: ReplayHost;
  private readonly still: boolean;
  private readonly onDispose: (() => void) | undefined;
  private readonly bounds: Bounds;
  private readonly pts = createPoints();
  private fit: Fit = { scale: 1, ox: 0, oy: 0, minU: 0, minV: 0 };
  private box = { w: 1, h: 1 };
  private raf = 0;
  private startedAt = 0;
  private drawnAt = Number.NEGATIVE_INFINITY;
  private at = 0;
  private state: ReplayState = 'done';
  private disposed = false;

  constructor(o: ReplayPlayerOptions) {
    this.clip = o.clip;
    this.host = o.host;
    this.still = o.still === true;
    this.onDispose = o.onDispose;
    this.bounds = boundsOf(o.clip);
    this.at = this.length;
    this.measure();
    if (this.still) this.show('still', this.length);
    else if (o.autoplay === true) this.play();
    else this.show('done', this.length);
  }

  /** How long the replay runs, in milliseconds. */
  get length(): number { return this.clip.frames[this.clip.frames.length - 1]?.t ?? 0; }

  get current(): ReplayState { return this.state; }

  /** The picture changed size: the canvas follows, and what is on it is drawn again. */
  measure(): void {
    const s = this.host.size();
    const w = Math.max(1, Math.round(s.w));
    const h = Math.max(1, Math.round(s.h));
    this.box = { w, h };
    this.host.resize(Math.round(w * s.ratio), Math.round(h * s.ratio));
    this.host.ctx.setTransform(s.ratio, 0, 0, s.ratio, 0, 0);
    this.fit = fitTo(this.bounds, w, h);
    this.paint(this.at);
  }

  /** Plays the window from its start, once. A still picture does not move: there is nothing to play. */
  play(): void {
    if (this.disposed || this.still) return;
    this.cancel();
    this.startedAt = this.host.now();
    this.drawnAt = Number.NEGATIVE_INFINITY;
    this.state = 'playing';
    this.paint(0);
    this.host.report({ progress: 0, state: 'playing' });
    this.raf = this.host.raf(() => this.frame());
  }

  private frame(): void {
    this.raf = 0;
    if (this.disposed) return;
    const t = this.host.now() - this.startedAt;
    if (t >= this.length) { this.show('done', this.length); return; }
    // a frame drawn a moment ago is enough: the next callback comes anyway
    if (t - this.drawnAt >= DRAW_EVERY_MS || this.drawnAt === Number.NEGATIVE_INFINITY) {
      this.drawnAt = t;
      this.paint(t);
      this.host.report({ progress: this.length > 0 ? t / this.length : 1, state: 'playing' });
    }
    this.raf = this.host.raf(() => this.frame());
  }

  private show(state: ReplayState, t: number): void {
    this.cancel();
    this.state = state;
    this.paint(t);
    this.host.report({ progress: 1, state });
  }

  private cancel(): void {
    if (this.raf) this.host.caf(this.raf);
    this.raf = 0;
  }

  private paint(t: number): void {
    this.at = t;
    const c = this.host.ctx;
    c.save();
    c.fillStyle = BACKDROP;
    c.fillRect(0, 0, this.box.w, this.box.h);
    if (this.still) {
      // the way the body came to the miss: three poses before it, fainter the earlier they are, then the pose at the miss in full
      const L = this.length;
      for (const [share, alpha] of [[0, 0.16], [0.34, 0.26], [0.67, 0.4]] as const) {
        c.globalAlpha = alpha;
        this.draw(L * share);
      }
      c.globalAlpha = 1;
    }
    this.draw(t);
    c.restore();
  }

  private draw(t: number): void {
    poseAt(this.clip, t, this.fit, this.pts);
    drawSkeleton(this.host.ctx, this.pts, BODY_STYLES[1], bodyScale(this.pts, this.box.h * 0.2));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.onDispose?.();
  }
}

/** The parts of the results screen the player is bound to. */
export interface ReplayMount {
  view: HTMLElement;
  button: HTMLElement | null;
  track: HTMLElement | null;
}

/**
 * Puts a player in the replay slot of the results screen: a canvas in the picture, the button, and the track under it. Returns the player, which
 * the page calls `play()` on, and lets go of with `dispose()` when the screen goes (the canvas goes with the screen's own markup).
 */
export function mountReplay(win: Window & typeof globalThis, m: ReplayMount, o: { clip: ReplayClip; still: boolean; autoplay: boolean }): ReplayPlayer | null {
  const canvas = win.document.createElement('canvas');
  canvas.className = 'ba-replay-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  m.view.append(canvas);
  const host: ReplayHost = {
    size: () => ({ w: m.view.clientWidth, h: m.view.clientHeight, ratio: Math.min(2, Math.max(1, win.devicePixelRatio || 1)) }),
    resize: (w, h) => { canvas.width = w; canvas.height = h; },
    ctx,
    now: () => win.performance.now(),
    raf: (cb) => win.requestAnimationFrame(cb),
    caf: (id) => win.cancelAnimationFrame(id),
    report: ({ progress, state }) => {
      m.view.dataset['state'] = state;
      m.track?.style.setProperty('--p', String(Math.round(progress * 1000) / 1000));
    },
  };
  let watch: ResizeObserver | null = null;
  const player = new ReplayPlayer({
    clip: o.clip, host, still: o.still, autoplay: o.autoplay,
    onDispose: () => { watch?.disconnect(); canvas.remove(); },
  });
  m.view.dataset['frames'] = String(o.clip.frames.length);
  // a button that plays, and the track it moves, have nothing to do for a picture that stands still
  if (o.still) m.button?.closest<HTMLElement>('.scrub')?.setAttribute('hidden', '');
  if (typeof win.ResizeObserver === 'function') {
    watch = new win.ResizeObserver(() => player.measure());
    watch.observe(m.view);
  }
  return player;
}
