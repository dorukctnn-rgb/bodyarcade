// Summit Climb on a 2D canvas: a rock wall seen from behind the climber (design/art: template E, the mover in chalk strokes
// with a flush head; LAYOUT.md section 5: self view in a corner). The picture is a function of the simulation state and
// nothing else: it holds no game rules, reads no clock (its animation time is the simulation's), draws its effects with the
// 'fx' random stream, and gives back everything it made on dispose().
//   world: metres up the wall (hh) and across it (x, three columns) -> pixels:
//     y = anchor - (hh - camera) * U;  x = centre + x * U
//   The camera follows the climber, who hangs at the anchor, a little under the middle of the play area. Three columns are
//   the three places the climber can lean into; a rock closes one or two of them.
import type { Rng } from '../../core/types/index.ts';
import { roundedRectPath } from '../../core/render2d/pip.ts';
import { clamp, smoothstep, wave } from '../kit-g1/index.ts';
import { canvasFont } from '../kit-g1/font.ts';
import { createPipPainter } from '../kit-g1/pip.ts';
import type { SelfView } from '../kit-g1/selfview.ts';
import type { Say } from '../kit-g1/say.ts';
import type { Rect, Stage } from '../kit-g1/stage.ts';
import { CLIMBER, MEDAL_COLORS, ROCK, themeOf, type Theme } from './content.ts';
import { READY_SEC, WARMUP, WARN_SEC, type ClimbEvent, type ClimbState, type Section } from './sim.ts';

export interface ClimbFrame {
  s: Readonly<ClimbState>;
  /** The height interpolated between the last two steps. */
  h: number;
  /** What happened since the last drawn frame. */
  fx: readonly ClimbEvent[];
  /** Simulation seconds since the last drawn frame (0 when nothing has been stepped). */
  dt: number;
  /** The simulation's clock, for animation. */
  time: number;
  /** The reason sentence on show, or null. */
  reason: string | null;
  /** What the player is told to do in the warm-up: the body, seated, keys or touch. */
  how: 'pose' | 'seated' | 'keys' | 'touch';
}

export interface ClimbView {
  render(f: ClimbFrame): void;
  /** Where the climber's body was drawn in the last frame (CSS pixels), for the overlap checks. */
  climberAt(): { x: number; y: number; r: number } | null;
  /** The columns of the wall as drawn: its left edge, the width of a column, and its top and bottom (CSS pixels). */
  wallAt(): { x: number; colW: number; top: number; bottom: number } | null;
  dispose(): void;
}

export interface ClimbViewOptions {
  stage: Stage;
  self: SelfView;
  say: Say;
  /** The 'fx' stream. */
  rng: Rng;
  reducedMotion: boolean;
}

interface Pop { text: string; x: number; y: number; age: number; life: number; color: string; size: number }

const TAU = Math.PI * 2;
/** Metres across a column of the wall. */
const COL = 1.25;
const HAND_GRIP = 0.55;

const hash = (n: number): number => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

interface Geo { lane: Rect; U: number; cx: number; anchor: number; wallL: number; wallR: number; shoulder: number }

/** The size of a metre in pixels: the play area shows about seven metres of wall, fewer on a short and wide one. */
export const unitOf = (lane: Rect): number => Math.min(lane.w / 3.9, lane.h / (lane.w / lane.h > 3 ? 4.8 : 7.4));

export function geoOf(lane: Rect): Geo {
  const U = unitOf(lane);
  const cx = lane.x + lane.w / 2;
  const anchor = lane.y + lane.h * 0.68;
  return { lane, U, cx, anchor, wallL: cx - 1.5 * COL * U, wallR: cx + 1.5 * COL * U, shoulder: anchor - 0.55 * U };
}

const hits = (a: Rect, b: Rect, gap = 0): boolean => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Moves a box up until it is clear of the given rectangles, within the lane. */
function clearOf(box: Rect, avoid: readonly (Rect | null)[], lane: Rect): Rect {
  const out = { ...box };
  for (let i = 0; i < 24; i++) {
    const blocker = avoid.find((r) => r && hits(out, r, 6)) as Rect | undefined;
    if (!blocker) break;
    out.y = Math.max(lane.y, blocker.y - out.h - 8);
    if (out.y <= lane.y) break;
  }
  return out;
}

