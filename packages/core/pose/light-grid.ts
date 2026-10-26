// The brightness map of a camera picture (types/pose.ts LightGrid): 16 x 12 cells of mean luma, measured on the device a
// few times a second from the same picture the pose model gets. Only these 192 numbers leave this file; the picture is
// not kept and not sent anywhere. The calibration reads "too dark" and "the light is behind you" from it
// (core/body/light.ts), because the model finds nobody in a dark room or against a window and the player cannot tell why.
import type { LightGrid } from '../types/index.ts';

export const LIGHT_COLS = 16;
export const LIGHT_ROWS = 12;
/** The picture is drawn this small first; every cell is then 4 x 4 pixels. */
export const LIGHT_SAMPLE = { w: 64, h: 48 } as const;
/** A map is measured at most this often (ms): a few per second is plenty for a room's light. */
export const LIGHT_EVERY_MS = 400;

/** Mean luma (0..255, Rec. 709 on the values the camera shows) of each cell of an RGBA picture, row by row from the top left. */
export function lumaCells(rgba: ArrayLike<number>, w: number, h: number, cols = LIGHT_COLS, rows = LIGHT_ROWS): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor(r * ch), y1 = Math.max(y0 + 1, Math.floor((r + 1) * ch));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cw), x1 = Math.max(x0 + 1, Math.floor((c + 1) * cw));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          sum += 0.2126 * (rgba[i] as number) + 0.7152 * (rgba[i + 1] as number) + 0.0722 * (rgba[i + 2] as number);
          n++;
        }
      }
      out[r * cols + c] = n ? Math.round(sum / n) : 0;
    }
  }
  return out;
}

/** The map the calibration reads: luma 0..1, three decimals. */
export function toLightGrid(cells: ArrayLike<number>, cols = LIGHT_COLS, rows = LIGHT_ROWS): LightGrid {
  const luma: number[] = new Array<number>(cells.length);
  for (let i = 0; i < cells.length; i++) luma[i] = Math.round(((cells[i] as number) / 255) * 1000) / 1000;
  return { cols, rows, luma };
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface LightMeter {
  /** Cells of `src` (an ImageBitmap in a worker, a video element on the main thread); null when the browser cannot read it. */
  measure(src: CanvasImageSource): Uint8Array | null;
}

/** One small canvas, made on first use (in a worker an OffscreenCanvas, otherwise a canvas element). */
export function createLightMeter(): LightMeter {
  let ctx: Canvas2D | null | undefined;
  const open = (): Canvas2D | null => {
    if (ctx !== undefined) return ctx;
    ctx = null;
    try {
      const { w, h } = LIGHT_SAMPLE;
      if (typeof OffscreenCanvas === 'function') {
        ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
      } else if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        ctx = c.getContext('2d', { willReadFrequently: true });
      }
      if (ctx) ctx.imageSmoothingQuality = 'high';
    } catch { ctx = null; }
    return ctx;
  };
  return {
    measure(src: CanvasImageSource): Uint8Array | null {
      const c = open();
      if (!c) return null;
      try {
        const { w, h } = LIGHT_SAMPLE;
        c.drawImage(src, 0, 0, w, h);
        return lumaCells(c.getImageData(0, 0, w, h).data, w, h);
      } catch { return null; }   // a picture that cannot be read this time: no map for this frame
    },
  };
}
