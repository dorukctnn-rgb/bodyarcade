// The moving pictures at the top of the home page (app/hero-reel.ts): a clip of each game plays over its picture, the slides change on
// the clips' loops, and nothing is fetched or changed where it should not be. Development build (Vite dev server). A script never gets
// the clips unless the test hook asks for them.
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** What the reel is doing: the slide that is on, each clip's address, whether it plays and is shown, how far the active tick is. */
const state = (page: Page) => page.evaluate(() => {
  const reel = document.querySelector<HTMLElement>('.k-reel');
  const frames = [...document.querySelectorAll<HTMLElement>('.k-reel > .k-frame')];
  return {
    mode: reel?.dataset['reel'] ?? '',
    active: frames.findIndex((f) => f.classList.contains('is-active')),
    clips: frames.map((f) => {
      const v = f.querySelector<HTMLVideoElement>('video.k-vid');
      return { id: f.dataset['frame'] ?? '', src: v?.getAttribute('src') ?? '', playing: !!v && !v.paused && v.readyState >= 3 && v.currentTime > 0, time: v?.currentTime ?? 0, on: !!v?.classList.contains('is-on') };
    }),
    tick: [...document.querySelectorAll<HTMLElement>('.k-ticks i')].map((t) => t.style.getPropertyValue('--p')),
  };
});

/** The reel's box on the page, and the page's own height: nothing moves when a clip starts. */
const layout = (page: Page) => page.evaluate(() => {
  const r = document.querySelector('.k-reel')?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: r?.top ?? 0, width: r?.width ?? 0, height: r?.height ?? 0, page: document.documentElement.scrollHeight };
});

/** Whether this engine plays one of the formats (AV1 in WebM, H.264 in MP4); one without either keeps the pictures. */
const playable = (page: Page) => page.evaluate(() => {
  const v = document.createElement('video');
  return v.canPlayType('video/webm; codecs="av01.0.04M.08"') !== '' || v.canPlayType('video/mp4; codecs="avc1.64001F"') !== '';
});

