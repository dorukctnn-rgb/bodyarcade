// Test support: checks of a game's string tables that every game of this folder shares: the five languages have the same lines with
// the same {placeholders}, every line follows the house copy rules, and the commands and the reasons keep to the text budgets of
// design/LAYOUT.md section 8 (kit-g1/testing/strings.ts has the budget rules). Nothing in production imports this.
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

/** The commands and the reasons of a table against the text budgets. */
export function tableBudgetProblems(tables: Tables, o: { commands: RegExp; reasons?: RegExp }): string[] {
  return budgetProblems(tables, o);
}
