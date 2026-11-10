// Squat Flap's painted world, far to near: the sky (with its high wisps, the sun or the moon and the stars), the far
// range, the clouds, the middle range with mist at its foot, the near hills with their trees, the bushes and the ground.
//
// Every layer is painted once per biome and screen size into a canvas of its own: a strip one tile wide that repeats
// along the course and is copied each frame at its own parallax (a copy at whole device pixels, so a phone that draws
// the canvas without a graphics chip only moves pixels). Each cloud is a small canvas of its own and drifts at its own
// depth. A new biome is painted one layer per frame while the old one is still shown, and swapped in when complete, so
// changing biome never costs a frame. Where there is no canvas to paint on off screen (tests in Node) every layer is
// painted straight onto the screen.
//
// The light comes from the sun's side (upper right): lit faces look right, the shade is on the left.
import type { Rect } from '../kit-g1/stage.ts';
import type { Biome, Paint } from './content.ts';

const TAU = Math.PI * 2;

// ───────── colour ─────────

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => { const n = Number.parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const cssOf = (c: Rgb, alpha = 1): string => (alpha >= 1 ? `rgb(${c.map(Math.round).join(',')})` : `rgba(${c.map(Math.round).join(',')},${Math.max(0, alpha).toFixed(3)})`);
/** Hex colour a mixed toward hex colour b by t (0..1), as a CSS colour. */
export const mix = (a: string, b: string, t: number, alpha = 1): string => {
  const x = rgbOf(a), y = rgbOf(b);
  return cssOf([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t], alpha);
};
export const fade = (hex: string, alpha: number): string => cssOf(rgbOf(hex), alpha);

/** A small seeded random stream for painting (the picture is the same every time; nothing here touches the game). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (n: number): number => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

type C2 = CanvasRenderingContext2D;
type Pts = number[];

function path(c: C2, p: Pts, close = true): void {
  c.beginPath();
  c.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i]!, p[i + 1]!);
  if (close) c.closePath();
}

function vgrad(c: C2, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

/** Softens what is painted next, where the canvas can (painted once, so the cost does not matter). */
function soften(c: C2, px: number): void { try { (c as unknown as { filter: string }).filter = px > 0 ? `blur(${px.toFixed(1)}px)` : 'none'; } catch { /* no filter: crisp edges */ } }

// ───────── where things are ─────────

/**
 * The lane in screen pixels: the top of the region, the ground line, the bottom, and the tile width the layers repeat at.
 * `lean`: painted straight onto the screen every frame (no off-screen canvas, tests in Node), so the fine texture (stars,
 * grass strokes, blades, pebbles, rims) is left out and only the forms are drawn.
 */
export interface Env { T: number; G: number; B: number; h: number; laneX: number; laneW: number; regionX: number; regionW: number; W: number; lean?: boolean }

export function envOf(region: Rect, lane: Rect, ground: number): Env {
  return {
    T: region.y, G: ground, B: region.y + region.h, h: lane.h, laneX: lane.x, laneW: lane.w, regionX: region.x, regionW: region.w,
    // A phone held upright repeats its hills less often than its width would.
    W: Math.max(region.w, lane.h * 1.15),
  };
}

// ───────── the sky ─────────

function paintSky(c: C2, b: Biome, P: Paint, e: Env): void {
  const { T, G } = e;
  const H = G - T;
  c.fillStyle = vgrad(c, T, G, [[0, P.sky[0]], [0.42, P.sky[1]], [0.8, P.sky[2]], [1, P.sky[3]]]);
  c.fillRect(e.regionX, T, e.regionW, H + 8);
  const sx = e.laneX + e.laneW * P.sun.x, sy = T + H * P.sun.y, r = Math.max(14, e.h * P.sun.r);
  const night = b.stars;
  // The horizon warms under the sun: a wide oval of its light lying on the ground line.
  c.save();
  c.translate(sx, G);
  c.scale(2.4, 1);
  const hr = H * 0.62;
  const hg = c.createRadialGradient(0, 0, 0, 0, 0, hr);
  hg.addColorStop(0, fade(P.light, night ? 0.16 : 0.5));
  hg.addColorStop(0.45, fade(P.light, night ? 0.06 : 0.18));
  hg.addColorStop(1, fade(P.light, 0));
  c.fillStyle = hg;
  c.fillRect(-hr, -hr, hr * 2, hr);
  c.restore();
  const rand = seeded(b.id.length * 977 + 13);
  if (night) {
    // A faint band of the galaxy, then the stars, a few of them with a glint.
    soften(c, Math.max(4, H * 0.02));
    for (let i = 0; i < (e.lean ? 0 : 26); i++) {
      const u = i / 26;
      const x = e.regionX + e.regionW * (0.05 + u * 0.9), y = T + H * (0.62 - u * 0.5) + (rand() - 0.5) * H * 0.08;
      c.globalAlpha = 0.05 + rand() * 0.05;
      c.fillStyle = i % 3 ? '#8E82D8' : '#C9B8F0';
      c.beginPath();
      c.ellipse(x, y, H * (0.06 + rand() * 0.08), H * (0.025 + rand() * 0.03), -0.5, 0, TAU);
      c.fill();
    }
    soften(c, 0);
    const n = e.lean ? 0 : Math.round(90 + e.regionW * 0.06);
    for (let i = 0; i < n; i++) {
      const x = e.regionX + rand() * e.regionW, y = T + Math.pow(rand(), 1.3) * H * 0.82;
      const big = rand() > 0.93;
      c.globalAlpha = 0.25 + rand() * 0.7;
      c.fillStyle = rand() > 0.8 ? '#FFE9C4' : '#F4F2FF';
      const s = big ? 2.4 : 0.8 + rand() * 1.2;
      c.fillRect(x - s / 2, y - s / 2, s, s);
      if (big) { c.globalAlpha *= 0.5; c.fillRect(x - s * 2.2, y - 0.4, s * 4.4, 0.8); c.fillRect(x - 0.4, y - s * 2.2, 0.8, s * 4.4); }
    }
    c.globalAlpha = 1;
  } else {
    // Rays from the sun, very faint.
    c.save();
    c.translate(sx, sy);
    c.fillStyle = fade(P.light, 0.07);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.2 + rand() * 0.25, wdt = 0.03 + rand() * 0.05, len = H * (0.6 + rand() * 0.7);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a - wdt) * len, Math.sin(a - wdt) * len);
      c.lineTo(Math.cos(a + wdt) * len, Math.sin(a + wdt) * len);
      c.closePath();
      c.fill();
    }
    c.restore();
    // High wisps, soft, lit from below near the horizon at dawn and dusk.
    soften(c, Math.max(2, H * 0.006));
    for (let i = 0; i < (e.lean ? 0 : 9); i++) {
      const x = e.regionX + rand() * e.regionW, y = T + H * (0.08 + rand() * 0.32);
      const w = H * (0.12 + rand() * 0.22);
      c.globalAlpha = 0.18 + rand() * 0.2;
      c.fillStyle = i % 2 ? P.cloud.lit : mix(P.cloud.lit, P.light, 0.5);
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        c.ellipse(x + (k - 1) * w * 0.45, y + (k - 1) * w * 0.02, w * (0.5 - Math.abs(k - 1) * 0.15), w * 0.022 + 1, -0.04, 0, TAU);
        c.fill();
      }
    }
    soften(c, 0);
    c.globalAlpha = 1;
  }
  // The glow, then the disc: lighter in its middle (the moon gets a few seas).
  const R = r * (night ? 5 : 7);
  const g = c.createRadialGradient(sx, sy, r * 0.7, sx, sy, R);
  g.addColorStop(0, fade(P.sun.color, night ? 0.4 : 0.7));
  g.addColorStop(0.2, fade(P.sun.color, night ? 0.14 : 0.3));
  g.addColorStop(0.55, fade(P.sun.color, night ? 0.04 : 0.08));
  g.addColorStop(1, fade(P.sun.color, 0));
  c.fillStyle = g;
  c.fillRect(sx - R, sy - R, R * 2, R * 2);
  const d = c.createRadialGradient(sx - r * 0.25, sy - r * 0.3, r * 0.1, sx, sy, r);
  d.addColorStop(0, '#FFFFFF');
  d.addColorStop(0.6, P.sun.color);
  d.addColorStop(1, mix(P.sun.color, P.light, 0.4));
  c.fillStyle = d;
  c.beginPath();
  c.arc(sx, sy, r, 0, TAU);
  c.fill();
  if (night) {
    c.fillStyle = fade('#9C93C9', 0.28);
    for (const [ox, oy, rr] of [[-0.3, -0.15, 0.24], [0.25, 0.2, 0.18], [0.05, -0.42, 0.12], [-0.1, 0.45, 0.14]] as const) {
      c.beginPath();
      c.arc(sx + ox * r, sy + oy * r, rr * r, 0, TAU);
      c.fill();
    }
  }
}

