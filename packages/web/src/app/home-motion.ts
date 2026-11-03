// The moving parts of the home page (views/home.ts): the loops of real play, the scroll stage where the camera picture shrinks into
// the corner of the game, the reel that leans as it passes, and the game tiles that tilt under the mouse. Everything here is extra:
// the page is complete with its posters, so with reduced motion, Save-Data or no scripts nothing below runs and nothing is missing.
// Videos start after the page has loaded (the poster is the first picture, so the loop never holds up the first paint), only near
// the screen, and they pause when they leave it. mountHomeMotion() returns the function that undoes all of it (the app calls it
// before it draws another page).

/** What the motion needs from the window: the parts a test can stand in for. */
export type MotionWindow = Window & typeof globalThis;

export interface HomeMotionOptions {
  /** The player's or the system's reduced motion: no loops, no scroll stage, no tilt. */
  reduced: boolean;
}

type Srcs = Record<string, [string, string]>;

const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The width of a loop to fetch for a box: the smallest that covers it at the screen's density (at most 2), else the largest. */
export function pickWidth(widths: readonly number[], boxWidth: number, dpr: number): number {
  const sorted = [...widths].sort((a, b) => a - b);
  const need = boxWidth * Math.min(Math.max(dpr || 1, 1), 2);
  return sorted.find((w) => w >= need) ?? sorted[sorted.length - 1] ?? 0;
}

/** Where the scroll stage is: 1 (the camera picture), 2 (it shrinks into the game) or 3 (the game, the video stays here). */
export function stageStep(p: number): 1 | 2 | 3 {
  return p < 0.3 ? 1 : p < 0.68 ? 2 : 3;
}

/** How far the camera picture has shrunk into its corner (0 full, 1 in the corner) at stage progress p. */
export function shrinkOf(p: number): number {
  return ease(clamp((p - 0.26) / 0.34));
}

