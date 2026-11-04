// The moving parts of the home page (views/home.ts): the loops of real play, the scroll stage where the camera picture shrinks into
// the corner of the game, the pinned stage of "every move is a game" where one scene per game comes as you scroll (only the scene on
// screen plays, and its big words pulse on the person's moves), and the game tiles that tilt under the mouse. Everything here is extra:
// the page is complete with its posters, so with motion switched off (the footer switch), Save-Data (no videos) or no scripts nothing
// is missing.
// Videos start after the page has loaded (the poster is the first picture, so the loop never holds up the first paint), only near
// the screen, and they pause when they leave it. mountHomeMotion() returns the function that undoes all of it (the app calls it
// before it draws another page).

/** What the motion needs from the window: the parts a test can stand in for. */
export type MotionWindow = Window & typeof globalThis;

export interface HomeMotionOptions {
  /** The player switched motion off (the footer switch or Settings): no loops, no scroll stage, no tilt. The device's own
   *  reduced-motion wish does not count here: the home page moves by default and says how to calm it. */
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

/** Which of the scenes of the pinned stage shows at progress p (0 to 1 over the stage's track): equal stretches, the last one held. */
export function sceneOf(p: number, n: number): number {
  return n <= 0 ? -1 : Math.max(0, Math.min(n - 1, Math.floor(clamp(p) * n)));
}

/**
 * Whether the loop's clock passed a beat between two looks: from `last` to `now` seconds inside a loop, which may have started again in
 * between (now < last).
 */
export function beatCrossed(beats: readonly number[], last: number, now: number): boolean {
  return beats.some((b) => (now >= last ? b > last && b <= now : b > last || b <= now));
}

export function mountHomeMotion(root: HTMLElement, win: MotionWindow, o: HomeMotionOptions): () => void {
  const page = root.querySelector<HTMLElement>('.hm-root');
  if (!page) return () => undefined;
  const nav = win.navigator as Navigator & { connection?: { saveData?: boolean } };
  // Save-Data keeps the stage and the tilt but loads no video: the posters stay.
  const saveData = nav.connection?.saveData === true;
  if (o.reduced) {
    page.classList.add('hm-still');
    return () => page.classList.remove('hm-still');
  }
  const offs: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(target: Window, type: K, cb: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
    target.addEventListener(type, cb as EventListener, opts);
    offs.push(() => target.removeEventListener(type, cb as EventListener, opts));
  };
  const fine = win.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
  let disposed = false;

  // ---- loops ----------------------------------------------------------------------------------------------------------
  const figures = Array.from(page.querySelectorAll<HTMLElement>('figure.hm-clip[data-srcs]'));
  const videoOf = (f: HTMLElement): HTMLVideoElement | null => f.querySelector('video');
  // The scenes of the pinned stage are all on screen at once (one above the other); while the stage is pinned it plays them itself.
  const bxTrack = page.querySelector<HTMLElement>('.hm-bx-track');
  const bxStage = bxTrack?.querySelector<HTMLElement>('.hm-bx-stage') ?? null;
  const bxScenes = bxTrack ? Array.from(bxTrack.querySelectorAll<HTMLElement>('.hm-bx-scene')) : [];
  const bxDots = bxTrack ? Array.from(bxTrack.querySelectorAll<HTMLElement>('.hm-bx-dots i')) : [];
  const bxPinned = (): boolean => !!bxTrack && !!bxStage && bxTrack.offsetHeight > bxStage.offsetHeight + 4;
  const staged = (f: HTMLElement): boolean => f.classList.contains('hm-bx-clip') && bxPinned();
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
    if (armed || disposed || !IO || saveData) return;
    armed = true;
    const near = new IO((es) => { for (const e of es) if (e.isIntersecting && !staged(e.target as HTMLElement)) { start(e.target as HTMLElement); near.unobserve(e.target); } }, { rootMargin: '400px 0px' });
    const vis = new IO((es) => {
      for (const e of es) {
        const f = e.target as HTMLElement;
        if (staged(f)) continue;
        if (e.isIntersecting) { visible.add(f); start(f); play(f); } else { visible.delete(f); videoOf(f)?.pause(); }
      }
    }, { threshold: 0.15 });
    for (const f of figures) { near.observe(f); vis.observe(f); }
    offs.push(() => { near.disconnect(); vis.disconnect(); });
    bxVideos();
  };
  // The first picture is the poster: loops wait for the page to load, then a moment more (or the first scroll or touch).
  const later = (): void => { const t = win.setTimeout(arm, 700); offs.push(() => win.clearTimeout(t)); };
  if (win.document.readyState === 'complete') later(); else on(win, 'load', later, { once: true });
  for (const type of ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const) on(win, type, arm, { once: true, passive: true });

