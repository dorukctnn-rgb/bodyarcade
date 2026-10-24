// Writes the static pages of the site into the build folder, after `vite build` has made the scripts and styles:
// one HTML file per address (home, body regions, every game, and the pages that belong to the app), in English and in
// every other complete language, plus sitemap.xml, robots.txt, 404.html and the header rules. The pages come from the
// same views and the same page function as the browser app, so what a crawler reads is what a player sees.
// Run it with node (it strips the types itself):
//   node packages/web/generator/generate.ts [--out packages/web/dist] [--fixtures none|fill|only]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SERVER_CAPABILITIES } from '../../core/ui/capabilities.ts';
import { LANG_INFO, type Lang } from '../../core/ui/i18n/index.ts';
import { hasLanguage } from '../../core/ui/i18n/localized.ts';
import { devAssets, mappedAssets, ONBOARDING_FILES, type TileSize } from '../src/assets.ts';
import { loadCatalogue, repoRoot, tilesDir, type FixtureMode } from '../catalogue/load.ts';
import type { ShellGame } from '../catalogue/types.ts';
import { renderDocument, type Alternate, type BuildAssets } from '../src/document.ts';
import { makeContext } from '../src/make-context.ts';
import { EMPTY_STATE, renderPage, SITE_ORIGIN } from '../src/pages.ts';
import { INDEXED_LANGS, REGION_ORDER, router, type RouteId } from '../src/routes.ts';

export interface GenerateOptions {
  /** The build folder made by `vite build`. */
  out: string;
  fixtures: FixtureMode;
  /** Version shown on the settings page. */
  version?: string;
}

export interface PageRecord {
  path: string;
  lang: Lang;
  route: RouteId;
  indexable: boolean;
  file: string;
}

export interface GenerateReport {
  pages: PageRecord[];
  assets: number;
  problems: string[];
}

interface ViteManifestEntry { file: string; src?: string; isEntry?: boolean; css?: string[]; imports?: string[]; assets?: string[] }

const hash8 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex').slice(0, 8);

/** A game has a page in a language only when every text of the game exists in it. */
export function gameHasLanguage(g: ShellGame, lang: Lang): boolean {
  const c = g.catalogue;
  const all = [g.title, c.tagline, c.about, ...c.how, ...c.measures, ...(c.seatedNote ? [c.seatedNote] : []), ...(c.quietNote ? [c.quietNote] : [])];
  return all.every((t) => hasLanguage(t, lang));
}

