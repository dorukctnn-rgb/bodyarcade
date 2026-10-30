// Sale attribution: the script every page loads (packages/web/content/pro-source.js, run exactly as browsers get it, in a vm
// sandbox with a fake document, location and storage) sorts where a visitor came from into one word and keeps it; the buy
// button of the web paywall (pro-source.ts) reads it and adds it to the Gumroad address.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GUMROAD_CATALOG } from '../../../core/entitlements/catalog.ts';
import { SESSION_FLAG, TWA_REFERRER } from '../../../core/entitlements/billing-env.ts';
import { checkoutWithSource, isSourceWord, SOURCE_CAMPAIGN, SOURCE_KEYS, SOURCE_MEDIUM, sourceOf, withSource, type SourceWindow, type SourceWord } from './pro-source.ts';

const SCRIPT_URL = new URL('../../content/pro-source.js', import.meta.url);
const SCRIPT = readFileSync(SCRIPT_URL, 'utf8');
const OWN = 'bodyarcade.com';

type Area = Map<string, string>;
interface Page { session: Area; local: Area; writes: [string, string, string][]; listeners: Record<string, (() => void)[]>; win: SourceWindow }

function storage(m: Area, writes: [string, string, string][], name: string): Pick<Storage, 'getItem' | 'setItem'> {
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { writes.push([name, k, String(v)]); m.set(k, String(v)); } };
}

/** One page load. mode 'methods-throw' and 'access-throws' are site data blocked by the browser. */
function load(o: { referrer?: string; search?: string; host?: string; session?: Area; local?: Area; mode?: 'ok' | 'methods-throw' | 'access-throws'; prerendering?: boolean } = {}): Page {
  const session = o.session ?? new Map<string, string>();
  const local = o.local ?? new Map<string, string>();
  const writes: [string, string, string][] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const ctx: Record<string, unknown> = {
    URLSearchParams,
    location: { hostname: o.host ?? OWN, search: o.search ?? '' },
    document: { referrer: o.referrer ?? '', prerendering: o.prerendering === true, addEventListener(type: string, fn: () => void) { (listeners[type] ??= []).push(fn); } },
  };
  ctx['window'] = ctx;
  const mode = o.mode ?? 'ok';
  if (mode === 'ok') {
    ctx['sessionStorage'] = storage(session, writes, 'session');
    ctx['localStorage'] = storage(local, writes, 'local');
  } else if (mode === 'methods-throw') {
    const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    ctx['sessionStorage'] = bad;
    ctx['localStorage'] = bad;
  } else {
    for (const k of ['sessionStorage', 'localStorage']) Object.defineProperty(ctx, k, { get() { throw new Error('SecurityError'); } });
  }
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  return { session, local, writes, listeners, win: ctx as unknown as SourceWindow };
}

/** The word one landing leaves for this visit ('' when it leaves none). */
const visitWord = (o: Parameters<typeof load>[0]): string => load(o).session.get(SOURCE_KEYS.visit) ?? '';

