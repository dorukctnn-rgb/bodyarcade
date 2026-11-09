// The stage the gate and pose games share (template F): a night corridor that the obstacles come down, with a vanishing point
// above the player. The still part (a deep sky with nebulae and stars, a glow at the end of the corridor, two far ranges in
// haze, a floor with perspective lines and neon rails, a vignette) is painted once per screen size and copied each frame;
// the floor lines and the lamp posts run toward the player at the pace of the simulation's clock (so a paused game stands
// still, and reduced motion stands still too), and the stars twinkle from the same clock. Cheap on a phone. No text.
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import type { Rect } from '../../core/render2d/view.ts';
import type { Rng } from '../../core/types/index.ts';
import { sceneUnit } from '../_shared/stage.ts';
import { clamp } from '../_shared/util.ts';
import { dropLayer, glowAt, glowSprite, makeLayer, rgba, seeded, type Layer } from '../_shared/paint.ts';

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

/** The corridor's colours beyond the shared night tokens: the sky, the far ranges, the floor and its neon rails. */
const DEEP = { zenith: '#0A0720', high: '#140E30', horizon: '#33215E', farRange: '#2A1E52', nearRange: '#1B1338', floorTop: '#30245E', floorMid: '#1F1742', floorLow: '#110C24', pole: '#3C3074', vignette: '#05030F' } as const;
const RAIL = '#7C6BFF';
const LAMP = '#B9A8FF';

/** One corridor of the backdrop: its vanishing point and the area it fills (two lanes are clipped to their halves). */
export interface CorridorLane { x: number; y: number; area: Rect }

/** Where a corridor's floor meets its sky. */
const horizonOf = (v: CorridorLane, h: number): number => v.y + (h - v.y) * 0.16;

/**
 * The still part of the corridor: the sky with its glow at the end of the corridor, nebulae and stars, two far ranges in
 * haze, the floor with its perspective lines and neon rails, and a vignette. `lean`: painted straight onto the screen
 * every frame (no off-screen canvas, tests in Node), so the stars and the small lights are left out.
 */
