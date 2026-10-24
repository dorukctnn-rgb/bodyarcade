// Puts the release folder together from the web app's build (packages/web/dist) and the live site's content pages
// (site/), then writes the files that belong to the whole site: header rules, redirects, robots.txt, the sitemap with
// the content pages, the web app manifest, the icons, the service worker and a build stamp. Checks the result.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { GAME_ALIASES } from '../packages/server/src/site/routes.ts';
import {
  CANONICAL_ORIGIN, STATIC_REDIRECTS, headersFile, injectHead, mergeSitemap, precacheList, redirectsFile, robotsFile,
  serviceWorkerSource, webManifest, type SitemapEntry, type Target,
} from './site.ts';
import { MEDIAPIPE_VERSION } from '../packages/core/pose/assets.ts';

/** The live site's content pages that keep their addresses (the old landing and game page give way to the app). */
export const LEGACY_PAGES: readonly { file: string; url: string }[] = [
  { file: 'webcam-fitness-games.html', url: '/webcam-fitness-games' },
  { file: 'ring-fit-adventure-alternative.html', url: '/ring-fit-adventure-alternative' },
  { file: 'blog/index.html', url: '/blog/' },
  { file: 'blog/why-browser-fitness-games-are-the-future.html', url: '/blog/why-browser-fitness-games-are-the-future' },
  { file: 'privacy.html', url: '/privacy' },
  { file: 'terms.html', url: '/terms' },
];

/** Other files of the live site that keep their addresses: the content pages' styles, fonts and pictures, the IndexNow key. */
const LEGACY_FILES: readonly string[] = ['assets', '06bb4e63d6d4983eed0ac457e2d4a483.txt', 'og-image.png'];

/** The new brand's icons, at the addresses browsers and the old pages ask for. */
const ICONS: readonly [string, string][] = [
  ['design/brand/png/web/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['design/brand/png/web/favicon-32.png', 'favicon-32.png'],
  ['design/brand/png/web/favicon.ico', 'favicon.ico'],
  ['design/brand/png/web/icon-192.png', 'icon-192.png'],
  ['design/brand/png/web/icon-512.png', 'icon-512.png'],
  ['design/brand/png/web/icon-maskable-512.png', 'icon-maskable-512.png'],
];

/** What the site must contain whatever else changes. */
export const MUST_HAVE: readonly string[] = [
  'index.html', 'tr/index.html', '404.html', 'sitemap.xml', 'robots.txt', '_headers', '_redirects', 'manifest.json', 'sw.js', 'sw-register.js',
  'version.json', '.well-known/assetlinks.json', '06bb4e63d6d4983eed0ac457e2d4a483.txt', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
  ...LEGACY_PAGES.map((p) => p.file),
];

export interface AssembleOptions {
  root: string;
  /** The web app's build (vite + page generator). */
  web: string;
  out: string;
  target: Target;
}

export interface AssembleReport {
  build: string;
  commit: string;
  files: number;
  bytes: number;
  precache: number;
  appPages: number;
  problems: string[];
  warnings: string[];
}

const walk = (dir: string, base = dir): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p, base) : [`/${relative(base, p).split(sep).join('/')}`];
});

const git = (root: string, args: string[]): string => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};

