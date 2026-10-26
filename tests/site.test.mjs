// Static checks on what is published from site/: node --test tests/site.test.mjs
// Covers 23 Oct 2026 audit items B19 (the Ring Fit page's honest comparison), SEO-2 and SEO-4 (sitemap dates,
// 404 page), B18 (button contrast), the CSP header, and version strings that must move together.
// In v2 the release publishes the content pages of site/ (release/assemble.ts LEGACY_PAGES) beside the app; the v1
// start page, sitemap and service worker of site/ stay in the folder but are not published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LEGACY_PAGES } from '../release/assemble.ts';
import { CANONICAL_ORIGIN, mergeSitemap } from '../release/site.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SITE = path.join(ROOT, 'site');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const files = walk(SITE);
const pages = files.filter((f) => f.endsWith('.html'));
const rel = (f) => path.relative(SITE, f).replace(/\\/g, '/');

// ── versions that must move together (audit P4) ──
test('every ?v= in the pages and the service worker version are the same string', () => {
  const sw = read(SITE, 'sw.js').match(/^const VERSION = '([^']+)'/m)[1];
  const seen = new Set();
  for (const f of pages) for (const m of read(f).matchAll(/\?v=([\w.]+)/g)) { seen.add(m[1]); assert.equal(m[1], sw, `${rel(f)} has ?v=${m[1]}`); }
  assert.ok(seen.size === 1, 'at least one ?v= found');
});

// ── B19, v1's rule "nothing may promise live races, lobbies or other players": retired on 26 Oct 2026. v2 has them (online
// rooms of two to four players, lobbies, races with friends), the FAQ and the privacy page describe them, and
// packages/web/content/content.test.ts ("live play is the code") holds what those pages say to the room server's code.

// ── B19: the Ring Fit page stays an honest comparison (v2 content, English and Turkish) ──
test('B19: the Ring Fit page and its Turkish twin give each side its strengths', () => {
  for (const [file, theirs, ours] of [
    ['ring-fit-adventure-alternative.html', 'Where Ring Fit Adventure is stronger', 'Where BodyArcade is stronger'],
    ['tr/ring-fit-adventure-alternatifi.html', 'Ring Fit Adventure’ın daha güçlü olduğu yerler', 'BodyArcade’ın daha güçlü olduğu yerler'],
  ]) {
    const t = read(SITE, file);
    for (const [id, heading] of [['ringfit-h', theirs], ['bodyarcade-h', ours]]) {
      const at = t.indexOf(`<h2 id="${id}">${heading}</h2>`);
      assert.ok(at >= 0, `${file}: "${heading}"`);
      const next = t.indexOf('<h2', at + 4);
      const items = (t.slice(at, next < 0 ? undefined : next).match(/<li[ >]/g) || []).length;
      assert.ok(items >= 3, `${file}: "${heading}" lists ${items} points`);
    }
    assert.match(t, /"dateModified":\s*"\d{4}-\d{2}-\d{2}"/, `${file}: dateModified`);
  }
});