export function paintCorridor(c: Ctx2D, w: number, h: number, lanes: readonly CorridorLane[], lean: boolean): void {
  const unit = sceneUnit(w, h);
  const first = lanes[0];
  const hz0 = first ? horizonOf(first, h) : h * 0.4;
  // the sky
  const sky = c.createLinearGradient(0, 0, 0, hz0);
  sky.addColorStop(0, DEEP.zenith);
  sky.addColorStop(0.55, DEEP.high);
  sky.addColorStop(1, DEEP.horizon);
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  const rand = seeded(0x5eed + Math.round(w) * 7 + Math.round(h));
  // nebulae: wide, faint, in the brand's cool and warm light
  const nebulae: readonly [number, number, number, string, number][] = [[0.18, 0.16, 0.42, SKY, 0.07], [0.78, 0.1, 0.36, '#9B6BFF', 0.08], [0.55, 0.3, 0.3, FLUSH, 0.05]];
  for (const [fx, fy, fr, col, a] of nebulae) glowAt(c, fx * w, fy * hz0 * 1.6, fr * Math.max(w, h), col, a, 0.55);
  if (!lean) {
    // stars: many faint, a few bright with a glow and a cross of light
    const n = Math.min(320, Math.round((w * hz0) / 2600));
    for (let i = 0; i < n; i++) {
      const x = rand() * w, y = Math.pow(rand(), 1.3) * hz0 * 0.94;
      const r = (0.4 + Math.pow(rand(), 3) * 1.1) * unit;
      const t = rand();
      c.globalAlpha = (0.18 + 0.62 * Math.pow(rand(), 2)) * (1 - (y / hz0) * 0.6);
      c.fillStyle = t < 0.12 ? SKY : t < 0.2 ? SUN : CHALK;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 9; i++) {
      const x = rand() * w, y = rand() * hz0 * 0.7, r = (5 + rand() * 7) * unit;
      glowAt(c, x, y, r, i % 3 === 0 ? SKY : CHALK, 0.55);
      c.globalAlpha = 0.5;
      c.strokeStyle = CHALK;
      c.lineWidth = Math.max(0.6, 0.7 * unit);
      c.beginPath();
      c.moveTo(x - r * 0.9, y); c.lineTo(x + r * 0.9, y);
      c.moveTo(x, y - r * 0.9); c.lineTo(x, y + r * 0.9);
      c.stroke();
      c.globalAlpha = 1;
    }
  }
  const ranges: readonly [number, string, number, number][] = [[0.085, DEEP.farRange, 3, 0.35], [0.05, DEEP.nearRange, 11, 0.2]];
  for (const v of lanes) {
    const hz = horizonOf(v, h);
    const deep = h - v.y;
    c.save();
    if (lanes.length > 1) { c.beginPath(); c.rect(v.area.x, 0, v.area.w, h); c.clip(); }
    // the glow at the end of the corridor, behind the ranges
    glowAt(c, v.x, hz, Math.max(w, h) * 0.5, FLUSH, 0.3, 0.42);
    glowAt(c, v.x, hz, Math.max(w, h) * 0.26, SUN, 0.16, 0.5);
    // two ranges along the horizon, the far one paler (haze), each with a rim of the glow
    for (const [height, col, seed, rim] of ranges) {
      const H = deep * height;
      const step = lean ? 32 : 6;
      c.beginPath();
      c.moveTo(0, hz + 1);
      for (let x = 0; x <= w + step; x += step) {
        const u = x / w;
        c.lineTo(x, hz - H * (0.45 + 0.3 * Math.sin(u * 7.1 + seed) + 0.17 * Math.sin(u * 17.3 + seed * 2.1) + 0.08 * Math.sin(u * 41 + seed)));
      }
      c.lineTo(w + step, hz + 1);
      c.closePath();
      c.fillStyle = col;
      c.fill();
      c.globalAlpha = rim;
      c.strokeStyle = FLUSH;
      c.lineWidth = Math.max(1, unit);
      c.stroke();
      c.globalAlpha = 1;
    }
    if (!lean) {
      // a few far lights in the near range
      c.fillStyle = SUN;
      for (let i = 0; i < 14; i++) {
        c.globalAlpha = 0.25 + rand() * 0.45;
        c.fillRect(rand() * w, hz - deep * 0.012 * rand() - 1, 1.6 * unit, 1.6 * unit);
      }
      c.globalAlpha = 1;
    }
    // the floor: lit at the far end, dark under the player, with the glow mirrored in it
    const floor = c.createLinearGradient(0, hz, 0, h);
    floor.addColorStop(0, DEEP.floorTop);
    floor.addColorStop(0.3, DEEP.floorMid);
    floor.addColorStop(1, DEEP.floorLow);
    c.fillStyle = floor;
    c.fillRect(0, hz, w, h - hz);
    glowAt(c, v.x, hz, (h - hz) * 1.1, FLUSH, 0.16, 1.4);
    // perspective lines, fading into the distance
    const lines = c.createLinearGradient(0, hz, 0, h);
    lines.addColorStop(0, rgba(NIGHT.line, 0));
    lines.addColorStop(1, rgba('#6E60BE', 0.6));
    c.strokeStyle = lines;
    c.lineWidth = Math.max(1, 1.2 * unit);
    c.beginPath();
    for (let i = -6; i <= 6; i++) {
      if (Math.abs(i) === 2) continue;
      c.moveTo(v.x, hz);
      c.lineTo(v.x + i * w * 0.26, h);
    }
    c.stroke();
    // neon rails along the corridor: a wide soft stroke under a thin bright one
    const rail = c.createLinearGradient(0, hz, 0, h);
    rail.addColorStop(0, rgba(RAIL, 0));
    rail.addColorStop(0.25, rgba(RAIL, 0.5));
    rail.addColorStop(1, rgba(RAIL, 0.95));
    for (const [width, a] of [[7, 0.22], [2, 1]] as const) {
      c.globalAlpha = a;
      c.strokeStyle = rail;
      c.lineWidth = width * unit;
      c.beginPath();
      for (const s of [-2, 2]) { c.moveTo(v.x, hz); c.lineTo(v.x + s * w * 0.26, h); }
      c.stroke();
    }
    c.globalAlpha = 1;
    // haze where the floor meets the sky
    const top = hz - deep * 0.05, tall = deep * 0.13;
    const haze = c.createLinearGradient(0, top, 0, top + tall);
    haze.addColorStop(0, rgba('#4A3080', 0));
    haze.addColorStop(0.45, rgba('#4A3080', 0.5));
    haze.addColorStop(1, rgba('#4A3080', 0));
    c.fillStyle = haze;
    c.fillRect(0, top, w, tall);
    c.restore();
  }
  // a vignette, so the eye stays in the middle
  const R = Math.hypot(w, h) / 2;
  const vg = c.createRadialGradient(w / 2, h * 0.5, R * 0.45, w / 2, h * 0.5, R);
  vg.addColorStop(0, rgba(DEEP.vignette, 0));
  vg.addColorStop(1, rgba(DEEP.vignette, 0.55));
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
}

