// Sale attribution: the Gumroad address the web paywall opens carries the kind of site that sent this browser, so each web
// sale shows its channel in Gumroad. The word is sorted and kept by /assets/pro-source.js (packages/web/content/pro-source.js),
// which every page of the release loads; this file only reads it, at the moment of the buy button. Inside the Android app the
// paywall sells through Google Play and never comes here.
//
// The address gets utm_source=<the first word kept in this browser, else this visit's, else direct>, utm_medium=<organic|
// referral|social|none> and utm_campaign=bodyarcade. Its other query parameters stay, an address that already has a
// utm_source is left as it is, and anything that is not a Gumroad product page (https://<seller>.gumroad.com/l/<permalink>)
// or anything that fails gives back the plain address.

/** The keys pro-source.js writes: this tab's word in sessionStorage, the browser's first word in localStorage. */
export const SOURCE_KEYS = { visit: 'pro-source:visit', first: 'pro-source:first' } as const;

export const SOURCE_CAMPAIGN = 'bodyarcade';

/** The words and the utm_medium each is reported with (pro-source.js has the same table; pro-source.test.ts compares them). */
export const SOURCE_MEDIUM = {
  google: 'organic', bing: 'organic', 'other-search': 'organic', 'ai-assistant': 'referral',
  pinterest: 'social', social: 'social', referral: 'referral', direct: 'none',
} as const;

export type SourceWord = keyof typeof SOURCE_MEDIUM;

export const isSourceWord = (v: unknown): v is SourceWord => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_MEDIUM, v);

/** The two storages of a window, either of which may be missing or throw when touched (blocked site data). */
export interface SourceWindow {
  readonly localStorage?: Pick<Storage, 'getItem'>;
  readonly sessionStorage?: Pick<Storage, 'getItem'>;
}

function read(win: SourceWindow, area: 'localStorage' | 'sessionStorage', key: string): SourceWord | null {
  try {
    const v = win[area]?.getItem(key);
    return isSourceWord(v) ? v : null;
  } catch {
    return null;
  }
}

/** The word a purchase reports: the first one this browser kept (other than direct), else this visit's, else direct. */
export function sourceOf(win: SourceWindow): SourceWord {
  const first = read(win, 'localStorage', SOURCE_KEYS.first);
  if (first && first !== 'direct') return first;
  return read(win, 'sessionStorage', SOURCE_KEYS.visit) ?? 'direct';
}

const GUMROAD_PRODUCT = /^https:\/\/([a-z0-9-]+\.)?gumroad\.com\/l\/[A-Za-z0-9_-]+\/?$/;

/** The Gumroad product address with the three labels added; any other address, or one that already has a utm_source, as it is. */
export function withSource(address: string, word: SourceWord): string {
  let url: URL;
  try { url = new URL(address); } catch { return address; }
  if (!GUMROAD_PRODUCT.test(`${url.origin}${url.pathname}`) || url.searchParams.has('utm_source') || !isSourceWord(word)) return address;
  url.searchParams.append('utm_source', word);
  if (!url.searchParams.has('utm_medium')) url.searchParams.append('utm_medium', SOURCE_MEDIUM[word]);
  if (!url.searchParams.has('utm_campaign')) url.searchParams.append('utm_campaign', SOURCE_CAMPAIGN);
  return url.href;
}

/** What the buy button opens on the web: the checkout address with the source of this browser, or the plain one if anything fails. */
export function checkoutWithSource(address: string, win: SourceWindow): string {
  try { return withSource(address, sourceOf(win)); } catch { return address; }
}
