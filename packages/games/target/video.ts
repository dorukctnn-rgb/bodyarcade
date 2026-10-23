// The camera picture of a mirror game. The platform's session announces the camera's <video> element (SessionEvents.video);
// the shell hands it to the 2D scene it made for the round with `setMirrorVideo(kit, element)` and the game's view draws
// it as the scene. The picture is kept per scene (a WeakMap), so two rounds or two tests never share one, and a scene that
// is thrown away takes its picture with it.
import type { Scene2D } from '../../core/types/index.ts';
import type { Scene2DKit } from '../../core/render2d/scene2d.ts';

const sources = new WeakMap<object, CanvasImageSource>();

/** Gives the scene its camera picture (a <video> element), or takes it away again (null: the camera was released). */
export function setMirrorVideo(scene: object, source: CanvasImageSource | null): void {
  if (source) sources.set(scene, source);
  else sources.delete(scene);
}

export const mirrorVideoOf = (scene: object): CanvasImageSource | null => sources.get(scene) ?? null;

/** True when `s` is the platform's 2D kit (the contract's Scene2D has fewer parts, a test's has none of these). */
export function isScene2DKit(s: Scene2D | null | undefined): s is Scene2DKit {
  return !!s && typeof s === 'object' && 'rects' in s && 'particles' in s && typeof (s as { begin?: unknown }).begin === 'function';
}

interface Sized { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number; readyState?: number }

/** The picture's own size in pixels, so its aspect is kept; null when it has none yet. */
export function videoSizeOf(source: CanvasImageSource | null): { w: number; h: number } | null {
  if (!source) return null;
  const s = source as unknown as Sized;
  const w = s.videoWidth || s.naturalWidth || (typeof s.width === 'number' ? s.width : 0);
  const h = s.videoHeight || s.naturalHeight || (typeof s.height === 'number' ? s.height : 0);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** The source when it has a frame to draw (a <video> that has not started has none), otherwise null. */
export function readyVideo(source: CanvasImageSource | null): CanvasImageSource | null {
  if (!source) return null;
  const s = source as unknown as Sized;
  if (typeof s.readyState === 'number' && s.readyState < 2) return null;
  return source;
}
