// Unit tests for the sale attribution script (site/assets/pro-source.js): the landing tag and referrer classifier, the one-word
// notes in session and local storage (first touch), and the Pro link tagging as a link is followed. The script runs
// exactly as browsers get it, in a vm sandbox with a fake document, location and storage.
// Run: node --test tests/pro-source.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPT = fs.readFileSync(path.join(HERE, "../site/assets/pro-source.js"), 'utf8');
const OWN = 'bodyarcade.com';
const PRO = 'https://dorukctn.gumroad.com/l/ithhc';
const CAMPAIGN = 'bodyarcade';
const MEDIUM = { google: 'organic', bing: 'organic', 'other-search': 'organic', 'ai-assistant': 'referral', pinterest: 'social', social: 'social', referral: 'referral', direct: 'none' };

function storage(initial, writes, name) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push([name, k, String(v)]); m.set(k, String(v)); }, _map: m };
}
// Runs the script once, like one page load. mode: 'ok', 'methods-throw' or 'access-throws' (blocked site data).
function load({ referrer = '', search = '', host = OWN, session, local, mode = 'ok', prerendering = false, shared } = {}) {
  const writes = [];
  const listeners = {};
  const ctx = {
    URLSearchParams,
    location: { hostname: host, search },
    document: { referrer, prerendering, addEventListener(type, fn, opts) { (listeners[type] = listeners[type] || []).push({ fn, opts }); } },
  };
  ctx.window = ctx;
  if (mode === 'ok') {
    ctx.sessionStorage = storage(session, writes, 'session');
    ctx.localStorage = shared || storage(local, writes, 'local');
  } else if (mode === 'methods-throw') {
    const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    ctx.sessionStorage = bad; ctx.localStorage = bad;
  } else {
    for (const k of ['sessionStorage', 'localStorage']) Object.defineProperty(ctx, k, { get() { throw new Error('SecurityError'); } });
  }
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  return { api: ctx.window.proSource, ctx, writes, listeners, fire(type, target) { for (const l of listeners[type] || []) l.fn({ type, target }); } };
}
function anchor(href) { const a = { href, closest: sel => (sel === 'a[href]' ? a : null) }; return a; }
const inside = a => ({ closest: sel => (sel === 'a[href]' ? a : null) });
const clicked = (r, href = PRO, type = 'click') => { const a = anchor(href); r.fire(type, a); return a.href; };
const expect = (source, base = PRO) => `${base}?utm_source=${source}&utm_medium=${MEDIUM[source]}&utm_campaign=${CAMPAIGN}`;

const REFERRERS = [
  ['', 'direct'],
  ['https://www.google.com/', 'google'], ['https://www.google.co.uk/search?q=x', 'google'], ['https://www.google.com.tr/', 'google'],
  ['HTTPS://WWW.GOOGLE.COM/', 'google'], ['https://www.google.com./', 'google'], ['android-app://com.google.android.googlequicksearchbox/', 'google'],
  ['https://gemini.google.com/app', 'ai-assistant'], ['https://docs.google.com/document/d/x', 'referral'], ['https://google.com.evil.example/', 'referral'],
  ['https://www.bing.com/', 'bing'], ['https://cn.bing.com/search?q=x', 'bing'],
  ['https://duckduckgo.com/', 'other-search'], ['https://search.yahoo.com/', 'other-search'], ['https://yandex.ru/', 'other-search'],
  ['https://www.ecosia.org/', 'other-search'], ['https://search.brave.com/', 'other-search'], ['https://www.baidu.com/', 'other-search'],
  ['https://chatgpt.com/', 'ai-assistant'], ['https://chat.openai.com/', 'ai-assistant'], ['https://www.perplexity.ai/', 'ai-assistant'],
  ['https://copilot.microsoft.com/', 'ai-assistant'], ['https://claude.ai/', 'ai-assistant'], ['android-app://com.openai.chatgpt/', 'ai-assistant'],
  ['https://www.pinterest.com/', 'pinterest'], ['https://www.pinterest.co.uk/', 'pinterest'], ['https://pin.it/abc', 'pinterest'],
  ['https://l.facebook.com/', 'social'], ['https://www.reddit.com/r/x/', 'social'], ['https://out.reddit.com/', 'social'], ['https://t.co/abc', 'social'],
  ['https://x.com/', 'social'], ['https://www.youtube.com/', 'social'], ['https://www.linkedin.com/', 'social'], ['https://lnkd.in/x', 'social'],
  ['https://user:pw@reddit.com/', 'social'], ['android-app://com.reddit.frontpage/', 'social'],
  ['https://peakappsstudio.com/', 'referral'], ['http://example.org/page', 'referral'], ['android-app://com.google.android.gm/', 'referral'],
  ['android-app://constructor/', 'referral'],
  [`https://${OWN}/`, ''], [`https://${OWN.replace(/^www\./, '')}/pricing`, ''], [`https://${OWN.toUpperCase()}/`, ''],
  ['https://dorukctn.gumroad.com/l/abc', ''], ['https://gumroad.com/checkout', ''], ['https://gum.co/u/abc', ''],
  ['about:blank', ''], ['file:///C:/x.html', ''], ['chrome-extension://abc/popup.html', ''], ['android-app://', ''], ['https:///nohost', ''], ['not a url', ''],
];
test('classifies referrers into one kind of site', () => {
  const r = load();
  for (const [referrer, want] of REFERRERS) assert.equal(r.api.classify(referrer, OWN), want, referrer);
  assert.equal(r.api.classify('http://localhost:3000/', 'localhost'), '', 'the page\'s own host, whatever it is');
});

