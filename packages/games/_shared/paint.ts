// Small helpers for 2D scenes that paint their still parts once (a sky, a floor, a glow) into a canvas of their own and
// copy it each frame: one drawImage instead of hundreds of paths, so a phone without a graphics chip only moves pixels.
// Where there is no canvas to paint on off screen (tests in Node) makeLayer gives null and the scene paints straight onto
// the screen, leaving out the fine texture.
import type { Ctx2D } from '../../core/render2d/ctx.ts';

export type Layer = HTMLCanvasElement | OffscreenCanvas;

/** The resolution of a painted layer over CSS pixels: sharp enough for soft skies, at most 1.5 (memory on phones). */
export const layerRatio = (): number => Math.min(1.5, Math.max(1, (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1));

/** A canvas of w x h CSS pixels at `ratio`, with its context scaled to CSS pixels; null where there is none (Node). */
export function makeLayer(w: number, h: number, ratio = layerRatio()): { canvas: Layer; ctx: Ctx2D } | null {
  const W = Math.max(1, Math.round(w * ratio)), H = Math.max(1, Math.round(h * ratio));
  try {
    let canvas: Layer | null = null;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(W, H);
    else if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = W; c.height = H; canvas = c; }
    if (!canvas) return null;
    const ctx = canvas.getContext('2d') as unknown as Ctx2D | null;
    if (!ctx) return null;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { canvas, ctx };
  } catch {
    return null;
  }
}

/** Gives a layer's memory back at once (iOS Safari keeps canvas memory until the element is collected). */
export function dropLayer(l: Layer | null): void {
  if (!l) return;
  l.width = 0;
  l.height = 0;
}

/** A small seeded random stream for painting: the picture is the same every time, and nothing here touches a game's randomness. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** #RRGGBB at an opacity, as a CSS colour. */
export function rgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** A soft round glow (bright core fading to nothing) as a canvas of `size` px, or null where there is no canvas. */
export function glowSprite(color: string, size = 64, core = 0.55): Layer | null {
  const l = makeLayer(size, size, 1);
  if (!l) return null;
  const r = size / 2;
  const g = l.ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, rgba(color, core));
  g.addColorStop(0.35, rgba(color, core * 0.35));
  g.addColorStop(1, rgba(color, 0));
  l.ctx.fillStyle = g;
  l.ctx.fillRect(0, 0, size, size);
  return l.canvas;
}

/** A soft glow straight onto a context (the fallback of glowSprite, and for big one-off glows in a painted layer). */
export function glowAt(c: Ctx2D, x: number, y: number, r: number, color: string, core: number, squash = 1): void {
  c.save();
  c.translate(x, y);
  if (squash !== 1) c.scale(1, squash);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(color, core));
  g.addColorStop(0.4, rgba(color, core * 0.38));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(-r, -r, 2 * r, 2 * r);
  c.restore();
}