// ── 404 page (SEO-4) ──
test('404.html exists, is not indexable, links onwards with root-relative paths and is not in the sitemap', () => {
  const t = read(SITE, '404.html');
  assert.match(t, /<title>Page not found \| BodyArcade<\/title>/);
  assert.match(t, /<meta name="robots" content="noindex">/);
  assert.match(t, /href="\/bodyarcade"/);
  assert.match(t, /href="\/"/);
  for (const m of t.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(/^(\/|https?:|mailto:|#)/.test(m[1]), `404.html uses a relative URL: ${m[1]}`);
  assert.doesNotMatch(read(SITE, 'sitemap.xml'), /404/);
});

// ── sitemap (SEO-2), v2: the release publishes the app's sitemap (packages/web/generator, tested there) with the content pages
// added by release/assemble.ts, each with the date of its last commit. site/sitemap.xml is v1's and is not published.
test('the published sitemap lists every indexable content page once, with real dates', () => {
  const listed = new Set(LEGACY_PAGES.map((p) => p.file));
  assert.equal(listed.size, LEGACY_PAGES.length, 'no content page twice');
  for (const f of pages) {
    const t = read(f);
    if (/<meta name="robots" content="[^"]*noindex/.test(t)) { assert.ok(!listed.has(rel(f)), `${rel(f)} is noindex and published for the sitemap`); continue; }
    // v1's start page: the app's start page has its address (/), and the release does not take it
    if (rel(f) === 'index.html') continue;
    assert.ok(listed.has(rel(f)), `${rel(f)} is indexable but the release leaves it out of the sitemap`);
  }
  const entries = LEGACY_PAGES.map(({ file, url }) => {
    const t = read(SITE, file);
    const loc = `${CANONICAL_ORIGIN}${url}`;
    assert.ok(t.includes(`<link rel="canonical" href="${loc}">`), `${file}: canonical ${loc}`);
    // the date release/assemble.ts writes as lastmod
    const lastmod = execFileSync('git', ['log', '-1', '--format=%cs', '--', `site/${file}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/, `${file}: the date of its last commit`);
    const modified = t.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})"/);
    if (modified) assert.ok(lastmod >= modified[1], `${loc}: lastmod ${lastmod} is older than the page's own dateModified ${modified[1]}`);
    return { loc, lastmod };
  });
  const app = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CANONICAL_ORIGIN}/</loc>
  </url>
</urlset>
`;
  const xml = mergeSitemap(app, entries);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, 'no address twice');
  for (const e of entries) assert.ok(xml.includes(`<loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>`), e.loc);
});

// ── B18: white text on the orange buttons ──
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const vars = (css) => Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s*;/g)].map((m) => [m[1], m[2].length === 4 ? '#' + [...m[2].slice(1)].map((d) => d + d).join('') : m[2].toLowerCase()]));
const resolve = (v, tokens) => { v = v.trim(); const m = v.match(/^var\(--([\w-]+)\)$/); if (m) return tokens[m[1]] || null; if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase(); if (/^#fff$/i.test(v) || v === 'white') return '#ffffff'; return null; };
const isOrange = (hex) => { const n = parseInt(hex.slice(1), 16); const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255]; return r > 170 && g < 120 && b < 70; };

for (const css of [['assets', 'ba.css']]) {
  test(`B18: ${css[1]}: every orange fill with a lighter label reaches 4.5:1, including hover`, () => {
    const text = read(SITE, ...css);
    const tokens = vars(text);
    let checked = 0;
    for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      const bg = body.match(/(?:^|[;\s])background(?:-color)?:\s*([^;]+)/);
      const fg = body.match(/(?:^|[;\s])color:\s*([^;]+)/);
      if (!bg || !fg) continue;
      const b = resolve(bg[1], tokens), f = resolve(fg[1], tokens);
      if (!b || !f || !isOrange(b)) continue;
      checked++;
      assert.ok(contrast(f, b) >= 4.5, `${m[1].trim()}: ${f} on ${b} is ${contrast(f, b).toFixed(2)}:1`);
    }
    assert.ok(checked >= 1, 'found the .btn-play rule');
    const hover = text.match(/\.btn-play:hover\s*\{([^}]*)\}/)[1].match(/background:\s*([^;]+)/)[1];
    assert.equal(resolve(hover, tokens), tokens['signal-btn-hover'], 'the hover fill is the token that was checked');
    assert.ok(contrast('#ffffff', tokens['signal-btn']) >= 4.5);
    assert.ok(contrast('#ffffff', tokens['signal-btn-hover']) >= 4.5);
    assert.notEqual(tokens['signal-btn'], '#ff4f24', 'the brand orange itself is not used behind white text');
  });
}

test('B18b: small orange text on the paper colours reaches 4.5:1', () => {
  const site = vars(read(SITE, 'assets', 'ba.css'));
  const ba = read(SITE, 'assets', 'ba.css');
  assert.ok(contrast(site['signal-text'], site['paper']) >= 4.5, 'orange text on paper');
  assert.ok(contrast(site['signal-text'], site['paper-2']) >= 4.5, 'orange text on paper-2');
  assert.match(ba, /\.kicker \{[^}]*color: var\(--signal-text\)/);
  assert.match(ba, /\.on-ink \.kicker \{ color: var\(--signal\); \}/, 'the bright orange stays on dark sections');
});

// ── CSP in report-only mode ──
const toml = read(ROOT, 'netlify.toml');
const csp = (toml.match(/^\s*Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/m) || [])[1];
const directives = Object.fromEntries((csp || '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([n, ...v]) => [n, v]));

test('the Content-Security-Policy is report-only, and nothing enforces one yet', () => {
  assert.ok(csp, 'netlify.toml has Content-Security-Policy-Report-Only');
  assert.doesNotMatch(toml, /^\s*Content-Security-Policy\s*=/m);
  for (const d of ['default-src', 'script-src', 'connect-src', 'object-src', 'base-uri', 'frame-ancestors']) assert.ok(directives[d], d);
  assert.deepEqual(directives['object-src'], ["'none'"]);
});

test('CSP: every inline script is allowed by hash and every external script, request and import by origin', () => {
  const scriptSrc = directives['script-src'];
  for (const f of pages) {
    for (const m of read(f).matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/ld\+json/.test(m[1])) continue;
      const hash = `'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`;
      assert.ok(scriptSrc.includes(hash), `${rel(f)}: inline script ${JSON.stringify(m[2].slice(0, 60))} needs ${hash} in script-src`);
    }
    for (const m of read(f).matchAll(/<script[^>]*\bsrc="(https?:\/\/[^"]+)"/g)) assert.ok(scriptSrc.includes(new URL(m[1]).origin), `${rel(f)}: ${m[1]}`);
  }
  const origins = (src) => [...src.matchAll(/https:\/\/[\w.-]+/g)].map((m) => m[0]);
  const pose = read(SITE, 'game', 'pose.js');
  for (const o of new Set(origins(pose))) {
    assert.ok(directives['connect-src'].includes(o), `pose.js reaches ${o}: connect-src`);
    if (/import\(/.test(pose) && /vision_bundle/.test(pose)) assert.ok(scriptSrc.includes(o) || o === 'https://storage.googleapis.com', `pose.js imports from ${o}: script-src`);
  }
  for (const o of new Set(origins(read(SITE, 'game', 'store.js')).filter((x) => /api\./.test(x)))) assert.ok(directives['connect-src'].includes(o), `store.js calls ${o}`);
  assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"), 'the pose model needs WebAssembly');
});