// ───────── ranges ─────────

interface RangeLook { lit: string; shade: string; light: string; snow: [string, string] | null; air: string; contrast: number }

/** One mountain: a jagged silhouette, its shaded left face behind a crease from the summit, gullies, a lit ridge, snow. */
function peak(c: C2, cx: number, G: number, ph: number, wl: number, wr: number, rand: () => number, L: RangeLook): void {
  const K = 11;
  const left: Pts = [], right: Pts = [];
  for (let i = 0; i <= K; i++) {
    const t = i / K, edge = i === 0 || i === K;
    const jy = edge ? 0 : (rand() - 0.5) * ph * 0.1 * Math.sin(Math.PI * t);
    const jx = edge ? 0 : (rand() - 0.5) * wl * 0.05;
    left.push(cx - wl * (1 - t) + jx, G - ph * Math.pow(t, 1.3) + jy);
  }
  for (let i = K; i >= 0; i--) {
    const t = i / K, edge = i === 0 || i === K;
    const jy = edge ? 0 : (rand() - 0.5) * ph * 0.1 * Math.sin(Math.PI * t);
    const jx = edge ? 0 : (rand() - 0.5) * wr * 0.05;
    right.push(cx + wr * (1 - t) + jx, G - ph * Math.pow(t, 1.3) + jy);
  }
  const outline = left.concat(right.slice(2));
  // The crease from the summit down to the foot: the shaded face lies to its left.
  const end = cx - wl * (0.08 + rand() * 0.22);
  const crease: Pts = [];
  for (let i = 1; i <= K; i++) {
    const t = i / K;
    crease.push(cx + (end - cx) * t + (rand() - 0.5) * wl * 0.16 * Math.sin(Math.PI * t), G - ph + ph * Math.pow(t, 0.85));
  }
  path(c, outline);
  c.fillStyle = vgrad(c, G - ph, G, [[0, L.lit], [1, mix(rgbHex(L.lit), rgbHex(L.shade), 0.35)]]);
  c.fill();
  // Shadow polygon: up the left edge to the summit, down the crease to the foot.
  const sh: Pts = left.slice();
  for (let i = 0; i < crease.length; i++) sh.push(crease[i]!);
  path(c, sh);
  c.globalAlpha = L.contrast;
  c.fillStyle = vgrad(c, G - ph, G, [[0, L.shade], [1, mix(rgbHex(L.shade), rgbHex(L.lit), 0.25)]]);
  c.fill();
  c.globalAlpha = 1;
  // Gullies down the lit face, and the lit ridge.
  c.strokeStyle = fade(rgbHex(L.shade), 0.32 * L.contrast + 0.08);
  c.lineWidth = Math.max(1, ph * 0.008);
  c.lineCap = 'round';
  for (let g = 0; g < 3; g++) {
    const t = 0.35 + rand() * 0.5;
    let x = cx + wr * (1 - t) * (0.3 + rand() * 0.5), y = G - ph * Math.pow(t, 1.3) + ph * 0.05;
    c.beginPath();
    c.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x -= wr * (0.02 + rand() * 0.05); y += ph * (0.06 + rand() * 0.08); c.lineTo(x, Math.min(G, y)); }
    c.stroke();
  }
  // The lit ridge: only the upper part of the sunlit edge, so a pale far peak does not read as a stray line.
  c.strokeStyle = fade(rgbHex(L.light), 0.55 * L.contrast * L.contrast);
  c.lineWidth = Math.max(1, ph * 0.008);
  c.beginPath();
  const half = Math.floor(right.length * 0.36) & ~1;
  c.moveTo(right[0]!, right[1]!);
  for (let i = 2; i < half; i += 2) c.lineTo(right[i]!, right[i + 1]!);
  c.stroke();
  if (L.snow && ph > 0) {
    const line = G - ph * (0.7 + rand() * 0.1);
    c.save();
    path(c, outline);
    c.clip();
    const cap: Pts = [cx - wl - 4, G - ph - 4];
    const steps = 12;
    for (let j = 0; j <= steps; j++) {
      const x = cx - wl + (wl + wr) * (j / steps);
      const drip = rand() < 0.4 ? ph * (0.05 + rand() * 0.14) : 0;
      cap.push(x, line + (j % 2 ? ph * 0.05 * rand() : -ph * 0.04 * rand()) + drip);
    }
    cap.push(cx + wr + 4, G - ph - 4);
    path(c, cap);
    c.fillStyle = L.snow[0];
    c.fill();
    path(c, sh);
    c.clip();
    path(c, cap);
    c.fillStyle = L.snow[1];
    c.fill();
    c.restore();
  }
}

/** A flat-topped mesa with banded rock, its left cliff in shade. */
function mesa(c: C2, cx: number, G: number, ph: number, w: number, rand: () => number, L: RangeLook): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, d = Math.min(w * 0.2, ph * 0.5);
  const top = G - ph;
  const out: Pts = [x0 - ph * 0.4, G, x0 + d * 0.3, G - ph * 0.32, x0 + d * 0.62, G - ph * 0.55, x0 + d * 0.7, G - ph * 0.82, x0 + d, top];
  const steps = 6;
  for (let j = 1; j < steps; j++) out.push(x0 + d + (w - 2 * d) * (j / steps), top + (rand() - 0.5) * ph * 0.04);
  out.push(x1 - d, top, x1 - d * 0.75, G - ph * 0.8, x1 - d * 0.6, G - ph * 0.55, x1 - d * 0.25, G - ph * 0.3, x1 + ph * 0.45, G);
  path(c, out);
  c.fillStyle = vgrad(c, top, G, [[0, L.lit], [1, mix(rgbHex(L.lit), rgbHex(L.shade), 0.4)]]);
  c.fill();
  c.save();
  path(c, out);
  c.clip();
  for (let s = 0; s < 5; s++) {
    const y = top + ph * (0.14 + s * 0.17 + rand() * 0.04);
    c.fillStyle = fade(s % 2 ? rgbHex(L.light) : rgbHex(L.shade), s % 2 ? 0.16 : 0.22);
    c.fillRect(x0 - ph, y, w + ph * 2, ph * (0.03 + rand() * 0.03));
  }
  // The left cliff and the talus under it are in shade.
  c.globalAlpha = L.contrast;
  c.fillStyle = L.shade;
  path(c, [x0 - ph * 0.4, G, x0 + d * 0.3, G - ph * 0.32, x0 + d * 0.62, G - ph * 0.55, x0 + d * 0.7, G - ph * 0.82, x0 + d, top, x0 + d * 1.5, top + ph * 0.1, x0 + d * 1.3, G - ph * 0.45, x0 + d * 1.6, G]);
  c.fill();
  c.globalAlpha = 1;
  c.restore();
  c.strokeStyle = fade(rgbHex(L.light), 0.55);
  c.lineWidth = Math.max(1, ph * 0.012);
  c.beginPath();
  c.moveTo(x0 + d, top);
  c.lineTo(x1 - d, top);
  c.lineTo(x1 - d * 0.75, G - ph * 0.8);
  c.stroke();
}

