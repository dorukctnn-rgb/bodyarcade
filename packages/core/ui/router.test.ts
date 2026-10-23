import { describe, expect, it, vi } from 'vitest';
import { createNavigation, createRouter, splitLang, type NavClickEvent, type NavElement, type NavWindow, type RouteChange } from './router.ts';

type Id = 'home' | 'region' | 'game' | 'results';
const router = createRouter<Id>([
  { id: 'home', pattern: '/' },
  { id: 'region', pattern: '/workouts/:region' },
  { id: 'game', pattern: '/games/:slug' },
  { id: 'results', pattern: '/results' },
]);

describe('matching', () => {
  it('matches static and parameter routes, with or without the trailing slash', () => {
    expect(router.match('/')?.id).toBe('home');
    expect(router.match('/games/squat-flap/')).toMatchObject({ id: 'game', params: { slug: 'squat-flap' }, lang: 'en', path: '/games/squat-flap/' });
    expect(router.match('/games/squat-flap')?.id).toBe('game');
    expect(router.match('/results')?.id).toBe('results');
  });

  it('reads the language prefix and strips it from the path', () => {
    expect(router.match('/tr/')).toMatchObject({ id: 'home', lang: 'tr', path: '/' });
    expect(router.match('/tr/games/squat-flap/')).toMatchObject({ id: 'game', lang: 'tr', path: '/games/squat-flap/' });
    expect(router.match('/de/workouts/legs/')).toMatchObject({ id: 'region', lang: 'de' });
  });

  it('does not treat unknown or English prefixes as languages', () => {
    expect(router.match('/xx/games/squat-flap/')).toBeNull();
    expect(router.match('/en/games/squat-flap/')).toBeNull();
    expect(splitLang('/en/x', ['tr'])).toEqual({ lang: 'en', rest: ['en', 'x'] });
  });

  it('keeps query and hash, and decodes parameters safely', () => {
    const m = router.match('/games/squat-flap/?mode=duo#about');
    expect(m?.query.get('mode')).toBe('duo');
    expect(m?.hash).toBe('#about');
    expect(router.match('/games/caf%C3%A9/')?.params['slug']).toBe('café');
  });

  it('refuses parameters that decode to a path or are broken', () => {
    expect(router.match('/games/a%2Fb/')).toBeNull();
    expect(router.match('/games/%E0%A4%A/')).toBeNull();
  });

  it('returns null for pages that do not exist', () => {
    expect(router.match('/nope/')).toBeNull();
    expect(router.match('/games/')).toBeNull();
    expect(router.match('/games/a/b/')).toBeNull();
  });
});

describe('building links', () => {
  it('builds paths with a trailing slash and no prefix for English', () => {
    expect(router.href('home')).toBe('/');
    expect(router.href('game', { params: { slug: 'squat-flap' } })).toBe('/games/squat-flap/');
  });

  it('adds the language prefix, query and hash', () => {
    expect(router.href('home', { lang: 'tr' })).toBe('/tr/');
    expect(router.href('region', { lang: 'tr', params: { region: 'chest-back' }, query: { mode: 'quiet', skip: undefined, n: 2 }, hash: 'top' })).toBe('/tr/workouts/chest-back/?mode=quiet&n=2#top');
    expect(router.href('results', { query: new URLSearchParams('a=1') })).toBe('/results/?a=1');
  });

  it('encodes parameters and refuses a missing one or an unknown route', () => {
    expect(router.href('game', { params: { slug: 'a b/c' } })).toBe('/games/a%20b%2Fc/');
    expect(() => router.href('game')).toThrow(/slug/);
    expect(() => router.href('nope' as Id)).toThrow(/no route/);
  });

  it('round-trips through match', () => {
    for (const lang of ['en', 'tr', 'de'] as const) {
      const url = router.href('game', { lang, params: { slug: 'pad-work' } });
      expect(router.match(url)).toMatchObject({ id: 'game', lang, params: { slug: 'pad-work' } });
    }
  });

  it('switches a page to another language and back', () => {
    expect(router.withLang('/games/squat-flap/', 'tr')).toBe('/tr/games/squat-flap/');
    expect(router.withLang('/tr/games/squat-flap/?x=1#y', 'en')).toBe('/games/squat-flap/?x=1#y');
    expect(router.withLang('/tr/', 'de')).toBe('/de/');
    expect(router.withLang('/de/results', 'en')).toBe('/results/');
  });
});

