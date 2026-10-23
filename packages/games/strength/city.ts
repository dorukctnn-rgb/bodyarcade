// A night city in two layers of flat buildings (design/art tiles for Firework Jacks and Twist Turbine: night 800 and 950,
// windows in sun against night 600). The city is data made once from a seeded stream; a draw fills a band of the screen
// with it and lights a share of the windows, building by building (Twist Turbine "şehir blok blok aydınlanır") with a
// little variance inside a building. No text, no gradients: flat shapes, cheap on a phone.
import type { Ctx2D } from '../../core/render2d/ctx.ts';
import type { Rect } from '../../core/render2d/view.ts';
import type { Rng } from '../../core/types/index.ts';

export interface Building {
  /** Left edge and width as shares of the band's width, height as a share of its height. */
  x: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** Where in the order of lighting this building comes (0 first, 1 last). */
  order: number;
  /** The same for each window of the building, in row-major order. */
  win: number[];
  layer: 0 | 1;
}

export interface City { buildings: Building[] }

export interface CityStyle {
  far: string;
  near: string;
  windowOn: string;
  windowOff: string;
}

export const CITY_NIGHT: CityStyle = { far: '#31285A', near: '#1E1738', windowOn: '#FFC53A', windowOff: '#40366E' };

export function makeCity(rng: Rng, o: { nearCount?: number } = {}): City {
  const buildings: Building[] = [];
  const nearCount = o.nearCount ?? 11;
  for (const layer of [0, 1] as const) {
    const count = layer === 0 ? nearCount + 4 : nearCount;
    const span = 1.08;
    let x = -0.04;
    for (let i = 0; i < count; i++) {
      const left = span - (x + 0.04);
      const slot = left / (count - i);
      const w = Math.min(slot * (0.8 + rng() * 0.35), left);
      const h = layer === 0 ? 0.3 + rng() * 0.38 : 0.2 + rng() * 0.34;
      const cols = Math.max(2, Math.min(5, Math.round(w / 0.022)));
      const rows = Math.max(3, Math.min(10, Math.round(h / 0.045)));
      buildings.push({ x, w, h, cols, rows, order: rng(), win: Array.from({ length: cols * rows }, () => rng()), layer });
      x += slot;
    }
  }
  return { buildings };
}

/** Is this window lit when a share `lit` (0..1) of the city is lit? */
export const windowLit = (b: Building, i: number, lit: number): boolean => 0.78 * b.order + 0.22 * (b.win[i] as number) < lit * 1.0001 - 0.0001;

/** How many windows of the city are lit at this share (for the tests and the HUD's honesty). */
export function litCount(city: City, lit: number): { lit: number; total: number } {
  let on = 0, total = 0;
  for (const b of city.buildings) {
    if (b.layer !== 1) continue;
    for (let i = 0; i < b.win.length; i++) { total++; if (windowLit(b, i, lit)) on++; }
  }
  return { lit: on, total };
}

/** Draws the city into a band: its bottom is the band's bottom. `lit` is the share of the near windows that are on. */
export function drawCity(ctx: Ctx2D, city: City, band: Rect, lit: number, style: CityStyle = CITY_NIGHT): void {
  ctx.save();
  // buildings, far then near
  for (const layer of [0, 1] as const) {
    ctx.fillStyle = layer === 0 ? style.far : style.near;
    for (const b of city.buildings) {
      if (b.layer !== layer) continue;
      const h = b.h * band.h;
      ctx.fillRect(band.x + b.x * band.w, band.y + band.h - h, b.w * band.w, h + 1);
    }
  }
  // windows of the near layer: the dim ones, then the lit ones (two fill styles, not one per window)
  for (const on of [false, true]) {
    ctx.fillStyle = on ? style.windowOn : style.windowOff;
    for (const b of city.buildings) {
      if (b.layer !== 1) continue;
      const bx = band.x + b.x * band.w, bw = b.w * band.w, bh = b.h * band.h, top = band.y + band.h - bh;
      const cw = bw / (b.cols + 0.6), ch = bh / (b.rows + 1.2);
      const ww = Math.max(2, cw * 0.58), wh = Math.max(2, ch * 0.52);
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < b.cols; c++) {
          const i = r * b.cols + c;
          if (windowLit(b, i, lit) !== on) continue;
          ctx.fillRect(bx + cw * (c + 0.5) + (cw - ww) / 2 - cw * 0.25, top + ch * (r + 0.9) + (ch - wh) / 2 - ch * 0.15, ww, wh);
        }
      }
    }
  }
  ctx.restore();
}
