// Light: "too dark" and "the light is behind you" from a coarse brightness map of the camera picture (LightGrid, 192
// numbers measured a few times a second on the device; never the picture itself). The pose model finds no body in a
// dark room or against a window, and the player cannot tell why; these two codes say it.
import { LM, type Landmark, type LightGrid } from '../types/index.ts';
import { isVisible } from './geometry.ts';

export type LightCode = 'too_dark' | 'backlit';

export const LIGHT_LIMITS = {
  /** The mean brightness of the whole picture below this: too dark (0 black, 1 white, as the camera shows it). */
  darkMean: 0.12,
  /** Nothing bright anywhere: the brightest tenth of the picture is below this. */
  darkBright: 0.2,
  /** The face region below this is too dark whatever the room looks like. */
  darkFace: 0.1,
  /** Backlight: the bright surroundings over the face, and the floors the two must pass. */
  backRatio: 2.2,
  backBright: 0.5,
  backFaceMax: 0.3,
  /** With nobody found: the middle of the picture against its sides. */
  backRatioAlone: 2.5,
  backBrightAlone: 0.55,
  backCentreMax: 0.25,
} as const;

const mean = (v: readonly number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

function quantile(v: readonly number[], q: number): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] as number;
}

/** A grid that is usable: the right number of finite cells. */
export function validGrid(g: LightGrid | undefined | null): g is LightGrid {
  return !!g && g.cols > 0 && g.rows > 0 && g.luma.length === g.cols * g.rows && g.luma.every((v) => Number.isFinite(v));
}

/**
 * Which light problem the picture has, or null. With a person (landmarks) the face and the surroundings are compared;
 * without, the middle of the picture against its sides. `aspect` is the picture's width over height.
 */
export function lightProblem(grid: LightGrid, lm: Landmark[] | null, aspect = 4 / 3): LightCode | null {
  if (!validGrid(grid)) return null;
  const { cols, rows, luma } = grid;
  const L = LIGHT_LIMITS;
  if (mean(luma) < L.darkMean || quantile(luma, 0.9) < L.darkBright) return 'too_dark';

  const cell = (c: number, r: number): number => luma[r * cols + c] as number;
  const cx = (c: number): number => (c + 0.5) / cols;
  const cy = (r: number): number => (r + 0.5) / rows;

  const nose = lm && isVisible(lm, LM.nose, 0.3) ? (lm[LM.nose] as Landmark) : null;
  const ls = lm && isVisible(lm, LM.leftShoulder, 0.3) ? (lm[LM.leftShoulder] as Landmark) : null;
  const rs = lm && isVisible(lm, LM.rightShoulder, 0.3) ? (lm[LM.rightShoulder] as Landmark) : null;

  if (nose && ls && rs) {
    // A person: the face region (a square about a shoulder width wide around the nose), and the columns outside the body.
    const fw = Math.max(0.5 * Math.abs(ls.x - rs.x), 0.5 / cols);
    const fh = fw * aspect;
    const face: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (Math.abs(cx(c) - nose.x) <= fw && Math.abs(cy(r) - nose.y) <= fh) face.push(cell(c, r));
    }
    if (!face.length) face.push(cell(Math.min(cols - 1, Math.max(0, Math.floor(nose.x * cols))), Math.min(rows - 1, Math.max(0, Math.floor(nose.y * rows)))));
    const faceMean = mean(face);
    if (faceMean < L.darkFace) return 'too_dark';
    const lo = Math.min(ls.x, rs.x) - 0.08, hi = Math.max(ls.x, rs.x) + 0.08;
    const around: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cx(c) < lo || cx(c) > hi) around.push(cell(c, r));
    if (around.length >= 8) {
      const bright = quantile(around, 0.75);
      if (bright >= L.backBright && faceMean <= L.backFaceMax && bright / Math.max(faceMean, 0.03) >= L.backRatio) return 'backlit';
    }
    return null;
  }

  // Nobody found: a dark middle against bright sides is a person against a window (or nothing at all).
  const centre: number[] = [], sides: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = cx(c), y = cy(r);
    if (x >= 0.35 && x <= 0.65 && y >= 0.15 && y <= 0.65) centre.push(cell(c, r));
    else if (x < 0.25 || x > 0.75) sides.push(cell(c, r));
  }
  if (centre.length && sides.length) {
    const c = mean(centre), s = quantile(sides, 0.75);
    if (s >= L.backBrightAlone && c <= L.backCentreMax && s / Math.max(c, 0.03) >= L.backRatioAlone) return 'backlit';
  }
  return null;
}