// ---------------------------------------------------------------------------------------------------------------------

class FakeEl implements NavElement {
  attrs: Record<string, string>;
  focused = false;
  parent: FakeEl | null;
  constructor(attrs: Record<string, string> = {}, parent: FakeEl | null = null) { this.attrs = { ...attrs }; this.parent = parent; }
  closest(selector: string): NavElement | null {
    if (selector === 'a[href]') {
      let n: FakeEl | null = this;
      while (n) { if ('href' in n.attrs) return n; n = n.parent; }
    }
    return null;
  }
  getAttribute(n: string): string | null { return this.attrs[n] ?? null; }
  hasAttribute(n: string): boolean { return n in this.attrs; }
  setAttribute(n: string, v: string): void { this.attrs[n] = v; }
  focus(): void { this.focused = true; }
}

function makeWindow(start = '/') {
  const listeners = { popstate: new Set<() => void>(), click: new Set<(e: NavClickEvent) => void>() };
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }];
  let index = 0;
  const main = new FakeEl({ 'data-main-heading': '' });
  const scrolls: number[] = [];
  const win = {
    location: {
      origin: 'https://bodyarcade.test',
      get pathname() { return new URL(entries[index]!.url, 'https://bodyarcade.test').pathname; },
      get search() { return new URL(entries[index]!.url, 'https://bodyarcade.test').search; },
      get hash() { return new URL(entries[index]!.url, 'https://bodyarcade.test').hash; },
    },
    history: {
      get state() { return entries[index]!.state; },
      scrollRestoration: 'auto' as 'auto' | 'manual',
      pushState(state: unknown, _t: string, url: string) { entries.splice(index + 1); entries.push({ url, state }); index++; },
      replaceState(state: unknown, _t: string, url: string) { entries[index] = { url, state }; },
    },
    scrollY: 0,
    scrollTo(_x: number, y: number) { scrolls.push(y); },
    addEventListener(t: 'popstate', cb: () => void) { listeners[t].add(cb); },
    removeEventListener(t: 'popstate', cb: () => void) { listeners[t].delete(cb); },
    document: {
      addEventListener(_t: 'click', cb: (e: NavClickEvent) => void) { listeners.click.add(cb); },
      removeEventListener(_t: 'click', cb: (e: NavClickEvent) => void) { listeners.click.delete(cb); },
      querySelector(s: string) { return s === '[data-main-heading]' ? main : null; },
      getElementById() { return null; },
    },
  } satisfies NavWindow;
  const back = (): void => { index = Math.max(0, index - 1); listeners.popstate.forEach((cb) => cb()); };
  const click = (attrs: Record<string, string>, mods: Partial<NavClickEvent> = {}): NavClickEvent => {
    const e: NavClickEvent = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: new FakeEl(attrs), preventDefault() { this.defaultPrevented = true; }, ...mods };
    listeners.click.forEach((cb) => cb(e));
    return e;
  };
  return { win, entries, back, click, main, scrolls, listeners, at: () => entries[index]!.url };
}