export function mountHomeMotion(root: HTMLElement, win: MotionWindow, o: HomeMotionOptions): () => void {
  const page = root.querySelector<HTMLElement>('.hm-root');
  if (!page) return () => undefined;
  const nav = win.navigator as Navigator & { connection?: { saveData?: boolean } };
  const saveData = nav.connection?.saveData === true;
  if (o.reduced || saveData) {
    page.classList.add('hm-still');
    return () => page.classList.remove('hm-still');
  }
  const offs: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(target: Window, type: K, cb: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
    target.addEventListener(type, cb as EventListener, opts);
    offs.push(() => target.removeEventListener(type, cb as EventListener, opts));
  };
  const fine = win.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
  const narrow = (): boolean => win.innerWidth < 761;
  let disposed = false;

  // ---- loops ----------------------------------------------------------------------------------------------------------
  const figures = Array.from(page.querySelectorAll<HTMLElement>('figure.hm-clip[data-srcs]'));
  const videoOf = (f: HTMLElement): HTMLVideoElement | null => f.querySelector('video');
  const visible = new Set<HTMLElement>();
  const start = (f: HTMLElement): void => {
    const v = videoOf(f);
    if (!v || f.dataset['on']) return;
    if (f.getClientRects().length === 0) return; // not drawn (a layer that this screen hides)
    let srcs: Srcs;
    try { srcs = JSON.parse(f.dataset['srcs'] ?? '{}') as Srcs; } catch { return; }
    const widths = Object.keys(srcs).map(Number).filter((n) => n > 0);
    const w = pickWidth(widths, f.getBoundingClientRect().width, win.devicePixelRatio);
    const pair = srcs[String(w)];
    if (!pair) return;
    f.dataset['on'] = '1';
    const webm = v.canPlayType('video/webm; codecs="vp9"') !== '';
    v.addEventListener('playing', () => f.classList.add('playing'));
    v.addEventListener('error', () => {
      if (v.dataset['mp4']) return;
      v.dataset['mp4'] = '1';
      v.src = pair[1];
      v.load();
      if (visible.has(f)) void v.play().catch(() => undefined);
    });
    if (!webm) v.dataset['mp4'] = '1';
    v.src = webm ? pair[0] : pair[1];
    v.load();
  };
  const play = (f: HTMLElement): void => { const v = videoOf(f); if (v && f.dataset['on']) void v.play().catch(() => undefined); };
  const IO = win.IntersectionObserver;
  let armed = false;
  const arm = (): void => {
    if (armed || disposed || !IO) return;
    armed = true;
    const near = new IO((es) => { for (const e of es) if (e.isIntersecting) { start(e.target as HTMLElement); near.unobserve(e.target); } }, { rootMargin: '400px 0px' });
    const vis = new IO((es) => {
      for (const e of es) {
        const f = e.target as HTMLElement;
        if (e.isIntersecting) { visible.add(f); start(f); play(f); } else { visible.delete(f); videoOf(f)?.pause(); }
      }
    }, { threshold: 0.15 });
    for (const f of figures) { near.observe(f); vis.observe(f); }
    offs.push(() => { near.disconnect(); vis.disconnect(); });
  };
  // The first picture is the poster: loops wait for the page to load, then a moment more (or the first scroll or touch).
  const later = (): void => { const t = win.setTimeout(arm, 700); offs.push(() => win.clearTimeout(t)); };
  if (win.document.readyState === 'complete') later(); else on(win, 'load', later, { once: true });
  for (const type of ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const) on(win, type, arm, { once: true, passive: true });

  // ---- the scroll stage -----------------------------------------------------------------------------------------------
  const cam = page.querySelector<HTMLElement>('.hm-cam');
  const track = cam?.querySelector<HTMLElement>('.hm-cam-track') ?? null;
  const stick = cam?.querySelector<HTMLElement>('.hm-cam-stick') ?? null;
  // The camera picture and the game are two loops of the same moment: the camera one follows the game's clock.
  const gameVideo = cam?.querySelector<HTMLVideoElement>('.hm-clip--game video') ?? null;
  const camVideo = cam?.querySelector<HTMLVideoElement>('.hm-clip--cam video') ?? null;
  if (gameVideo && camVideo) {
    const sync = (): void => {
      if (camVideo.readyState < 2 || gameVideo.readyState < 2) return;
      if (Math.abs(camVideo.currentTime - gameVideo.currentTime) > 0.12) camVideo.currentTime = gameVideo.currentTime;
    };
    gameVideo.addEventListener('timeupdate', sync);
    gameVideo.addEventListener('seeked', sync);
    offs.push(() => { gameVideo.removeEventListener('timeupdate', sync); gameVideo.removeEventListener('seeked', sync); });
  }

  // Geometry is read on load and resize only; scrolling writes styles.
  interface Geo { vh: number; trackTop: number; trackRoom: number; reel: { el: HTMLElement; mid: number }[] }
  let geo: Geo | null = null;
  const reelCards = Array.from(page.querySelectorAll<HTMLElement>('.hm-rcard'));
  const measure = (): Geo => {
    const sy = win.scrollY;
    const tr = track?.getBoundingClientRect();
    return {
      vh: win.innerHeight,
      trackTop: tr ? tr.top + sy : 0,
      trackRoom: track && stick ? Math.max(1, track.offsetHeight - stick.offsetHeight) : 1,
      reel: reelCards.map((el) => { const r = el.getBoundingClientRect(); return { el, mid: r.top + sy + r.height / 2 }; }),
    };
  };
  let lastStep = 0;
  const scene = (): void => {
    if (disposed) return;
    geo ??= measure();
    const sy = win.scrollY;
    if (cam && stick && track) {
      const pinned = track.offsetHeight > stick.offsetHeight + 4;
      const p = pinned ? clamp((sy - geo.trackTop) / geo.trackRoom) : 1;
      stick.style.setProperty('--p', p.toFixed(4));
      stick.style.setProperty('--k', shrinkOf(p).toFixed(4));
      const step = pinned ? stageStep(p) : 3;
      if (step !== lastStep) {
        lastStep = step;
        cam.dataset['step'] = String(step);
        for (const li of Array.from(cam.querySelectorAll<HTMLElement>('.hm-steps li'))) li.classList.toggle('on', li.dataset['step'] === String(step));
      }
    }
    if (!narrow()) {
      for (const c of geo.reel) {
        const r = clamp((c.mid - sy - geo.vh / 2) / geo.vh, -1, 1);
        c.el.style.setProperty('--r', r.toFixed(3));
      }
    }
  };
  let ticking = false;
  const onScroll = (): void => {
    if (ticking) return;
    ticking = true;
    win.requestAnimationFrame(() => { ticking = false; scene(); });
  };
  on(win, 'scroll', onScroll, { passive: true });
  let rz = 0;
  on(win, 'resize', () => { win.clearTimeout(rz); rz = win.setTimeout(() => { geo = null; scene(); }, 120); });
  on(win, 'load', () => { geo = null; scene(); }, { once: true });
  page.classList.add('hm-live');
  scene();

  // ---- tilt under the mouse --------------------------------------------------------------------------------------------
  if (fine) {
    const tiltables = Array.from(page.querySelectorAll<HTMLElement>('.hm-games .ba-tile, .hm-phone--hero'));
    for (const el of tiltables) {
      const move = (e: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 12).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${((0.5 - (e.clientY - r.top) / r.height) * 12).toFixed(2)}deg`);
      };
      const leave = (): void => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
      offs.push(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); });
    }
  }

  return () => {
    disposed = true;
    for (const off of offs.splice(0)) off();
    page.classList.remove('hm-live');
    for (const f of figures) {
      const v = videoOf(f);
      if (v) { v.pause(); v.removeAttribute('src'); try { v.load(); } catch { /* gone */ } }
    }
  };
}
