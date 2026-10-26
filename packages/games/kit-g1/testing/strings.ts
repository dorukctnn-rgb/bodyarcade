// The text budgets of design/LAYOUT.md section 8, as checks for the games' string tables (test support: nothing in
// production imports this).
//   - A command is one or two words; a word of more than eight letters carries a soft hyphen (U+00AD) at a syllable break.
//   - A reason during play is at most 40 characters in English and 48 in translations.
const SHY = '­';

/** What is wrong with a command text, if anything. */
export function commandProblems(text: string): string[] {
  const out: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 2) out.push(`${words.length} words (at most two)`);
  for (const w of words) if (w.split(SHY).join('').length > 8 && !w.includes(SHY)) out.push(`"${w}" is over eight letters and has no soft hyphen`);
  return out;
}

/** What is wrong with a reason text, if anything. */
export function reasonProblems(text: string, english: boolean): string[] {
  const n = text.split(SHY).join('').length;
  const max = english ? 40 : 48;
  return n > max ? [`${n} characters (at most ${max})`] : [];
}

/** Every command and reason of a game's tables against the budgets: a list of "language key: problem". */
export function budgetProblems(tables: Readonly<Record<string, Readonly<Record<string, string>> | undefined>>, o: { commands: RegExp; reasons?: RegExp }): string[] {
  const out: string[] = [];
  for (const [lang, table] of Object.entries(tables)) {
    for (const [k, v] of Object.entries(table ?? {})) {
      if (o.commands.test(k)) for (const p of commandProblems(v)) out.push(`${lang} ${k}: ${p}`);
      if (o.reasons?.test(k)) for (const p of reasonProblems(v, lang === 'en')) out.push(`${lang} ${k}: ${p}`);
    }
  }
  return out;
}