/** A sand dune: a gentle lit windward slope on the right, a steep shaded lee on the left, ripples. */
function dune(c: C2, cx: number, G: number, ph: number, wl: number, wr: number, rand: () => number, L: RangeLook): void {
  const top = G - ph;
  c.beginPath();
  c.moveTo(cx - wl, G);
  c.quadraticCurveTo(cx - wl * 0.18, G - ph * 0.2, cx, top);
  c.quadraticCurveTo(cx + wr * 0.45, top + ph * 0.02, cx + wr, G);
  c.closePath();
  c.fillStyle = vgrad(c, top, G, [[0, L.lit], [1, mix(rgbHex(L.lit), rgbHex(L.shade), 0.3)]]);
  c.fill();
  c.beginPath();
  c.moveTo(cx - wl, G);
  c.quadraticCurveTo(cx - wl * 0.18, G - ph * 0.2, cx, top);
  c.quadraticCurveTo(cx - wl * 0.05, G - ph * 0.5, cx - wl * 0.3, G);
  c.closePath();
  c.globalAlpha = L.contrast;
  c.fillStyle = vgrad(c, top, G, [[0, L.shade], [1, mix(rgbHex(L.shade), rgbHex(L.lit), 0.3)]]);
  c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = fade(rgbHex(L.light), 0.45);
  c.lineWidth = Math.max(1, ph * 0.012);
  c.beginPath();
  c.moveTo(cx - wl * 0.02, top + 1);
  c.quadraticCurveTo(cx + wr * 0.4, top + ph * 0.03, cx + wr * 0.8, G - ph * 0.2);
  c.stroke();
  c.strokeStyle = fade(rgbHex(L.shade), 0.22);
  c.lineWidth = 1;
  for (let k = 0; k < 4; k++) {
    const t = 0.25 + k * 0.17 + rand() * 0.05;
    c.beginPath();
    c.moveTo(cx + wr * 0.05, top + ph * t);
    c.quadraticCurveTo(cx + wr * 0.45, top + ph * (t - 0.04), cx + wr * (0.7 + 0.2 * t), top + ph * (t + 0.2));
    c.stroke();
  }
}

const rgbHex = (css: string): string => {
  if (css.startsWith('#')) return css;
  const m = /rgba?\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/.exec(css);
  return m ? `#${[m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')}` : '#808080';
};

interface RangeSpec { seed: number; n: number; hMin: number; hMax: number; wMin: number; wMax: number; shape: 'peaks' | 'mesas' | 'dunes' | 'hills' }

/** A periodic range across the tile (each form is drawn again one tile to the left or right where it crosses an edge). */
function range(c: C2, e: Env, s: RangeSpec, L: RangeLook, airTop: number, airBottom: number): void {
  const { W, G, h } = e;
  const rand = seeded(s.seed);
  const forms: { cx: number; ph: number; wl: number; wr: number; seed: number }[] = [];
  for (let i = 0; i < s.n; i++) {
    const ph = h * (s.hMin + (s.hMax - s.hMin) * rand());
    forms.push({ cx: ((i + 0.5 + (rand() - 0.5) * 0.7) / s.n) * W, ph, wl: ph * (s.wMin + rand() * (s.wMax - s.wMin)), wr: ph * (s.wMin + rand() * (s.wMax - s.wMin)), seed: Math.floor(rand() * 1e9) });
  }
  forms.sort((a, b) => b.ph - a.ph);
  if (s.shape === 'hills') {
    rolling(c, e, G, h * s.hMin, h * (s.hMax - s.hMin), s.seed, L.lit, L.shade, L.light);
    // Copses on the hillsides: dark rounded clumps.
    const r2 = seeded(s.seed + 5);
    for (let i = 0; i < (e.lean ? 0 : W / (h * 0.03)); i++) {
      const x = r2() * W, y = hillY(x, W, G, h * s.hMin, h * (s.hMax - s.hMin), s.seed) + h * (0.01 + r2() * 0.06);
      const rr = h * (0.006 + r2() * 0.01);
      for (const dx of [-W, 0, W]) {
        if (x + dx < -rr * 3 || x + dx > W + rr * 3) continue;
        c.fillStyle = fade(rgbHex(L.shade), 0.85);
        c.beginPath();
        c.moveTo(x + dx + rr * 2, y);
        c.arc(x + dx, y, rr * 2, Math.PI, 0);
        c.moveTo(x + dx + rr * 3.2, y);
        c.arc(x + dx + rr * 1.6, y, rr * 1.5, Math.PI, 0);
        c.fill();
        c.fillStyle = fade(rgbHex(L.lit), 0.5);
        c.beginPath();
        c.moveTo(x + dx + rr * 1.8, y - rr * 0.8);
        c.arc(x + dx + rr * 0.6, y - rr * 0.8, rr * 1.0, Math.PI, 0);
        c.fill();
      }
    }
  } else {
    for (const f of forms) {
      for (const dx of [-W, 0, W]) {
        if (f.cx + dx + f.wr * 1.6 < 0 || f.cx + dx - f.wl * 1.6 > W) continue;
        const r = seeded(f.seed);
        if (s.shape === 'peaks') peak(c, f.cx + dx, G, f.ph, f.wl, f.wr, r, L);
        else if (s.shape === 'mesas') mesa(c, f.cx + dx, G, f.ph, f.wl + f.wr, r, L);
        else dune(c, f.cx + dx, G, f.ph, f.wl, f.wr, r, L);
      }
    }
  }
  // Air in front of the range: the farther down, the more of it (its foot is lost in the haze).
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = vgrad(c, G - h * s.hMax, G, [[0, fade(rgbHex(L.air), airTop)], [1, fade(rgbHex(L.air), airBottom)]]);
  c.fillRect(-2, G - h * s.hMax - 4, W + 4, h * s.hMax + 8);
  c.restore();
}

// ───────── rolling hills ─────────

function hillY(x: number, W: number, G: number, base: number, amp: number, seed: number): number {
  const u = x / W;
  const p1 = hash(seed + 1), p2 = hash(seed + 2), p3 = hash(seed + 3);
  const n = 0.55 * Math.sin(TAU * (2 * u + p1)) + 0.3 * Math.sin(TAU * (3 * u + p2)) + 0.15 * Math.sin(TAU * (7 * u + p3));
  return G - base - amp * (0.5 + 0.5 * n);
}

function rolling(c: C2, e: Env, G: number, base: number, amp: number, seed: number, lit: string, shade: string, light: string, rim = 1): void {
  const { W } = e;
  const step = Math.max(3, W / 240);
  const pts: Pts = [-2, G + 4];
  for (let x = -2; x <= W + 2; x += step) pts.push(x, hillY(x, W, G, base, amp, seed));
  pts.push(W + 2, hillY(W + 2, W, G, base, amp, seed), W + 2, G + 4);
  path(c, pts);
  c.fillStyle = vgrad(c, G - base - amp, G, [[0, lit], [1, shade]]);
  c.fill();
  // Rim light on the crests, brighter where the ground faces the sun (falling to the right).
  c.lineCap = 'round';
  c.lineWidth = Math.max(1.5, e.h * 0.004);
  for (let x = 0; x < (e.lean ? 0 : W); x += step) {
    const y0 = hillY(x, W, G, base, amp, seed), y1 = hillY(x + step, W, G, base, amp, seed);
    const face = (y1 - y0) / step;   // > 0: the slope faces right, toward the sun
    if (face < -0.05) continue;
    c.strokeStyle = fade(light, rim * Math.min(0.6, 0.18 + face * 2));
    c.beginPath();
    c.moveTo(x, y0 + 0.5);
    c.lineTo(x + step, y1 + 0.5);
    c.stroke();
  }
}