const TAGS = [
  ['?utm_source=chatgpt.com', 'ai-assistant'], ['?utm_source=chatgpt', 'ai-assistant'], ['?utm_source=perplexity', 'ai-assistant'],
  ['?utm_source=https%3A%2F%2Fwww.perplexity.ai%2F', 'ai-assistant'], ['?utm_source=meta-ai', 'ai-assistant'],
  ['?utm_source=google', 'google'], ['?utm_source=google-ads', 'google'], ['?utm_source=bing', 'bing'], ['?utm_source=duckduckgo', 'other-search'],
  ['?utm_source=pinterest', 'pinterest'], ['?utm_source=fb_ads', 'social'], ['?ref=reddit', 'social'], ['?source=twitter', 'social'],
  ['?utm_source=other-search', 'other-search'], ['?utm_source=direct', 'direct'],
  ['?ref=producthunt', 'referral'], ['?utm_source=newsletter', 'referral'], ['?utm_source=constructor', 'referral'], ['?utm_source=__proto__', 'referral'],
  ['?ref=reddit&utm_source=chatgpt.com', 'ai-assistant'], ['?source=reddit&ref=producthunt', 'referral'], ['?utm_source=&ref=pinterest', 'pinterest'],
  ['', ''], ['?', ''], ['?utm_medium=social', ''], ['?ref=', ''], [`?utm_source=${OWN}`, ''], ['?ref=gumroad', ''], [`?ref=${CAMPAIGN}`, ''],
];
test('a tag on the landing address names the kind of site', () => {
  const r = load();
  for (const [search, want] of TAGS) assert.equal(r.api.fromTags(search, OWN), want, search);
});

test('a landing tag wins over the referrer', () => {
  const r = load({ referrer: 'https://www.google.com/', search: '?utm_source=chatgpt.com' });
  assert.equal(clicked(r), expect('ai-assistant'));
  assert.equal(load({ referrer: 'https://www.bing.com/', search: `?ref=${OWN}` }).api.source(), 'bing');
});

test('the first page keeps only the word, for the tab and as this browser\'s first', () => {
  const r = load({ referrer: 'https://www.pinterest.co.uk/pin/1/?q=x' });
  assert.deepEqual(r.writes, [['session', 'pro-source:visit', 'pinterest'], ['local', 'pro-source:first', 'pinterest']]);
  const d = load({ referrer: '' });
  assert.deepEqual(d.writes, [['session', 'pro-source:visit', 'direct']], 'direct is never the first word');
  assert.equal(clicked(d), expect('direct'));
});

test('first touch: written once, and it wins on later visits and in other tabs', () => {
  const shared = storage({}, [], 'local');
  load({ referrer: 'https://chatgpt.com/', shared });
  const later = load({ referrer: 'https://www.google.com/', shared });
  assert.equal(shared._map.get('pro-source:first'), 'ai-assistant');
  assert.deepEqual(later.writes, [['session', 'pro-source:visit', 'google']]);
  assert.equal(clicked(later), expect('ai-assistant'));
  const shared2 = storage({}, [], 'local');
  const tabA = load({ referrer: '', shared: shared2 });
  load({ referrer: 'https://www.reddit.com/', shared: shared2 });
  assert.equal(clicked(tabA), expect('social'), 'a first word written by another tab after this page loaded');
});

test('later pages keep the tab\'s word; this site and Gumroad write nothing', () => {
  const r = load({ referrer: `https://${OWN}/`, session: { 'pro-source:visit': 'bing' } });
  assert.deepEqual(r.writes, []);
  assert.equal(clicked(r), expect('bing'));
  for (const referrer of [`https://${OWN}/x`, 'https://dorukctn.gumroad.com/l/abc', 'not a url']) {
    const n = load({ referrer });
    assert.deepEqual(n.writes, [], referrer);
    assert.equal(clicked(n), expect('direct'), referrer);
  }
});

test('stored values that are not a category are replaced', () => {
  for (const junk of ['constructor', '__proto__', 'toString', 'GOOGLE', 'https://www.google.com/', '']) {
    const r = load({ referrer: 'https://www.bing.com/', session: { 'pro-source:visit': junk }, local: { 'pro-source:first': junk } });
    assert.deepEqual(r.writes, [['session', 'pro-source:visit', 'bing'], ['local', 'pro-source:first', 'bing']], junk);
  }
});