const REFERRERS: [string, string][] = [
  ['', 'direct'],
  ['https://www.google.com/', 'google'], ['https://www.google.co.uk/search?q=x', 'google'], ['https://www.google.com.tr/', 'google'],
  ['HTTPS://WWW.GOOGLE.COM/', 'google'], ['https://www.google.com./', 'google'], ['android-app://com.google.android.googlequicksearchbox/', 'google'],
  ['https://gemini.google.com/app', 'ai-assistant'], ['https://docs.google.com/document/d/x', 'referral'], ['https://google.com.evil.example/', 'referral'],
  ['https://www.bing.com/', 'bing'], ['https://cn.bing.com/search?q=x', 'bing'],
  ['https://duckduckgo.com/', 'other-search'], ['https://search.yahoo.com/', 'other-search'], ['https://yandex.ru/', 'other-search'],
  ['https://www.ecosia.org/', 'other-search'], ['https://search.brave.com/', 'other-search'], ['https://www.baidu.com/', 'other-search'],
  ['https://chatgpt.com/', 'ai-assistant'], ['https://chat.openai.com/', 'ai-assistant'], ['https://www.perplexity.ai/', 'ai-assistant'],
  ['https://copilot.microsoft.com/', 'ai-assistant'], ['https://claude.ai/', 'ai-assistant'], ['android-app://com.openai.chatgpt/', 'ai-assistant'],
  ['https://www.pinterest.com/', 'pinterest'], ['https://www.pinterest.co.uk/', 'pinterest'], ['https://pin.it/abc', 'pinterest'],
  ['https://l.facebook.com/', 'social'], ['https://www.reddit.com/r/x/', 'social'], ['https://out.reddit.com/', 'social'], ['https://t.co/abc', 'social'],
  ['https://x.com/', 'social'], ['https://www.youtube.com/', 'social'], ['https://www.tiktok.com/', 'social'], ['https://www.instagram.com/', 'social'],
  ['https://user:pw@reddit.com/', 'social'], ['android-app://com.reddit.frontpage/', 'social'], ['android-app://com.zhiliaoapp.musically/', 'social'],
  ['https://peakappsstudio.com/', 'referral'], ['http://example.org/page', 'referral'], ['android-app://com.google.android.gm/', 'referral'],
  // this site, wherever it is served from, Gumroad and the BodyArcade Android app leave no word: the page before decided
  [`https://${OWN}/`, ''], [`https://www.${OWN}/pricing`, ''], [`https://${OWN.toUpperCase()}/`, ''],
  ['https://bodyarcade-v2-preview.railer-iot.workers.dev/games/road-run/', ''],
  ['https://dorukctn.gumroad.com/l/bodyarcade-pro-yearly', ''], ['https://gumroad.com/checkout', ''], ['https://gum.co/u/abc', ''],
  ['android-app://com.peakapps.bodyarcade/', ''],
  ['about:blank', ''], ['file:///C:/x.html', ''], ['chrome-extension://abc/popup.html', ''], ['android-app://', ''], ['https:///nohost', ''], ['not a url', ''],
];

const TAGS: [string, string][] = [
  ['?utm_source=chatgpt.com', 'ai-assistant'], ['?utm_source=chatgpt', 'ai-assistant'], ['?utm_source=perplexity', 'ai-assistant'],
  ['?utm_source=https%3A%2F%2Fwww.perplexity.ai%2F', 'ai-assistant'], ['?utm_source=meta-ai', 'ai-assistant'],
  ['?utm_source=google', 'google'], ['?utm_source=google-ads', 'google'], ['?utm_source=bing', 'bing'], ['?utm_source=duckduckgo', 'other-search'],
  ['?utm_source=pinterest', 'pinterest'], ['?utm_source=fb_ads', 'social'], ['?ref=reddit', 'social'], ['?source=twitter', 'social'],
  ['?utm_source=tiktok&utm_medium=video', 'social'], ['?utm_source=newsletter', 'referral'], ['?ref=producthunt', 'referral'],
  ['?utm_source=social', 'social'], ['?utm_source=direct', 'direct'],
];

