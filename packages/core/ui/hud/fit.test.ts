import { describe, expect, it } from 'vitest';
import type { ReasonSlots } from '../layout.ts';
import { chooseReasonRow, fitCommand } from './fit.ts';

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
