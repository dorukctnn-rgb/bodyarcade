// Procedural textures as plain pixels (split from site/game/engine.js:188-262; the old code drew them on DOM canvases).
//
// Why pixels and not canvas: the generators below are pure functions of (theme, seeded stream), so the same world
// gives the same bytes in every browser, they run in Node (the unit tests look at the pixels), in a worker, and
// they need no document. A DataTexture uploads them; makeTexture() flips the rows because a canvas starts at the
// top and a DataTexture at the bottom.
//
// Pixels are straight-alpha RGBA, row 0 at the TOP (like a canvas), sRGB-encoded bytes.
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import type { Theme } from './theme.ts';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

export type RGBA = readonly [number, number, number, number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** '#rgb' or '#rrggbb' to sRGB bytes. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createPixels(width: number, height: number, fill?: RGBA): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) fillAll(data, fill);
  return { width, height, data };
}

function fillAll(data: Uint8ClampedArray, c: RGBA): void {
  for (let i = 0; i < data.length; i += 4) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3]; }
}

/** Source-over of one colour with coverage a (0..1) onto pixel i, straight alpha. */
function over(data: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  const da = data[i + 3]! / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  const k = da * (1 - a);
  data[i] = (r * a + data[i]! * k) / oa;
  data[i + 1] = (g * a + data[i + 1]! * k) / oa;
  data[i + 2] = (b * a + data[i + 2]! * k) / oa;
  data[i + 3] = oa * 255;
}

/** Axis-aligned rectangle (whole pixels), opaque source-over. */
export function fillRect(px: Pixels, x: number, y: number, w: number, h: number, c: RGBA): void {
  const x0 = clamp(Math.round(x), 0, px.width), x1 = clamp(Math.round(x + w), 0, px.width);
  const y0 = clamp(Math.round(y), 0, px.height), y1 = clamp(Math.round(y + h), 0, px.height);
  const a = c[3] / 255;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) over(px.data, (yy * px.width + xx) * 4, c[0], c[1], c[2], a);
  }
}

const SUBROWS = 4;
let scratchCov = new Float32Array(0);
const scratchXs: number[] = [];

/**
 * Fills a polygon (even-odd) with anti-aliasing: four sub-scanlines per pixel row, exact horizontal coverage.
 * Points are in pixel coordinates, y down. Parts outside the picture are clipped.
 */
export function fillPolygon(px: Pixels, pts: readonly (readonly [number, number])[], c: RGBA): void {
  const { width: W, height: H, data } = px;
  const n = pts.length;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
  }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(W - 1, Math.ceil(maxX));
  if (y1 < y0 || x1 < x0) return;
  if (scratchCov.length < W) scratchCov = new Float32Array(W);
  const cov = scratchCov;
  const xs = scratchXs;
  const alpha = c[3] / 255;
  for (let y = y0; y <= y1; y++) {
    cov.fill(0, x0, x1 + 1);
    let any = false;
    for (let s = 0; s < SUBROWS; s++) {
      const sy = y + (s + 0.5) / SUBROWS;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[j]!, b = pts[i]!;
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = clamp(xs[k]!, 0, W), xb = clamp(xs[k + 1]!, 0, W);
        if (xb <= xa) continue;
        any = true;
        const ia = Math.floor(xa), ib = Math.min(W - 1, Math.floor(xb));
        if (ia === ib) { cov[ia] = cov[ia]! + (xb - xa) / SUBROWS; continue; }
        cov[ia] = cov[ia]! + (ia + 1 - xa) / SUBROWS;
        for (let x = ia + 1; x < ib; x++) cov[x] = cov[x]! + 1 / SUBROWS;
        cov[ib] = cov[ib]! + (xb - ib) / SUBROWS;
      }
    }
    if (!any) continue;
    for (let x = x0; x <= x1; x++) {
      const k = cov[x]!;
      if (k > 0) over(data, (y * W + x) * 4, c[0], c[1], c[2], Math.min(1, k) * alpha);
    }
  }
}

// ───────────────────────── the textures of a world ─────────────────────────

/**
 * The road: base colour with a little grain, two edge lines and lane dashes. Even lane counts get a solid divider
 * in the theme's centre colour (two lanes of three for two players). 256 px wide (512 for roads over 8 m), 1024 tall.
 */
export function roadPixels(road: Theme['road'], rng: Rng): Pixels {
  const width = road.width > 8 ? 512 : 256;
  const H = 1024;
  const s = width / 256;
  const px = createPixels(width, H, [...hexToRgb(road.base), 255]);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 22;
    d[i] = d[i]! + n; d[i + 1] = d[i + 1]! + n; d[i + 2] = d[i + 2]! + n;
  }
  const edge: RGBA = [...hexToRgb(road.edge), 255];
  fillRect(px, 4 * s, 0, 6 * s, H, edge);
  fillRect(px, width - 10 * s, 0, 6 * s, H, edge);
  const line: RGBA = [...hexToRgb(road.line), 255];
  const centre: RGBA = [...hexToRgb(road.center), 255];
  for (let k = 1; k < road.lanes; k++) {
    const cx = (width * k) / road.lanes;
    if (road.lanes % 2 === 0 && k === road.lanes / 2) {
      fillRect(px, cx - 4 * s, 0, 3 * s, H, centre);
      fillRect(px, cx + 1 * s, 0, 3 * s, H, centre);
    } else {
      for (let y = 0; y < H; y += 128) fillRect(px, cx - 2 * s, y, 4 * s, 64, line);
    }
  }
  return px;
}

