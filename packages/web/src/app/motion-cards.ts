// The real people in motion of a drawn page (views/motion.ts, src/motion.ts): which clips play, when, and the body line drawn on each
// one, frame by frame. Browser only.
//
// - Nothing but the posters is fetched until the page has loaded; then only the cards on the screen play, the most visible first, at most
//   two at once on a narrow screen and four on a wide one (motionCap). Off the screen and in a hidden tab they pause on their frame.
// - Reduced motion, saving data, a 2G connection, a weak device (welcome-model.ts startTier 0), a crawler or a script: the posters
//   stay (each is the clip's first frame with its line already drawn on it) and no clip is fetched.
// - The clip's picture and its line are drawn on one canvas in the same callback (requestVideoFrameCallback, else requestAnimationFrame),
//   so the line is never a frame behind the body. The video element only decodes.
import { type ClipConnection } from '../clips.ts';
import { coverBox, isHeroPose, poseAt, type HeroPose } from '../hero-pose.ts';
import { MOTION_SIZE, motionAllowed, motionCap, pickPlaying, type MotionShape } from '../motion.ts';
import { drawBodyLine, drawPops, loadPopFont, type Box, type PopWords } from './body-line.ts';
import { startTier } from './welcome-model.ts';
import type { TileClipsEnv } from './tile-clips.ts';

const poses = new Map<string, Promise<HeroPose | null>>();
/** The body line of a clip, fetched once per page life. */
export function loadMotionPose(url: string, win: Window): Promise<HeroPose | null> {
  let p = poses.get(url);
  if (!p) {
    p = win.fetch(url).then((r) => (r.ok ? r.json() : null)).then((d: unknown) => (isHeroPose(d) ? d : null)).catch(() => null);
    poses.set(url, p);
  }
  return p;
}

/** Is this device weak (few cores or little memory)? The tour's stage asked the same (welcome-model.ts startTier). */
export function weakDevice(win: Window): boolean {
  const nav = win.navigator as Navigator & { deviceMemory?: number };
  return startTier({ ...(nav.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}), ...(nav.deviceMemory ? { memoryGb: nav.deviceMemory } : {}) }) === 0;
}

/** The format this browser plays: VP9 in WebM where it says "probably", else H.264 in MP4, else none (the posters stay). */
export function motionFormat(video: HTMLVideoElement): 'webm' | 'mp4' | null {
  if (video.canPlayType('video/webm; codecs="vp9"') === 'probably') return 'webm';
  if (video.canPlayType('video/mp4; codecs="avc1.64001F"') !== '') return 'mp4';
  return null;
}

/** The time of a pose file's held shape: the widest reach of the wrists (Pose Wall's T). */
export function heldTime(p: HeroPose): number {
  let best = 0, at = 0;
  for (let k = 0; k < p.n; k += 1) {
    const q = poseAt(p, k / p.fps);
    const i = p.k === 33 ? [15, 16] : [7, 8];
    const d = Math.abs((q[i[0]! * 2] ?? 0) - (q[i[1]! * 2] ?? 0));
    if (d > best) { best = d; at = k; }
  }
  return at / p.fps;
}

export type MotionDrawExtra = (g: CanvasRenderingContext2D, info: { t: number; w: number; h: number; dpr: number; box: Box; pose: HeroPose }) => void;

/** One clip with its line on one canvas (a card of the home page, the tour's stage). */
export class MotionPlayer {
  readonly el: HTMLElement;
  readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly win: Window;
  private readonly shape: MotionShape;
  private pose: HeroPose | null = null;
  private loading: Promise<void> | null = null;
  private frameHandle = 0;
  private rafHandle = 0;
  private lastT = 0;
  private prevT = -1;
  private target: number | null = null;
  private readonly pts = new Float32Array(66);
  private readonly ghost = new Float32Array(66);
  private readonly count: HTMLElement | null;
  private readonly clean: HTMLElement | null;
  private reps = 0;
  failed = false;
  disposed = false;
  extra: MotionDrawExtra | null = null;
  readonly words: PopWords;

