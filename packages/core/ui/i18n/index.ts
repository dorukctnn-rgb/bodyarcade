// Interface strings: English is the source, Turkish is complete, German, Spanish and French are drafts that are
// marked for review in the language picker. Missing keys fall back to English, never to a blank.
import { en } from './en.ts';
import { tr } from './tr.ts';
import { de } from './de.ts';
import { es } from './es.ts';
import { fr } from './fr.ts';
import { formatMessage, type Vars } from './icu.ts';

export type { Vars } from './icu.ts';
export { formatMessage, variablesOf } from './icu.ts';

export const LANGS = ['en', 'tr', 'de', 'es', 'fr'] as const;
export type Lang = (typeof LANGS)[number];
export type StringKey = keyof typeof en;
export type Table = Readonly<Record<string, string>>;

export interface LangInfo {
  code: Lang;
  /** The language's own name for itself. */
  name: string;
  /** 'draft': machine-quality draft, marked for review in the picker. */
  status: 'source' | 'complete' | 'draft';
  /** BCP 47 tag for Intl and the lang attribute. */
  tag: string;
}

export const LANG_INFO: readonly LangInfo[] = [
  { code: 'en', name: 'English', status: 'source', tag: 'en' },
  { code: 'tr', name: 'Türkçe', status: 'complete', tag: 'tr' },
  { code: 'de', name: 'Deutsch', status: 'draft', tag: 'de' },
  { code: 'es', name: 'Español', status: 'draft', tag: 'es' },
  { code: 'fr', name: 'Français', status: 'draft', tag: 'fr' },
];

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

const TABLES: Readonly<Record<Lang, Table>> = { en, tr, de, es, fr };

type Namespaced = Record<string, Partial<Record<Lang, Table>>>;

/** The words of the games, added when a game's code is loaded (its `strings` export). Every I18n reads them, so a language switch keeps them. */
const registered: Namespaced = {};

function addTables(into: Namespaced, namespace: string, tables: Partial<Record<Lang, Table>>): void {
  const cur = into[namespace] ?? {};
  for (const l of LANGS) {
    const add = tables[l];
    if (add) cur[l] = { ...(cur[l] ?? {}), ...add };
  }
  into[namespace] = cur;
}

function fromNamespaces(from: Namespaced, key: string, l: Lang): string | undefined {
  for (const ns of Object.keys(from)) {
    if (key.startsWith(`${ns}.`)) {
      const t = from[ns]?.[l]?.[key.slice(ns.length + 1)];
      if (t !== undefined) return t;
    }
  }
  return undefined;
}

/** Adds a game's strings for every I18n, now and later: registerGameStrings('game.star-catch', module.strings). */
export function registerGameStrings(namespace: string, tables: Partial<Record<Lang, Table>>): void {
  addTables(registered, namespace, tables);
}

/** The first supported language among the browser's preferences ("de-AT" counts as "de"), else English. */
export function detectLang(preferred: readonly string[] | undefined): Lang {
  for (const p of preferred ?? []) {
    const primary = p.toLowerCase().split('-')[0];
    if (isLang(primary)) return primary;
  }
  return 'en';
}

export interface I18n {
  readonly lang: Lang;
  readonly tag: string;
  /** A shell string. Falls back to English, then to the key itself. */
  t(key: StringKey, vars?: Vars): string;
  /** For keys built at run time (a region id, a game id). Same fallbacks. */
  tx(key: string, vars?: Vars): string;
  has(key: string): boolean;
  /** Adds strings under a namespace, for example a game: extend('game.squat-flap', { en: {...}, tr: {...} }). */
  extend(namespace: string, tables: Partial<Record<Lang, Table>>): void;
  /** t() for a namespace; keys it does not have fall back to the shell's own keys. */
  scoped(namespace: string): (key: string, vars?: Vars) => string;
  number(n: number, o?: Intl.NumberFormatOptions): string;
  currency(amount: number, currency: string, o?: Intl.NumberFormatOptions): string;
  date(d: Date | number, o?: Intl.DateTimeFormatOptions): string;
  list(items: readonly string[], type?: 'conjunction' | 'disjunction'): string;
}

export interface I18nOptions {
  /** Called once per missing key and language (tests and the dev console use it). */
  onMissing?: (key: string, lang: Lang) => void;
}

export function createI18n(lang: Lang, opts: I18nOptions = {}): I18n {
  const info = LANG_INFO.find((l) => l.code === lang) ?? (LANG_INFO[0] as LangInfo);
  const tag = info.tag;
  const extended: Namespaced = {};
  const reported = new Set<string>();
  const nf = new Intl.NumberFormat(tag);
  const env = { lang: tag, number: (n: number): string => nf.format(n) };

  const lookup = (key: string, l: Lang): string | undefined => {
    const own = TABLES[l][key];
    if (own !== undefined) return own;
    return fromNamespaces(extended, key, l) ?? fromNamespaces(registered, key, l);
  };

  const resolve = (key: string, vars?: Vars): string => {
    let msg = lookup(key, lang);
    if (msg === undefined && lang !== 'en') {
      msg = lookup(key, 'en');
      if (msg !== undefined && !reported.has(`${lang}|${key}`)) { reported.add(`${lang}|${key}`); opts.onMissing?.(key, lang); }
    }
    if (msg === undefined) {
      if (!reported.has(`en|${key}`)) { reported.add(`en|${key}`); opts.onMissing?.(key, 'en'); }
      return key;
    }
    return formatMessage(msg, vars ?? {}, env);
  };

  return {
    lang,
    tag,
    t: (key, vars) => resolve(key, vars),
    tx: (key, vars) => resolve(key, vars),
    has: (key) => lookup(key, lang) !== undefined || lookup(key, 'en') !== undefined,
    extend(namespace, tables) {
      addTables(extended, namespace, tables);
    },
    scoped(namespace) {
      return (key, vars) => {
        const full = `${namespace}.${key}`;
        // In the player's language first (the game's own line, then the shell's), English only when neither has one: a
        // game's English line must never stand in front of the shell's line in the player's language.
        const pick = lookup(full, lang) !== undefined ? full
          : lookup(key, lang) !== undefined ? key
            : lookup(full, 'en') !== undefined ? full
              : key;
        return resolve(pick, vars);
      };
    },
    number: (n, o) => (o ? new Intl.NumberFormat(tag, o).format(n) : nf.format(n)),
    currency: (amount, currency, o) => new Intl.NumberFormat(tag, { style: 'currency', currency, ...o }).format(amount),
    date: (d, o) => new Intl.DateTimeFormat(tag, o ?? { dateStyle: 'medium' }).format(d),
    list: (items, type = 'conjunction') => new Intl.ListFormat(tag, { style: 'long', type }).format(items),
  };
}

/** All tables, for the translation tests and the tools that check string budgets. */
export const stringTables = TABLES;
