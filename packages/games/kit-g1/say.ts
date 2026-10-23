// Words of a game. The shell hands every game a `t` (GameContext.t); a key it does not know comes back as the key itself.
// Each game keeps its own English table (and the other languages, for the shell to register with
// i18n.extend('game.<id>', tables)) and asks `say(key)`: the shell's translation when there is one, else English.
import type { GameContext } from '../../core/types/index.ts';

export type StringTable = Readonly<Record<string, string>>;
/** Per language, like I18n.extend: English is the source, the others are complete or drafts. */
export type StringTables = Readonly<Partial<Record<'en' | 'tr' | 'de' | 'es' | 'fr', StringTable>>>;

export type Say = (key: string, vars?: Record<string, string | number>) => string;

/** "{n}" placeholders only; plurals are avoided in game strings (the numbers shown come from the HUD). */
export function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function createSay(t: GameContext['t'] | undefined, english: StringTable): Say {
  return (key, vars) => {
    let found: string | undefined;
    if (t) {
      try {
        const s = t(key, vars);
        if (s && s !== key) found = s;
      } catch { /* a shell without this key: use English */ }
    }
    if (found !== undefined) return found;
    const en = english[key];
    return en === undefined ? key : fill(en, vars);
  };
}