describe('pro-source.js: where a visitor came from, as one word', () => {
  it('sorts referrers into one kind of site, and leaves no word for this site, Gumroad and the Android app', () => {
    for (const [referrer, want] of REFERRERS) {
      const host = referrer.includes('railer-iot') ? 'bodyarcade-v2-preview.railer-iot.workers.dev' : OWN;
      expect(visitWord({ referrer, host }), referrer).toBe(want);
    }
    expect(visitWord({ referrer: 'http://localhost:4173/', host: 'localhost' }), 'the page\'s own host, whatever it is').toBe('');
  });

  it('a tag on the landing address wins over the referrer; a tag naming this site, Gumroad or the app leaves it to the referrer', () => {
    for (const [search, want] of TAGS) expect(visitWord({ search, referrer: 'https://www.bing.com/' }), search).toBe(want);
    expect(visitWord({ search: '?utm_source=chatgpt.com', referrer: 'https://www.bing.com/' })).toBe('ai-assistant');
    for (const search of ['?utm_source=bodyarcade', '?utm_source=bodyarcade.com', '?ref=gumroad', '?source=twa', '?utm_source=twa', '?utm_source=android-app', '?utm_source=com.peakapps.bodyarcade']) {
      expect(visitWord({ search, referrer: 'https://www.bing.com/' }), search).toBe('bing');
    }
    // the Android app opens /?src=twa from the launcher: no word at all
    expect(visitWord({ search: '?src=twa', referrer: 'android-app://com.peakapps.bodyarcade/' })).toBe('');
  });

  it('keeps nothing inside the Android app, on any of the hints the app itself goes by (billing-env.ts, twa.js)', () => {
    for (const o of [
      { search: '?src=twa', referrer: '' },
      { search: '?src=twa&utm_source=chatgpt.com', referrer: 'https://www.google.com/' },
      { search: '', referrer: `${TWA_REFERRER}/` },
      { search: '?utm_source=reddit', referrer: 'https://www.reddit.com/', session: new Map([[SESSION_FLAG, '1']]) },
    ]) {
      const p = load(o);
      expect(p.writes, JSON.stringify({ ...o, session: undefined })).toEqual([]);
    }
    expect(SCRIPT).toContain(`var APP = '${TWA_REFERRER.replace('android-app://', '')}';`);
    expect(SCRIPT).toContain(`getItem('${SESSION_FLAG}')`);
  });

  it('keeps the first word other than direct for good, and this visit\'s first word for the tab', () => {
    const local = new Map<string, string>();
    const a = load({ referrer: 'https://www.google.com/', local });
    expect(a.local.get(SOURCE_KEYS.first)).toBe('google');
    expect(a.session.get(SOURCE_KEYS.visit)).toBe('google');
    // a later visit from Reddit: its own tab word, the first word stays
    const b = load({ referrer: 'https://www.reddit.com/', local });
    expect(b.session.get(SOURCE_KEYS.visit)).toBe('social');
    expect(local.get(SOURCE_KEYS.first)).toBe('google');
    // the next page of the same tab (from this site) changes nothing
    const session = new Map([[SOURCE_KEYS.visit, 'social']]);
    const c = load({ referrer: `https://${OWN}/`, local, session });
    expect(c.writes).toEqual([]);
    expect(session.get(SOURCE_KEYS.visit)).toBe('social');
  });

  it('a direct visit is a tab word only, and a later site still becomes the first word', () => {
    const local = new Map<string, string>();
    const a = load({ referrer: '', local });
    expect(a.session.get(SOURCE_KEYS.visit)).toBe('direct');
    expect(local.has(SOURCE_KEYS.first)).toBe(false);
    load({ referrer: 'https://chatgpt.com/', local });
    expect(local.get(SOURCE_KEYS.first)).toBe('ai-assistant');
  });

  it('keeps only the word: nothing of the address is stored, and only its own two keys are written', () => {
    const p = load({ referrer: 'https://www.reddit.com/r/homegym/comments/abc/secret_title/?x=1', search: '' });
    for (const [, key, value] of p.writes) {
      expect([SOURCE_KEYS.visit, SOURCE_KEYS.first]).toContain(key);
      expect(isSourceWord(value), value).toBe(true);
    }
  });

  it('a prerendered page keeps its word only once the visitor opens it', () => {
    const p = load({ referrer: 'https://www.google.com/', prerendering: true });
    expect(p.writes).toEqual([]);
    for (const fn of p.listeners['prerenderingchange'] ?? []) fn();
    expect(p.session.get(SOURCE_KEYS.visit)).toBe('google');
    expect(p.local.get(SOURCE_KEYS.first)).toBe('google');
  });

  it('blocked site data stops nothing on the page', () => {
    expect(() => load({ referrer: 'https://www.google.com/', mode: 'methods-throw' })).not.toThrow();
    expect(() => load({ referrer: 'https://www.google.com/', mode: 'access-throws' })).not.toThrow();
  });

  it('has the same words and groups as the buy button (pro-source.ts)', () => {
    const m = /var MEDIUM = (\{[\s\S]*?\});/.exec(SCRIPT);
    expect(m).not.toBeNull();
    expect(vm.runInNewContext(`(${m?.[1] ?? '{}'})`)).toEqual({ ...SOURCE_MEDIUM });
    expect(SCRIPT).toContain(`var CAMPAIGN = '${SOURCE_CAMPAIGN}';`);
    expect(SCRIPT).toContain(`var VISIT = '${SOURCE_KEYS.visit}';`);
    expect(SCRIPT).toContain(`var FIRST = '${SOURCE_KEYS.first}';`);
  });

  it('the copy in site/assets is the script itself', () => {
    const copy = readFileSync(new URL('../../../../site/assets/pro-source.js', import.meta.url), 'utf8');
    expect(copy.replace(/\r\n/g, '\n')).toBe(SCRIPT.replace(/\r\n/g, '\n'));
  });
});

