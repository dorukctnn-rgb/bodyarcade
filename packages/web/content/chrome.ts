// The frame around every content page: head (title, canonical, language alternates, social preview, structured data), the top
// bar, the page head, the summary, the table of contents, the sections, the footer. One function turns a PageSpec into the whole
// HTML document, so the header and the footer of every page are the same and a link is changed in one place.
//
// The page texts are written as HTML in copy/*.ts (trusted source in this repository); only what a page puts into an attribute
// goes through esc().
import { COMPANY, EMAIL, SITE, type Lang } from './facts.ts';

export interface Crumb { name: string; url: string }
export interface Section { id: string; title: string; html: string }

export interface PageSpec {
  /** The file under site/: "privacy.html", "tr/privacy.html", "blog/index.html". */
  file: string;
  /** The address the file answers on: "/privacy", "/blog/". */
  url: string;
  lang: Lang;
  /** The <title> without the brand ("Privacy policy"); the brand is added. */
  title: string;
  description: string;
  h1: string;
  /** Under the title, one line ("Last updated 24 October 2026"). */
  when?: string;
  /** The first paragraph, HTML. */
  lead?: string;
  /** "In short": a heading and a list of HTML items before the detail. */
  brief?: { title: string; items: string[] };
  sections: Section[];
  /** Show the table of contents (default: when there are four sections or more). */
  toc?: boolean;
  /** HTML after the last section, inside the reading column (a call to play). */
  after?: string;
  crumbs: Crumb[];
  /** The same page in the other language, when there is one. */
  other?: { lang: Lang; url: string };
  /** Which item of the top bar to light. */
  nav?: 'faq' | 'blog';
  /** Extra structured data (Article, FAQPage), as plain objects. */
  jsonLd?: object[];
  /** The social preview type. */
  og?: 'website' | 'article';
}

/** Escapes text for an attribute or a text node. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Words {
  html: string;
  skip: string;
  navLabel: string;
  nav: { games: [string, string]; pro: [string, string]; faq: [string, string]; blog: [string, string] | null };
  play: string;
  toc: string;
  crumbs: string;
  made: string;
  camera: string;
  privacy: string;
  terms: string;
  faq: string;
  contact: string;
  language: string;
  otherName: string;
  home: string;
  locale: string;
  studio: string;
}

const WORDS: Readonly<Record<Lang, Words>> = {
  en: {
    html: 'en', skip: 'Skip to content', navLabel: 'Main navigation',
    nav: { games: ['Games', '/'], pro: ['Pro', '/pro/'], faq: ['FAQ', '/faq'], blog: ['Blog', '/blog/'] },
    play: 'Play a game', toc: 'On this page', crumbs: 'Breadcrumb',
    made: `BodyArcade is made by ${COMPANY}.`, camera: 'Camera video is read on your device and never recorded.',
    privacy: 'Privacy', terms: 'Terms', faq: 'FAQ', contact: 'Contact', language: 'Language', otherName: 'Türkçe', home: 'BodyArcade home', locale: 'en_US',
    studio: COMPANY,
  },
  tr: {
    html: 'tr', skip: 'İçeriğe geç', navLabel: 'Ana gezinme',
    nav: { games: ['Oyunlar', '/tr/'], pro: ['Pro', '/tr/pro/'], faq: ['SSS', '/tr/faq'], blog: null },
    play: 'Bir oyun oyna', toc: 'Bu sayfada', crumbs: 'Sayfa yolu',
    made: `BodyArcade, ${COMPANY} tarafından yapılır.`, camera: 'Kamera görüntüsü cihazında okunur, hiçbir zaman kaydedilmez.',
    privacy: 'Gizlilik', terms: 'Koşullar', faq: 'SSS', contact: 'İletişim', language: 'Dil', otherName: 'English', home: 'BodyArcade ana sayfa', locale: 'tr_TR',
    studio: COMPANY,
  },
};

const PAGES: Readonly<Record<Lang, { privacy: string; terms: string; faq: string }>> = {
  en: { privacy: '/privacy', terms: '/terms', faq: '/faq' },
  tr: { privacy: '/tr/privacy', terms: '/tr/terms', faq: '/tr/faq' },
};

/** The picture every content page shows when a link to it is shared (the Play feature graphic: 1024 by 500). */
export const OG_IMAGE = { file: 'og.png', width: 1024, height: 500 } as const;