describe('the navigation controller', () => {
  const setup = (start = '/') => {
    const w = makeWindow(start);
    const changes: RouteChange<Id>[] = [];
    const nav = createNavigation<Id>({ win: w.win, router, onRoute: (c) => { changes.push(c); } });
    return { w, nav, changes };
  };
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('renders the first route on start without moving focus', async () => {
    const { w, nav, changes } = setup('/games/squat-flap/');
    nav.start();
    await flush();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ initial: true, popped: false, route: { id: 'game' } });
    expect(w.main.focused).toBe(false);
    expect(w.win.history.scrollRestoration).toBe('manual');
  });

  it('turns a click on an internal link into a push, scrolls to the top and focuses the heading', async () => {
    const { w, nav, changes } = setup('/');
    nav.start(); await flush();
    const e = w.click({ href: '/games/pad-work/' });
    await flush();
    expect(e.defaultPrevented).toBe(true);
    expect(w.at()).toBe('/games/pad-work/');
    expect(changes.at(-1)).toMatchObject({ initial: false, popped: false, replaced: false, route: { id: 'game', params: { slug: 'pad-work' } } });
    expect(w.scrolls.at(-1)).toBe(0);
    expect(w.main.focused).toBe(true);
    expect(w.main.attrs['tabindex']).toBe('-1');
  });

  it('leaves links alone that are not ours', async () => {
    const { w, nav, changes } = setup('/');
    nav.start(); await flush();
    const before = changes.length;
    const cases: [Record<string, string>, Partial<NavClickEvent>?][] = [
      [{ href: 'https://example.com/' }],
      [{ href: '/games/pad-work/' }, { metaKey: true }],
      [{ href: '/games/pad-work/' }, { ctrlKey: true }],
      [{ href: '/games/pad-work/' }, { button: 1 }],
      [{ href: '/games/pad-work/', target: '_blank' }],
      [{ href: '/games/pad-work/', download: '' }],
      [{ href: '/games/pad-work/', 'data-native': '' }],
      [{ href: '/games/pad-work/', rel: 'noopener external' }],
      [{ href: '#about' }],
      [{ href: 'mailto:info@peakappsstudio.com' }],
      [{ href: '/sitemap.xml' }],
      [{ href: '/games/pad-work/' }, { defaultPrevented: true }],
      [{}],
    ];
    for (const [attrs, mods] of cases) {
      const e = w.click(attrs, mods);
      expect(e.defaultPrevented, JSON.stringify(attrs)).toBe(mods?.defaultPrevented ?? false);
    }
    await flush();
    expect(changes).toHaveLength(before);
    expect(w.at()).toBe('/');
  });

  it('follows the back button and restores the scroll position', async () => {
    const { w, nav, changes } = setup('/');
    nav.start(); await flush();
    w.win.scrollY = 420;
    w.click({ href: '/results/' });
    await flush();
    w.back();
    await flush();
    expect(changes.at(-1)).toMatchObject({ popped: true, route: { id: 'home' } });
    expect(w.scrolls.at(-1)).toBe(420);
  });

  it('replaces the entry when asked', async () => {
    const { w, nav, changes } = setup('/');
    nav.start(); await flush();
    nav.go('/results/', { replace: true });
    await flush();
    expect(w.entries).toHaveLength(1);
    expect(w.at()).toBe('/results/');
    expect(changes.at(-1)).toMatchObject({ replaced: true, route: { id: 'results' } });
  });

  it('a link marked data-replace takes the place of the page it is on', async () => {
    const { w, nav, changes } = setup('/');
    nav.start(); await flush();
    w.click({ href: '/results/' });
    await flush();
    expect(w.entries).toHaveLength(2);
    w.click({ href: '/games/pad-work/', 'data-replace': '' });
    await flush();
    expect(w.entries).toHaveLength(2);
    expect(w.at()).toBe('/games/pad-work/');
    expect(changes.at(-1)).toMatchObject({ replaced: true, route: { id: 'game' } });
    w.back();
    await flush();
    expect(w.at()).toBe('/');
  });

  it('refuses another origin and re-renders when the same page is opened again', async () => {
    const { w, nav, changes } = setup('/');
    nav.start(); await flush();
    expect(nav.go('https://evil.example/')).toBe(false);
    const n = changes.length;
    expect(nav.go('/')).toBe(true);
    await flush();
    expect(changes).toHaveLength(n + 1);
    expect(w.entries).toHaveLength(1);
  });

  it('survives a page that throws while rendering', async () => {
    const w = makeWindow('/');
    const onError = vi.fn();
    const nav = createNavigation<Id>({ win: w.win, router, onRoute: () => { throw new Error('boom'); }, onError });
    nav.start();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stops listening', async () => {
    const { w, nav } = setup('/');
    nav.start(); await flush();
    nav.stop();
    expect(w.listeners.click.size).toBe(0);
    expect(w.listeners.popstate.size).toBe(0);
  });
});
