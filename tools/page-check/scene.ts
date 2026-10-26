// Is anything drawn behind the HUD? A game screen whose scene stays one flat colour (a canvas nobody draws on, a view that
// was never wired) passes every layout check, so page-check looks at the pixels: it decodes a screenshot (8-bit PNG, the
// format Chromium writes), leaves out the parts the page itself covers (the HUD plates, the camera picture, windows) and
// counts how much of the rest is one colour.
import { inflateSync } from 'node:zlib';

export interface Raster { width: number; height: number; /** RGBA, 4 bytes per pixel. */ data: Uint8Array }

/** Decodes a non-interlaced 8-bit PNG of colour type 2 (RGB), 6 (RGBA), 0 (grey) or 4 (grey and alpha). */
export function decodePng(buf: Uint8Array): Raster {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 33 || sig.some((b, i) => buf[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const name = String.fromCharCode(buf[pos + 4] as number, buf[pos + 5] as number, buf[pos + 6] as number, buf[pos + 7] as number);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { width = view.getUint32(pos + 8); height = view.getUint32(pos + 12); depth = body[8] as number; type = body[9] as number; interlace = body[12] as number; }
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(type)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const channels = type === 0 ? 1 : type === 2 ? 3 : type === 4 ? 2 : 4;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('truncated PNG');
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (cur[i - channels] as number) : 0;
      const b = prev[i] as number;
      const c = i >= channels ? (prev[i - channels] as number) : 0;
      let v = line[i] as number;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels >= 3) { out[o] = cur[x * channels] as number; out[o + 1] = cur[x * channels + 1] as number; out[o + 2] = cur[x * channels + 2] as number; out[o + 3] = channels === 4 ? (cur[x * channels + 3] as number) : 255; }
      else { const g = cur[x * channels] as number; out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = channels === 2 ? (cur[x * channels + 1] as number) : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface SceneReport {
  /** Pixels looked at (a grid over the scene, without the covered parts). */
  looked: number;
  /** Distinct colours (4 bits per channel) and the share of the commonest one. */
  colours: number;
  flatShare: number;
  /** The commonest colour, as #rrggbb of its centre. */
  flatColour: string;
}

/**
 * Looks at the scene rectangle on a grid of `step` pixels, skipping every rectangle of `covered`. The grid is 2 px: the line art of
 * a mirror game (a 3 px silhouette on a phone held sideways) falls between the points of a 4 px grid and the scene looked empty.
 */
export function analyseScene(img: Raster, scene: Rect, covered: readonly Rect[], step = 2): SceneReport {
  const counts = new Map<number, number>();
  let looked = 0;
  const x0 = Math.max(0, Math.floor(scene.x));
  const y0 = Math.max(0, Math.floor(scene.y));
  const x1 = Math.min(img.width, Math.ceil(scene.x + scene.w));
  const y1 = Math.min(img.height, Math.ceil(scene.y + scene.h));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      if (covered.some((r) => x >= r.x - 2 && x < r.x + r.w + 2 && y >= r.y - 2 && y < r.y + r.h + 2)) continue;
      const o = (y * img.width + x) * 4;
      const key = ((img.data[o] as number) >> 4) << 8 | ((img.data[o + 1] as number) >> 4) << 4 | ((img.data[o + 2] as number) >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      looked++;
    }
  }
  let top = 0;
  let topKey = 0;
  for (const [k, n] of counts) if (n > top) { top = n; topKey = k; }
  const hex = (n: number): string => (n * 16 + 8).toString(16).padStart(2, '0');
  return { looked, colours: counts.size, flatShare: looked ? top / looked : 1, flatColour: `#${hex(topKey >> 8)}${hex((topKey >> 4) & 15)}${hex(topKey & 15)}` };
}

/**
 * A scene with nothing drawn: one colour over everything that is not covered. A silhouette made of thin lines on a flat
 * background (Pad Work in the mirror) is a scene: it differs from the background in a few hundredths of a percent of the
 * picture, a blank one in none.
 */
export const isBlank = (r: SceneReport): boolean => r.looked >= 200 && (r.colours <= 1 || r.flatShare >= 0.9995);