// ───────── trees ─────────

function pine(c: C2, x: number, y: number, H: number, lit: string, shade: string, snow: boolean, rand: () => number): void {
  const w = H * (0.34 + rand() * 0.08);
  c.fillStyle = mix(shade, '#000000', 0.3);
  c.fillRect(x - H * 0.03, y - H * 0.16, H * 0.06, H * 0.17);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers;
    const by = y - H * (0.12 + t0 * 0.66), ty = by - H * (0.42 - t0 * 0.1);
    const bw = w * (1 - t0 * 0.62);
    // The tier: lit, then its left half in shade.
    c.fillStyle = lit;
    c.beginPath();
    c.moveTo(x, ty);
    c.lineTo(x + bw, by);
    c.quadraticCurveTo(x, by + H * 0.05, x - bw, by);
    c.closePath();
    c.fill();
    c.fillStyle = shade;
    c.beginPath();
    c.moveTo(x, ty);
    c.lineTo(x + bw * 0.12, by + H * 0.03);
    c.quadraticCurveTo(x - bw * 0.5, by + H * 0.035, x - bw, by);
    c.closePath();
    c.fill();
    if (snow) {
      c.fillStyle = '#FFFFFF';
      c.beginPath();
      c.moveTo(x, ty);
      c.lineTo(x + bw * 0.55, ty + (by - ty) * 0.55);
      c.quadraticCurveTo(x + bw * 0.2, ty + (by - ty) * 0.45, x, ty + (by - ty) * 0.5);
      c.quadraticCurveTo(x - bw * 0.2, ty + (by - ty) * 0.42, x - bw * 0.5, ty + (by - ty) * 0.52);
      c.closePath();
      c.fill();
      c.fillStyle = '#DCD7F6';
      c.beginPath();
      c.moveTo(x, ty);
      c.lineTo(x, ty + (by - ty) * 0.5);
      c.quadraticCurveTo(x - bw * 0.2, ty + (by - ty) * 0.42, x - bw * 0.5, ty + (by - ty) * 0.52);
      c.closePath();
      c.fill();
    }
  }
}

function roundTree(c: C2, x: number, y: number, H: number, lit: string, shade: string, light: string, rand: () => number): void {
  c.fillStyle = '#5A4632';
  c.fillRect(x - H * 0.035, y - H * 0.4, H * 0.07, H * 0.4);
  const cy = y - H * 0.62, R = H * 0.3;
  const blobs: [number, number, number][] = [[-0.55, 0.25, 0.62], [0.5, 0.22, 0.6], [0, -0.35, 0.72], [-0.1, 0.3, 0.7], [0.3, -0.1, 0.6]];
  c.fillStyle = shade;
  c.beginPath();
  for (const [bx, by, br] of blobs) { c.moveTo(x + bx * R + br * R, cy + by * R); c.arc(x + bx * R, cy + by * R, br * R, 0, TAU); }
  c.fill();
  c.fillStyle = lit;
  c.beginPath();
  for (const [bx, by, br] of blobs) { const rr = br * R * 0.78; c.moveTo(x + bx * R + R * 0.14 + rr, cy + by * R - R * 0.14); c.arc(x + bx * R + R * 0.14, cy + by * R - R * 0.14, rr, 0, TAU); }
  c.fill();
  c.fillStyle = fade(light, 0.45);
  c.beginPath();
  for (let i = 0; i < 4; i++) { const ax = x + R * (0.05 + rand() * 0.5), ay = cy - R * (0.1 + rand() * 0.5), rr = R * (0.1 + rand() * 0.1); c.moveTo(ax + rr, ay); c.arc(ax, ay, rr, 0, TAU); }
  c.fill();
}

function cactus(c: C2, x: number, y: number, H: number, lit: string, shade: string, rand: () => number): void {
  const w = H * 0.16;
  const arm = (ax: number, ay: number, dir: number, len: number): void => {
    const aw = w * 0.75;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(ax + dir * len, ay);
    c.lineTo(ax + dir * len, ay - H * 0.25);
    c.arc(ax + dir * (len - aw / 2), ay - H * 0.25, aw / 2, 0, Math.PI, true);
    c.lineTo(ax + dir * (len - aw), ay - aw);
    c.lineTo(ax, ay - aw);
    c.closePath();
    c.fill();
  };
  for (const pass of [0, 1]) {
    c.fillStyle = pass ? lit : shade;
    c.save();
    if (pass) { c.beginPath(); c.rect(x - w * 0.1, y - H * 1.2, H, H * 1.3); c.clip(); }
    c.beginPath();
    c.moveTo(x - w / 2, y);
    c.lineTo(x - w / 2, y - H + w / 2);
    c.arc(x, y - H + w / 2, w / 2, Math.PI, 0);
    c.lineTo(x + w / 2, y);
    c.closePath();
    c.fill();
    if (rand() > 0.15 || pass) arm(x + w * 0.3, y - H * 0.42, 1, w * 1.25);
    arm(x - w * 0.3, y - H * 0.55, -1, w * 1.1);
    c.restore();
  }
  c.strokeStyle = fade(shade, 0.5);
  c.lineWidth = Math.max(0.8, w * 0.07);
  c.beginPath();
  c.moveTo(x + w * 0.12, y - 2);
  c.lineTo(x + w * 0.12, y - H + w * 0.4);
  c.stroke();
}

function rock(c: C2, x: number, y: number, s: number, lit: string, shade: string): void {
  c.fillStyle = shade;
  c.beginPath();
  c.moveTo(x - s, y);
  c.lineTo(x - s * 0.8, y - s * 0.55);
  c.lineTo(x - s * 0.2, y - s * 0.85);
  c.lineTo(x + s * 0.6, y - s * 0.7);
  c.lineTo(x + s, y);
  c.closePath();
  c.fill();
  c.fillStyle = lit;
  c.beginPath();
  c.moveTo(x - s * 0.2, y - s * 0.85);
  c.lineTo(x + s * 0.6, y - s * 0.7);
  c.lineTo(x + s, y);
  c.lineTo(x + s * 0.15, y);
  c.lineTo(x - s * 0.05, y - s * 0.4);
  c.closePath();
  c.fill();
}

// ───────── the near hills with their trees ─────────

