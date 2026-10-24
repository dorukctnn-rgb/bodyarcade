// Squat Flap on a 2D canvas (design/art, LAYOUT.md section 5: flight template, self view in the bottom right corner over
// the ground band). The picture is a function of the simulation state and nothing else: it holds no game rules, reads
// no clock (its animation time is the simulation's), draws its effects with the 'fx' random stream, and gives back
// everything it made on dispose().
//   world y (0 top .. 1 bottom of the play area) -> pixels: lane.y + y * lane.h
//   world x (along the course)                   -> pixels: birdX + (x - scroll) * sx, with sx = min(lane.h, lane.w / 1.6)
// On a phone held upright the course is squeezed sideways (sx under lane.h) so that a column is in sight long enough to
// react to; the bird is drawn as a circle and its picture is larger than its hit box, on purpose.
import type { Rng } from '../../core/types/index.ts';
import { roundedRectPath } from '../../core/render2d/pip.ts';
import { clamp, wave } from '../kit-g1/index.ts';
import { canvasFont } from '../kit-g1/font.ts';
import { createPipPainter } from '../kit-g1/pip.ts';
import type { SelfView } from '../kit-g1/selfview.ts';
import type { Say } from '../kit-g1/say.ts';
import type { Rect, Stage } from '../kit-g1/stage.ts';
import { BIOMES, BIRD, BIRD_P2, biomeAt, type Biome } from './content.ts';
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

const TAU = Math.PI * 2;

/** px per world unit along the course, for a lane. */
export const courseScale = (lane: Rect): number => Math.min(lane.h, lane.w / 1.6);

/** The bird's picture radius, in pixels. */
export const birdRadius = (lane: Rect): number => Math.max(14, 0.05 * lane.h);

const hash = (n: number): number => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

