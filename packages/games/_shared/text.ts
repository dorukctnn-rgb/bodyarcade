// Words in a game. The shell translates (GameContext.t); when it does not know a key it answers with the key itself, and
// the game falls back to its own English line, so a game is playable in a bare test context and in a language the shell
// has not been given the game's strings for yet. A game exports its tables (en, tr, de, es, fr) so the shell can add them
// with i18n.extend('game.<id>', tables).
export type Vars = Record<string, string | number>;
export type Say = (key: string, vars?: Vars) => string;
export type Table = Readonly<Record<string, string>>;
export type Tables = Readonly<Record<'en' | 'tr' | 'de' | 'es' | 'fr', Table>>;

/** Puts {name} values into a line. Plural forms are not made here: a line that needs one is written without a number. */
export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export interface Translator { t(key: string, vars?: Vars): string }

export function makeSay(ctx: Translator | null, english: Table): Say {
  return (key, vars) => {
    if (ctx) {
      let said: string | undefined;
      try { said = ctx.t(key, vars); } catch { said = undefined; }
      if (said !== undefined && said !== key) return said;
    }
    return fill(english[key] ?? key, vars);
  };
}
