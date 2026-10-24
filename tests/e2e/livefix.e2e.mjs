#!/usr/bin/env node
// Headless browser checks for the 23 Oct 2026 live fixes: B1 B2 B4 B6 B7 B8 B9 B10 B18, the CSP header and the 404 page.
// Hermetic: it serves site/ itself with the headers from netlify.toml, replaces MediaPipe by a scripted pose
// (a person standing still), uses a repainting canvas as the camera, and answers Gumroad and Plausible from routes.
// It never opens a visible window and leaves nothing running. The checks that wait on the real world
// (calibration, runs of 15 to 20 seconds) are slow on a busy machine; the timeouts are generous.
//
//   PLAYWRIGHT_DIR=<folder that has node_modules/playwright> CHROME_PATH=<chrome.exe, optional> \
//   AXE_PATH=<axe.min.js, optional: adds the contrast scan> E2E_REAL_MP=1 <optional: CSP-mp loads the real MediaPipe, needs internet> \
//   E2E_SHOTS=<folder, optional: screenshots> node tests/e2e/livefix.e2e.mjs [--site <dir>] [--only B1,B9]
//
// Point --site at an older copy of site/ (with its netlify.toml one folder up) to watch the same checks fail.
// Exit code 1 when any check fails.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(arg('site', path.join(HERE, '..', '..', 'site')));
const ONLY = arg('only', '').split(',').filter(Boolean);
const AXE = process.env.AXE_PATH && fs.existsSync(process.env.AXE_PATH) ? process.env.AXE_PATH : null;
const REAL_MP = !!process.env.E2E_REAL_MP; // also run the CSP-mp check, which loads the real MediaPipe bundle, WASM and model (needs internet); every other check uses the scripted pose
const req = createRequire(path.join(path.resolve(process.env.PLAYWRIGHT_DIR || process.cwd()), 'x.js'));
const { chromium } = req('playwright');

// ── a small static server that behaves like Netlify for this site ──
function netlifyHeaders() {
  const f = path.join(SITE, '..', 'netlify.toml');
  if (!fs.existsSync(f)) return {};
  const out = {};
  for (const block of fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('[[headers]]').slice(1)) {
    const head = block.split('[[redirects]]')[0];
    if (!/for\s*=\s*"\/\*"/.test(head)) continue;
    for (const m of head.matchAll(/^\s+([A-Za-z][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) if (m[1] !== 'for') out[m[1]] = m[2];
  }
  return out;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const ciFind = (file) => {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((n) => n.toLowerCase() === path.basename(file).toLowerCase());
  return hit && fs.statSync(path.join(dir, hit)).isFile() ? path.join(dir, hit) : null;
};
const SERVER_HEADERS = netlifyHeaders();
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = path.join(SITE, p);
  let file = full.startsWith(SITE) ? ciFind(full) || ciFind(full + '.html') : null;
  let status = 200;
  if (!file) { status = 404; file = ciFind(path.join(SITE, '404.html')); }
  const headers = { 'cache-control': 'no-store', ...SERVER_HEADERS };
  if (!file) { rs.writeHead(404, { ...headers, 'content-type': 'text/plain' }); return rs.end('Not Found'); }
  headers['content-type'] = MIME[path.extname(file)] || 'application/octet-stream';
  rs.writeHead(status, headers);
  fs.createReadStream(file).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const url = (p) => BASE + p;

// ── browser plumbing ──
const FAKE_MP = `
const LM = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
const at = (i, x, y) => { LM[i].x = x; LM[i].y = y; };
at(0, 0.5, 0.18); at(11, 0.6, 0.34); at(12, 0.4, 0.34); at(23, 0.57, 0.6); at(24, 0.43, 0.6); at(25, 0.57, 0.78); at(26, 0.43, 0.78); at(27, 0.57, 0.95); at(28, 0.43, 0.95);
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = { createFromOptions: async () => ({
  detectForVideo() { window.__poseFrames = (window.__poseFrames || 0) + 1; const d = window.__poseDelayMs || 0; if (d) { const end = performance.now() + d; while (performance.now() < end); } return { landmarks: [LM] }; },
}) };`;
function INIT({ gumDelay, noWebgl }) {
  window.__streams = []; window.__csp = []; window.__gumDelay = gumDelay;
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, disposition: e.disposition }));
  // The camera is a canvas that keeps repainting, so the checks do not depend on a real or fake capture device
  // of the machine (a USB device change on the host makes Chromium's fake device vanish mid-run). Each request
  // gets a fresh stream, like a camera that was plugged in again. __gumDelay stands in for the permission prompt.
  const md = navigator.mediaDevices;
  if (md) {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const g = canvas.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = 'hsl(' + (n++ * 3 % 360) + ' 40% 30%)'; g.fillRect(0, 0, 640, 480); }, 33);
    md.getUserMedia = async (c) => {
      if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay));
      const s = canvas.captureStream(30); window.__streams.push(s); return s;
    };
  }
  if (noWebgl) { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(t) ? null : o.call(this, t, ...a); }; }
}
const launchArgs = process.env.E2E_GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: launchArgs });
const violations = []; let pagesOpened = 0;

