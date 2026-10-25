import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { LEGACY_PAGES, MUST_HAVE, assemble, resolvePath } from './assemble.ts';
import { HEAD_TAGS, TARGETS } from './site.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ba-release-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const page = (body: string) => `<!doctype html>\n<html lang="en">\n<head>\n<title>t</title>\n</head>\n<body>${body}</body>\n</html>\n`;

/** A small stand-in for packages/web/dist: two start pages, a game page, 404, a sitemap, hashed files and a map. */
function fakeWebBuild(dir: string, extraBody = ''): void {
  const files: Record<string, string> = {
    'index.html': page(`<a href="/games/road-run/">run</a><a href="/privacy">privacy</a>${extraBody}`),
    'tr/index.html': page('<a href="/tr/games/road-run/">koş</a>'),
    'games/road-run/index.html': page('<a href="/play/road-run/">play</a><script type="module" src="/static/main-a1.js"></script>'),
    'tr/games/road-run/index.html': page('<a href="/">home</a>'),
    'play/road-run/index.html': page(''),
    'pro/index.html': page('<a href="/">home</a>'),
    'tr/pro/index.html': page('<a href="/tr/">home</a>'),
    '404.html': page('<a href="/">home</a>'),
    'sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://bodyarcade.com/</loc>\n  </url>\n</urlset>\n',
    'robots.txt': 'User-agent: *\nAllow: /\n',
    '_headers': '/*\n  X-Test: app\n',
    '.vite/manifest.json': '{}',
    'static/main-a1.js': 'console.log(1)\n//# sourceMappingURL=main-a1.js.map\n',
    'static/main-a1.js.map': '{}',
    'static/main-b2.css': 'body{}',
    'vendor/mediapipe/models/m.task': 'model',
  };
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
}

describe('assemble', { timeout: 60_000 }, () => {
  const web = join(tmp, 'web');
  fakeWebBuild(web);
  const out = join(tmp, 'out-prod');
  const report = assemble({ root, web, out, target: TARGETS.production });
  const read = (f: string) => readFileSync(join(out, f), 'utf8');

  it('puts the app, the old content pages and the site files together without problems', () => {
    expect(report.problems).toEqual([]);
    for (const f of MUST_HAVE) expect(existsSync(join(out, f)), f).toBe(true);
    for (const p of LEGACY_PAGES) expect(read(p.file), p.file).toContain('BodyArcade');
  });

  it('lists the page on deleting the account, in both languages, in the sitemap and in the folder', () => {
    const sitemap = read('sitemap.xml');
    for (const url of ['/delete-account', '/tr/delete-account']) {
      expect(sitemap, url).toContain(`<loc>https://bodyarcade.com${url}</loc>`);
      expect(existsSync(join(out, `${url.replace(/^\//, '')}.html`)), url).toBe(true);
    }
  });

  it('leaves out the source maps, the Vite manifest and the app\'s own robots and header rules', () => {
    expect(existsSync(join(out, 'static/main-a1.js.map'))).toBe(false);
    expect(existsSync(join(out, '.vite'))).toBe(false);
    expect(read('_headers')).not.toContain('X-Test: app');
    expect(read('robots.txt')).toContain('Disallow: /api/');
  });

  it('gives every app page the manifest, the icon and the worker loader, and leaves the old pages as they are', () => {
    for (const f of ['index.html', 'tr/index.html', 'games/road-run/index.html', '404.html']) for (const t of HEAD_TAGS) expect(read(f), f).toContain(t);
    expect(read('privacy.html')).not.toContain('/sw-register.js');
  });

  it('precaches the start pages of both languages and the hashed files, and stamps the build', () => {
    const sw = read('sw.js');
    const cfg = JSON.parse(/^const CONFIG = (.*);$/m.exec(sw)?.[1] ?? '{}') as { build: string; precache: string[]; startPages: Record<string, string> };
    expect(cfg.precache).toEqual(['/', '/tr/', '/static/main-a1.js', '/static/main-b2.css']);
    expect(cfg.startPages).toEqual({ en: '/', tr: '/tr/' });
    const stamp = JSON.parse(read('version.json')) as { build: string; target: string };
    expect(stamp).toMatchObject({ build: cfg.build, target: 'production' });
    expect(report.precache).toBe(4);
  });

  it('the same content gives the same build id, other content another one', () => {
    const again = assemble({ root, web, out: join(tmp, 'out-prod-2'), target: TARGETS.production });
    expect(again.build).toBe(report.build);
    const web2 = join(tmp, 'web2');
    fakeWebBuild(web2, '<p>changed</p>');
    expect(assemble({ root, web: web2, out: join(tmp, 'out-prod-3'), target: TARGETS.production }).build).not.toBe(report.build);
  });

  it('finds a link to a page that does not exist', () => {
    const web3 = join(tmp, 'web3');
    fakeWebBuild(web3, '<a href="/games/no-such-game/">x</a>');
    const r = assemble({ root, web: web3, out: join(tmp, 'out-prod-4'), target: TARGETS.preview });
    expect(r.problems).toEqual(['/index.html links to /games/no-such-game/, which does not exist']);
  });

  it('knows how the asset layer answers each form of an address', () => {
    const have = new Set(['/index.html', '/privacy.html', '/blog/index.html', '/manifest.json']);
    expect(resolvePath(have, '/')).toBe('ok');
    expect(resolvePath(have, '/privacy')).toBe('ok');
    expect(resolvePath(have, '/privacy.html')).toBe('redirect');
    expect(resolvePath(have, '/privacy/')).toBe('redirect');
    expect(resolvePath(have, '/blog/')).toBe('ok');
    expect(resolvePath(have, '/blog')).toBe('redirect');
    expect(resolvePath(have, '/manifest.json')).toBe('ok');
    expect(resolvePath(have, '/nope')).toBe('missing');
  });
});
