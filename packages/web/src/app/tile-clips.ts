// The moving game tiles of a drawn page (views/tiles.ts tileClip, src/clips.ts): which clip plays, when, and when it stops. Browser only.
//
// A clip has no address in the markup, so nothing is fetched until it is to play: after the page has loaded (the clips never compete
// with the page's own pictures), and then only for a tile on the screen. Every tile on the screen plays, on a desktop as on a phone,
// round and round for as long as it stays there. Off the screen and in a hidden tab they pause. Reduced motion, saving data, a 2G
// connection, a browser that plays neither format, a crawler or a script: the still pictures stay, and no clip is fetched.
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
  failed: boolean;
}

/** On the screen enough to play: a quarter of the tile. */
const IN_VIEW = 0.25;

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
  const clips: Clip[] = videos.map((video) => ({ video, tile: (video.closest('.ba-tile') as HTMLElement | null) ?? video, inView: false, failed: false }));
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
    const play = clipShouldPlay({ ready, hidden: doc.hidden, inView: c.inView, failed: c.failed });
    if (play) {
      load(c);
      if (c.failed) return;
      if (c.video.paused) void c.video.play().catch(() => undefined);
    } else if (!c.video.paused) {
      c.video.pause();
    }
    // A paused clip keeps its last frame (it is off the screen or the tab is hidden, so nobody sees a jump).
  };
  const updateAll = (): void => { for (const c of clips) update(c); };

  const io = new Observer((entries) => {
    for (const e of entries) {
      const c = clips.find((x) => x.tile === e.target);
      if (!c) continue;
      c.inView = e.isIntersecting && e.intersectionRatio >= IN_VIEW;
      update(c);
    }
  }, { threshold: [0, IN_VIEW] });

  for (const c of clips) {
    io.observe(c.tile);
    on(c.video, 'playing', () => { if (!stopped && !c.video.paused) c.video.classList.add('is-on'); });
    // A file that cannot be played: the still stays, and that tile does not try again on this page.
    on(c.video, 'error', () => { c.failed = true; c.video.classList.remove('is-on'); c.video.removeAttribute('src'); });
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