test('blocked storage: the page still uses its own landing and nothing throws', () => {
  for (const mode of ['methods-throw', 'access-throws']) {
    assert.equal(clicked(load({ referrer: 'https://chatgpt.com/', mode })), expect('ai-assistant'), mode);
    assert.equal(clicked(load({ referrer: `https://${OWN}/`, mode })), expect('direct'), mode);
  }
});

test('a prerendered page writes its word only once it is opened', () => {
  const r = load({ referrer: 'https://www.google.com/', prerendering: true });
  assert.deepEqual(r.writes, []);
  r.fire('prerenderingchange');
  assert.deepEqual(r.writes, [['session', 'pro-source:visit', 'google'], ['local', 'pro-source:first', 'google']]);
});

test('each category is sent with its medium', () => {
  for (const category of Object.keys(MEDIUM)) {
    assert.equal(clicked(load({ referrer: `https://${OWN}/`, session: { 'pro-source:visit': category } })), expect(category), category);
  }
});

test('the Pro link changes only as it is followed, once, keeping its query and fragment', () => {
  for (const type of ['mousedown', 'touchstart', 'click']) {
    const r = load({ referrer: 'https://www.google.com/' });
    const a = anchor(PRO);
    r.fire(type, inside(a));
    assert.equal(a.href, expect('google'), type);
  }
  const r = load({ referrer: 'https://www.bing.com/' });
  assert.equal(r.listeners.mousedown[0].opts, true);
  assert.equal(r.listeners.click[0].opts, true);
  assert.deepEqual([r.listeners.touchstart[0].opts.capture, r.listeners.touchstart[0].opts.passive], [true, true]);
  const a = anchor(PRO);
  r.fire('mousedown', a); r.fire('click', a);
  assert.equal(a.href, expect('bing'), 'tagged once');
  const t = `&utm_source=bing&utm_medium=organic&utm_campaign=${CAMPAIGN}`;
  assert.equal(clicked(r, PRO + '?wanted=true'), PRO + '?wanted=true' + t);
  assert.equal(clicked(r, PRO + '?option=a%20b#buy'), PRO + '?option=a%20b' + t + '#buy');
  assert.equal(clicked(r, PRO + '?utm_source=newsletter'), PRO + '?utm_source=newsletter', 'a link already tagged is left alone');
});

test('other links and odd click targets are left alone', () => {
  const r = load({ referrer: 'https://www.google.com/' });
  for (const href of [`https://${OWN}/`, 'https://dorukctn.gumroad.com/', 'https://gumroad.com/l/abc', 'http://dorukctn.gumroad.com/l/abc', 'https://api.gumroad.com/v2/licenses/verify', 'mailto:info@peakappsstudio.com']) {
    assert.equal(clicked(r, href), href);
  }
  for (const target of [null, undefined, {}, { closest: () => null }, { closest() { throw new Error('detached'); } }]) {
    assert.doesNotThrow(() => r.fire('click', target));
  }
});

test('nothing is sent anywhere and only window.proSource is added', () => {
  const r = load({ referrer: 'https://www.google.com/' });
  assert.deepEqual(Object.keys(r.ctx).filter(k => !['URLSearchParams', 'location', 'document', 'window', 'sessionStorage', 'localStorage'].includes(k)), ['proSource']);
  assert.doesNotMatch(SCRIPT, /fetch\(|XMLHttpRequest|sendBeacon|new Image|document\.cookie/);
});

test('every page loads the script once in its head and serves plain Gumroad links', () => {
  const SITE = path.join(HERE, '..', 'site');
  const pages = [];
  (function walk(d) { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) { if (n !== 'vendor') walk(f); } else if (n.endsWith('.html')) pages.push(f); } })(SITE);
  assert.ok(pages.length >= 8, `${pages.length} pages`);
  let links = 0;
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const tags = html.match(/<script src="\/assets\/pro-source\.js\?v=\d+" defer><\/script>/g) || [];
    assert.equal(tags.length, 1, f);
    assert.ok(html.indexOf(tags[0]) < html.indexOf('</head>'), f + ': in the head');
    assert.doesNotMatch(html, /gumroad\.com\/l\/[^"'\s<]*utm_/, f);
    links += (html.match(/href="https:\/\/dorukctn\.gumroad\.com\/l\/[a-z0-9]+"/g) || []).length;
  }
  assert.ok(links >= 2, `${links} Pro links in the pages`);
  const game = fs.readFileSync(path.join(SITE, 'game', 'app.js'), 'utf8');
  assert.match(game, /href="\$\{store\.GUMROAD\.pro\.url\}"/, 'the game\'s buy links are plain links too');
  assert.match(fs.readFileSync(path.join(SITE, 'privacy.html'), 'utf8'), /Gumroad learns only the kind of site, never its address/);
});
