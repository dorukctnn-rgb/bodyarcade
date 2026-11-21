// The Leano card (packages/web/src/views/leano.ts, app/leano-offer.ts), in a real browser: our body-measurement app is offered to a visitor on an
// iPhone or an iPad and to nobody else. It shows for an iPhone, an iPad and an iPad that presents itself as a Mac, under the home page's
// before/after band and at the end of the results screen; it stays away from an Android phone, a desktop, the Android app (the Trusted Web
// Activity: the app's referrer, its start address, its session flag) and a child's profile, from every game's page and play screen, from
// Pro and from the plans; its link is the App Store page of Leano with the place as the campaign, its badge is the official one in the page's
// language; it never pushes the Pro section's button or the results screen's buttons off the page. The browser is Chromium (an iPhone's engine
// is not needed for a decision made from the user agent); the other engines' flows run in the QA workflow.
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { baseLaunchOptions } from './support/browser.ts';
import { startWeb, type Served } from '../../tools/page-check/servers.ts';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
};
const TWA_REFERRER = 'android-app://com.peakapps.bodyarcade/';

type Who = 'iphone' | 'ipad' | 'ipad-as-mac' | 'android' | 'desktop' | 'twa-referrer' | 'twa-start' | 'twa-flag' | 'twa-with-apple-ua';

interface Opened { context: BrowserContext; page: Page }

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

/** A visitor: the device (user agent, screen, touch) and what the Android app leaves behind (referrer, start address, session flag). */
async function visitor(who: Who, o: { locale?: string; hooks?: Record<string, unknown> } = {}): Promise<Opened> {
  const base = { locale: o.locale ?? 'en-US', deviceScaleFactor: 1 };
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const device =
    who === 'iphone' || who === 'twa-with-apple-ua' ? { ...phone, userAgent: UA.iphone }
    : who === 'ipad' ? { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, userAgent: UA.ipad }
    : who === 'ipad-as-mac' ? { viewport: { width: 1180, height: 820 }, isMobile: false, hasTouch: true, userAgent: UA.ipadAsMac }
    : who === 'desktop' ? { viewport: { width: 1440, height: 900 }, userAgent: UA.windows }
    : { ...phone, viewport: { width: 412, height: 915 }, userAgent: UA.pixel };
  const context = await browser.newContext({ ...base, ...device });
  const page = await context.newPage();
  const hooks = o.hooks ?? {};
  await page.addInitScript(({ h, twa, ipadAsMac }) => {
    (window as unknown as { __BA_TEST__: unknown }).__BA_TEST__ = h;
    // iPadOS reports five touch points (a browser with a touch screen emulated says one)
    if (ipadAsMac) Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    if (twa === 'referrer') Object.defineProperty(document, 'referrer', { get: () => 'android-app://com.peakapps.bodyarcade/' });
    if (twa === 'flag') { try { sessionStorage.setItem('ba_twa', '1'); } catch { /* blocked */ } }
  }, { h: hooks, twa: who === 'twa-referrer' || who === 'twa-with-apple-ua' ? 'referrer' : who === 'twa-flag' ? 'flag' : '', ipadAsMac: who === 'ipad-as-mac' });
  return { context, page };
}