const GUMROAD_OK = { success: true, uses: 1, purchase: { email: 'buyer@example.com', subscription_ended_at: null, subscription_cancelled_at: null, subscription_failed_at: null } };
const NOT_FOUND = { success: false, message: 'That license does not exist for the provided product.' };
async function open(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, permissions: ['camera'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  pagesOpened++;
  Object.assign(page, { testName: name, errors: [], gumroad: { calls: 0, mode: opts.gumroad || 'not-found' }, external: [], logs: [], engineFails: opts.engineFails || 0, engineRequests: 0, mpFails: opts.mpFails || 0, mpRequests: 0 });
  page.on('pageerror', (e) => page.errors.push(String(e.message || e)));
  page.on('console', (m) => { if (/error|warning/.test(m.type())) page.logs.push(m.type() + ': ' + m.text().slice(0, 140)); });
  await ctx.addInitScript(INIT, { gumDelay: opts.gumDelay || 0, noWebgl: !!opts.noWebgl });
  await ctx.route((u) => u.origin !== BASE, async (route) => {
    const u = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.host === 'plausible.io') return route.fulfill({ status: 200, contentType: 'application/javascript', headers: cors, body: '/* analytics off in tests */' });
    if (opts.realMp && (u.host === 'cdn.jsdelivr.net' || u.host === 'storage.googleapis.com')) return route.continue(); // needs internet
    if (u.host === 'cdn.jsdelivr.net' && u.pathname.endsWith('vision_bundle.mjs') && ++page.mpRequests <= page.mpFails) return route.abort('failed');
    if (u.host === 'cdn.jsdelivr.net' && u.pathname.endsWith('vision_bundle.mjs')) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: cors, body: FAKE_MP });
    if (u.host === 'api.gumroad.com') {
      page.gumroad.calls++;
      const mode = page.gumroad.mode;
      const reply = (status, body, type = 'application/json') => route.fulfill({ status, contentType: type, headers: cors, body: typeof body === 'string' ? body : JSON.stringify(body) });
      if (mode === 'html503') return reply(503, '<html><body>Service Unavailable</body></html>', 'text/html');
      if (mode === 'rate-limit') return reply(429, { success: false, message: 'Too many requests.' });
      if (mode === 'maintenance') return reply(503, { success: false, message: 'Down for maintenance.' });
      if (mode === 'empty200') return reply(200, {});
      if (mode === 'network') return route.abort('failed');
      if (mode === 'ok') return new URLSearchParams(route.request().postData() || '').get('product_id') === 'tN-xTHwaZm8bOdcHHBaKbQ==' ? reply(200, GUMROAD_OK) : reply(404, NOT_FOUND);
      return reply(404, NOT_FOUND); // not-found
    }
    page.external.push(u.href);
    return route.abort('blockedbyclient');
  });
  if (page.engineFails) await ctx.route('**/game/engine.js*', (route) => (++page.engineRequests <= page.engineFails ? route.abort('failed') : route.continue()));
  return page;
}
async function close(page) {
  try { for (const v of await page.evaluate(() => window.__csp || [])) violations.push({ ...v, test: page.testName }); } catch {}
  await page.context().close();
}
const live = (page) => page.evaluate(() => (window.__streams || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
const camAttached = (page) => page.evaluate(() => !!document.getElementById('cam').srcObject);
const screenOf = (page) => page.evaluate(() => document.body.dataset.screen);
// On a timeout say where the page was, so a failure can be read without a rerun.
const diag = (page) => page.evaluate(() => ({ screen: document.body.dataset.screen, steps: [...document.querySelectorAll('#setup-steps li')].map((l) => l.dataset.step + ':' + (l.className || '-')).join(' '), setup: document.getElementById('setup-msg').textContent.slice(0, 90), note: document.getElementById('start-note').textContent.slice(0, 40), paused: !document.getElementById('pause').hidden, streams: (window.__streams || []).length, tracks: (window.__streams || []).flatMap((s) => s.getTracks()).map((t) => t.readyState).join(','), poseFrames: window.__poseFrames || 0 })).then((d) => ({ ...d, console: page.logs.slice(-4) })).catch((e) => ({ diagFailed: String(e.message).slice(0, 80) }));
const waitFn = async (page, fn, arg, opts) => { try { return await page.waitForFunction(fn, arg, opts); } catch (e) { throw new Error(String(e.message).split(String.fromCharCode(10))[0] + ' | page state ' + JSON.stringify(await diag(page))); } };
const waitScreen = (page, name, timeout = 30000) => waitFn(page, (n) => document.body.dataset.screen === n, name, { timeout });
const runLive = (page, timeout = 45000) => waitFn(page, () => document.body.dataset.screen === 'run' && document.getElementById('countdown').hidden === true, null, { timeout });
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const hidden = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !e || e.hidden || e.offsetParent === null; }, sel);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const noErrors = (page) => expect(page.errors.length === 0, `page errors: ${page.errors.slice(0, 2).join(' | ')}`);
const plant = (page, key, value) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, typeof value === 'string' ? value : JSON.stringify(value)]);
const DAY = 86400000;
const SHOTS = process.env.E2E_SHOTS; // optional folder: saves a screenshot of the states worth looking at
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
async function waitGumroad(page) { for (let i = 0; i < 50 && page.gumroad.calls < 1; i++) await page.waitForTimeout(100); await page.waitForTimeout(700); }
async function cameraRunToResults(page) {
  await page.goto(url('/bodyarcade'));
  await page.click('#b-play');
  await runLive(page);
  await waitScreen(page, 'results', 90000);
}
async function contrast(page) {
  if (!AXE) return [];
  await page.evaluate(fs.readFileSync(AXE, 'utf8')); // evaluate, not a script tag: an injected inline script would count as a CSP violation
  return page.evaluate(async () => (await axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] })).violations.flatMap((v) => v.nodes.map((n) => ({ html: n.html.slice(0, 110), target: n.target.join(' '), msg: (n.any[0] || {}).message || '' }))));
}