/** Soft patches of brightness between two colours, used to break up flat ground. 128 x 128. */
export function noisePixels(a: string, b: string, rng: Rng, size = 128): Pixels {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  const px = createPixels(size, size);
  const enc = (v: number): number => Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255);
  for (let i = 0; i < size * size; i++) {
    const t = rng();
    px.data[i * 4] = enc(ca.r + (cb.r - ca.r) * t);
    px.data[i * 4 + 1] = enc(ca.g + (cb.g - ca.g) * t);
    px.data[i * 4 + 2] = enc(ca.b + (cb.b - ca.b) * t);
    px.data[i * 4 + 3] = 255;
  }
  return px;
}

/** Slanted stripes (hazard markings on obstacles). 512 x 64. */
export function stripePixels(a: string, b: string): Pixels {
  const px = createPixels(512, 64, [...hexToRgb(a), 255]);
  const fg: RGBA = [...hexToRgb(b), 255];
  for (let i = -1; i < 9; i++) {
    fillPolygon(px, [[i * 64, 0], [i * 64 + 32, 0], [i * 64 + 64, 64], [i * 64 + 32, 64]], fg);
  }
  return px;
}

/** A right-pointing arrow (mirrored for dir < 0) on a flat background, 256 x 256. */
export function arrowPixels(dir: number, bg: string, fg: string): Pixels {
  const px = createPixels(256, 256, [...hexToRgb(bg), 255]);
  const pts: [number, number][] = [[-70, -34], [20, -34], [20, -70], [84, 0], [20, 70], [20, 34], [-70, 34]];
  const k = dir < 0 ? -1 : 1;
  fillPolygon(px, pts.map(([x, y]) => [128 + k * x, 128 + y] as [number, number]), [...hexToRgb(fg), 255]);
  return px;
}

export type SpriteKind = 'cloud' | 'streak' | 'dot';

/** Soft white sprites: a cloud (128 x 128), a rain streak and a round dot (32 x 32). Alpha carries the shape. */
export function spritePixels(kind: SpriteKind): Pixels {
  if (kind === 'cloud') {
    const px = createPixels(128, 128, [255, 255, 255, 0]);
    const blobs: [number, number, number][] = [[64, 76, 34], [40, 84, 26], [92, 86, 26], [58, 60, 22], [78, 66, 20]];
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      let clear = 1;
      for (const [cx, cy, r] of blobs) {
        const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (t >= 1) continue;
        // stops: 0 -> 0.9, 0.7 -> 0.35, 1 -> 0
        const a = t < 0.7 ? 0.9 + (0.35 - 0.9) * (t / 0.7) : 0.35 * (1 - (t - 0.7) / 0.3);
        clear *= 1 - a;
      }
      px.data[(y * 128 + x) * 4 + 3] = (1 - clear) * 255;
    }
    return px;
  }
  const px = createPixels(32, 32, [255, 255, 255, 0]);
  if (kind === 'streak') {
    for (let y = 0; y < 32; y++) {
      const a = 1 - Math.abs(((y + 0.5) / 32) * 2 - 1);
      for (let x = 13; x < 19; x++) px.data[(y * 32 + x) * 4 + 3] = a * 255;
    }
    return px;
  }
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const t = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
    const a = t >= 1 ? 0 : t < 0.5 ? 1 + (0.6 - 1) * (t / 0.5) : 0.6 * (1 - (t - 0.5) / 0.5);
    px.data[(y * 32 + x) * 4 + 3] = a * 255;
  }
  return px;
}

/** A soft dark disc for blob shadows (the shadow of the lowest quality tier). 64 x 64, black with a falling alpha. */
export function blobPixels(): Pixels {
  const px = createPixels(64, 64, [0, 0, 0, 0]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const t = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) / 32;
    const a = t >= 1 ? 0 : 0.6 * (1 - t * t) * (1 - t * t);
    px.data[(y * 64 + x) * 4 + 3] = a * 255;
  }
  return px;
}

// ───────────────────────── the horizon ─────────────────────────

export const HORIZON_W = 2048;
export const HORIZON_H = 256;

type Pt = [number, number];

