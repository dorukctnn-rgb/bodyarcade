// The screens of the shell that are checked and photographed, and how to reach each one in a headless page. Shared by the
// screenshot tool (tools/shots.ts) and the end-to-end tests (e2e/*.spec.ts), so both look at the same thing.
//
// Everything runs against a server the caller started with the fixtures as the catalogue (BA_FIXTURES=only or fill), where
// the practice session and the test hooks exist.
import type { Browser, BrowserContext, Page } from '@playwright/test';

export const SCENARIOS = ['home', 'home-week', 'region', 'game', 'game-more', 'game-pro', 'game-locked', 'settings', 'pro', 'results', 'play', 'calibrate', 'notfound', 'friends'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** The address of each scenario, without the language prefix. */
const PATHS: Record<Scenario, string> = {
  home: '/', 'home-week': '/', region: '/workouts/legs/', game: '/games/squat-flap/', 'game-more': '/games/squat-flap/', 'game-pro': '/games/pad-work/',
  'game-locked': '/games/pad-work/', settings: '/settings/', pro: '/pro/', results: '/play/squat-flap/?input=keyboard', play: '/play/squat-flap/?input=keyboard',
  calibrate: '/play/squat-flap/?input=camera', notfound: '/nope/', friends: '/friends/',
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

export interface OpenOptions {
  w: number;
  h: number;
  lang?: string;
  plan?: 'free' | 'pro';
  dark?: boolean;
  /** Pages with a camera view ask for the camera; the practice session does not need one. */
  hooks?: { timeScale?: number; roundSeconds?: number; forceDemo?: boolean };
}

export interface Opened {
  page: Page;
  context: BrowserContext;
  /** Page errors and console errors collected while the scenario was reached and settled. */
  errors: string[];
}

/** A fresh browser context at this size, the scenario reached and settled (fonts loaded, round over, HUD in place). */
export async function openScenario(browser: Browser, base: string, name: Scenario, o: OpenOptions): Promise<Opened> {
  const lang = o.lang ?? 'en';
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const context = await browser.newContext({
    viewport: { width: o.w, height: o.h }, colorScheme: o.dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`,
    deviceScaleFactor: 1, hasTouch: o.w < 1000,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const hooks = o.hooks ?? (name === 'play' ? { timeScale: 5, roundSeconds: 120, forceDemo: true } : name === 'calibrate' ? { timeScale: 1, roundSeconds: 120, forceDemo: true } : { timeScale: 40, roundSeconds: 6, forceDemo: true });
  await page.addInitScript((h) => { window.__BA_TEST__ = h; }, hooks);
  await page.addInitScript(`window.__SEED__ = ${JSON.stringify(name)};`);
  await page.addInitScript(SEED);
  const path = `${prefix}${PATHS[name]}`;
  await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}plan=${o.plan ?? 'free'}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (name === 'game-more') await page.locator('details.k-more summary').click();
  if (name === 'results') await page.waitForURL(/results/, { timeout: 30_000 });
  if (name === 'play') {
    await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal'), undefined, { timeout: 15_000 });
    await page.waitForTimeout(1200);
  }
  if (name === 'calibrate') {
    await page.locator('[data-action="camera-continue"]').click();
    await page.waitForSelector('.cal', { timeout: 15_000 });
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 0));
  return { page, context, errors };
}