test.describe('moving pictures at the top of the home page', () => {
  test('a script, a visitor who reduces motion and one who saves data get the pictures as they were, and no clip is fetched', async ({ page }) => {
    const fetched: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/assets/clips/hero-')) fetched.push(r.url()); });
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page.locator('.k-reel video.k-vid')).toHaveCount(4);
    await page.waitForTimeout(1500);
    let s = await state(page);
    expect(s.mode).toBe('');
    expect(s.clips.every((c) => c.src === '' && !c.on)).toBe(true);

    await withHooks(page, { clips: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.waitForTimeout(1500);
    s = await state(page);
    expect(s.mode).toBe('');
    expect(s.clips.every((c) => c.src === '')).toBe(true);
    // only the first picture and its marks are there: the rest of the frames and the ticks are not drawn
    await expect(page.locator('.k-reel .k-frame').first().locator('video.k-vid')).toBeHidden();
    await expect(page.locator('.k-reel .k-ticks')).toBeHidden();

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }); });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.waitForTimeout(1500);
    s = await state(page);
    expect(s.mode).toBe('');
    expect(s.clips.every((c) => c.src === '')).toBe(true);
    expect(fetched).toEqual([]);
  });

  test('on a wide screen the first clip plays over the picture, the slides then change on the clips\' loops, and nothing moves on the page', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await withHooks(page, { clips: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${WEB_DEV_URL}/`);
    test.skip(!(await playable(page)), 'this engine plays neither format: the pictures stay');
    // the reel is the second section, under the scene at the top (views/how.ts)
    await page.locator('.k-reel').scrollIntoViewIfNeeded();
    const before = await layout(page);
    expect(before.width).toBeGreaterThan(1000);

    // the clip of the slide on the screen arrives first; then the script has the fades
    await expect.poll(async () => (await state(page)).mode, { timeout: 60_000 }).toBe('clips');
    await expect.poll(async () => { const s = await state(page); return s.clips[s.active]?.playing === true && s.clips[s.active]?.on === true; }, { timeout: 30_000 }).toBe(true);
    const s1 = await state(page);
    const first = s1.active;
    // the wide crop, and the size for the card: the 1280 file for a card of about 1240 px on a screen of density 1
    expect(s1.clips[first]?.src).toMatch(new RegExp(`/assets/clips/hero-${s1.clips[first]?.id}-1280\\.(webm|mp4)$`));
    // the clip lies over the picture: the card did not move or change size
    expect(await layout(page)).toEqual(before);

    // the clip is moving: its clock goes on
    const t0 = (await state(page)).clips[first]?.time ?? 0;
    await page.waitForTimeout(1200);
    expect((await state(page)).clips[first]?.time ?? 0).toBeGreaterThan(t0 + 0.5);

    // one loop later the next slide is on, and its clip plays from its start
    const next = (first + 1) % 4;
    await expect.poll(async () => (await state(page)).active, { timeout: 15_000 }).toBe(next);
    await expect.poll(async () => (await state(page)).clips[next]?.playing, { timeout: 10_000 }).toBe(true);
    // on the second slide the first's clip is no longer needed on the screen, and the one after it has begun to load
    await expect.poll(async () => (await state(page)).clips[(next + 1) % 4]?.src !== '', { timeout: 10_000 }).toBe(true);
    // the ticks are the clip's progress: the one of the slide on is partly full, the others empty
    const tick = (await state(page)).tick;
    expect(Number(tick[next])).toBeGreaterThan(0);
    expect(tick.filter((_, i) => i !== next).every((v) => v === '0.000' || v === '')).toBe(true);

    // round and round: all four in turn
    const seen = new Set<number>([first, next]);
    for (let n = 0; n < 3; n += 1) {
      const s = await state(page);
      await expect.poll(async () => (await state(page)).active, { timeout: 15_000 }).not.toBe(s.active);
      seen.add((await state(page)).active);
    }
    expect(seen.size).toBe(4);
    expect(await layout(page)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test('on a phone the 4:3 clip plays, and it pauses off the screen and in a hidden tab', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'en-US', deviceScaleFactor: 3 });
    const page = await context.newPage();
    try {
      const errors = collectErrors(page);
      await withHooks(page, { clips: true });
      await page.goto(`${WEB_DEV_URL}/`);
      test.skip(!(await playable(page)), 'this engine plays neither format: the pictures stay');
      await page.locator('.k-reel').scrollIntoViewIfNeeded();
      const before = await layout(page);
      await expect.poll(async () => (await state(page)).mode, { timeout: 60_000 }).toBe('clips');
      await expect.poll(async () => { const s = await state(page); return s.clips[s.active]?.playing === true; }, { timeout: 30_000 }).toBe(true);
      const s = await state(page);
      expect(s.clips[s.active]?.src).toMatch(new RegExp(`/assets/clips/hero-${s.clips[s.active]?.id}-m-960\\.(webm|mp4)$`));
      expect(await layout(page)).toEqual(before);

      // a hidden tab: everything stops where it is, and goes on when the tab is back
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => (await state(page)).clips.some((c) => c.playing), { timeout: 10_000 }).toBe(false);
      const frozen = await state(page);
      await page.waitForTimeout(1500);
      const still = await state(page);
      expect(still.active).toBe(frozen.active);
      expect(still.tick).toEqual(frozen.tick);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => { const x = await state(page); return x.clips[x.active]?.playing === true; }, { timeout: 10_000 }).toBe(true);

      // off the screen: it stops, and goes on when the reel is back
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect.poll(async () => (await state(page)).clips.some((c) => c.playing), { timeout: 10_000 }).toBe(false);
      await page.evaluate(() => document.querySelector('.k-reel')?.scrollIntoView({ block: 'center' }));
      await expect.poll(async () => { const x = await state(page); return x.clips[x.active]?.playing === true; }, { timeout: 10_000 }).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
