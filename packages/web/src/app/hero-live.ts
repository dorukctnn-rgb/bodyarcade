// The home page hero, alive (views/arena.ts arenaHero): the clip of a real athlete plays over its poster, and a canvas draws our
// body line on the athlete, frame by frame (the pose our model read from that very frame), with the score pops of a round in the
// site's display face. Browser only.
//
// - The poster is the page's largest picture. The clip gets its address after the page has loaded, the crop of the screen's shape
//   (ARENA_TALL_QUERY), VP9 in WebM where the browser plays it, else H.264 in MP4.
// - The body line follows the clip's own frames (requestVideoFrameCallback, with requestAnimationFrame and currentTime where that is
//   missing), from the points our pose model read from the same file (src/hero-pose/*.json). The picture itself is drawn on a canvas of
//   its own in the same callback as the line (the video element only decodes), so a frame and its line always reach the screen together:
//   a video and a canvas composited apart could show the line a frame behind the body on a fast move.
// - Reduced motion, saving data, a slow connection, a crawler or a script: no clip, and the body line of the poster's frame, still.
// - The pause button stops the clip and the line; off the screen and in a hidden tab both stop by themselves.
import { ARENA, ARENA_TALL_QUERY, type ArenaCrop } from '../arena.ts';
import { clipsAllowed, type ClipConnection } from '../clips.ts';
import { coverBox, isHeroPose, objectPosition, type HeroPose } from '../hero-pose.ts';
import type { TileClipsEnv } from './tile-clips.ts';
import { drawBodyLine, drawPops, loadPopFont } from './body-line.ts';

const loadPose = async (crop: ArenaCrop): Promise<HeroPose | null> => {
  try {
    const mod = crop.id === 'tall' ? await import('../hero-pose/arena-tall-720.json') : await import('../hero-pose/arena-wide-1280.json');
    const data = (mod as { default?: unknown }).default ?? mod;
    return isHeroPose(data) ? data : null;
  } catch { return null; }
};

