// Moves the "how it works" scene at the top of the home page (views/how.ts, src/how.ts): every frame both pictures are drawn from the
// same moment of the loop, so the character squats exactly when the person does. It starts from the still (the bottom of the squat)
// once the page has loaded, runs while a quarter of the scene is on the screen and the tab is in front, and pauses otherwise. The same
// switches as the moving tiles keep the still: reduced motion, saving data, 2G, a crawler or a script (tests can ask for it). Browser only.
import { clipsAllowed, type ClipConnection } from '../clips.ts';
import { framePoints, HOW_LOOP, HOW_STILL, moverShapes, personShapes, type Shape } from '../how.ts';
import type { TileClipsEnv } from './tile-clips.ts';

/** Sets the moving attributes of the drawn shapes (the markup's data-g elements, in the same order as the shapes). */
function paint(els: readonly Element[], shapes: readonly Shape[]): void {
  for (let i = 0; i < shapes.length && i < els.length; i += 1) {
    const el = els[i]!;
    for (const [k, v] of Object.entries(shapes[i]!.geo)) el.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v);
  }
}

export function startHowScene(root: ParentNode, env: TileClipsEnv): () => void {
  const scene = root.querySelector<HTMLElement>('[data-how]');
  if (!scene) return () => undefined;
  const win = env.win;
  const connection = (win.navigator as Navigator & { connection?: ClipConnection }).connection;
  if (!clipsAllowed({ reducedMotion: env.reducedMotion, connection, automated: env.automated, forced: env.forced === true })) return () => undefined;
  const person = [...scene.querySelectorAll('[data-how-person] [data-g]')];
  const mover = [...scene.querySelectorAll('[data-how-mover] [data-g]')];
  const rep = scene.querySelector<HTMLElement>('.k-how-rep');
  const Observer = (win as Window & typeof globalThis).IntersectionObserver;
  if (person.length === 0 || mover.length === 0 || typeof Observer !== 'function') return () => undefined;

  const doc = win.document;
  let ready = doc.readyState === 'complete';
  let inView = false;
  let stopped = false;
  let raf = 0;
  /** Where the loop is, in frames, and the clock time it was there. */
  let at = HOW_STILL;
  let last: number | null = null;
  const n = HOW_LOOP.frames;

  const frame = (now: number): void => {
    raf = 0;
    if (stopped || !running()) { last = null; return; }
    const before = at;
    if (last !== null) at += ((now - last) / 1000) * HOW_LOOP.fps;
    last = now;
    const pts = framePoints(at);
    paint(person, personShapes(pts));
    paint(mover, moverShapes(pts));
    // the game counts the squat at its bottom: a "+1" rises over the character
    const crossed = Math.floor((before - HOW_STILL) / n) !== Math.floor((at - HOW_STILL) / n);
    if (crossed && rep) { rep.classList.remove('is-on'); void rep.offsetWidth; rep.classList.add('is-on'); }
    raf = win.requestAnimationFrame(frame);
  };
  const running = (): boolean => ready && !doc.hidden && inView;
  const update = (): void => {
    if (stopped) return;
    if (running()) { if (!raf) raf = win.requestAnimationFrame(frame); scene.setAttribute('data-how-live', ''); }
    else { if (raf) win.cancelAnimationFrame(raf); raf = 0; last = null; }
  };

  const io = new Observer((entries) => { for (const e of entries) inView = e.isIntersecting && e.intersectionRatio >= 0.25; update(); }, { threshold: [0, 0.25] });
  io.observe(scene);
  const onLoad = (): void => { ready = true; update(); };
  if (!ready) win.addEventListener('load', onLoad);
  doc.addEventListener('visibilitychange', update);
  return () => {
    stopped = true;
    if (raf) win.cancelAnimationFrame(raf);
    io.disconnect();
    win.removeEventListener('load', onLoad);
    doc.removeEventListener('visibilitychange', update);
  };
}