/**
 * The night corridor. The still part is painted once per screen size (paintCorridor) and copied each frame; over it the
 * stars twinkle, the floor lines run toward the player and lamp posts pass on both sides, all at the pace of the
 * simulation's clock (a paused game stands still, and reduced motion stands still too).
 */
export class Backdrop {
  private layer: Layer | null = null;
  private key = '';
  private lamp: Layer | null = null;
  private lampTried = false;
  private readonly stars: readonly Star[];
  private readonly reducedMotion: boolean;
  constructor(stars: readonly Star[], reducedMotion: boolean) {
    this.stars = stars;
    this.reducedMotion = reducedMotion;
  }

  /** `lanes`: the vanishing point of each corridor and the area it fills (two lanes are clipped to their halves). */
  draw(c: Ctx2D, w: number, h: number, lanes: readonly CorridorLane[], viewT: number, dim = 0): void {
    const key = `${Math.round(w)}x${Math.round(h)}|${lanes.map((v) => `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.area.x)},${Math.round(v.area.w)}`).join(';')}`;
    if (key !== this.key) {
      this.key = key;
      dropLayer(this.layer);
      const l = makeLayer(w, h);
      if (l) paintCorridor(l.ctx, w, h, lanes, false);
      this.layer = l ? l.canvas : null;
    }
    if (this.layer) c.drawImage(this.layer, 0, 0, w, h);
    else paintCorridor(c, w, h, lanes, true);
    if (!this.lampTried) { this.lampTried = true; this.lamp = glowSprite(LAMP, 64, 0.85); }

    const unit = sceneUnit(w, h);
    c.fillStyle = CHALK;
    for (const s of this.stars) {
      c.globalAlpha = (this.reducedMotion ? 0.5 : 0.3 + 0.35 * Math.sin(viewT * 0.8 + s.ph)) * (1 - 0.6 * dim);
      c.fillRect(s.x * w, s.y * h * 0.8, s.r * unit, s.r * unit);
    }
    c.globalAlpha = 1;
    const phase = this.reducedMotion ? 0 : viewT * 0.45;
    for (const v of lanes) {
      const hz = horizonOf(v, h);
      const clip = lanes.length > 1;
      if (clip) { c.save(); c.beginPath(); c.rect(v.area.x, 0, v.area.w, h); c.clip(); }
      // floor lines running toward the player, brighter as they come near
      c.strokeStyle = '#6E60BE';
      for (let j = 0; j < 7; j++) {
        const f = ((((j + phase) % 7) + 7) % 7) / 7;
        const y = hz + (h - hz) * f * f;
        c.globalAlpha = (0.12 + 0.5 * f) * (1 - 0.5 * dim);
        c.lineWidth = Math.max(1, (0.8 + 1.6 * f) * unit);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
      // lamp posts on both sides of the corridor, coming toward the player
      for (let j = 0; j < 4; j++) {
        const f = ((((j + phase * 0.5) % 4) + 4) % 4) / 4;
        const d = f * f;
        if (d < 0.015) continue;
        const fadeIn = Math.min(1, (d - 0.015) * 14) * (1 - 0.6 * dim);
        const baseY = hz + (h - hz) * d;
        const tall = (h - v.y) * 0.62 * d;
        for (const side of [-1, 1]) {
          const x = v.x + side * w * 0.26 * 2.6 * d;
          const lx = x - side * tall * 0.12, ly = baseY - tall;
          c.globalAlpha = 0.9 * fadeIn;
          c.strokeStyle = DEEP.pole;
          c.lineWidth = Math.max(1, 5 * d * unit);
          c.beginPath();
          c.moveTo(x, baseY);
          c.lineTo(x, ly);
          c.lineTo(lx, ly);
          c.stroke();
          const g = Math.max(6, 120 * d * unit);
          c.globalAlpha = fadeIn;
          if (this.lamp) c.drawImage(this.lamp, lx - g / 2, ly - g / 2, g, g);
          else { c.fillStyle = LAMP; c.fillRect(lx - 2, ly - 2, 4, 4); }
          // the pool of light on the floor under the lamp
          c.globalAlpha = 0.16 * fadeIn;
          c.fillStyle = '#9C8BFF';
          c.beginPath();
          c.ellipse(lx, baseY, g * 0.55, g * 0.12, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.globalAlpha = 1;
      if (clip) c.restore();
    }
  }

  /** Gives the painted layer back (a view that is done). */
  dispose(): void {
    dropLayer(this.layer);
    dropLayer(this.lamp);
    this.layer = null;
    this.lamp = null;
    this.lampTried = false;
    this.key = '';
  }
}