function logo(w: Words): string {
  return `<a class="brand" href="${w.nav.games[1]}" aria-label="${esc(w.home)}"><img class="logo-light" src="/assets/brand/logo.svg" alt="BodyArcade" width="157" height="28"><img class="logo-dark" src="/assets/brand/logo-dark.svg" alt="" aria-hidden="true" width="157" height="28"></a>`;
}

function header(spec: PageSpec, w: Words): string {
  const items: [string, string, boolean][] = [
    [w.nav.games[0], w.nav.games[1], false],
    [w.nav.pro[0], w.nav.pro[1], false],
    [w.nav.faq[0], w.nav.faq[1], spec.nav === 'faq'],
  ];
  if (w.nav.blog) items.push([w.nav.blog[0], w.nav.blog[1], spec.nav === 'blog']);
  const links = items.map(([name, href, on]) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${esc(name)}</a>`).join('');
  const o = spec.other;
  const ow = o ? WORDS[o.lang] : null;
  const lang = o && ow ? `<a class="lang" href="${o.url}" hreflang="${o.lang}" lang="${o.lang}">${esc(WORDS[spec.lang].otherName)}</a>` : '';
  return `<header class="top"><div class="top-in">${logo(w)}<nav class="nav" aria-label="${esc(w.navLabel)}">${links}</nav>${lang}<a class="btn btn--sm play" href="${w.nav.games[1]}">${esc(w.play)}</a></div></header>`;
}

function footer(spec: PageSpec, w: Words): string {
  const p = PAGES[spec.lang];
  const o = spec.other;
  const langs = o
    ? `<ul aria-label="${esc(w.language)}"><li><a href="${spec.lang === 'en' ? spec.url : o.url}" hreflang="en" lang="en"${spec.lang === 'en' ? ' aria-current="true"' : ''}>English</a></li><li><a href="${spec.lang === 'tr' ? spec.url : o.url}" hreflang="tr" lang="tr"${spec.lang === 'tr' ? ' aria-current="true"' : ''}>Türkçe</a></li></ul>`
    : '';
  return `<footer class="foot"><div class="foot-in"><p>${esc(w.made)} ${esc(w.camera)}</p><ul><li><a href="${p.privacy}">${esc(w.privacy)}</a></li><li><a href="${p.terms}">${esc(w.terms)}</a></li><li><a href="${p.faq}">${esc(w.faq)}</a></li><li><a href="mailto:${EMAIL}">${esc(w.contact)}</a></li></ul>${langs}</div></footer>`;
}

function crumbs(spec: PageSpec, w: Words): string {
  const items = spec.crumbs.map((c, i) => (i === spec.crumbs.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.url}">${esc(c.name)}</a></li>`)).join('');
  return `<nav class="crumbs" aria-label="${esc(w.crumbs)}"><ol>${items}</ol></nav>`;
}

function tocLinks(sections: readonly Section[]): string {
  return sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('');
}

function head(spec: PageSpec, w: Words): string {
  const url = `${SITE}${spec.url}`;
  const title = `${spec.title} | BodyArcade`;
  const alt: string[] = [];
  if (spec.other) {
    const en = spec.lang === 'en' ? spec.url : spec.other.url;
    const tr = spec.lang === 'tr' ? spec.url : spec.other.url;
    alt.push(`<link rel="alternate" hreflang="en" href="${SITE}${en}">`, `<link rel="alternate" hreflang="tr" href="${SITE}${tr}">`, `<link rel="alternate" hreflang="x-default" href="${SITE}${en}">`);
  }
  const og = `${SITE}/assets/brand/${OG_IMAGE.file}`;
  const crumbLd = { '@type': 'BreadcrumbList', itemListElement: spec.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${SITE}${c.url}` })) };
  const ld = { '@context': 'https://schema.org', '@graph': [...(spec.jsonLd ?? []), crumbLd] };
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(spec.description)}">`,
    `<link rel="canonical" href="${url}">`,
    ...alt,
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" content="#F4F2F8" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#1A1430" media="(prefers-color-scheme: dark)">',
    `<meta property="og:type" content="${spec.og ?? 'website'}">`,
    '<meta property="og:site_name" content="BodyArcade">',
    `<meta property="og:locale" content="${w.locale}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(spec.description)}">`,
    `<meta property="og:image" content="${og}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${og}">`,
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="stylesheet" href="/assets/content.css">',
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  ].join('\n');
}

