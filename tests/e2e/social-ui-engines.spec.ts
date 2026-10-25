// The Friends side in the two other engines of the release's browser matrix: WebKit (the engine under every iPhone and iPad browser)
// and Firefox. The other specs run in Chromium; this one looks for what only another engine shows: a layout that differs (a window,
// a grid, a unit), and the things the real service needs from the browser (WebCrypto's non-extractable device key kept in IndexedDB,
// sockets that hibernate, the clipboard and the file download being the only ones left to the platform's own tests).
//   BA_SHOTS_DIR=... node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/social/playwright.config.ts tests/e2e/social-ui-engines.spec.ts --workers=1
import { expect, firefox, test, webkit, type Browser, type BrowserContext, type BrowserType, type LaunchOptions, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import { startStack, type Stack } from '../../packages/server/src/social/stack.ts';
import { buildShell, inspect, online, ownCode, ready, shot, signUp } from './social-ui-support.ts';

let dist = '';
let stack: Stack;
test.beforeAll(async () => { test.setTimeout(300_000); dist = await buildShell(); stack = await startStack({ assetsDir: dist }); });
test.afterAll(async () => { await stack?.stop().catch(() => undefined); if (dist) rmSync(dist, { recursive: true, force: true }); });

/**
 * The suite's config hands every browser type Chromium's launch options (its headless shell and its camera flags): another engine
 * starts with none of them (an explicit undefined and an empty list replace the defaults).
 */
const PLAIN = { headless: true, executablePath: undefined, args: [] } as unknown as LaunchOptions;

interface Engine { id: 'webkit' | 'firefox'; type: BrowserType; /** The engine has phones (a touch screen of the size of one is a context option there). */ phone: boolean }
const ENGINES: readonly Engine[] = [{ id: 'webkit', type: webkit, phone: true }, { id: 'firefox', type: firefox, phone: false }];

interface Seen { page: Page; ctx: BrowserContext; problems: string[] }

async function open(browser: Browser, e: Engine, o: { w: number; h: number; phone?: boolean; lang?: 'en' | 'tr' }): Promise<Seen> {
  const touch = o.phone === true && e.phone;
  const ctx = await browser.newContext({
    viewport: { width: o.w, height: o.h }, locale: o.lang === 'tr' ? 'tr-TR' : 'en-US', deviceScaleFactor: touch ? 2 : 1,
    ...(touch ? { hasTouch: true, isMobile: true } : {}),
  });
  await ctx.addInitScript((x) => { (window as unknown as { __BA_TEST__: unknown }).__BA_TEST__ = x; }, { keyboard: true, timeScale: 40, roundSeconds: 6, forceDemo: true });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  return { page, ctx, problems };
}

async function go(s: Seen, path: string): Promise<void> {
  await s.page.goto(`${stack.origin}${path}`);
  await s.page.waitForSelector('main h1, main h2', { timeout: 30_000 });
  await s.page.evaluate(() => document.fonts.ready);
  await s.page.waitForTimeout(300);
}

const SCREENS: readonly (readonly [string, string])[] = [
  ['friends-ready', '/friends/?social=ready'],
  ['friends-fresh', '/friends/?social=fresh'],
  ['profile-ready', '/friends/?view=profile&social=ready'],
  ['boards-ready', '/friends/?view=boards&social=ready'],
  ['lobbies-ready', '/lobbies/?social=ready'],
  ['room-guest', '/r/K7Q2MX/?social=ready'],
  ['link-member', '/f/BA-9PXMR3/?social=ready'],
  ['safety', '/safety/?social=ready'],
];

for (const e of ENGINES) {
  test(`${e.id}: the friends screens keep the layout rule and the windows open and close`, async () => {
    test.setTimeout(600_000);
    const browser = await e.type.launch(PLAIN);
    const found: string[] = [];
    try {
      for (const size of e.phone ? [{ w: 360, h: 780, phone: true }, { w: 390, h: 844, phone: true }, { w: 1280, h: 800, phone: false }] : [{ w: 390, h: 844, phone: false }, { w: 1280, h: 800, phone: false }]) {
        const s = await open(browser, e, size);
        try {
          for (const [id, path] of SCREENS) {
            await go(s, path);
            for (const x of await inspect(s.page, { axe: false })) found.push(`${e.id} ${size.w} ${id}: ${x}`);
            await shot(s.page, `engines-${e.id}-${id}-${size.w}`);
          }
          // the sign-up windows, step by step
          await go(s, '/friends/?social=fresh');
          await s.page.locator('[data-action="social.profile"]').click();
          await expect(s.page.locator('dialog[open]')).toBeVisible();
          for (const x of await inspect(s.page, { axe: false })) found.push(`${e.id} ${size.w} sheet-age: ${x}`);
          await shot(s.page, `engines-${e.id}-sheet-age-${size.w}`, { full: false });
          await s.page.locator('label:has(input[name="age"][value="adult"])').click();
          await s.page.locator('[data-action="sheet.age.next"]').click();
          await s.page.locator('#profile-name').fill('Ada');
          await s.page.locator('[data-action="sheet.name.create"]').click();
          await s.page.waitForSelector('[data-recovery-code]', { timeout: 20_000 });
          for (const x of await inspect(s.page, { axe: false })) found.push(`${e.id} ${size.w} sheet-recovery: ${x}`);
          await shot(s.page, `engines-${e.id}-sheet-recovery-${size.w}`, { full: false });
          await s.page.locator('[data-action="sheet.recovery.saved"]').click();
          await expect(s.page.locator('dialog[open]')).toHaveCount(0);
          found.push(...s.problems.map((x) => `${e.id} ${size.w}: ${x}`));
        } finally {
          await s.ctx.close().catch(() => undefined);
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  test(`${e.id}: a real profile is made with the device key, is the same player after a reload, and a friend request goes through`, async () => {
    test.setTimeout(180_000);
    const browser = await e.type.launch(PLAIN);
    try {
      const ada = await open(browser, e, { w: e.phone ? 390 : 1280, h: e.phone ? 844 : 800, phone: true });
      const bo = await open(browser, e, { w: 1280, h: 800 });
      try {
        await go(ada, '/friends/');
        await ready(ada.page);
        const made = await signUp(ada.page, { band: 'adult', name: 'Ada' });
        await online(ada.page);
        const code = await ownCode(ada.page);
        expect(code).toBe(made.friend);

        // the device key is kept: the same player after a reload
        await ada.page.reload();
        await ready(ada.page);
        await online(ada.page);
        expect(await ownCode(ada.page)).toBe(code);

        await go(bo, '/friends/');
        await ready(bo.page);
        await signUp(bo.page, { band: 'adult', name: 'Bo' });
        await online(bo.page);
        await bo.page.locator('#friend-code').fill(code);
        await bo.page.locator('[data-form="friend-add"] button[type="submit"]').click();
        await expect(bo.page.locator('#add-note')).toContainText('Request sent');
        // the request reaches Ada over the socket, and she accepts it
        await expect(ada.page.locator('[data-action="social.accept"]')).toBeVisible({ timeout: 30_000 });
        await ada.page.locator('[data-action="social.accept"]').click();
        await expect(ada.page.locator('[data-list="friends"] li')).toHaveCount(1, { timeout: 30_000 });
        await expect(bo.page.locator('[data-list="friends"] li')).toHaveCount(1, { timeout: 30_000 });
        await shot(ada.page, `engines-${e.id}-friends-live`);
        expect([...ada.problems, ...bo.problems]).toEqual([]);
      } finally {
        await ada.ctx.close().catch(() => undefined);
        await bo.ctx.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
}
