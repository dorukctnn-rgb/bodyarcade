// Real-app captures for the store art: the screens in the Google Play images are the shell of this checkout (packages/web),
// served by its own Vite config with the real catalogue (BA_FIXTURES=none), reached the way the shell's screenshot tool and
// end-to-end tests reach them (packages/web/tools/scenarios.ts), and photographed headless at the real size of the device.
// Nothing here opens a window and nothing is left running: startApp() starts a server and a browser, close() stops both.
//
// The pages are opened as the Android app (the Play listing is for the Android app): the app remembers a launch from the
// Play package in sessionStorage ("ba.androidApp"), and then it offers what the app offers. Two players on one camera is
// never offered inside the Android app (core/device/capabilities.ts), so no store image can show it.
//
// A capture is the viewport of the page at the device's CSS size and 2x pixels, so a picture is never enlarged afterwards.
process.env.BA_FIXTURES = 'none';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { openScenario } from '../../packages/web/tools/scenarios.ts';
import { checkPage } from '../../packages/web/tools/layout-check.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The devices of the listing, as the app sees them (CSS pixels). Tablets are held sideways: a camera game stands on a table. */
export const DEVICES = {
  phone: { w: 412, h: 940, label: 'Phone, portrait 412 x 940' },
  tablet7: { w: 960, h: 600, label: '7-inch tablet, landscape 960 x 600' },
  tablet10: { w: 1280, h: 800, label: '10-inch tablet, landscape 1280 x 800' },
};

/** The sample name of the player in the demo room is replaced in the page: a neutral first name for a public listing. */
const SELF_NAME = 'Deniz';

/**
 * The six screens, in store order. `scenario` names a screen of packages/web/tools/scenarios.ts; `round` plays a real round
 * of the real game with the keyboard until the score is up.
 */
export const SHOTS = [
  { id: 'promise', round: { game: 'squat-flap', score: 6 } },
  { id: 'privacy', scenario: 'welcome-2', after: 'show-all' },
  // The framing check before a round (the shell's own screen; the figure is the practice session's stand-in for a person).
  { id: 'calibrate', scenario: 'calibrate' },
  { id: 'games', scenario: 'home', after: 'scroll-games' },
  { id: 'friends', scenario: 'room', after: ['rename-self', 'settle-edges'] },
  // On a 7-inch tablet held sideways the tour step does not fit above its Back and Next bar, so there the same two switches are shown
  // where they live in Settings.
  { id: 'modes', scenario: 'welcome-3', after: 'show-modes', byDevice: { tablet7: { scenario: 'settings', after: 'settle-edges' } } },
];