/** Silhouette outline of one layer, from the left edge to the right edge at the bottom of the picture. */
function horizonLayer(kind: Theme['horizon']['kind'], base: number, amp: number, step: number, rnd: Rng): Pt[] {
  const H = HORIZON_H, W = HORIZON_W;
  const pts: Pt[] = [[0, H]];
  let px = 0;
  const quad = (from: Pt, ctrl: Pt, to: Pt): void => {
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      pts.push([u * u * from[0] + 2 * u * t * ctrl[0] + t * t * to[0], u * u * from[1] + 2 * u * t * ctrl[1] + t * t * to[1]]);
    }
  };
  if (kind === 'skyline') {
    while (px < W) { const w = 24 + rnd() * 70, hh = base + rnd() * amp; pts.push([px, H - hh], [px + w, H - hh]); px += w; }
  } else if (kind === 'islands') {
    while (px < W) {
      const w = 120 + rnd() * 240;
      const hh = rnd() < 0.5 ? 0 : base + rnd() * amp;
      quad([px, H], [px + w / 2, H - hh * 2], [px + w, H]);
      px += w;
    }
  } else if (kind === 'dunes' || kind === 'hills') {
    let cur: Pt = [0, H];
    while (px < W) {
      const w = 160 + rnd() * 220, hh = base + rnd() * amp;
      const to: Pt = [px + w, H - base * 0.5];
      quad(cur, [px + w / 2, H - hh], to);
      cur = to; px += w;
    }
  } else if (kind === 'forest') {
    while (px < W) { const w = 12 + rnd() * 16, hh = base + rnd() * amp; pts.push([px + w / 2, H - hh], [px + w, H - hh * 0.7]); px += w; }
  } else {
    while (px <= W) { pts.push([px, H - (base + rnd() * amp)]); px += step + rnd() * step; }
  }
  pts.push([W, H]);
  return pts;
}

/** Height of the outline at each column (pixels above the bottom). */
function profile(pts: readonly Pt[]): Float32Array {
  const out = new Float32Array(HORIZON_W);
  let k = 0;
  for (let x = 0; x < HORIZON_W; x++) {
    const cx = x + 0.5;
    while (k + 1 < pts.length - 1 && pts[k + 1]![0] < cx) k++;
    const a = pts[k]!, b = pts[k + 1] ?? a;
    const t = b[0] === a[0] ? 1 : clamp((cx - a[0]) / (b[0] - a[0]), 0, 1);
    out[x] = HORIZON_H - (a[1] + (b[1] - a[1]) * t);
  }
  return out;
}

/**
 * The ring of distant mountains, dunes, forest, skyline, islands or hills around the horizon: two layers, the far
 * one lighter. Transparent above the silhouette. 2048 x 256. `seed` makes the same world draw the same skyline.
 */
export function horizonPixels(h: Theme['horizon'], rnd: Rng): Pixels {
  const px = createPixels(HORIZON_W, HORIZON_H, [0, 0, 0, 0]);
  const far = horizonLayer(h.kind, 70, 120, 60, rnd);
  fillPolygon(px, far, [...hexToRgb(h.colorFar), 255]);
  if (h.snow && h.kind === 'mountains') snowCaps(px, profile(far), rnd);
  fillPolygon(px, horizonLayer(h.kind, 30, 90, 90, rnd), [...hexToRgb(h.colorNear), 255]);
  if (h.kind === 'skyline') {
    for (let i = 0; i < 900; i++) {
      const x = rnd() * HORIZON_W, y = HORIZON_H - rnd() * 150;
      fillRect(px, x, y, 2, 2, [255, 220, 150, 204]);
    }
  }
  return px;
}

/** White caps on the high peaks of the far layer (themes with horizon.snow). */
function snowCaps(px: Pixels, heights: Float32Array, rnd: Rng): void {
  let peak = 0;
  for (const v of heights) if (v > peak) peak = v;
  const from = peak * 0.68;
  const caps: Pt[] = [];
  for (let x = 0; x < HORIZON_W; x += 2) {
    const v = heights[x]!;
    if (v > from) caps.push([x, HORIZON_H - v]);
  }
  // one small polygon per column pair: a band from the silhouette down by a depth that grows with the height
  for (const [x, y] of caps) {
    const depth = 5 + (HORIZON_H - y - from) * 0.28 + rnd() * 4;
    fillPolygon(px, [[x, y], [x + 2, y], [x + 2, y + depth], [x, y + depth]], [238, 244, 250, 255]);
  }
}

// ───────────────────────── DataTexture wrappers ─────────────────────────

export interface TextureOptions {
  /** Colour data (sRGB) is the default; pass false for data textures. */
  srgb?: boolean;
  repeat?: [number, number];
  wrap?: 'repeat' | 'clamp';
  anisotropy?: number;
  mipmaps?: boolean;
}

/** Flips rows (canvas order, top first) into texture order (bottom first). */
export function flipRows(px: Pixels): Uint8Array<ArrayBuffer> {
  const row = px.width * 4;
  const out = new Uint8Array(new ArrayBuffer(px.data.length));
  for (let y = 0; y < px.height; y++) out.set(px.data.subarray(y * row, (y + 1) * row), (px.height - 1 - y) * row);
  return out;
}

export function makeTexture(px: Pixels, o: TextureOptions = {}): THREE.DataTexture {
  const t = new THREE.DataTexture(flipRows(px), px.width, px.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  const mips = o.mipmaps ?? true;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  const wrap = o.wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapS = wrap; t.wrapT = wrap;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.anisotropy) t.anisotropy = o.anisotropy;
  t.needsUpdate = true;
  return t;
}
