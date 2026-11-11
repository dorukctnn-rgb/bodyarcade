// The moving pictures at the top of the home page (views/home.ts showcase(), src/clips.ts): each frame of the showcase gets a clip of
// its game in play over the still picture, and the slides change on the clips' own loops. Browser only.
//
// Until a clip has loaded nothing changes: the page draws the frames and the stylesheet fades them one after the other (20 seconds
// round), the first frame is the page's largest picture and stays its poster. The clips are fetched after the page has loaded, the
// one on the screen first, then the next one ahead. When the first has arrived the script takes the fades over (data-reel on the
// reel): the slide on the screen starts its clip from the beginning, and each slide stays for one loop of its clip, then the next
// fades in over it (the clip of the next slide has been waiting on its first frame). Slides whose clip has not arrived, or cannot be
// played, are shown as pictures for the same five seconds. Off the screen and in a hidden tab everything stops where it is.
// Reduced motion, saving data, a 2G connection, a browser that plays neither format, a crawler or a script: the stylesheet's fades
// and the pictures stay as they were, and no clip is fetched.
import { HERO_SECONDS, clipsAllowed, nextSlide, parseClipSet, pickClip, pickFormat, reelShouldRun, slideProgress, type ClipConnection, type ClipFormat, type HeroCrop } from '../clips.ts';
import { SHOWCASE_WIDE_MIN } from '../showcase.ts';
import type { TileClipsEnv } from './tile-clips.ts';

/** At least this much of the reel on the screen to run it. */
const IN_VIEW = 0.25;
/** How long the next slide takes to fade in over the one before (styles/app.css .k-frame.is-active); the one before is paused after it. */
const FADE_MS = 700;

