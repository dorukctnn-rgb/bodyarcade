// The language bar (packages/web/src/app/lang-offer.ts and views/chrome.ts languageOffer), in a real browser: a browser that
// prefers Turkish opens an English address and stays on it, and the bar under the header offers the Turkish page, in Turkish.
// "Keep English" takes the bar away and is remembered; the link of the bar opens the Turkish address. An English browser never
// sees it, and a Turkish address needs none. Until 10 November 2026 the app moved such a visitor to /tr/... on arrival
// (technical SEO audit, issue 6); this spec keeps that from coming back.
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { baseLaunchOptions } from './support/browser.ts';
import { startWeb, type Served } from '../../tools/page-check/servers.ts';

let web: Served;
let browser: Browser;

test.beforeAll(async () => {
  web = await startWeb('only');
  browser = await chromium.launch(baseLaunchOptions);
});
test.afterAll(async () => {
  await browser?.close();
  await web?.close();
});

async function open(locale: string, path: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`${web.url}${path}`);
  await page.waitForSelector('[data-main-heading]');
  return { context, page };
}

const pathOf = (page: Page): string => new URL(page.url()).pathname;
const bar = (page: Page) => page.locator('aside.ba-langnote');

test('a Turkish browser stays on the English page and is offered the Turkish one, in Turkish', async () => {
  const { context, page } = await open('tr-TR', '/games/squat-flap/');
  await expect(bar(page)).toHaveCount(1);
  expect(pathOf(page)).toBe('/games/squat-flap/');
  await expect(bar(page)).toHaveAttribute('lang', 'tr');
  await expect(bar(page)).toContainText('Bu sayfanın Türkçesi var.');
  await expect(bar(page).locator('a[data-action="lang"]')).toHaveAttribute('href', '/tr/games/squat-flap/');
  // the rest of the page is still the English page: its brand link and its games tab lead to the English home
  await expect(page.locator('header.ba-topbar a.ba-brand')).toHaveAttribute('href', '/');
  await expect(page.locator('nav.ba-footer-langs a[aria-current="true"]')).toHaveAttribute('data-lang', 'en');
  await context.close();
});

test('"keep English" takes the bar away, stays on the address, and is remembered on the next page', async () => {
  const { context, page } = await open('tr-TR', '/games/squat-flap/');
  await bar(page).locator('button[data-action="lang-keep"]').click();
  await expect(bar(page)).toHaveCount(0);
  expect(pathOf(page)).toBe('/games/squat-flap/');
  await page.goto(`${web.url}/plans/`);
  await page.waitForSelector('[data-main-heading]');
  await expect(bar(page)).toHaveCount(0);
  expect(pathOf(page)).toBe('/plans/');
  await context.close();
});

test('the link of the bar opens the Turkish page, where there is no bar', async () => {
  const { context, page } = await open('tr-TR', '/games/squat-flap/');
  await bar(page).locator('a[data-action="lang"]').click();
  await page.waitForURL(/\/tr\/games\/squat-flap\/$/);
  await page.waitForSelector('[data-main-heading]');
  await expect(page.locator('nav.ba-footer-langs a[aria-current="true"]')).toHaveAttribute('data-lang', 'tr');
  await expect(bar(page)).toHaveCount(0);
  await context.close();
});

test('an English browser sees no bar, and a Turkish address needs none', async () => {
  const a = await open('en-US', '/games/squat-flap/');
  await expect(bar(a.page)).toHaveCount(0);
  expect(pathOf(a.page)).toBe('/games/squat-flap/');
  await a.context.close();
  const b = await open('tr-TR', '/tr/games/squat-flap/');
  await expect(bar(b.page)).toHaveCount(0);
  expect(pathOf(b.page)).toBe('/tr/games/squat-flap/');
  await b.context.close();
});