/** The whole HTML document of a page. */
export function renderPage(spec: PageSpec): string {
  const w = WORDS[spec.lang];
  const showToc = spec.toc ?? spec.sections.length >= 4;
  const sections = spec.sections.map((s) => `<section id="${s.id}" aria-labelledby="${s.id}-h"><h2 id="${s.id}-h">${s.title}</h2>\n${s.html}\n</section>`).join('\n');
  const brief = spec.brief
    ? `<section class="brief" aria-labelledby="brief-h"><h2 id="brief-h">${spec.brief.title}</h2><ul>${spec.brief.items.map((i) => `<li>${i}</li>`).join('')}</ul></section>`
    : '';
  const tocTop = showToc ? `<details class="toc-top"><summary>${esc(w.toc)}</summary><ol>${tocLinks(spec.sections)}</ol></details>` : '';
  const tocSide = showToc ? `<nav class="toc-side" aria-label="${esc(w.toc)}"><h2>${esc(w.toc)}</h2><ol>${tocLinks(spec.sections)}</ol></nav>` : '';
  const body = `<div class="body">\n${sections}\n${spec.after ?? ''}\n</div>`;
  return [
    '<!doctype html>',
    `<html lang="${w.html}">`,
    '<head>',
    head(spec, w),
    '</head>',
    '<body>',
    `<a class="skip" href="#main">${esc(w.skip)}</a>`,
    header(spec, w),
    `<main id="main" class="page ${showToc ? 'page--rail' : 'page--solo'}">`,
    tocSide,
    crumbs(spec, w),
    `<div class="head"><h1>${spec.h1}</h1>${spec.when ? `<p class="when">${spec.when}</p>` : ''}${spec.lead ? `<p class="lead">${spec.lead}</p>` : ''}</div>`,
    brief,
    tocTop,
    body,
    '</main>',
    footer(spec, w),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ───────── small pieces the page texts use ─────────

export interface Col { head: string; label?: string }

/** A table: `heads` are the column headings (also the labels of the cells on a phone); the first cell of a row is its row heading. */
export function table(caption: string | null, heads: readonly string[], rows: readonly (readonly string[])[]): string {
  const th = heads.map((h) => `<th scope="col">${h}</th>`).join('');
  const tr = rows.map((r) => {
    const [first, ...rest] = r;
    return `<tr><th scope="row">${first ?? ''}</th>${rest.map((c, i) => `<td data-label="${esc(stripTags(heads[i + 1] ?? ''))}">${c}</td>`).join('')}</tr>`;
  }).join('');
  const title = caption ? `<h3 class="tbl-title">${caption}</h3>` : '';
  return `${title}<table class="tbl"${caption ? ` aria-label="${esc(stripTags(caption))}"` : ''}><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** An unordered list of HTML items. */
export function ul(items: readonly string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

export function ol(items: readonly string[]): string {
  return `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
}

/** A callout: a bold first line and a paragraph. */
export function note(title: string, html: string): string {
  return `<div class="note"><p><strong>${title}</strong></p><p>${html}</p></div>`;
}

/** A question that opens to its answer (a few paragraphs of HTML). */
export function qa(q: string, answer: string): string {
  return `<details class="qa"><summary>${q}</summary><div>${answer}</div></details>`;
}

export const mail = (text: string = EMAIL): string => `<a href="mailto:${EMAIL}">${text}</a>`;
export const link = (href: string, text: string): string => `<a href="${href}">${text}</a>`;

/** A call to play: one sentence and the one button. */
export const cta = (text: string, href: string, label: string): string => `<div class="cta"><p>${text}</p><a class="btn" href="${href}">${esc(label)}</a></div>`;

/** schema.org FAQPage from the same questions and answers the page shows (the markup is taken out of the answers). */
export function faqLd(items: readonly { q: string; a: string }[]): object {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({ '@type': 'Question', name: stripTags(i.q), acceptedAnswer: { '@type': 'Answer', text: stripTags(i.a).replace(/\s+/g, ' ').trim() } })),
  };
}

/** schema.org Article for a guide or a post. Dates are ISO days. */
export function articleLd(o: { headline: string; description: string; url: string; published: string; modified: string; lang: Lang }): object {
  return {
    '@type': 'Article',
    headline: o.headline,
    description: o.description,
    inLanguage: o.lang,
    mainEntityOfPage: `${SITE}${o.url}`,
    datePublished: o.published,
    dateModified: o.modified,
    author: { '@type': 'Organization', name: COMPANY },
    publisher: { '@type': 'Organization', name: COMPANY },
    image: `${SITE}/assets/brand/${OG_IMAGE.file}`,
  };
}