/** Starts the reel under `root`; the function it returns stops it, lets the clips go and puts the stylesheet's fades back. */
export function startHeroReel(root: ParentNode, env: TileClipsEnv): () => void {
  const { win } = env;
  const doc = win.document;
  const found = root.querySelector<HTMLElement>('.k-reel');
  if (!found) return () => undefined;
  const reel: HTMLElement = found;
  const frames = [...reel.querySelectorAll<HTMLElement>(':scope > .k-frame')];
  const videos = frames.map((f) => f.querySelector<HTMLVideoElement>('video.k-vid'));
  if (frames.length < 2 || videos.some((v) => !v)) return () => undefined;
  const connection = (win.navigator as Navigator & { connection?: ClipConnection }).connection;
  if (!clipsAllowed({ reducedMotion: env.reducedMotion, connection, automated: env.automated, forced: env.forced === true })) return () => undefined;
  const format: ClipFormat | null = pickFormat((type) => videos[0]?.canPlayType(type) ?? '');
  const Observer = (win as Window & typeof globalThis).IntersectionObserver;
  if (!format || typeof Observer !== 'function' || typeof win.matchMedia !== 'function') return () => undefined;
  const wide = win.matchMedia(`(min-width: ${SHOWCASE_WIDE_MIN}px)`);

  let stopRun = run();
  // Across the width where the page changes its crop (a tablet turned, a window resized) the clips of the other crop are the ones to play.
  const onCrop = (): void => { stopRun(); stopRun = run(); };
  wide.addEventListener('change', onCrop);
  return () => { wide.removeEventListener('change', onCrop); stopRun(); };

  function run(): () => void {
    const vids = videos as HTMLVideoElement[];
    const ticks = [...reel.querySelectorAll<HTMLElement>('.k-ticks i')];
    const crop: HeroCrop = wide.matches ? 'wide' : 'phone';
    const key = `${format}${crop === 'wide' ? 'Wide' : 'Phone'}`;
    const offs: (() => void)[] = [];
    const on = (target: EventTarget, type: string, fn: (e: Event) => void): void => { target.addEventListener(type, fn); offs.push(() => target.removeEventListener(type, fn)); };
    const timers = new Set<number>();
    const failed = new Set<number>();
    /** The slides whose clip waits on its first frame (shown, paused) for its turn. */
    const prepared = new Set<number>();
    let ready = doc.readyState === 'complete';
    let begun = false;
    let taken = false;
    let inView = false;
    let running = false;
    let stopped = false;
    let index = 0;
    let previous = -1;
    let wall = 0;
    let last = 0;
    let raf = 0;

    const video = (i: number): HTMLVideoElement => vids[i] as HTMLVideoElement;
    const after = (ms: number, fn: () => void): void => {
      const id = win.setTimeout(() => { timers.delete(id); if (!stopped) fn(); }, ms);
      timers.add(id);
    };

    /** The slide the stylesheet's fades show now: the topmost frame that is mostly there. */
    const visibleIndex = (): number => {
      let top = 0;
      frames.forEach((f, k) => { if (Number(win.getComputedStyle(f).opacity) > 0.5) top = k; });
      return top;
    };

    const load = (i: number): void => {
      const v = video(i);
      if (failed.has(i) || v.getAttribute('src')) return;
      const url = pickClip(parseClipSet(v.dataset[key] ?? ''), reel.getBoundingClientRect().width, win.devicePixelRatio || 1);
      if (!url) { failed.add(i); return; }
      v.muted = true;
      v.defaultMuted = true;
      v.preload = 'auto';
      v.src = url;
    };

    /** A video that can show a picture: it has its first frame (and is not on its way to somewhere else). */
    const loaded = (v: HTMLVideoElement): boolean => v.getAttribute('src') !== null && v.readyState >= 2;
    const playingNow = (v: HTMLVideoElement): boolean => !v.paused && !v.seeking && v.readyState >= 3;

    /** Puts a clip that is not on the screen back to its first frame, shown, paused: its turn will start from there. */
    const prepare = (i: number): void => {
      const v = video(i);
      if (!loaded(v) || prepared.has(i)) return;
      prepared.add(i);
      v.pause();
      if (v.currentTime > 0) v.currentTime = 0;
      v.classList.add('is-on');
    };

    /** The clip of a slide that has just come on: from its first frame. */
    const start = (i: number): void => {
      const v = video(i);
      if (!loaded(v)) return;
      prepared.delete(i);
      if (v.currentTime > 0.04) v.currentTime = 0;
      v.classList.add('is-on');
      void v.play().catch(() => undefined);
    };

    /** The reel runs again (back on the screen, tab in front): the clip goes on from where it was. */
    const resume = (i: number): void => {
      const v = video(i);
      if (loaded(v) && v.paused) void v.play().catch(() => undefined);
    };

    const setTick = (i: number, fraction: number): void => { ticks[i]?.style.setProperty('--p', fraction.toFixed(3)); };

    /** Shows slide i (the one before stays under it while it fades in), and starts its clip from the first frame. */
    const activate = (i: number, instant: boolean): void => {
      const old = index;
      if (previous >= 0 && previous !== i) frames[previous]?.classList.remove('is-prev');
      if (!instant && old !== i) {
        frames[old]?.classList.replace('is-active', 'is-prev');
        previous = old;
        after(FADE_MS + 100, () => {
          if (index === old) return;
          video(old).pause();
          prepared.delete(old);
          prepare(old);
        });
      } else {
        frames[old]?.classList.remove('is-active');
        previous = -1;
      }
      index = i;
      wall = 0;
      ticks.forEach((_, k) => setTick(k, 0));
      frames[i]?.classList.add('is-active');
      frames[i]?.classList.remove('is-prev');
      load(i);
      start(i);
      load(nextSlide(i, frames.length));
    };

    const tick = (now: number): void => {
      raf = 0;
      if (stopped || !running) return;
      wall += last ? Math.min(now - last, 250) : 0;
      last = now;
      const v = video(index);
      const playing = playingNow(v);
      const p = slideProgress({ clipPlaying: playing, clipTime: v.currentTime, clipLength: Number.isFinite(v.duration) ? v.duration : 0, wallMs: wall, slideMs: HERO_SECONDS * 1000 });
      setTick(index, p.fraction);
      if (p.over) activate(nextSlide(index, frames.length), false);
      raf = win.requestAnimationFrame(tick);
    };

    const update = (): void => {
      const go = taken && reelShouldRun({ ready, hidden: doc.hidden, inView });
      if (go && !running) {
        running = true;
        last = 0;
        resume(index);
        raf = win.requestAnimationFrame(tick);
      } else if (!go && running) {
        running = false;
        if (raf) win.cancelAnimationFrame(raf);
        raf = 0;
        for (const v of vids) if (!v.paused) v.pause();
      }
      // The first clip is fetched once the page has loaded, and only for a reel that is on the screen.
      if (!begun && !taken && reelShouldRun({ ready, hidden: doc.hidden, inView })) {
        begun = true;
        const first = visibleIndex();
        after(0, () => load(first));
      }
    };

    /** The first clip is here: the reel's fades are the script's from now on. */
    const takeOver = (): void => {
      if (taken || stopped) return;
      taken = true;
      reel.dataset.reel = 'clips';
      activate(visibleIndex(), true);
      update();
    };

    const io = new Observer((entries) => {
      for (const e of entries) inView = e.isIntersecting && e.intersectionRatio >= IN_VIEW;
      update();
    }, { threshold: [0, IN_VIEW] });
    io.observe(reel);

    vids.forEach((v, i) => {
      on(v, 'canplay', () => {
        if (!taken) { takeOver(); return; }
        if (i === index) { if (running && v.paused) start(i); } else prepare(i);
      });
      on(v, 'error', () => {
        failed.add(i);
        prepared.delete(i);
        v.classList.remove('is-on');
        v.removeAttribute('src');
      });
    });
    on(doc, 'visibilitychange', update);
    // After the load, and a moment on: the page's own work first.
    const whenIdle = (): void => {
      const go = (): void => { if (stopped) return; ready = true; update(); };
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(go, { timeout: 1500 });
      else after(300, go);
    };
    if (ready) { ready = false; whenIdle(); } else on(win, 'load', whenIdle);

    return () => {
      stopped = true;
      io.disconnect();
      for (const off of offs) off();
      for (const t of timers) win.clearTimeout(t);
      timers.clear();
      if (raf) win.cancelAnimationFrame(raf);
      delete reel.dataset.reel;
      frames.forEach((f) => f.classList.remove('is-active', 'is-prev'));
      ticks.forEach((t) => t.style.removeProperty('--p'));
      for (const v of vids) {
        v.classList.remove('is-on');
        if (!v.getAttribute('src')) continue;
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    };
  }
}