export function assemble(o: AssembleOptions): AssembleReport {
  const { root, web, out, target } = o;
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!existsSync(join(web, 'index.html'))) throw new Error(`no web build in ${web}: run node packages/web/tools/build.ts first`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // 1. The app: every page, script, style and picture of the web build, without its own rules and its source maps.
  const skip = (rel: string): boolean => rel === '/_headers' || rel === '/robots.txt' || rel.startsWith('/.vite/') || rel.endsWith('.map');
  const appFiles = walk(web).filter((f) => !skip(f));
  for (const f of appFiles) {
    const to = join(out, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(web, f), to);
  }
  const appPages = appFiles.filter((f) => f.endsWith('.html'));
  for (const f of appPages) {
    const p = join(out, f);
    writeFileSync(p, injectHead(readFileSync(p, 'utf8')));
  }

  // 2. The live site's content pages and their files.
  const site = join(root, 'site');
  for (const { file } of LEGACY_PAGES) {
    const to = join(out, file);
    if (existsSync(to)) problems.push(`the app and the old site both have ${file}`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(site, file), to);
  }
  for (const f of LEGACY_FILES) cpSync(join(site, f), join(out, f), { recursive: true });

  // 3. Icons, Digital Asset Links, the manifest.
  for (const [from, to] of ICONS) copyFileSync(join(root, from), join(out, to));
  cpSync(join(root, 'release', 'static'), out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), webManifest());

  // 4. Site-wide rules.
  writeFileSync(join(out, '_headers'), headersFile(target));
  writeFileSync(join(out, '_redirects'), redirectsFile());
  writeFileSync(join(out, 'robots.txt'), robotsFile(target));
  const extra: SitemapEntry[] = LEGACY_PAGES.map((p) => {
    const lastmod = git(root, ['log', '-1', '--format=%cs', '--', `site/${p.file}`]);
    return { loc: `${CANONICAL_ORIGIN}${p.url}`, ...(lastmod ? { lastmod } : {}) };
  });
  writeFileSync(join(out, 'sitemap.xml'), mergeSitemap(readFileSync(join(web, 'sitemap.xml'), 'utf8'), extra));

  // 5. The service worker, from what is now in the folder. The build id is a hash of the content, so the same
  //    content gives the same worker (no needless update for players) and any change gives a new one.
  const files = walk(out).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
  const build = hash.digest('hex').slice(0, 12);
  const startPages: Record<string, string> = { en: '/' };
  for (const f of appPages) {
    const m = /^\/([a-z]{2})\/index\.html$/.exec(f);
    if (m && m[1]) startPages[m[1]] = `/${m[1]}/`;
  }
  const precache = precacheList(files, Object.values(startPages));
  writeFileSync(join(out, 'sw.js'), serviceWorkerSource(readFileSync(join(root, 'release', 'sw.template.js'), 'utf8'), {
    build, precache, startPages, libPrefixes: ['/vendor/mediapipe/'], libCache: `ba-lib-mediapipe-${MEDIAPIPE_VERSION}`, navTimeoutMs: 3500,
  }));
  copyFileSync(join(root, 'release', 'sw-register.js'), join(out, 'sw-register.js'));
  const commit = git(root, ['rev-parse', '--short=10', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']) !== '';
  writeFileSync(join(out, 'version.json'), `${JSON.stringify({ build, commit: commit + (dirty ? '-dirty' : ''), target: target.id, builtAt: new Date().toISOString() })}\n`);

  // 6. Checks: the must-have files, the size limit of one asset, and every link of every page.
  const final = walk(out);
  const have = new Set(final);
  for (const f of MUST_HAVE) if (!have.has(`/${f}`)) problems.push(`missing ${f}`);
  let bytes = 0;
  for (const f of final) {
    const size = statSync(join(out, f)).size;
    bytes += size;
    if (size > 25 * 1024 * 1024) problems.push(`${f} is over the 25 MiB limit of one Workers asset`);
  }
  if (final.length > 19_000) problems.push(`${final.length} files: close to the 20,000 asset limit`);
  const links = checkLinks(out, final);
  problems.push(...links.broken);
  warnings.push(...links.redirected);
  return { build, commit, files: final.length, bytes, precache: precache.length, appPages: appPages.length, problems, warnings };
}

/** How the asset layer answers a path (html_handling auto-trailing-slash): a file, a redirect to the canonical form, or nothing. */
export function resolvePath(have: ReadonlySet<string>, path: string): 'ok' | 'redirect' | 'missing' {
  if (path.endsWith('/')) {
    if (have.has(`${path}index.html`)) return 'ok';
    if (path !== '/' && have.has(`${path.slice(0, -1)}.html`)) return 'redirect';
    return 'missing';
  }
  if (have.has(`${path}.html`)) return 'ok';
  if (have.has(path)) return path.endsWith('.html') ? 'redirect' : 'ok';
  if (have.has(`${path}/index.html`)) return 'redirect';
  return 'missing';
}

/** Every root-relative href and src in every page: it must be a file, a redirect of ours, or a Worker route. */
export function checkLinks(out: string, files: readonly string[]): { broken: string[]; redirected: string[] } {
  const have = new Set(files);
  const redirects = new Map<string, string>(STATIC_REDIRECTS.filter(([from]) => !from.includes('*')).map(([from, to]) => [decodeURI(from), to]));
  const aliases = new Set(GAME_ALIASES.flatMap((a) => [a, `${a}/`]));
  const broken: string[] = [];
  const redirected: string[] = [];
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(join(out, f), 'utf8');
    for (const m of html.matchAll(/\b(?:href|src)="(\/(?!\/)[^"#?]*)/g)) {
      const path = decodeURI(m[1] as string);
      if (path.startsWith('/api/')) continue;
      if (aliases.has(path) || redirects.has(path)) { redirected.push(`${f} links to ${path} (a 301)`); continue; }
      const r = resolvePath(have, path);
      if (r === 'missing') broken.push(`${f} links to ${path}, which does not exist`);
      else if (r === 'redirect') redirected.push(`${f} links to ${path} (answered with a redirect)`);
    }
  }
  return { broken: [...new Set(broken)], redirected: [...new Set(redirected)] };
}
