// How text is made to fit the HUD plates, with the measuring injected so the rules are testable without a browser.
// Ported from the art director's HUD page (design/ui-kit/hud.html): a long command (other languages) first shrinks, never
// below the floor, then loses its move glyph, then wraps; a reason goes where it needs at most two lines.
import type { ReasonRow } from '../layout.ts';

export interface CommandFit {
  font: number;
  noGlyph: boolean;
  wrap: boolean;
  /** Set when the command wraps: the width it may take. */
  maxWidth: number | null;
}

export interface CommandFitInput {
  /** The size the command starts at (8 % of the screen height or the phone floor). */
  startFont: number;
  /** It never shrinks below this. */
  floor: number;
  /** The width of the safe area. */
  safeW: number;
}

/** `widthAt(font, state)` is the rendered width of the command plate for a font size and glyph and wrap state. */
export function fitCommand(i: CommandFitInput, widthAt: (font: number, state: { noGlyph: boolean; wrap: boolean }) => number): CommandFit {
  const full = { noGlyph: false, wrap: false };
  const fits = (font: number, s: { noGlyph: boolean; wrap: boolean }): boolean => widthAt(font, s) <= i.safeW;
  if (fits(i.startFont, full)) return { font: i.startFont, noGlyph: false, wrap: false, maxWidth: null };

  // Width grows with the font size, so the largest size that fits is found by halving.
  let lo = i.floor;
  let hi = i.startFont;
  if (fits(lo, full)) {
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid, full)) lo = mid; else hi = mid;
    }
    return { font: lo, noGlyph: false, wrap: false, maxWidth: null };
  }
  const bare = { noGlyph: true, wrap: false };
  if (fits(i.floor, bare)) return { font: i.floor, noGlyph: true, wrap: false, maxWidth: null };
  return { font: i.floor, noGlyph: true, wrap: true, maxWidth: i.safeW };
}

/**
 * The largest whole size from `start` down to `floor` at which `fits(size)` holds, for a test that only gets easier as the
 * size falls (a text takes fewer lines, two plates take less room). `floor` when even that does not fit: the caller then
 * knows the rule could not be kept and the checks report it.
 */
export function largestFit(start: number, floor: number, fits: (size: number) => boolean): number {
  if (fits(start)) return start;
  if (!fits(floor)) return floor;
  let lo = floor; // fits
  let hi = start; // does not
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** A reason may take this many lines of its plate (the kit's own clamp). */
export const REASON_LINES = 2;

/**
 * The size of a reason that takes two lines or fewer (`lines`: the room that was kept for it) in a plate of the width it was given:
 * the size it starts at while that holds, then smaller, never under the floor. `linesAt(font)` is the number of lines the text takes at a size.
 */
export function fitReasonFont(i: { start: number; floor: number; lines?: number }, linesAt: (font: number) => number): { font: number; lines: number } {
  const most = i.lines ?? REASON_LINES;
  const font = largestFit(i.start, i.floor, (f) => linesAt(f) <= most);
  return { font, lines: linesAt(font) };
}

/**
 * The size of the numerals of the status plates at which the plates sit side by side inside the safe area: the size the
 * layout gives them while that holds (a score of four digits, the lives and a combo on a narrow phone may not), then
 * smaller, never under the floor. `widthAt(font)` is the width the plates take together, the gaps between them included.
 */
export function fitStatusFont(i: { start: number; floor: number; safeW: number }, widthAt: (font: number) => number): number {
  return largestFit(i.start, i.floor, (f) => widthAt(f) <= i.safeW);
}

/** What the reason strip can be given: the width of each row it may stand in. */
export type ReasonRows = { preferred: ReasonRow } & Partial<Record<ReasonRow, { w: number }>>;

/**
 * Picks the row for the reason strip: the preferred row if its text takes two lines or fewer at that row's width,
 * otherwise the next one, and when none do, the one with the fewest lines (the text is then made smaller to fit).
 */
export function chooseReasonRow(slots: ReasonRows, linesAt: (row: ReasonRow, maxWidth: number) => number, most = REASON_LINES): { row: ReasonRow; lines: number } {
  const order = ([slots.preferred, 'bottom', 'lifted', 'side'] as const).filter((k, i, a) => slots[k] && a.indexOf(k) === i);
  let best: { row: ReasonRow; lines: number } | null = null;
  for (const row of order) {
    const slot = slots[row];
    if (!slot) continue;
    const lines = linesAt(row, slot.w);
    if (lines <= most) return { row, lines };
    if (!best || lines < best.lines) best = { row, lines };
  }
  return best ?? { row: 'bottom', lines: 0 };
}

const round = (n: number): number => Math.round(n);

/**
 * Where the camera view goes while the player is getting into frame: large, because the player needs to see
 * themselves. Portrait screens: along the top, the calibration card below. Landscape: on the left, the card on the right.
 */
export function calibrationPip(m: { portrait: boolean; safe: { x: number; y: number; w: number; h: number } }, duo: boolean): { x: number; y: number; w: number; h: number } {
  const aspect = duo ? 16 / 9 : m.portrait ? 3 / 4 : 4 / 3;
  const { safe } = m;
  const maxW = m.portrait ? safe.w : 0.52 * safe.w;
  const maxH = m.portrait ? 0.5 * safe.h : safe.h;
  const h = Math.min(maxH, maxW / aspect);
  const w = h * aspect;
  const x = m.portrait ? safe.x + (safe.w - w) / 2 : safe.x;
  const y = m.portrait ? safe.y : safe.y + (safe.h - h) / 2;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}
