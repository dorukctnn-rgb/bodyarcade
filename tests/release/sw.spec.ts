// The service worker of the deployed build: it installs from the build manifest, drops every older cache (the live
// site's "ba-2026..." caches included), and the app opens offline afterwards.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE, ENGINE, OUT } from './support.ts';

test('installs, precaches the build, deletes the old site\'s caches and opens offline', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.route(/plausible\.io/, (r) => r.abort());
  const evidence: Record<string, unknown> = {};
  // Offline. Playwright's Firefox offline mode (context.setOffline) fails every load of the page with NS_ERROR_OFFLINE before its service
  // worker sees it, even a fetch from the controlled page, which a visitor's Firefox does not do (final test rehearsal, 25 Oct: with the
  // network cut instead, Firefox's worker answered the visited, the never visited and the home page from its cache). So on Firefox the
  // network is cut: every request that leaves the browser is refused and the worker has to answer from its cache.
  let cut = false;
  if (ENGINE === 'firefox') await context.route('**/*', (r) => (cut ? r.abort('internetdisconnected') : r.fallback()));
  const offline = async (on: boolean): Promise<void> => { if (ENGINE === 'firefox') cut = on; else await context.setOffline(on); };
  evidence.offlineBy = ENGINE === 'firefox' ? 'every request refused (context.route)' : 'context.setOffline';

  // A cache like the one the live site's worker leaves behind, made before the new worker exists.
  await page.goto(`${BASE}/version.json`);
  const stamp = JSON.parse(await page.locator('body').innerText()) as { build: string };
  await page.evaluate(async () => { const c = await caches.open('ba-20261023b'); await c.put('/old-landing', new Response('old')); });
  expect(await page.evaluate(() => caches.keys())).toContain('ba-20261023b');

  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 60_000 }).catch(() => undefined);
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('ba-shell-')), null, { timeout: 60_000 });
  // let the install finish its precache
  await expect.poll(async () => page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.startsWith('ba-shell-'));
    return name ? (await (await caches.open(name)).keys()).length : 0;
  }), { timeout: 60_000 }).toBeGreaterThan(20);
  const keys = await page.evaluate(() => caches.keys());
  evidence.cachesAfterInstall = keys;
  expect(keys).toContain(`ba-shell-${stamp.build}`);
  expect(keys).not.toContain('ba-20261023b');
  const swUrl = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? null);
  expect(swUrl).toBe(`${BASE}/sw.js`);
  const precached = await page.evaluate(async (b) => (await (await caches.open(`ba-shell-${b}`)).keys()).map((r) => new URL(r.url).pathname), stamp.build);
  evidence.precached = precached.length;
  expect(precached).toContain('/');
  expect(precached).toContain('/tr/');
  expect(precached.some((p) => p.startsWith('/static/main-') && p.endsWith('.js'))).toBe(true);

  // Make sure the page is controlled, visit a game page online, then go offline.
  await page.reload();
  await page.goto(`${BASE}/games/road-run/`);
  await expect(page.locator('main')).toBeVisible();
  await offline(true);
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  evidence.offlineVisited = await page.title();
  // A page never visited: the cached home page draws it (the app routes on the client).
  await page.goto(`${BASE}/games/star-catch/`);
  await expect(page.locator('main')).toBeVisible();
  evidence.offlineNeverVisited = await page.title();
  await page.goto(`${BASE}/`);
  await expect(page.locator('main')).toBeVisible();
  await offline(false);
  writeFileSync(join(OUT, 'sw.json'), JSON.stringify(evidence, null, 1));
  await context.close();
});
