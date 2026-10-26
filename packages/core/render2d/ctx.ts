// The part of the 2D canvas context the kit uses. CanvasRenderingContext2D (and OffscreenCanvasRenderingContext2D)
// have all of it; tests pass a recorder with the same shape, so drawing code runs in Node.
export type Ctx2D = Pick<CanvasRenderingContext2D,
  | 'save' | 'restore' | 'beginPath' | 'closePath' | 'moveTo' | 'lineTo' | 'arc' | 'ellipse' | 'rect' | 'quadraticCurveTo' | 'bezierCurveTo'
  | 'fill' | 'stroke' | 'clip' | 'fillRect' | 'strokeRect' | 'clearRect'
  | 'drawImage' | 'translate' | 'rotate' | 'scale' | 'setTransform' | 'createLinearGradient' | 'createRadialGradient'
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'globalAlpha' | 'globalCompositeOperation' | 'shadowBlur' | 'shadowColor' | 'imageSmoothingEnabled'>;

/** Makes a drawing surface of a size (an offscreen canvas for sprites and layers). Tests pass a fake. */
export interface Surface { width: number; height: number; getContext(kind: '2d'): Ctx2D | null }
export type SurfaceFactory = (width: number, height: number) => Surface;

/** The browser's factory: an HTMLCanvasElement (OffscreenCanvas does not exist on every phone browser we support). */
export const domSurface: SurfaceFactory = (width, height) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c as unknown as Surface;
};

/** Gives a surface's memory back at once (iOS Safari keeps canvas memory until the element is collected). */
export function releaseSurface(s: Surface): void {
  s.width = 0;
  s.height = 0;
}
