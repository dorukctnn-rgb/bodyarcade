// Every game of the deployed catalogue starts a round and keeps running (keyboard input, so it runs headless without a
// body): the countdown, then play with keys pressed for 15 s, its scene drawn, no error panel and no page error. Also every game on
// the Turkish pages. A game whose page says it is not available yet fails here. Evidence: tests/release/out/games.json
// and a screenshot per game in tests/release/out/games/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE, OUT, sitemapUrls } from './support.ts';

const slugs = [...new Set(sitemapUrls().map((p) => /^\/games\/([a-z0-9-]+)\/$/.exec(p)?.[1]).filter((s): s is string => !!s))].sort();
// One evidence file per game: Playwright starts a new worker after a failed test, so module state does not last.

test('the catalogue lists all eleven games of release 1', () => {
  mkdirSync(join(OUT, 'games'), { recursive: true });
  writeFileSync(join(OUT, 'games', 'catalogue.json'), JSON.stringify({ slugs }, null, 1));
  expect(slugs.length, slugs.join(', ')).toBe(11);
});

for (const slug of slugs) {
  test(`${slug}: a keyboard round starts and keeps running`, async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(join(OUT, 'games'), { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
    const t0 = Date.now();
    await page.goto(`${BASE}/play/${slug}/?input=keyboard`, { waitUntil: 'load' });
    const error = page.locator('.ba-explain [role="alert"]');
    const countdown = page.locator('.ba-countdown');
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
      if (await error.isVisible().catch(() => false)) break;
      if (await countdown.isVisible().catch(() => false)) started = true; else await page.waitForTimeout(250);
    }
    let message: string | null = (await error.isVisible().catch(() => false)) ? await error.innerText() : null;
    if (started) {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
      for (let i = 0; i < 30; i++) { await page.keyboard.press(keys[i % keys.length] as string); await page.waitForTimeout(500); }
      if (await error.isVisible().catch(() => false)) message = await error.innerText();
    }
    await page.screenshot({ path: join(OUT, 'games', `${slug}.png`) });
    // Is the game's scene drawn? The middle of the stage (clear of the HUD bars and the camera view) as a JPEG: a flat
    // background compresses to about 3 KB, a drawn scene to 15 KB and more (measured 24 Oct: Road Run 20 KB, blank 2.9 KB).
    const sceneBytes = (await page.screenshot({ type: 'jpeg', quality: 50, clip: { x: 64, y: 144, width: 896, height: 416 } })).length;
    const sceneDrawn = sceneBytes > 8000;
    writeFileSync(join(OUT, 'games', `${slug}.json`), JSON.stringify({ slug, started, sceneDrawn, sceneBytes, error: message, pageErrors, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
    await context.close();
    expect({ started, sceneDrawn, message, pageErrors }).toEqual({ started: true, sceneDrawn: true, message: null, pageErrors: [] });
  });
}
