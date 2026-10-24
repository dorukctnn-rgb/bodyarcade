// The stage the gate and pose games share (template F): a night corridor that the obstacles come down, with a vanishing point
// above the player. The sky is one gradient (cached per screen size), the floor has rays and lines that run toward the player
// at the pace of the simulation's clock (so a paused game stands still, and reduced motion stands still too), and the stars
// twinkle from the same clock. Flat shapes only, cheap on a phone. No text.
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import type { Rect } from '../../core/render2d/view.ts';
import type { Rng } from '../../core/types/index.ts';
import { sceneUnit } from '../_shared/stage.ts';
import { clamp } from '../_shared/util.ts';

export const NIGHT = { top: '#140F27', mid: '#1A1430', low: '#241C40', floor: '#2A2150', line: '#40366E', wall: '#3B2F6B', hole: '#0B0818' } as const;
export const SUN = '#FFC53A';
export const FLUSH = '#FF4F6E';
export const CHALK = '#F4F2F8';
export const SKY = '#46B4FF';
export const MINT = '#22C383';

/** What a view is given about the screen: its size, the play area, the self view window and the two lanes of local2. */
export interface Geometry { w: number; h: number; play: Rect; pip: Rect | null; lanes: readonly [Rect, Rect] | null }

export interface Star { x: number; y: number; r: number; ph: number }

export function makeStars(rng: Rng, n = 44): Star[] {
  return Array.from({ length: n }, () => ({ x: rng(), y: rng() * 0.6, r: 0.6 + rng() * 1.1, ph: rng() * 6.28 }));
}

export interface Zone {
  /** The lane (or the whole play area) this player has. */
  area: Rect;
  /** Where the avatar's hip stands, one torso length in pixels, and the vanishing point of this lane's corridor. */
  hipX: number;
  hipY: number;
  T: number;
  vx: number;
  vy: number;
  /** Everything of this zone that must not sit under the self view. */
  keep: Rect;
}

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface ZoneOptions {
  /** The avatar's box in torso lengths: half width, the height above the hip and below it. */
  halfW: number;
  above: number;
  below: number;
  /** Where the hip stands as a share of the area's height from the bottom: the feet are `below` under it. */
  baseShare?: number;
  /** The vanishing point's height as a share of the area, from its top. */
  vyShare?: number;
  /** How much bigger than on a phone this screen draws its figures (Stage.unit, sceneUnit): the figure may grow that much. */
  unit?: number;
}

/**
 * Where the avatar of one player stands in an area, out from under the self view when there is room: tries the middle and the
 * sides, and a smaller figure, and at the narrowest stays in the middle (the self view may then cover scenery).
 */
export function zoneIn(area: Rect, pip: Rect | null, o: ZoneOptions): Zone {
  const u = Math.min(area.w, area.h);
  const vy = area.y + area.h * (o.vyShare ?? 0.34);
  // as big as the width gives room for (0.16 of it) and the height allows (the avatar's box with a margin), on a big screen bigger than on a phone's
  let T = clamp(Math.min(area.w * 0.16, area.h / (o.above + o.below + 0.35)), 20, 84 * (o.unit ?? 1));
  const make = (cx: number, t: number): Zone => {
    const footY = area.y + area.h - 0.2 * t;
    const hipY = footY - o.below * t;
    return { area, hipX: cx, hipY, T: t, vx: cx, vy, keep: { x: cx - o.halfW * t, y: hipY - o.above * t, w: 2 * o.halfW * t, h: (o.above + o.below + 0.2) * t } };
  };
  for (let tries = 0; tries < 6; tries++) {
    for (const shift of [0, -0.16, 0.16, -0.28, 0.28]) {
      const cx = area.x + area.w / 2 + shift * area.w;
      if (cx - o.halfW * T < area.x || cx + o.halfW * T > area.x + area.w) continue;
      const z = make(cx, T);
      if (z.keep.y < area.y) continue;
      if (pip && overlaps(z.keep, pip)) continue;
      return z;
    }
    T *= 0.88;
  }
  const t = clamp(u * 0.12, 14, 60);
  return make(area.x + area.w / 2, t);
}

/** The night corridor. `v` is the vanishing point of the lane (or of the whole play area). */
export class Backdrop {
  private sky: CanvasGradient | null = null;
  private key = '';
  private readonly stars: readonly Star[];
  private readonly reducedMotion: boolean;
  constructor(stars: readonly Star[], reducedMotion: boolean) {
    this.stars = stars;
    this.reducedMotion = reducedMotion;
  }

  private gradient(c: Ctx2D, w: number, h: number): CanvasGradient {
    const key = `${w}x${h}`;
    if (!this.sky || key !== this.key) {
      this.key = key;
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, NIGHT.top);
      g.addColorStop(0.5, NIGHT.mid);
      g.addColorStop(1, NIGHT.low);
      this.sky = g;
    }
    return this.sky;
  }

  /** `lanes`: the vanishing point of each corridor and the area it fills (two lanes are clipped to their halves). */
  draw(c: Ctx2D, w: number, h: number, lanes: readonly { x: number; y: number; area: Rect }[], viewT: number, dim = 0): void {
    c.fillStyle = this.gradient(c, w, h);
    c.fillRect(0, 0, w, h);
    c.fillStyle = CHALK;
    const unit = sceneUnit(w, h);
    for (const s of this.stars) {
      c.globalAlpha = (this.reducedMotion ? 0.5 : 0.3 + 0.3 * Math.sin(viewT * 0.8 + s.ph)) * (1 - 0.6 * dim);
      c.fillRect(s.x * w, s.y * h, s.r * unit, s.r * unit);
    }
    c.globalAlpha = 1;
    const phase = this.reducedMotion ? 0 : viewT * 0.45;
    for (const v of lanes) {
      const horizon = v.y + (h - v.y) * 0.16;
      const clip = lanes.length > 1;
      if (clip) { c.save(); c.beginPath(); c.rect(v.area.x, 0, v.area.w, h); c.clip(); }
      c.fillStyle = NIGHT.floor;
      c.globalAlpha = 0.8;
      c.fillRect(0, horizon, w, h - horizon);
      c.globalAlpha = 1;
      c.strokeStyle = NIGHT.line;
      c.lineWidth = 1.5;
      c.globalAlpha = 0.55;
      c.beginPath();
      for (let i = -4; i <= 4; i++) {
        c.moveTo(v.x, horizon);
        c.lineTo(v.x + i * w * 0.26, h);
      }
      for (let j = 0; j < 6; j++) {
        const f = (((j + phase) % 6) + 6) % 6 / 6;
        const y = horizon + (h - horizon) * f * f;
        c.moveTo(0, y);
        c.lineTo(w, y);
      }
      c.stroke();
      c.globalAlpha = 1;
      if (clip) c.restore();
    }
  }
}
