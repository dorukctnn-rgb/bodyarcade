import { describe, expect, it } from 'vitest';
import type { ReasonSlots } from '../layout.ts';
import { calibrationPip, chooseReasonRow, fitCommand, fitReasonFont, fitStatusFont, largestFit } from './fit.ts';

// A command plate whose width is 0.6 em per character plus 1.2 em for the glyph; wrapping makes it as narrow as it likes.
const widthOf = (text: string) => (font: number, s: { noGlyph: boolean; wrap: boolean }): number => {
  const full = (text.length * 0.6 + (s.noGlyph ? 0.4 : 1.6)) * font;
  return s.wrap ? Math.min(full, 300) : full;
};

describe('fitting the command', () => {
  const input = { startFont: 80, floor: 60, safeW: 1000 };

  it('keeps the size when it fits', () => {
    expect(fitCommand(input, widthOf('Squat'))).toEqual({ font: 80, noGlyph: false, wrap: false, maxWidth: null });
  });

  it('shrinks to the largest size that fits, never under the floor', () => {
    const text = 'x'.repeat(20); // (12 + 1.6) em: 80 px is 1088 wide, 73 px is 992
    const fit = fitCommand(input, widthOf(text));
    expect(fit).toMatchObject({ noGlyph: false, wrap: false, maxWidth: null });
    expect(fit.font).toBe(73);
    expect(widthOf(text)(fit.font, { noGlyph: false, wrap: false })).toBeLessThanOrEqual(1000);
    expect(widthOf(text)(fit.font + 1, { noGlyph: false, wrap: false })).toBeGreaterThan(1000);
  });

  it('drops the glyph when the floor size still does not fit, then wraps', () => {
    const noGlyphFits = fitCommand(input, widthOf('x'.repeat(26))); // 60 px: 15.6 + 1.6 = 17.2 em = 1032 with glyph, 960 without
    expect(noGlyphFits).toEqual({ font: 60, noGlyph: true, wrap: false, maxWidth: null });
    const wraps = fitCommand(input, widthOf('x'.repeat(60)));
    expect(wraps).toEqual({ font: 60, noGlyph: true, wrap: true, maxWidth: 1000 });
  });
});

describe('choosing the row of the reason strip', () => {
  const slots: ReasonSlots = {
    preferred: 'bottom',
    bottom: { row: 'bottom', x: 0, w: 300, centre: 150 },
    lifted: { row: 'lifted', x: 0, w: 900, centre: 450, bottomY: 500 },
  };

  it('uses the preferred row when the text needs two lines or fewer', () => {
    expect(chooseReasonRow(slots, (row) => (row === 'bottom' ? 2 : 1))).toEqual({ row: 'bottom', lines: 2 });
  });

  it('moves to the next row when the preferred one needs more', () => {
    expect(chooseReasonRow(slots, (row) => (row === 'bottom' ? 4 : 2))).toEqual({ row: 'lifted', lines: 2 });
  });

  it('takes the row with the fewest lines when none is good enough', () => {
    expect(chooseReasonRow(slots, (row) => (row === 'bottom' ? 5 : 3))).toEqual({ row: 'lifted', lines: 3 });
  });

  it('asks each row only once, in order', () => {
    const asked: string[] = [];
    chooseReasonRow({ ...slots, preferred: 'lifted' }, (row) => { asked.push(row); return 9; });
    expect(asked).toEqual(['lifted', 'bottom']);
  });
});

describe('the largest size that fits', () => {
  it('is the start when it fits, the floor when nothing does, and the largest whole size in between', () => {
    expect(largestFit(40, 20, () => true)).toBe(40);
    expect(largestFit(40, 20, () => false)).toBe(20);
    for (const limit of [20, 21, 27, 33, 39]) expect(largestFit(40, 20, (s) => s <= limit), `limit ${limit}`).toBe(limit);
  });

  it('asks about the start and the floor first, then halves: a handful of measurements, not one per size', () => {
    let asked = 0;
    largestFit(60, 12, (s) => { asked += 1; return s <= 31; });
    expect(asked).toBeLessThanOrEqual(9);
  });
});

describe('fitting a reason to two lines', () => {
  // A text of 20 em of width: the lines are its width over the width of the plate, rounded up.
  const linesOf = (em: number, plateW: number) => (font: number): number => Math.ceil((em * font) / plateW);

  it('keeps its own size while it takes two lines or fewer', () => {
    expect(fitReasonFont({ start: 24, floor: 16 }, linesOf(20, 300))).toEqual({ font: 24, lines: 2 });
  });

  it('gets smaller until it takes two lines, never under the floor', () => {
    // two lines of a 220 px plate hold 440 px of text: 22 px of this one
    expect(fitReasonFont({ start: 24, floor: 16 }, linesOf(20, 220))).toEqual({ font: 22, lines: 2 });
    // even 16 px takes four lines in a plate of 100 px: the floor, and the number of lines says so
    expect(fitReasonFont({ start: 24, floor: 16 }, linesOf(20, 100))).toEqual({ font: 16, lines: 4 });
  });
});

describe('fitting the status plates', () => {
  // Two plates of 7.2 em and 4.4 em, with a gap of 10 between them.
  const widthAt = (font: number): number => 11.6 * font + 10;

  it('keeps the size of the layout while the plates fit side by side', () => {
    expect(fitStatusFont({ start: 33, floor: 24, safeW: 400 }, widthAt)).toBe(33);
  });

  it('shrinks the numerals when a long score makes the plates touch, never under the floor', () => {
    const font = fitStatusFont({ start: 33, floor: 24, safeW: 336 }, widthAt);
    expect(font).toBe(28);
    expect(widthAt(font)).toBeLessThanOrEqual(336);
    expect(widthAt(font + 1)).toBeGreaterThan(336);
    expect(fitStatusFont({ start: 33, floor: 24, safeW: 200 }, widthAt)).toBe(24);
  });
});

describe('the large camera view while calibrating', () => {
  const safe = { x: 16, y: 16, w: 358, h: 812 };

  it('sits along the top of a portrait screen, centred, in the camera aspect', () => {
    const r = calibrationPip({ portrait: true, safe }, false);
    expect(r.y).toBe(16);
    expect(r.w / r.h).toBeCloseTo(3 / 4, 1);
    expect(Math.abs(r.x + r.w / 2 - (16 + 358 / 2))).toBeLessThanOrEqual(1);
    expect(r.w).toBeLessThanOrEqual(358);
    expect(r.h).toBeLessThanOrEqual(0.5 * 812 + 1);
  });

  it('sits on the left of a landscape screen, centred vertically, leaving the right for the card', () => {
    const land = { x: 20, y: 20, w: 1240, h: 760 };
    const r = calibrationPip({ portrait: false, safe: land }, false);
    expect(r.x).toBe(20);
    expect(r.w / r.h).toBeCloseTo(4 / 3, 1);
    expect(r.w).toBeLessThanOrEqual(0.52 * 1240 + 1);
    expect(Math.abs(r.y + r.h / 2 - (20 + 760 / 2))).toBeLessThanOrEqual(1);
    expect(r.x + r.w).toBeLessThan(20 + 1240 * 0.6);
  });

  it('is wide when two people share the camera', () => {
    const r = calibrationPip({ portrait: false, safe: { x: 20, y: 20, w: 1240, h: 760 } }, true);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1);
  });
});
