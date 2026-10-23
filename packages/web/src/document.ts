// The HTML document around a page: head tags for search engines and link previews, the stylesheet and the script of
// the build, and the page body. No inline scripts and no inline styles, so a strict Content-Security-Policy works.
import { escapeHtml, jsonForScript, type SafeHtml } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import type { AssetResolver } from './assets.ts';
import { SITE_ORIGIN, type Rendered } from './pages.ts';

export interface Alternate { lang: Lang | 'x-default'; path: string }

export interface BuildAssets {
  css: readonly string[];
  /** The entry script (a module). */
  js: string;
  /** Chunks the entry imports, loaded early. */
  modulePreload: readonly string[];
  /** woff2 files used above the fold. */
  fonts: readonly string[];
}

export interface DocumentInput {
  lang: Lang;
  /** BCP 47 tag for the html lang attribute. */
  tag: string;
  page: Rendered;
  /** The page's own path in its language, with the trailing slash. */
  path: string;
  alternates: readonly Alternate[];
  assets: BuildAssets;
  resolver: AssetResolver;
  /** The text of the no-script note. */
  noscript: string;
  siteName: string;
}

const OG_LOCALE: Readonly<Record<Lang, string>> = { en: 'en_US', tr: 'tr_TR', de: 'de_DE', es: 'es_ES', fr: 'fr_FR' };

const abs = (path: string): string => (/^https?:\/\//.test(path) ? path : `${SITE_ORIGIN}${path}`);
const e = escapeHtml;

export function renderDocument(d: DocumentInput): string {
  const { page, assets } = d;
  const canonical = abs(d.path);
  const image = page.image ? abs(page.image) : undefined;
  const head: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${e(page.title)}</title>`,
    `<meta name="description" content="${e(page.description)}">`,
    page.noindex ? '<meta name="robots" content="noindex, follow">' : '',
    page.noindex ? '' : `<link rel="canonical" href="${e(canonical)}">`,
    ...(page.noindex ? [] : d.alternates.map((a) => `<link rel="alternate" hreflang="${e(a.lang)}" href="${e(abs(a.path))}">`)),
    `<meta property="og:site_name" content="${e(d.siteName)}">`,
    `<meta property="og:title" content="${e(page.title)}">`,
    `<meta property="og:description" content="${e(page.description)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${e(canonical)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[d.lang]}">`,
    image ? `<meta property="og:image" content="${e(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    '<meta name="theme-color" content="#F4F2F8" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#1A1430" media="(prefers-color-scheme: dark)">',
    `<link rel="icon" href="${e(d.resolver.favicon())}" type="image/svg+xml">`,
    ...assets.fonts.map((f) => `<link rel="preload" href="${e(f)}" as="font" type="font/woff2" crossorigin>`),
    ...assets.css.map((c) => `<link rel="stylesheet" href="${e(c)}">`),
    ...assets.modulePreload.map((m) => `<link rel="modulepreload" href="${e(m)}">`),
    ...page.jsonLd.map((j) => `<script type="application/ld+json">${jsonForScript(j)}</script>`),
  ].filter(Boolean);
  const body = page.body as SafeHtml;
  return `<!doctype html>
<html lang="${e(d.tag)}">
<head>
${head.join('\n')}
</head>
<body>
<div id="app">${body.value}</div>
<noscript><p class="ba-noscript">${e(d.noscript)}</p></noscript>
<script type="module" src="${e(assets.js)}"></script>
</body>
</html>
`;
}
