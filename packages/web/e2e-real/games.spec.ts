// Every real game, on the shell's real session, in headless Chromium at a laptop and at two phone sizes.
//  - plays: the keyboard drives it, the scene is drawn, the HUD counts, pause and resume work, leaving gives everything back;
//  - finishes: a whole round on a fake clock ends in the results screen and "Play again" starts it again.
// The catalogue is the real one (every packages/games/<id>/manifest.json that has an index.ts); BA_GAMES=a,b picks games.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, useKeyboard, withHooks } from '../e2e/support/helpers.ts';
import { WEB_REAL_URL } from '../e2e/support/ports.ts';

interface RealGame { id: string; template: string; durationSec: number; free: boolean; modes: string[]; seated: boolean; silentSafe: boolean }

function realGames(): RealGame[] {
  const dir = join(process.cwd(), 'packages', 'games');
  const only = (process.env['BA_GAMES'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const out: RealGame[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(dir, d.name, 'manifest.json')) || !existsSync(join(dir, d.name, 'index.ts'))) continue;
    if (only.length && !only.includes(d.name)) continue;
    const m = JSON.parse(readFileSync(join(dir, d.name, 'manifest.json'), 'utf8')) as RealGame;
    out.push({ id: m.id, template: m.template, durationSec: m.durationSec, free: m.free, modes: m.modes, seated: m.seated, silentSafe: m.silentSafe });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const SIZES = [
  { name: 'laptop 1280x800', viewport: { width: 1280, height: 800 }, touch: false },
  { name: 'phone 390x844', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'phone landscape 844x390', viewport: { width: 844, height: 390 }, touch: true },
] as const;

const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ArrowLeft', 'ArrowUp', 'Enter', 'ArrowRight', 'ArrowDown'];

/** The countdown and the loading are over and the HUD is up. */
async function inRound(page: Page): Promise<void> {
  await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
}

/** How much of the 2D scene is painted: pixels that are not the night stage colour, and distinct colours (coarse). */
async function sceneStats(page: Page): Promise<{ painted: number; colours: number; w: number; h: number } | null> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-scene] canvas');
    if (!c) return null;
    const t = document.createElement('canvas');
    t.width = 64; t.height = 64;
    const x = t.getContext('2d', { willReadFrequently: true });
    if (!x) return null;
    try { x.drawImage(c, 0, 0, 64, 64); } catch { return null; }
    const d = x.getImageData(0, 0, 64, 64).data;
    const seen = new Set<number>();
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0, g = d[i + 1] ?? 0, b = d[i + 2] ?? 0;
      seen.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
      if (!(Math.abs(r - 0x1a) < 8 && Math.abs(g - 0x14) < 8 && Math.abs(b - 0x30) < 8)) painted++;
    }
    return { painted, colours: seen.size, w: c.clientWidth, h: c.clientHeight };
  });
}

const games = realGames();