function paintNear(c: C2, b: Biome, P: Paint, e: Env): void {
  const { W, G, h } = e;
  const base = h * 0.075, amp = h * 0.1, seed = 401 + b.id.length;
  // Under the moon the crests only catch a faint rim (a bright line would read as a wire).
  rolling(c, e, G, base, amp, seed, P.near.lit, P.near.shade, P.light, b.stars ? 0.35 : 1);
  const rand = seeded(seed * 7);
  // Texture: grass strokes, ripples in the sand, glints on the snow.
  const n = Math.round(W / Math.max(2, h * 0.006));
  if (e.lean) {
    // No texture when painted every frame.
  } else if (P.near.texture === 'grass') {
    c.lineWidth = Math.max(1, h * 0.0022);
    const tip = b.stars ? mix(P.near.lit, P.light, 0.25) : fade(P.light, 0.35);
    for (const [col, a] of [[fade(P.near.shade, 0.5), 1], [tip, b.stars ? 0.35 : 1]] as const) {
      c.strokeStyle = col;
      c.globalAlpha = a;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const x = rand() * W, y = hillY(x, W, G, base, amp, seed) + rand() * h * 0.09 + 2;
        const len = h * (0.006 + rand() * 0.01);
        c.moveTo(x, y);
        c.lineTo(x + (rand() - 0.3) * len * 0.5, y - len);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
    if (b.id === 'meadow') {
      for (const col of ['#FFFFFF', '#FFE27A', '#FF9FB8']) {
        c.fillStyle = col;
        for (let i = 0; i < W / 18; i++) { const x = rand() * W, y = hillY(x, W, G, base, amp, seed) + h * (0.01 + rand() * 0.07); c.fillRect(x, y, 2, 2); }
      }
    }
  } else if (P.near.texture === 'sand') {
    c.strokeStyle = fade(P.near.shade, 0.3);
    c.lineWidth = 1;
    for (let i = 0; i < W / 26; i++) {
      const x = rand() * W, y = hillY(x, W, G, base, amp, seed) + h * (0.012 + rand() * 0.07);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + h * 0.02, y - h * 0.006, x + h * 0.045, y + h * 0.002);
      c.stroke();
    }
  } else {
    c.fillStyle = '#FFFFFF';
    for (let i = 0; i < W / 9; i++) { const x = rand() * W, y = hillY(x, W, G, base, amp, seed) + h * (0.004 + rand() * 0.08); c.globalAlpha = 0.4 + rand() * 0.6; c.fillRect(x, y, 1.5, 1.5); }
    c.globalAlpha = 1;
    c.strokeStyle = fade(P.near.shade, 0.35);
    c.lineWidth = Math.max(1, h * 0.003);
    for (let i = 0; i < W / 60; i++) {
      const x = rand() * W, y = hillY(x, W, G, base, amp, seed) + h * (0.02 + rand() * 0.05);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + h * 0.03, y + h * 0.008, x + h * 0.07, y + h * 0.002);
      c.stroke();
    }
  }
  // Trees in clusters along the crests, back to front, each with its shadow thrown to the left.
  const T = P.trees;
  const trees: { x: number; y: number; H: number; s: number }[] = [];
  const clusters = Math.max(3, Math.round(W / (h * (T.kind === 'cactus' ? 0.32 : 0.2))));
  for (let k = 0; k < clusters; k++) {
    const cx = ((k + rand() * 0.8) / clusters) * W;
    const count = T.kind === 'cactus' ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 4);
    for (let j = 0; j < count; j++) {
      const x = cx + (rand() - 0.5) * h * 0.12;
      const y = hillY(((x % W) + W) % W, W, G, base, amp, seed) + h * (0.005 + rand() * 0.035);
      trees.push({ x, y, H: h * (T.kind === 'cactus' ? 0.07 + rand() * 0.05 : 0.06 + rand() * 0.075), s: Math.floor(rand() * 1e9) });
    }
  }
  trees.sort((a, q) => a.y - q.y);
  for (const t of trees) {
    for (const dx of [-W, 0, W]) {
      const x = t.x + dx;
      if (x < -t.H || x > W + t.H) continue;
      c.fillStyle = fade(P.near.shade, 0.55);
      c.beginPath();
      c.ellipse(x - t.H * 0.22, t.y + 1, t.H * 0.32, t.H * 0.05, 0, 0, TAU);
      c.fill();
      const r = seeded(t.s);
      if (T.kind === 'pine') pine(c, x, t.y, t.H, T.lit, T.shade, T.snow, r);
      else if (T.kind === 'round') roundTree(c, x, t.y, t.H, T.lit, T.shade, P.light, r);
      else { cactus(c, x, t.y, t.H, T.lit, T.shade, r); if (r() > 0.4) rock(c, x + t.H * 0.35, t.y + 1, t.H * 0.12, P.rock[0], P.rock[1]); }
    }
  }
}

// ───────── the middle range ─────────

function paintMid(c: C2, b: Biome, P: Paint, e: Env): void {
  const M = P.mid;
  const shape = M.shape;
  const spec: RangeSpec = shape === 'dunes'
    ? { seed: 211, n: Math.max(4, Math.round(e.W / (e.h * 0.32))), hMin: 0.1, hMax: 0.2, wMin: 0.9, wMax: 1.6, shape }
    : shape === 'hills'
      ? { seed: 233, n: 1, hMin: 0.12, hMax: 0.26, wMin: 1, wMax: 1, shape }
      : { seed: 257 + b.id.length, n: Math.max(4, Math.round(e.W / (e.h * 0.28))), hMin: 0.14, hMax: 0.32, wMin: 0.9, wMax: 1.5, shape };
  range(c, e, spec, { lit: M.lit, shade: M.shade, light: P.light, snow: M.snow, air: P.air, contrast: b.stars ? 0.9 : 0.9 }, 0, 0.32);
  // Mist lying in the valley at the foot of the range.
  const rand = seeded(97 + b.id.length);
  soften(c, Math.max(3, e.h * 0.012));
  for (let i = 0; i < e.W / (e.h * 0.08); i++) {
    const x = rand() * e.W, y = e.G - e.h * (0.03 + rand() * 0.09);
    const w = e.h * (0.12 + rand() * 0.18);
    c.fillStyle = fade(P.air, (b.stars ? 0.18 : 0.3) + rand() * 0.2);
    for (const dx of [-e.W, 0, e.W]) {
      if (x + dx + w < 0 || x + dx - w > e.W) continue;
      c.beginPath();
      c.ellipse(x + dx, y, w, e.h * (0.012 + rand() * 0.016), 0, 0, TAU);
      c.fill();
    }
  }
  soften(c, 0);
  c.fillStyle = vgrad(c, e.G - e.h * 0.06, e.G, [[0, fade(P.air, 0)], [1, fade(P.air, b.stars ? 0.4 : 0.7)]]);
  c.fillRect(0, e.G - e.h * 0.06, e.W, e.h * 0.06 + 2);
}

function paintFar(c: C2, b: Biome, P: Paint, e: Env): void {
  const F = P.far;
  const spec: RangeSpec = F.shape === 'mesas'
    ? { seed: 131, n: Math.max(3, Math.round(e.W / (e.h * 0.55))), hMin: 0.16, hMax: 0.3, wMin: 0.9, wMax: 1.8, shape: 'mesas' }
    : { seed: 151 + b.id.length, n: Math.max(4, Math.round(e.W / (e.h * 0.36))), hMin: 0.26, hMax: 0.52, wMin: 0.85, wMax: 1.4, shape: 'peaks' };
  range(c, e, spec, { lit: F.lit, shade: F.shade, light: P.light, snow: F.snow, air: P.air, contrast: 0.8 }, 0.06, 0.6);
}

// ───────── bushes ─────────