export async function startApp() {
  const server = await createServer({ configFile: path.join(repo, 'packages', 'web', 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch(baseLaunchOptions);
  return {
    base, browser,
    close: async () => { await browser.close(); await server.close(); },
  };
}

/** A browser stand-in for openScenario: contexts at this pixel ratio, opened as the Android app. */
const androidBrowser = (app, dsf) => ({
  newContext: async (o) => {
    const context = await app.browser.newContext({ ...o, deviceScaleFactor: dsf });
    await context.addInitScript(() => { try { sessionStorage.setItem('ba.androidApp', '1'); } catch { /* storage blocked */ } });
    return context;
  },
});

async function after(page, what, ctx) {
  if (Array.isArray(what)) {
    const notes = [];
    for (const one of what) notes.push(...(await after(page, one, ctx)));
    return notes;
  }
  const notes = [];
  if (what === 'scroll-games') {
    // The filters and the first rows of the games at the top of the screen. The line above them says how many games there are
    // today; that number changes with every update of the catalogue, so it is left out of the picture.
    await page.evaluate(() => {
      // The line itself ("All games, N games, N free") is hidden, not removed, so that nothing else moves.
      const head = document.getElementById('games-h')?.parentElement;
      if (head) head.style.visibility = 'hidden';
      const chips = document.getElementById('games-h')?.closest('section')?.querySelector('.ba-chip')?.parentElement;
      // A bar that stays at the top of the screen (the menu of a tablet) keeps its place; the chips go right under it.
      const bar = [...document.querySelectorAll('header, nav')].find((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position) && e.getBoundingClientRect().top <= 1 && e.getBoundingClientRect().width > innerWidth * 0.5);
      const under = bar ? bar.getBoundingClientRect().bottom : 0;
      if (chips) window.scrollTo({ top: Math.max(0, chips.getBoundingClientRect().top + window.scrollY - under - (bar ? 10 : 26)), behavior: 'instant' });
      // The screen stops where nothing is cut in half that reads as text or as a control: no game name or detail line at the bottom
      // edge (or under the tab bar), no filter or mode chip under the top bar. Pictures may be cut: that reads as scrolling.
      const tab = [...document.querySelectorAll('nav, footer, div')].find((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().bottom >= innerHeight - 1 && e.getBoundingClientRect().top > innerHeight * 0.6);
      const limit = tab ? tab.getBoundingClientRect().top : innerHeight;
      const top = bar ? bar.getBoundingClientRect().bottom : 0;
      const cut = () => {
        for (const el of document.querySelectorAll('.ba-tile .t, .ba-tile .meta-text')) { const r = el.getBoundingClientRect(); if (r.top < limit && r.bottom > limit - 8) return true; }
        for (const el of document.querySelectorAll('.ba-chip, .k-modes')) { const r = el.getBoundingClientRect(); if (r.top < top + 5 && r.bottom > top) return true; }
        return false;
      };
      // The place the chips were put is moved by as few pixels as it takes (up or down) to clear every edge.
      const base = window.scrollY;
      let found = false;
      for (let k = 0; k <= 60 && !found; k++) for (const s of k ? [base + k, base - k] : [base]) {
        window.scrollTo({ top: Math.max(0, s), behavior: 'instant' });
        if (!cut()) { found = true; break; }
      }
      if (!found) window.scrollTo({ top: base, behavior: 'instant' });
      window.__gamesCut = !found;
    });
    if (await page.evaluate(() => window.__gamesCut)) notes.push('PROBLEM: a game name or a filter is cut by an edge and no position within 60 px clears it');
    await page.waitForTimeout(400);
  }
  if (what === 'show-modes' || what === 'show-all') {
    // What this tour step is for stays above its Back and Next bar, also on a short screen or in a language with longer words:
    // the page scrolls just far enough that the last block clears the bar.
    await page.evaluate((key) => {
      const bar = document.querySelector('.ob-actions');
      const block = key === 'show-modes' ? document.querySelector('.ob-modes') : bar?.previousElementSibling;
      if (!block || !bar) return;
      // The block above the bar may itself be what scrolls (the text of a step): then it goes to its end.
      if (key === 'show-all' && block.scrollHeight > block.clientHeight + 2) { block.scrollTop = block.scrollHeight; return; }
      const over = block.getBoundingClientRect().bottom - (bar.getBoundingClientRect().top - 14);
      if (over <= 0) return;
      // The nearest ancestor that scrolls (the window when the page itself does).
      let el = block.parentElement;
      while (el && !(el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      if (el) el.scrollTop += over; else window.scrollBy(0, over);
    }, what);
    await page.waitForTimeout(400);
  }
  if (what === 'settle-edges') {
    // A page that scrolls is photographed where no line of text is cut in half by the bottom edge (or by the bar that stays over it), and
    // nothing that a person sees first at the top is cut or pushed off. The page moves down by the few pixels that clear the edge; with no
    // bar over the bottom the picture may also end a few pixels higher (a tablet a little less tall), which is what a real screen can be.
    const r = await page.evaluate(({ maxD, maxC }) => {
      const H = innerHeight;
      const pinned = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
      let limit = H, topLimit = 0;
      for (const e of document.querySelectorAll('body *')) {
        const p = getComputedStyle(e).position;
        if (p !== 'fixed' && p !== 'sticky') continue;
        const b = e.getBoundingClientRect();
        if (b.width < innerWidth * 0.5 || b.height < 20) continue;
        if (b.bottom >= H - 1 && b.top > H * 0.5) limit = Math.min(limit, b.top);
        if (b.top <= 1 && b.bottom < H * 0.4) topLimit = Math.max(topLimit, b.bottom);
      }
      const rects = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue || !n.nodeValue.trim()) continue;
        const el = n.parentElement;
        if (!el || el.closest('script, style, noscript') || pinned(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) if (b.width >= 2 && b.height >= 4) rects.push({ top: b.top, bottom: b.bottom });
      }
      const cut = (d, c) => {
        const edge = limit - c;
        let k = 0;
        for (const b of rects) {
          const t = b.top - d, bt = b.bottom - d;
          if (t < edge && bt > edge - 3) k++; // cut by (or touching) the bottom edge
          else if (b.top >= topLimit - 1 && t < topLimit - 1) k++; // was whole at the top, is cut or gone now
        }
        return k;
      };
      const room = Math.max(0, document.documentElement.scrollHeight - H - window.scrollY);
      const cropMax = limit === H ? maxC : 0;
      const first = cut(0, 0);
      let best = { d: 0, c: 0, k: first };
      for (let d = 0; d <= Math.min(maxD, room); d++) for (let c = 0; c <= cropMax; c++) {
        const k = cut(d, c);
        if (k < best.k || (k === best.k && k === 0 && d + c < best.d + best.c)) best = { d, c, k };
      }
      if (best.d) window.scrollBy({ top: best.d, behavior: 'instant' });
      return { ...best, before: first, limit: Math.round(limit) };
    }, { maxD: 60, maxC: 56 });
    ctx.crop = r.c;
    await page.waitForTimeout(300);
    notes.push(`edges: moved ${r.d} px, ends ${r.c} px higher, lines cut ${r.before} -> ${r.k} (bottom edge at ${r.limit})`);
    if (r.k > 0) notes.push(`PROBLEM: ${r.k} line(s) of text are still cut by an edge`);
  }
  if (what === 'rename-self') {
    await page.evaluate((to) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue && n.nodeValue.includes('Doruk')) n.nodeValue = n.nodeValue.replaceAll('Doruk', to);
    }, SELF_NAME);
    await page.waitForTimeout(200);
  }
  return notes;
}

/**
 * The real game, played with the keyboard by a small autopilot until the score shows `score` and no feather is lost. The pilot
 * runs inside the page (a busy machine would make it too slow from outside): every 45 ms it reads the bird's height and the next
 * gap from the picture of the scene and sends a Space key when the bird is under the middle of the gap. The picture is taken a
 * moment after the score is reached, when the burst of points is gone; a round that loses a feather is left and played again.
 */
async function playRound(app, { game, score }, { lang, w, h, dsf }) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const context = await androidBrowser(app, dsf).newContext({ viewport: { width: w, height: h }, locale: lang === 'en' ? 'en-US' : 'tr-TR', hasTouch: w < 1000 });
    await context.addInitScript(() => { window.__BA_TEST__ = { keyboard: true }; });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/avc1|codec description/.test(m.text())) errors.push(m.text()); });
    try {
      await page.goto(`${app.base}${lang === 'en' ? '' : `/${lang}`}/games/${game}/`, { waitUntil: 'networkidle' });
      const more = page.locator('details.k-more');
      if (!(await more.evaluate((d) => d.open))) await more.locator('summary').click();
      await page.locator('label:has(input[name="input"][value="keyboard"])').click();
      await page.locator('button[data-key="play"]').click();
      await page.waitForSelector('[data-scene] canvas', { timeout: 60000 });
      await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60000 });
      await page.evaluate(() => {
        const ap = (window.__ap = { score: 0, lives: NaN, by: null, gone: false });
        let last = 0;
        const press = () => { for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true })); };
        const t = document.createElement('canvas');
        const x = t.getContext('2d', { willReadFrequently: true });
        const step = () => {
          const c = document.querySelector('[data-scene] canvas');
          if (!c) { ap.gone = true; clearInterval(window.__apTimer); return; }
          const k0 = 200 / Math.min(c.width, c.height);
          const W = Math.round(c.width * k0), H = Math.round(c.height * k0);
          t.width = W; t.height = H;
          x.drawImage(c, 0, 0, W, H);
          const d = x.getImageData(0, 0, W, H).data;
          ap.score = parseInt(document.querySelector('[data-hud="statusLeft"]')?.textContent ?? '0', 10) || 0;
          ap.lives = parseInt((document.querySelector('[data-ref="lives"]')?.getAttribute('aria-label') ?? '').replace(/\D+/g, ' ').trim(), 10);
          // The bird: its red body, in the column it flies in (it keeps its place along the screen), the middle of the red rows.
          const rows = [];
          const x0 = Math.round(W * 0.27), xr = Math.round(Math.min(W, H) * 0.07);
          for (let j = Math.round(H * 0.2); j < H; j++) {
            let cnt = 0;
            for (let i = x0 - xr; i <= x0 + xr; i++) { const k = (j * W + i) * 4; if (d[k] > 200 && d[k + 1] < 110 && d[k + 2] > 40 && d[k + 2] < 140) cnt++; }
            if (cnt > 2) rows.push(j);
          }
          if (rows.length < H * 0.02) { ap.by = null; return; }
          const by = (ap.by = rows[Math.floor(rows.length / 2)]);
          // A column is a pipe where the picture is the pale blue of the shaft or the white of the cap.
          const pipeish = (i, j) => { const k = (j * W + i) * 4; const r = d[k], g = d[k + 1], b = d[k + 2]; return (g - r >= 10 && b >= 225) || (r >= 246 && g >= 246 && b >= 246); };
          const shaft = (i, j) => { const k = (j * W + i) * 4; return d[k + 1] - d[k] >= 10 && d[k + 2] >= 225; };
          const floor = Math.floor(H * 0.85);
          // The next pipe ahead of the bird: the first run of columns with a lot of shaft that starts or reaches past it.
          const col = new Array(W).fill(0);
          for (let i = 0; i < W; i++) { let n = 0; for (let j = 0; j < floor; j++) if (shaft(i, j)) n++; col[i] = n; }
          let target = null;
          for (let i = 0; i < W; i++) {
            if (col[i] <= H * 0.05) continue;
            let e = i; while (e + 1 < W && col[e + 1] > H * 0.05) e++;
            if (i >= x0 + 10 || e >= x0 + 22) {
              const m = Math.round((i + e) / 2);
              // The gap is the longest stretch of the column that is not pipe (the ground ends the column).
              let best = [0, 0], start = -1;
              for (let j = 0; j <= floor; j++) {
                const p = j >= floor ? true : pipeish(m, j);
                if (!p && start < 0) start = j;
                if (p && start >= 0) { if (j - start > best[1] - best[0]) best = [start, j]; start = -1; }
              }
              target = (best[0] + best[1]) / 2;
              break;
            }
            i = e;
          }
          const goal = target ?? H * 0.42;
          if (by > goal + 0.033 * H && performance.now() - last > 650) { press(); last = performance.now(); }
        };
        window.__apTimer = setInterval(step, 45);
      });
      const t0 = Date.now();
      let reached = 0;
      while (Date.now() - t0 < 75000) {
        const st = await page.evaluate(() => ({ ...window.__ap, canvas: !!document.querySelector('[data-scene] canvas') }));
        if (!st.canvas || st.gone) break;
        // A round with a feather lost is not the picture of the promise: play another.
        if (Number.isFinite(st.lives) && st.lives < 3) break;
        if (st.score >= score && st.by !== null && !reached) reached = Date.now();
        // The burst of points that follows a column has gone a moment later; the bird is looked at then.
        if (reached && Date.now() - reached > 900 && st.by !== null) {
          const problems = await page.evaluate(() => window.__BA__?.debug().playProblems ?? ['no HUD']);
          const png = await page.screenshot();
          await context.close();
          return { png, problems: [...problems.map((p) => `HUD: ${p}`), ...errors.map((e) => `console: ${e}`)], attempt };
        }
        await page.waitForTimeout(100);
      }
    } finally { await context.close().catch(() => undefined); }
  }
  throw new Error(`${game}: no round reached score ${score} in 20 attempts at ${w}x${h}`);
}

