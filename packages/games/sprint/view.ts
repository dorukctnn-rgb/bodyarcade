// Knee Sprint on a 2D canvas, in the perspective of a track seen from behind (design/art: template A, the night stadium with
// chalk lane lines and the mover in chalk strokes; LAYOUT.md section 5: self view in a corner). The picture is a function of the
// simulation state and nothing else: it holds no game rules, reads no clock (its animation time is the simulation's), draws its
// effects with the 'fx' random stream, and gives back everything it made on dispose().
//   world: metres along the track (d ahead of the runner, x across it) -> pixels:
//     s = zc / (d + zc);  y = horizon + (feet - horizon) * s;  x = centre + x * unit * s
// The runner stands at d = 0 in the middle lane, the computer runs in the lane to the right. The knee meters and the progress
// bar sit at the edges of the play area and move out of the way of the self view.
import type { Rng } from '../../core/types/index.ts';
import { roundedRectPath } from '../../core/render2d/pip.ts';
import { clamp, smoothstep } from '../kit-g1/index.ts';
import { createPipPainter } from '../kit-g1/pip.ts';
import type { SelfView } from '../kit-g1/selfview.ts';
import type { Say } from '../kit-g1/say.ts';
import type { Rect, Stage } from '../kit-g1/stage.ts';
import { FONT, MEDAL_COLORS, RUNNER, themeOf, type Theme } from './content.ts';
import { clockOf, levelFor, medalTimes, READY_SEC, WARMUP, type LaneState, type SprintEvent, type SprintState } from './sim.ts';

export interface SprintFrame {
  s: Readonly<SprintState>;
  /** Interpolated between the last two steps: each runner's distance, and the computer's. */
  dist: readonly number[];
  rival: number;
  /** What happened since the last drawn frame. */
  fx: readonly SprintEvent[];
  /** Simulation seconds since the last drawn frame (0 when nothing has been stepped). */
  dt: number;
  /** The simulation's clock, for animation. */
  time: number;
  /** The reason sentence on show for each lane, or null. */
  reasons: readonly (string | null)[];
  /** Steps per minute of each lane now. */
  cadence: readonly number[];
  /** What the player is told to do in the warm-up: marching, swinging, keys or touch. */
  how: 'march' | 'swing' | 'keys' | 'touch';
}

export interface SprintView {
  render(f: SprintFrame): void;
  /** Where the runner of a lane was drawn in the last frame (CSS pixels), for the overlap checks. */
  runnerAt(lane: number): { x: number; y: number; r: number } | null;
  dispose(): void;
}

