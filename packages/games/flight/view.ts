// Squat Flap on a 2D canvas (design/art, LAYOUT.md section 5: flight template, self view in the bottom right corner over
// the ground band). The picture is a function of the simulation state and nothing else: it holds no game rules, reads
// no clock (its animation time is the simulation's), draws its effects with the 'fx' random stream, and gives back
// everything it made on dispose().
//   world y (0 top .. 1 bottom of the play area) -> pixels: lane.y + y * lane.h
//   world x (along the course)                   -> pixels: birdX + (x - scroll) * sx, with sx = min(lane.h, lane.w / 1.6)
// On a phone held upright the course is squeezed sideways (sx under lane.h) so that a column is in sight long enough to
// react to; the bird is drawn as a circle and its picture is larger than its hit box, on purpose.
// The world behind the columns (sky, ranges, clouds, hills, bushes, the ground) is painted by scenery.ts.
import type { Rng } from '../../core/types/index.ts';
import { roundedRectPath } from '../../core/render2d/pip.ts';
import { clamp } from '../kit-g1/index.ts';
import { canvasFont } from '../kit-g1/font.ts';
import { createPipPainter } from '../kit-g1/pip.ts';
import type { SelfView } from '../kit-g1/selfview.ts';
import type { Say } from '../kit-g1/say.ts';
import type { Rect, Stage } from '../kit-g1/stage.ts';
import { BIOMES, BIRD, BIRD_P2, biomeAt, type Biome } from './content.ts';
import { createScenery, envOf, fade, mix } from './scenery.ts';
import { gapCentre, levelFor, timeLeft, WORLD, type FlightEvent, type FlightState, type LaneState } from './sim.ts';

export interface FlightFrame {
  s: Readonly<FlightState>;
  /** Interpolated between the last two steps. */
  scroll: number;
  y: readonly number[];
  /** What happened since the last drawn frame. */
  fx: readonly FlightEvent[];
  /** Simulation seconds since the last drawn frame (0 when nothing has been stepped). */
  dt: number;
  /** The simulation's clock, for animation. */
  time: number;
  /** The reason sentence on show for each lane, or null. */
  reasons: readonly (string | null)[];
  /** What the player is told to do in the warm-up: keys, touch, arms or squat. */
  how: 'squat' | 'arms' | 'keys' | 'touch';
}

export interface FlightView {
  render(f: FlightFrame): void;
  /** Where the bird of a lane was drawn in the last frame (CSS pixels), for the overlap checks. */
  birdAt(lane: number): { x: number; y: number; r: number } | null;
  dispose(): void;
}

export interface FlightViewOptions {
  stage: Stage;
  self: SelfView;
  say: Say;
  /** The 'fx' stream. */
  rng: Rng;
  reducedMotion: boolean;
  players: 1 | 2;
}

interface Pop { text: string; x: number; y: number; age: number; life: number; color: string; size: number }
/** A feather shaken loose: it sways and sinks. */
interface Feather { x: number; y: number; vx: number; vy: number; rot: number; vr: number; age: number; life: number; size: number; color: string; sway: number }
/** A ring of air pushed out by a strong wing beat or a clean pass. */
interface Ring { x: number; y: number; age: number; life: number; r0: number; r1: number; color: string; width: number }

const TAU = Math.PI * 2;

/** px per world unit along the course, for a lane. */
export const courseScale = (lane: Rect): number => Math.min(lane.h, lane.w / 1.6);

/** The bird's picture radius, in pixels. */
export const birdRadius = (lane: Rect): number => Math.max(14, 0.05 * lane.h);

/** A flap at least this strong (a deep squat and a quick rise) gets the big wing beat. */
export const STRONG_FLAP = 0.8;

/** The colours a column derives from its biome's tokens. Made once per biome. */
export interface Look { colRim: string; colEdge: string; capRim: string; capShadow: string; joint: string; jointLit: string }

const LOOKS = new Map<Biome['id'], Look>();

export function lookOf(b: Biome): Look {
  let l = LOOKS.get(b.id);
  if (l) return l;
  const p = b.pipe;
  l = {
    colRim: mix(p.body, p.shade, 0.6),
    colEdge: mix(p.shade, b.ground, 0.28),
    capRim: mix(p.cap, p.capShade, 0.7),
    capShadow: mix(p.shade, b.ground, 0.35, 0.55),
    joint: mix(p.shade, b.ground, 0.3, 0.55),
    jointLit: fade(p.lit, 0.7),
  };
  LOOKS.set(b.id, l);
  return l;
}

const ease = (u: number): number => 1 - (1 - u) * (1 - u);
const easeInOut = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

/** The wing's angle (radians, up positive) and spread for a lane: a quick downstroke after a flap, the recovery, then
 *  spread flat in a glide, lifted when falling. */
export function wingPose(l: Pick<LaneState, 'sinceFlap' | 'glide' | 'vy'>, time: number): { angle: number; spread: number; fold: number } {
  const t = l.sinceFlap;
  if (t < 0.09) return { angle: 1.05 - 1.95 * ease(t / 0.09), spread: 1, fold: 1 };
  if (t < 0.34) { const u = easeInOut((t - 0.09) / 0.25); return { angle: -0.9 + 1.05 * u, spread: 1 - 0.15 * Math.sin(Math.PI * u), fold: 1 - 0.25 * Math.sin(Math.PI * u) }; }
  if (l.glide > 0.5) return { angle: -0.06 + Math.sin(time * 2.2) * 0.03, spread: 1.18, fold: 1 };
  if (l.vy > 0.1) return { angle: 0.45 + Math.sin(time * 16) * 0.12, spread: 0.92, fold: 0.95 };
  return { angle: 0.15 + Math.sin(time * 5) * 0.05, spread: 1, fold: 1 };
}

