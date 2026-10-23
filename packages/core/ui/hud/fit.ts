// How text is made to fit the HUD plates, with the measuring injected so the rules are testable without a browser.
// Ported from the art director's HUD page (design/ui-kit/hud.html): a long command (other languages) first shrinks, never
// below the floor, then loses its move glyph, then wraps; a reason goes where it needs at most two lines.
import type { ReasonRow, ReasonSlots } from '../layout.ts';

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
 * Picks the row for the reason strip: the preferred row if its text takes two lines or fewer at that row's width,
 * otherwise the next one, and when none do, the one with the fewest lines (the check then reports it).
 */
export function chooseReasonRow(slots: ReasonSlots, linesAt: (row: ReasonRow, maxWidth: number) => number): { row: ReasonRow; lines: number } {
  const order = ([slots.preferred, 'bottom', 'lifted', 'side'] as const).filter((k, i, a) => slots[k] && a.indexOf(k) === i);
  let best: { row: ReasonRow; lines: number } | null = null;
  for (const row of order) {
    const slot = slots[row];
    if (!slot) continue;
    const lines = linesAt(row, slot.w);
    if (lines <= 2) return { row, lines };
    if (!best || lines < best.lines) best = { row, lines };
  }
  return best ?? { row: 'bottom', lines: 0 };
}