export interface SprintViewOptions {
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

/** The camera stands this far behind the runner, metres. */
const CAMERA = 3.4;
/** The track is three lanes of this width, metres. */
const LANE_W = 1.8;
const HALF = LANE_W * 1.5;
/** How far down the track is drawn, metres. */
const FAR = 90;
const NEAR = -2.6;
const BAND = 5;

const hash = (n: number): number => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** The size of a metre at the runner's depth, in pixels. */
export const unitOf = (lane: Rect): number => Math.min(lane.w / 5.6, lane.h * 0.19);

/** The runner's height in pixels. */
export const runnerHeight = (lane: Rect): number => 1.75 * unitOf(lane);

const hits = (a: Rect, b: Rect, gap = 0): boolean => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Moves a box up (then down) until it is clear of the given rectangles, within the lane. */
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

export function createSprintView(o: SprintViewOptions): SprintView {
  const { stage, say } = o;
  const ctx = stage.ctx;
  const pip = createPipPainter();
  const gradients = new Map<string, CanvasGradient>();
  const pops: Pop[] = [];
  const runners: ({ x: number; y: number; r: number } | null)[] = [null, null];
  const knocked = new Set<string>();
  let shake = 0;
  let flash = [0, 0];
  let disposed = false;

  const grad = (key: string, make: () => CanvasGradient): CanvasGradient => {
    let g = gradients.get(key);
    if (!g) { g = make(); gradients.set(key, g); if (gradients.size > 24) gradients.delete(gradients.keys().next().value as string); }
    return g;
  };

  function text(str: string, x: number, y: number, px: number, color: string, o2: { weight?: number; align?: CanvasTextAlign; alpha?: number; baseline?: CanvasTextBaseline } = {}): void {
    ctx.font = `${o2.weight ?? 800} ${Math.round(px)}px ${FONT}`;
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
    ctx.font = `700 ${Math.round(px)}px ${FONT}`;
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    out.forEach((ln, i) => text(ln, cx, top + i * px * 1.3, px, color, { weight: 700 }));
    return out.length;
  }

  // ───────── the projection of one lane ─────────

  interface Cam { lane: Rect; region: Rect; hz: number; feet: number; unit: number; cx: number }
  const scaleAt = (d: number): number => CAMERA / (d + CAMERA);
  const yAt = (c: Cam, d: number): number => c.hz + (c.feet - c.hz) * scaleAt(d);
  const xAt = (c: Cam, xm: number, d: number): number => c.cx + xm * c.unit * scaleAt(d);

  function quad(c: Cam, x0: number, x1: number, d0: number, d1: number): void {
    ctx.beginPath();
    ctx.moveTo(xAt(c, x0, d0), yAt(c, d0));
    ctx.lineTo(xAt(c, x1, d0), yAt(c, d0));
    ctx.lineTo(xAt(c, x1, d1), yAt(c, d1));
    ctx.lineTo(xAt(c, x0, d1), yAt(c, d1));
    ctx.closePath();
    ctx.fill();
  }

  // ───────── scenery ─────────

  function backdrop(th: Theme, c: Cam): void {
    const { region, hz } = c;
    ctx.fillStyle = grad(`sky|${th.id}|${Math.round(hz)}`, () => {
      const g = ctx.createLinearGradient(0, region.y, 0, hz);
      g.addColorStop(0, th.sky[0]);
      g.addColorStop(1, th.sky[1]);
      return g;
    });
    ctx.fillRect(region.x, region.y, region.w, hz - region.y + 1);
    if (th.stars) {
      ctx.fillStyle = '#F4F2F8';
      for (let i = 0; i < 34; i++) {
        ctx.globalAlpha = 0.2 + hash(i * 3 + 3) * 0.6;
        ctx.fillRect(region.x + hash(i * 3 + 1) * region.w, region.y + hash(i * 3 + 2) * (hz - region.y) * 0.62, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // Floodlights: a pole, a lamp, a soft halo.
    for (const side of [0.14, 0.86]) {
      const x = region.x + region.w * side;
      const top = hz - (hz - region.y) * 0.62;
      ctx.fillStyle = th.stands[1];
      ctx.fillRect(x - 2, top, 4, hz - top);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = th.glow;
      ctx.beginPath();
      ctx.arc(x, top, c.unit * 0.8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.light;
      roundedRectPath(ctx, { x: x - c.unit * 0.3, y: top - c.unit * 0.12, w: c.unit * 0.6, h: c.unit * 0.24 }, 3);
      ctx.fill();
    }
    // The stands: two bands and a crowd of dots.
    const standH = (hz - region.y) * 0.2;
    ctx.fillStyle = th.stands[0];
    ctx.fillRect(region.x, hz - standH, region.w, standH);
    ctx.fillStyle = th.stands[1];
    ctx.fillRect(region.x, hz - standH * 0.45, region.w, standH * 0.45);
    const dots = Math.min(90, Math.round(region.w / 7));
    for (let i = 0; i < dots; i++) {
      const col = hash(i + 7);
      ctx.fillStyle = col < 0.25 ? th.accent : col < 0.5 ? th.light : col < 0.75 ? th.chalk : th.sky[1];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(region.x + hash(i + 70) * region.w, hz - standH * (0.15 + hash(i + 140) * 0.8), 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function ground(th: Theme, c: Cam, runnerDist: number): void {
    const { region, hz } = c;
    ctx.fillStyle = th.grass[0];
    ctx.fillRect(region.x, hz, region.w, region.y + region.h - hz);
    // The grass in bands that slide with the run.
    ctx.fillStyle = th.grass[1];
    const k0 = Math.floor((runnerDist + NEAR) / BAND), k1 = Math.ceil((runnerDist + FAR) / BAND);
    for (let k = k0; k <= k1; k++) {
      if (k % 2) continue;
      const d0 = Math.max(NEAR - 0.2, k * BAND - runnerDist), d1 = Math.min(FAR, (k + 1) * BAND - runnerDist);
      if (d1 <= d0) continue;
      const ya = yAt(c, d0), yb = yAt(c, d1);
      ctx.fillRect(region.x, yb, region.w, ya - yb);
    }
    // The track.
    for (let k = k0; k <= k1; k++) {
      const d0 = Math.max(NEAR - 0.2, k * BAND - runnerDist), d1 = Math.min(FAR, (k + 1) * BAND - runnerDist);
      if (d1 <= d0) continue;
      ctx.fillStyle = th.track[((k % 2) + 2) % 2] ?? th.track[0];
      quad(c, -HALF, HALF, d0, d1);
    }
    // Chalk: the edges and the lane lines.
    ctx.fillStyle = th.edge;
    for (const x of [-HALF, HALF]) { ctx.globalAlpha = 0.9; quad(c, x - 0.07, x + 0.07, NEAR - 0.2, FAR); }
    ctx.globalAlpha = 0.6;
    for (const x of [-LANE_W / 2, LANE_W / 2]) quad(c, x - 0.035, x + 0.035, NEAR - 0.2, FAR);
    ctx.globalAlpha = 1;
  }

  /** Marks across the track every ten metres, and the number of every fifty. */
  function marks(th: Theme, c: Cam, s: Readonly<SprintState>, runnerDist: number): void {
    const m0 = Math.max(10, Math.ceil((runnerDist + NEAR) / 10) * 10);
    for (let m = m0; m <= Math.min(s.dist, runnerDist + FAR); m += 10) {
      const d = m - runnerDist;
      const big = m % 50 === 0;
      ctx.globalAlpha = big ? 0.75 : 0.28;
      ctx.fillStyle = th.chalk;
      quad(c, -HALF, HALF, d, d + (big ? 0.5 : 0.25));
      if (big || m % 20 === 0) {
        const px = clamp(c.unit * scaleAt(d) * 0.9, 9, 40);
        text(String(m), xAt(c, -HALF - 0.75, d), yAt(c, d + 0.3), px, th.chalk, { alpha: 0.8 });
      }
    }
    ctx.globalAlpha = 1;
  }

  function hurdle(th: Theme, c: Cam, d: number, fallen: boolean): void {
    const sc = scaleAt(d);
    const w = 0.85 * c.unit * sc, hgt = 0.95 * c.unit * sc;
    const x = xAt(c, 0, d), y = yAt(c, d);
    const post = Math.max(2, 0.08 * c.unit * sc);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = RUNNER.shadow;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 1.05, w * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (fallen) {
      ctx.fillStyle = th.accent;
      ctx.save();
      ctx.translate(x, y - post);
      ctx.rotate(0.35);
      ctx.fillRect(-w, -post, w * 2, post * 2.2);
      ctx.restore();
      return;
    }
    ctx.fillStyle = th.chalk;
    ctx.fillRect(x - w, y - hgt, post, hgt);
    ctx.fillRect(x + w - post, y - hgt, post, hgt);
    ctx.fillStyle = th.accent;
    ctx.fillRect(x - w, y - hgt, w * 2, Math.max(4, hgt * 0.2));
    ctx.fillStyle = th.chalk;
    for (let i = 0; i < 5; i++) ctx.fillRect(x - w + (w * 2 * (i + 0.25)) / 5, y - hgt, (w * 2) / 10, Math.max(4, hgt * 0.2));
  }

  function finishLine(th: Theme, c: Cam, d: number): void {
    // The tape across the track, a chequered band and the gantry over it.
    const cells = 12;
    const d1 = d + 0.9;
    for (let i = 0; i < cells; i++) {
      const x0 = -HALF + (i * HALF * 2) / cells, x1 = -HALF + ((i + 1) * HALF * 2) / cells;
      ctx.fillStyle = i % 2 ? th.chalk : '#1C1433';
      quad(c, x0, x1, d, d + 0.45);
      ctx.fillStyle = i % 2 ? '#1C1433' : th.chalk;
      quad(c, x0, x1, d + 0.45, d1);
    }
    const sc = scaleAt(d);
    const y = yAt(c, d), top = y - 3.2 * c.unit * sc;
    ctx.fillStyle = th.stands[1];
    ctx.fillRect(xAt(c, -HALF - 0.2, d) - 3, top, 6 * Math.max(0.5, sc), y - top);
    ctx.fillRect(xAt(c, HALF + 0.2, d) - 3, top, 6 * Math.max(0.5, sc), y - top);
    ctx.fillStyle = th.accent;
    ctx.fillRect(xAt(c, -HALF - 0.2, d), top, xAt(c, HALF + 0.2, d) - xAt(c, -HALF - 0.2, d), 0.6 * c.unit * sc);
    const bw = xAt(c, HALF, d) - xAt(c, -HALF, d);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? th.chalk : '#1C1433';
      ctx.fillRect(xAt(c, -HALF, d) + (bw * i) / 10, top + 0.6 * c.unit * sc, bw / 10, 0.3 * c.unit * sc);
    }
  }

  // ───────── a runner ─────────

  interface Pose { liftL: number; liftR: number; air: number; wobble: number; head: string; body: string; shade: string; stripe: string; alpha: number }

  function runner(x: number, feet: number, h: number, p: Pose, lean: number): void {
    ctx.globalAlpha = p.alpha;
    // Shadow stays on the ground; the body rises in the air.
    ctx.fillStyle = RUNNER.shadow;
    ctx.globalAlpha = 0.3 * p.alpha;
    ctx.beginPath();
    ctx.ellipse(x, feet + h * 0.01, h * 0.27 * (1 - p.air * 0.3), h * 0.055, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = p.alpha;
    const up = p.air * h * 0.34;
    const f = feet - up;
    ctx.save();
    ctx.translate(x, f);
    ctx.rotate(p.wobble + lean);
    ctx.translate(-x, -f);
    const hipY = f - h * 0.5, shY = f - h * 0.8;
    ctx.lineCap = 'round';
    // Legs: the far one first. A lifted knee shortens the leg and swings it out.
    const leg = (side: -1 | 1, lift: number, col: string): void => {
      const hipX = x + side * h * 0.055;
      const footX = x + side * h * (0.075 + lift * 0.04);
      const footY = f - lift * h * 0.3 - (p.air > 0 ? p.air * h * 0.08 : 0);
      ctx.strokeStyle = col;
      ctx.lineWidth = h * 0.1;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.quadraticCurveTo(x + side * h * (0.12 + lift * 0.1), (hipY + footY) / 2 - lift * h * 0.05, footX, footY);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(footX + side * h * 0.01, footY + h * 0.012, h * 0.075, h * 0.04, 0, 0, TAU);
      ctx.fill();
    };
    const first: -1 | 1 = p.liftL > p.liftR ? 1 : -1;
    leg(first, first === -1 ? p.liftL : p.liftR, p.shade);
    leg(-first as -1 | 1, first === -1 ? p.liftR : p.liftL, p.body);
    // Torso with a stripe down the back.
    ctx.fillStyle = p.body;
    roundedRectPath(ctx, { x: x - h * 0.13, y: shY, w: h * 0.26, h: hipY - shY + h * 0.04 }, h * 0.09);
    ctx.fill();
    ctx.fillStyle = p.stripe;
    ctx.fillRect(x - h * 0.025, shY + h * 0.03, h * 0.05, hipY - shY - h * 0.02);
    // Arms swing against the legs.
    const arm = (side: -1 | 1, swing: number): void => {
      ctx.strokeStyle = side === first ? p.shade : p.body;
      ctx.lineWidth = h * 0.07;
      ctx.beginPath();
      ctx.moveTo(x + side * h * 0.14, shY + h * 0.04);
      ctx.quadraticCurveTo(x + side * h * 0.27, shY + h * (0.13 - swing * 0.05), x + side * h * 0.21, shY + h * (0.22 - swing * 0.17));
      ctx.stroke();
    };
    arm(-1, p.liftR);
    arm(1, p.liftL);
    // Head with a band.
    ctx.fillStyle = p.head;
    ctx.beginPath();
    ctx.arc(x, shY - h * 0.1, h * 0.105, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.body;
    ctx.fillRect(x - h * 0.105, shY - h * 0.135, h * 0.21, h * 0.03);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  const liftOf = (time: number, at: number, knee: number): number => Math.max(clamp(1 - (time - at) / 0.3, 0, 1), clamp(knee, 0, 1));

  function drawRunnerOf(c: Cam, f: SprintFrame, i: number, l: LaneState, x: number, d: number, computer: boolean): void {
    const sc = scaleAt(d);
    const h = runnerHeight(c.lane) * sc;
    const y = yAt(c, d);
    const jump = l.sinceAct < 0.55 ? 4 * (l.sinceAct / 0.55) * (1 - l.sinceAct / 0.55) : 0;
    const running = l.v > 0.4 || f.s.phase === 'warmup';
    const stumble = l.stumble > 0 ? ((Math.floor(f.time * 9) % 2) ? 0.06 : -0.06) * Math.min(1, l.stumble * 3) : 0;
    const cycle = running && !computer ? 0 : 0;
    const pose: Pose = {
      liftL: running ? liftOf(f.time, l.stepAt[0], l.kneeNow[0]) : 0,
      liftR: running ? liftOf(f.time, l.stepAt[1], l.kneeNow[1]) : 0,
      air: jump,
      wobble: stumble + cycle,
      head: computer ? RUNNER.computerHead : i === 1 ? RUNNER.headP2 : RUNNER.head,
      body: computer ? RUNNER.computer : RUNNER.body,
      shade: computer ? '#7C7699' : RUNNER.shade,
      stripe: computer ? RUNNER.computerHead : i === 1 ? RUNNER.headP2 : RUNNER.head,
      alpha: 1,
    };
    runner(x, y, h, pose, clamp(l.v / 14, 0, 0.5) * 0.12);
  }

  /** The computer runs as the state says: strides from its speed, no steps to read. */
  function drawRival(c: Cam, f: SprintFrame, d: number): void {
    const r = f.s.rival;
    if (!r) return;
    const sc = scaleAt(d);
    const h = runnerHeight(c.lane) * sc;
    const x = xAt(c, LANE_W, d), y = yAt(c, d);
    const beat = f.time * (r.speed * 1.9) * 0.5;
    const ph = beat - Math.floor(beat);
    const a = r.dist > 0 && !r.finished ? smoothstep(1 - Math.abs(ph * 2 - 1)) : 0;
    const b = r.dist > 0 && !r.finished ? smoothstep(1 - Math.abs(((ph + 0.5) % 1) * 2 - 1)) : 0;
    runner(x, y, h, { liftL: a * 0.8, liftR: b * 0.8, air: 0, wobble: 0, head: RUNNER.computerHead, body: RUNNER.computer, shade: '#7C7699', stripe: RUNNER.computerHead, alpha: 0.95 }, 0.03);
    const px = clamp(h * 0.16, 9, 18);
    const label = say('rival.name');
    ctx.font = `800 ${Math.round(px)}px ${FONT}`;
    const w = ctx.measureText(label).width + px * 1.2;
    plate(x, y - h * 1.12, w, px * 1.7, 0.78);
    text(label, x, y - h * 1.12, px, '#F4F2F8');
  }

  // ───────── the instruments ─────────

  function meters(c: Cam, f: SprintFrame, i: number, l: LaneState, avoid: readonly (Rect | null)[]): void {
    const s = f.s;
    const wBar = clamp(c.lane.w * 0.026, 9, 16), hBar = clamp(c.lane.h * 0.22, 54, 150);
    const gap = wBar * 0.7;
    const box0: Rect = { x: c.lane.x + clamp(c.lane.w * 0.03, 10, 28), y: c.lane.y + c.lane.h * 0.55, w: wBar * 3 + gap * 2, h: hBar };
    const box = clearOf(box0, avoid, c.lane);
    const pace = s.cadFull > 0 ? clamp((f.cadence[i] ?? 0) / s.cadFull, 0, 1.15) : 0;
    const bars: { v: number; ticks: number[]; hot: number }[] = [
      { v: l.kneeNow[0], ticks: [0.5, s.kFull], hot: s.kFull },
      { v: l.kneeNow[1], ticks: [0.5, s.kFull], hot: s.kFull },
      { v: pace, ticks: [1], hot: 1 },
    ];
    ctx.save();
    ctx.globalAlpha = 0.9;
    bars.forEach((b, k) => {
      const x = box.x + k * (wBar + gap);
      ctx.fillStyle = 'rgba(28, 20, 51, 0.7)';
      roundedRectPath(ctx, { x, y: box.y, w: wBar, h: box.h }, wBar / 2);
      ctx.fill();
      const fill = clamp(b.v / 1.1, 0, 1) * box.h;
      ctx.fillStyle = b.v >= b.hot ? '#FFC53A' : '#F4F2F8';
      if (fill > 1) { roundedRectPath(ctx, { x, y: box.y + box.h - fill, w: wBar, h: fill }, wBar / 2); ctx.fill(); }
      ctx.fillStyle = '#FF4F6E';
      for (const t of b.ticks) ctx.fillRect(x - 2, box.y + box.h - (t / 1.1) * box.h - 1, wBar + 4, 2);
    });
    ctx.restore();
  }

  function progress(c: Cam, f: SprintFrame, i: number, avoid: readonly (Rect | null)[]): void {
    const s = f.s;
    const len = clamp(c.lane.h * 0.42, 70, 260);
    const box0: Rect = { x: c.lane.x + c.lane.w - clamp(c.lane.w * 0.03, 12, 30) - 8, y: c.lane.y + c.lane.h * 0.04, w: 8, h: len };
    const box = clearOf(box0, avoid, c.lane);
    ctx.save();
    ctx.fillStyle = 'rgba(28, 20, 51, 0.7)';
    roundedRectPath(ctx, { x: box.x, y: box.y, w: box.w, h: box.h }, 4);
    ctx.fill();
    ctx.fillStyle = '#F4F2F8';
    ctx.fillRect(box.x - 4, box.y - 1, box.w + 8, 3);
    const at = (d: number): number => box.y + box.h - clamp(d / s.dist, 0, 1) * box.h;
    // Every runner's mark: the one of this lane in its colour, the others (the computer, the other player) hollow.
    const mark = (d: number, color: string, hollow: boolean): void => {
      ctx.beginPath();
      ctx.arc(box.x + box.w / 2, at(d), 7, 0, TAU);
      if (hollow) { ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke(); } else { ctx.fillStyle = color; ctx.fill(); }
    };
    if (s.rival) mark(f.rival, '#CFCBE0', true);
    if (s.players === 2) f.dist.forEach((d, k) => { if (k !== i) mark(d, k === 1 ? RUNNER.headP2 : RUNNER.head, true); });
    mark(f.dist[i] ?? 0, i === 1 ? RUNNER.headP2 : RUNNER.head, false);
    ctx.restore();
  }

  // ───────── messages ─────────

  function banner(c: Cam, f: SprintFrame, i: number): void {
    const s = f.s;
    const l = s.lanes[i] as LaneState;
    const lane = c.lane;
    const cx = lane.x + lane.w / 2;
    const px = clamp(lane.h * 0.034, 13, 30);
    const w = Math.min(lane.w * 0.9, px * 22);
    const cy = lane.y + lane.h * 0.3;
    if (s.players === 2 && s.phase !== 'finish' && s.phase !== 'play') {
      // A name over each half so that the colour is never alone.
    }
    if (s.phase === 'warmup') {
      const body = say(f.how === 'swing' ? 'warm.seated' : f.how === 'keys' ? 'warm.keys' : f.how === 'touch' ? 'warm.touch' : 'warm.body');
      const h = px * 7;
      plate(cx, cy, w, h);
      text(say('warm.title'), cx, cy - h * 0.36, px * 1.15, '#FFC53A');
      lines(cx, cy - h * 0.13, w - px * 1.4, body, px * 0.9, '#F4F2F8');
      const n = s.seated && f.how === 'swing' ? 8 : WARMUP.steps;
      const done = s.seated && f.how === 'swing' ? Math.min(n, Math.floor((s.warm.t / WARMUP.seatedSec) * n)) : s.warm.stepT.length;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = k < done ? '#22C383' : 'rgba(244,242,248,0.3)';
        ctx.beginPath();
        ctx.arc(cx + (k - (n - 1) / 2) * px * 1.15, cy + h * 0.38, px * 0.3, 0, TAU);
        ctx.fill();
      }
      return;
    }
    if (s.phase === 'ready') {
      const n = Math.max(1, Math.ceil(READY_SEC - s.hc - 1e-9));
      const h = px * 6.4;
      plate(cx, cy, w, h);
      text(say('heat.label', { n: s.heat, total: s.heats }), cx, cy - h * 0.34, px * 0.95, '#F4F2F8', { weight: 700 });
      text(say('heat.metres', { dist: s.dist }), cx, cy - h * 0.1, px * 0.85, '#F4F2F8', { weight: 700, alpha: 0.8 });
      text(say('ready.body', { cad: Math.round(s.cadFull) }), cx, cy + h * 0.38, px * 0.78, '#F4F2F8', { weight: 700, alpha: 0.85 });
      const k = 1 - (s.hc % 1);
      text(String(n), cx, lane.y + lane.h * 0.55, clamp(lane.h * 0.16, 56, 150) * (0.85 + 0.15 * smoothstep(k)), '#FFC53A', { alpha: 0.95 });
      return;
    }
    if (s.phase === 'rest') {
      const h = px * 6.6;
      plate(cx, cy, w, h);
      text(say('rest.title'), cx, cy - h * 0.3, px * 1.1, '#FFC53A');
      text(String(Math.ceil(s.restLeft)), cx, cy + h * 0.02, px * 2.3, '#F4F2F8');
      text(say('rest.next', { n: s.heat + 1, total: s.heats }), cx, cy + h * 0.36, px * 0.85, '#F4F2F8', { weight: 700 });
      const last = l.results[l.results.length - 1];
      if (last && last.medal !== 'dnf') text(`${say(`finish.${last.medal}`)}  ${last.time.toFixed(1)}`, cx, cy - h * 0.58, px * 0.85, MEDAL_COLORS[last.medal], { weight: 700 });
      return;
    }
    if (s.phase === 'play' && s.hc < 0.9 && s.players === 1) {
      text(say('cmd.go'), cx, lane.y + lane.h * 0.45, clamp(lane.h * 0.14, 48, 130), '#22C383', { alpha: 1 - s.hc / 0.9 });
    }
    if (s.phase === 'finish' || (l.finished && s.phase === 'play')) {
      const last = l.results[l.results.length - 1];
      if (!last) return;
      const h = px * 6.8;
      const y = lane.y + lane.h * 0.3;
      plate(cx, y, w, h, 0.9);
      if (last.medal === 'dnf') {
        text(say('dnf.title'), cx, y, px * 1.2, '#CFCBE0');
        return;
      }
      const col = MEDAL_COLORS[last.medal];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx - w * 0.36, y, px * 1.45, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1C1433';
      ctx.font = `800 ${Math.round(px * 1.5)}px ${FONT}`;
      text(String(s.players === 2 ? last.rank : s.heat), cx - w * 0.36, y, px * 1.5, '#1C1433');
      text(say(`finish.${last.medal}`), cx + w * 0.08, y - h * 0.25, px * 1.2, col, { align: 'left' });
      text(say('finish.time', { time: last.time.toFixed(1) }), cx + w * 0.08, y + h * 0.05, px * 1, '#F4F2F8', { align: 'left' });
      const note = s.players === 2 ? say(last.rank === 1 ? 'finish.first' : 'finish.second') : s.rival ? say(last.beatRival ? 'finish.beat' : 'finish.lost') : '';
      if (note) text(note, cx, y + h * 0.36, px * 0.82, '#F4F2F8', { weight: 700, alpha: 0.9 });
    }
  }

  /** The race clock on the track, in tenths: the plate above says whole seconds. */
  function clock(c: Cam, f: SprintFrame, i: number): void {
    const s = f.s;
    if (s.phase !== 'play' && s.phase !== 'finish') return;
    const l = s.lanes[i] as LaneState;
    const t = l.finished && !l.dnf ? l.finishT : s.hc;
    const px = clamp(c.lane.h * 0.05, 16, 42);
    const cx = c.lane.x + c.lane.w / 2;
    const y = c.lane.y + c.lane.h * 0.06;
    text(t.toFixed(1), cx, y, px, '#F4F2F8', { alpha: s.phase === 'finish' ? 0.5 : 0.95 });
    if (s.phase === 'play' && !l.finished) {
      const [g, sv, b] = medalTimes(s);
      const goal = t <= g ? g : t <= sv ? sv : t <= b ? b : 0;
      if (goal > 0) text(`${goal.toFixed(1)}`, cx, y + px * 1.05, px * 0.5, t <= g ? MEDAL_COLORS.gold : t <= sv ? MEDAL_COLORS.silver : MEDAL_COLORS.bronze, { alpha: 0.9 });
    }
  }

  // ───────── one lane ─────────

  function drawLane(f: SprintFrame, i: number, lane: Rect, region: Rect, avoid: readonly (Rect | null)[]): void {
    const s = f.s;
    const l = s.lanes[i] as LaneState;
    const th = themeOf(s.heat);
    const c: Cam = { lane, region, hz: region.y + region.h * 0.3, feet: lane.y + lane.h * 0.8, unit: unitOf(lane), cx: lane.x + lane.w / 2 };
    const dist = f.dist[i] ?? l.dist;
    ctx.save();
    if (o.players === 2) { ctx.beginPath(); ctx.rect(region.x, region.y, region.w, region.h); ctx.clip(); }
    if (shake > 0.01 && !o.reducedMotion) ctx.translate((o.rng() - 0.5) * shake * lane.h * 0.025, (o.rng() - 0.5) * shake * lane.h * 0.025);
    backdrop(th, c);
    ground(th, c, dist);
    marks(th, c, s, dist);
    // Everything on the track, far to near.
    const items: { d: number; draw: () => void }[] = [];
    s.hurdles.forEach((hx, k) => {
      const d = hx - dist;
      if (d > NEAR && d < FAR) items.push({ d, draw: () => hurdle(th, c, d, knocked.has(`${s.heat}:${hx}`) && k < l.next) });
    });
    if (s.dist - dist < FAR && s.dist - dist > NEAR) items.push({ d: s.dist - dist, draw: () => finishLine(th, c, s.dist - dist) });
    if (s.rival) {
      const d = f.rival - dist;
      if (d > NEAR + 0.2 && d < FAR) items.push({ d, draw: () => drawRival(c, f, d) });
    }
    items.push({ d: 0, draw: () => drawRunnerOf(c, f, i, l, c.cx, 0, false) });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();
    const h = runnerHeight(lane);
    runners[i] = { x: c.cx, y: c.feet - h * 0.5, r: h * 0.3 };
    // Speed lines at the edges when the pace is high.
    const vmax = levelFor(s).vmax;
    if (!o.reducedMotion && l.v > vmax * 0.6 && s.phase === 'play') {
      ctx.globalAlpha = 0.14 * clamp(l.v / vmax, 0, 1);
      ctx.fillStyle = th.chalk;
      for (let k = 0; k < 10; k++) {
        const side = k % 2 ? 1 : -1;
        const u = (f.time * 1.7 + hash(k + 5)) % 1;
        const x = c.cx + side * (lane.w * (0.25 + 0.2 * hash(k + 20)) + u * lane.w * 0.2);
        ctx.fillRect(x, c.hz + (c.feet - c.hz) * (0.15 + u * 0.8), 2, 10 + u * 30);
      }
      ctx.globalAlpha = 1;
    }
    if (flash[i]! > 0.01 && !o.reducedMotion) {
      ctx.globalAlpha = flash[i]! * 0.25;
      ctx.fillStyle = '#FF4F6E';
      ctx.fillRect(region.x, region.y, region.w, region.h);
      ctx.globalAlpha = 1;
    }
    clock(c, f, i);
    meters(c, f, i, l, avoid);
    progress(c, f, i, avoid);
    if (o.players === 2) {
      const px = clamp(lane.h * 0.032, 12, 24);
      const label = say(`player.${i + 1}`);
      ctx.font = `800 ${Math.round(px)}px ${FONT}`;
      const w = ctx.measureText(label).width + px * 1.4;
      const col = i === 1 ? RUNNER.headP2 : RUNNER.head;
      const y = c.feet - h * 1.2;
      plate(c.cx, y, w, px * 1.8, 0.8);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(c.cx - w / 2 + px * 0.7, y, px * 0.28, 0, TAU);
      ctx.fill();
      text(label, c.cx + px * 0.3, y, px, '#F4F2F8');
    }
    ctx.restore();
    void c;
  }

  function react(f: SprintFrame, lanes: Rect[]): void {
    const s = f.s;
    for (const e of f.fx) {
      if (e.type === 'hurdle' && !e.cleared) knocked.add(`${s.heat}:${e.at}`);
      if (!('lane' in e)) continue;
      const lane = lanes[e.lane] ?? (lanes[0] as Rect);
      const at = runners[e.lane];
      if (!at) continue;
      const h = runnerHeight(lane);
      const feet = at.y + h * 0.5;
      if (e.type === 'step') {
        stage.particles.burst(at.x + (e.leg === 0 ? -1 : 1) * h * 0.1, feet, e.high ? 7 : 3, { speed: [20, 70], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.25, 0.5], size: [h * 0.012, h * 0.03], gravity: 40, drag: 1.8, colors: ['#BFB9D6', '#F4F2F8'], shape: 'dot' });
      } else if (e.type === 'hurdle') {
        if (e.cleared) {
          stage.particles.burst(at.x, at.y, 9, { speed: [60, 190], life: [0.35, 0.8], size: [h * 0.02, h * 0.04], gravity: 120, colors: ['#FFC53A', '#F4F2F8', '#FF4F6E'], shape: ['star', 'dot'] });
          pops.push({ text: `+${e.pts}`, x: at.x + h * 0.4, y: at.y - h * 0.55, age: 0, life: 0.9, color: '#FFC53A', size: clamp(lane.h * 0.04, 14, 34) });
        } else {
          stage.particles.burst(at.x, feet, 14, { speed: [80, 240], life: [0.4, 0.9], size: [h * 0.02, h * 0.045], gravity: 260, drag: 0.8, colors: ['#FF4F6E', '#F4F2F8', '#1C1433'], shape: ['dot', 'square'] });
          shake = 1;
          flash[e.lane] = 1;
        }
      } else if (e.type === 'finish') {
        const col = MEDAL_COLORS[e.medal];
        stage.particles.burst(at.x, at.y - h * 0.3, e.medal === 'dnf' ? 0 : 26, { speed: [90, 340], life: [0.7, 1.5], size: [h * 0.02, h * 0.05], gravity: 220, colors: [col, '#F4F2F8', '#FF4F6E', '#46B4FF'], shape: ['star', 'dot', 'square'] });
      } else if (e.type === 'jump') {
        stage.particles.burst(at.x, feet, 5, { speed: [30, 100], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.3, 0.6], size: [h * 0.015, h * 0.035], gravity: 50, drag: 1.5, colors: ['#BFB9D6', '#F4F2F8'], shape: 'dot' });
      }
    }
  }

  return {
    render(f) {
      if (disposed) return;
      const r = stage.rects();
      stage.setCamera(o.self.aspect());
      stage.begin();
      const lanes: Rect[] = r.lanes ?? [r.play];
      shake = Math.max(0, shake - f.dt * 3.2);
      flash = flash.map((v) => Math.max(0, v - f.dt * 3.5));
      if (f.s.phase === 'warmup' || f.s.phase === 'ready') knocked.clear();
      const plates: Rect[] = Object.values(r.hud);
      const avoid: (Rect | null)[] = [r.pip, ...plates];
      for (let i = 0; i < o.players; i++) {
        const lane = lanes[i] as Rect;
        const region: Rect = o.players === 2 ? { x: lane.x, y: 0, w: lane.w, h: r.h } : { x: 0, y: 0, w: r.w, h: r.h };
        drawLane(f, i, lane, region, avoid);
      }
      react(f, lanes);
      stage.particles.update(f.dt);
      stage.particles.draw(ctx);
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i] as Pop;
        p.age += f.dt;
        if (p.age >= p.life) { pops.splice(i, 1); continue; }
        const u = p.age / p.life;
        text(p.text, p.x, p.y - u * p.size * 1.6, p.size, p.color, { alpha: 1 - u * u });
      }
      for (let i = 0; i < o.players; i++) {
        const lane = lanes[i] as Rect;
        const c: Cam = { lane, region: lane, hz: 0, feet: 0, unit: unitOf(lane), cx: lane.x + lane.w / 2 };
        banner(c, f, i);
      }
      if (r.pip) {
        const players = o.players === 2 ? [{ slot: 1 as const, landmarks: o.self.landmarks(1) }, { slot: 2 as const, landmarks: o.self.landmarks(2) }] : [{ slot: 1 as const, landmarks: o.self.landmarks(1) }];
        pip.draw(ctx, r.pip, { image: o.self.image(), players, dtMs: Math.max(16, f.dt * 1000), divider: o.players === 2, on: true });
      }
    },
    runnerAt: (lane) => runners[lane] ?? null,
    dispose() {
      disposed = true;
      gradients.clear();
      pops.length = 0;
      knocked.clear();
      stage.particles.clear();
    },
  };
}

void clockOf;
