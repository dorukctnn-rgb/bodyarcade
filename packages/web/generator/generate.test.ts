// The generator against a fake Vite manifest: the files it writes, the sitemap, the language alternates, the pictures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OG_IMAGE } from '../content/chrome.ts';
import { BRAND_CARD } from '../src/pages.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import type { ShellGame } from '../catalogue/types.ts';
import { gameHasLanguage, generate, type GenerateReport } from './generate.ts';

let out = '';
let report: GenerateReport;
const read = (p: string): string => readFileSync(join(out, p), 'utf8');

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'ba-gen-'));
  mkdirSync(join(out, '.vite'), { recursive: true });
  writeFileSync(join(out, '.vite', 'manifest.json'), JSON.stringify({
    'src/main.ts': { file: 'static/main-abc123.js', src: 'src/main.ts', isEntry: true, css: ['static/main-abc123.css'], imports: ['_chunk.js'] },
    '_chunk.js': { file: 'static/chunk-def456.js' },
    '../../../design/fonts/example.woff2': { file: 'static/example-aaa111.woff2', src: '../../../design/fonts/example.woff2' },
  }));
  report = generate({ out, fixtures: 'only', version: '9.9.9' });
});

afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); });

describe('the generated site', () => {
  it('has no problems and writes the pages of every complete language', () => {
    expect(report.problems).toEqual([]);
    const paths = report.pages.map((p) => p.path);
    for (const p of ['/', '/tr/', '/workouts/legs/', '/tr/workouts/legs/', '/games/squat-flap/', '/tr/games/squat-flap/', '/play/squat-flap/', '/settings/', '/tr/settings/', '/pro/', '/results/', '/welcome/']) {
      expect(paths, p).toContain(p);
      expect(existsSync(join(out, p, 'index.html')), p).toBe(true);
    }
    expect(existsSync(join(out, '404.html'))).toBe(true);
    // Languages that are only drafts get no pages.
    expect(paths.some((p) => p.startsWith('/de/') || p.startsWith('/es/') || p.startsWith('/fr/'))).toBe(false);
  });

  it('puts only the pages made for search in the sitemap, each with its language alternates', () => {
    const sitemap = read('sitemap.xml');
    expect(sitemap).toContain('<loc>https://bodyarcade.com/games/squat-flap/</loc>');
    expect(sitemap).toContain('<loc>https://bodyarcade.com/tr/games/squat-flap/</loc>');
    expect(sitemap).toContain('hreflang="x-default" href="https://bodyarcade.com/games/squat-flap/"');
    for (const hidden of ['/settings/', '/pro/', '/results/', '/play/', '/welcome/']) expect(sitemap, hidden).not.toContain(`bodyarcade.com${hidden}`);
    const count = (sitemap.match(/<loc>/g) ?? []).length;
    expect(count).toBe(report.pages.filter((p) => p.indexable).length);
    expect(read('robots.txt')).toContain('Sitemap: https://bodyarcade.com/sitemap.xml');
  });

  it('gives every page the scripts, styles and fonts of the build and a canonical address', () => {
    const html = read('games/squat-flap/index.html');
    expect(html).toContain('<script type="module" src="/static/main-abc123.js">');
    expect(html).toContain('<link rel="stylesheet" href="/static/main-abc123.css">');
    expect(html).toContain('<link rel="modulepreload" href="/static/chunk-def456.js">');
    expect(html).toContain('rel="preload" href="/static/example-aaa111.woff2"');
    expect(html).toContain('<link rel="canonical" href="https://bodyarcade.com/games/squat-flap/">');
    expect(html).toContain('<html lang="en">');
    expect(read('tr/games/squat-flap/index.html')).toContain('<html lang="tr">');
    // No inline script or style, so a strict content security policy can be used.
    expect(html).not.toMatch(/<script(?![^>]*(?:src=|type="application\/(?:ld\+)?json"))/);
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('keeps the pages for the player out of the index', () => {
    for (const p of ['settings', 'pro', 'results', 'play/squat-flap']) {
      const html = read(`${p}/index.html`);
      expect(html, p).toContain('<meta name="robots" content="noindex, follow">');
      expect(html, p).not.toContain('rel="canonical"');
    }
    expect(read('404.html')).toContain('noindex');
  });

  it('copies the pictures under a name with a hash of their content and tells the app the new addresses', () => {
    const tiles = readdirSync(join(out, 'static', 'tiles'));
    expect(tiles.filter((t) => t.startsWith('squat-flap'))).toHaveLength(2);
    expect(tiles.every((t) => /\.[0-9a-f]{8}\.webp$/.test(t))).toBe(true);
    const html = read('index.html');
    const map = JSON.parse(/<script type="application\/json" id="ba-assets">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}') as Record<string, string>;
    expect(map['/assets/tiles/squat-flap-400.webp']).toMatch(/^\/static\/tiles\/squat-flap-400\.[0-9a-f]{8}\.webp$/);
    expect(html).toContain(map['/assets/tiles/squat-flap-400.webp'] as string);
    // Outside the map itself, no page points at a development address (the brand card of the link preview is the site's own file, the one the content pages share).
    expect(html.replace(/<script type="application\/json" id="ba-assets">[\s\S]*?<\/script>/, '').replace(`content="https://bodyarcade.com/assets/brand/${OG_IMAGE.file}"`, '')).not.toContain('/assets/');
    expect(report.assets).toBe(Object.keys(map).length);
  });

  it('shows the brand card when the home page, a region, the plans or the Pro page is shared, and the tile of the game for a game page, each with its size', () => {
    const card = [
      `<meta property="og:image" content="https://bodyarcade.com/assets/brand/${OG_IMAGE.file}">`,
      `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
      `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
      '<meta name="twitter:card" content="summary_large_image">',
    ];
    for (const p of ['index.html', 'tr/index.html', 'workouts/legs/index.html', 'tr/workouts/legs/index.html', 'plans/index.html', 'tr/plans/index.html', 'pro/index.html']) {
      const html = read(p);
      for (const line of card) expect(html, `${p}: ${line}`).toContain(line);
    }
    // The app's card and the content pages' card are one file (content.test.ts reads its real size).
    expect(BRAND_CARD).toEqual({ path: `/assets/brand/${OG_IMAGE.file}`, width: OG_IMAGE.width, height: OG_IMAGE.height });
    for (const p of ['games/squat-flap/index.html', 'tr/games/squat-flap/index.html']) {
      const html = read(p);
      expect(html, p).toMatch(/<meta property="og:image" content="https:\/\/bodyarcade\.com\/static\/tiles\/squat-flap\.[0-9a-f]{8}\.webp">/);
      expect(html, p).toContain('<meta property="og:image:width" content="800">');
      expect(html, p).toContain('<meta property="og:image:height" content="600">');
    }
  });

  it('writes header rules: long cache for the hashed files and the camera for this site only', () => {
    const h = read('_headers');
    expect(h).toContain('/static/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(h).toContain('Permissions-Policy: camera=(self)');
  });

  it('has a Turkish page for a game only when every text of it exists in Turkish', () => {
    const g = loadCatalogue({ fixtures: 'only' }).catalogue.games[0] as ShellGame;
    expect(gameHasLanguage(g, 'tr')).toBe(true);
    expect(gameHasLanguage({ ...g, catalogue: { ...g.catalogue, tagline: { en: 'Only English.' } } }, 'tr')).toBe(false);
    expect(gameHasLanguage({ ...g, title: 'Plain name' }, 'tr')).toBe(true);
  });
});

describe('without a build', () => {
  it('says what to run first', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ba-gen-empty-'));
    try {
      expect(() => generate({ out: empty, fixtures: 'only' })).toThrow(/Run "vite build/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
