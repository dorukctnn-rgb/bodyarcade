// The Android app's own rows, on a deployed build (release 4: more than a website in a frame): "Play without a connection" saves the body-tracking
// engine into the service worker's cache and tells the truth about it, the app then opens and serves the engine with the network cut, a page that was
// never stored still gets a page of ours (never the browser's error page), and "Daily reminder" hands the phone a calendar file. The web visitor's
// settings page has none of it. Headless Chromium only; the phone is a Pixel user agent with the app's address (/?src=twa).
// Locally: BA_RELEASE_URL=http://127.0.0.1:<port> against a static server of dist/ (sw-register.js does not register on localhost, so the spec
// registers the worker itself when the page has none). Evidence: tests/release/out/offline-app.json and screenshots.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { POSE_CACHE, POSE_OFFLINE_FILES } from '../../packages/core/pose/assets.ts';
import { scan } from '../../packages/web/e2e/support/axe.ts';
import { BREAKPOINTS } from '../../packages/core/ui/layout.ts';
import { checkPage } from '../../packages/web/tools/layout-check.ts';
import { BASE, ENGINE, OUT } from './support.ts';

test.skip(ENGINE !== 'chromium', 'the app is Chrome on Android: Chromium is the engine of this check');

const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const evidence: Record<string, unknown> = {};
mkdirSync(join(OUT, 'offline-app'), { recursive: true });
const keep = (): void => writeFileSync(join(OUT, 'offline-app.json'), JSON.stringify(evidence, null, 1));

async function phone(browser: import('@playwright/test').Browser, lang = 'en-US'): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({
    userAgent: PIXEL, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: lang, serviceWorkers: 'allow', acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route(/plausible\.io/, (r) => r.abort());
  return { context, page, errors };
}

/** The app's first page, with the service worker installed, in control, and its start pages stored. */
async function openApp(page: Page): Promise<void> {
  await page.goto(`${BASE}/?src=twa`);
  await page.evaluate(async () => {
    if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 }).catch(async () => { await page.reload(); });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.startsWith('ba-shell-'));
    return name ? (await (await caches.open(name)).keys()).length : 0;
  }), { timeout: 90_000 }).toBeGreaterThan(20);
}

const stored = (page: Page): Promise<string[]> => page.evaluate(async (name) => {
  const c = await caches.open(name);
  return (await c.keys()).map((r) => new URL(r.url).pathname).sort();
}, POSE_CACHE);