for (const size of SIZES) {
  test.describe(`real games at ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.touch, isMobile: size.touch });

    for (const g of games) {
      test(`${g.id}: plays with the keyboard, draws, counts, pauses and leaves clean`, async ({ page }) => {
        test.setTimeout(100_000);
        const errors = collectErrors(page);
        // A phone offers no keyboard (the camera games say they need the camera); the test browser says there is one.
        if (size.touch) await withHooks(page, { keyboard: true });
        await page.goto(`${WEB_REAL_URL}/games/${g.id}/`);
        await expect(page.locator('h1')).toBeVisible();
        await useKeyboard(page);
        await page.locator('button[data-key="play"]').click();
        await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
        await inRound(page);

        const time = page.locator('[data-ref="timer"]').first();
        const t0 = await time.textContent();
        const seen = { painted: 0, colours: 0 };
        const in3d = g.id === 'road-run';
        for (let i = 0; i < 24; i++) {
          await page.keyboard.press(KEYS[i % KEYS.length] ?? 'Space');
          await page.waitForTimeout(250);
          if (i % 6 === 5 && !in3d) {
            const s = await sceneStats(page);
            if (s) { seen.painted = Math.max(seen.painted, s.painted); seen.colours = Math.max(seen.colours, s.colours); }
          }
        }
        expect(await time.textContent(), 'the HUD timer moves').not.toBe(t0);
        if (!in3d) {
          expect(seen.painted, 'the scene draws something').toBeGreaterThan(20);
          expect(seen.colours, 'more than one colour on the scene').toBeGreaterThan(2);
        }
        const box = await page.locator('[data-scene] canvas').boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(size.viewport.width - 4);
        expect(box?.height ?? 0).toBeGreaterThan(size.viewport.height - 4);
        expect(await page.evaluate(() => window.__BA__?.debug().playProblems)).toEqual([]);

        await page.keyboard.press('Escape');
        const paused = page.getByRole('dialog', { name: 'Paused' });
        await expect(paused).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(paused).toHaveCount(0);
        await page.waitForTimeout(800);
        await page.keyboard.press('Escape');
        await expect(paused).toBeVisible();
        await paused.getByRole('button', { name: 'Leave round' }).click();
        await page.getByRole('button', { name: 'Leave', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/games/${g.id}/$`));
        expect(await page.locator('canvas').count(), 'the scene is given back').toBe(0);
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('a phone whose camera is blocked', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // Road Run has swipes, so a phone may play it without the camera: the panel shows how to allow the camera and the way around it.
  for (const g of games.filter((x) => x.id === 'road-run')) {
    test(`${g.id}: shows how to allow the camera and offers a round without it, by touch`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.addInitScript(() => {
        const md = navigator.mediaDevices;
        if (md) md.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
      await page.goto(`${WEB_REAL_URL}/games/${g.id}/`);
      await page.locator('details.k-more summary').click();
      await expect(page.locator('input[name="input"][value="keyboard"]')).toHaveCount(1);
      await page.locator('button[data-key="play"]').click();
      await page.getByRole('button', { name: 'Continue' }).click();
      const panel = page.getByRole('dialog', { name: 'The round could not start' });
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText('To allow the camera');
      await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
      await panel.getByRole('button', { name: 'Play without the camera' }).click();
      await inRound(page);
      await expect(page.locator('[data-hud="pip"]')).toBeHidden();
      expect(errors.filter((e) => !/NotAllowedError|Permission denied|getUserMedia/i.test(e))).toEqual([]);
    });
  }

  // A mirror game has no swipes: on a phone it needs the camera and offers nothing else.
  for (const g of games.filter((x) => x.id === 'star-catch')) {
    test(`${g.id}: says the game needs the camera, shows how to allow it and offers no keyboard`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.addInitScript(() => {
        const md = navigator.mediaDevices;
        if (md) md.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
      await page.goto(`${WEB_REAL_URL}/games/${g.id}/`);
      // the page offers no way around the camera
      await expect(page.locator('input[name="input"][value="keyboard"]')).toHaveCount(0);
      await page.locator('button[data-key="play"]').click();
      await page.getByRole('button', { name: 'Continue' }).click();
      const panel = page.getByRole('dialog', { name: 'This game needs the camera' });
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText('To allow the camera');
      await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(panel.getByRole('button', { name: /keyboard/i })).toHaveCount(0);
      await panel.getByRole('button', { name: 'Try again' }).click();
      await expect(panel).toBeVisible({ timeout: 30_000 });
      // errors the page logs here are the camera's own refusal, nothing else
      expect(errors.filter((e) => !/NotAllowedError|Permission denied|getUserMedia/i.test(e))).toEqual([]);
    });
  }
});

test.describe('whole rounds on a fake clock (laptop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // The full set takes about fifteen minutes (a round of Pad Work lasts seven); BA_FULL_ROUNDS=1 runs it, the default is the shortest 2D game.
  for (const g of games.filter((x) => x.id !== 'road-run' && (process.env['BA_FULL_ROUNDS'] === '1' || x.id === 'star-catch'))) {
    test(`${g.id}: a whole round ends in the results, Play again starts it again`, async ({ page }) => {
      test.setTimeout(420_000);
      const errors = collectErrors(page);
      await page.clock.install();
      await page.goto(`${WEB_REAL_URL}/games/${g.id}/`);
      await useKeyboard(page);
      await page.locator('button[data-key="play"]').click();
      await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
      let finished = false;
      const stepsMax = g.durationSec + 90;
      for (let s = 0; s < stepsMax && !finished; s++) {
        await page.keyboard.press(KEYS[s % KEYS.length] ?? 'Space');
        await page.clock.runFor(1000);
        if (s % 5 === 4) finished = await page.evaluate(() => !!window.__BA__?.debug().result);
      }
      expect(finished, 'the round reaches its end').toBe(true);
      await expect(page.getByRole('link', { name: 'Play again' })).toBeVisible();
      expect(await page.evaluate(() => window.__BA__?.debug().result?.score)).toBeGreaterThanOrEqual(0);
      await page.getByRole('link', { name: 'Play again' }).click();
      await expect(page.locator('[data-scene] canvas')).toBeVisible();
      await page.clock.runFor(8000);
      await expect(page.locator('[data-hud-root] [data-hud]').first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test('the real catalogue lists every game folder that has code', async ({ page }) => {
  await page.goto(`${WEB_REAL_URL}/`);
  await expect(page.locator('a.ba-tile')).toHaveCount(realGames().length);
});