describe('pro-source.ts: the Gumroad address of the buy button', () => {
  const winOf = (local: Record<string, string> = {}, session: Record<string, string> = {}): SourceWindow => ({
    localStorage: { getItem: (k) => local[k] ?? null },
    sessionStorage: { getItem: (k) => session[k] ?? null },
  });
  const tagged = (base: string, word: SourceWord): string => `${base}?utm_source=${word}&utm_medium=${SOURCE_MEDIUM[word]}&utm_campaign=bodyarcade`;

  it('reports the first word of this browser, else this visit\'s, else direct', () => {
    expect(sourceOf(winOf({ [SOURCE_KEYS.first]: 'google' }, { [SOURCE_KEYS.visit]: 'social' }))).toBe('google');
    expect(sourceOf(winOf({}, { [SOURCE_KEYS.visit]: 'social' }))).toBe('social');
    expect(sourceOf(winOf())).toBe('direct');
    // only the eight words count: anything else in storage is as good as nothing
    expect(sourceOf(winOf({ [SOURCE_KEYS.first]: 'https://evil.example/' }, { [SOURCE_KEYS.visit]: '<b>' }))).toBe('direct');
    expect(sourceOf({})).toBe('direct');
    const blocked = { get localStorage(): Storage { throw new Error('SecurityError'); }, get sessionStorage(): Storage { throw new Error('SecurityError'); } };
    expect(sourceOf(blocked)).toBe('direct');
  });

  it('adds the three labels to every checkout address of the catalog', () => {
    for (const [plan, l] of Object.entries(GUMROAD_CATALOG)) {
      for (const word of Object.keys(SOURCE_MEDIUM) as SourceWord[]) expect(withSource(l.checkout, word), `${plan} ${word}`).toBe(tagged(l.checkout, word));
    }
  });

  it('keeps the address\'s own parameters and fragment, and never replaces a utm_source that is there', () => {
    const base = 'https://dorukctn.gumroad.com/l/bodyarcade-pro-yearly';
    expect(withSource(`${base}?wanted=true`, 'google')).toBe(`${base}?wanted=true&utm_source=google&utm_medium=organic&utm_campaign=bodyarcade`);
    expect(withSource(`${base}?utm_campaign=creator1`, 'social')).toBe(`${base}?utm_campaign=creator1&utm_source=social&utm_medium=social`);
    expect(withSource(`${base}#plans`, 'bing')).toBe(`${base}?utm_source=bing&utm_medium=organic&utm_campaign=bodyarcade#plans`);
    expect(withSource(`${base}?utm_source=mail`, 'google')).toBe(`${base}?utm_source=mail`);
  });

  it('leaves every address that is not a Gumroad product page as it is', () => {
    for (const a of ['https://checkout.invalid/pro-yearly', 'http://dorukctn.gumroad.com/l/x', 'https://gumroad.com.evil.example/l/x', 'https://app.gumroad.com/library', 'https://dorukctn.gumroad.com/', '/pro/', 'not a url', '']) {
      expect(withSource(a, 'google'), a).toBe(a);
    }
    expect(withSource('https://dorukctn.gumroad.com/l/x', 'nonsense' as SourceWord)).toBe('https://dorukctn.gumroad.com/l/x');
  });

  it('end to end: a visitor from ChatGPT who later comes back from Reddit buys with ai-assistant', () => {
    const local = new Map<string, string>();
    load({ search: '?utm_source=chatgpt.com', referrer: '', local });
    const page = load({ referrer: 'https://www.reddit.com/', local });
    const base = GUMROAD_CATALOG.lifetime.checkout;
    expect(checkoutWithSource(base, page.win)).toBe(tagged(base, 'ai-assistant'));
    // with site data blocked nothing was kept, so the purchase says direct
    expect(checkoutWithSource(base, load({ referrer: 'https://www.google.com/', mode: 'access-throws' }).win)).toBe(tagged(base, 'direct'));
  });
});