test('the web visitor\'s settings page has no app rows', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'en-US' });
  const page = await context.newPage();
  await page.route(/plausible\.io/, (r) => r.abort());
  await page.goto(`${BASE}/settings/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[data-offline]')).toHaveCount(0);
  await expect(page.locator('[data-reminder-time]')).toHaveCount(0);
  await expect(page.getByText('This app', { exact: true })).toHaveCount(0);
  await context.close();
});

test('the app: save body tracking, see it saved, open the app with no network and run the engine from the phone', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page, errors } = await phone(browser);
  await openApp(page);
  // a phone that has not played yet: the engine is not stored
  await page.evaluate((name) => caches.delete(name), POSE_CACHE);
  await page.goto(`${BASE}/settings/?src=twa`);
  const row = page.locator('[data-offline]');
  await expect(page.getByRole('heading', { name: 'This app' })).toBeVisible();
  await expect(row).toHaveAttribute('data-offline', 'missing');
  await expect(row).toContainText('Play without a connection');
  await expect(row).toContainText('about 20 MB');
  await page.screenshot({ path: join(OUT, 'offline-app', 'settings-missing.png') });

  await row.getByRole('button', { name: 'Save now' }).click();
  await expect(row).toHaveAttribute('data-offline', 'saved', { timeout: 120_000 });
  await expect(row).toContainText('saved on this phone (20 MB)');
  await page.screenshot({ path: join(OUT, 'offline-app', 'settings-saved.png') });
  expect(await stored(page)).toEqual(POSE_OFFLINE_FILES.map((f) => f.url).sort());
  evidence.stored = await stored(page);

  // Offline: the app opens, the settings page still says saved, and the worker serves the files the engine needs, whole and as WebAssembly.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This app' })).toBeVisible();
  await expect(page.locator('[data-offline]')).toHaveAttribute('data-offline', 'saved');
  const engine = await page.evaluate(async (files) => {
    const out: Record<string, unknown> = {};
    for (const f of files) {
      const res = await fetch(f.url);
      const buf = await res.arrayBuffer();
      out[f.url] = { status: res.status, bytes: buf.byteLength, type: res.headers.get('content-type') };
    }
    const wasm = files.find((f) => f.url.endsWith('.wasm'))?.url as string;
    const ok = await WebAssembly.compileStreaming(await fetch(wasm)).then(() => true, (e) => String(e));
    return { out, compiled: ok };
  }, POSE_OFFLINE_FILES as unknown as { url: string; bytes: number }[]);
  evidence.engineOffline = engine;
  for (const f of POSE_OFFLINE_FILES) expect(engine.out[f.url], f.url).toMatchObject({ status: 200, bytes: f.bytes });
  expect((engine.out[POSE_OFFLINE_FILES[2]!.url] as { type: string }).type).toBe('application/wasm');
  expect(engine.compiled).toBe(true);
  // a game's page that was never opened: the start page draws it, and the app says what it knows
  await page.goto(`${BASE}/games/squat-flap/?src=twa`);
  await expect(page.locator('main')).toBeVisible();
  await context.setOffline(false);
  keep();
  expect(errors).toEqual([]);
  await context.close();
});

test('the app: when a save cannot finish it says so, keeps what arrived and a second try fetches the rest', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser);
  await openApp(page);
  await page.evaluate((name) => caches.delete(name), POSE_CACHE);
  await page.goto(`${BASE}/settings/?src=twa`);
  const row = page.locator('[data-offline]');
  await expect(row).toHaveAttribute('data-offline', 'missing');
  // the WASM answers with a failure; the model and the loader arrive
  let failing = true;
  await context.route(/vision_wasm_module_internal\.wasm$/, (r) => (failing ? r.fulfill({ status: 503, body: 'busy' }) : r.fallback()));
  await row.getByRole('button', { name: 'Save now' }).click();
  await expect(row).toHaveAttribute('data-offline', 'failed', { timeout: 120_000 });
  await expect(row).toContainText('Could not save it');
  expect(await stored(page)).toEqual(POSE_OFFLINE_FILES.slice(0, 2).map((f) => f.url).sort());
  failing = false;
  await row.getByRole('button', { name: 'Try again' }).click();
  await expect(row).toHaveAttribute('data-offline', 'saved', { timeout: 120_000 });
  expect(await stored(page)).toEqual(POSE_OFFLINE_FILES.map((f) => f.url).sort());
  await context.close();
});

test('the app: a page with nothing stored and no network gets our own page, status 200, in English and in Turkish', async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await phone(browser);
  await openApp(page);
  await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
  await context.setOffline(true);
  const res = await page.goto(`${BASE}/never-opened/page/`, { waitUntil: 'domcontentloaded' });
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
  await page.screenshot({ path: join(OUT, 'offline-app', 'offline-page-en.png') });
  const trRes = await page.goto(`${BASE}/tr/never-opened/page/`, { waitUntil: 'domcontentloaded' });
  expect(trRes?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Çevrimdışısın' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tekrar dene' })).toBeVisible();
  await page.screenshot({ path: join(OUT, 'offline-app', 'offline-page-tr.png') });
  await context.setOffline(false);
  await context.close();
});

for (const [lang, path, title, row, hint] of [
  ['en-US', '/settings/', 'BodyArcade workout', 'Daily reminder', 'sends nothing'],
  ['tr-TR', '/tr/settings/', 'BodyArcade antrenmanı', 'Günlük hatırlatma', 'göndermez'],
] as const) {
  test(`the app (${lang}): the daily reminder hands the phone a calendar file with a repeating event at the chosen time`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser, lang);
    await page.goto(`${BASE}${path}?src=twa`);
    await expect(page.getByText(row, { exact: true })).toBeVisible();
    await expect(page.getByText(hint, { exact: false }).first()).toBeVisible();
    const posts: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET') posts.push(`${r.method()} ${r.url()}`); });
    const time = page.locator('[data-reminder-time]');
    await expect(time).toHaveValue('18:00');
    await time.fill('07:30');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="reminder-add"]').click()]);
    expect(download.suggestedFilename()).toBe('bodyarcade-reminder.ics');
    const file = join(OUT, 'offline-app', `reminder-${lang}.ics`);
    await download.saveAs(file);
    const ics = readFileSync(file, 'utf8');
    evidence[`reminder-${lang}`] = ics;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toMatch(/DTSTART:\d{8}T073000\r\n/);
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
    expect(ics).toContain('UID:daily-workout@bodyarcade.com');
    expect(ics).toContain('URL:https://bodyarcade.com/');
    // the time stays in the field after the page is drawn again, and a toast says what to do next
    await expect(page.locator('.ba-toast')).toBeVisible();
    await expect(time).toHaveValue('07:30');
    await page.screenshot({ path: join(OUT, 'offline-app', `reminder-${lang}.png`) });
    // nothing was sent anywhere: the click made no request that writes (the file is made on the phone)
    expect(posts).toEqual([]);
    keep();
    await context.close();
  });
}

// The two rows must keep the screen layout rule at every size of the build plan and on a short phone, in English and in Turkish (the longer words).
const SIZES = [...BREAKPOINTS.map((b) => ({ id: b.id, w: b.w, h: b.h })), { id: 'phone-360-short', w: 360, h: 640 }];
test('the app rows keep the layout rule at every size, in English and Turkish', async ({ browser }) => {
  test.setTimeout(300_000);
  const found: string[] = [];
  for (const lang of ['en', 'tr'] as const) {
    for (const s of SIZES) {
      const context = await browser.newContext({ userAgent: PIXEL, viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
      const page = await context.newPage();
      await page.route(/plausible\.io/, (r) => r.abort());
      await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/settings/?src=twa`, { waitUntil: 'load' });
      await expect(page.locator('[data-offline]')).toBeVisible();
      await page.locator('[data-reminder-time]').scrollIntoViewIfNeeded();
      const problems = await checkPage(page);
      for (const p of problems) found.push(`${lang} ${s.id}: ${p}`);
      if (s.id === 'phone-360-short' || s.id === BREAKPOINTS[0]?.id) await page.locator('[data-offline]').screenshot({ path: join(OUT, 'offline-app', `rows-${lang}-${s.id}.png`) });
      await context.close();
    }
  }
  writeFileSync(join(OUT, 'offline-app-layout.json'), JSON.stringify(found, null, 1));
  expect(found, found.join('\n')).toEqual([]);
});

