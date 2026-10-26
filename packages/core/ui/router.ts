// A tiny router: a table of path patterns, a language prefix ("/tr/..."), and a controller that keeps the browser's
// history in step (back and forward work, links inside the site do not reload the page, scroll and focus are handled).
// The matching part is pure and shared with the page generator; the controller takes the window as a parameter so
// it can be tested with a fake.
import { isLang, LANGS, type Lang } from './i18n/index.ts';

export interface RouteSpec<Id extends string = string> {
  id: Id;
  /** '/games/:slug' (a segment starting with ':' captures one path segment). */
  pattern: string;
}

export interface Matched<Id extends string = string> {
  id: Id;
  params: Readonly<Record<string, string>>;
  lang: Lang;
  query: URLSearchParams;
  /** The path without the language prefix, always with a trailing slash ('/' for the home page). */
  path: string;
  hash: string;
}

export interface HrefOptions {
  params?: Readonly<Record<string, string>>;
  lang?: Lang;
  query?: Readonly<Record<string, string | number | boolean | undefined>> | URLSearchParams;
  hash?: string;
}

export interface Router<Id extends string = string> {
  /** Matches a URL (absolute, or a path with query). Null when no route fits. */
  match(url: string): Matched<Id> | null;
  /** The URL of a route in a language, with a trailing slash. English has no prefix. */
  href(id: Id, o?: HrefOptions): string;
  /** The same page in another language. Unknown paths keep their shape. */
  withLang(url: string, lang: Lang): string;
  /** Languages that appear as a first path segment. */
  readonly prefixed: readonly Lang[];
}

const BASE = 'http://router.invalid';

function splitUrl(url: string): { path: string; search: string; hash: string } {
  const u = new URL(url, BASE);
  return { path: u.pathname, search: u.search, hash: u.hash };
}

const segments = (path: string): string[] => path.split('/').filter((s) => s !== '');

/** Strips a language prefix. Only languages in `prefixed` count; "/en/..." is not a thing. */
export function splitLang(path: string, prefixed: readonly Lang[]): { lang: Lang; rest: string[] } {
  const segs = segments(path);
  const first = segs[0];
  if (first !== undefined && isLang(first) && prefixed.includes(first)) return { lang: first, rest: segs.slice(1) };
  return { lang: 'en', rest: segs };
}

const pathOf = (segs: readonly string[]): string => (segs.length === 0 ? '/' : `/${segs.join('/')}/`);

function decode(seg: string): string | null {
  try {
    const v = decodeURIComponent(seg);
    return v.includes('/') || v.includes('\\') || v === '.' || v === '..' ? null : v;
  } catch {
    return null;
  }
}

export function createRouter<Id extends string>(specs: readonly RouteSpec<Id>[], opts: { prefixed?: readonly Lang[] } = {}): Router<Id> {
  const prefixed = (opts.prefixed ?? LANGS.filter((l) => l !== 'en')).filter((l) => l !== 'en');
  const compiled = specs.map((s) => ({ spec: s, segs: segments(s.pattern) }));

  const match = (url: string): Matched<Id> | null => {
    const { path, search, hash } = splitUrl(url);
    const { lang, rest } = splitLang(path, prefixed);
    for (const { spec, segs } of compiled) {
      if (segs.length !== rest.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const want = segs[i] as string;
        const got = rest[i] as string;
        if (want.startsWith(':')) {
          const v = decode(got);
          if (v === null || v === '') { ok = false; break; }
          params[want.slice(1)] = v;
        } else if (want !== got) { ok = false; break; }
      }
      if (ok) return { id: spec.id, params, lang, query: new URLSearchParams(search), path: pathOf(rest), hash };
    }
    return null;
  };

  const href = (id: Id, o: HrefOptions = {}): string => {
    const found = compiled.find((c) => c.spec.id === id);
    if (!found) throw new Error(`no route called ${id}`);
    const segs = found.segs.map((s) => {
      if (!s.startsWith(':')) return s;
      const v = o.params?.[s.slice(1)];
      if (v === undefined || v === '') throw new Error(`route ${id} needs the parameter ${s.slice(1)}`);
      return encodeURIComponent(v);
    });
    const lang = o.lang ?? 'en';
    const all = lang !== 'en' && prefixed.includes(lang) ? [lang, ...segs] : segs;
    let out = pathOf(all);
    if (o.query) {
      const q = o.query instanceof URLSearchParams ? new URLSearchParams(o.query) : new URLSearchParams();
      if (!(o.query instanceof URLSearchParams)) for (const [k, v] of Object.entries(o.query)) if (v !== undefined) q.set(k, String(v));
      const s = q.toString();
      if (s) out += `?${s}`;
    }
    if (o.hash) out += o.hash.startsWith('#') ? o.hash : `#${o.hash}`;
    return out;
  };

  const withLang = (url: string, lang: Lang): string => {
    const { path, search, hash } = splitUrl(url);
    const { rest } = splitLang(path, prefixed);
    const all = lang !== 'en' && prefixed.includes(lang) ? [lang, ...rest] : rest;
    return `${pathOf(all)}${search}${hash}`;
  };

  return { match, href, withLang, prefixed };
}

// ---------------------------------------------------------------------------------------------------------------------
// The controller

