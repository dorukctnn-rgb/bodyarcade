// LocalizedString (the contract's text type: plain text, or text per language) resolved for one language.
import type { LocalizedString } from '../../types/index.ts';
import { LANGS, type Lang } from './index.ts';

/** The text in `lang`, else English, else the first language that has any text, else ''. */
export function localized(ls: LocalizedString | undefined, lang: Lang): string {
  if (ls === undefined) return '';
  if (typeof ls === 'string') return ls;
  const own = ls[lang];
  if (own) return own;
  if (ls['en']) return ls['en'];
  for (const l of LANGS) if (ls[l]) return ls[l] ?? '';
  return Object.values(ls)[0] ?? '';
}

/** True when `lang` has text: plain text is the same in every language. */
export function hasLanguage(ls: LocalizedString | undefined, lang: Lang): boolean {
  if (ls === undefined) return false;
  if (typeof ls === 'string') return true;
  return !!ls[lang];
}
