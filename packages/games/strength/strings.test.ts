// The words of Firework Jacks and Twist Turbine: five languages with the same lines, the house copy rules, and the text budgets of
// design/LAYOUT.md section 8 for the commands (two words at most, a soft hyphen in a word over eight letters) and the cues of the reason
// strip (cues.ts: two lines of ten letters, so that the narrowest strip never takes a third).
import { describe, expect, it } from 'vitest';
import { tableBudgetProblems, tableCopyProblems, tableShapeProblems } from '../_shared/testing/strings.ts';
import { FJ_STRINGS, TT_STRINGS } from './strings.ts';

describe.each([
  ['Firework Jacks', FJ_STRINGS, /^fj\.prompt\./],
  ['Twist Turbine', TT_STRINGS, /^tt\.prompt\./],
] as const)('%s words', (_name, tables, commands) => {
  it('has the same lines, with the same placeholders, in English, Turkish, German, Spanish and French', () => {
    expect(tableShapeProblems(tables)).toEqual([]);
  });

  it('follows the copy rules in every line', () => {
    expect(tableCopyProblems(tables)).toEqual([]);
  });

  it('keeps the commands to the text budget (two words, soft hyphen over eight letters) and the cues to the strip', () => {
    expect(tableBudgetProblems(tables, { commands, reasons: /^cue\./ })).toEqual([]);
  });
});