function readManifest(out: string): Record<string, ViteManifestEntry> {
  const candidates = [join(out, '.vite', 'manifest.json'), join(out, 'manifest.json')];
  const file = candidates.find((c) => existsSync(c));
  if (!file) throw new Error(`No Vite manifest in ${out}. Run "vite build --config packages/web/vite.config.ts" first.`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, ViteManifestEntry>;
}

function buildAssets(manifest: Record<string, ViteManifestEntry>): BuildAssets {
  const entry = Object.values(manifest).find((e) => e.isEntry && (e.src ?? '').endsWith('src/main.ts'));
  if (!entry) throw new Error('The Vite manifest has no entry for src/main.ts.');
  const byKey = (k: string): ViteManifestEntry | undefined => manifest[k];
  const chunks = (entry.imports ?? []).map((k) => byKey(k)?.file).filter((f): f is string => !!f);
  const fonts = Object.values(manifest).filter((e) => e.file.endsWith('.woff2')).map((e) => `/${e.file}`);
  // The assets of the entry's styles (fonts) are listed under the entry's css files in newer Vite versions; take both.
  for (const a of entry.assets ?? []) if (a.endsWith('.woff2') && !fonts.includes(`/${a}`)) fonts.push(`/${a}`);
  return { css: (entry.css ?? []).map((c) => `/${c}`), js: `/${entry.file}`, modulePreload: chunks.map((c) => `/${c}`), fonts };
}

/** Copies the pictures the views refer to under names that carry a hash of their content, and returns old URL to new URL. */
function copyAssets(out: string, games: readonly ShellGame[], root: string): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (devUrl: string, from: string, dir: string): void => {
    const buf = readFileSync(from);
    const dot = from.lastIndexOf('.');
    const base = from.slice(Math.max(from.lastIndexOf('/'), from.lastIndexOf('\\')) + 1, dot);
    const name = `${base}.${hash8(buf)}${from.slice(dot)}`;
    const target = join(out, 'static', dir, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(from, target);
    map[devUrl] = `/static/${dir}/${name}`;
  };
  for (const g of games) {
    for (const size of [400, 800] as TileSize[]) {
      const file = join(tilesDir(root), `${g.catalogue.tile}${size === 400 ? '-400' : ''}.webp`);
      put(devAssets.tile(g.catalogue.tile, size), file, 'tiles');
    }
  }
  for (const [url, name] of [[devAssets.logo('light'), 'logo.svg'], [devAssets.logo('dark'), 'logo-dark.svg'], [devAssets.mark(), 'mark.svg'], [devAssets.favicon(), 'icon/favicon.svg']] as const) {
    put(url, join(root, 'design', 'brand', name), 'brand');
  }
  for (const file of ONBOARDING_FILES) put(devAssets.onboarding(file), join(root, 'design', 'onboarding', 'fallback', file), 'onboarding');
  return map;
}

const write = (out: string, urlPath: string, html: string): string => {
  const file = urlPath === '/404.html' ? join(out, '404.html') : join(out, urlPath, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  return file;
};

export function generate(o: GenerateOptions): GenerateReport {
  const root = repoRoot();
  const out = resolve(o.out);
  const problems: string[] = [];
  const { catalogue, problems: catalogueProblems } = loadCatalogue({ fixtures: o.fixtures, requiredLangs: ['en'] });
  for (const p of catalogueProblems) problems.push(`${p.where}: ${p.message}`);
  if (problems.length) return { pages: [], assets: 0, problems };
  const games = catalogue.games;
  const assets = buildAssets(readManifest(out));
  const assetMap = copyAssets(out, games, root);
  const resolver = mappedAssets(assetMap);
  const pages: PageRecord[] = [];

  /** Which addresses exist for a route and parameters, per language. */
  const exists = (id: RouteId, params: Record<string, string>, lang: Lang): boolean => {
    if (lang === 'en') return true;
    if (id === 'game' || id === 'play') {
      const g = games.find((x) => x.seo.slug === params['slug']);
      return !!g && gameHasLanguage(g, lang);
    }
    return true;
  };

  const emit = (id: RouteId, params: Record<string, string>): void => {
    const langs = INDEXED_LANGS.filter((l) => exists(id, params, l));
    const paths = new Map(langs.map((l) => [l, router.href(id, { params, lang: l })] as const));
    for (const lang of langs) {
      const path = paths.get(lang) as string;
      const ctx = makeContext({ lang, games, url: path, assets: resolver, caps: SERVER_CAPABILITIES, server: true, ...(o.version ? { version: o.version } : {}) });
      const page = renderPage(ctx, router.match(path), EMPTY_STATE);
      if (page.status !== 200) { problems.push(`${path} did not render (${page.status})`); continue; }
      const alternates: Alternate[] = langs.length > 1 ? [...langs.map((l) => ({ lang: l, path: paths.get(l) as string })), { lang: 'x-default' as const, path: paths.get('en') as string }] : [{ lang, path }];
      const info = LANG_INFO.find((l) => l.code === lang);
      const html = renderDocument({
        lang, tag: info?.tag ?? lang, page, path, alternates, assets, resolver, noscript: ctx.i18n.t('common.noscript'), siteName: ctx.i18n.t('brand.name'), assetMap,
      });
      pages.push({ path, lang, route: id, indexable: !page.noindex, file: write(out, path, html) });
    }
  };

  emit('home', {});
  for (const region of REGION_ORDER) {
    if (games.some((g) => g.regions.includes(region) || (region === 'seated' && g.seated))) emit('region', { region });
  }
  for (const g of games) { emit('game', { slug: g.seo.slug }); emit('play', { slug: g.seo.slug }); }
  for (const id of ['plans', 'settings', 'pro', 'results', 'welcome'] as const) emit(id, {});

  // 404.html: what the host serves for an address that does not exist.
  {
    const lang: Lang = 'en';
    const ctx = makeContext({ lang, games, url: '/404/', assets: resolver, caps: SERVER_CAPABILITIES, server: true });
    const page = renderPage(ctx, null, EMPTY_STATE);
    const html = renderDocument({ lang, tag: 'en', page, path: '/404/', alternates: [], assets, resolver, noscript: ctx.i18n.t('common.noscript'), siteName: ctx.i18n.t('brand.name'), assetMap });
    write(out, '/404.html', html);
  }

  // sitemap.xml: indexable pages with their language alternates.
  const indexable = pages.filter((p) => p.indexable);
  const groups = new Map<string, PageRecord[]>();
  for (const p of indexable) {
    const key = p.lang === 'en' ? p.path : (router.withLang(p.path, 'en'));
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const url = (p: string): string => `${SITE_ORIGIN}${p}`;
  const entries = [...groups.entries()].map(([enPath, list]) => {
    const alts = list.length > 1
      ? [...list.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.lang}" href="${url(l.path)}"/>`), `    <xhtml:link rel="alternate" hreflang="x-default" href="${url(enPath)}"/>`].join('\n')
      : '';
    return list.map((l) => `  <url>\n    <loc>${url(l.path)}</loc>${alts ? `\n${alts}` : ''}\n  </url>`).join('\n');
  });
  writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`);
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);

  // Header rules (Cloudflare "_headers"): the hashed files never change; the camera is this site's alone.
  writeFileSync(join(out, '_headers'), [
    '/static/*', '  Cache-Control: public, max-age=31536000, immutable', '',
    '/vendor/*', '  Cache-Control: public, max-age=2592000', '',
    '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '  Permissions-Policy: camera=(self), microphone=(), geolocation=()', '',
  ].join('\n'));

  return { pages, assets: Object.keys(assetMap).length, problems };
}

// ---- command line ------------------------------------------------------------------------------------------------

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  const args = process.argv.slice(2);
  const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]; };
  const out = flag('out') ?? fileURLToPath(new URL('../dist', import.meta.url));
  const fixtures = (flag('fixtures') ?? process.env['BA_FIXTURES'] ?? 'none') as FixtureMode;
  const r = generate({ out, fixtures });
  for (const p of r.problems) console.error(`problem: ${p}`);
  console.log(`${r.pages.length} pages, ${r.assets} pictures, ${r.pages.filter((p) => p.indexable).length} in the sitemap, written to ${out}`);
  if (r.problems.length) process.exit(1);
}
