// Numbers from a photo's pixels, measured on the device and kept only inside the vault: sharpness (variance of the
// Laplacian on a small grey copy: the sharpest frame of a bucket wins, SPEC 2.4) and light (mean brightness of the
// person's box and of the background, and the red/blue ratio as a rough colour temperature, SPEC 2.7).

export interface Pixels { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export function toGray(p: Pixels): Float32Array {
  const g = new Float32Array(p.width * p.height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * p.data[j]! + 0.587 * p.data[j + 1]! + 0.114 * p.data[j + 2]!;
  return g;
}

/** Variance of the 4-neighbour Laplacian. Higher = sharper. */
export function sharpness(p: Pixels): number {
  const g = toGray(p), w = p.width, h = p.height;
  if (w < 3 || h < 3) return 0;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = g[i - 1]! + g[i + 1]! + g[i - w]! + g[i + w]! - 4 * g[i]!;
    sum += l; sum2 += l * l; n++;
  }
  const m = sum / n;
  return sum2 / n - m * m;
}

export interface LightStats { person: number; background: number; redBlue: number }

/** box: the person's box in fractions of the picture (from the pose points). */
export function lightStats(p: Pixels, box: { x0: number; y0: number; x1: number; y1: number }): LightStats {
  let ps = 0, pn = 0, bs = 0, bn = 0, r = 0, b = 0;
  const X0 = Math.floor(box.x0 * p.width), X1 = Math.ceil(box.x1 * p.width), Y0 = Math.floor(box.y0 * p.height), Y1 = Math.ceil(box.y1 * p.height);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const j = (y * p.width + x) * 4;
    const l = (0.299 * p.data[j]! + 0.587 * p.data[j + 1]! + 0.114 * p.data[j + 2]!) / 255;
    r += p.data[j]!; b += p.data[j + 2]!;
    if (x >= X0 && x < X1 && y >= Y0 && y < Y1) { ps += l; pn++; } else { bs += l; bn++; }
  }
  return { person: pn ? ps / pn : 0, background: bn ? bs / bn : 0, redBlue: b ? r / b : 1 };
}

/** "The light is different from last time" (SPEC 2.7): brightness or colour more than 15 % apart. Never blocks a capture. */
export function lightDiffers(a: LightStats, b: LightStats): 'darker' | 'brighter' | 'colour' | null {
  const rel = (x: number, y: number): number => Math.abs(x - y) / Math.max(1e-6, Math.max(x, y));
  if (rel(a.person, b.person) > 0.15) return b.person < a.person ? 'darker' : 'brighter';
  if (rel(a.redBlue, b.redBlue) > 0.15) return 'colour';
  return null;
}