// Accessibility of the new rows: axe (WCAG 2.2 A and AA plus best practices) on the app's settings page, a phone and a laptop, English and Turkish, with
// the offline row in each state it can be drawn in (missing, saved, failed). Every violation fails (the rest of the site fails only on serious ones).
test('axe: the app rows have no violation in any state', async ({ browser }) => {
  test.setTimeout(240_000);
  const blocking: string[] = [];
  for (const lang of ['en', 'tr'] as const) {
    for (const size of [{ w: 390, h: 844 }, { w: 1280, h: 800 }]) {
      const context = await browser.newContext({ userAgent: PIXEL, viewport: { width: size.w, height: size.h }, locale: lang === 'tr' ? 'tr-TR' : 'en-US', serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.route(/plausible\.io/, (r) => r.abort());
      await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/settings/?src=twa`, { waitUntil: 'load' });
      await expect(page.locator('[data-offline="missing"]')).toBeVisible();
      for (const f of await scan(page)) blocking.push(`${lang} ${size.w} missing: ${f}`);
      // a failed save: the network answers the engine with an error
      await page.route(/vision_wasm_module_internal\.wasm$/, (r) => r.fulfill({ status: 503, body: 'busy' }));
      await page.getByRole('button', { name: /Save now|Şimdi kaydet/ }).click();
      await expect(page.locator('[data-offline="failed"]')).toBeVisible({ timeout: 60_000 });
      for (const f of await scan(page)) blocking.push(`${lang} ${size.w} failed: ${f}`);
      await page.unroute(/vision_wasm_module_internal\.wasm$/);
      await page.getByRole('button', { name: /Try again|Tekrar dene/ }).click();
      await expect(page.locator('[data-offline="saved"]')).toBeVisible({ timeout: 60_000 });
      for (const f of await scan(page)) blocking.push(`${lang} ${size.w} saved: ${f}`);
      await context.close();
    }
  }
  expect(blocking, blocking.join('\n')).toEqual([]);
});