  // ---- the scroll stage -----------------------------------------------------------------------------------------------
  const cam = page.querySelector<HTMLElement>('.hm-cam');
  const track = cam?.querySelector<HTMLElement>('.hm-cam-track') ?? null;
  const stick = cam?.querySelector<HTMLElement>('.hm-cam-stick') ?? null;
  // The camera picture and the game are two loops of the same moment (the hero and the stage): the camera one follows the game's clock.
  for (const box of Array.from(page.querySelectorAll<HTMLElement>('[data-sync]'))) {
    const gameVideo = box.querySelector<HTMLVideoElement>('.hm-clip--game video');
    const camVideo = box.querySelector<HTMLVideoElement>('.hm-clip--cam video');
    if (!gameVideo || !camVideo) continue;
    const sync = (): void => {
      if (camVideo.readyState < 2 || gameVideo.readyState < 2) return;
      if (Math.abs(camVideo.currentTime - gameVideo.currentTime) > 0.12) camVideo.currentTime = gameVideo.currentTime;
    };
    gameVideo.addEventListener('timeupdate', sync);
    gameVideo.addEventListener('seeked', sync);
    camVideo.addEventListener('playing', sync);
    offs.push(() => { gameVideo.removeEventListener('timeupdate', sync); gameVideo.removeEventListener('seeked', sync); camVideo.removeEventListener('playing', sync); });
  }

  // Geometry is read on load and resize only; scrolling writes styles.
  interface Geo { vh: number; trackTop: number; trackRoom: number; bx: { top: number; height: number; room: number; stick: number } | null }
  let geo: Geo | null = null;
  const measure = (): Geo => {
    const sy = win.scrollY;
    const tr = track?.getBoundingClientRect();
    const br = bxTrack?.getBoundingClientRect();
    return {
      vh: win.innerHeight,
      trackTop: tr ? tr.top + sy : 0,
      trackRoom: track && stick ? Math.max(1, track.offsetHeight - stick.offsetHeight) : 1,
      bx: bxTrack && bxStage && br ? {
        top: br.top + sy, height: bxTrack.offsetHeight, room: bxTrack.offsetHeight - bxStage.offsetHeight,
        stick: parseFloat(win.getComputedStyle(bxStage).top) || 0,
      } : null,
    };
  };

  // ---- every move is a game: the pinned stage, one scene per game -------------------------------------------------------
  let bxCur = -1;
  let bxRaf = 0;
  let bxLast = 0;
  const bxBeats = new WeakMap<HTMLElement, number[]>();
  const bxFigure = (li: HTMLElement): HTMLElement | null => li.querySelector<HTMLElement>('figure.hm-clip');
  // The scene on screen plays; the ones next to it load, so the next one is ready when it comes; the rest wait.
  function bxVideos(): void {
    if (!bxPinned()) return;
    bxScenes.forEach((li, k) => {
      const f = bxFigure(li);
      if (!f) return;
      if (armed && !saveData && bxCur >= 0 && Math.abs(k - bxCur) <= 1) start(f);
      if (k === bxCur && armed && !saveData) play(f); else videoOf(f)?.pause();
    });
  }
  const bxTick = (): void => {
    bxRaf = 0;
    if (disposed || bxCur < 0) return;
    const li = bxScenes[bxCur];
    const f = li ? bxFigure(li) : null;
    const v = f ? videoOf(f) : null;
    if (li && v && !v.paused && v.readyState > 1) {
      let beats = bxBeats.get(li);
      if (!beats) { beats = (li.dataset['beats'] ?? '').split(',').filter(Boolean).map(Number); bxBeats.set(li, beats); }
      const t = v.currentTime;
      if (beatCrossed(beats, bxLast, t)) { li.classList.remove('hit'); void li.offsetWidth; li.classList.add('hit'); }
      bxLast = t;
    }
    bxRaf = win.requestAnimationFrame(bxTick);
  };
  const bxSet = (i: number): void => {
    if (i === bxCur) return;
    bxCur = i;
    if (i >= 0) {
      bxScenes.forEach((li, k) => { li.classList.toggle('on', k === i); if (k !== i) li.classList.remove('hit'); });
      bxDots.forEach((d, k) => d.classList.toggle('on', k === i));
      const bg = bxScenes[i]?.style.getPropertyValue('--bg');
      if (bg) bxStage?.style.setProperty('--sbg', bg);
    }
    bxLast = 0;
    bxVideos();
    if (i >= 0 && !bxRaf) bxRaf = win.requestAnimationFrame(bxTick);
  };
  // A keyboard user tabbing into a scene that is not on screen (its game link) is scrolled to it.
  if (bxTrack) {
    const focus = (e: FocusEvent): void => {
      const li = (e.target as Element | null)?.closest?.('.hm-bx-scene') as HTMLElement | null;
      const k = li ? bxScenes.indexOf(li) : -1;
      if (k < 0 || k === bxCur || !bxPinned()) return;
      geo ??= measure();
      const g = geo.bx;
      if (g) win.scrollTo({ top: g.top - g.stick + ((k + 0.5) / bxScenes.length) * g.room, behavior: 'instant' as ScrollBehavior });
    };
    bxTrack.addEventListener('focusin', focus);
    offs.push(() => bxTrack.removeEventListener('focusin', focus));
  }
  offs.push(() => { if (bxRaf) win.cancelAnimationFrame(bxRaf); bxRaf = 0; });
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
    const g = geo.bx;
    if (g && g.room > 4) {
      // on screen: the scene of the stretch of the track the stage is in (the first before it pins, the last after)
      const near = sy + geo.vh > g.top && sy < g.top + g.height;
      bxSet(near ? sceneOf((sy + g.stick - g.top) / g.room, bxScenes.length) : -1);
    } else bxSet(-1);
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