export function createFlightView(o: FlightViewOptions): FlightView {
  const { stage, say } = o;
  const ctx = stage.ctx;
  let font = canvasFont();
  const pip = createPipPainter();
  const gradients = new Map<string, CanvasGradient>();
  const pops: Pop[] = [];
  const birds: ({ x: number; y: number; r: number } | null)[] = [null, null];
  let shake = 0;
  let flash = [0, 0];
  let disposed = false;

  const grad = (key: string, make: () => CanvasGradient): CanvasGradient => {
    let g = gradients.get(key);
    if (!g) { g = make(); gradients.set(key, g); if (gradients.size > 24) gradients.delete(gradients.keys().next().value as string); }
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

  // ───────── scenery ─────────

  function sky(b: Biome, region: Rect, ground: number): void {
    ctx.fillStyle = grad(`sky|${b.id}|${Math.round(region.h)}`, () => {
      const g = ctx.createLinearGradient(0, 0, 0, ground);
      g.addColorStop(0, b.sky[0]);
      g.addColorStop(1, b.sky[1]);
      return g;
    });
    ctx.fillRect(region.x, region.y, region.w, region.h);
    if (b.stars) {
      ctx.fillStyle = '#F4F2F8';
      for (let i = 0; i < 38; i++) {
        const sx = region.x + hash(i * 3 + 1) * region.w, sy = region.y + hash(i * 3 + 2) * ground * 0.7;
        ctx.globalAlpha = 0.25 + hash(i * 3 + 3) * 0.6;
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function orb(b: Biome, lane: Rect, ground: number): void {
    ctx.globalAlpha = b.stars ? 0.95 : 0.85;
    ctx.fillStyle = b.orb;
    ctx.beginPath();
    ctx.arc(lane.x + lane.w * 0.78, ground * 0.2, Math.max(16, lane.h * 0.07), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function hills(b: Biome, region: Rect, ground: number, h: number, scrollPx: number): void {
    const layers = [{ color: b.hills[0], par: 0.1, base: 0.5, amp: 0.1, f: 0.0016 }, { color: b.hills[1], par: 0.22, base: 0.62, amp: 0.085, f: 0.0026 }];
    for (const L of layers) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(region.x, ground);
      for (let px = 0; px <= region.w + 12; px += 12) {
        const wx = (px + scrollPx * L.par) * L.f * (h / 700 > 0 ? 700 / h : 1);
        const y = ground - h * (L.base * 0.55 + L.amp * (0.6 * wave(wx) + 0.4 * wave(wx * 2.3 + 0.37)));
        ctx.lineTo(region.x + px, y);
      }
      ctx.lineTo(region.x + region.w, ground);
      ctx.closePath();
      ctx.fill();
    }
  }

  function clouds(b: Biome, region: Rect, lane: Rect, scrollPx: number): void {
    ctx.fillStyle = b.cloud;
    ctx.globalAlpha = b.stars ? 0.5 : 0.8;
    for (let i = 0; i < 5; i++) {
      const span = region.w + 240;
      const x = region.x + ((((hash(i + 11) * span - scrollPx * (0.04 + 0.01 * i)) % span) + span) % span) - 120;
      const y = lane.y + lane.h * (0.12 + hash(i + 31) * 0.4);
      const w = lane.h * (0.12 + hash(i + 51) * 0.1);
      ctx.beginPath();
      ctx.ellipse(x, y, w, w * 0.34, 0, 0, TAU);
      ctx.ellipse(x - w * 0.55, y + w * 0.1, w * 0.6, w * 0.26, 0, 0, TAU);
      ctx.ellipse(x + w * 0.6, y + w * 0.12, w * 0.55, w * 0.24, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function column(b: Biome, cx: number, w: number, yFrom: number, yTo: number, capEdge: 'top' | 'bottom', capH: number, moving: boolean): void {
    if (yTo - yFrom < 1) return;
    const p = b.pipe;
    const x = cx - w / 2;
    ctx.fillStyle = p.body;
    ctx.fillRect(x, yFrom, w, yTo - yFrom);
    ctx.fillStyle = p.lit;
    ctx.fillRect(x + w * 0.1, yFrom, w * 0.16, yTo - yFrom);
    ctx.fillStyle = p.shade;
    ctx.fillRect(x + w * 0.68, yFrom, w * 0.32, yTo - yFrom);
    // The cap: wider, rounded, on the edge of the gap.
    const cw = w * 1.34;
    const cy = capEdge === 'top' ? yTo - capH : yFrom;
    ctx.fillStyle = p.cap;
    roundedRectPath(ctx, { x: cx - cw / 2, y: cy, w: cw, h: capH }, capH * 0.4);
    ctx.fill();
    ctx.fillStyle = p.capShade;
    ctx.fillRect(cx - cw / 2 + cw * 0.7, cy + capH * 0.12, cw * 0.26, capH * 0.76);
    if (moving) {
      ctx.fillStyle = '#FF4F6E';
      ctx.fillRect(cx - cw / 2 + capH * 0.3, cy + capH * 0.42, cw - capH * 0.6, Math.max(2, capH * 0.16));
    }
  }

  function columns(b: Biome, s: Readonly<FlightState>, lane: Rect, region: Rect, scroll: number, sx: number, birdX: number, ground: number): void {
    const capH = Math.max(10, 0.042 * lane.h);
    const w = Math.max(WORLD.pipeW * sx, 0.05 * lane.h);
    for (const p of s.pipes) {
      const cx = birdX + (p.x - scroll) * sx;
      if (cx + w < region.x - 8 || cx - w > region.x + region.w + 8) continue;
      const c = gapCentre(p, s.active);
      const top = lane.y + (c - p.h / 2) * lane.h;
      const bottom = lane.y + (c + p.h / 2) * lane.h;
      column(b, cx, w, region.y - 4, top, 'top', capH, p.amp > 0);
      column(b, cx, w, bottom, ground + 2, 'bottom', capH, p.amp > 0);
    }
  }

  function groundBand(b: Biome, region: Rect, ground: number, scrollPx: number): void {
    ctx.fillStyle = b.ground;
    ctx.fillRect(region.x, ground, region.w, region.y + region.h - ground);
    ctx.fillStyle = b.groundLine;
    ctx.fillRect(region.x, ground, region.w, Math.max(3, region.h * 0.006));
    // Dashes slide past with the course.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#F4F2F8';
    const gap = 54, len = 24;
    const off = ((scrollPx % gap) + gap) % gap;
    const y = ground + Math.max(12, region.h * 0.03);
    for (let x = region.x - off; x < region.x + region.w; x += gap) ctx.fillRect(x, y, len, 3);
    ctx.globalAlpha = 1;
  }

  // ───────── the bird ─────────

  function bird(laneNo: number, l: LaneState, x: number, y: number, r: number, vy: number, time: number): void {
    const pal = laneNo === 1 ? BIRD_P2 : BIRD;
    // Stretch on a flap, squash in a glide, a little tilt with the vertical speed.
    const kick = Math.max(0, 1 - l.sinceFlap / 0.3);
    const sy = 1 + 0.14 * kick - 0.08 * l.glide;
    const sxs = 1 - 0.1 * kick + 0.07 * l.glide;
    const tilt = clamp(vy * 0.8, -0.55, 0.6);
    if (l.invul > 0 && Math.floor(time * 14) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(sxs, sy);
    // tail
    ctx.fillStyle = pal.wing;
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, -r * 0.1);
    ctx.lineTo(-r * 1.5, -r * 0.5);
    ctx.lineTo(-r * 1.35, r * 0.05);
    ctx.lineTo(-r * 1.5, r * 0.35);
    ctx.lineTo(-r * 0.8, r * 0.25);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.cheek;
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, r * 0.25, r * 0.78, r * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.38, r * 0.62, r * 0.42, -0.15, 0, TAU);
    ctx.fill();
    // beak
    ctx.fillStyle = pal.beak;
    ctx.beginPath();
    ctx.moveTo(r * 0.8, -r * 0.2);
    ctx.lineTo(r * 1.45, r * 0.02);
    ctx.lineTo(r * 0.8, r * 0.3);
    ctx.closePath();
    ctx.fill();
    // eye
    ctx.fillStyle = pal.eye;
    ctx.beginPath();
    ctx.arc(r * 0.38, -r * 0.3, r * 0.27, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.pupil;
    ctx.beginPath();
    ctx.arc(r * 0.46, -r * 0.28, r * 0.13, 0, TAU);
    ctx.fill();
    // wing: up and down after a flap, spread flat in a glide, folded when falling
    const beat = l.sinceFlap < 0.34 ? Math.cos((l.sinceFlap / 0.34) * Math.PI) : 0;
    const angle = l.glide > 0.5 ? -0.12 : -0.2 + beat * 1.0 + (l.vy > 0.1 ? 0.5 : 0);
    ctx.save();
    ctx.translate(-r * 0.12, r * 0.05);
    ctx.rotate(angle);
    ctx.fillStyle = pal.wing;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.95 - l.glide * r * 0.3, -r * 0.1, -r * 1.15 - l.glide * r * 0.35, -r * 0.62);
    ctx.quadraticCurveTo(-r * 0.2, -r * 0.55, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = BIRD.wingLit;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.1);
    ctx.quadraticCurveTo(-r * 0.7, -r * 0.14, -r * 0.9, -r * 0.45);
    ctx.quadraticCurveTo(-r * 0.4, -r * 0.35, -r * 0.2, -r * 0.1);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function feathers(lane: Rect, lives: number, total: number, accent: string): void {
    const r = Math.max(5, lane.h * 0.012);
    for (let i = 0; i < total; i++) {
      const x = lane.x + r * 2.2 + i * r * 3.3, y = lane.y + r * 2.6;
      ctx.globalAlpha = i < lives ? 1 : 0.28;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.8, r * 1.5, 0.6, 0, TAU);
      ctx.fill();
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
    sky(b, region, ground);
    orb(b, lane, ground);
    hills(b, region, ground, lane.h, scrollPx);
    clouds(b, region, lane, scrollPx);
    columns(b, s, lane, region, f.scroll, sx, birdX, ground);
    groundBand(b, region, ground, scrollPx);
    const r = birdRadius(lane);
    const by = lane.y + (f.y[laneNo] ?? l.y) * lane.h;
    birds[laneNo] = { x: birdX, y: by, r };
    bird(laneNo, l, birdX, by, r, l.vy, f.time);
    if (!s.duel) feathers(lane, l.lives, lv.lives, laneNo === 1 ? '#46B4FF' : '#FF4F6E');
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
      if (e.type === 'flap') {
        stage.particles.burst(bx - r * 0.9, by + r * 0.4, 6, { speed: [30, 110], angle: [Math.PI * 0.55, Math.PI * 1.05], life: [0.3, 0.6], size: [r * 0.12, r * 0.22], gravity: 60, drag: 1.6, colors: ['#F4F2F8', '#FFB3C0'], shape: 'dot' });
      } else if (e.type === 'pass') {
        const col = e.centre ? '#FFC53A' : '#F4F2F8';
        stage.particles.burst(bx + r * 0.6, by, e.centre ? 12 : 5, { speed: [60, 190], life: [0.35, 0.8], size: [r * 0.12, r * 0.24], gravity: 120, colors: e.centre ? ['#FFC53A', '#FFF1CC', '#FF4F6E'] : ['#F4F2F8', '#FFC53A'], shape: e.centre ? ['star', 'dot'] : 'dot' });
        pops.push({ text: `+${e.pts}`, x: bx + r * 1.2, y: by - r * 1.4, age: 0, life: 0.9, color: col, size: clamp(lane.h * 0.04, 14, 34) });
      } else if (e.type === 'hit') {
        stage.particles.burst(bx, by, 16, { speed: [80, 260], life: [0.4, 0.9], size: [r * 0.14, r * 0.3], gravity: 260, drag: 0.8, colors: ['#FF4F6E', '#F4F2F8', '#1C1433'], shape: ['dot', 'square'] });
        shake = 1;
        flash[e.lane] = 1;
      } else if (e.type === 'out') {
        stage.particles.burst(bx, by, 22, { speed: [60, 320], life: [0.6, 1.2], size: [r * 0.14, r * 0.3], gravity: 300, colors: ['#FF4F6E', '#FFC53A', '#F4F2F8'], shape: ['dot', 'star'] });
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
      for (let i = 0; i < o.players; i++) {
        const lane = lanes[i] as Rect;
        const region: Rect = o.players === 2 ? { x: lane.x, y: 0, w: lane.w, h: r.h } : { x: 0, y: 0, w: r.w, h: r.h };
        drawLane(f, i, lane, region);
      }
      react(f, lanes);
      stage.particles.update(f.dt);
      stage.particles.draw(ctx);
      // Score pops rise and fade.
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i] as Pop;
        p.age += f.dt;
        if (p.age >= p.life) { pops.splice(i, 1); continue; }
        const u = p.age / p.life;
        text(p.text, p.x, p.y - u * p.size * 1.6, p.size, p.color, { alpha: 1 - u * u });
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
      pops.length = 0;
      stage.particles.clear();
    },
  };
}

export { BIOMES };