/** One screen of the listing as a PNG buffer (2x pixels), with the problems the shell's own checks found on it. */
export async function captureShot(app, base, { lang, device }) {
  const shot = { ...base, ...(base.byDevice?.[device] ?? {}) };
  const { w, h } = DEVICES[device];
  const dsf = 2;
  if (shot.round) return playRound(app, shot.round, { lang, w, h, dsf });
  const opened = await openScenario(androidBrowser(app, dsf), app.base, shot.scenario, { w, h, lang, plan: shot.plan ?? 'free', ...(shot.hooks ? { hooks: shot.hooks } : {}) });
  try {
    // The shell's overlap and clipping check first (it moves the page around), then the screen is put the way the picture shows it.
    const problems = [...(await checkPage(opened.page)), ...opened.errors.map((e) => `console: ${e}`)];
    const ctx = { crop: 0 };
    if (shot.after) for (const n of await after(opened.page, shot.after, ctx)) { if (n.startsWith('PROBLEM')) problems.push(n); else console.log(`  ${lang} ${device} ${shot.id} ${n}`); }
    // The capture is the viewport, not the whole page: the sticky bars stay where a person sees them.
    const png = await opened.page.screenshot(ctx.crop ? { clip: { x: 0, y: 0, width: w, height: h - ctx.crop } } : undefined);
    return { png, problems, attempt: 1 };
  } finally { await opened.context.close(); }
}

/** Writes a capture where the compose pages read it: design/store/.cap/<lang>/<device>/<id>.png (ignored by git). */
export async function saveCapture(png, { lang, device, id }) {
  const dir = path.join(repo, 'design', 'store', '.cap', lang, device);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);
  await writeFile(file, png);
  return file;
}
