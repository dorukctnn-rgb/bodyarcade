import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_ORIGIN, HEAD_TAGS, STATIC_REDIRECTS, TARGETS, contentSecurityPolicy, headersFile, injectHead, mergeSitemap, precacheList,
  redirectsFile, robotsFile, serviceWorkerSource, webManifest, type SwConfig,
} from './site.ts';

const ROOT = new URL('../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, ROOT), 'utf8');

describe('targets and headers', () => {
  it('the preview is never indexable and production is bodyarcade.com, each with its own wrangler config', () => {
    expect(TARGETS.preview.indexable).toBe(false);
    expect(TARGETS.production.origin).toBe('https://bodyarcade.com');
    for (const t of Object.values(TARGETS)) {
      const cfg = JSON.parse(read(t.config).replace(/^\s*\/\/.*$/gm, '')) as { name: string; vars: { PUBLIC_ORIGIN: string; SITE_TARGET: string }; workers_dev: boolean };
      expect(cfg.name).toBe(t.worker);
      expect(cfg.vars.PUBLIC_ORIGIN).toBe(t.origin);
      expect(cfg.vars.SITE_TARGET).toBe(t.id);
      expect(cfg.workers_dev).toBe(t.id === 'preview');
    }
  });

  it('the CSP is report-only, names the live socket host of its own target and reports to the Worker', () => {
    const prod = headersFile(TARGETS.production);
    expect(prod).toContain('Content-Security-Policy-Report-Only: ');
    expect(prod).not.toMatch(/^\s*Content-Security-Policy:/m);
    expect(contentSecurityPolicy(TARGETS.production)).toContain('wss://bodyarcade.com');
    expect(contentSecurityPolicy(TARGETS.preview)).toContain('wss://bodyarcade-v2-preview.railer-iot.workers.dev');
    expect(contentSecurityPolicy(TARGETS.production)).toMatch(/report-uri \/api\/csp-report; report-to csp$/);
    expect(prod).toContain('Reporting-Endpoints: csp="https://bodyarcade.com/api/csp-report"');
    // the old third parties of the pose model are gone: it is self-hosted now
    expect(contentSecurityPolicy(TARGETS.production)).not.toMatch(/jsdelivr|storage\.googleapis/);
  });

  it('only the preview says noindex, and robots.txt agrees', () => {
    expect(headersFile(TARGETS.preview)).toContain('X-Robots-Tag: noindex, nofollow');
    expect(headersFile(TARGETS.production)).not.toContain('X-Robots-Tag');
    expect(robotsFile(TARGETS.preview)).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsFile(TARGETS.production)).toContain(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`);
  });

  it('every inline script of the old content pages is allowed by the hash in the CSP', async () => {
    const { createHash } = await import('node:crypto');
    const csp = contentSecurityPolicy(TARGETS.production);
    for (const page of ['privacy.html', 'terms.html', 'webcam-fitness-games.html', 'ring-fit-adventure-alternative.html', 'blog/index.html', 'blog/why-browser-fitness-games-are-the-future.html']) {
      for (const m of read(`site/${page}`).matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/ld\+json/.test(m[1] ?? '')) continue;
        const hash = `'sha256-${createHash('sha256').update(m[2] ?? '').digest('base64')}'`;
        expect(csp, page).toContain(hash);
      }
    }
  });

  it('cache rules: hashed files immutable, the worker and the manifest revalidate, assetlinks is plain JSON', () => {
    const h = headersFile(TARGETS.production);
    const rule = (path: string): string => (h.split('\n\n').join('\n').split(/\n(?=\S)/).find((b) => b.startsWith(`${path}\n`)) ?? '');
    expect(rule('/static/*')).toContain('immutable');
    expect(rule('/sw.js')).toContain('max-age=0, must-revalidate');
    expect(rule('/manifest.json')).toContain('must-revalidate');
    expect(rule('/.well-known/assetlinks.json')).toContain('Content-Type: application/json');
  });

  it('the static redirects keep the live site\'s 301s, without the old game addresses (the Worker has those)', () => {
    const r = redirectsFile();
    for (const [from, to] of STATIC_REDIRECTS) expect(r).toContain(`${from} ${to} 301`);
    expect(r).not.toMatch(/^\/bodyarcade|^\/play |^\/app /m);
  });

  it('the support address of the store listings opens the FAQ of its language', () => {
    const r = redirectsFile();
    for (const line of ['/support /faq 301', '/support/ /faq 301', '/tr/destek /tr/faq 301', '/tr/sss /tr/faq 301']) expect(r).toContain(line);
  });
});

describe('pages, manifest, sitemap', () => {
  it('adds the manifest, the icon and the worker loader once, before </head>', () => {
    const page = '<!doctype html><html><head><title>x</title></head><body></body></html>';
    const once = injectHead(page);
    for (const t of HEAD_TAGS) expect(once).toContain(t);
    expect(injectHead(once)).toBe(once);
    expect(once.indexOf(HEAD_TAGS[2])).toBeLessThan(once.indexOf('</head>'));
    expect(() => injectHead('<html><body></body></html>')).toThrow();
  });

  it('the manifest starts at the app home with separate any and maskable icons', () => {
    const m = JSON.parse(webManifest()) as { start_url: string; id: string; icons: { purpose: string }[] };
    expect(m.start_url).toBe('/');
    expect(m.id).toBe('/');
    expect(m.icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable']);
  });

  it('the sitemap keeps the app\'s entries and adds the content pages once', () => {
    const app = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${CANONICAL_ORIGIN}/</loc>\n  </url>\n</urlset>\n`;
    const out = mergeSitemap(app, [{ loc: `${CANONICAL_ORIGIN}/privacy`, lastmod: '2026-10-23' }, { loc: `${CANONICAL_ORIGIN}/` }]);
    expect(out.match(/<loc>/g)).toHaveLength(2);
    expect(out).toContain('<lastmod>2026-10-23</lastmod>');
    expect(out.trim().endsWith('</urlset>')).toBe(true);
  });
});

// ---- the service worker, run in a sandbox with a fake network and a fake Cache Storage ----------------------------

type Handler = (e: unknown) => void;
const ORIGIN = 'https://bodyarcade.com';

class FakeCache {
  readonly map = new Map<string, Response>();
  async put(req: string | { url: string }, res: Response): Promise<void> { this.map.set(new URL(typeof req === 'string' ? req : req.url, ORIGIN).href, res); }
  async match(req: string | { url: string }): Promise<Response | undefined> { const r = this.map.get(new URL(typeof req === 'string' ? req : req.url, ORIGIN).href); return r?.clone(); }
}

function sandbox(net: (url: string) => Promise<Response>, cfg: Partial<SwConfig> = {}) {
  const stores = new Map<string, FakeCache>();
  const handlers = new Map<string, Handler>();
  const fetched: string[] = [];
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n) as FakeCache; },
    delete: async (n: string) => stores.delete(n),
    match: async (req: string | { url: string }, o?: { cacheName?: string }) => {
      for (const [name, c] of stores) { if (o?.cacheName && o.cacheName !== name) continue; const hit = await c.match(req); if (hit) return hit; }
      return undefined;
    },
  };
  const fetchFn = async (req: string | { url: string }) => { const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN).href; fetched.push(url); return net(url); };
  const full: SwConfig = { build: 'b1', precache: ['/', '/tr/', '/static/main-a.js', '/static/main-a.css'], startPages: { en: '/', tr: '/tr/' }, libPrefixes: ['/vendor/mediapipe/'], libCache: 'ba-lib-mediapipe-1.1.1', navTimeoutMs: 50, ...cfg };
  const src = serviceWorkerSource(read('release/sw.template.js'), full);
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: Handler) => handlers.set(t, h),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { navigationPreload: { enable: vi.fn(async () => undefined) } },
  };
  vm.runInNewContext(src, { self, caches, fetch: fetchFn, Request, Response, URL, Headers, setTimeout, clearTimeout, Promise, console });
  const waitAll: Promise<unknown>[] = [];
  const lifecycle = async (type: 'install' | 'activate') => { const ps: Promise<unknown>[] = []; handlers.get(type)?.({ waitUntil: (p: Promise<unknown>) => ps.push(p) }); await Promise.all(ps); };
  const request = async (path: string, init: { mode?: string; method?: string; headers?: Record<string, string> } = {}) => {
    let responded: Promise<Response> | null = null;
    const req = { url: new URL(path, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: new Headers(init.headers ?? {}) };
    handlers.get('fetch')?.({ request: req, respondWith: (p: Promise<Response>) => { responded = p; }, waitUntil: (p: Promise<unknown>) => waitAll.push(p), preloadResponse: Promise.resolve(undefined) });
    return responded as Promise<Response> | null;
  };
  return { stores, fetched, lifecycle, request, self, settle: () => Promise.all(waitAll), src };
}

