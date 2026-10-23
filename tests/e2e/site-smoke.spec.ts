// The live site/ folder must keep working while v2 grows beside it: the game page boots and a keyboard run
// advances, with no uncaught errors. External requests (analytics, CDNs) are blocked so the test is hermetic.
import { expect, test } from '@playwright/test';
import { SITE_URL } from './support/ports.ts';

test('live game page boots and a keyboard run advances', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort());

  await page.goto(`${SITE_URL}/BodyArcade.html`);
  await expect(page.locator('#s-start')).toBeVisible();
  await page.click('#b-play-keys');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __BA_TEST__: { state(): { run: { t: number } | null } } }).__BA_TEST__.state().run?.t ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(2);

  // Blocked third-party requests log "Failed to load resource"; anything else is a real error.
  expect(errors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e))).toEqual([]);
});
