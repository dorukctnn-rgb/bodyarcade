// The moving game tiles of the home page (app/tile-clips.ts): a clip plays over the still picture only where it should, and nothing
// is fetched where it should not. Development build (Vite dev server). A script never gets the clips unless the test hook asks for them.
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const clips = (page: Page) => page.locator('a.ba-tile video.clip');

/** What each clip of the page is doing: its address, whether it plays and whether it is shown. */
const state = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLVideoElement>('a.ba-tile video.clip')].map((v) => ({
  game: v.closest('a')?.getAttribute('data-game') ?? '', src: v.getAttribute('src') ?? '', playing: !v.paused && v.currentTime > 0, on: v.classList.contains('is-on'),
})));

/**
 * The layout of a tile: where it lies on the page (not on the screen: pointing at a tile may scroll it into view) and the size of
 * its picture box (offset sizes, so the 2 px lift of a hovered picture, a transform, does not count).
 */
const pageBox = (page: Page, game: string) => page.locator(`a.ba-tile[data-game="${game}"]`).evaluate((a) => {
  const r = a.getBoundingClientRect();
  const art = a.querySelector<HTMLElement>('.art');
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height, artWidth: art?.offsetWidth ?? 0, artHeight: art?.offsetHeight ?? 0 };
});

/** Whether this engine plays one of the formats (AV1 in WebM, H.264 in MP4); one without either keeps the pictures. */
const playable = (page: Page) => page.evaluate(() => {
  const v = document.createElement('video');
  return v.canPlayType('video/webm; codecs="av01.0.04M.08"') !== '' || v.canPlayType('video/mp4; codecs="avc1.64001F"') !== '';
});

test.describe('moving game tiles', () => {
  test('a script, a visitor who reduces motion and one who saves data get the still pictures, and no clip is fetched', async ({ page }) => {
    const fetched: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/assets/clips/')) fetched.push(r.url()); });
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(clips(page)).toHaveCount(4);
    await page.locator('.ba-grid').scrollIntoViewIfNeeded();
    await page.locator('a.ba-tile[data-game="squat-flap"]').hover();
    await page.waitForTimeout(1200);
    expect((await state(page)).every((c) => c.src === '')).toBe(true);

    await withHooks(page, { clips: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('a.ba-tile[data-game="squat-flap"]').hover();
    await page.waitForTimeout(1200);
    expect((await state(page)).every((c) => c.src === '')).toBe(true);
    await expect(page.locator('a.ba-tile[data-game="squat-flap"] video.clip')).toBeHidden();

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }); });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('a.ba-tile[data-game="squat-flap"]').hover();
    await page.waitForTimeout(1200);
    expect((await state(page)).every((c) => c.src === '')).toBe(true);
    expect(fetched).toEqual([]);
  });

  test('with a mouse, the tiles on the screen play without being pointed at, keep playing, and pause off the screen', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, { clips: true });
    await page.goto(`${WEB_DEV_URL}/`);
    test.skip(!(await playable(page)), 'this engine plays neither format: the tiles keep their pictures');
    // nothing for a tile below the screen
    await page.waitForTimeout(800);
    const below = await page.evaluate(() => [...document.querySelectorAll('a.ba-tile:has(video.clip)')].filter((a) => a.getBoundingClientRect().top > innerHeight).map((a) => a.getAttribute('data-game')));
    expect((await state(page)).filter((c) => below.includes(c.game)).every((c) => c.src === '')).toBe(true);

    const box = await pageBox(page, 'road-run');
    await page.mouse.move(2, 2);
    await page.evaluate(() => document.querySelector('.ba-grid')?.scrollIntoView({ block: 'center' }));
    await expect.poll(async () => (await state(page)).find((c) => c.game === 'road-run'), { timeout: 20_000 }).toMatchObject({ playing: true, on: true });
    // the 1x file for a tile drawn under 440 px on a screen of density 1
    expect((await state(page)).find((c) => c.game === 'road-run')?.src).toMatch(/\/assets\/clips\/road-run-400\.(webm|mp4)$/);
    // the clip lies over the picture: the tile did not move or change size
    expect(await pageBox(page, 'road-run')).toEqual(box);
    // it keeps moving with the pointer away from it: two moments, two different times
    const t0 = await page.locator('a.ba-tile[data-game="road-run"] video.clip').evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.waitForTimeout(700);
    const t1 = await page.locator('a.ba-tile[data-game="road-run"] video.clip').evaluate((v: HTMLVideoElement) => v.currentTime);
    expect(t1).not.toBe(t0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const offScreen = await page.locator('a.ba-tile[data-game="road-run"]').evaluate((a) => a.getBoundingClientRect().top > innerHeight);
    if (offScreen) await expect.poll(async () => (await state(page)).find((c) => c.game === 'road-run')?.playing, { timeout: 10_000 }).toBe(false);
    expect(errors).toEqual([]);
  });

  test('on a touch screen the tiles on the screen play, and pause off the screen and in a hidden tab', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US' });
    const page = await context.newPage();
    try {
      await withHooks(page, { clips: true });
      await page.goto(`${WEB_DEV_URL}/`);
      test.skip(!(await playable(page)), 'this engine plays neither format: the tiles keep their pictures');
      test.skip(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), 'this engine reports a mouse on a touch context');
      // nothing for a tile below the screen
      await page.waitForTimeout(800);
      const below = await page.evaluate(() => [...document.querySelectorAll('a.ba-tile:has(video.clip)')].filter((a) => a.getBoundingClientRect().top > innerHeight).map((a) => a.getAttribute('data-game')));
      expect((await state(page)).filter((c) => below.includes(c.game)).every((c) => c.src === '')).toBe(true);

      await page.locator('a.ba-tile[data-game="squat-flap"]').scrollIntoViewIfNeeded();
      await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap'), { timeout: 20_000 }).toMatchObject({ playing: true, on: true });

      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap')?.playing, { timeout: 10_000 }).toBe(false);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap')?.playing, { timeout: 10_000 }).toBe(true);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap')?.playing, { timeout: 10_000 }).toBe(false);
    } finally {
      await context.close();
    }
  });
});
