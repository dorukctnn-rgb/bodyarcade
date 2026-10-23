// Screenshots of the shell, headless, at the ten screen sizes of the layout rule (BUILD-PLAN "Screen layout rule"), with
// the automated checks of tools/layout-check.ts. Starts its own Vite server on a free port and stops it at the end; no
// window ever opens.
//
//   node packages/web/tools/shots.ts <out dir> [page ...] [--sizes=360x780,1280x800] [--lang=tr] [--plan=pro] [--dark]
//
// Pages: home, home-week, region, game, game-more, game-pro, game-locked, settings, pro, results, play, calibrate, notfound, friends.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../../tests/e2e/support/browser.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from './layout-check.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const out = args.find((a) => !a.startsWith('--')) ?? 'shots';
const pages = args.filter((a) => !a.startsWith('--')).slice(1);
const lang = flag('lang') ?? 'en';
const plan = flag('plan') ?? 'free';
const dark = args.includes('--dark');
const sizes = (flag('sizes')?.split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { id: s, w: w as number, h: h as number }; })) ?? BREAKPOINTS.map((b) => ({ id: b.id, w: b.w, h: b.h }));
const ALL = ['home', 'home-week', 'region', 'game', 'game-more', 'game-pro', 'game-locked', 'settings', 'pro', 'results', 'play', 'calibrate', 'notfound'];

const prefix = lang === 'en' ? '' : `/${lang}`;
const URLS: Record<string, string> = {
  home: `${prefix}/`, 'home-week': `${prefix}/`, region: `${prefix}/workouts/legs/`, game: `${prefix}/games/squat-flap/`, 'game-more': `${prefix}/games/squat-flap/`,
  'game-pro': `${prefix}/games/pad-work/`, 'game-locked': `${prefix}/games/pad-work/`, settings: `${prefix}/settings/`, pro: `${prefix}/pro/`, results: `${prefix}/results/`,
  play: `${prefix}/play/squat-flap/?input=keyboard`, calibrate: `${prefix}/play/squat-flap/?input=camera`, notfound: `${prefix}/nope/`, friends: `${prefix}/friends/`,
};

/** Seeds the player's store before the page loads: a week of rounds for the home page, a used free round for the lock. */
const SEED = `(() => {
  const name = window.__SEED__;
  const set = (k, d) => localStorage.setItem('ba2.shell.' + k, JSON.stringify({ v: 1, d }));
  if (name === 'home-week') {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dayOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const dow = (now.getDay() + 6) % 7;
    const rounds = [];
    for (let i = 0; i <= dow; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + i);
      const secs = [240, 720, 660, 420, 540, 300, 600][i] || 300;
      rounds.push({ day: dayOf(d), game: ['squat-flap', 'knee-sprint', 'star-catch'][i % 3], score: 10 + i * 4, seconds: secs, at: d.getTime() });
    }
    set('history', rounds);
    set('bests', { 'squat-flap': { normal: 18 }, 'knee-sprint': { normal: 212 }, 'star-catch': { normal: 41 } });
  }
  if (name === 'game-locked') set('settings', { playedOnce: ['pad-work'] });
})();`;

const here = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ configFile: join(here, 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${(server.httpServer?.address() as { port: number }).port}`;
const browser = await chromium.launch(baseLaunchOptions);
mkdirSync(out, { recursive: true });

let failed = 0;
const list = pages.length ? pages : ALL;
for (const name of list) {
  const url = URLS[name === 'home-week' ? 'home' : name];
  if (!url) { console.error(`unknown page ${name}`); continue; }
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`, deviceScaleFactor: 1, hasTouch: size.w < 1000 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const hooks = name === 'play' ? { timeScale: 5, roundSeconds: 120, forceDemo: true } : name === 'calibrate' ? { timeScale: 1, roundSeconds: 120, forceDemo: true } : { timeScale: 40, roundSeconds: 6, forceDemo: true };
    await page.addInitScript((h) => { window.__BA_TEST__ = h; }, hooks);
    await page.addInitScript(`window.__SEED__ = ${JSON.stringify(name)};`);
    await page.addInitScript(SEED);
    await page.goto(`${base}${url}${url.includes('?') ? '&' : '?'}plan=${plan}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (name === 'game-more') await page.locator('details.k-more summary').click();
    if (name === 'results') {
      await page.goto(`${base}${prefix}/play/squat-flap/?input=keyboard`, { waitUntil: 'networkidle' });
      await page.waitForURL(/results/, { timeout: 30000 }).catch(() => undefined);
    }
    if (name === 'play') {
      await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal'), undefined, { timeout: 15000 });
      await page.waitForTimeout(1200);
    }
    if (name === 'calibrate') {
      await page.locator('[data-action="camera-continue"]').click();
      await page.waitForSelector('.cal', { timeout: 15000 });
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(350);
    await page.evaluate(() => window.scrollTo(0, 0));
    const hud = name === 'play' ? await page.evaluate(() => window.__BA__?.debug().playProblems ?? ['no HUD']) : [];
    const problems = [...(await checkPage(page)), ...hud.map((h) => `HUD: ${h}`), ...errors.map((e) => `console: ${e}`)];
    // A sticky bar sits at the bottom of the first screen in a full-page capture and hides what is under it; for the overview it goes static.
    if (!args.includes('--view')) await page.addStyleTag({ content: '.k-actionbar { position: static !important; }' });
    await page.screenshot({ path: join(out, `${name}-${size.id}${lang === 'en' ? '' : `-${lang}`}${dark ? '-dark' : ''}.png`), fullPage: !args.includes('--view') && name !== 'play' && name !== 'calibrate' });
    if (problems.length) { failed += 1; console.log(`${name} ${size.id}: ${problems.length} problem(s)\n  ${problems.slice(0, 8).join('\n  ')}`); }
    await context.close();
  }
}
await browser.close();
await server.close();
console.log(failed ? `${failed} screen(s) with problems` : 'no problems found');
process.exit(failed ? 1 : 0);