export function startHeroLive(root: ParentNode, env: TileClipsEnv): () => void {
  const { win } = env;
  const doc = win.document;
  const section = root.querySelector<HTMLElement>('.k-arena');
  const video = section?.querySelector<HTMLVideoElement>('video.k-arena-video');
  const canvas = section?.querySelector<HTMLCanvasElement>('canvas.k-arena-skel');
  const frameCanvas = section?.querySelector<HTMLCanvasElement>('canvas.k-arena-frame') ?? null;
  const button = section?.querySelector<HTMLButtonElement>('.k-arena-pause');
  if (!section || !video || !canvas || !button || typeof win.matchMedia !== 'function') return () => undefined;
  const g = canvas.getContext('2d');
  const fg = frameCanvas?.getContext('2d') ?? null;
  if (!g) return () => undefined;
  const combo = canvas.dataset['combo'] ?? 'Combo x{n}';
  const perfect = canvas.dataset['perfect'] ?? 'Perfect';
  const tallQuery = win.matchMedia(ARENA_TALL_QUERY);
  const connection = (win.navigator as Navigator & { connection?: ClipConnection }).connection;
  const live = clipsAllowed({ reducedMotion: env.reducedMotion, connection, automated: env.automated, forced: env.forced === true });

  let crop: ArenaCrop = tallQuery.matches ? ARENA.tall : ARENA.wide;
  let pose: HeroPose | null = null;
  let stopped = false;
  let userPaused = false;
  let inView = true;
  let frameHandle = 0;
  let rafHandle = 0;
  let lastT = 0;
  let framed = false;
  const pts = new Float32Array(66);

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  const size = (): { w: number; h: number; dpr: number } => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (frameCanvas && (frameCanvas.width !== w || frameCanvas.height !== h)) { frameCanvas.width = w; frameCanvas.height = h; }
    return { w, h, dpr };
  };

  loadPopFont(doc, () => draw(lastT));
  const words = { combo, perfect, lang: doc.documentElement.lang };

  /** The line (and, once the clip plays, its picture) at `t`; `frame`: the video's current frame is the one of `t`. */
  const draw = (t: number, frame = false): void => {
    lastT = t;
    const { w, h, dpr } = size();
    const [px, py] = objectPosition(win.getComputedStyle(video).objectPosition || '50% 50%');
    const box = coverBox(w, h, crop.w, crop.h, px, py);
    if (frame && fg && video.readyState >= 2) {
      fg.drawImage(video, box.x, box.y, box.w, box.h);
      if (!framed) { framed = true; section.classList.add('is-framed'); }
    }
    g.clearRect(0, 0, w, h);
    if (!pose) return;
    const at = drawBodyLine(g, pose, t, box, { line: Math.max(2 * dpr, 3.4 * (box.h / 720)) }, pts);
    drawPops(g, pose, t, at, box, w, dpr, words);
  };

  // ---- the clip ----------------------------------------------------------------------------------------------------------
  const onFrame = (_now: number, meta: { mediaTime: number }): void => {
    if (stopped) return;
    draw(meta.mediaTime, true);
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };
  const onRaf = (): void => {
    if (stopped) return;
    if (!video.paused) draw(video.currentTime, true);
    rafHandle = win.requestAnimationFrame(onRaf);
  };
  const follow = (): void => {
    if (typeof video.requestVideoFrameCallback === 'function') frameHandle = video.requestVideoFrameCallback(onFrame);
    else rafHandle = win.requestAnimationFrame(onRaf);
  };
  const unfollow = (): void => {
    if (frameHandle && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(frameHandle);
    if (rafHandle) win.cancelAnimationFrame(rafHandle);
    frameHandle = 0; rafHandle = 0;
  };

  const source = (c: ArenaCrop): string => {
    const webm = video.dataset[`${c.id}Webm`] ?? '';
    const mp4 = video.dataset[`${c.id}Mp4`] ?? '';
    return video.canPlayType('video/webm; codecs="vp9"') === 'probably' && webm ? webm : mp4;
  };
  const shouldRun = (): boolean => !stopped && !userPaused && inView && !doc.hidden;
  const sync = (): void => {
    if (!video.getAttribute('src')) return;
    if (shouldRun()) { void video.play().catch(() => undefined); } else video.pause();
  };
  const onPlaying = (): void => { section.classList.add('is-live'); button.hidden = false; };
  // paused (the button, the tab, off the screen): the line of the frame that stays on the screen
  const onPause = (): void => draw(video.currentTime, true);
  const loadClip = (): void => {
    if (!live || stopped) return;
    const src = source(crop);
    if (!src) return;
    section.classList.remove('is-live', 'is-framed');
    framed = false;
    video.src = src;
    video.preload = 'auto';
    video.load();
    sync();
  };

  // ---- the crop of the screen's shape -------------------------------------------------------------------------------------
  const takeCrop = async (): Promise<void> => {
    crop = tallQuery.matches ? ARENA.tall : ARENA.wide;
    pose = await loadPose(crop);
    if (stopped) return;
    draw(0);
    if (doc.readyState === 'complete') loadClip();
  };
  const onCrop = (): void => { void takeCrop(); };

  // ---- the button, the screen and the tab -----------------------------------------------------------------------------------
  const onButton = (): void => {
    userPaused = !userPaused;
    button.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
    button.setAttribute('aria-label', (userPaused ? button.dataset['labelPlay'] : button.dataset['labelPause']) ?? '');
    sync();
  };
  const onVisibility = (): void => sync();
  const Observer = (win as Window & typeof globalThis).IntersectionObserver;
  const io = typeof Observer === 'function' ? new Observer((entries) => { inView = entries.some((e) => e.isIntersecting); sync(); }, { threshold: 0.1 }) : null;
  const Resize = (win as Window & typeof globalThis).ResizeObserver;
  const ro = typeof Resize === 'function' ? new Resize(() => draw(lastT, !video.paused || framed)) : null;
  const onLoad = (): void => { (win.requestIdleCallback ?? ((f: () => void) => win.setTimeout(f, 200)))(() => loadClip()); };

  void (async () => {
    await takeCrop();
    if (stopped) return;
    if (live) {
      video.addEventListener('playing', onPlaying);
      video.addEventListener('pause', onPause);
      follow();
      if (doc.readyState !== 'complete') win.addEventListener('load', onLoad, { once: true });
    }
  })();
  button.addEventListener('click', onButton);
  doc.addEventListener('visibilitychange', onVisibility);
  tallQuery.addEventListener?.('change', onCrop);
  io?.observe(section);
  ro?.observe(canvas);

  return () => {
    stopped = true;
    unfollow();
    button.removeEventListener('click', onButton);
    doc.removeEventListener('visibilitychange', onVisibility);
    tallQuery.removeEventListener?.('change', onCrop);
    win.removeEventListener('load', onLoad);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('pause', onPause);
    io?.disconnect();
    ro?.disconnect();
    video.pause();
    if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
    section.classList.remove('is-live', 'is-framed');
  };
}
