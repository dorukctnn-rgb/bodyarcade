// Test support: checks of a game's string tables that every game of this folder shares: the five languages have the same lines with
// the same {placeholders}, every line follows the house copy rules, and the commands and the reasons keep to the text budgets of
// design/LAYOUT.md section 8 (kit-g1/testing/strings.ts has the budget rules; a reason also has to fit the strip, see STRIP below). Nothing in
// production imports this.
import { copyProblems } from '../../../web/catalogue/copy.ts';
import { budgetProblems } from '../../kit-g1/testing/strings.ts';
import type { Tables } from '../text.ts';

const LANGS = ['en', 'tr', 'de', 'es', 'fr'] as const;
const slotsOf = (line: string): string => [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort().join(',');

/** Lines one language has and another does not, and lines whose {placeholders} differ from the English line. */
export function tableShapeProblems(tables: Tables): string[] {
  const out: string[] = [];
  const en = tables.en;
  for (const lang of LANGS) {
    const t = tables[lang];
    for (const k of Object.keys(en)) {
      if (t[k] === undefined) out.push(`${lang} lacks ${k}`);
      else if (slotsOf(t[k] as string) !== slotsOf(en[k] as string)) out.push(`${lang} ${k}: placeholders {${slotsOf(t[k] as string)}} against English {${slotsOf(en[k] as string)}}`);
    }
    for (const k of Object.keys(t)) if (en[k] === undefined) out.push(`${lang} has ${k}, which English has not`);
  }
  return out;
}

/** Copy rule problems (dashes, arrows, emoji, exclamation marks, hype words, spacing) in every line of every language. */
export function tableCopyProblems(tables: Tables): string[] {
  const out: string[] = [];
  for (const lang of LANGS) for (const [k, v] of Object.entries(tables[lang])) for (const p of copyProblems(v)) out.push(`${lang} ${k}: ${p}`);
  return out;
}

/**
 * What a reason of the strip has to fit: the strip beside the self view is the narrowest plate of the HUD. On a 360 px phone with the view in
 * the bottom left corner it is about 205 px wide measured from where the last, short reason left it, minus the dot and the padding (three
 * letter heights), which holds about ten letters of the 23 px type, and a reason takes two lines at most (design/LAYOUT.md 8). The browser
 * run that decides is tests/e2e/g3-hud-reasons.spec.ts; this is the cheap check that finds a line that cannot pass it.
 */
export const STRIP = { perLine: 10, lines: 2 } as const;

/** What is wrong with a reason as a strip line: a word longer than a line, or more than two lines when filled word by word. */
export function stripProblems(text: string, o: { perLine: number; lines: number } = STRIP): string[] {
  const words = text.replace(/\{\w+\}/g, '100').split('­').join('').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > o.perLine) out.push(`"${w}" is longer than a line of ${o.perLine} letters`);
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= o.perLine) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > o.lines) out.push(`${lines.length} lines of ${o.perLine} letters (at most ${o.lines}): ${lines.join(' / ')}`);
  return out;
}

/** The commands and the reasons of a table against the text budgets (a reason also has to fit the strip, in every language). */
export function tableBudgetProblems(tables: Tables, o: { commands: RegExp; reasons?: RegExp }): string[] {
  const out = budgetProblems(tables, o);
  if (o.reasons) for (const lang of LANGS) for (const [k, v] of Object.entries(tables[lang])) if (o.reasons.test(k)) for (const p of stripProblems(v)) out.push(`${lang} ${k}: ${p}`);
  return out;
}
