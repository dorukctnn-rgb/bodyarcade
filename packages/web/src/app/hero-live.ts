// The home page hero, alive (views/arena.ts arenaHero): the clip of a real athlete plays over its poster, and a canvas draws our
// body line on the athlete, frame by frame (the pose our model read from that very frame), with the score pops of a round in the
// site's display face. Browser only.
//
// - The poster is the page's largest picture. The clip gets its address after the page has loaded, the crop of the screen's shape
//   (ARENA_TALL_QUERY), VP9 in WebM where the browser plays it, else H.264 in MP4.
// - The body line follows the clip's own frames (requestVideoFrameCallback, with requestAnimationFrame and currentTime where that is
//   missing), from the points our pose model read from the same file (src/hero-pose/*.json).
// - Reduced motion, saving data, a slow connection, a crawler or a script: no clip, and the body line of the poster's frame, still.
// - The pause button stops the clip and the line; off the screen and in a hidden tab both stop by themselves.
import { ARENA, ARENA_TALL_QUERY, type ArenaCrop } from '../arena.ts';
import { clipsAllowed, type ClipConnection } from '../clips.ts';
import { coverBox, HERO_BONES, HERO_JOINTS, heroPoint, isHeroPose, objectPosition, popsAt, poseAt, type HeroPose } from '../hero-pose.ts';
import type { TileClipsEnv } from './tile-clips.ts';

const LIME = '#d7ff1f';
const WHITE = '#f5f5f5';

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
  const button = section?.querySelector<HTMLButtonElement>('.k-arena-pause');
  if (!section || !video || !canvas || !button || typeof win.matchMedia !== 'function') return () => undefined;
  const g = canvas.getContext('2d');
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
  const pts = new Float32Array(64);

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  const size = (): { w: number; h: number; dpr: number } => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  };

  /** A score pop in the display face (the headings' Anton, uppercase): lime points, white words, a dark edge so it reads on the clip. */
  const POP_FONT = '"Anton", "Arial Narrow", sans-serif';
  let popFontReady = false;
  void doc.fonts?.load(`400 48px ${POP_FONT}`).then(() => { popFontReady = true; draw(lastT); }).catch(() => undefined);
  const drawPop = (text: string, x: number, y: number, size: number, alpha: number, color: string): void => {
    g.save();
    g.globalAlpha = alpha;
    g.font = `400 ${Math.round(size)}px ${popFontReady ? POP_FONT : 'sans-serif'}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, size * 0.14);
    g.strokeStyle = 'rgba(5,5,5,0.8)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  };

  const draw = (t: number): void => {
    lastT = t;
    const { w, h, dpr } = size();
    g.clearRect(0, 0, w, h);
    if (!pose) return;
    const [px, py] = objectPosition(win.getComputedStyle(video).objectPosition || '50% 50%');
    const box = coverBox(w, h, crop.w, crop.h, px, py);
    const p = (name: Parameters<typeof heroPoint>[0]): [number, number] => {
      const k = heroPoint(name) * 2;
      return [box.x + (pts[k] ?? 0) * box.w, box.y + (pts[k + 1] ?? 0) * box.h];
    };
    poseAt(pose, t, pts);
    const scale = box.h / 720;
    const line = Math.max(2 * dpr, 3.4 * scale);
    // the body line: a dark edge under the lime, so it reads on light skin and on the dark gym alike
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1] as const) {
      g.strokeStyle = pass === 0 ? 'rgba(5,5,5,0.55)' : LIME;
      g.lineWidth = pass === 0 ? line * 2.2 : line;
      g.shadowColor = pass === 0 ? 'transparent' : 'rgba(215,255,31,0.55)';
      g.shadowBlur = pass === 0 ? 0 : line * 2;
      g.beginPath();
      for (const [a, b] of HERO_BONES) { const [ax, ay] = p(a); const [bx, by] = p(b); g.moveTo(ax, ay); g.lineTo(bx, by); }
      // the head: a ring around the face, from the ears and the nose
      const [lx, ly] = p('earL'), [rx, ry] = p('earR'), [nx, ny] = p('nose');
      const hx = (lx + rx + nx) / 3, hy = (ly + ry + ny) / 3;
      const r = Math.max(line * 2, Math.hypot(lx - rx, ly - ry) * 0.85);
      g.moveTo(hx + r, hy);
      g.arc(hx, hy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.shadowBlur = 0;
    const jr = line * 1.15;
    g.beginPath();
    for (const j of HERO_JOINTS) { const [x, y] = p(j); g.moveTo(x + jr, y); g.arc(x, y, jr, 0, Math.PI * 2); }
    g.fillStyle = WHITE; g.fill();
    g.lineWidth = Math.max(1, line * 0.45); g.strokeStyle = LIME; g.stroke();

    // the pops, above the athlete's head where there is room (the wide crop), else over the chest (the tall crop has the head near the top)
    const [sx1, sy1] = p('shoulderL'), [sx2, sy2] = p('shoulderR');
    const [, hy0] = p('nose');
    const body = Math.abs(p('ankleL')[1] - Math.min(sy1, sy2)) || box.h * 0.5;
    const popSize = Math.max(26 * dpr, Math.min(64 * dpr, body * 0.2, w * 0.09));
    for (const { pop, age } of popsAt(pose, t)) {
      const [, kind, n] = pop;
      const text = (kind === 'pts' ? `+${n}` : kind === 'combo' ? combo.replace('{n}', String(n)) : perfect).toLocaleUpperCase(doc.documentElement.lang || undefined);
      const side = pose.pops.indexOf(pop) % 2 === 0 ? 1 : -1;
      const rise = Math.min(1, age / 0.25);
      const above = hy0 - body * 0.35 > popSize * 1.2;
      g.font = `400 ${Math.round(popSize)}px ${popFontReady ? POP_FONT : 'sans-serif'}`;
      const half = g.measureText(text).width / 2;
      const x = Math.max(half + 8 * dpr, Math.min(w - half - 8 * dpr, (sx1 + sx2) / 2 + (above ? side * body * 0.42 : 0)));
      const y = above ? hy0 - body * (0.22 + 0.12 * age) : (sy1 + sy2) / 2 + body * (0.14 - 0.1 * age);
      const alpha = age < 0.85 ? Math.min(1, age / 0.12) : (1 - age) / 0.15;
      drawPop(text, x, y, popSize * (kind === 'pts' ? 1 : 0.8) * (0.85 + 0.15 * rise), alpha, kind === 'pts' ? LIME : WHITE);
    }
  };

  // ---- the clip ----------------------------------------------------------------------------------------------------------
  const onFrame = (_now: number, meta: { mediaTime: number }): void => {
    if (stopped) return;
    draw(meta.mediaTime);
    frameHandle = video.requestVideoFrameCallback(onFrame);
  };
  const onRaf = (): void => {
    if (stopped) return;
    if (!video.paused) draw(video.currentTime);
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
  const onPause = (): void => draw(video.currentTime);
  const loadClip = (): void => {
    if (!live || stopped) return;
    const src = source(crop);
    if (!src) return;
    section.classList.remove('is-live');
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
  const ro = typeof Resize === 'function' ? new Resize(() => draw(lastT)) : null;
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
    section.classList.remove('is-live');
  };
}
