// Procedural textures are plain pixels: the tests look at the bytes (no browser, no canvas).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../loop/rng.ts';
import {
  arrowPixels, blobPixels, createPixels, fillPolygon, fillRect, flipRows, horizonPixels, HORIZON_H, HORIZON_W, hexToRgb, makeTexture,
  noisePixels, roadPixels, spritePixels, stripePixels, type Pixels,
} from './textures.ts';
import type { Theme } from './theme.ts';

const at = (p: Pixels, x: number, y: number): [number, number, number, number] => {
  const i = (y * p.width + x) * 4;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!, p.data[i + 3]!];
};
const same = (a: Pixels, b: Pixels): boolean => a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]);
const near = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tol);

const road = (over: Partial<Theme['road']> = {}): Theme['road'] => ({ base: '#3b3c40', edge: '#d9d3bf', line: '#efe7c9', center: '#e8c55a', wet: false, width: 5.6, lanes: 3, ...over });

describe('hexToRgb', () => {
  it('reads #rrggbb and #rgb', () => {
    expect(hexToRgb('#1a2b3c')).toEqual([0x1a, 0x2b, 0x3c]);
    expect(hexToRgb('#fa0')).toEqual([255, 170, 0]);
  });
});

describe('fillPolygon and fillRect', () => {
  it('a rectangle polygon covers exactly its area', () => {
    const px = createPixels(40, 40, [0, 0, 0, 0]);
    fillPolygon(px, [[5, 5], [25, 5], [25, 15], [5, 15]], [255, 0, 0, 255]);
    let area = 0;
    for (let i = 3; i < px.data.length; i += 4) area += px.data[i]! / 255;
    expect(area).toBeCloseTo(200, 0);
  });

  it('a triangle is anti-aliased: its covered area matches the geometric area within 1 percent', () => {
    const px = createPixels(64, 64, [0, 0, 0, 0]);
    fillPolygon(px, [[4.3, 5.1], [58.7, 20.4], [11.9, 57.2]], [255, 255, 255, 255]);
    let area = 0;
    for (let i = 3; i < px.data.length; i += 4) area += px.data[i]! / 255;
    const geometric = Math.abs((58.7 - 4.3) * (57.2 - 5.1) - (11.9 - 4.3) * (20.4 - 5.1)) / 2;
    expect(Math.abs(area - geometric) / geometric).toBeLessThan(0.01);
  });

  it('clips parts outside the picture without throwing', () => {
    const px = createPixels(16, 16, [0, 0, 0, 0]);
    fillPolygon(px, [[-50, -50], [100, -50], [100, 100], [-50, 100]], [1, 2, 3, 255]);
    expect(at(px, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(at(px, 15, 15)).toEqual([1, 2, 3, 255]);
    fillRect(px, 10, 10, 100, 100, [9, 9, 9, 255]);
    expect(at(px, 15, 15)).toEqual([9, 9, 9, 255]);
  });

  it('two overlapping translucent fills blend as source-over', () => {
    const px = createPixels(4, 4, [0, 0, 0, 0]);
    fillRect(px, 0, 0, 4, 4, [255, 0, 0, 128]);
    fillRect(px, 0, 0, 4, 4, [0, 0, 255, 128]);
    const [r, g, b, a] = at(px, 1, 1);
    expect(a).toBeGreaterThan(185);   // 1 - 0.5 * 0.5 = 0.75
    expect(a).toBeLessThan(197);
    expect(b).toBeGreaterThan(r);
    expect(g).toBe(0);
  });
});

describe('roadPixels', () => {
  it('is 256 x 1024, 512 wide for roads over 8 m', () => {
    const a = roadPixels(road(), mulberry32(1));
    expect([a.width, a.height]).toEqual([256, 1024]);
    expect(roadPixels(road({ width: 11.2, lanes: 6 }), mulberry32(1)).width).toBe(512);
  });

  it('draws the edge lines in the edge colour and the dashes in the line colour', () => {
    const p = roadPixels(road(), mulberry32(1));
    expect(at(p, 6, 500).slice(0, 3)).toEqual([...hexToRgb('#d9d3bf')]);
    expect(at(p, 249, 500).slice(0, 3)).toEqual([...hexToRgb('#d9d3bf')]);
    // lane borders at 1/3 and 2/3 of the width: dash on rows 0..63 of every 128, a gap on 64..127
    expect(at(p, 85, 10).slice(0, 3)).toEqual([...hexToRgb('#efe7c9')]);
    expect(at(p, 171, 10).slice(0, 3)).toEqual([...hexToRgb('#efe7c9')]);
    expect(near(at(p, 85, 100).slice(0, 3), hexToRgb('#3b3c40'), 12)).toBe(true);
  });

  it('has grain around the base colour but keeps its mean', () => {
    const p = roadPixels(road(), mulberry32(2));
    let sum = 0, min = 255, max = 0, n = 0;
    for (let y = 100; y < 900; y += 7) for (let x = 20; x < 70; x++) { const v = at(p, x, y)[0]; sum += v; n++; if (v < min) min = v; if (v > max) max = v; }
    expect(Math.abs(sum / n - 0x3b)).toBeLessThan(1.5);
    expect(max - min).toBeGreaterThan(10);
    expect(max - min).toBeLessThan(26);
  });

  it('is the same for the same seed, different for another', () => {
    expect(same(roadPixels(road(), mulberry32(5)), roadPixels(road(), mulberry32(5)))).toBe(true);
    expect(same(roadPixels(road(), mulberry32(5)), roadPixels(road(), mulberry32(6)))).toBe(false);
  });

  it('an even lane count gets a solid divider in the centre colour (two lanes of three for two players)', () => {
    const p = roadPixels(road({ width: 11.2, lanes: 6 }), mulberry32(3));
    const mid = 256;
    for (const y of [0, 70, 300, 1000]) {
      const left = at(p, mid - 4 + 1, y).slice(0, 3), right = at(p, mid + 2, y).slice(0, 3);
      expect(left).toEqual([...hexToRgb('#e8c55a')]);
      expect(right).toEqual([...hexToRgb('#e8c55a')]);
    }
    // the other borders are dashed in the line colour
    const k = 512 / 6;
    expect(at(p, Math.round(k), 10).slice(0, 3)).toEqual([...hexToRgb('#efe7c9')]);
    expect(near(at(p, Math.round(k), 100).slice(0, 3), hexToRgb('#3b3c40'), 12)).toBe(true);
  });
});

describe('noisePixels', () => {
  it('stays between the two colours and is reproducible', () => {
    const p = noisePixels('#ffffff', '#d8d8d8', mulberry32(4));
    expect([p.width, p.height]).toEqual([128, 128]);
    for (let i = 0; i < p.data.length; i += 4) {
      expect(p.data[i]).toBeGreaterThanOrEqual(0xd7);
      expect(p.data[i]).toBeLessThanOrEqual(255);
      expect(p.data[i + 3]).toBe(255);
    }
    expect(same(p, noisePixels('#ffffff', '#d8d8d8', mulberry32(4)))).toBe(true);
    expect(same(p, noisePixels('#ffffff', '#d8d8d8', mulberry32(9)))).toBe(false);
  });
});

describe('stripePixels', () => {
  it('slants: the stripe at the top starts at x 0 to 32 and has moved by 32 at the bottom', () => {
    const p = stripePixels('#f3eee5', '#ff4f24');
    const fg = hexToRgb('#ff4f24'), bg = hexToRgb('#f3eee5');
    expect(at(p, 16, 0).slice(0, 3)).toEqual([...fg]);
    expect(at(p, 48, 0).slice(0, 3)).toEqual([...bg]);
    expect(at(p, 48, 62).slice(0, 3)).toEqual([...fg]);
    expect(at(p, 16, 62).slice(0, 3)).toEqual([...bg]);
  });
});

describe('arrowPixels', () => {
  it('points right for dir 1 and left for dir -1', () => {
    const fg = hexToRgb('#ffc93c'), bg = hexToRgb('#15130f');
    const r = arrowPixels(1, '#15130f', '#ffc93c'), l = arrowPixels(-1, '#15130f', '#ffc93c');
    expect([r.width, r.height]).toEqual([256, 256]);
    expect(at(r, 128, 128).slice(0, 3)).toEqual([...fg]);
    expect(at(r, 205, 128).slice(0, 3)).toEqual([...fg]);     // the tip
    expect(at(l, 205, 128).slice(0, 3)).toEqual([...bg]);
    expect(at(l, 50, 128).slice(0, 3)).toEqual([...fg]);
    expect(at(r, 5, 5).slice(0, 3)).toEqual([...bg]);
  });
});

describe('spritePixels and blobPixels', () => {
  it('dot: opaque centre, clear corners', () => {
    const p = spritePixels('dot');
    expect(at(p, 16, 16)[3]).toBeGreaterThan(240);
    expect(at(p, 0, 0)[3]).toBe(0);
    expect(at(p, 31, 31)[3]).toBe(0);
  });

  it('streak: a thin vertical line that fades at both ends', () => {
    const p = spritePixels('streak');
    expect(at(p, 16, 16)[3]).toBeGreaterThan(240);
    expect(at(p, 16, 0)[3]).toBeLessThan(10);
    expect(at(p, 16, 31)[3]).toBeLessThan(10);
    expect(at(p, 5, 16)[3]).toBe(0);
    expect(at(p, 26, 16)[3]).toBe(0);
  });

  it('cloud: soft and clear at the corners, dense in the middle', () => {
    const p = spritePixels('cloud');
    expect([p.width, p.height]).toEqual([128, 128]);
    expect(at(p, 64, 76)[3]).toBeGreaterThan(200);
    expect(at(p, 0, 0)[3]).toBe(0);
    expect(at(p, 127, 0)[3]).toBe(0);
    expect(at(p, 64, 76).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('blob shadow: dark in the middle, clear at the rim', () => {
    const p = blobPixels();
    expect(at(p, 32, 32)[3]).toBeGreaterThan(120);
    expect(at(p, 32, 32).slice(0, 3)).toEqual([0, 0, 0]);
    expect(at(p, 0, 0)[3]).toBe(0);
    expect(at(p, 63, 32)[3]).toBeLessThan(5);
  });
});

describe('horizonPixels', () => {
  const kinds: Theme['horizon']['kind'][] = ['mountains', 'dunes', 'forest', 'skyline', 'islands', 'hills'];
  const make = (kind: Theme['horizon']['kind'], snow = false, seed = 7): Pixels =>
    horizonPixels({ kind, colorFar: '#6f88a8', colorNear: '#4a607e', snow }, mulberry32(seed));

  it.each(kinds)('%s: 2048 x 256, clear at the top, a solid silhouette that rises from the bottom row', (kind) => {
    const p = make(kind);
    expect([p.width, p.height]).toEqual([HORIZON_W, HORIZON_H]);
    let solidColumns = 0;
    for (let x = 0; x < p.width; x += 8) {
      expect(at(p, x, 0)[3]).toBe(0);                 // nothing reaches the top row
      if (at(p, x, p.height - 1)[3] === 255) solidColumns++;
    }
    // The bottom row is filled, except between islands: half of the island slots are flat water by design.
    const share = solidColumns / (p.width / 8);
    if (kind === 'islands') { expect(share).toBeGreaterThan(0.3); expect(share).toBeLessThan(0.9); }
    else expect(share).toBeGreaterThan(0.97);
  });

  it.each(kinds)('%s: every column is clear above the silhouette and solid below it', (kind) => {
    const p = make(kind);
    for (let x = 4; x < p.width; x += 16) {
      let seenSolid = false;
      for (let y = 0; y < p.height; y++) {
        const a = at(p, x, y)[3];
        if (a > 200) seenSolid = true;
        if (seenSolid && kind !== 'skyline') expect(a, `${kind} column ${x} row ${y}`).toBeGreaterThan(200);
      }
    }
  });

  it('the same seed draws the same skyline, another seed another', () => {
    expect(same(make('mountains'), make('mountains'))).toBe(true);
    expect(same(make('mountains'), make('mountains', false, 8))).toBe(false);
  });

  it('far and near layers have their own colours', () => {
    const p = make('mountains');
    const colours = new Set<string>();
    for (let x = 0; x < p.width; x += 16) for (let y = 0; y < p.height; y += 4) { const c = at(p, x, y); if (c[3] === 255) colours.add(c.slice(0, 3).join()); }
    expect(colours.has(hexToRgb('#6f88a8').join())).toBe(true);
    expect(colours.has(hexToRgb('#4a607e').join())).toBe(true);
  });

  it('skylines have lit windows, other horizons do not', () => {
    const lit = (p: Pixels): number => { let n = 0; for (let i = 0; i < p.data.length; i += 4) if (p.data[i] === 255 && p.data[i + 1] === 220 && p.data[i + 2] === 150) n++; return n; };
    expect(lit(make('skyline'))).toBeGreaterThan(300);
    expect(lit(make('mountains'))).toBe(0);
  });

  it('mountains with snow get white caps on the high peaks; without snow they do not', () => {
    const white = (p: Pixels): number => { let n = 0; for (let i = 0; i < p.data.length; i += 4) if (p.data[i + 3] === 255 && p.data[i]! > 225 && p.data[i + 1]! > 230 && p.data[i + 2]! > 235) n++; return n; };
    expect(white(make('mountains', true))).toBeGreaterThan(200);
    expect(white(make('mountains', false))).toBe(0);
  });
});

describe('makeTexture', () => {
  it('flips the rows (a canvas starts at the top, a texture at the bottom) and sets the usual state', () => {
    const px = createPixels(2, 3);
    px.data.set([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255]);
    const flipped = flipRows(px);
    expect([...flipped.slice(0, 8)]).toEqual([5, 0, 0, 255, 6, 0, 0, 255]);
    const t = makeTexture(px, { repeat: [3, 4], anisotropy: 8 });
    expect(t).toBeInstanceOf(THREE.DataTexture);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.repeat.toArray()).toEqual([3, 4]);
    expect(t.anisotropy).toBe(8);
    expect(t.generateMipmaps).toBe(true);
    expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
  });

  it('data textures can skip colour space, mipmaps and repeat', () => {
    const t = makeTexture(createPixels(4, 4), { srgb: false, mipmaps: false, wrap: 'clamp' });
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.generateMipmaps).toBe(false);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });
});
