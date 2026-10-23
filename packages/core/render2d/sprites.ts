// Sprites drawn in code (no image downloads): stars, rings, pads, hearts, bolts, arrows, bursts and glowing orbs for
// the 2D games. Each kind is a small path function. A SpriteBank paints a kind once into an offscreen surface at the
// screen's pixel ratio and stamps it with drawImage afterwards, so a game with 40 targets pays for the shapes once
// (a vector path with a glow costs far more than a stamped bitmap). The bank is bounded and gives surfaces back.
import { releaseSurface, type Ctx2D, type Surface, type SurfaceFactory } from './ctx.ts';

export type SpriteKind = 'star' | 'ring' | 'pad' | 'heart' | 'bolt' | 'arrow' | 'burst' | 'orb';
export const SPRITE_KINDS: readonly SpriteKind[] = ['star', 'ring', 'pad', 'heart', 'bolt', 'arrow', 'burst', 'orb'];

export interface SpriteStyle {
  fill: string;
  /** Edge colour, or null for none. */
  stroke: string | null;
  /** Soft light around the shape (bank bitmaps only), or null. */
  glow: string | null;
}

export const DEFAULT_STYLE: SpriteStyle = { fill: '#FFC53A', stroke: 'rgba(20, 15, 39, 0.55)', glow: null };

const TAU = Math.PI * 2;

/** Corners of a regular star: `points` tips, inner radius as a share of the outer. */
export function starPoints(points: number, outer: number, inner: number, rot = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < points * 2; k++) {
    const a = rot - Math.PI / 2 + (k * Math.PI) / points, r = k % 2 ? inner : outer;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** The classic heart curve as a polygon, scaled so that its width is 2 and it is centred. */
export function heartPoints(steps = 32): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    out.push([(16 * Math.sin(t) ** 3) / 16, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 + 0.06]);
  }
  return out;
}

const BOLT: readonly (readonly [number, number])[] = [[0.18, -1], [-0.55, 0.12], [-0.08, 0.12], [-0.3, 1], [0.55, -0.22], [0.08, -0.22], [0.5, -1]].map(([x, y]) => [x!, y!] as const);
const ARROW: readonly (readonly [number, number])[] = [[-0.9, -0.2], [0.1, -0.2], [0.1, -0.7], [0.95, 0], [0.1, 0.7], [0.1, 0.2], [-0.9, 0.2]].map(([x, y]) => [x!, y!] as const);

function poly(ctx: Ctx2D, pts: readonly (readonly [number, number])[], cx: number, cy: number, r: number, cos: number, sin: number): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const px = cx + (x * cos - y * sin) * r, py = cy + (x * sin + y * cos) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

/** Draws one sprite directly (vector). `r` is the radius of the shape's bounding circle in pixels, `rot` in radians. */
export function drawSprite(ctx: Ctx2D, kind: SpriteKind, cx: number, cy: number, r: number, st: SpriteStyle = DEFAULT_STYLE, rot = 0): void {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = st.fill;
  ctx.strokeStyle = st.stroke ?? st.fill;
  ctx.lineWidth = Math.max(1, r * 0.1);
  const finish = (): void => { ctx.fill(); if (st.stroke) ctx.stroke(); };
  switch (kind) {
    case 'star': poly(ctx, starPoints(5, 1, 0.46, 0), cx, cy, r, cos, sin); finish(); break;
    case 'burst': poly(ctx, starPoints(12, 1, 0.62, 0), cx, cy, r, cos, sin); finish(); break;
    case 'heart': poly(ctx, heartPoints(), cx, cy, r, cos, sin); finish(); break;
    case 'bolt': poly(ctx, BOLT, cx, cy, r, cos, sin); finish(); break;
    case 'arrow': poly(ctx, ARROW, cx, cy, r, cos, sin); finish(); break;
    case 'ring':
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, TAU); ctx.strokeStyle = st.fill; ctx.lineWidth = r * 0.24; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, TAU); ctx.fill();
      break;
    case 'pad': {
      const h = r * 0.78, rad = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx - h + rad, cy - h);
      ctx.lineTo(cx + h - rad, cy - h); ctx.quadraticCurveTo(cx + h, cy - h, cx + h, cy - h + rad);
      ctx.lineTo(cx + h, cy + h - rad); ctx.quadraticCurveTo(cx + h, cy + h, cx + h - rad, cy + h);
      ctx.lineTo(cx - h + rad, cy + h); ctx.quadraticCurveTo(cx - h, cy + h, cx - h, cy + h - rad);
      ctx.lineTo(cx - h, cy - h + rad); ctx.quadraticCurveTo(cx - h, cy - h, cx - h + rad, cy - h);
      ctx.closePath();
      finish();
      break;
    }
    case 'orb': {
      const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, st.fill); g.addColorStop(1, st.stroke ?? st.fill);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      break;
    }
  }
}