function paintBushes(c: C2, b: Biome, P: Paint, e: Env): void {
  const { W, G, h } = e;
  const rand = seeded(733 + b.id.length);
  const step = h * 0.06;
  const [lit, shade] = P.bush;
  for (let i = 0; i < W / step; i++) {
    if (rand() < 0.3) continue;
    const x = i * step + rand() * step * 0.5;
    const s = h * (0.018 + rand() * 0.03);
    for (const dx of [-W, 0, W]) {
      const bx = x + dx;
      if (bx < -s * 3 || bx > W + s * 3) continue;
      if (b.id === 'dunes') {
        // Dry tufts and stones.
        c.strokeStyle = shade;
        c.lineWidth = Math.max(1, h * 0.0025);
        c.beginPath();
        for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.22; c.moveTo(bx, G); c.lineTo(bx + Math.cos(a) * s * 1.4, G + Math.sin(a) * s * 1.4); }
        c.stroke();
        c.strokeStyle = lit;
        c.beginPath();
        for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (k - 1) * 0.3 + 0.15; c.moveTo(bx + 1, G); c.lineTo(bx + 1 + Math.cos(a) * s * 1.1, G + Math.sin(a) * s * 1.1); }
        c.stroke();
        if (rand() > 0.6) rock(c, bx + s * 1.5, G + 1, s * 0.55, P.rock[0], P.rock[1]);
        continue;
      }
      const blobs = 3 + Math.floor(hash(i * 13 + 7) * 3);
      c.fillStyle = shade;
      c.beginPath();
      for (let k = 0; k < blobs; k++) { const ox = (k - (blobs - 1) / 2) * s * 0.7, r = s * (0.6 + hash(i * 31 + k) * 0.5); c.moveTo(bx + ox + r, G); c.arc(bx + ox, G, r, Math.PI, 0); }
      c.fill();
      c.fillStyle = lit;
      c.beginPath();
      for (let k = 0; k < blobs; k++) { const ox = (k - (blobs - 1) / 2) * s * 0.7 + s * 0.18, r = s * (0.6 + hash(i * 31 + k) * 0.5) * 0.7; c.moveTo(bx + ox + r, G - s * 0.18); c.arc(bx + ox, G - s * 0.18, r, Math.PI, 0); }
      c.fill();
      if (b.id === 'meadow' && rand() > 0.5) {
        c.fillStyle = rand() > 0.5 ? '#FFFFFF' : '#FFD45C';
        for (let k = 0; k < 4; k++) c.fillRect(bx + (rand() - 0.5) * s * 2, G - s * (0.2 + rand() * 0.6), 2.5, 2.5);
      }
      if (b.id === 'night') {
        c.strokeStyle = fade(P.light, 0.35);
        c.lineWidth = 1;
        c.beginPath();
        c.arc(bx + s * 0.25, G - s * 0.1, s * 0.75, -1.4, -0.3);
        c.stroke();
      }
    }
  }
}

// ───────── the ground ─────────

function paintGround(c: C2, b: Biome, P: Paint, e: Env): void {
  const { W, G, B, h } = e;
  const deep = Math.max(8, B - G);
  const rand = seeded(919 + b.id.length);
  c.fillStyle = vgrad(c, G, G + deep, [[0, P.soil[0]], [0.35, P.soil[1]], [1, P.soil[2]]]);
  c.fillRect(0, G, W, deep + 2);
  // Strata: two wavy darker bands (whole periods across the tile).
  for (let s = 0; s < 2; s++) {
    const y0 = G + deep * (0.32 + s * 0.28);
    c.fillStyle = fade(P.soil[2], 0.35);
    c.beginPath();
    c.moveTo(0, y0);
    for (let x = 0; x <= W; x += e.lean ? 48 : 8) c.lineTo(x, y0 + Math.sin(TAU * (x / W) * (3 + s * 2) + s) * deep * 0.04);
    for (let x = W; x >= 0; x -= e.lean ? 48 : 8) c.lineTo(x, y0 + deep * 0.05 + Math.sin(TAU * (x / W) * (3 + s * 2) + s + 0.6) * deep * 0.04);
    c.closePath();
    c.fill();
  }
  // Pebbles and half-buried stones, lit on their upper right.
  const pebbles = e.lean ? 0 : Math.round(W / 9);
  for (let i = 0; i < pebbles; i++) {
    const x = rand() * W, y = G + deep * (0.12 + rand() * 0.85), r = 1 + rand() * Math.min(5, deep * 0.05);
    const dim = (y - G) / deep;
    c.fillStyle = mix(P.rock[1], P.soil[2], dim * 0.6);
    c.beginPath();
    c.ellipse(x, y, r * 1.4, r, 0, 0, TAU);
    c.fill();
    c.fillStyle = fade(P.rock[0], 0.6 * (1 - dim));
    c.beginPath();
    c.ellipse(x + r * 0.35, y - r * 0.3, r * 0.6, r * 0.4, 0, 0, TAU);
    c.fill();
  }
  for (let i = 0; i < Math.max(3, W / 160); i++) {
    const x = ((i + rand()) / Math.max(3, W / 160)) * W, s = h * (0.012 + rand() * 0.012), y = G + deep * (0.2 + rand() * 0.2);
    c.fillStyle = P.rock[1];
    c.beginPath();
    c.ellipse(x, y, s * 1.5, s, 0, 0, TAU);
    c.fill();
    c.fillStyle = P.rock[0];
    c.beginPath();
    c.ellipse(x + s * 0.3, y - s * 0.35, s * 1.0, s * 0.55, 0, 0, TAU);
    c.fill();
  }
  // Shade under the lip.
  c.fillStyle = vgrad(c, G, G + h * 0.035, [[0, 'rgba(10,6,20,0.38)'], [1, 'rgba(10,6,20,0)']]);
  c.fillRect(0, G, W, h * 0.035);
  // The lip: snow, sand or grass.
  const lip = Math.max(4, h * 0.016);
  const [tLit, tMid, tShade] = P.turf;
  c.fillStyle = vgrad(c, G - lip * 0.4, G + lip, [[0, tLit], [0.5, tMid], [1, tShade]]);
  c.beginPath();
  c.moveTo(0, G + lip);
  for (let x = 0; x <= W; x += 6) c.lineTo(x, G + lip * (0.75 + 0.25 * Math.sin(TAU * (x / W) * 23)));
  c.lineTo(W, G - lip * 0.3);
  for (let x = W; x >= 0; x -= 6) c.lineTo(x, G - lip * 0.3 + lip * 0.2 * Math.sin(TAU * (x / W) * 17 + 1));
  c.closePath();
  c.fill();
  if (P.near.texture === 'snow') {
    // Soft lumps of snow along the edge and icicles under it.
    c.fillStyle = tLit;
    c.beginPath();
    for (let x = 0; x < W; x += lip * 2.2) { const r = lip * (0.7 + hash(Math.round(x) + 3) * 0.6); c.moveTo(x + r, G); c.arc(x, G - lip * 0.2, r, Math.PI, 0); }
    c.fill();
    c.fillStyle = fade(tShade, 0.9);
    c.beginPath();
    for (let i = 0; i < W / (lip * 3); i++) {
      const x = rand() * W, l = lip * (0.6 + rand() * 1.6);
      c.moveTo(x - lip * 0.25, G + lip * 0.8);
      c.lineTo(x, G + lip * 0.8 + l);
      c.lineTo(x + lip * 0.25, G + lip * 0.8);
    }
    c.fill();
  } else if (P.near.texture === 'sand') {
    c.strokeStyle = fade(tShade, 0.5);
    c.lineWidth = 1;
    for (let i = 0; i < W / 30; i++) {
      const x = rand() * W;
      c.beginPath();
      c.moveTo(x, G + lip * 0.3);
      c.quadraticCurveTo(x + lip * 1.5, G - lip * 0.1, x + lip * 3, G + lip * 0.35);
      c.stroke();
    }
  } else if (!e.lean) {
    // Blades of grass standing over the edge, in three tones (one path each).
    const bladeW = Math.max(1.2, h * 0.003);
    for (const [col, k] of [[tShade, 0], [tMid, 1], [tLit, 2]] as const) {
      c.fillStyle = col;
      c.beginPath();
      for (let x = (k * 1.7) % 3; x < W; x += 2.6) {
        const len = h * (0.006 + hash(Math.round(x * 10) + k * 7) * (0.018 - k * 0.003));
        const lean = (hash(Math.round(x * 10) + 99) - 0.4) * len * 0.5;
        c.moveTo(x - bladeW, G + lip * 0.2);
        c.lineTo(x + lean, G - len);
        c.lineTo(x + bladeW, G + lip * 0.2);
      }
      c.fill();
    }
  }
}

