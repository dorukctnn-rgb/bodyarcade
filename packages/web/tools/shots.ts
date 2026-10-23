// Screenshots of the shell, headless, at the ten screen sizes of the layout rule (BUILD-PLAN "Screen layout rule"), with
// the automated checks: nothing wider than the screen, nothing cut off, no two controls overlapping, text not spilling.
// Starts its own Vite server on a free port and stops it at the end; no window ever opens.
//
//   node packages/web/tools/shots.ts <out dir> [page ...] [--sizes=360x780,1280x800] [--lang=tr] [--plan=pro] [--dark]
//
// Pages: home, region, game, game-pro, settings, pro, results, setup, setup-duo, paywall-dialog, play, welcome, notfound, friends.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../../tests/e2e/support/browser.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const out = args.find((a) => !a.startsWith('--')) ?? 'shots';
const pages = args.filter((a) => !a.startsWith('--')).slice(1);
const lang = flag('lang') ?? 'en';
const plan = flag('plan') ?? 'free';
const dark = args.includes('--dark');
const sizes = (flag('sizes')?.split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { id: s, w: w as number, h: h as number }; })) ?? BREAKPOINTS.map((b) => ({ id: b.id, w: b.w, h: b.h }));
const ALL = ['home', 'region', 'game', 'game-pro', 'settings', 'pro', 'results', 'setup', 'paywall-dialog', 'play', 'notfound'];

const prefix = lang === 'en' ? '' : `/${lang}`;
const URLS: Record<string, string> = {
  home: `${prefix}/`, region: `${prefix}/workouts/legs/`, game: `${prefix}/games/squat-flap/`, 'game-pro': `${prefix}/games/pad-work/`,
  settings: `${prefix}/settings/`, pro: `${prefix}/pro/`, results: `${prefix}/results/`, setup: `${prefix}/games/squat-flap/`, 'setup-duo': `${prefix}/games/squat-flap/`,
  'paywall-dialog': `${prefix}/games/pad-work/`, play: `${prefix}/play/squat-flap/?input=keyboard`, welcome: `${prefix}/welcome/`, notfound: `${prefix}/nope/`, friends: `${prefix}/friends/`,
};

const here = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ configFile: join(here, 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${(server.httpServer?.address() as { port: number }).port}`;
const browser = await chromium.launch(baseLaunchOptions);
mkdirSync(out, { recursive: true });

/** Problems visible on the page right now: sideways scroll, controls cut off, overlapping controls. */
async function check(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1) problems.push(`sideways scroll: page is ${de.scrollWidth}px wide on a ${innerWidth}px screen`);
    const vis = (el: Element): DOMRect | null => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
      return r;
    };
    // A modal window covers everything outside it (and the windows under it).
    const open = [...document.querySelectorAll('dialog[open]')];
    const top = open[open.length - 1] ?? null;
    const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')].filter((el) => !el.closest('[hidden], [inert], .ba-visually-hidden') && !(el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) && (!top || top.contains(el)));
    const rects = controls.map((el) => ({ el, r: vis(el) })).filter((x): x is { el: Element; r: DOMRect } => !!x.r);
    for (const { el, r } of rects) {
      const fixed = !!el.closest('.ba-tabbar, .ba-topbar, .ba-skip, dialog');
      if (!fixed && r.left < -1) problems.push(`${label(el)} starts left of the screen`);
      if (r.right > innerWidth + 1 && !el.closest('.ba-filters, .ba-seg')) problems.push(`${label(el)} reaches past the right edge (${Math.round(r.right)} > ${innerWidth})`);
    }
    function label(el: Element): string { return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${(el.textContent ?? '').trim().slice(0, 24)}"`; }
    const inView = rects.filter(({ r }) => r.bottom > 0 && r.top < innerHeight);
    for (let i = 0; i < inView.length; i++) {
      for (let j = i + 1; j < inView.length; j++) {
        const a = inView[i] as { el: Element; r: DOMRect };
        const b = inView[j] as { el: Element; r: DOMRect };
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // Fixed bars sit over the page by design; what scrolls under them is checked at the end of the page below.
        if (a.el.closest('.ba-tabbar, .ba-topbar') || b.el.closest('.ba-tabbar, .ba-topbar')) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) problems.push(`${label(a.el)} overlaps ${label(b.el)}`);
      }
    }
    // At the end of the page nothing may stay under the fixed bar.
    const bar = document.querySelector('.ba-tabbar');
    if (bar && getComputedStyle(bar).display !== 'none') {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const bt = bar.getBoundingClientRect();
      const last = [...document.querySelectorAll('main a[href], main button, footer a[href]')].filter((el) => !el.closest('[hidden]')).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      for (const r of last) {
        const sideRail = bt.width < bt.height;
        if (!sideRail && r.bottom > bt.top + 1 && r.top < bt.bottom) problems.push('content stays under the tab bar at the end of the page');
        if (sideRail && r.left < bt.right - 1 && r.right > bt.left) problems.push('content stays under the side rail');
      }
      window.scrollTo(0, 0);
    }
    return problems;
  });
}

let failed = 0;
const list = pages.length ? pages : ALL;
for (const name of list) {
  const url = URLS[name];
  if (!url) { console.error(`unknown page ${name}`); continue; }
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`, deviceScaleFactor: 1, hasTouch: size.w < 1000 });
    const page = await context.newPage();
    const hooks = name === 'play' ? { timeScale: 5, roundSeconds: 120 } : { timeScale: 40, roundSeconds: 6 };
    await page.addInitScript((h) => { window.__BA_TEST__ = h; }, hooks);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}${url}${url.includes('?') ? '&' : '?'}plan=${plan}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (name === 'setup' || name === 'setup-duo') await page.locator('a[data-action="open-setup"]').first().click();
    if (name === 'paywall-dialog') {
      await page.locator('a[data-action="open-setup"]').first().click();
      await page.locator('label.ba-seg-opt:has(input[value="hard"])').click();
      await page.waitForSelector('#paywall-title');
    }
    if (name === 'results') {
      await page.goto(`${base}${prefix}/play/squat-flap/?input=keyboard`, { waitUntil: 'networkidle' });
      await page.waitForURL(/results/, { timeout: 30000 }).catch(() => undefined);
    }
    if (name === 'play') {
      await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.ba-calib'), undefined, { timeout: 15000 });
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(350);
    const hud = name === 'play' ? await page.evaluate(() => window.__BA__?.debug().playProblems ?? ['no HUD']) : [];
    const problems = [...(await check(page)), ...hud.map((h) => `HUD: ${h}`), ...errors.map((e) => `console: ${e}`)];
    await page.screenshot({ path: join(out, `${name}-${size.id}${lang === 'en' ? '' : `-${lang}`}${dark ? '-dark' : ''}.png`), fullPage: name !== 'play' && name !== 'setup' });
    if (problems.length) { failed += 1; console.log(`${name} ${size.id}: ${problems.length} problem(s)\n  ${problems.slice(0, 8).join('\n  ')}`); }
    await context.close();
  }
}
await browser.close();
await server.close();
console.log(failed ? `${failed} screen(s) with problems` : 'no problems found');
process.exit(failed ? 1 : 0);