/** Opens an address and waits until the app has taken over from the page the server drew (the practice build's test hook is there then). */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${web.url}${path}`);
  await page.waitForFunction(() => !!(window as unknown as { __BA__?: unknown }).__BA__);
  await page.waitForSelector('[data-main-heading]');
}

const home = (who: Who, path = '/'): string => (who === 'twa-start' ? `${path}?src=twa` : path);
const card = (page: Page, place: 'progress' | 'results') => page.locator(`[data-leano="${place}"]`);

const SHOWN: Who[] = ['iphone', 'ipad', 'ipad-as-mac'];
const HIDDEN: Who[] = ['android', 'desktop', 'twa-referrer', 'twa-start', 'twa-flag', 'twa-with-apple-ua'];

for (const who of SHOWN) {
  test(`${who}: the card is under the before/after band of the home page, with the badge and the App Store link`, async () => {
    const { context, page } = await visitor(who);
    await open(page, '/');
    const c = card(page, 'progress');
    await expect(c).toHaveCount(1);
    await c.scrollIntoViewIfNeeded();
    await expect(c).toBeVisible();
    await expect(c.locator('h3')).toHaveText('Track your body, not just your score');
    const link = c.locator('a[data-leano-link="progress"]');
    await expect(link).toHaveAttribute('href', 'https://apps.apple.com/app/id6761293700?ct=bodyarcade-progress&mt=8');
    const badge = link.locator('img');
    await expect(badge).toHaveAttribute('alt', 'Download Leano on the App Store');
    // the official badge, loaded, 56 px high like the site's buttons, wholly inside its card and the screen
    await expect.poll(() => badge.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const box = await badge.boundingBox();
    const cardBox = await c.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(56);
    expect(box && cardBox && box.x >= cardBox.x && box.x + box.width <= cardBox.x + cardBox.width + 0.5).toBe(true);
    expect(box && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0)).toBe(true);
    // the card follows the band, which is still there with its two views
    await expect(page.locator('[data-home-band] .bab')).toHaveCount(1);
    expect(await page.evaluate(() => { const b = document.querySelector('[data-home-band] .bab'); const l = document.querySelector('[data-leano="progress"]'); return !!b && !!l && !!(b.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING); })).toBe(true);
    // no sideways scrolling
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await context.close();
  });
}

for (const who of HIDDEN) {
  test(`${who}: no card on the home page, and no App Store link anywhere on it`, async () => {
    const { context, page } = await visitor(who);
    await open(page, home(who));
    // the app has taken over (the hook is there): had the card been meant for this visitor, it would be on the page by now
    await expect(page.locator('[data-home-band]')).toHaveCount(1);
    await expect(page.locator('[data-leano]')).toHaveCount(0);
    await expect(page.locator('a[href*="apps.apple.com"]')).toHaveCount(0);
    await expect(page.locator('img[src*="appstore"]')).toHaveCount(0);
    await context.close();
  });
}

test('iPhone: Turkish, German, Spanish and French pages have their own words and their own official badge', async () => {
  for (const [lang, title, alt] of [
    ['tr', 'Sadece skorunu değil, vücudunu da takip et', 'Leano’yu App Store’dan indir'],
    ['de', 'Verfolge deinen Körper, nicht nur deinen Punktestand', 'Leano im App Store laden'],
    ['es', 'Sigue tu cuerpo, no solo tu puntuación', 'Descargar Leano en el App Store'],
    ['fr', 'Suis ton corps, pas seulement ton score', 'Télécharger Leano dans l’App Store'],
  ] as const) {
    const { context, page } = await visitor('iphone', { locale: `${lang}-${lang.toUpperCase()}` });
    await open(page, `/${lang}/`);
    const c = card(page, 'progress');
    await expect(c, lang).toHaveCount(1);
    await expect(c.locator('h3'), lang).toHaveText(title);
    const badge = c.locator('a img');
    await expect(badge, lang).toHaveAttribute('alt', alt);
    await expect(badge, lang).toHaveAttribute('src', new RegExp(`/${lang}\\.svg$`));
    await expect.poll(() => badge.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), lang).toBe(true);
    await expect(c.locator('a'), lang).toHaveAttribute('href', 'https://apps.apple.com/app/id6761293700?ct=bodyarcade-progress&mt=8');
    await context.close();
  }
});

test('iPhone: the Pro section keeps its button, and the hero keeps the first screen', async () => {
  const { context, page } = await visitor('iphone');
  await open(page, '/');
  // the first screen: the hero's two buttons are there and the card is far below them
  const play = await page.locator('.k-arena .ba-btn--primary').boundingBox();
  expect(play && play.y + play.height <= 844).toBe(true);
  const cardTop = await card(page, 'progress').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(cardTop).toBeGreaterThan(844 * 2);
  // the Pro section's button is a link to the Pro page, after the card, and it is not covered
  const pro = page.locator('[data-home-pro] a.ba-btn--primary');
  await expect(pro).toHaveCount(1);
  await expect(pro).toHaveAttribute('href', '/pro/');
  await pro.scrollIntoViewIfNeeded();
  await expect(pro).toBeVisible();
  await context.close();
});

test('iPhone: the card is not on a game page, a play screen, Pro, the plans or the settings', async () => {
  const { context, page } = await visitor('iphone', { hooks: { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true } });
  for (const path of ['/games/squat-flap/', '/play/squat-flap/?input=keyboard', '/pro/', '/plans/', '/settings/', '/workouts/legs/']) {
    await open(page, path);
    await expect(page.locator('[data-leano]'), path).toHaveCount(0);
  }
  await context.close();
});

// A round of the practice session (the keyboard, a short round) ends on the results screen.
async function playOneRound(page: Page): Promise<void> {
  await page.goto(`${web.url}/play/squat-flap/?input=keyboard`);
  await page.waitForURL(/\/results\//, { timeout: 45_000 });
  await page.waitForSelector('[data-main-heading]');
}

test('iPhone: the card ends the results screen, after the Pro card and before the buttons, and the buttons stay on the screen', async () => {
  const { context, page } = await visitor('iphone', { hooks: { forceDemo: true, timeScale: 40, roundSeconds: 6, keyboard: true } });
  await playOneRound(page);
  const c = card(page, 'results');
  await expect(c).toHaveCount(1);
  await expect(c.locator('h2')).toHaveText('Track your body, not just your score');
  await expect(c.locator('a')).toHaveAttribute('href', 'https://apps.apple.com/app/id6761293700?ct=bodyarcade-results&mt=8');
  const order = await page.evaluate(() => {
    const q = (s: string): Element | null => document.querySelector(s);
    const after = (a: Element | null, b: Element | null): boolean => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { afterPro: after(q('.k-procard'), q('[data-leano="results"]')), beforeButtons: after(q('[data-leano="results"]'), q('.k-actionbar')) };
  });
  expect(order).toEqual({ afterPro: true, beforeButtons: true });
  // the "play again" button is reachable and visible when the page is scrolled to the end
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('[data-action="again"]')).toBeInViewport();
  await context.close();
});

test('Android, desktop and the Android app: no card on the results screen', async () => {
  for (const who of ['android', 'desktop', 'twa-referrer'] as const) {
    const { context, page } = await visitor(who, { hooks: { forceDemo: true, timeScale: 40, roundSeconds: 6, keyboard: true } });
    await playOneRound(page);
    await expect(page.locator('.k-procard, [data-action="again"]').first()).toBeVisible();
    await expect(page.locator('[data-leano]'), who).toHaveCount(0);
    await context.close();
  }
});

test('a child\'s profile on an iPhone gets no card', async () => {
  const { context, page } = await visitor('iphone', { hooks: { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true, plan: 'family', players: [{ name: 'Defne', kid: true, avatar: 'fox', active: true }, { name: 'Mert', avatar: 'robot' }] } });
  await open(page, '/');
  await expect(page.locator('[data-home-band]')).toHaveCount(1);
  await expect(page.locator('[data-leano]')).toHaveCount(0);
  await context.close();
});