// ── checks ──
const results = [];
async function check(id, title, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  try {
    const note = await fn();
    if (note && note.startsWith('skipped')) { results.push({ id, ok: true, skipped: true }); console.log(`SKIP ${id}  ${title}\n       ${note}`); return; }
    results.push({ id, ok: true }); console.log(`PASS ${id}  ${title} (${secs()})${note ? '\n       ' + note : ''}`);
  }
  catch (e) { results.push({ id, ok: false }); console.log(`FAIL ${id}  ${title} (${secs()})\n       ${String(e.message).split('\n')[0]}`); }
}

await check('B1', 'a licence dated far in the future does not make Pro, and Gumroad is asked about it', async () => {
  const page = await open('B1', { gumroad: 'not-found' });
  try {
    await page.goto(url('/bodyarcade'));
    await plant(page, 'ba_license', { key: 'AAAAAAAA-FAKE', product: 'pro', verifiedAt: Date.now() + 3.15e11 });
    await page.reload(); await waitGumroad(page);
    const s = await page.evaluate(() => ({ pro: document.getElementById('b-pro').textContent, left: document.getElementById('runs-left').textContent.trim(), locked: document.querySelectorAll('.world.locked').length, lic: localStorage.getItem('ba_license') }));
    expect(s.pro === 'Pro' && s.locked > 0 && /free runs left/.test(s.left), `the page shows "${s.pro}", ${s.locked} locked worlds, "${s.left}"`);
    expect(page.gumroad.calls >= 1, 'no request reached Gumroad');
    expect(s.lic === null, 'the fake key is still stored after Gumroad said not found');
    return `shows "${s.pro}", ${s.locked} worlds locked, Gumroad asked ${page.gumroad.calls}x, fake key removed`;
  } finally { await close(page); }
});

