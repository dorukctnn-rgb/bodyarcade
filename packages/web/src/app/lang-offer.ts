// The language bar. When an English page is opened by a visitor whose browser prefers another complete language and who
// never chose a language, the page stays English and a bar under the header offers the other page (views/chrome.ts,
// languageOffer). Until 10 November 2026 the app moved such a visitor to the other language on arrival, with a script;
// answer engines, Bing and anyone in Turkey who opened an English address landed on a page they had not asked for, against
// the hreflang pairs (technical SEO audit, issue 6). The visitor's answer, switch or keep, goes into the language setting,
// so the bar comes back only when the setting is put back to "same as the browser".
import type { Lang } from '../../../core/ui/i18n/index.ts';
import type { Settings } from '../../../core/ui/settings.ts';
import { INDEXED_LANGS } from '../routes.ts';

/**
 * The language the bar offers on this page, or null. The visitor's language is the setting when they chose one, else the
 * browser's (`browserLang`, autoLang). The bar is only for an English page whose visitor's language is another complete one:
 * nothing on a Turkish page, nothing for English, nothing for a draft language.
 */
export function languageOffer(setting: Settings['lang'], browserLang: Lang, pageLang: Lang): Lang | null {
  const want = setting === 'auto' ? browserLang : setting;
  return pageLang === 'en' && want !== 'en' && INDEXED_LANGS.includes(want) ? want : null;
}