// ───────── clouds ─────────

interface CloudSpec { u: number; y: number; w: number; par: number; drift: number; seed: number }

function cloudSpecs(e: Env): CloudSpec[] {
  const out: CloudSpec[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const near = i / (n - 1);
    out.push({
      u: hash(i * 5 + 1),
      y: e.T + (e.G - e.T) * (0.1 + hash(i * 5 + 2) * 0.36),
      w: e.h * (0.09 + near * 0.12 + hash(i * 5 + 3) * 0.05),
      par: 0.025 + near * 0.05,
      drift: 3 + near * 7,
      seed: 1000 + i * 77,
    });
  }
  return out;
}

/** A cumulus: puffs on a flat base, the shaded underside first, then the lit body raised toward the sun, then glints. */
function paintCloud(c: C2, cx: number, cy: number, w: number, P: Paint, seed: number): void {
  const rand = seeded(seed);
  const puffs: [number, number, number][] = [];
  const n = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const bump = Math.sin(Math.PI * t);
    const r = w * (0.16 + 0.22 * bump) * (0.85 + rand() * 0.3);
    puffs.push([cx + (t - 0.5) * w * 1.6, cy - r * 0.55 - bump * w * 0.08 + (rand() - 0.5) * w * 0.05, r]);
  }
  c.save();
  c.beginPath();
  c.rect(cx - w * 1.5, cy - w * 1.5, w * 3, w * 1.5 + w * 0.08);
  c.clip();
  c.globalAlpha = P.cloud.alpha;
  c.fillStyle = P.cloud.shade;
  c.beginPath();
  for (const [x, y, r] of puffs) { c.moveTo(x + r, y); c.ellipse(x, y, r, r * 0.92, 0, 0, TAU); }
  c.fill();
  c.fillStyle = P.cloud.lit;
  c.beginPath();
  for (const [x, y, r] of puffs) { const rr = r * 0.86; c.moveTo(x + r * 0.12 + rr, y - r * 0.16); c.ellipse(x + r * 0.12, y - r * 0.16, rr, rr * 0.9, 0, 0, TAU); }
  c.fill();
  // The sun side of each puff, soft (one blurred pass where the canvas can blur).
  soften(c, w * 0.04);
  c.fillStyle = fade(P.light, P.cloud.alpha < 0.8 ? 0.16 : 0.4);
  c.beginPath();
  for (const [x, y, r] of puffs) { const rr = r * 0.62; c.moveTo(x + r * 0.26 + rr, y - r * 0.3); c.ellipse(x + r * 0.26, y - r * 0.3, rr, rr * 0.85, 0, 0, TAU); }
  c.fill();
  soften(c, 0);
  c.restore();
}

// ───────── the layer cache ─────────

type Canvasish = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): Canvasish | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  } catch { /* fall through */ }
  return null;
}

type LayerId = 'sky' | 'far' | 'mid' | 'near' | 'bush' | 'ground';

interface LayerDef { id: LayerId; par: number; y0: (e: Env) => number; y1: (e: Env) => number; paint: (c: C2, b: Biome, P: Paint, e: Env) => void }

const LAYERS: readonly LayerDef[] = [
  { id: 'far', par: 0.04, y0: (e) => e.G - e.h * 0.56, y1: (e) => e.G - e.h * 0.03, paint: paintFar },
  { id: 'mid', par: 0.1, y0: (e) => e.G - e.h * 0.36, y1: (e) => e.G + 2, paint: paintMid },
  { id: 'near', par: 0.24, y0: (e) => e.G - e.h * 0.33, y1: (e) => e.G + 3, paint: paintNear },
  { id: 'bush', par: 0.55, y0: (e) => e.G - e.h * 0.075, y1: (e) => e.G + 3, paint: paintBushes },
  { id: 'ground', par: 1, y0: (e) => e.G - e.h * 0.03, y1: (e) => e.B, paint: paintGround },
];

interface Built { canvas: Canvasish; y0: number; wDev: number; hDev: number }

interface Painted {
  key: string;
  biome: Biome;
  env: Env;
  k: number;
  sky: Built | null;
  layers: Partial<Record<LayerId, Built>>;
  clouds: (Built & { spec: CloudSpec; ox: number })[] | null;
  todo: number;
}

const STEPS = LAYERS.length + 2;   // the sky, the layers, the clouds

function build(p: Painted, step: number): void {
  const { env: e, k, biome: b } = p;
  const P = b.paint;
  if (step === 0) {
    const wDev = Math.ceil(e.regionW * k), hDev = Math.ceil((e.G + 8 - e.T) * k);
    const canvas = makeCanvas(wDev, hDev);
    const c = canvas?.getContext('2d') as C2 | null | undefined;
    if (!canvas || !c) return;
    c.setTransform(k, 0, 0, k, -e.regionX * k, -e.T * k);
    paintSky(c, b, P, e);
    p.sky = { canvas, y0: e.T, wDev, hDev };
    return;
  }
  if (step <= LAYERS.length) {
    const L = LAYERS[step - 1]!;
    const y0 = L.y0(e), y1 = L.y1(e);
    const wDev = Math.ceil(e.W * k), hDev = Math.max(1, Math.ceil((y1 - y0) * k));
    const canvas = makeCanvas(wDev, hDev);
    const c = canvas?.getContext('2d') as C2 | null | undefined;
    if (!canvas || !c) return;
    // The tile is exactly wDev device pixels wide: its own width in CSS pixels is wDev / k.
    const ek: Env = { ...e, W: wDev / k };
    c.setTransform(k, 0, 0, k, 0, -y0 * k);
    L.paint(c, b, P, ek);
    p.layers[L.id] = { canvas, y0, wDev, hDev };
    return;
  }
  const out: (Built & { spec: CloudSpec; ox: number })[] = [];
  for (const s of cloudSpecs(e)) {
    const wCss = s.w * 2.2, hCss = s.w * 1.05;
    const wDev = Math.ceil(wCss * k), hDev = Math.ceil(hCss * k);
    const canvas = makeCanvas(wDev, hDev);
    const c = canvas?.getContext('2d') as C2 | null | undefined;
    if (!canvas || !c) continue;
    c.setTransform(k, 0, 0, k, 0, 0);
    paintCloud(c, wCss / 2, hCss * 0.9, s.w, P, s.seed);
    out.push({ canvas, y0: s.y - hCss * 0.9, wDev, hDev, spec: s, ox: wCss / 2 });
  }
  p.clouds = out;
}

function free(p: Painted | null): void {
  if (!p) return;
  const all: (Built | null | undefined)[] = [p.sky, ...Object.values(p.layers), ...(p.clouds ?? [])];
  for (const x of all) if (x) { x.canvas.width = 0; x.canvas.height = 0; }
  p.sky = null;
  p.layers = {};
  p.clouds = null;
}

export interface Scenery {
  /** Everything behind the columns: the sky, the ranges, the clouds, the hills and the bushes. */
  back(ctx: C2, lane: number, b: Biome, e: Env, scrollPx: number, time: number): void;
  /** The ground, over the columns' feet. */
  ground(ctx: C2, lane: number, b: Biome, e: Env, scrollPx: number): void;
  /** What drifts in the air (snow, dust, fireflies, pollen), over the scene and under the bird. */
  motes(ctx: C2, b: Biome, e: Env, scrollPx: number, time: number): void;
  dispose(): void;
}