export interface SpriteBankStats { entries: number; surfaces: number; hits: number; misses: number; evicted: number }

/** Paints sprites once per (kind, size, style, pixel ratio) and stamps them. Bounded: the least recently used is given back first. */
export class SpriteBank {
  private readonly cache = new Map<string, Surface>();
  private hits = 0; private misses = 0; private evicted = 0;
  private readonly factory: SurfaceFactory;
  private readonly dpr: () => number;
  private readonly max: number;

  constructor(factory: SurfaceFactory, dpr: () => number, max = 48) {
    this.factory = factory; this.dpr = dpr; this.max = max;
  }

  /** The margin of a bank bitmap around the shape, as a share of the size, so a glow is not cut off. */
  static readonly PAD = 0.3;

  private key(kind: SpriteKind, size: number, st: SpriteStyle, ratio: number): string {
    return `${kind}|${Math.round(size * 2) / 2}|${st.fill}|${st.stroke ?? ''}|${st.glow ?? ''}|${ratio}`;
  }

  get(kind: SpriteKind, size: number, st: SpriteStyle = DEFAULT_STYLE): Surface {
    const ratio = this.dpr();
    const k = this.key(kind, size, st, ratio);
    const found = this.cache.get(k);
    if (found) { this.hits++; this.cache.delete(k); this.cache.set(k, found); return found; }
    this.misses++;
    const total = size * (1 + 2 * SpriteBank.PAD);
    const surface = this.factory(Math.ceil(total * ratio), Math.ceil(total * ratio));
    const ctx = surface.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.scale(surface.width / total, surface.height / total);
      if (st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = size * 0.28; }
      drawSprite(ctx, kind, total / 2, total / 2, size / 2, st, 0);
      ctx.restore();
    }
    this.cache.set(k, surface);
    while (this.cache.size > this.max) {
      const oldest = this.cache.keys().next().value as string;
      releaseSurface(this.cache.get(oldest)!);
      this.cache.delete(oldest);
      this.evicted++;
    }
    return surface;
  }

  /** Draws the sprite centred on (x, y), `size` pixels across (the shape's diameter), turned by `rot`. */
  stamp(ctx: Ctx2D, kind: SpriteKind, x: number, y: number, size: number, st: SpriteStyle = DEFAULT_STYLE, o: { rot?: number; alpha?: number } = {}): void {
    const surface = this.get(kind, size, st);
    const total = size * (1 + 2 * SpriteBank.PAD);
    const alpha = o.alpha ?? 1;
    if (alpha <= 0) return;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    if (o.rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(o.rot);
      ctx.drawImage(surface as unknown as CanvasImageSource, -total / 2, -total / 2, total, total);
      ctx.restore();
    } else {
      ctx.drawImage(surface as unknown as CanvasImageSource, x - total / 2, y - total / 2, total, total);
    }
    ctx.globalAlpha = prev;
  }

  stats(): SpriteBankStats {
    return { entries: this.cache.size, surfaces: this.cache.size, hits: this.hits, misses: this.misses, evicted: this.evicted };
  }

  /** Gives every surface back (call when the game ends or the pixel ratio changes a lot). */
  clear(): void {
    for (const s of this.cache.values()) releaseSurface(s);
    this.cache.clear();
  }

  dispose(): void { this.clear(); }
}
