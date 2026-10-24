// The screens of the shell that are checked and photographed, and how to reach each one in a headless page. Shared by the
// screenshot tool (tools/shots.ts) and the end-to-end tests (e2e/*.spec.ts), so both look at the same thing.
//
// Everything runs against a server the caller started with the fixtures as the catalogue (BA_FIXTURES=only or fill), where
// the practice session and the test hooks exist.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createArcade } from '../../core/store/arcade.ts';
import { addDays, dayOf } from '../../core/store/date.ts';
import { createStore, memoryStorage } from '../../core/store/store.ts';
import { weekdayIndex } from '../src/app/arcade.ts';
import type { Hooks } from '../e2e/support/helpers.ts';

export const SCENARIOS = ['home', 'home-week', 'region', 'game', 'game-more', 'game-pro', 'game-locked', 'settings', 'pro', 'results', 'play', 'calibrate', 'calibrate-desk', 'calibrate-headroom', 'plans', 'plans-pro', 'results-plan', 'results-progress', 'pro-unavailable', 'pro-trial', 'home-trial', 'notfound', 'friends', 'friends-new', 'friends-offline', 'lobbies', 'room', 'room-host', 'safety', 'friendlink', 'welcome', 'welcome-2', 'welcome-3', 'welcome-4', 'welcome-5'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** The address of each scenario, without the language prefix. */
const PATHS: Record<Scenario, string> = {
  home: '/', 'home-week': '/', region: '/workouts/legs/', game: '/games/squat-flap/', 'game-more': '/games/squat-flap/', 'game-pro': '/games/pad-work/',
  'game-locked': '/games/pad-work/', settings: '/settings/', pro: '/pro/', results: '/play/squat-flap/?input=keyboard', play: '/play/squat-flap/?input=keyboard',
  calibrate: '/play/squat-flap/?input=camera', 'calibrate-desk': '/play/squat-flap/?input=camera', 'calibrate-headroom': '/play/summit-climb/?input=camera', plans: '/plans/', 'plans-pro': '/plans/', 'results-plan': '/plans/', 'results-progress': '/games/squat-flap/', 'pro-unavailable': '/pro/', 'pro-trial': '/pro/', 'home-trial': '/', notfound: '/nope/', friends: '/friends/?social=1', 'friends-new': '/friends/?social=fresh', 'friends-offline': '/friends/?social=offline', lobbies: '/lobbies/?social=1',
  room: '/r/K7Q2MX/?social=1', 'room-host': '/friends/?social=1', safety: '/safety/?social=1', friendlink: '/f/BA-9PXMR3/?social=1',
  welcome: '/welcome/', 'welcome-2': '/welcome/?step=2', 'welcome-3': '/welcome/?step=3', 'welcome-4': '/welcome/?step=4', 'welcome-5': '/welcome/?step=5',
};

/** The test hooks each screen is reached with: a keyboard is there in every one, and the practice session runs at the speed the screen needs. */
function hooksOf(name: Scenario): Hooks {
  const base: Hooks = { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };
  switch (name) {
    case 'play': return { ...base, timeScale: 5, roundSeconds: 120 };
    case 'calibrate': case 'calibrate-headroom': return { ...base, timeScale: 1, roundSeconds: 120 };
    case 'calibrate-desk': return { ...base, timeScale: 12, roundSeconds: 120, desk: true };
    case 'pro-unavailable': return { ...base, billing: 'unavailable' };
    case 'pro-trial': return { ...base, plan: 'pro', trial: { endsInHours: 30 } };
    case 'home-trial': return { ...base, trial: { endsInHours: 30 } };
    case 'plans-pro': return { ...base, plan: 'pro' };
    case 'welcome': case 'welcome-2': case 'welcome-3': case 'welcome-4': case 'welcome-5': return { ...base, tour: 'static' };
    case 'results-plan': return { ...base, roundSeconds: 120 };
    case 'results-progress': return { ...base, roundSeconds: 200 };
    default: return base;
  }
}

/**
 * The record of a player who has played every day of this week so far, made with the arcade itself (the same code the page
 * runs), one day at a time with that day's clock, and handed to the page as the keys it would have kept.
 */
export function weekSeed(now = Date.now()): Record<string, string> {
  const storage = memoryStorage();
  const today = dayOf(now);
  const dow = weekdayIndex(today);
  const rounds: [string, number, number][] = [['squat-flap', 18, 240], ['knee-sprint', 212, 720], ['star-catch', 41, 660], ['squat-flap', 22, 420], ['knee-sprint', 230, 540], ['star-catch', 44, 300], ['squat-flap', 25, 600]];
  for (let i = 0; i <= dow; i++) {
    const day = addDays(today, -dow + i);
    const at = new Date(`${day}T12:00:00`).getTime();
    const arcade = createArcade({ store: createStore({ storage, now: () => at }), games: () => [], can: () => true });
    const [game, score, seconds] = rounds[i % rounds.length] as [string, number, number];
    arcade.recordRun(game, { score, seconds, complete: true, variant: 'default', difficulty: 'normal', stats: {} });
  }
  return storage.dump();
}

/** Seeds the player's store before the page loads: a week of rounds for the home page, a used free round for the lock. */
const SEED = `(() => {
  const name = window.__SEED__;
  const set = (k, d) => localStorage.setItem('ba2.shell.' + k, JSON.stringify({ v: 1, d }));
  if (name === 'game-locked') set('settings', { playedOnce: ['pad-work'] });
  if (name === 'results-plan') set('cameraExplained', true);
  if (name === 'home-week') for (const [k, v] of Object.entries(window.__ARCADE_SEED__ || {})) localStorage.setItem(k, v);
})();`;

export interface OpenOptions {
  w: number;
  h: number;
  lang?: string;
  plan?: 'free' | 'pro' | 'family';
  dark?: boolean;
  /** Pages with a camera view ask for the camera; the practice session does not need one. */
  hooks?: Hooks;
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
    deviceScaleFactor: 1, hasTouch: o.w < 1000, ...(name === 'results-plan' ? { permissions: ['camera'] } : {}),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // A keyboard is there in every scenario: the screens of a round are reached with it even at phone sizes (a real phone
  // has none, and a camera game there says it needs the camera; e2e-real/games.spec.ts looks at that).
  const hooks: Hooks = o.hooks ?? hooksOf(name);
  await page.addInitScript((h) => { window.__BA_TEST__ = h; }, hooks);
  await page.addInitScript(`window.__SEED__ = ${JSON.stringify(name)};`);
  if (name === 'home-week') await page.addInitScript(`window.__ARCADE_SEED__ = ${JSON.stringify(weekSeed())};`);
  await page.addInitScript(SEED);
  const path = `${prefix}${PATHS[name]}`;
  await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}plan=${o.plan ?? 'free'}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (name === 'game-more') await page.locator('details.k-more summary').click();
  if (name === 'room-host') {
    await page.locator('[data-action="room.new"]').click();
    await page.waitForURL(/\/r\//, { timeout: 15_000 });
  }
  if (name.startsWith('welcome')) await page.waitForSelector('[data-welcome][data-ready="1"]', { timeout: 30_000 });
  if (name.startsWith('friends') || name === 'lobbies' || name.startsWith('room') || name === 'safety' || name === 'friendlink') await page.waitForSelector('main h1', { timeout: 15_000 });
  if (name === 'results') await page.waitForURL(/results/, { timeout: 30_000 });
  // The first game of the desk break played to its end: the panel that goes on to the next game, with the rest counting.
  if (name === 'results-plan') {
    await page.getByRole('button', { name: /^Start /i }).first().click();
    await page.waitForSelector('[data-plan-panel="next"]', { timeout: 90_000 });
  }
  // A round of the game of the page that made an active day: the lines about the record.
  if (name === 'results-progress') {
    const more = page.locator('details.k-more');
    await more.locator('summary').click();
    await page.locator('label:has(input[name="input"][value="keyboard"])').click();
    await page.getByRole('button', { name: /^Play/ }).click();
    await page.waitForSelector('[data-progress]', { timeout: 60_000 });
  }
  if (name === 'play') {
    await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal'), undefined, { timeout: 15_000 });
    await page.waitForTimeout(1200);
  }
  if (name === 'calibrate' || name === 'calibrate-headroom') {
    await page.locator('[data-action="camera-continue"]').click();
    await page.waitForSelector('.cal', { timeout: 15_000 });
    await page.waitForTimeout(1500);
  }
  // The most crowded state of the screen: hips out of view, the desk offered, and the player stuck long enough for the keyboard way.
  if (name === 'calibrate-desk') {
    await page.locator('[data-action="camera-continue"]').click();
    await page.waitForSelector('.cal', { timeout: 15_000 });
    await page.waitForSelector('[data-calib-desk="offer"]:not([hidden])', { timeout: 15_000 });
    await page.waitForSelector('[data-calib-keyboard]:not([hidden])', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 0));
  return { page, context, errors };
}
