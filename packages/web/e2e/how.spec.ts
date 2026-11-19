// The top of the home page (views/arena.ts, app/hero-live.ts, 19 Nov 2026): the poster of a real athlete is there at once with our
// body line drawn still over it; once the page has loaded the clip plays and the body line follows its frames, with the score pops;
// the pause button stops both; a script, reduced motion and saving data keep the poster and the still line and fetch no clip; the
// area picker under it recommends a free game per body area. Development build (Vite dev server).
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** How much of the canvas is drawn on (lit pixels out of about 2000 samples), and a fingerprint of what is drawn. */
const ink = async (page: Page): Promise<{ lit: number; print: string }> => page.evaluate(() => {
  const c = document.querySelector<HTMLCanvasElement>('canvas.k-arena-skel');
  if (!c || !c.width || !c.height) return { lit: 0, print: '' };
  const g = c.getContext('2d');
  if (!g) return { lit: 0, print: '' };
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let lit = 0, print = 0;
  const step = Math.max(4, Math.floor(d.length / 4 / 2000)) * 4;
  for (let i = 3; i < d.length; i += step) if ((d[i] ?? 0) > 0) { lit += 1; print = (print * 31 + i) % 1_000_003; }
  return { lit, print: `${lit}:${print}` };
});

test.describe('the hero at the top of the home page', () => {
  test('one heading with the key phrase, two buttons, the poster first, and for a script the still body line with no clip', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/`);
    const hero = page.locator('section.k-arena');
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Your body is the controller.');
    await expect(hero.locator('.k-arena-copy .k-actions a')).toHaveCount(2);
    await expect(hero.locator('.k-arena-copy .k-actions a').nth(1)).toHaveAttribute('href', '#how');
    await expect(hero.locator('.k-arena-poster img')).toHaveAttribute('fetchpriority', 'high');
    // the body line of the poster's frame is drawn once the points are in
    await expect.poll(async () => (await ink(page)).lit, { timeout: 10_000 }).toBeGreaterThan(10);
    const still = await ink(page);
    await page.waitForTimeout(1200);
    expect((await ink(page)).print).toBe(still.print);
    await expect(hero.locator('video.k-arena-video')).not.toHaveAttribute('src', /./);
    await expect(hero).not.toHaveClass(/is-live/);
    await expect(hero.locator('.k-arena-pause')).toBeHidden();
    await expect(hero.locator('.k-arena-tag')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('plays once the page has loaded, the body line follows the clip, and the pause button stops both', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, { clips: true });
    await page.goto(`${WEB_DEV_URL}/`);
    const hero = page.locator('section.k-arena');
    const box = await hero.boundingBox();
    await expect(hero).toHaveClass(/is-live/, { timeout: 20_000 });
    const video = hero.locator('video.k-arena-video');
    await expect(video).toHaveAttribute('src', /arena-wide-1280\.(webm|mp4)$/);
    const t0 = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(t0 + 0.5);
    const a = await ink(page);
    await expect.poll(async () => (await ink(page)).print, { timeout: 5_000 }).not.toBe(a.print);
    const pause = hero.locator('.k-arena-pause');
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(pause).toHaveAttribute('aria-label', 'Play the video');
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    const held = await ink(page);
    await page.waitForTimeout(800);
    expect((await ink(page)).print).toBe(held.print);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    // nothing on the page moved while the clip started and stopped
    expect(await hero.boundingBox()).toEqual(box);
    expect(errors).toEqual([]);
  });

  test('a phone held upright gets the tall crop, and reduced motion and saving data keep the poster and fetch no clip', async ({ browser }) => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const p = await phone.newPage();
    await withHooks(p, { clips: true });
    await p.goto(`${WEB_DEV_URL}/`);
    await expect(p.locator('section.k-arena')).toHaveClass(/is-live/, { timeout: 20_000 });
    await expect(p.locator('video.k-arena-video')).toHaveAttribute('src', /arena-tall-720\.(webm|mp4)$/);
    await phone.close();

    const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const c = await calm.newPage();
    await withHooks(c, { clips: true });
    await c.goto(`${WEB_DEV_URL}/`);
    await expect.poll(async () => (await ink(c)).lit, { timeout: 10_000 }).toBeGreaterThan(10);
    await c.waitForTimeout(1500);
    await expect(c.locator('video.k-arena-video')).not.toHaveAttribute('src', /./);
    await calm.close();

    const saver = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const s = await saver.newPage();
    await withHooks(s, { clips: true });
    await s.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }); });
    await s.goto(`${WEB_DEV_URL}/`);
    await s.waitForTimeout(2000);
    await expect(s.locator('video.k-arena-video')).not.toHaveAttribute('src', /./);
    await saver.close();
  });

  test('the area picker recommends a free game for each area, and its button opens that game', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/`);
    const pick = page.locator('section.k-zone');
    await expect(pick.getByRole('heading', { level: 2 })).toHaveText('Which area do you want to work?');
    const labels = pick.locator('.k-zone-opt');
    const n = await labels.count();
    expect(n).toBeGreaterThan(1);
    for (let i = 0; i < n; i += 1) {
      await labels.nth(i).click();
      const panel = pick.locator('.k-zone-panel:visible');
      await expect(panel).toHaveCount(1);
      const href = await panel.locator('a.ba-btn').getAttribute('href');
      expect(href).toMatch(/^\/games\/[a-z0-9-]+\/$/);
      // the game is in the grid of the page, and free there (no Pro mark on its tile)
      const tile = page.locator(`a.ba-tile[href="${href}"]`);
      await expect(tile).toHaveCount(1);
      await expect(tile.locator('.ba-badge--pro')).toHaveCount(0);
      await expect(panel.locator('.k-zone-game')).toHaveText((await tile.locator('.t').textContent()) ?? '');
    }
  });
});