const ok = (body: string, type = 'text/html') => new Response(body, { status: 200, headers: { 'Content-Type': type } });

describe('service worker', () => {
  afterEach(() => vi.useRealTimers());

  it('precaches the build at install, takes over at once and deletes every other cache, the old site\'s included', async () => {
    const s = sandbox(async (url) => ok(`body of ${url}`));
    for (const old of ['ba-20261023b', 'ba-shell-b0', 'something-else']) s.stores.set(old, new FakeCache());
    s.stores.set('ba-lib-mediapipe-1.1.1', new FakeCache());
    await s.lifecycle('install');
    expect([...(s.stores.get('ba-shell-b1')?.map.keys() ?? [])].map((u) => new URL(u).pathname).sort()).toEqual(['/', '/static/main-a.css', '/static/main-a.js', '/tr/']);
    expect(s.self.skipWaiting).toHaveBeenCalled();
    await s.lifecycle('activate');
    expect([...s.stores.keys()].sort()).toEqual(['ba-lib-mediapipe-1.1.1', 'ba-shell-b1']);
    expect(s.self.clients.claim).toHaveBeenCalled();
    expect(s.self.registration.navigationPreload.enable).toHaveBeenCalled();
  });

  it('installs even when a precache file fails, and leaves /api, other origins and POST to the network', async () => {
    const s = sandbox(async (url) => (url.endsWith('.css') ? new Response('no', { status: 404 }) : ok('x')));
    await s.lifecycle('install');
    expect(s.stores.get('ba-shell-b1')?.map.size).toBe(3);
    expect(await s.request('/api/rooms', { method: 'POST' })).toBeNull();
    expect(await s.request('/api/ice')).toBeNull();
    expect(await s.request('https://api.gumroad.com/v2/licenses/verify')).toBeNull();
    expect(await s.request('/sw.js')).toBeNull();
    expect(await s.request('/version.json')).toBeNull();
  });

  it('serves hashed build files from the cache without the network', async () => {
    const s = sandbox(async () => ok('fresh', 'text/javascript'));
    await s.lifecycle('install');
    s.fetched.length = 0;
    const res = await s.request('/static/main-a.js');
    expect(await res?.text()).toBe(`fresh`);
    expect(s.fetched).toEqual([]);
  });

  it('keeps the pose model and WASM in the library cache after the first use', async () => {
    const s = sandbox(async () => ok('wasm', 'application/wasm'));
    await s.lifecycle('install');
    await s.request('/vendor/mediapipe/1.1.1/wasm/vision_wasm_internal.wasm');
    await new Promise((r) => setTimeout(r, 0));
    s.fetched.length = 0;
    const again = await s.request('/vendor/mediapipe/1.1.1/wasm/vision_wasm_internal.wasm');
    expect(await again?.text()).toBe('wasm');
    expect(s.fetched).toEqual([]);
  });

  it('pages: the network first; offline, the cached page, else the cached start page of its language', async () => {
    let online = true;
    const s = sandbox(async (url) => { if (!online) throw new TypeError('offline'); return ok(`page ${new URL(url).pathname}`); });
    await s.lifecycle('install');
    expect(await (await s.request('/games/road-run/', { mode: 'navigate' }))?.text()).toBe('page /games/road-run/');
    await new Promise((r) => setTimeout(r, 0));
    online = false;
    expect(await (await s.request('/games/road-run/', { mode: 'navigate' }))?.text()).toBe('page /games/road-run/');
    expect(await (await s.request('/games/star-catch/', { mode: 'navigate' }))?.text()).toBe('page /');
    expect(await (await s.request('/tr/games/star-catch/', { mode: 'navigate' }))?.text()).toBe('page /tr/');
  });

  it('pages: a network slower than the limit gets the cached copy, and the answer still refreshes the cache', async () => {
    let slow = false;
    const s = sandbox(async (url) => { if (slow) await new Promise((r) => setTimeout(r, 200)); return ok(`${slow ? 'new' : 'old'} ${new URL(url).pathname}`); });
    await s.lifecycle('install');
    slow = true;
    const t0 = Date.now();
    expect(await (await s.request('/', { mode: 'navigate' }))?.text()).toBe('old /');
    expect(Date.now() - t0).toBeLessThan(180);
    await s.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await s.stores.get('ba-shell-b1')?.match('/'))?.text()).toBe('new /');
  });

  it('does not cache redirects or errors as pages', async () => {
    const s = sandbox(async (url) => (url.endsWith('/gone/') ? new Response('missing', { status: 404 }) : ok('x')));
    await s.lifecycle('install');
    expect((await s.request('/gone/', { mode: 'navigate' }))?.status).toBe(404);
    await new Promise((r) => setTimeout(r, 0));
    expect(await s.stores.get('ba-shell-b1')?.match('/gone/')).toBeUndefined();
  });

  it('the generated source carries this build\'s settings', () => {
    const s = sandbox(async () => ok('x'));
    expect(s.src).toContain('"build":"b1"');
    expect(s.src).not.toContain('/*__CONFIG__*/');
  });
});

