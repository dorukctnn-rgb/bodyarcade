// Static checks on what is published from site/: node --test tests/site.test.mjs
// Covers 23 Oct 2026 audit items B19 (a false claim about live lobbies), SEO-2 and SEO-4 (sitemap dates,
// 404 page), B18 (button contrast), the CSP header, and version strings that must move together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SITE = path.join(ROOT, 'site');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const files = walk(SITE);
const pages = files.filter((f) => f.endsWith('.html'));
const rel = (f) => path.relative(SITE, f).replace(/\\/g, '/');

// ── versions that must move together (audit P4) ──
test('every ?v= in the pages, the game version and the service worker version are the same string', () => {
  const sw = read(SITE, 'sw.js').match(/^const VERSION = '([^']+)'/m)[1];
  const app = read(SITE, 'game', 'app.js').match(/^const VERSION = '([^']+)'/m)[1];
  assert.equal(app, sw, 'game/app.js VERSION and sw.js VERSION');
  const seen = new Set();
  for (const f of pages) for (const m of read(f).matchAll(/\?v=([\w.]+)/g)) { seen.add(m[1]); assert.equal(m[1], sw, `${rel(f)} has ?v=${m[1]}`); }
  assert.ok(seen.size === 1, 'at least one ?v= found');
});

// ── B19: nothing may promise live races, lobbies or other players ──
test('B19: no page or script promises live lobbies, live races or other players on a course', () => {
  const banned = [/live lobb/i, /lobbies/i, /up to \d+ players/i, /players on the same course/i, /every 5 minutes/i, /run the same course/i, /racing other people/i];
  // Two places may say "live race", and only to say there is none: the privacy page and the game's own toast.
  const mayNegate = new Set(['privacy.html', 'game/app.js']);
  for (const f of files.filter((x) => /\.(html|js|json|txt|xml)$/.test(x) && !x.includes(`${path.sep}vendor${path.sep}`))) {
    const text = read(f);
    for (const re of banned) assert.doesNotMatch(text, re, `${rel(f)} matches ${re}`);
    if (!mayNegate.has(rel(f))) assert.doesNotMatch(text, /live races?/i, `${rel(f)} mentions live races`);
  }
  assert.match(read(SITE, 'privacy.html'), /no live race server/);
  assert.match(read(SITE, 'game', 'app.js'), /Live races are offline for now/);
});

test('B19: the Ring Fit page still compares honestly and no longer lists racing', () => {
  const t = read(SITE, 'ring-fit-adventure-alternative.html');
  assert.match(t, /Where BodyArcade is stronger/);
  assert.match(t, /Challenge links: send a friend your score and they try to beat it in the same world and difficulty/);
  assert.ok(t.match(/"dateModified": "(\d{4}-\d{2}-\d{2})"/)[1] >= '2026-10-23', 'dateModified is the date of the edit that removed the claim, or later');
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

// ── sitemap (SEO-2) ──
test('the sitemap lists every indexable page once, with real dates', () => {
  const xml = read(SITE, 'sitemap.xml');
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] }));
  assert.equal(new Set(urls.map((u) => u.loc)).size, urls.length, 'no duplicates');
  const today = new Date().toISOString().slice(0, 10);
  const canonicals = new Map();
  for (const f of pages) {
    const t = read(f);
    if (/<meta name="robots" content="[^"]*noindex/.test(t)) continue;
    const c = t.match(/<link rel="canonical" href="([^"]+)"/);
    assert.ok(c, `${rel(f)} has a canonical link`);
    canonicals.set(c[1], { file: f, text: t });
  }
  assert.deepEqual([...canonicals.keys()].sort(), urls.map((u) => u.loc).sort(), 'sitemap = the indexable pages');
  for (const u of urls) {
    assert.match(u.lastmod, /^\d{4}-\d{2}-\d{2}$/, u.loc);
    assert.ok(u.lastmod <= today, `${u.loc} lastmod ${u.lastmod} is in the future`);
    const modified = canonicals.get(u.loc).text.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})"/);
    if (modified) assert.ok(u.lastmod >= modified[1], `${u.loc}: lastmod ${u.lastmod} is older than the page's own dateModified ${modified[1]}`);
  }
  // the two pages edited for B19 and the game fixes carry the date of that edit (or a later one)
  for (const loc of ['https://bodyarcade.com/bodyarcade', 'https://bodyarcade.com/ring-fit-adventure-alternative']) assert.ok(urls.find((u) => u.loc === loc).lastmod >= '2026-10-23', loc);
});

// ── B18: white text on the orange buttons ──
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const vars = (css) => Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s*;/g)].map((m) => [m[1], m[2].length === 4 ? '#' + [...m[2].slice(1)].map((d) => d + d).join('') : m[2].toLowerCase()]));
const resolve = (v, tokens) => { v = v.trim(); const m = v.match(/^var\(--([\w-]+)\)$/); if (m) return tokens[m[1]] || null; if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase(); if (/^#fff$/i.test(v) || v === 'white') return '#ffffff'; return null; };
const isOrange = (hex) => { const n = parseInt(hex.slice(1), 16); const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255]; return r > 170 && g < 120 && b < 70; };

for (const css of [['assets', 'ba.css'], ['game', 'ui.css']]) {
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

test('B18b: small orange text on the paper colours and the dimmed game labels reach 4.5:1', () => {
  const site = vars(read(SITE, 'assets', 'ba.css'));
  const ba = read(SITE, 'assets', 'ba.css');
  assert.ok(contrast(site['signal-text'], site['paper']) >= 4.5, 'orange text on paper');
  assert.ok(contrast(site['signal-text'], site['paper-2']) >= 4.5, 'orange text on paper-2');
  assert.match(ba, /\.kicker \{[^}]*color: var\(--signal-text\)/);
  assert.match(ba, /\.on-ink \.kicker \{ color: var\(--signal\); \}/, 'the bright orange stays on dark sections');
  const ui = read(SITE, 'game', 'ui.css');
  const game = vars(ui);
  const locked = ui.match(/\.seg button\.locked \{ color: (#[0-9a-f]{6})/i)[1];
  assert.ok(contrast(locked, game['ink-2']) >= 4.5, `locked difficulty ${locked} on ink-2`);
  const small = ui.match(/\.steps li small \{[^}]*color: (#[0-9a-f]{6})/i)[1];
  assert.ok(contrast(small, game['ink']) >= 4.5, `setup hint ${small} on ink`);
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

// ── the game page and app.js agree on element ids ──
test('every element id app.js asks for exists in BodyArcade.html or is created by app.js', () => {
  const app = read(SITE, 'game', 'app.js');
  const html = read(SITE, 'BodyArcade.html');
  const wanted = new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  const have = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const made = new Set([...app.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const missing = [...wanted].filter((id) => !have.has(id) && !made.has(id));
  assert.deepEqual(missing, []);
});