export function createFlightView(o: FlightViewOptions): FlightView {
  const { stage, say } = o;
  const ctx = stage.ctx;
  let font = canvasFont();
  const pip = createPipPainter();
  const gradients = new Map<string, CanvasGradient>();
  const scenery = createScenery({ reducedMotion: o.reducedMotion });
  const pops: Pop[] = [];
  const feathers: Feather[] = [];
  const rings: Ring[] = [];
  /** The last places of each bird along the course (scroll and y), for the trail of a streak. */
  const trails: { s: number; y: number }[][] = [[], []];
  const birds: ({ x: number; y: number; r: number } | null)[] = [null, null];
  let shake = 0;
  let flash = [0, 0];
  /** 0..1 glow around the bird after a strong flap, per lane. */
  let power = [0, 0];
  let disposed = false;

  const grad = (key: string, make: () => CanvasGradient): CanvasGradient => {
    let g = gradients.get(key);
    if (!g) { g = make(); gradients.set(key, g); if (gradients.size > 48) gradients.delete(gradients.keys().next().value as string); }
    return g;
  };

  function text(str: string, x: number, y: number, px: number, color: string, o2: { weight?: number; align?: CanvasTextAlign; alpha?: number; baseline?: CanvasTextBaseline } = {}): void {
    ctx.font = `${o2.weight ?? 800} ${Math.round(px)}px ${font}`;
    ctx.textAlign = o2.align ?? 'center';
    ctx.textBaseline = o2.baseline ?? 'middle';
    ctx.globalAlpha = o2.alpha ?? 1;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  function plate(cx: number, cy: number, w: number, h: number, alpha = 0.86): void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#1C1433';
    roundedRectPath(ctx, { x: cx - w / 2, y: cy - h / 2, w, h }, Math.min(18, h * 0.22));
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ───────── columns ─────────

  /**
   * A stone column lit from the right side of the sky: a round body (one cached gradient across its width), block joints
   * that move with its end, a cap with its lip in shade, and what the biome leaves on it (snow and icicles, moss, a drift
   * of sand, a lamp line at night).
   */
  function column(b: Biome, L: Look, cx: number, w: number, yFrom: number, yTo: number, capEdge: 'top' | 'bottom', capH: number, moving: boolean, ground: number, time: number): void {
    if (yTo - yFrom < 1) return;
    const p = b.pipe;
    const cw = w * 1.34;
    const cy = capEdge === 'top' ? yTo - capH : yFrom;
    ctx.save();
    ctx.translate(cx - w / 2, 0);
    ctx.fillStyle = grad(`col|${b.id}|${Math.round(w)}`, () => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, L.colEdge);
      g.addColorStop(0.18, p.shade);
      g.addColorStop(0.4, p.body);
      g.addColorStop(0.66, p.lit);
      g.addColorStop(0.82, p.lit);
      g.addColorStop(0.93, p.body);
      g.addColorStop(1, L.colRim);
      return g;
    });
    ctx.fillRect(0, yFrom, w, yTo - yFrom);
    // Block joints, counted from the cap so they travel with a sliding column.
    const block = Math.max(18, w * 0.95);
    const jh = Math.max(1, w * 0.03);
    ctx.fillStyle = L.joint;
    ctx.beginPath();
    if (capEdge === 'bottom') for (let y = cy + capH + block; y < yTo; y += block) ctx.rect(0, y, w, jh);
    else for (let y = cy - block; y > yFrom; y -= block) ctx.rect(0, y, w, jh);
    ctx.fill();
    ctx.fillStyle = L.jointLit;
    ctx.beginPath();
    if (capEdge === 'bottom') for (let y = cy + capH + block; y < yTo; y += block) ctx.rect(w * 0.45, y + jh, w * 0.45, 1);
    else for (let y = cy - block; y > yFrom; y -= block) ctx.rect(w * 0.45, y + jh, w * 0.45, 1);
    ctx.fill();
    // The cap throws a soft shadow on the body under it; the foot of a standing column darkens into the ground.
    if (capEdge === 'bottom') {
      ctx.fillStyle = L.capShadow;
      ctx.fillRect(0, cy + capH, w, Math.min(capH * 0.55, Math.max(0, yTo - cy - capH)));
      const foot = Math.min(w * 0.5, Math.max(0, yTo - cy - capH));
      ctx.fillStyle = grad(`foot|${b.id}|${Math.round(foot)}`, () => {
        const g = ctx.createLinearGradient(0, -foot, 0, 0);
        g.addColorStop(0, 'rgba(12,8,24,0)');
        g.addColorStop(1, 'rgba(12,8,24,0.26)');
        return g;
      });
      ctx.save();
      ctx.translate(0, ground);
      ctx.fillRect(0, -foot, w, foot);
      ctx.restore();
    }
    ctx.translate(-(cw - w) / 2, 0);
    ctx.fillStyle = grad(`cap|${b.id}|${Math.round(cw)}`, () => {
      const g = ctx.createLinearGradient(0, 0, cw, 0);
      g.addColorStop(0, L.colEdge);
      g.addColorStop(0.16, p.capShade);
      g.addColorStop(0.5, p.cap);
      g.addColorStop(0.9, p.cap);
      g.addColorStop(1, L.capRim);
      return g;
    });
    roundedRectPath(ctx, { x: 0, y: cy, w: cw, h: capH }, capH * 0.4);
    ctx.fill();
    // The lower lip of the cap in its own shade, a lit bevel along its top.
    ctx.fillStyle = p.capShade;
    ctx.fillRect(capH * 0.3, cy + capH * 0.78, cw - capH * 0.6, capH * 0.14);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(capH * 0.4, cy + capH * 0.12, cw - capH * 0.8, Math.max(1, capH * 0.08));
    if (moving) {
      ctx.fillStyle = '#FF4F6E';
      ctx.fillRect(capH * 0.3, cy + capH * 0.42, cw - capH * 0.6, Math.max(2, capH * 0.16));
    }
    dressing(b, cw, cy, capH, capEdge, time);
    ctx.restore();
  }

  /** What the biome leaves on a cap (in the cap's own coordinates: x from 0 to cw). */
  function dressing(b: Biome, cw: number, cy: number, capH: number, capEdge: 'top' | 'bottom', time: number): void {
    if (b.id === 'ice') {
      if (capEdge === 'bottom') {
        // A pillow of snow on the cap.
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(-capH * 0.1, cy + capH * 0.25);
        ctx.quadraticCurveTo(cw * 0.15, cy - capH * 0.55, cw * 0.5, cy - capH * 0.4);
        ctx.quadraticCurveTo(cw * 0.85, cy - capH * 0.6, cw + capH * 0.1, cy + capH * 0.25);
        ctx.quadraticCurveTo(cw * 0.5, cy + capH * 0.05, -capH * 0.1, cy + capH * 0.25);
        ctx.fill();
        ctx.fillStyle = '#D7D2F5';
        ctx.beginPath();
        ctx.moveTo(-capH * 0.1, cy + capH * 0.25);
        ctx.quadraticCurveTo(cw * 0.25, cy - capH * 0.1, cw * 0.4, cy + capH * 0.12);
        ctx.quadraticCurveTo(cw * 0.2, cy + capH * 0.2, -capH * 0.1, cy + capH * 0.25);
        ctx.fill();
      } else {
        // Icicles under a hanging cap.
        ctx.fillStyle = 'rgba(236,244,255,0.92)';
        ctx.beginPath();
        const y = cy + capH * 0.92;
        for (let i = 0; i < 6; i++) {
          const x = cw * (0.12 + i * 0.15), l = capH * (0.5 + ((i * 37) % 5) * 0.22);
          ctx.moveTo(x - capH * 0.14, y);
          ctx.lineTo(x, y + l);
          ctx.lineTo(x + capH * 0.14, y);
        }
        ctx.fill();
      }
    } else if (b.id === 'meadow') {
      // Moss on top of a standing cap, strands under a hanging one.
      ctx.fillStyle = '#4E9A4F';
      ctx.beginPath();
      if (capEdge === 'bottom') {
        ctx.moveTo(0, cy + capH * 0.3);
        for (let i = 0; i <= 8; i++) { const x = (cw * i) / 8; ctx.lineTo(x, cy - capH * (0.1 + ((i * 53) % 7) * 0.05)); }
        ctx.lineTo(cw, cy + capH * 0.3);
        ctx.closePath();
      } else {
        for (let i = 0; i < 5; i++) { const x = cw * (0.15 + i * 0.18); ctx.moveTo(x - 2, cy + capH * 0.8); ctx.lineTo(x, cy + capH * (1.4 + (i % 3) * 0.35)); ctx.lineTo(x + 2, cy + capH * 0.8); }
      }
      ctx.fill();
      if (capEdge === 'bottom') {
        ctx.fillStyle = '#7CC46A';
        ctx.fillRect(cw * 0.5, cy - capH * 0.12, cw * 0.4, Math.max(1, capH * 0.12));
      }
    } else if (b.id === 'dunes') {
      if (capEdge === 'bottom') {
        ctx.fillStyle = '#F4C891';
        ctx.beginPath();
        ctx.moveTo(-capH * 0.05, cy + capH * 0.2);
        ctx.quadraticCurveTo(cw * 0.2, cy - capH * 0.45, cw * 0.55, cy + capH * 0.05);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // A lamp line along the cap, breathing slowly.
      const a = 0.55 + 0.25 * Math.sin(time * 2.1 + cw);
      ctx.fillStyle = `rgba(150,220,255,${(a * 0.35).toFixed(3)})`;
      ctx.fillRect(capH * 0.2, cy + capH * 0.36, cw - capH * 0.4, capH * 0.32);
      ctx.fillStyle = `rgba(200,240,255,${a.toFixed(3)})`;
      ctx.fillRect(capH * 0.35, cy + capH * 0.46, cw - capH * 0.7, Math.max(1.5, capH * 0.12));
    }
  }

  function columns(b: Biome, L: Look, s: Readonly<FlightState>, lane: Rect, region: Rect, scroll: number, sx: number, birdX: number, ground: number, time: number): void {
    const capH = Math.max(10, 0.042 * lane.h);
    const w = Math.max(WORLD.pipeW * sx, 0.05 * lane.h);
    for (const p of s.pipes) {
      const cx = birdX + (p.x - scroll) * sx;
      if (cx + w < region.x - 8 || cx - w > region.x + region.w + 8) continue;
      const c = gapCentre(p, s.active);
      const top = lane.y + (c - p.h / 2) * lane.h;
      const bottom = lane.y + (c + p.h / 2) * lane.h;
      column(b, L, cx, w, region.y - 4, top, 'top', capH, p.amp > 0, ground, time);
      column(b, L, cx, w, bottom, ground + 2, 'bottom', capH, p.amp > 0, ground, time);
    }
  }

  /** Each standing column throws its shadow to the left on the ground (the light is on the right). */
  function columnShadows(s: Readonly<FlightState>, lane: Rect, region: Rect, scroll: number, sx: number, birdX: number, ground: number): void {
    const w = Math.max(WORLD.pipeW * sx, 0.05 * lane.h);
    ctx.fillStyle = 'rgba(12,8,24,0.28)';
    ctx.beginPath();
    for (const p of s.pipes) {
      const cx = birdX + (p.x - scroll) * sx;
      if (cx + w * 2 < region.x || cx - w * 2 > region.x + region.w) continue;
      ctx.moveTo(cx + w * 0.5, ground + 1);
      ctx.lineTo(cx - w * 0.5, ground + 1);
      ctx.lineTo(cx - w * 1.7, ground + Math.max(5, lane.h * 0.014));
      ctx.lineTo(cx - w * 0.2, ground + Math.max(5, lane.h * 0.014));
      ctx.closePath();
    }
    ctx.fill();
  }

  /** The bird's shadow on the ground: dark and wide near it, small and faint high up (its height, at a glance). */
  function birdShadow(x: number, y: number, r: number, ground: number, h: number): void {
    const up = clamp((ground - y) / (h * 0.7), 0, 1);
    ctx.globalAlpha = 0.08 + 0.28 * (1 - up);
    ctx.fillStyle = '#0B0816';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25 * up, ground + Math.max(3, h * 0.006) + r * 0.08, r * (1.15 - 0.55 * up), r * (0.22 - 0.1 * up), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ───────── the bird ─────────

  /** A wing in its own coordinates: the root at the origin, the tip back and up; four primaries fan out at its end. */
  function wingShape(r: number, spread: number, base: string, tip: string, lit: string | null, quill: string | null): void {
    const tipX = -r * 1.25 * spread, tipY = -r * 0.6;
    // Broad at the shoulder, darker toward the feather tips.
    const g = ctx.createLinearGradient(0, 0, tipX, tipY);
    g.addColorStop(0, base);
    g.addColorStop(1, tip);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(r * 0.22, -r * 0.12);
    ctx.quadraticCurveTo(-r * 0.3 * spread, -r * 0.78, tipX, tipY);
    // The trailing edge: rounded feather tips from the tip back to the root.
    const n = 4;
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n;
      const x0 = tipX + (r * 0.1 - tipX) * u0, y0 = tipY + (r * 0.3 - tipY) * u0;
      const x1 = tipX + (r * 0.1 - tipX) * u1, y1 = tipY + (r * 0.3 - tipY) * u1;
      ctx.quadraticCurveTo((x0 + x1) / 2 - r * 0.16, (y0 + y1) / 2 + r * 0.2, x1, y1);
    }
    ctx.quadraticCurveTo(r * 0.3, r * 0.2, r * 0.22, -r * 0.12);
    ctx.closePath();
    ctx.fill();
    if (lit) {
      // The coverts along the leading edge catch the light.
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.1);
      ctx.quadraticCurveTo(-r * 0.28 * spread, -r * 0.7, tipX * 0.7, tipY * 0.9);
      ctx.quadraticCurveTo(-r * 0.35 * spread, -r * 0.3, r * 0.12, r * 0.12);
      ctx.closePath();
      ctx.fill();
    }
    if (quill) {
      ctx.strokeStyle = quill;
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const u = i / 4;
        const x = tipX + (r * 0.1 - tipX) * u, y = tipY + (r * 0.3 - tipY) * u;
        ctx.moveTo(x + r * 0.02, y + r * 0.06);
        ctx.lineTo(x + (tipX * 0.55 - x) * 0.35, y + (tipY * 0.7 - y) * 0.35);
      }
      ctx.stroke();
    }
  }

  function bird(laneNo: number, l: LaneState, x: number, y: number, r: number, vy: number, time: number): void {
    const pal = laneNo === 1 ? BIRD_P2 : BIRD;
    // Stretch on a flap, squash in a glide, a little tilt with the vertical speed.
    const kick = Math.max(0, 1 - l.sinceFlap / 0.3);
    const sy = 1 + 0.14 * kick - 0.08 * l.glide;
    const sxs = 1 - 0.1 * kick + 0.07 * l.glide;
    const tilt = clamp(vy * 0.8, -0.55, 0.6);
    const pose = wingPose(l, time);
    const glowA = power[laneNo] ?? 0;
    if (glowA > 0.02 && !o.reducedMotion) {
      ctx.fillStyle = grad(`halo|${Math.round(r)}`, () => {
        const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.6);
        g.addColorStop(0, 'rgba(255,210,110,0.55)');
        g.addColorStop(1, 'rgba(255,210,110,0)');
        return g;
      });
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = glowA;
      ctx.fillRect(-r * 2.6, -r * 2.6, r * 5.2, r * 5.2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (l.invul > 0 && Math.floor(time * 14) % 2 === 0) ctx.globalAlpha = 0.45;
    const a0 = ctx.globalAlpha;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(sxs, sy);
    const dark = mix(pal.wing, '#000000', 0.25);
    // The far wing, behind the body.
    ctx.save();
    ctx.translate(r * 0.05, -r * 0.3);
    ctx.rotate(pose.angle * 0.85 + 0.12);
    ctx.scale(0.8, pose.fold * 0.88);
    wingShape(r, pose.spread, dark, dark, null, null);
    ctx.restore();
    // Tail: three feathers fanned behind.
    for (const [ang, col] of [[-0.38, pal.wing], [0.32, pal.wing], [0, pal.wingLit]] as const) {
      ctx.save();
      ctx.translate(-r * 0.85, r * 0.08);
      ctx.rotate(ang + Math.sin(time * 6) * 0.04 * (1 - l.glide));
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(-r * 0.42, 0, r * 0.5, r * 0.16, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // Body: an egg lit from the upper right.
    ctx.fillStyle = grad(`body|${laneNo}|${Math.round(r)}`, () => {
      const g = ctx.createRadialGradient(r * 0.3, -r * 0.42, r * 0.08, 0, 0, r * 1.15);
      g.addColorStop(0, mix(pal.body, '#FFFFFF', 0.45));
      g.addColorStop(0.45, pal.body);
      g.addColorStop(1, mix(pal.body, pal.wing, 0.38));
      return g;
    });
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.04, r * 0.97, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.16, r * 0.4, r * 0.64, r * 0.46, -0.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a0 * 0.5;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(r * 0.28, r * 0.3, r * 0.34, r * 0.16, -0.3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a0;
    // A crest of three small feathers.
    ctx.fillStyle = mix(pal.body, pal.wing, 0.3);
    ctx.beginPath();
    for (const [bx, len, lean] of [[-0.05, 0.42, -0.5], [0.12, 0.5, -0.25], [0.28, 0.36, 0.05]] as const) {
      ctx.moveTo(r * (bx - 0.08), -r * 0.86);
      ctx.quadraticCurveTo(r * (bx + lean * 0.4), -r * (0.86 + len * 0.9), r * (bx + lean * 0.8), -r * (0.86 + len));
      ctx.quadraticCurveTo(r * (bx + 0.02), -r * (0.86 + len * 0.4), r * (bx + 0.1), -r * 0.84);
    }
    ctx.fill();
    // Cheek.
    ctx.fillStyle = fade(pal.cheek, 0.55);
    ctx.beginPath();
    ctx.ellipse(r * 0.44, r * 0.1, r * 0.2, r * 0.12, 0, 0, TAU);
    ctx.fill();
    // Beak: the upper and the lower half; it opens on a beat.
    const open = kick * r * 0.14;
    ctx.fillStyle = pal.beak;
    ctx.beginPath();
    ctx.moveTo(r * 0.82, -r * 0.22);
    ctx.quadraticCurveTo(r * 1.3, -r * 0.16, r * 1.52, r * 0.02);
    ctx.lineTo(r * 0.84, r * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mix(pal.beak, '#B4471B', 0.35);
    ctx.beginPath();
    ctx.moveTo(r * 0.84, r * 0.08);
    ctx.lineTo(r * 1.36, r * 0.08 + open * 0.6);
    ctx.quadraticCurveTo(r * 1.0, r * 0.3 + open, r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    // Eye, with its catch-light; half shut and content in a glide.
    ctx.fillStyle = pal.eye;
    ctx.beginPath();
    ctx.ellipse(r * 0.42, -r * 0.3, r * 0.27, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.pupil;
    ctx.beginPath();
    ctx.ellipse(r * 0.5, -r * 0.27, r * 0.14, r * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(r * 0.56, -r * 0.35, r * 0.055, r * 0.055, 0, 0, TAU);
    ctx.fill();
    if (l.glide > 0.5) {
      ctx.fillStyle = mix(pal.body, '#FFFFFF', 0.15);
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 0.3);
      ctx.quadraticCurveTo(r * 0.42, -r * 0.78, r * 0.72, -r * 0.3);
      ctx.quadraticCurveTo(r * 0.42, -r * 0.42, r * 0.12, -r * 0.3);
      ctx.fill();
    }
    // The near wing, over the body.
    ctx.save();
    ctx.translate(-r * 0.22, -r * 0.08);
    ctx.rotate(pose.angle);
    ctx.scale(1, pose.fold);
    wingShape(r, pose.spread, mix(pal.wingLit, pal.body, 0.18), pal.wing, mix(pal.wingLit, '#FFFFFF', 0.2), fade(mix(pal.wing, '#000000', 0.4), 0.55));
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Lines of wind past a bird that climbs fast or glides. */
  function wind(l: LaneState, x: number, y: number, r: number, time: number): void {
    if (o.reducedMotion) return;
    const climb = clamp(-l.vy - 0.4, 0, 1);
    const glide = l.glide > 0.5 ? 0.7 : 0;
    const a = Math.max(climb, glide);
    if (a < 0.05) return;
    ctx.strokeStyle = `rgba(255,255,255,${(0.45 * a).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ph = (time * 3 + i * 0.33) % 1;
      const yy = y + (i - 1) * r * 0.75 + (climb > glide ? r * 0.5 : 0);
      const x0 = x - r * (1.6 + ph * 1.6);
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 - r * (0.6 + 0.8 * (1 - ph)), yy + (climb > glide ? r * 0.35 : 0));
    }
    ctx.stroke();
  }

  /** A trail of sparks behind the bird while a streak of clean passes lasts. */
  function trail(laneNo: number, l: LaneState, scroll: number, sx: number, birdX: number, by: number, r: number): void {
    const t = trails[laneNo]!;
    const last = t[t.length - 1];
    if (!last || Math.abs(scroll - last.s) > 0.012 || Math.abs(by - last.y) > r * 0.4) { t.push({ s: scroll, y: by }); if (t.length > 18) t.shift(); }
    if (l.streak < 3 || o.reducedMotion) return;
    const heat = clamp((l.streak - 2) / 6, 0.3, 1);
    for (let i = 0; i < t.length; i++) {
      const p = t[i]!;
      const x = birdX - (scroll - p.s) * sx - r * 0.6;
      const u = i / t.length;
      ctx.globalAlpha = u * 0.7 * heat;
      ctx.fillStyle = i % 2 ? '#FFC53A' : '#FFF1CC';
      ctx.beginPath();
      ctx.arc(x, p.y, r * (0.08 + u * 0.2), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function lives(lane: Rect, n: number, total: number, accent: string): void {
    const r = Math.max(5, lane.h * 0.012);
    for (let i = 0; i < total; i++) {
      const x = lane.x + r * 2.2 + i * r * 3.3, y = lane.y + r * 2.6;
      ctx.globalAlpha = i < n ? 1 : 0.28;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.8, r * 1.5, 0.6, 0, TAU);
      ctx.fill();
      if (i < n) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.ellipse(x + r * 0.2, y - r * 0.5, r * 0.25, r * 0.55, 0.6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ───────── effects ─────────

  function loose(x: number, y: number, n: number, r: number, colors: readonly string[], speed: number): void {
    if (o.reducedMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n && feathers.length < 60; i++) {
      const a = Math.PI * (0.5 + o.rng() * 1.0);
      const v = speed * (0.4 + o.rng() * 0.8);
      feathers.push({ x, y, vx: Math.cos(a) * v, vy: -Math.abs(Math.sin(a)) * v * 0.6 - 20, rot: o.rng() * TAU, vr: (o.rng() - 0.5) * 6, age: 0, life: 0.9 + o.rng() * 0.8, size: r * (0.18 + o.rng() * 0.14), color: colors[Math.floor(o.rng() * colors.length)] as string, sway: o.rng() * TAU });
    }
  }

  function ring(x: number, y: number, r0: number, r1: number, color: string, life = 0.45, width = 3): void {
    if (o.reducedMotion || rings.length > 12) return;
    rings.push({ x, y, age: 0, life, r0, r1, color, width });
  }

  function effects(dt: number): void {
    for (let i = feathers.length - 1; i >= 0; i--) {
      const f = feathers[i]!;
      f.age += dt;
      if (f.age >= f.life) { feathers.splice(i, 1); continue; }
      f.vx *= Math.max(0, 1 - 2.2 * dt);
      f.vy = f.vy * Math.max(0, 1 - 2.2 * dt) + 70 * dt;
      f.x += (f.vx + Math.sin(f.age * 7 + f.sway) * 22) * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      const u = f.age / f.life;
      ctx.globalAlpha = 1 - u * u;
      ctx.fillStyle = f.color;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot + Math.sin(f.age * 7 + f.sway) * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size, f.size * 0.38, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i]!;
      g.age += dt;
      if (g.age >= g.life) { rings.splice(i, 1); continue; }
      const u = g.age / g.life;
      ctx.globalAlpha = (1 - u) * (1 - u);
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.width * (1 - u * 0.6);
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r0 + (g.r1 - g.r0) * ease(u), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ───────── messages ─────────

  /** Word wrap by measuring. */
  function wrap(str: string, px: number, w: number): string[] {
    const words = str.split(' ');
    let line = '';
    const out: string[] = [];
    ctx.font = `700 ${Math.round(px)}px ${font}`;
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  function lines(cx: number, top: number, w: number, str: string, px: number, color: string): number {
    const out = wrap(str, px, w);
    out.forEach((ln, i) => text(ln, cx, top + i * px * 1.3, px, color, { weight: 700 }));
    return out.length;
  }

  function banner(lane: Rect, f: FlightFrame, laneNo: number): void {
    const s = f.s;
    const l = s.lanes[laneNo] as LaneState;
    const cx = lane.x + lane.w / 2;
    const px = clamp(lane.h * 0.034, 13, 30);
    const w = Math.min(lane.w * 0.9, px * 22);
    if (l.out) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#1C1433';
      ctx.fillRect(lane.x, lane.y, lane.w, lane.h);
      ctx.globalAlpha = 1;
      plate(cx, lane.y + lane.h * 0.42, w, px * 3.4);
      text(say('out.title'), cx, lane.y + lane.h * 0.42, px * 1.35, '#F4F2F8');
      return;
    }
    if (s.phase === 'warmup') {
      const body = say(f.how === 'arms' ? 'warm.seated' : f.how === 'keys' ? 'warm.keys' : f.how === 'touch' ? 'warm.touch' : 'warm.body');
      const h = px * 6.2;
      const cy = lane.y + lane.h * 0.3;
      plate(cx, cy, w, h);
      text(say('warm.title'), cx, cy - h * 0.34, px * 1.15, '#FFC53A');
      lines(cx, cy - h * 0.1, w - px * 1.4, body, px * 0.9, '#F4F2F8');
      // Three dots for the three flaps.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < s.warm.flapTimes.length ? '#22C383' : 'rgba(244,242,248,0.3)';
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * px * 1.5, cy + h * 0.36, px * 0.36, 0, TAU);
        ctx.fill();
      }
      return;
    }
    if (s.phase === 'rest') {
      const plan = s.plan;
      const h = px * 6.6;
      const cy = lane.y + lane.h * 0.3;
      if (s.ready <= 0) plate(cx, cy, w, h);
      if (s.ready > 0) {
        // The command plate says "get ready" already: the panel gives the set, the count and how the course was made.
        const wrapped = wrap(say('ready.body', { sec: s.tempo.toFixed(1) }), px * 0.85, w - px * 1.4);
        const hh = px * (4.3 + wrapped.length * 1.2);
        const top = cy - hh / 2;
        plate(cx, cy, w, hh);
        text(say('set.label', { n: 1, total: plan.sets }), cx, top + px * 0.9, px * 1, '#F4F2F8', { weight: 700 });
        text(String(Math.max(1, Math.ceil(s.ready))), cx, top + px * 2.7, px * 2.2, '#FFC53A');
        lines(cx, top + px * 4.2, w - px * 1.4, say('ready.body', { sec: s.tempo.toFixed(1) }), px * 0.85, '#F4F2F8');
      } else {
        text(say('rest.title'), cx, cy - h * 0.3, px * 1.1, '#FFC53A');
        text(String(Math.ceil(timeLeft(s))), cx, cy + h * 0.02, px * 2.3, '#F4F2F8');
        text(say('rest.next', { n: s.round.set + 1, total: plan.sets }), cx, cy + h * 0.36, px * 0.85, '#F4F2F8', { weight: 700 });
      }
    }
  }

  function setPips(lane: Rect, s: Readonly<FlightState>): void {
    const plan = s.plan;
    if (plan.sets <= 1 || s.phase === 'warmup') return;
    const r = Math.max(4, lane.h * 0.009);
    const cx = lane.x + lane.w / 2;
    for (let i = 0; i < plan.sets; i++) {
      const x = cx + (i - (plan.sets - 1) / 2) * r * 3.4, y = lane.y + r * 2.4;
      ctx.fillStyle = i + 1 < s.round.set || (s.phase === 'complete') ? '#22C383' : i + 1 === s.round.set ? '#FFC53A' : 'rgba(244,242,248,0.4)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }

  // ───────── one lane ─────────

  function drawLane(f: FlightFrame, laneNo: number, lane: Rect, region: Rect): void {
    const s = f.s;
    const l = s.lanes[laneNo] as LaneState;
    const lv = levelFor(s);
    const b = biomeAt(s.round.set, lv.sets === 0, l.passes);
    const sx = courseScale(lane);
    const birdX = lane.x + WORLD.birdAt * lane.w;
    const ground = lane.y + WORLD.floor * lane.h;
    const scrollPx = f.scroll * sx;
    ctx.save();
    if (o.players === 2) { ctx.beginPath(); ctx.rect(region.x, region.y, region.w, region.h); ctx.clip(); }
    if (shake > 0.01 && !o.reducedMotion) ctx.translate((o.rng() - 0.5) * shake * lane.h * 0.03, (o.rng() - 0.5) * shake * lane.h * 0.03);
    const L = lookOf(b);
    const env = envOf(region, lane, ground);
    // Sky, far range, clouds, middle range in its mist, near hills with trees, bushes: each at its own depth.
    scenery.back(ctx, laneNo, b, env, scrollPx, f.time);
    columns(b, L, s, lane, region, f.scroll, sx, birdX, ground, f.time);
    scenery.ground(ctx, laneNo, b, env, scrollPx);
    columnShadows(s, lane, region, f.scroll, sx, birdX, ground);
    scenery.motes(ctx, b, env, scrollPx, f.time);
    const r = birdRadius(lane);
    const by = lane.y + (f.y[laneNo] ?? l.y) * lane.h;
    birds[laneNo] = { x: birdX, y: by, r };
    birdShadow(birdX, by, r, ground, lane.h);
    trail(laneNo, l, f.scroll, sx, birdX, by, r);
    wind(l, birdX, by, r, f.time);
    bird(laneNo, l, birdX, by, r, l.vy, f.time);
    if (!s.duel) lives(lane, l.lives, lv.lives, laneNo === 1 ? '#46B4FF' : '#FF4F6E');
    setPips(lane, s);
    if (flash[laneNo]! > 0.01 && !o.reducedMotion) {
      ctx.globalAlpha = flash[laneNo]! * 0.28;
      ctx.fillStyle = '#FF4F6E';
      ctx.fillRect(region.x, region.y, region.w, region.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function react(f: FlightFrame, lanes: Rect[]): void {
    for (const e of f.fx) {
      if (!('lane' in e)) continue;
      const lane = lanes[e.lane] ?? (lanes[0] as Rect);
      const bx = birds[e.lane]?.x ?? lane.x + WORLD.birdAt * lane.w;
      const by = birds[e.lane]?.y ?? lane.y + lane.h * 0.5;
      const r = birdRadius(lane);
      const pal = e.lane === 1 ? BIRD_P2 : BIRD;
      if (e.type === 'flap') {
        const strong = e.power >= STRONG_FLAP;
        // Air pushed down by the beat, a feather or two; a strong squat beats harder: a ring, a glow and more.
        stage.particles.burst(bx - r * 0.5, by + r * 0.7, strong ? 10 : 5, { speed: [40, strong ? 170 : 110], angle: [Math.PI * 0.3, Math.PI * 0.9], life: [0.3, 0.6], size: [r * 0.1, r * 0.2], gravity: 40, drag: 2.2, colors: ['#FFFFFF', '#F4F2F8', pal.belly], shape: 'dot' });
        loose(bx - r * 0.3, by + r * 0.2, strong ? 4 : 1, r, [pal.body, pal.belly, pal.wingLit], strong ? 120 : 70);
        if (strong) {
          ring(bx, by + r * 0.2, r * 0.9, r * 2.8, 'rgba(255,255,255,0.9)', 0.4, Math.max(2, r * 0.12));
          stage.particles.burst(bx, by, 7, { speed: [80, 200], life: [0.25, 0.5], size: [r * 0.12, r * 0.26], gravity: 0, drag: 3, colors: ['#FFC53A', '#FFF1CC'], shape: 'spark' });
          power[e.lane] = 1;
        }
      } else if (e.type === 'pass') {
        const col = e.centre ? '#FFC53A' : '#F4F2F8';
        stage.particles.burst(bx + r * 0.6, by, e.centre ? 14 : 5, { speed: [60, 210], life: [0.35, 0.85], size: [r * 0.12, r * 0.26], gravity: 120, colors: e.centre ? ['#FFC53A', '#FFF1CC', '#FF4F6E'] : ['#F4F2F8', '#FFC53A'], shape: e.centre ? ['star', 'dot'] : 'dot' });
        if (e.centre) ring(bx, by, r * 1.1, r * 3.4, 'rgba(255,197,58,0.95)', 0.5, Math.max(2, r * 0.14));
        if (e.streak > 0 && e.streak % 5 === 0) {
          ring(bx, by, r * 1.4, r * 5, 'rgba(255,241,204,0.9)', 0.7, Math.max(2, r * 0.18));
          stage.particles.burst(bx, by, 18, { speed: [120, 320], life: [0.5, 1.1], size: [r * 0.14, r * 0.3], gravity: 160, colors: ['#FFC53A', '#FFF1CC', '#FF4F6E', '#46B4FF'], shape: ['star', 'square'] });
        }
        pops.push({ text: `+${e.pts}`, x: bx + r * 1.2, y: by - r * 1.4, age: 0, life: 0.9, color: col, size: clamp(lane.h * (e.centre ? 0.05 : 0.04), 14, 40) });
      } else if (e.type === 'hit') {
        stage.particles.burst(bx, by, 16, { speed: [80, 260], life: [0.4, 0.9], size: [r * 0.14, r * 0.3], gravity: 260, drag: 0.8, colors: ['#FF4F6E', '#F4F2F8', '#1C1433'], shape: ['dot', 'square'] });
        loose(bx, by, 7, r, [pal.body, pal.belly, pal.wing, pal.wingLit], 200);
        ring(bx, by, r * 0.8, r * 2.4, 'rgba(255,79,110,0.9)', 0.35, Math.max(2, r * 0.14));
        shake = 1;
        flash[e.lane] = 1;
      } else if (e.type === 'out') {
        stage.particles.burst(bx, by, 22, { speed: [60, 320], life: [0.6, 1.2], size: [r * 0.14, r * 0.3], gravity: 300, colors: ['#FF4F6E', '#FFC53A', '#F4F2F8'], shape: ['dot', 'star'] });
        loose(bx, by, 10, r, [pal.body, pal.belly, pal.wing], 240);
      }
    }
  }

  return {
    render(f) {
      if (disposed) return;
      font = canvasFont();
      const r = stage.rects();
      stage.setCamera(o.self.aspect());
      stage.begin();
      const lanes: Rect[] = r.lanes ?? [r.play];
      shake = Math.max(0, shake - f.dt * 3.2);
      flash = flash.map((v) => Math.max(0, v - f.dt * 3.5));
      power = power.map((v) => Math.max(0, v - f.dt * 2.4));
      for (let i = 0; i < o.players; i++) {
        const lane = lanes[i] as Rect;
        const region: Rect = o.players === 2 ? { x: lane.x, y: 0, w: lane.w, h: r.h } : { x: 0, y: 0, w: r.w, h: r.h };
        drawLane(f, i, lane, region);
      }
      react(f, lanes);
      effects(f.dt);
      stage.particles.update(f.dt);
      stage.particles.draw(ctx);
      // Score pops rise and fade, over a soft shadow so they read on a bright sky.
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i] as Pop;
        p.age += f.dt;
        if (p.age >= p.life) { pops.splice(i, 1); continue; }
        const u = p.age / p.life;
        const y = p.y - u * p.size * 1.6;
        const pop = 1 + 0.25 * Math.max(0, 1 - u * 5);
        text(p.text, p.x + 2, y + 2, p.size * pop, '#1C1433', { alpha: (1 - u * u) * 0.35 });
        text(p.text, p.x, y, p.size * pop, p.color, { alpha: 1 - u * u });
      }
      for (let i = 0; i < o.players; i++) banner(lanes[i] as Rect, f, i);
      if (r.pip) {
        const players = o.players === 2 ? [{ slot: 1 as const, landmarks: o.self.landmarks(1) }, { slot: 2 as const, landmarks: o.self.landmarks(2) }] : [{ slot: 1 as const, landmarks: o.self.landmarks(1) }];
        pip.draw(ctx, r.pip, { image: o.self.image(), players, dtMs: Math.max(16, f.dt * 1000), divider: o.players === 2, on: true });
      }
    },
    birdAt: (lane) => birds[lane] ?? null,
    dispose() {
      disposed = true;
      gradients.clear();
      scenery.dispose();
      pops.length = 0;
      feathers.length = 0;
      rings.length = 0;
      trails.forEach((t) => (t.length = 0));
      stage.particles.clear();
    },
  };
}

export { BIOMES };