export function createScenery(o: { reducedMotion: boolean }): Scenery {
  const shown: (Painted | null)[] = [null, null];
  const pending: (Painted | null)[] = [null, null];
  let direct: boolean | null = null;   // no canvas to paint on off screen: paint onto the screen

  function scaleOf(ctx: C2): number {
    const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    return t ? Math.max(0.5, Math.hypot(t.a, t.b)) : 1;
  }

  /** The painted set to show for this lane: the one asked for, or the old one while the new one is being painted. */
  function ready(ctx: C2, lane: number, b: Biome, e: Env): Painted | null {
    if (direct) return null;
    const k = scaleOf(ctx);
    const key = `${b.id}|${e.regionX}|${e.T}|${e.regionW}|${e.B}|${e.laneX}|${e.laneW}|${e.h}|${Math.round(e.G)}|${k.toFixed(3)}`;
    let cur = shown[lane] ?? null;
    if (cur && cur.key === key) return cur;
    let next = pending[lane] ?? null;
    if (!next || next.key !== key) {
      free(next);
      next = { key, biome: b, env: { ...e }, k, sky: null, layers: {}, clouds: null, todo: 0 };
      pending[lane] = next;
    }
    // Nothing on show yet, or the screen changed size: paint all at once. A new biome: one layer per frame.
    const sameSize = !!cur && cur.key.slice(cur.key.indexOf('|')) === key.slice(key.indexOf('|'));
    do {
      build(next, next.todo);
      next.todo++;
      if (direct === null) direct = next.sky === null && next.todo === 1;
      if (direct) { pending[lane] = null; return null; }
    } while (next.todo < STEPS && !sameSize);
    if (next.todo < STEPS) return cur;
    free(cur);
    shown[lane] = next;
    pending[lane] = null;
    cur = next;
    return cur;
  }

  /** Copies a tile across the region at its parallax, at whole device pixels when the screen is not scaled oddly. */
  function strip(ctx: C2, t: Built, p: Painted, e: Env, offCss: number): void {
    const k = p.k;
    const W = t.wDev / k;
    const off = ((offCss % W) + W) % W;
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (m && Math.abs(m.a - k) < 1e-3 && Math.abs(m.d - k) < 1e-3 && m.b === 0 && m.c === 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const x0 = Math.round(m.a * (e.regionX - off) + m.e), y = Math.round(m.d * t.y0 + m.f);
      const xEnd = m.a * (e.regionX + e.regionW) + m.e;
      for (let x = x0; x < xEnd; x += t.wDev) ctx.drawImage(t.canvas as CanvasImageSource, x, y);
      ctx.restore();
    } else {
      for (let x = e.regionX - off; x < e.regionX + e.regionW; x += W) ctx.drawImage(t.canvas as CanvasImageSource, x, t.y0, W, t.hDev / k);
    }
  }

  function directLayer(ctx: C2, L: LayerDef, b: Biome, e: Env, scrollPx: number): void {
    ctx.save();
    ctx.translate(e.regionX - (((scrollPx * L.par) % e.W) + e.W) % e.W, 0);
    L.paint(ctx, b, b.paint, e);
    ctx.restore();
  }

  function cloudX(s: CloudSpec, e: Env, scrollPx: number, time: number, wCss: number): number {
    const span = e.regionW + wCss * 2;
    const raw = s.u * span - scrollPx * s.par - (o.reducedMotion ? 0 : time * s.drift);
    return e.regionX - wCss + (((raw % span) + span) % span);
  }

  return {
    back(ctx, lane, b, e, scrollPx, time) {
      const p = ready(ctx, lane, b, e);
      if (!p) {
        // Painted straight onto the screen (no off-screen canvas): the same forms, without their fine texture.
        const le: Env = { ...e, lean: true };
        paintSky(ctx, b, b.paint, le);
        directLayer(ctx, LAYERS[0]!, b, le, scrollPx);
        for (const s of cloudSpecs(e)) paintCloud(ctx, cloudX(s, e, scrollPx, time, s.w * 2.2) + s.w * 1.1, s.y, s.w, b.paint, s.seed);
        for (const L of LAYERS.slice(1, 4)) directLayer(ctx, L, b, le, scrollPx);
        return;
      }
      const pe = p.env;
      if (p.sky) strip(ctx, p.sky, p, pe, 0);
      const far = p.layers.far;
      if (far) strip(ctx, far, p, pe, scrollPx * 0.04);
      for (const c of p.clouds ?? []) {
        const wCss = c.wDev / p.k;
        ctx.drawImage(c.canvas as CanvasImageSource, cloudX(c.spec, pe, scrollPx, time, wCss), c.y0, wCss, c.hDev / p.k);
      }
      for (const id of ['mid', 'near', 'bush'] as const) {
        const t = p.layers[id];
        if (t) strip(ctx, t, p, pe, scrollPx * (LAYERS.find((L) => L.id === id)!.par));
      }
    },
    ground(ctx, lane, b, e, scrollPx) {
      // The ground of the set on show (while a new biome is being painted, the old one's, like the rest of the scene).
      const p = shown[lane] ?? null;
      const t = p?.layers.ground;
      if (p && t) strip(ctx, t, p, p.env, scrollPx);
      else directLayer(ctx, LAYERS[4]!, b, { ...e, lean: true }, scrollPx);
    },
    motes(ctx, b, e, scrollPx, time) {
      if (o.reducedMotion) return;
      const P = b.paint;
      const H = e.G - e.T;
      const kind = P.motes;
      const n = kind === 'snow' ? 46 : kind === 'fireflies' ? 18 : 26;
      ctx.fillStyle = P.motesColor;
      for (let i = 0; i < n; i++) {
        const a = hash(i * 7 + 1), q = hash(i * 7 + 2), z = hash(i * 7 + 3);
        let x: number, y: number, s: number, alpha: number;
        if (kind === 'snow') {
          const fall = 18 + 34 * z;
          y = e.T + ((((q * H + time * fall) % H) + H) % H);
          x = a * e.regionW - scrollPx * (0.3 + 0.5 * z) + Math.sin(time * (0.8 + z) + i) * 10;
          s = 1.2 + z * 2.4;
          alpha = 0.5 + 0.5 * z;
        } else if (kind === 'fireflies') {
          y = e.G - e.h * (0.03 + 0.22 * q) + Math.sin(time * (0.6 + z) + i * 2) * e.h * 0.02;
          x = a * e.regionW - scrollPx * (0.3 + 0.3 * z) + Math.cos(time * (0.5 + z * 0.5) + i) * 18;
          s = 1.6 + z * 1.6;
          alpha = Math.max(0, Math.sin(time * (1.2 + z * 1.5) + i * 1.7)) * 0.95;
        } else {
          const rise = kind === 'pollen' ? 6 + 8 * z : 2 + 4 * z;
          y = e.T + H * (0.35 + 0.6 * q) - ((time * rise) % (H * 0.4)) + Math.sin(time * 0.7 + i) * 6;
          x = a * e.regionW - scrollPx * (0.35 + 0.4 * z) + time * (kind === 'dust' ? 8 : 3);
          s = 1 + z * 1.8;
          alpha = (0.25 + 0.55 * z) * (0.6 + 0.4 * Math.sin(time * 2 + i));
        }
        const span = e.regionW + 40;
        x = e.regionX - 20 + ((((x % span) + span) % span));
        if (alpha <= 0.02) continue;
        if (kind === 'fireflies') {
          ctx.globalAlpha = alpha * 0.12;
          ctx.beginPath();
          ctx.arc(x, y, s * 4.5, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = alpha * 0.3;
          ctx.beginPath();
          ctx.arc(x, y, s * 2, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(x, y, s * 0.8, 0, TAU);
          ctx.fill();
          continue;
        }
        ctx.globalAlpha = alpha;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    },
    dispose() {
      for (let i = 0; i < 2; i++) { free(shown[i] ?? null); free(pending[i] ?? null); shown[i] = null; pending[i] = null; }
    },
  };
}