export interface NavElement {
  closest(selector: string): NavElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  focus(o?: { preventScroll?: boolean }): void;
  setAttribute(name: string, value: string): void;
}

export interface NavClickEvent {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
  target: unknown;
  preventDefault(): void;
}

export interface NavWindow {
  location: { origin: string; pathname: string; search: string; hash: string };
  history: {
    state: unknown;
    scrollRestoration?: 'auto' | 'manual';
    pushState(state: unknown, title: string, url: string): void;
    replaceState(state: unknown, title: string, url: string): void;
  };
  scrollY: number;
  scrollTo(x: number, y: number): void;
  addEventListener(type: 'popstate', cb: () => void): void;
  removeEventListener(type: 'popstate', cb: () => void): void;
  document: {
    addEventListener(type: 'click', cb: (e: NavClickEvent) => void): void;
    removeEventListener(type: 'click', cb: (e: NavClickEvent) => void): void;
    querySelector(selector: string): NavElement | null;
    getElementById(id: string): NavElement | null;
  };
}

export interface RouteChange<Id extends string> {
  route: Matched<Id> | null;
  /** The first render after the page loaded. */
  initial: boolean;
  /** Reached with the back or forward button. */
  popped: boolean;
  /** Replaced the current entry instead of adding one. */
  replaced: boolean;
}

export interface NavigatorOptions<Id extends string> {
  win: NavWindow;
  router: Router<Id>;
  /** Render the page for this route. Awaited, so focus moves after the new page is in place. */
  onRoute(change: RouteChange<Id>): void | Promise<void>;
  /** A render that throws lands here (default: console.error); the page stays usable. */
  onError?(error: unknown): void;
}

export interface Navigation<Id extends string> {
  /** Go to a URL inside the site. Returns false (and does nothing) for another origin. */
  go(href: string, o?: { replace?: boolean }): boolean;
  current(): Matched<Id> | null;
  start(): void;
  stop(): void;
}

interface HistoryState { y?: number }

export function createNavigation<Id extends string>(o: NavigatorOptions<Id>): Navigation<Id> {
  const { win, router } = o;
  let started = false;
  let initial = true;
  let current: Matched<Id> | null = null;

  const urlNow = (): string => `${win.location.pathname}${win.location.search}${win.location.hash}`;

  const focusMain = (): void => {
    const target = win.document.querySelector('[data-main-heading]') ?? win.document.querySelector('main h1') ?? win.document.getElementById('main');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  const render = async (change: Omit<RouteChange<Id>, 'route' | 'initial'>): Promise<void> => {
    current = router.match(urlNow());
    const wasInitial = initial;
    initial = false;
    try {
      await o.onRoute({ route: current, initial: wasInitial, ...change });
    } catch (e) {
      if (o.onError) o.onError(e); else console.error(e);
    }
    const state = (win.history.state ?? {}) as HistoryState;
    if (change.popped) win.scrollTo(0, typeof state.y === 'number' ? state.y : 0);
    else if (!win.location.hash) win.scrollTo(0, 0);
    if (!wasInitial) focusMain();
  };

  const rememberScroll = (): void => {
    const state = (win.history.state ?? {}) as HistoryState;
    win.history.replaceState({ ...state, y: win.scrollY }, '', urlNow());
  };

  const go = (href: string, opts: { replace?: boolean } = {}): boolean => {
    const u = new URL(href, `${win.location.origin}${win.location.pathname}`);
    if (u.origin !== win.location.origin) return false;
    const next = `${u.pathname}${u.search}${u.hash}`;
    if (next === urlNow() && !opts.replace) { void render({ popped: false, replaced: true }); return true; }
    if (opts.replace) win.history.replaceState({}, '', next);
    else { rememberScroll(); win.history.pushState({ y: 0 }, '', next); }
    void render({ popped: false, replaced: !!opts.replace });
    return true;
  };

  const onPop = (): void => { void render({ popped: true, replaced: false }); };

  const onClick = (e: NavClickEvent): void => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target as NavElement | null;
    const a = t && typeof t.closest === 'function' ? t.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    const target = a.getAttribute('target');
    if (!href || (target && target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-native')) return;
    if (/\bexternal\b/.test(a.getAttribute('rel') ?? '')) return;
    if (href.startsWith('#') || /^(mailto|tel|sms):/i.test(href)) return;
    const u = new URL(href, `${win.location.origin}${win.location.pathname}`);
    if (u.origin !== win.location.origin) return;
    // A page the router does not know (a file such as /sitemap.xml) is left to the browser.
    if (!router.match(`${u.pathname}${u.search}`)) return;
    e.preventDefault();
    // data-replace: the link takes the place of this page in the history ("Play again" from the results), so Back skips it.
    go(href, { replace: a.hasAttribute('data-replace') });
  };

  return {
    go,
    current: () => current,
    start() {
      if (started) return;
      started = true;
      if (win.history.scrollRestoration !== undefined) win.history.scrollRestoration = 'manual';
      win.addEventListener('popstate', onPop);
      win.document.addEventListener('click', onClick);
      void render({ popped: false, replaced: false });
    },
    stop() {
      if (!started) return;
      started = false;
      win.removeEventListener('popstate', onPop);
      win.document.removeEventListener('click', onClick);
    },
  };
}
