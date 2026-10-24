// Release 1 scope on the deployed build, one check per launch item that a browser can see (BUILD-PLAN "FULL SCOPE"):
// two players on one camera on big screens only, the 3D onboarding, English and Turkish, the paywall with the new
// prices, a live race with a friend from the app, friends and lobbies. Each check records what it saw in
// tests/release/out/scope.json; a check fails when the item is not in the build yet.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { withFakeVideo } from '../e2e/support/browser.ts';
import { BASE, OUT, ROOT, sitemapUrls } from './support.ts';

const seen: Record<string, unknown> = {};
test.afterAll(() => writeFileSync(join(OUT, 'scope.json'), JSON.stringify(seen, null, 1)));

test('two players: offered on a laptop, not on a phone', async ({ browser }) => {
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const lp = await laptop.newPage();
  await lp.goto(`${BASE}/games/squat-flap/`);
  const two = lp.locator('input[name="players"][value="2"]');
  seen.twoOnLaptop = await two.count();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/games/squat-flap/`);
  seen.twoOnPhone = await pp.locator('input[name="players"][value="2"]').count();
  await laptop.close();
  await phone.close();
  expect({ laptop: seen.twoOnLaptop, phone: seen.twoOnPhone }).toEqual({ laptop: 1, phone: 0 });
});

test('two players, one camera: two people calibrate and the round starts', async () => {
  test.setTimeout(240_000);
  const browser = await chromium.launch(withFakeVideo(join(ROOT, 'tests/e2e/fixtures/two-standing-640x360.mjpeg')));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'], serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/play/squat-flap/?players=2&input=camera`);
  const cont = page.locator('[data-action="camera-continue"]');
  if (await cont.isVisible({ timeout: 20_000 }).catch(() => false)) await cont.click();
  const started = await page.locator('.ba-countdown').waitFor({ state: 'visible', timeout: 150_000 }).then(() => true, () => false);
  await page.screenshot({ path: join(OUT, 'two-players.png') });
  const alert = await page.locator('.ba-explain [role="alert"]').innerText().catch(() => null);
  seen.twoPlayers = { started, alert, errors };
  await browser.close();
  expect({ started, alert, errors }).toEqual({ started: true, alert: null, errors: [] });
});

test('the 3D onboarding draws its stage', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(`${BASE}/welcome/`);
  await page.waitForTimeout(4000);
  seen.onboardingCanvas = await page.locator('canvas').count();
  await page.screenshot({ path: join(OUT, 'onboarding.png') });
  await context.close();
  expect(seen.onboardingCanvas).toBeGreaterThan(0);
});

test('English and Turkish: every game page exists in both', () => {
  const urls = sitemapUrls();
  const en = urls.filter((u) => /^\/games\/[^/]+\/$/.test(u)).length;
  const tr = urls.filter((u) => /^\/tr\/games\/[^/]+\/$/.test(u)).length;
  seen.languages = { en, tr };
  expect(tr).toBe(en);
});

test('the paywall shows the release 1 prices', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(`${BASE}/pro/`);
  const text = await page.locator('main').innerText();
  const prices = ['7.99', '39.99', '119.99'].map((p) => [p, text.includes(p)] as const);
  seen.paywall = { prices, family: text.includes('59.99'), buyLinks: await page.locator('a[href*="gumroad.com"]').count() };
  await page.screenshot({ path: join(OUT, 'paywall.png'), fullPage: true });
  await context.close();
  expect(prices.every(([, ok]) => ok)).toBe(true);
  expect((seen.paywall as { buyLinks: number }).buyLinks).toBeGreaterThan(0);
});

test('a live race with a friend can be started from a game page (invite link)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(`${BASE}/games/squat-flap/`);
  const invite = page.locator('a, button').filter({ hasText: /friend|invite|race/i });
  seen.inviteControls = await invite.allInnerTexts();
  await context.close();
  expect((seen.inviteControls as string[]).length).toBeGreaterThan(0);
});

test('friends, presence and lobbies have their page', async ({ request }) => {
  const res = await request.get(`${BASE}/friends/`, { maxRedirects: 0 });
  seen.friendsStatus = res.status();
  const social = await request.get(`${BASE}/api/social/me`, { maxRedirects: 0 }).catch(() => null);
  seen.socialApi = social ? social.status() : null;
  expect(res.status()).toBe(200);
});