export function createClimbView(o: ClimbViewOptions): ClimbView {
  const { stage, say } = o;
  const ctx = stage.ctx;
  let font = canvasFont();
  const pip = createPipPainter();
  const gradients = new Map<string, CanvasGradient>();
  const pops: Pop[] = [];
  let climber: { x: number; y: number; r: number } | null = null;
  let wall: { x: number; colW: number; top: number; bottom: number } | null = null;
  let disposed = false;
  // The picture's own easing: the height the camera shows, the column the climber hangs in, a flinch, a flash, the leg steps.
  let dh = 0;
  let lx = 0;
  let shake = 0;
  let flash = 0;
  let stepAt = -9;
  let stepLeg = 0;
  let lastSet = 0;

  const grad = (key: string, make: () => CanvasGradient): CanvasGradient => {
    let g = gradients.get(key);
    if (!g) { g = make(); gradients.set(key, g); if (gradients.size > 32) gradients.delete(gradients.keys().next().value as string); }
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

  function lines(cx: number, top: number, w: number, str: string, px: number, color: string): number {
    const words = str.split(' ');
    let line = '';
    const out: string[] = [];
    ctx.font = `700 ${Math.round(px)}px ${font}`;
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    out.forEach((ln, i) => text(ln, cx, top + i * px * 1.3, px, color, { weight: 700 }));
    return out.length;
  }

  // ───────── the scenery ─────────

  const yAt = (g: Geo, hh: number): number => g.anchor - (hh - (dh + 0.9)) * g.U;

  function backdrop(th: Theme, g: Geo, region: Rect): void {
    const lane = g.lane;
    ctx.fillStyle = grad(`sky|${th.id}|${Math.round(region.y)}|${Math.round(region.h)}`, () => {
      const gr = ctx.createLinearGradient(0, region.y, 0, region.y + region.h);
      gr.addColorStop(0, th.sky[0]);
      gr.addColorStop(1, th.sky[1]);
      return gr;
    });
    ctx.fillRect(region.x, region.y, region.w, region.h);
    if (th.stars) {
      ctx.fillStyle = '#F4F2F8';
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.2 + hash(i * 3 + 3) * 0.6;
        ctx.fillRect(region.x + hash(i * 3 + 1) * region.w, region.y + hash(i * 3 + 2) * region.h * 0.6, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // The sun, the lava glow or the moon, soft.
    const sx = region.x + region.w * 0.8, sy = region.y + region.h * (0.16 + 0.1 * smoothstep(dh / 60));
    const rad = g.U * 2.6;
    ctx.fillStyle = grad(`glow|${th.id}|${Math.round(sx)}|${Math.round(sy)}|${Math.round(rad)}`, () => {
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      gr.addColorStop(0, th.glow + 'CC');
      gr.addColorStop(0.4, th.glow + '44');
      gr.addColorStop(1, th.glow + '00');
      return gr;
    });
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, TAU);
    ctx.fill();
    // Far shapes in two bands, drifting down slowly as the climber goes up (the parallax of a climb).
    const drift = dh * g.U * 0.09;
    for (let band = 0; band < 2; band++) {
      const base = lane.y + lane.h * (0.72 - band * 0.1) + drift * (1 - band * 0.4);
      ctx.fillStyle = th.far[band] as string;
      ctx.beginPath();
      ctx.moveTo(region.x, region.y + region.h);
      ctx.lineTo(region.x, base);
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const x = region.x + (region.w * i) / n;
        const peak = (th.id === 'city' ? 0.3 : 0.6) * g.U * (1 + hash(i * 5 + band * 17 + 1) * 2.4);
        ctx.lineTo(x - region.w / n / 2, base - (th.id === 'city' ? peak : peak * 0.4));
        ctx.lineTo(x, base - peak * (th.id === 'city' ? 0.7 : 1));
      }
      ctx.lineTo(region.x + region.w, region.y + region.h);
      ctx.closePath();
      ctx.fill();
    }
  }

  function wallFace(th: Theme, g: Geo, top: number, bottom: number): void {
    const w = g.wallR - g.wallL;
    // The dark rock beside the face, then the face with its strata and its joints.
    ctx.fillStyle = th.rock;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(g.wallL - g.U * 0.6, top, w + g.U * 1.2, bottom - top);
    ctx.globalAlpha = 1;
    const k0 = Math.floor((dh - 6) / 1.7), k1 = Math.ceil((dh + 14) / 1.7);
    for (let k = k0; k <= k1; k++) {
      const yb = yAt(g, k * 1.7), yt = yAt(g, (k + 1) * 1.7);
      if (yt > bottom || yb < top) continue;
      ctx.fillStyle = th.wall[((k % 2) + 2) % 2] as string;
      ctx.fillRect(g.wallL, Math.max(top, yt), w, Math.min(bottom, yb) - Math.max(top, yt) + 1);
      // A few cracks in every band.
      ctx.strokeStyle = th.joint;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1, g.U * 0.025);
      for (let i = 0; i < 4; i++) {
        const x = g.wallL + hash(k * 11 + i) * w;
        const y = yt + (yb - yt) * (0.15 + 0.7 * hash(k * 13 + i + 5));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (hash(k * 7 + i) - 0.5) * g.U * 0.5, y + g.U * 0.25 * (0.4 + hash(k + i)));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // The column joints.
    ctx.strokeStyle = th.joint;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(1, g.U * 0.04);
    for (const x of [g.wallL + COL * g.U, g.wallL + 2 * COL * g.U]) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // The edges catch the light.
    ctx.fillStyle = th.shelf;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(g.wallL - 2, top, 3, bottom - top);
    ctx.fillRect(g.wallR - 1, top, 3, bottom - top);
    ctx.globalAlpha = 1;
    // Holds, staggered.
    const j0 = Math.floor((dh - 6) / 0.85), j1 = Math.ceil((dh + 14) / 0.85);
    ctx.fillStyle = th.hold;
    for (let j = j0; j <= j1; j++) {
      const y = yAt(g, j * 0.85 + hash(j) * 0.3);
      if (y < top - 10 || y > bottom + 10) continue;
      const x = g.wallL + (0.1 + hash(j + 7) * 0.8) * w;
      ctx.globalAlpha = 0.7;
      roundedRectPath(ctx, { x: x - g.U * 0.13, y: y - g.U * 0.07, w: g.U * 0.26, h: g.U * 0.14 }, g.U * 0.06);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function ground(th: Theme, g: Geo, region: Rect): void {
    const y0 = yAt(g, 0);
    if (y0 > region.y + region.h) return;
    ctx.fillStyle = th.ground;
    ctx.fillRect(region.x, y0, region.w, region.y + region.h - y0);
    ctx.fillStyle = th.rock;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 14; i++) {
      const x = region.x + hash(i + 40) * region.w;
      ctx.beginPath();
      ctx.ellipse(x, y0 + g.U * (0.15 + hash(i + 60) * 0.5), g.U * (0.15 + hash(i) * 0.25), g.U * 0.09, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ───────── the parts of the wall ─────────

  function ledge(th: Theme, g: Geo, sec: Section, h: number, active: boolean): void {
    const per = sec.len / Math.max(1, sec.steps);
    const w = g.wallR - g.wallL;
    for (let i = 0; i < sec.steps; i++) {
      const hb = sec.y0 + i * per, ht = hb + per;
      const yb = yAt(g, hb), yt = yAt(g, ht);
      if (yb < g.lane.y - g.U || yt > g.lane.y + g.lane.h + g.U) continue;
      const done = h >= ht - 1e-6;
      ctx.fillStyle = th.shelf;
      ctx.globalAlpha = done ? 0.95 : 0.55;
      ctx.fillRect(g.wallL - g.U * 0.25, yt, w + g.U * 0.5, Math.max(2, g.U * 0.17));
      ctx.fillStyle = th.rock;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(g.wallL - g.U * 0.25, yt + g.U * 0.17, w + g.U * 0.5, Math.max(1, (yb - yt) - g.U * 0.17));
      ctx.globalAlpha = 1;
      if (active && !done && h >= hb - 1e-6) {
        ctx.fillStyle = '#FFC53A';
        ctx.globalAlpha = 0.5 + 0.3 * wave(h * 2 + i);
        ctx.fillRect(g.wallL - g.U * 0.25, yt, w + g.U * 0.5, Math.max(2, g.U * 0.17));
        ctx.globalAlpha = 1;
      }
    }
    // Chevrons on the face say "steps".
    const ym = yAt(g, sec.y0 + sec.len / 2);
    ctx.strokeStyle = '#F4F2F8';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(2, g.U * 0.06);
    for (const x of [g.wallL + g.U * 0.35, g.wallR - g.U * 0.35]) {
      ctx.beginPath();
      ctx.moveTo(x - g.U * 0.14, ym + g.U * 0.1);
      ctx.lineTo(x, ym - g.U * 0.1);
      ctx.lineTo(x + g.U * 0.14, ym + g.U * 0.1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function crux(g: Geo, sec: Section, active: boolean, spent: number): void {
    const yt = yAt(g, sec.y0 + sec.len), yb = yAt(g, sec.y0);
    if (yb < g.lane.y - g.U || yt > g.lane.y + g.lane.h + g.U) return;
    const w = g.wallR - g.wallL;
    ctx.fillStyle = '#FF4F6E';
    ctx.globalAlpha = active ? 0.2 + 0.1 * wave(spent * 2) : 0.12;
    ctx.fillRect(g.wallL, yt, w, yb - yt);
    ctx.globalAlpha = 1;
    // Hazard stripes down both edges.
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.wallL - g.U * 0.18, yt, g.U * 0.18, yb - yt);
    ctx.rect(g.wallR, yt, g.U * 0.18, yb - yt);
    ctx.clip();
    ctx.fillStyle = '#FFC53A';
    const step = g.U * 0.36;
    for (let y = yt - step; y < yb + step; y += step * 2) { ctx.beginPath(); ctx.moveTo(g.wallL - g.U * 0.18, y + step); ctx.lineTo(g.wallR + g.U * 0.18, y); ctx.lineTo(g.wallR + g.U * 0.18, y + step * 0.9); ctx.lineTo(g.wallL - g.U * 0.18, y + step * 1.9); ctx.fill(); }
    ctx.restore();
  }

  function rest(th: Theme, g: Geo, sec: Section, active: boolean, left: number): void {
    const y = yAt(g, sec.y0);
    if (y < g.lane.y - g.U * 2 || y > g.lane.y + g.lane.h + g.U) return;
    const w = g.wallR - g.wallL;
    ctx.fillStyle = th.shelf;
    roundedRectPath(ctx, { x: g.wallL - g.U * 0.5, y, w: w + g.U, h: g.U * 0.22 }, g.U * 0.08);
    ctx.fill();
    ctx.fillStyle = '#46B4FF';
    ctx.globalAlpha = active ? 0.9 : 0.55;
    ctx.fillRect(g.wallL - g.U * 0.5, y, w + g.U, Math.max(2, g.U * 0.05));
    ctx.globalAlpha = 1;
    // A lantern at each end of the breather.
    for (const x of [g.wallL - g.U * 0.3, g.wallR + g.U * 0.3]) {
      ctx.fillStyle = '#FFD98A';
      ctx.globalAlpha = active ? 1 : 0.7;
      ctx.beginPath();
      ctx.arc(x, y - g.U * 0.18, g.U * 0.1, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = active ? 0.25 : 0.12;
      ctx.beginPath();
      ctx.arc(x, y - g.U * 0.18, g.U * 0.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (active) {
      // A ring that breathes in and out while the clock is stopped.
      const cx = g.cx + lx, cy = g.shoulder;
      ctx.strokeStyle = '#46B4FF';
      ctx.lineWidth = Math.max(2, g.U * 0.07);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, g.U * (0.85 + 0.15 * wave(left * 0.4)), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function summitMark(th: Theme, g: Geo, summit: number): void {
    const y = yAt(g, summit);
    if (y < g.lane.y - g.U * 4 || y > g.lane.y + g.lane.h + g.U) return;
    const w = g.wallR - g.wallL;
    // Above the top there is only sky: the wall ends in a snowy lip with a flag.
    ctx.fillStyle = th.top;
    roundedRectPath(ctx, { x: g.wallL - g.U * 0.5, y: y - g.U * 0.1, w: w + g.U, h: g.U * 0.3 }, g.U * 0.12);
    ctx.fill();
    const fx = g.cx + g.U * 0.8;
    ctx.strokeStyle = '#F4F2F8';
    ctx.lineWidth = Math.max(2, g.U * 0.06);
    ctx.beginPath();
    ctx.moveTo(fx, y - g.U * 0.1);
    ctx.lineTo(fx, y - g.U * 1.4);
    ctx.stroke();
    ctx.fillStyle = '#FF4F6E';
    ctx.beginPath();
    ctx.moveTo(fx, y - g.U * 1.4);
    ctx.lineTo(fx + g.U * 0.75, y - g.U * 1.15);
    ctx.lineTo(fx, y - g.U * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  // ───────── the rocks ─────────

  function rockSprite(x: number, y: number, r: number, spin: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.fillStyle = ROCK.stone;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const rr = r * (0.8 + 0.25 * hash(i + 90));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ROCK.dark;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(r * 0.2, r * 0.25, r * 0.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.3, r * 0.25, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function rocks(g: Geo, s: Readonly<ClimbState>, time: number): void {
    const c = s.c;
    const lane = g.lane;
    const impactY = g.anchor - 0.1 * g.U;
    const top = lane.y - g.U * 0.8;
    const show = (idx: number): void => {
      const r = s.rocks[idx];
      if (!r) return;
      const u = (s.setT - (r.t - WARN_SEC)) / WARN_SEC;
      if (u < 0 || u > 1.9) return;
      const closed = r.closed;
      ([-1, 0, 1] as const).forEach((k) => {
        const x = g.cx + k * COL * g.U;
        const isClosed = closed[k + 1] as boolean;
        if (u <= 1) {
          // The warning: the closed columns glow red from top to bottom and the open ones show a green mark at the climber's height.
          const pulse = 0.5 + 0.5 * wave(time * 2.2);
          if (isClosed) {
            ctx.fillStyle = ROCK.warn;
            ctx.globalAlpha = (0.1 + 0.16 * pulse) * (0.4 + 0.6 * u);
            ctx.fillRect(x - COL * g.U / 2, lane.y, COL * g.U, lane.h);
            ctx.globalAlpha = 1;
            // The marker at the top and the rock coming down.
            ctx.fillStyle = ROCK.warn;
            ctx.beginPath();
            ctx.moveTo(x - g.U * 0.22, lane.y + g.U * 0.18);
            ctx.lineTo(x + g.U * 0.22, lane.y + g.U * 0.18);
            ctx.lineTo(x, lane.y + g.U * 0.55);
            ctx.closePath();
            ctx.fill();
            const ry = top + (impactY - top) * (u * u);
            rockSprite(x, ry, g.U * 0.4, time * 3 + k);
          } else {
            ctx.strokeStyle = ROCK.safe;
            ctx.globalAlpha = 0.55 + 0.35 * pulse;
            ctx.lineWidth = Math.max(2, g.U * 0.08);
            const yy = g.anchor - 1.0 * g.U;
            ctx.beginPath();
            ctx.moveTo(x - g.U * 0.25, yy + g.U * 0.12);
            ctx.lineTo(x, yy - g.U * 0.1);
            ctx.lineTo(x + g.U * 0.25, yy + g.U * 0.12);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        } else if (isClosed) {
          // After the impact: a rock that missed keeps falling; one that hit is gone in dust.
          const hit = c.hits > 0 && Math.abs(c.hitAt - r.t) < 1e-6 && k === c.hitLane;
          if (!hit) {
            const ry = impactY + (u - 1) * g.U * 7;
            if (ry < lane.y + lane.h + g.U) rockSprite(x, ry, g.U * 0.4, time * 3 + k);
          }
        }
      });
    };
    show(c.rock - 1);
    show(c.rock);
  }

  // ───────── the climber ─────────

  /** Two bones from the shoulder to the hand: where the elbow goes, bent outward and down. */
  function elbowOf(sx: number, sy: number, hx: number, hy: number, l1: number, l2: number, side: -1 | 1): { x: number; y: number } {
    const dx = hx - sx, dy = hy - sy;
    const len = Math.max(1e-6, Math.hypot(dx, dy));
    const d = clamp(len, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / len, uy = dy / len;
    const s1 = -uy * side + ux * 0.6, s2 = uy * side - ux * 0.6;
    const px = s1 >= s2 ? -uy : uy, py = s1 >= s2 ? ux : -ux;
    return { x: sx + ux * a + px * hh, y: sy + uy * a + py * hh };
  }

  function drawClimber(g: Geo, f: ClimbFrame): void {
    const s = f.s, c = s.c;
    const U = g.U;
    const x = g.cx + lx;
    const hipY = g.anchor;
    const tilt = clamp(lx / (COL * U), -1, 1) * 0.12;
    const wob = o.reducedMotion ? 0 : flash * Math.sin(f.time * 50) * 0.04;
    ctx.save();
    ctx.translate(x, hipY);
    ctx.rotate(tilt + wob);
    ctx.translate(-x, -hipY);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Shadow against the wall.
    ctx.fillStyle = CLIMBER.shadow;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(x + U * 0.05, hipY - U * 0.05, U * 0.3, U * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Legs: hanging, one knee up when stepping on a ledge.
    const stepU = clamp(1 - (f.time - stepAt) / 0.35, 0, 1);
    const onLedge = c.on === 'ledge';
    const leg = (side: -1 | 1, col: string, lift: number): void => {
      const hx = x + side * U * 0.09;
      const fx = x + side * U * (0.13 + lift * 0.1);
      const fy = hipY + U * (0.92 - lift * 0.5);
      ctx.strokeStyle = col;
      ctx.lineWidth = U * 0.17;
      ctx.beginPath();
      ctx.moveTo(hx, hipY);
      ctx.quadraticCurveTo(x + side * U * (0.2 + lift * 0.18), hipY + U * (0.5 - lift * 0.22), fx, fy);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(fx + side * U * 0.02, fy + U * 0.03, U * 0.12, U * 0.07, 0, 0, TAU);
      ctx.fill();
    };
    const liftL = onLedge && stepLeg === 0 ? stepU : 0, liftR = onLedge && stepLeg === 1 ? stepU : 0;
    leg(-1, CLIMBER.shade, liftL);
    leg(1, CLIMBER.body, liftR);
    // Torso with a stripe down the back.
    const shY = g.shoulder;
    ctx.fillStyle = CLIMBER.body;
    roundedRectPath(ctx, { x: x - U * 0.2, y: shY - U * 0.02, w: U * 0.4, h: hipY - shY + U * 0.08 }, U * 0.14);
    ctx.fill();
    ctx.fillStyle = CLIMBER.head;
    ctx.fillRect(x - U * 0.03, shY + U * 0.05, U * 0.06, hipY - shY - U * 0.02);
    // Arms: each hand at the height of its raise; a hand that is up holds on.
    const l1 = U * 0.33, l2 = U * 0.31;
    ([-1, 1] as const).forEach((side, i) => {
      const a = clamp(c.arm[i] as number, 0, 1);
      const sx = x + side * U * 0.2, sy = shY + U * 0.06;
      const hx = x + side * U * (0.2 + 0.1 * (1 - a) + 0.06 * a), hy = shY - U * (-0.16 + 0.76 * a);
      const e = elbowOf(sx, sy, hx, hy, l1, l2, side);
      ctx.strokeStyle = i === 0 ? CLIMBER.shade : CLIMBER.body;
      ctx.lineWidth = U * 0.11;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(e.x, e.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = a >= HAND_GRIP ? CLIMBER.rope : CLIMBER.body;
      ctx.beginPath();
      ctx.arc(hx, hy, U * (a >= HAND_GRIP ? 0.085 : 0.07), 0, TAU);
      ctx.fill();
    });
    // Head with a band.
    ctx.fillStyle = CLIMBER.body;
    ctx.beginPath();
    ctx.arc(x, shY - U * 0.2, U * 0.17, 0, TAU);
    ctx.fill();
    ctx.fillStyle = CLIMBER.head;
    ctx.beginPath();
    ctx.arc(x, shY - U * 0.22, U * 0.17, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(x - U * 0.17, shY - U * 0.22, U * 0.34, U * 0.05);
    ctx.restore();
    climber = { x, y: shY - U * 0.1, r: U * 0.45 };
  }

  /** The time left in the hard part, as a ring around the climber. */
  function cruxRing(g: Geo, s: Readonly<ClimbState>): void {
    const c = s.c;
    if (!c.cruxOn) return;
    const sec = s.sections[c.sec] as Section;
    const left = clamp(1 - c.cruxT / sec.sec, 0, 1);
    ctx.lineWidth = Math.max(3, g.U * 0.09);
    ctx.strokeStyle = 'rgba(28,20,51,0.6)';
    ctx.beginPath();
    ctx.arc(g.cx + lx, g.shoulder, g.U * 0.95, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = left > 0.35 ? '#FFC53A' : '#FF4F6E';
    ctx.beginPath();
    ctx.arc(g.cx + lx, g.shoulder, g.U * 0.95, -Math.PI / 2, -Math.PI / 2 + TAU * left);
    ctx.stroke();
  }

  // ───────── the readouts ─────────

  function rail(g: Geo, s: Readonly<ClimbState>, h: number, avoid: readonly (Rect | null)[]): void {
    const lane = g.lane;
    const len = clamp(lane.h * 0.5, 80, 300);
    const box0: Rect = { x: lane.x + lane.w - clamp(lane.w * 0.03, 12, 30) - 8, y: lane.y + lane.h * 0.05, w: 8, h: len };
    const box = clearOf(box0, avoid, lane);
    ctx.save();
    ctx.fillStyle = 'rgba(28, 20, 51, 0.7)';
    roundedRectPath(ctx, box, 4);
    ctx.fill();
    const at = (hh: number): number => box.y + box.h - clamp(hh / s.summit, 0, 1) * box.h;
    for (const sec of s.sections) {
      ctx.fillStyle = sec.kind === 'crux' ? '#FF4F6E' : sec.kind === 'ledge' ? '#F4F2F8' : '#46B4FF';
      const y0 = at(sec.y0), y1 = at(sec.y0 + Math.max(sec.len, 0.5));
      ctx.fillRect(box.x - 3, y1, box.w + 6, Math.max(2, y0 - y1));
    }
    ctx.fillStyle = '#FFC53A';
    ctx.fillRect(box.x - 5, box.y - 1, box.w + 10, 3);
    ctx.fillStyle = CLIMBER.head;
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, at(h), 7, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function meters(g: Geo, s: Readonly<ClimbState>, avoid: readonly (Rect | null)[]): void {
    const lane = g.lane;
    const wBar = clamp(lane.w * 0.026, 9, 16), hBar = clamp(lane.h * 0.2, 50, 130);
    const gap = wBar * 0.8;
    const box0: Rect = { x: lane.x + clamp(lane.w * 0.03, 8, 26), y: lane.y + lane.h * 0.58, w: wBar * 2 + gap, h: hBar };
    const box = clearOf(box0, avoid, lane);
    ctx.save();
    ctx.globalAlpha = 0.9;
    [0, 1].forEach((i) => {
      const x = box.x + i * (wBar + gap);
      ctx.fillStyle = 'rgba(28, 20, 51, 0.7)';
      roundedRectPath(ctx, { x, y: box.y, w: wBar, h: box.h }, wBar / 2);
      ctx.fill();
      const a = clamp(s.c.arm[i] as number, 0, 1);
      const fill = a * box.h;
      ctx.fillStyle = a >= HAND_GRIP ? '#FFC53A' : '#F4F2F8';
      if (fill > 1) { roundedRectPath(ctx, { x, y: box.y + box.h - fill, w: wBar, h: fill }, wBar / 2); ctx.fill(); }
      ctx.fillStyle = '#FF4F6E';
      ctx.fillRect(x - 2, box.y + box.h - HAND_GRIP * box.h - 1, wBar + 4, 2);
    });
    ctx.restore();
  }

  function heightLabel(g: Geo, h: number, th: Theme): void {
    const px = clamp(g.lane.h * 0.05, 15, 40);
    const x = g.cx;
    const y = g.lane.y + g.lane.h * 0.055;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, px * 0.2);
    ctx.strokeStyle = 'rgba(28,20,51,0.55)';
    ctx.font = `800 ${Math.round(px)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const t = say('hud.height', { h: Math.floor(h) });
    ctx.strokeText(t, x, y);
    ctx.fillStyle = th.id === 'alps' ? '#FFFFFF' : '#F4F2F8';
    ctx.fillText(t, x, y);
    ctx.restore();
  }

  // ───────── messages ─────────

  /** Where a message panel goes: hanging from the top when there is room above the raised hands, else the compact form, else beside the wall. */
  function panelBox(g: Geo, px: number, full: number, compact: number, wFull: number): { box: Rect; compact: boolean } {
    const lane = g.lane;
    const top = lane.y + lane.h * 0.03;
    const room = g.shoulder - g.U * 1.25 - top;
    const wide = Math.min(lane.w * 0.92, wFull);
    if (room >= full * px) return { box: { x: g.cx - wide / 2, y: top, w: wide, h: full * px }, compact: false };
    const side0 = lane.x + clamp(lane.w * 0.03, 10, 28);
    const sideW = g.wallL - g.U * 0.6 - side0 - 6;
    const h = compact * px;
    if (room >= h) return { box: { x: g.cx - wide / 2, y: top, w: wide, h }, compact: true };
    if (sideW >= px * 12) return { box: { x: side0, y: top, w: Math.min(wFull, sideW), h }, compact: true };
    return { box: { x: g.cx - wide / 2, y: top, w: wide, h }, compact: true };
  }

  function banner(g: Geo, f: ClimbFrame): void {
    const s = f.s;
    const c = s.c;
    const lane = g.lane;
    const px = clamp(lane.h * 0.034, 13, 30);
    const wFull = px * 22;
    const light = '#F4F2F8';
    if (s.phase === 'warmup') {
      const { box, compact } = panelBox(g, px, 7.8, 3.8, wFull);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      plate(cx, cy, box.w, box.h);
      const n = WARMUP.pulls;
      const done = Math.min(n, s.warm.ranges.length);
      text(say('warm.title'), cx, compact ? cy - box.h * 0.2 : cy - box.h * 0.36, px * 1.15, '#FFC53A');
      if (!compact) lines(cx, cy - box.h * 0.2, box.w - px * 1.4, say(f.how === 'keys' ? 'warm.keys' : f.how === 'touch' ? 'warm.touch' : f.how === 'seated' ? 'warm.seated' : 'warm.body'), px * 0.88, light);
      const dotsY = compact ? cy + box.h * 0.26 : cy + box.h * 0.38;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = k < done ? '#22C383' : 'rgba(244,242,248,0.3)';
        ctx.beginPath();
        ctx.arc(cx + (k - (n - 1) / 2) * px * 1.5, dotsY, px * 0.32, 0, TAU);
        ctx.fill();
      }
      return;
    }
    if (s.phase === 'ready') {
      const n = Math.max(1, Math.ceil(READY_SEC - s.hc - 1e-9));
      const { box, compact } = panelBox(g, px, 9.4, 4.6, wFull);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      plate(cx, cy, box.w, box.h);
      const k = 1 - (s.hc % 1);
      const size = (compact ? px * 2.9 : px * 3.3) * (0.88 + 0.12 * smoothstep(k));
      if (compact) {
        text(say('set.label', { n: s.set, total: s.sets }), box.x + box.w * 0.34, cy - box.h * 0.17, px * 0.95, light, { weight: 700 });
        text(say('set.top', { top: Math.round(s.summit) }), box.x + box.w * 0.34, cy + box.h * 0.2, px * 0.85, light, { weight: 700, alpha: 0.8 });
        text(String(n), box.x + box.w * 0.82, cy, size, '#FFC53A', { alpha: 0.95 });
      } else {
        text(say('set.label', { n: s.set, total: s.sets }), cx, cy - box.h * 0.4, px * 0.95, light, { weight: 700 });
        text(say('set.top', { top: Math.round(s.summit) }), cx, cy - box.h * 0.27, px * 0.8, light, { weight: 700, alpha: 0.75 });
        text(String(n), cx, cy + box.h * 0.03, size, '#FFC53A', { alpha: 0.95 });
        text(say('ready.body', { top: Math.round(s.summit) }), cx, cy + box.h * 0.4, px * 0.78, light, { weight: 700, alpha: 0.85 });
      }
      return;
    }
    if (s.phase === 'rest') {
      const { box, compact } = panelBox(g, px, 7.6, 4, wFull);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      plate(cx, cy, box.w, box.h);
      const last = c.results[c.results.length - 1];
      const medal = last && last.medal !== 'dnf' ? `${say(`finish.${last.medal}`)}  ${say('finish.height', { height: Math.round(last.height) })}` : '';
      if (compact) {
        text(say('rest.title'), box.x + box.w * 0.3, cy - box.h * 0.22, px * 1.1, '#FFC53A');
        text(String(Math.ceil(s.restLeft)), box.x + box.w * 0.78, cy - box.h * 0.12, px * 2, light);
        text(say('rest.next', { n: s.set + 1, total: s.sets }), box.x + box.w * 0.3, cy + box.h * 0.26, px * 0.8, light, { weight: 700, alpha: 0.9 });
      } else {
        if (medal && last) text(medal, cx, cy - box.h * 0.4, px * 0.85, MEDAL_COLORS[last.medal], { weight: 700 });
        text(say('rest.title'), cx, cy - box.h * 0.22, px * 1.1, '#FFC53A');
        text(String(Math.ceil(s.restLeft)), cx, cy + box.h * 0.08, px * 2.3, light);
        text(say('rest.next', { n: s.set + 1, total: s.sets }), cx, cy + box.h * 0.38, px * 0.85, light, { weight: 700 });
      }
      return;
    }
    if (s.phase === 'finish') {
      const last = c.results[c.results.length - 1];
      if (!last) return;
      const { box, compact } = panelBox(g, px, 7.2, 3.8, wFull);
      const cx = box.x + box.w / 2, y = box.y + box.h / 2, w = box.w, h = box.h;
      plate(cx, y, w, h, 0.9);
      if (last.medal === 'dnf') {
        text(say('dnf.title'), cx, y, px * 1.2, '#CFCBE0');
        return;
      }
      const col = MEDAL_COLORS[last.medal];
      const r = compact ? px * 1.05 : px * 1.45;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(box.x + w * 0.16, y, r, 0, TAU);
      ctx.fill();
      text(String(s.set), box.x + w * 0.16, y, r * 1.05, '#1C1433');
      const tx = box.x + w * 0.3;
      text(say(`finish.${last.medal}`), tx, compact ? y - h * 0.2 : y - h * 0.27, compact ? px * 1.05 : px * 1.2, col, { align: 'left' });
      text(say('finish.height', { height: Math.round(last.height) }), tx, compact ? y + h * 0.2 : y + h * 0.03, compact ? px * 0.9 : px, light, { align: 'left' });
      if (!compact) {
        const note = last.medal === 'gold' ? say('finish.top', { sec: Math.round(last.left) }) : say('finish.short', { left: Math.max(1, Math.round(s.summit - last.height)) });
        text(note, cx, y + h * 0.3, px * 0.8, light, { weight: 700, alpha: 0.9 });
        if (last.clean && last.height >= s.summit * 0.5) text(say('finish.clean'), cx, y + h * 0.42, px * 0.72, '#22C383', { weight: 700 });
      }
    }
  }

  // ───────── the effects ─────────

  function react(g: Geo, f: ClimbFrame): void {
    const U = g.U;
    const x = g.cx + lx;
    const hands = (side: 'L' | 'R'): { x: number; y: number } => ({ x: x + (side === 'L' ? -1 : 1) * U * 0.28, y: g.shoulder - U * 0.7 });
    for (const e of f.fx) {
      if (e.type === 'pull') {
        const hp = hands(e.side);
        stage.particles.burst(hp.x, hp.y, 4, { speed: [20, 90], angle: [Math.PI * 0.1, Math.PI * 0.9], life: [0.25, 0.5], size: [U * 0.015, U * 0.04], gravity: 80, drag: 1.5, colors: ['#F4F2F8', '#BFB9D6'], shape: 'dot' });
        if (e.mult > 1 && Math.round(e.pts) > 0 && (f.s.c.streak % 10 === 0)) pops.push({ text: `x${e.mult}`, x: x + U * 0.6, y: g.shoulder - U * 0.9, age: 0, life: 0.9, color: '#FFC53A', size: clamp(g.lane.h * 0.05, 16, 36) });
      } else if (e.type === 'step') {
        stepAt = f.time;
        stepLeg ^= 1;
        stage.particles.burst(x + (stepLeg ? U * 0.1 : -U * 0.1), g.anchor + U * 0.7, 3, { speed: [20, 70], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.25, 0.5], size: [U * 0.015, U * 0.035], gravity: 40, drag: 1.8, colors: ['#BFB9D6', '#F4F2F8'], shape: 'dot' });
      } else if (e.type === 'rock') {
        if (e.hit) {
          stage.particles.burst(x, g.shoulder, 16, { speed: [80, 260], life: [0.4, 0.9], size: [U * 0.025, U * 0.07], gravity: 300, drag: 0.8, colors: ['#8A839E', '#4A4466', '#FF4F6E'], shape: ['dot', 'square'] });
          shake = 1;
          flash = 1;
        } else if (e.pts > 0) {
          pops.push({ text: `+${e.pts}`, x: x + U * 0.7, y: g.shoulder - U * 0.5, age: 0, life: 0.9, color: '#22C383', size: clamp(g.lane.h * 0.04, 14, 32) });
        }
      } else if (e.type === 'ledge' && e.phase === 'done') {
        stage.particles.burst(x, g.shoulder - U * 0.3, 10, { speed: [60, 190], life: [0.35, 0.8], size: [U * 0.02, U * 0.05], gravity: 120, colors: ['#FFC53A', '#F4F2F8'], shape: ['star', 'dot'] });
        pops.push({ text: `+${e.pts}`, x: x + U * 0.7, y: g.shoulder - U * 0.5, age: 0, life: 0.9, color: '#FFC53A', size: clamp(g.lane.h * 0.04, 14, 32) });
      } else if (e.type === 'crux') {
        if (e.phase === 'pass') {
          stage.particles.burst(x, g.shoulder - U * 0.3, 16, { speed: [80, 240], life: [0.4, 0.9], size: [U * 0.02, U * 0.05], gravity: 160, colors: ['#FFC53A', '#F4F2F8', '#FF4F6E'], shape: ['star', 'dot'] });
          pops.push({ text: `+${e.pts}`, x: x + U * 0.7, y: g.shoulder - U * 0.7, age: 0, life: 1, color: '#FFC53A', size: clamp(g.lane.h * 0.045, 16, 36) });
        } else if (e.phase === 'fail') { shake = 0.7; flash = 0.6; }
      } else if (e.type === 'summit' || (e.type === 'finish' && e.medal !== 'dnf' && e.medal !== 'none')) {
        const gold = e.type === 'summit' || e.medal === 'gold';
        stage.particles.burst(x, g.shoulder - U * 0.5, gold ? 30 : 14, { speed: [90, 340], life: [0.7, 1.5], size: [U * 0.02, U * 0.055], gravity: 220, colors: [gold ? MEDAL_COLORS.gold : MEDAL_COLORS.silver, '#F4F2F8', '#FF4F6E', '#46B4FF'], shape: ['star', 'dot', 'square'] });
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
      const s = f.s;
      const lane = r.play;
      const g = geoOf(lane);
      const th = themeOf(s.set);
      const region: Rect = { x: 0, y: 0, w: r.w, h: r.h };
      if (s.set !== lastSet) { lastSet = s.set; dh = 0; }
      // Easing: the picture follows the height and the column a little behind the simulation.
      const k = Math.min(1, f.dt * 14);
      dh += (f.h - dh) * (f.dt > 0 ? k : 1);
      if (s.phase === 'ready' || s.phase === 'warmup') dh = f.h;
      lx += (s.c.lane * COL * g.U - lx) * Math.min(1, f.dt > 0 ? f.dt * 10 : 1);
      shake = Math.max(0, shake - f.dt * 3.2);
      flash = Math.max(0, flash - f.dt * 3.5);
      const c = s.c;
      ctx.save();
      if (shake > 0.01 && !o.reducedMotion) ctx.translate((o.rng() - 0.5) * shake * lane.h * 0.02, (o.rng() - 0.5) * shake * lane.h * 0.02);
      backdrop(th, g, region);
      ground(th, g, region);
      const top = region.y, bottom = region.y + region.h;
      wallFace(th, g, Math.max(top, yAt(g, s.summit)), bottom);
      wall = { x: g.wallL, colW: COL * g.U, top: Math.max(top, yAt(g, s.summit)), bottom };
      for (const sec of s.sections) {
        const y0 = yAt(g, sec.y0), y1 = yAt(g, sec.y0 + sec.len);
        if (y0 < top - g.U * 2 && y1 < top - g.U * 2) continue;
        if (y1 > bottom + g.U * 2 && y0 > bottom + g.U * 2) continue;
        if (sec.kind === 'ledge') ledge(th, g, sec, c.on === 'ledge' && s.sections[c.sec] === sec ? c.h : s.sections.indexOf(sec) < c.sec ? 1e9 : -1, c.on === 'ledge' && s.sections[c.sec] === sec);
        else if (sec.kind === 'crux') crux(g, sec, c.cruxOn && s.sections[c.sec] === sec, c.cruxT);
        else rest(th, g, sec, c.on === 'rest' && s.sections[c.sec] === sec, c.breath);
      }
      summitMark(th, g, s.summit);
      if (s.phase === 'climb') rocks(g, s, f.time);
      drawClimber(g, f);
      cruxRing(g, s);
      if (flash > 0.01 && !o.reducedMotion) {
        ctx.globalAlpha = flash * 0.22;
        ctx.fillStyle = '#FF4F6E';
        ctx.fillRect(region.x, region.y, region.w, region.h);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      const avoid: (Rect | null)[] = [r.pip, ...Object.values(r.hud)];
      if (s.phase === 'climb') heightLabel(g, f.h, th);
      meters(g, s, avoid);
      rail(g, s, f.h, avoid);
      react(g, f);
      stage.particles.update(f.dt);
      stage.particles.draw(ctx);
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i] as Pop;
        p.age += f.dt;
        if (p.age >= p.life) { pops.splice(i, 1); continue; }
        const u = p.age / p.life;
        text(p.text, p.x, p.y - u * p.size * 1.6, p.size, p.color, { alpha: 1 - u * u });
      }
      banner(g, f);
      if (r.pip) {
        pip.draw(ctx, r.pip, { image: o.self.image(), players: [{ slot: 1 as const, landmarks: o.self.landmarks(1) }], dtMs: Math.max(16, f.dt * 1000), divider: false, on: true });
      }
    },
    climberAt: () => climber,
    wallAt: () => wall,
    dispose() {
      disposed = true;
      gradients.clear();
      pops.length = 0;
      stage.particles.clear();
    },
  };
}

