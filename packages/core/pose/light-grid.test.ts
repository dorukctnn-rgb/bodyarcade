// The brightness map: cells of mean luma from an RGBA picture, in the order the calibration expects (row by row from the
// top left of the raw image), and the conversion to 0..1. The measurement on a real camera picture is in tests/e2e/pose-person.spec.ts.
import { describe, expect, it } from 'vitest';
import { LIGHT_COLS, LIGHT_ROWS, LIGHT_SAMPLE, createLightMeter, lumaCells, toLightGrid } from './light-grid.ts';

const { w, h } = LIGHT_SAMPLE;

/** A picture made of a colour per pixel. */
function picture(at: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * w + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}

describe('lumaCells', () => {
  it('has 16 x 12 cells, 192 numbers', () => {
    expect(LIGHT_COLS * LIGHT_ROWS).toBe(192);
    expect(lumaCells(picture(() => [10, 10, 10]), w, h).length).toBe(192);
  });

  it('white is 255, black is 0, a grey is itself', () => {
    expect([...new Set(lumaCells(picture(() => [255, 255, 255]), w, h))]).toEqual([255]);
    expect([...new Set(lumaCells(picture(() => [0, 0, 0]), w, h))]).toEqual([0]);
    expect([...new Set(lumaCells(picture(() => [128, 128, 128]), w, h))]).toEqual([128]);
  });

  it('weighs the colours like the eye does: green counts most, blue least', () => {
    const red = lumaCells(picture(() => [255, 0, 0]), w, h)[0] as number;
    const green = lumaCells(picture(() => [0, 255, 0]), w, h)[0] as number;
    const blue = lumaCells(picture(() => [0, 0, 255]), w, h)[0] as number;
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(red).toBe(54);
    expect(green).toBe(182);
    expect(blue).toBe(18);
  });

  it('keeps the place of each cell: the left half bright, the right half dark; the top bright, the bottom dark', () => {
    const lr = lumaCells(picture((x) => (x < w / 2 ? [255, 255, 255] : [0, 0, 0])), w, h);
    for (let r = 0; r < LIGHT_ROWS; r++) {
      for (let c = 0; c < LIGHT_COLS; c++) expect(lr[r * LIGHT_COLS + c]).toBe(c < LIGHT_COLS / 2 ? 255 : 0);
    }
    const tb = lumaCells(picture((_x, y) => (y < h / 2 ? [255, 255, 255] : [0, 0, 0])), w, h);
    for (let r = 0; r < LIGHT_ROWS; r++) {
      for (let c = 0; c < LIGHT_COLS; c++) expect(tb[r * LIGHT_COLS + c]).toBe(r < LIGHT_ROWS / 2 ? 255 : 0);
    }
  });

  it('averages inside a cell: half white, half black pixels give a mid grey', () => {
    const mix = lumaCells(picture((x) => (x % 2 === 0 ? [255, 255, 255] : [0, 0, 0])), w, h);
    for (const v of mix) expect(Math.abs(v - 128)).toBeLessThanOrEqual(1);
  });

  it('copes with a picture that is not a multiple of the grid', () => {
    const odd = new Uint8ClampedArray(50 * 37 * 4).fill(200);
    const cells = lumaCells(odd, 50, 37);
    expect(cells.length).toBe(192);
    expect([...new Set(cells)]).toEqual([200]);
  });
});

describe('toLightGrid', () => {
  it('scales to 0..1 with three decimals and carries the size', () => {
    const g = toLightGrid(new Uint8Array(192).fill(51));
    expect(g).toMatchObject({ cols: 16, rows: 12 });
    expect(g.luma.length).toBe(192);
    expect(g.luma[0]).toBe(0.2);
    expect(toLightGrid([0, 255, 128], 3, 1).luma).toEqual([0, 1, 0.502]);
  });
});

describe('createLightMeter', () => {
  it('without a canvas (a plain Node run) it says nothing instead of failing', () => {
    expect(createLightMeter().measure({} as CanvasImageSource)).toBeNull();
  });
});
