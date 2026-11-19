// The real people in motion of the home page (app/motion-cards.ts): the game tiles, the body areas, the picker, "how it works" and the form
// coach. A clip plays over its poster only where it should, at most a few at once, with the body line drawn on its frames, and nothing is
// fetched where it should not. Development build (Vite dev server). A script never gets the clips unless the test hook asks for them.
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const cards = (page: Page) => page.locator('.k-mo');

/** What each card of the page is doing: its clip, its address, whether it plays and whether its canvas is shown. */
const state = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.k-mo')].map((el) => {
  // the video is made by the app when the clip is to play: none before
  const v = el.querySelector('video');
  return { id: el.dataset['mo'] ?? '', game: el.closest('a.ba-tile')?.getAttribute('data-game') ?? '', src: v?.getAttribute('src') ?? '', playing: !!v && !v.paused && v.currentTime > 0, live: el.classList.contains('is-live') };
}));

/** The layout of a tile: where it lies on the page and the size of its picture box (offset sizes: the hover lift is a transform). */
const pageBox = (page: Page, game: string) => page.locator(`a.ba-tile[data-game="${game}"]`).evaluate((a) => {
  const r = a.getBoundingClientRect();
  const art = a.querySelector<HTMLElement>('.art');
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height, artWidth: art?.offsetWidth ?? 0, artHeight: art?.offsetHeight ?? 0 };
});

/** How many colours (sixteen steps a channel) the canvas of a card shows: the frame and its line, or nothing yet (one). */
const canvasColours = (page: Page, game: string) => page.locator(`a.ba-tile[data-game="${game}"] canvas.k-mo-canvas`).evaluate((c: HTMLCanvasElement) => {
  const g = c.getContext('2d');
  if (!g || c.width < 2) return 0;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < d.length; i += 4 * 97) seen.add(((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4));
  return seen.size;
});

/** Whether this engine plays one of the formats (VP9 in WebM, H.264 in MP4); one without either keeps the posters. */
const playable = (page: Page) => page.evaluate(() => {
  const v = document.createElement('video');
  return v.canPlayType('video/webm; codecs="vp9"') === 'probably' || v.canPlayType('video/mp4; codecs="avc1.64001F"') !== '';
});

test.describe('real people in motion', () => {
  test('every card shows its poster (the first frame with its body line), and a script, reduced motion and saving data fetch no clip', async ({ page }) => {
    const fetched: string[] = [];
    page.on('request', (r) => { if (/\/assets\/clips\/mo-/.test(r.url())) fetched.push(r.url()); });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('.ba-grid').waitFor();
    // a person for each of the 11 games, the 7 body areas, the picker's four choices, "how it works" and the form coach
    await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(11 + 7 + 4 + 2);
    await page.locator('.ba-grid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    expect((await state(page)).every((c) => c.src === '')).toBe(true);
    // the poster of a tile on the screen is loaded (a lazy picture near the screen)
    await expect.poll(() => page.locator('a.ba-tile[data-game="squat-flap"] .k-mo-poster img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

    await withHooks(page, { clips: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('.ba-grid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    expect((await state(page)).every((c) => c.src === '')).toBe(true);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }); });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('.ba-grid').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    expect((await state(page)).every((c) => c.src === '')).toBe(true);
    expect(fetched).toEqual([]);
  });

  test('on a wide screen the cards on the screen play with their body line, at most four at once, and pause off the screen', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, { clips: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${WEB_DEV_URL}/`);
    test.skip(!(await playable(page)), 'this engine plays neither format: the cards keep their posters');
    // nothing below the screen
    await page.waitForTimeout(800);
    const below = await page.evaluate(() => [...document.querySelectorAll('.k-mo')].filter((a) => a.getBoundingClientRect().top > innerHeight).map((a) => (a as HTMLElement).dataset['mo']));
    expect(below.length).toBeGreaterThan(0);
    expect((await state(page)).filter((c) => c.game && c.src).length).toBe(0);

    const box = await pageBox(page, 'squat-flap');
    await page.evaluate(() => document.querySelector('.ba-grid')?.scrollIntoView({ block: 'start' }));
    await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap'), { timeout: 20_000 }).toMatchObject({ playing: true, live: true });
    expect((await state(page)).find((c) => c.game === 'squat-flap')?.src).toMatch(/\/assets\/clips\/mo-squat-tile\.(webm|mp4)$/);
    // the frame and its line are drawn on the canvas
    await expect.poll(() => canvasColours(page, 'squat-flap'), { timeout: 10_000 }).toBeGreaterThan(8);
    // never more than four at once
    for (let i = 0; i < 4; i += 1) {
      expect((await state(page)).filter((c) => c.playing).length).toBeLessThanOrEqual(4);
      await page.waitForTimeout(300);
    }
    // the clip lies over the poster: the tile did not move or change size
    expect(await pageBox(page, 'squat-flap')).toEqual(box);
    // it keeps moving: two moments, two different times
    const t0 = await page.locator('a.ba-tile[data-game="squat-flap"] video').evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.waitForTimeout(700);
    const t1 = await page.locator('a.ba-tile[data-game="squat-flap"] video').evaluate((v: HTMLVideoElement) => v.currentTime);
    expect(t1).not.toBe(t0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap')?.playing, { timeout: 10_000 }).toBe(false);
    expect(errors).toEqual([]);
  });

  test('on a phone at most two play at once, and they pause in a hidden tab', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US' });
    const page = await context.newPage();
    try {
      await withHooks(page, { clips: true });
      await page.goto(`${WEB_DEV_URL}/`);
      test.skip(!(await playable(page)), 'this engine plays neither format: the cards keep their posters');
      await page.locator('a.ba-tile[data-game="squat-flap"]').scrollIntoViewIfNeeded();
      await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap'), { timeout: 20_000 }).toMatchObject({ playing: true });
      for (let i = 0; i < 4; i += 1) {
        expect((await state(page)).filter((c) => c.playing).length).toBeLessThanOrEqual(2);
        await page.waitForTimeout(300);
      }
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => (await state(page)).some((c) => c.playing), { timeout: 10_000 }).toBe(false);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => (await state(page)).find((c) => c.game === 'squat-flap')?.playing, { timeout: 10_000 }).toBe(true);
    } finally {
      await context.close();
    }
  });
});