describe('service worker: invitation and friend-link pages', () => {
  const pathOf = (u: string) => new URL(u).pathname;
  const cached = (s: ReturnType<typeof sandbox>) => [...(s.stores.get('ba-shell-b1')?.map.keys() ?? [])].map(pathOf).sort();

  it('a room link and a friend link open from the network and are never stored under their own address', async () => {
    const s = sandbox(async (url) => ok(`page ${pathOf(url)}`));
    await s.lifecycle('install');
    for (const p of ['/r/K7Q2MX', '/f/BA-7K2Q4X', '/tr/f/BA-7K2Q4X/', '/tr/r/K7Q2MX/', '/fr/r/K7Q2MX/', '/de/f/BA-7K2Q4X']) {
      expect(await (await s.request(p, { mode: 'navigate' }))?.text(), p).toBe(`page ${p}`);
    }
    await s.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(cached(s)).toEqual(['/', '/static/main-a.css', '/static/main-a.js', '/tr/']);
    // the other pages are cached as before
    await s.request('/friends/', { mode: 'navigate' });
    await new Promise((r) => setTimeout(r, 0));
    expect(cached(s)).toContain('/friends/');
  });

  it('with the network out they get the cached start page of their language, also when an older build left a copy of that address', async () => {
    let online = true;
    const s = sandbox(async (url) => { if (!online) throw new TypeError('offline'); return ok(`page ${pathOf(url)}`); });
    await s.lifecycle('install');
    // a copy under a code, as an older worker would have left it
    await s.stores.get('ba-shell-b1')?.put('/r/K7Q2MX', ok('an old shell'));
    online = false;
    expect(await (await s.request('/r/K7Q2MX', { mode: 'navigate' }))?.text()).toBe('page /');
    expect(await (await s.request('/f/BA-7K2Q4X', { mode: 'navigate' }))?.text()).toBe('page /');
    expect(await (await s.request('/tr/f/BA-7K2Q4X/', { mode: 'navigate' }))?.text()).toBe('page /tr/');
    expect(await (await s.request('/tr/r/K7Q2MX', { mode: 'navigate' }))?.text()).toBe('page /tr/');
  });

  it('a slow network gets the start page at once; a link the server cannot answer well (404 or a failure) gets it too, and a good answer is passed on as it is', async () => {
    let mode: 'slow' | '404' | '503' | 'ok' = 'slow';
    // the slow answer comes 200 ms after the worker's own wait of 50 ms (navTimeoutMs): "at once" is before the network has answered, which
    // a timer of 200 ms against one of 50 ms says however busy the machine is (a bound on the clock failed under the final test's load)
    let answered = false;
    const s = sandbox(async (url) => {
      if (mode === 'slow') { await new Promise((r) => setTimeout(r, 200)); answered = true; }
      if (mode === '404') return new Response('missing', { status: 404 });
      if (mode === '503') return new Response('down', { status: 503 });
      return ok(`new ${pathOf(url)}`);
    });
    await s.lifecycle('install');
    answered = false;
    const first = await s.request('/r/K7Q2MX', { mode: 'navigate' });
    const before = !answered;
    expect(await first?.text()).toBe('new /');                                                                    // the cached start page of the install
    expect(before, 'the start page came before the slow network answered').toBe(true);
    await s.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(cached(s)).not.toContain('/r/K7Q2MX');
    mode = '404';
    expect((await s.request('/f/BA-7K2Q4X', { mode: 'navigate' }))?.status).toBe(200);
    mode = '503';
    expect((await s.request('/f/BA-7K2Q4X', { mode: 'navigate' }))?.status).toBe(200);
    mode = 'ok';
    expect(await (await s.request('/f/BA-7K2Q4X', { mode: 'navigate' }))?.text()).toBe('new /f/BA-7K2Q4X');
    // without a start page in the cache the answer itself is all there is
    const bare = sandbox(async () => new Response('missing', { status: 404 }), { precache: [] });
    await bare.lifecycle('install');
    expect((await bare.request('/r/K7Q2MX', { mode: 'navigate' }))?.status).toBe(404);
  });

  it('only real link addresses are links: a page of the app that happens to start with f or r is cached like any other', async () => {
    const s = sandbox(async (url) => ok(`page ${pathOf(url)}`));
    await s.lifecycle('install');
    for (const p of ['/r/', '/r', '/friends/', '/results/', '/f/a/b', '/frames/x']) await s.request(p, { mode: 'navigate' });
    await s.settle();
    await new Promise((r) => setTimeout(r, 0));
    const stored = cached(s);
    for (const p of ['/r/', '/r', '/friends/', '/results/', '/f/a/b', '/frames/x']) expect(stored, p).toContain(p);
  });
});

describe('precache list', () => {
  it('takes every hashed build file but source maps, after the start pages', () => {
    expect(precacheList(['/static/a.js', '/static/a.js.map', '/index.html', '/static/b.css', '/vendor/x.wasm'], ['/', '/tr/'])).toEqual(['/', '/tr/', '/static/a.js', '/static/b.css']);
  });
});