  constructor(el: HTMLElement, win: Window, words: PopWords) {
    this.el = el;
    this.win = win;
    this.words = words;
    // the video (it only decodes) and the canvas (the picture and the line) go after the poster, under what sits over the picture
    const doc = win.document;
    const poster = el.querySelector('.k-mo-poster');
    this.video = el.querySelector('video.k-mo-video') ?? Object.assign(doc.createElement('video'), { className: 'k-mo-video', muted: true, loop: true, playsInline: true, preload: 'none', tabIndex: -1 });
    this.video.setAttribute('aria-hidden', 'true');
    this.video.setAttribute('disablepictureinpicture', '');
    this.video.setAttribute('disableremoteplayback', '');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('data-qa-layer', '');
    this.canvas = el.querySelector('canvas.k-mo-canvas') ?? Object.assign(doc.createElement('canvas'), { className: 'k-mo-canvas' });
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.setAttribute('data-qa-layer', '');
    if (!this.video.isConnected) (poster ?? el.firstChild)?.after?.(this.video, this.canvas);
    this.g = this.canvas?.getContext('2d') ?? null;
    this.shape = el.classList.contains('k-mo--tall') ? 'tall' : 'tile';
    this.count = el.querySelector('[data-mo-count]');
    this.clean = el.querySelector('[data-mo-clean]');
    this.reps = Number(this.count?.textContent ?? '0') || 0;
    this.video.addEventListener('playing', this.onPlaying);
    this.video.addEventListener('error', this.onError);
  }

  private readonly onPlaying = (): void => { if (!this.disposed && !this.video.paused) this.el.classList.add('is-live'); };
  private readonly onError = (): void => { this.failed = true; this.el.classList.remove('is-live'); this.video.removeAttribute('src'); };

  /** Fetches the clip (the format this browser plays) and its line. */
  load(format: 'webm' | 'mp4'): Promise<void> {
    this.loading ??= (async () => {
      const url = this.el.dataset[format === 'webm' ? 'moWebm' : 'moMp4'] ?? '';
      const poseUrl = this.el.dataset['moPose'] ?? '';
      if (!url || !poseUrl) { this.failed = true; return; }
      this.video.muted = true;
      this.video.defaultMuted = true;
      this.video.preload = 'auto';
      this.video.src = url;
      this.pose = await loadMotionPose(poseUrl, this.win);
      if (!this.pose) { this.failed = true; return; }
      if (this.el.hasAttribute('data-mo-target')) this.target = heldTime(this.pose);
    })();
    return this.loading;
  }

  async play(format: 'webm' | 'mp4'): Promise<void> {
    if (this.disposed || this.failed) return;
    await this.load(format);
    if (this.disposed || this.failed) return;
    this.follow();
    if (this.video.paused) void this.video.play().catch(() => undefined);
  }

  pause(): void {
    if (!this.video.paused) this.video.pause();
    this.unfollow();
  }

  get playing(): boolean { return !this.video.paused; }

  /** Shows the clip still at `t` (a picture or a test that holds the stage). */
  async hold(format: 'webm' | 'mp4', t: number): Promise<void> {
    await this.load(format);
    if (this.disposed || this.failed) return;
    this.video.pause();
    if (this.video.readyState < 1) await new Promise<void>((resolve) => this.video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    await new Promise<void>((resolve) => {
      const done = (): void => { this.video.removeEventListener('seeked', done); resolve(); };
      this.video.addEventListener('seeked', done);
      this.video.currentTime = t;
    });
    if (this.disposed) return;
    this.el.classList.add('is-live');
    this.draw(t, true);
  }

  dispose(): void {
    this.disposed = true;
    this.unfollow();
    this.video.removeEventListener('playing', this.onPlaying);
    this.video.removeEventListener('error', this.onError);
    this.video.pause();
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); this.video.load(); }
    this.el.classList.remove('is-live');
    this.video.remove();
    this.canvas.remove();
  }

  private follow(): void {
    this.unfollow();
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
    if (typeof v.requestVideoFrameCallback === 'function') {
      const onFrame = (_now: number, meta: { mediaTime: number }): void => {
        if (this.disposed) return;
        this.draw(meta.mediaTime, true);
        this.frameHandle = v.requestVideoFrameCallback!(onFrame);
      };
      this.frameHandle = v.requestVideoFrameCallback(onFrame);
    } else {
      const onRaf = (): void => {
        if (this.disposed) return;
        if (!this.video.paused) this.draw(this.video.currentTime, true);
        this.rafHandle = this.win.requestAnimationFrame(onRaf);
      };
      this.rafHandle = this.win.requestAnimationFrame(onRaf);
    }
  }

  private unfollow(): void {
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.frameHandle && typeof v.cancelVideoFrameCallback === 'function') v.cancelVideoFrameCallback(this.frameHandle);
    if (this.rafHandle) this.win.cancelAnimationFrame(this.rafHandle);
    this.frameHandle = 0; this.rafHandle = 0;
  }

  /** Draws the frame on the screen again (the canvas changed size). */
  redraw(): void { if (this.el.classList.contains('is-live')) this.draw(this.lastT, true); }

  private draw(t: number, frame: boolean): void {
    const g = this.g;
    if (!g || !this.pose) return;
    this.lastT = t;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, this.win.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const { w: pw, h: ph } = MOTION_SIZE[this.shape];
    const box = coverBox(w, h, pw, ph, 0.5, 0.5);
    if (frame && this.video.readyState >= 2) g.drawImage(this.video, box.x, box.y, box.w, box.h);
    else g.clearRect(0, 0, w, h);
    const line = Math.max(1.6 * dpr, 3.4 * (box.h / 720) * (this.shape === 'tile' ? 1.3 : 1));
    if (this.target !== null) {
      // the shape to match: faint and dashed, lime once the person holds it
      const tq = poseAt(this.pose, this.target, this.ghost);
      const now = poseAt(this.pose, t, this.pts);
      let d = 0;
      for (let k = 6; k < 34; k += 1) d += Math.abs((tq[k] ?? 0) - (now[k] ?? 0));
      const matched = d / 28 < 0.02;
      drawBodyLine(g, this.pose, this.target, box, { line: line * 1.4, ghost: !matched, alpha: matched ? 0.45 : 0.75 }, this.ghost);
    }
    const at = drawBodyLine(g, this.pose, t, box, { line, allPoints: this.el.hasAttribute('data-mo-all') }, this.pts);
    if (this.el.hasAttribute('data-mo-pops')) drawPops(g, this.pose, t, at, box, w, dpr, this.words, this.shape === 'tile' ? 0.5 : 0.8, this.shape === 'tile' ? 14 : 22);
    // the form coach's counter: one more rep at each of the clip's rep moments
    if (this.count && this.prevT >= 0 && t !== this.prevT) {
      const crossed = this.pose.pops.filter(([p]) => (this.prevT <= t ? p > this.prevT && p <= t : p > this.prevT || p <= t)).length;
      if (crossed > 0) {
        this.reps += crossed;
        this.count.textContent = String(this.reps);
        if (this.clean) this.clean.textContent = String(Math.max(0, this.reps - 1));
      }
    }
    this.prevT = t;
    this.extra?.(g, { t, w, h, dpr, box, pose: this.pose });
  }
}

