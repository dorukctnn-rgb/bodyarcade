// The moving game tiles of a drawn page (views/tiles.ts tileClip, src/clips.ts): which clip plays, when, and when it stops. Browser only.
//
// A clip has no address in the markup, so nothing is fetched until it is to play: after the page has loaded (the clips never compete
// with the page's own pictures), and then only for a tile on the screen. With a mouse the tile under the pointer or with the keyboard
// focus plays; on a touch screen every tile on the screen plays. Off the screen and in a hidden tab they pause. Reduced motion, saving
// data, a 2G connection, a browser that plays neither format, a crawler or a script: the still pictures stay, and no clip is fetched.
import { clipShouldPlay, clipsAllowed, parseClipSet, pickClip, pickFormat, type ClipConnection, type ClipFormat } from '../clips.ts';

export interface TileClipsEnv {
  win: Window;
  /** The player's motion setting with the system's preference (App.reducedMotion). */
  reducedMotion: boolean;
  /** A crawler, or a browser driven by a script (welcome-model.ts isAutomated). */
  automated: boolean;
  /** Tests: the clips play in a scripted browser too. */
  forced?: boolean;
}

interface Clip {
  video: HTMLVideoElement;
  tile: HTMLElement;
  inView: boolean;
  engaged: boolean;
  failed: boolean;
}

/** Visible enough to play on a touch screen: half of the tile. */
const IN_VIEW = 0.5;

/** Starts the clips of the tiles under `root`; the function it returns stops them, lets their files go and removes every listener. */
export function startTileClips(root: ParentNode, env: TileClipsEnv): () => void {
  const { win } = env;
  const doc = win.document;
  const videos = [...root.querySelectorAll<HTMLVideoElement>('video.clip[data-webm][data-mp4]')];
  if (videos.length === 0) return () => undefined;
  const connection = (win.navigator as Navigator & { connection?: ClipConnection }).connection;
  if (!clipsAllowed({ reducedMotion: env.reducedMotion, connection, automated: env.automated, forced: env.forced === true })) return () => undefined;
  const format: ClipFormat | null = pickFormat((type) => videos[0]?.canPlayType(type) ?? '');
  const Observer = (win as Window & typeof globalThis).IntersectionObserver;
  if (!format || typeof Observer !== 'function') return () => undefined;
  const hoverDevice = win.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;

  const clips: Clip[] = videos.map((video) => ({ video, tile: (video.closest('.ba-tile') as HTMLElement | null) ?? video, inView: false, engaged: false, failed: false }));
  const offs: (() => void)[] = [];
  const on = (target: EventTarget, type: string, fn: (e: Event) => void): void => { target.addEventListener(type, fn); offs.push(() => target.removeEventListener(type, fn)); };
  let ready = doc.readyState === 'complete';
  let stopped = false;

  const load = (c: Clip): void => {
    if (c.video.getAttribute('src')) return;
    const set = parseClipSet(c.video.dataset[format] ?? '');
    const width = c.video.getBoundingClientRect().width || c.tile.getBoundingClientRect().width;
    const url = pickClip(set, width, win.devicePixelRatio || 1);
    if (!url) { c.failed = true; return; }
    c.video.muted = true;
    c.video.defaultMuted = true;
    c.video.preload = 'auto';
    c.video.src = url;
  };

  const update = (c: Clip): void => {
    if (stopped) return;
    const play = clipShouldPlay({ ready, hidden: doc.hidden, inView: c.inView, hoverDevice, engaged: c.engaged, failed: c.failed });
    if (play) {
      load(c);
      if (c.failed) return;
      if (c.video.paused) void c.video.play().catch(() => undefined);
    } else if (!c.video.paused) {
      c.video.pause();
    }
    // With a mouse the still comes back when the pointer leaves; on a touch screen the clip keeps its last frame.
    if (!play && hoverDevice) c.video.classList.remove('is-on');
  };
  const updateAll = (): void => { for (const c of clips) update(c); };

  const io = new Observer((entries) => {
    for (const e of entries) {
      const c = clips.find((x) => x.tile === e.target);
      if (!c) continue;
      c.inView = hoverDevice ? e.isIntersecting : e.isIntersecting && e.intersectionRatio >= IN_VIEW;
      update(c);
    }
  }, { threshold: [0, IN_VIEW] });

  for (const c of clips) {
    io.observe(c.tile);
    on(c.video, 'playing', () => { if (!stopped && !c.video.paused) c.video.classList.add('is-on'); });
    // A file that cannot be played: the still stays, and that tile does not try again on this page.
    on(c.video, 'error', () => { c.failed = true; c.video.classList.remove('is-on'); c.video.removeAttribute('src'); });
    if (hoverDevice) {
      const engage = (v: boolean) => (): void => { c.engaged = v || c.tile.contains(doc.activeElement); update(c); };
      on(c.tile, 'pointerenter', engage(true));
      on(c.tile, 'pointerleave', engage(false));
      on(c.tile, 'focusin', engage(true));
      on(c.tile, 'focusout', () => { c.engaged = c.tile.matches(':hover'); update(c); });
    }
  }
  on(doc, 'visibilitychange', updateAll);
  if (!ready) on(win, 'load', () => { ready = true; updateAll(); });

  return () => {
    stopped = true;
    io.disconnect();
    for (const off of offs) off();
    for (const c of clips) {
      if (!c.video.getAttribute('src')) continue;
      c.video.pause();
      c.video.removeAttribute('src');
      c.video.load();
    }
  };
}
