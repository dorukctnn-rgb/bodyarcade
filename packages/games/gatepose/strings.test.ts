// The words of Limbo Bend and Pose Wall: five languages with the same lines, the house copy rules, and the text budgets of
// design/LAYOUT.md section 8 for the commands (two words at most, a soft hyphen in a word over eight letters) and for the reasons
// the strip says during play (40 characters in English, 48 in translations, and two lines of ten letters: cues.ts).
import { describe, expect, it } from 'vitest';
import { tableBudgetProblems, tableCopyProblems, tableShapeProblems } from '../_shared/testing/strings.ts';
import { LB_STRINGS, PW_STRINGS } from './strings.ts';

describe.each([
  ['Limbo Bend', LB_STRINGS, /^lb\.prompt\./, /^cue\./],
  ['Pose Wall', PW_STRINGS, /^pw\.prompt\./, /^(cue\.|pw\.(off\.|fit$|team$))/],
] as const)('%s words', (_name, tables, commands, reasons) => {
  it('has the same lines, with the same placeholders, in English, Turkish, German, Spanish and French', () => {
    expect(tableShapeProblems(tables)).toEqual([]);
  });

  it('follows the copy rules in every line', () => {
    expect(tableCopyProblems(tables)).toEqual([]);
  });

  it('keeps the commands and the reasons to the text budgets', () => {
    expect(tableBudgetProblems(tables, { commands, reasons })).toEqual([]);
  });
});