export interface MotionEnv extends TileClipsEnv {
  /** Words of the pops in the page language. */
  words: PopWords;
}

/** Starts the moving cards under `root` (not the tour's stage: app/welcome.ts plays that); the function it returns stops them. */
export function startMotionCards(root: ParentNode, env: MotionEnv): () => void {
  const { win } = env;
  const doc = win.document;
  const els = [...root.querySelectorAll<HTMLElement>('.k-mo[data-mo-mp4]')].filter((el) => !el.closest('[data-stage]'));
  if (els.length === 0) return () => undefined;
  const connection = (win.navigator as Navigator & { connection?: ClipConnection }).connection;
  if (!motionAllowed({ reducedMotion: env.reducedMotion, connection, automated: env.automated, forced: env.forced === true, weak: weakDevice(win) })) return () => undefined;
  const format = motionFormat(doc.createElement('video'));
  const Observer = (win as Window & typeof globalThis).IntersectionObserver;
  if (!format || typeof Observer !== 'function') return () => undefined;
  loadPopFont(doc, () => undefined);
  const cards = els.map((el) => ({ el, player: new MotionPlayer(el, win, env.words), ratio: 0 }));
  let ready = doc.readyState === 'complete';
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const on = ready && !doc.hidden ? pickPlaying(cards.map((c) => ({ ratio: c.ratio, failed: c.player.failed })), motionCap(win.innerWidth)) : new Set<number>();
    cards.forEach((c, i) => { if (!on.has(i)) c.player.pause(); });
    cards.forEach((c, i) => { if (on.has(i)) void c.player.play(format); });
  };
  const io = new Observer((entries) => {
    for (const e of entries) {
      const c = cards.find((x) => x.el === e.target);
      if (c) c.ratio = e.isIntersecting ? e.intersectionRatio : 0;
    }
    schedule();
  }, { threshold: [0, 0.2, 0.33, 0.5, 0.75, 1] });
  for (const c of cards) io.observe(c.el);
  const Resize = (win as Window & typeof globalThis).ResizeObserver;
  const ro = typeof Resize === 'function' ? new Resize((entries) => { for (const e of entries) cards.find((c) => c.el === e.target)?.player.redraw(); }) : null;
  for (const c of cards) ro?.observe(c.el);
  const onVisibility = (): void => schedule();
  const onLoad = (): void => { ready = true; schedule(); };
  doc.addEventListener('visibilitychange', onVisibility);
  if (!ready) win.addEventListener('load', onLoad, { once: true });

  return () => {
    stopped = true;
    io.disconnect();
    ro?.disconnect();
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('load', onLoad);
    for (const c of cards) c.player.dispose();
  };
}