await check('B2', 'a Gumroad 503 / 429 / empty answer / outage does not remove a paid licence, a "not found" does', async () => {
  const lines = [];
  for (const mode of ['html503', 'rate-limit', 'maintenance', 'empty200', 'network']) {
    const page = await open('B2-' + mode, { gumroad: mode });
    try {
      await page.goto(url('/bodyarcade'));
      await plant(page, 'ba_license', { key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', product: 'pro', verifiedAt: Date.now() - 2 * DAY, email: 'bu…@example.com' });
      await page.reload(); await waitGumroad(page);
      const s = await page.evaluate(() => ({ pro: document.getElementById('b-pro').textContent, lic: !!localStorage.getItem('ba_license') }));
      lines.push(`${mode}: ${s.pro}, key ${s.lic ? 'kept' : 'REMOVED'}`);
      expect(s.lic && s.pro === 'Pro active', `${mode}: the licence was removed or Pro switched off (${lines.join('; ')})`);
    } finally { await close(page); }
  }
  const page = await open('B2-not-found', { gumroad: 'not-found' });
  try {
    await page.goto(url('/bodyarcade'));
    await plant(page, 'ba_license', { key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', product: 'pro', verifiedAt: Date.now() - 2 * DAY, email: 'bu…@example.com' });
    await page.reload(); await waitGumroad(page);
    expect(await page.evaluate(() => localStorage.getItem('ba_license')) === null, 'a "not found" answer from Gumroad should remove the key');
    lines.push('not found: key removed');
  } finally { await close(page); }
  return lines.join(' | ');
});

await check('B2b', 'activating a real key still works', async () => {
  const page = await open('B2b', { gumroad: 'ok' });
  try {
    await page.goto(url('/bodyarcade'));
    await page.click('#b-pro');
    await page.fill('#i-key', 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD');
    await page.click('#b-key');
    await waitFn(page, () => /Pro is active/.test(document.getElementById('key-msg').textContent), null, { timeout: 8000 });
    await waitFn(page, () => document.getElementById('b-pro').textContent === 'Pro active', null, { timeout: 4000 });
    return 'activated, header shows "Pro active"';
  } finally { await close(page); }
});

await check('B4', 'damaged localStorage no longer freezes the results screen or the start screen', async () => {
  let page = await open('B4-runs');
  try {
    await page.goto(url('/bodyarcade'));
    await plant(page, 'ba_runs', '"oops"');
    await page.reload();
    await page.evaluate(() => __BA_TEST__.enable({ fast: true }));
    await page.click('#b-play-keys');
    await waitScreen(page, 'results', 90000);
    const score = await text(page, '#res-score');
    expect(/^[\d,]+$/.test(score.trim()), `results show score "${score}"`);
    noErrors(page);
  } finally { await close(page); }
  page = await open('B4-all');
  try {
    await page.goto(url('/bodyarcade'));
    for (const [k, v] of Object.entries({ ba_profile: 'null', ba_settings: 'null', ba_daily: '"x"', ba_license: '5', ba_runs: '{}', ba_totals: '"t"', ba_best: '7', ba_achievements: '{}', ba_worlds: '"w"', ba_daily_done: '"d"', ba_daily_streak: 'null' })) await plant(page, k, v);
    await page.reload();
    const wired = await page.evaluate(() => typeof document.getElementById('b-play-keys').onclick === 'function' && document.querySelectorAll('.world').length > 0);
    expect(wired, 'with every key damaged the start screen is not wired');
    await page.evaluate(() => __BA_TEST__.enable({ fast: true }));
    await page.click('#b-play-keys');
    await waitScreen(page, 'results', 90000);
    noErrors(page);
  } finally { await close(page); }
  return 'ba_runs = "oops" and eleven damaged keys at once: start screen wired, run ends on the results screen, no page errors';
});

await check('B9', 'Back during the camera permission prompt leaves the camera off', async () => {
  const page = await open('B9', { gumDelay: 3000 });
  try {
    await page.goto(url('/bodyarcade'));
    await page.click('#b-play');
    await waitScreen(page, 'setup', 10000);
    await page.waitForTimeout(800);
    await page.click('#b-setup-back');
    expect(await screenOf(page) === 'start', 'Back did not return to the start screen');
    await page.waitForTimeout(5500); // the "permission" is granted 3 s after the click
    const n = await live(page), attached = await camAttached(page);
    expect(n === 0 && !attached, `${n} live camera track(s), preview attached: ${attached}, screen: ${await screenOf(page)}`);
    noErrors(page);
    return 'camera stream arrived after Back, was stopped at once: 0 live tracks, no preview, start screen';
  } finally { await close(page); }
});

await check('B10', 'the camera is off as soon as a run ends, and "Run again" turns it on again', async () => {
  const page = await open('B10');
  try {
    await cameraRunToResults(page);
    await page.waitForTimeout(500);
    const n = await live(page), attached = await camAttached(page), pipHidden = await hidden(page, '#pip');
    expect(n === 0 && !attached && pipHidden, `results screen: ${n} live track(s), preview attached: ${attached}, preview hidden: ${pipHidden}`);
    const bad = (await contrast(page)).filter((v) => /class="[^"]*\bbtn\b/.test(v.html));
    await shot(page, 'b10-results');
    expect(bad.length === 0, `button contrast on the results screen:${bad.map((b) => b.target + ' ' + b.msg).join(' | ')}`);
    await page.click('#b-again');
    await runLive(page, 45000);
    const again = await live(page);
    expect(again >= 1, 'Run again started a run without a camera');
    noErrors(page);
    return `results: 0 live tracks, preview hidden; Run again: camera back on (${again} live track) and the run started`;
  } finally { await close(page); }
});

await check('B8', 'a camera that stops mid-run gets its own message and can be restarted', async () => {
  const page = await open('B8');
  try {
    await page.goto(url('/bodyarcade'));
    await page.click('#b-play');
    await runLive(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__streams.at(-1).getVideoTracks().forEach((t) => t.stop())); // the webcam is pulled out
    await waitFn(page, () => !document.getElementById('pause').hidden, null, { timeout: 6000 });
    const msg = (await text(page, '#pause-msg')).trim(), recal = (await text(page, '#b-recal')).trim(), resumeHidden = await hidden(page, '#b-resume');
    expect(/camera stopped/i.test(msg) && !/lost you/i.test(msg), `pause message: "${msg}"`);
    expect(recal === 'Restart camera' && resumeHidden, `buttons: "${recal}", Resume hidden: ${resumeHidden}`);
    const bad = (await contrast(page)).filter((v) => /class="[^"]*\bbtn\b/.test(v.html));
    await shot(page, 'b8-camera-stopped');
    expect(bad.length === 0, `button contrast on the pause screen:${bad.map((b) => b.target + ' ' + b.msg).join(' | ')}`);
    await page.click('#b-recal');
    await waitFn(page, () => document.body.dataset.screen === 'run' && document.getElementById('pause').hidden && !__BA_TEST__.state().paused, null, { timeout: 60000 });
    const n = await live(page);
    expect(n >= 1, 'the camera did not come back');
    noErrors(page);
    return `message "${msg}", button "${recal}", run resumed with the camera back on`;
  } finally { await close(page); }
});

await check('B7', 'a device that processes too few camera pictures is told so and can continue with the keyboard', async () => {
  const page = await open('B7');
  try {
    await page.goto(url('/bodyarcade'));
    await page.evaluate(() => { window.__poseDelayMs = 250; }); // about 4 pictures a second
    await page.click('#b-play');
    await waitFn(page, () => /camera pictures/i.test(document.getElementById('setup-msg').textContent), null, { timeout: 45000 });
    const msg = (await text(page, '#setup-msg')).trim();
    const keysClass = await page.evaluate(() => document.getElementById('b-setup-keys').className);
    await shot(page, 'b7-slow-device');
    expect(/btn-play/.test(keysClass), `the keyboard button is not highlighted (class "${keysClass}")`);
    await page.click('#b-setup-keys');
    await runLive(page, 20000);
    const n = await live(page);
    expect(n === 0, `${n} camera track(s) still live after switching to the keyboard`);
    noErrors(page);
    return `"${msg}" then the keyboard run started with the camera off`;
  } finally { await close(page); }
});

await check('B6', 'without WebGL the player is told why, and a failed engine load can be tried again', async () => {
  let page = await open('B6-nogl', { noWebgl: true });
  const lines = [];
  try {
    await page.goto(url('/bodyarcade'));
    await page.waitForTimeout(600);
    const note = (await text(page, '#start-note')).trim();
    await shot(page, 'b6-no-webgl');
    expect(/WebGL/.test(note) && !(await hidden(page, '#start-note')),`no WebGL note on the start screen (note: "${note}")`);
    await page.click('#b-play-keys'); await page.waitForTimeout(1200);
    const toast = (await text(page, '#toast')).trim();
    expect(await screenOf(page) === 'start' && !/connection/i.test(toast), `keyboard start: screen ${await screenOf(page)}, toast "${toast}"`);
    await page.click('#b-play'); await page.waitForTimeout(1500);
    expect(await screenOf(page) === 'start', `camera start: screen ${await screenOf(page)} (it should not sit on the camera check)`);
    lines.push('note: "' + note.slice(0, 60) + '..."');
  } finally { await close(page); }
  page = await open('B6-retry', { engineFails: 2 }); // the idle warm-up and the first press fail, the next try works
  try {
    await page.goto(url('/bodyarcade'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => __BA_TEST__.enable({ fast: true }));
    await page.click('#b-play-keys'); await page.waitForTimeout(1500);
    const note = (await text(page, '#start-note')).trim();
    expect(await screenOf(page) === 'start' && /3D engine/.test(note), `first press: screen ${await screenOf(page)}, note "${note}"`);
    await page.click('#b-play-keys');
    await runLive(page, 30000);
    lines.push('retry after a failed engine load started the run without a reload');
  } finally { await close(page); }
  return lines.join(' | ');
});

await check('B6b', 'a pose model that fails to load releases the camera, and the next try loads it', async () => {
  const page = await open('B6b', { mpFails: 1 });
  try {
    await page.goto(url('/bodyarcade'));
    await page.click('#b-play');
    await waitFn(page, () => /pose model couldn.t load/i.test(document.getElementById('setup-msg').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const n = await live(page), pipHidden = await hidden(page, '#pip');
    expect(n === 0 && pipHidden, `after the model failed: ${n} live camera track(s), preview hidden: ${pipHidden}`);
    await page.click('#b-setup-back');
    await page.click('#b-play');
    await runLive(page, 45000);
    expect(await live(page) >= 1, 'the second try started without a camera');
    return 'first try: message shown and camera off; second try loaded the model and the run started';
  } finally { await close(page); }
});

await check('404', 'an unknown address answers 404 with the custom page', async () => {
  const page = await open('404');
  try {
    const r = await page.goto(url('/no-such-page'));
    expect(r.status() === 404, `status ${r.status()}`);
    await shot(page, '404');
    const h1 = (await text(page, 'h1')).trim();
    expect(/isn't here/.test(h1), `heading "${h1}"`);
    expect(await page.evaluate(() => (document.querySelector('meta[name=robots]') || {}).content) === 'noindex', 'not marked noindex');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.btn-play')).backgroundColor) !== 'rgba(0, 0, 0, 0)', 'the stylesheet did not load on the 404 page');
    return `404, "${h1}", noindex, styled`;
  } finally { await close(page); }
});

await check('B18', 'no element fails the colour-contrast rule on any page or game screen (buttons included)', async () => {
  if (!AXE) return 'skipped (set AXE_PATH to the axe-core file to run this)';
  const failing = []; const btnRe = new RegExp('class="[^"]*' + String.fromCharCode(92) + 'bbtn' + String.fromCharCode(92) + 'b');
  let buttons = 0;
  const page = await open('B18');
  try {
    const scan = async (label) => { const v = await contrast(page); for (const x of v) { failing.push(label + ' ' + x.target + ' ' + x.msg.slice(0, 50)); if (btnRe.test(x.html)) buttons++; } };
    for (const p of ['/', '/bodyarcade', '/webcam-fitness-games', '/ring-fit-adventure-alternative', '/blog/', '/blog/why-browser-fitness-games-are-the-future', '/privacy', '/terms', '/no-such-page']) {
      await page.goto(url(p)); await page.waitForTimeout(300);
      await shot(page, 'page' + (p.split('/').join('-') || '-home'));
      await scan(p);
      if (p === '/bodyarcade') {
        await page.click('#b-pro'); await scan('Pro modal'); await page.click('.modal-close');
        await page.click('#b-play'); await waitScreen(page, 'setup', 10000); await page.waitForTimeout(300); await scan('camera check'); await page.click('#b-setup-back');
      }
    }
  } finally { await close(page); }
  expect(failing.length === 0, failing.length + ' contrast failure(s), ' + buttons + ' on buttons: ' + failing.slice(0, 6).join(' | '));
  return '0 contrast failures on 9 pages, the Pro modal and the camera check screen (axe color-contrast)';
});

await check('CSP-mp', 'the real MediaPipe bundle, WASM and model load under the policy without a violation', async () => {
  if (!REAL_MP) return 'skipped (set E2E_REAL_MP=1; needs internet for jsDelivr and Google storage)';
  const page = await open('CSP-mp', { realMp: true });
  try {
    await page.goto(url('/bodyarcade'));
    await page.click('#b-play');
    await waitFn(page, () => document.querySelector('#setup-steps li[data-step=model]').className === 'done', null, { timeout: 150000 });
    await page.waitForTimeout(2000);
    const v = await page.evaluate(() => window.__csp);
    expect(v.length === 0, `${v.length} violation(s): ${v.slice(0, 3).map((x) => x.directive + ' ' + x.blocked).join(' | ')}`);
    return 'model step done with the real library, 0 violations';
  } finally { await close(page); }
});

await check('CSP', 'the report-only policy is sent and no page or flow above produced a violation', async () => {
  expect(SERVER_HEADERS['Content-Security-Policy-Report-Only'], 'netlify.toml sends no Content-Security-Policy-Report-Only header');
  expect(!SERVER_HEADERS['Content-Security-Policy'], 'an enforcing Content-Security-Policy is set');
  const page = await open('CSP-pages');
  try {
    for (const p of ['/', '/bodyarcade', '/webcam-fitness-games', '/ring-fit-adventure-alternative', '/blog/', '/blog/why-browser-fitness-games-are-the-future', '/privacy', '/terms', '/no-such-page']) { await page.goto(url(p)); await page.waitForTimeout(500); }
    await page.goto(url('/bodyarcade')); await page.click('#b-pro'); await page.fill('#i-key', 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD'); await page.click('#b-key'); await page.waitForTimeout(800);
    await page.goto(url('/bodyarcade')); await page.click('#b-ach'); await page.click('.modal-close'); await page.click('#b-hist'); await page.click('.modal-close'); await page.click('#b-skins'); await page.waitForTimeout(300);
  } finally { await close(page); }
  expect(violations.length === 0, `${violations.length} violation(s): ` + violations.slice(0, 4).map((v) => `${v.test} ${v.directive} ${v.blocked} ${v.source}:${v.line}`).join(' | '));
  return `0 violations across ${pagesOpened} browser sessions in this run (every content page, the 404, the game start screen, the Pro modal and activation, history, plus the runs of the checks above)`;
});

await browser.close();
await new Promise((r) => server.close(r));
const failed = results.filter((r) => !r.ok);
const ran = results.filter((r) => !r.skipped);
console.log(`\n${ran.length - failed.length} of ${ran.length} checks passed` + (results.length > ran.length ? `, ${results.length - ran.length} skipped` : '') + (failed.length ? `; failed: ${failed.map((f) => f.id).join(', ')}` : ''));
process.exit(failed.length ? 1 : 0);
