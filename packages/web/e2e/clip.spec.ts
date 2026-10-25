// The highlight clip, on a real game and the real session in real time (a recorder runs on the browser's clock): a round of thirty
// seconds (the tour's first round, by keyboard) ends with a clip of its last seconds on the results, a video made on this device from
// the game view; it is shared as a file where the browser takes one and saved where it does not, and it is not made when the player
// turned it off. The two recorders that take turns, the lengths and the pauses are held in app/clip.test.ts with a stand-in recorder.
import { expect, test, type Page } from '@playwright/test';
import { collectErrors } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const ROUND = `${WEB_DEV_URL}/play/squat-flap/?first=1&input=keyboard`;

/** Presses keys through the round and waits for the results. */
async function playToResults(page: Page): Promise<void> {
  await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
  const keys = ['Space', 'ArrowDown', 'Space', 'Space'];
  const end = Date.now() + 75_000;
  let n = 0;
  while (Date.now() < end) {
    if (page.url().includes('/results/')) return;
    await page.keyboard.press(keys[n++ % keys.length] ?? 'Space');
    await page.waitForTimeout(700);
  }
  throw new Error('the round did not reach the results');
}

test('a round ends with a clip of its last seconds: a video from the game view, to save, and to share as a file', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  // a share sheet that takes files, and a note of what it was given
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: { name: string; type: string; size: number; title?: string; text?: string; url?: string }[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { files?: File[] }) => Array.isArray(d.files) && d.files.length === 1 });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: { files: File[]; title?: string; text?: string; url?: string }) => {
        const f = d.files[0] as File;
        w.__shared.push({ name: f.name, type: f.type, size: f.size, ...(d.title !== undefined ? { title: d.title } : {}), ...(d.text !== undefined ? { text: d.text } : {}), ...(d.url !== undefined ? { url: d.url } : {}) });
      },
    });
  });
  await page.goto(ROUND);
  await playToResults(page);

  const card = page.locator('[data-clip]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Your highlight');
  await expect(card).toContainText('without your camera picture');
  const video = card.locator('video');
  const src = await video.getAttribute('src');
  expect(src, 'a page address of the clip').toMatch(/^blob:/);
  const info = await page.evaluate(async (u) => {
    const r = await fetch(u);
    const b = await r.blob();
    return { size: b.size, type: b.type };
  }, src as string);
  expect(info.size, 'a clip with something in it').toBeGreaterThan(5_000);
  expect(info.type).toMatch(/^video\/(mp4|webm)$/);
  // the video decodes: it has a size and a first frame
  await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(100);

  // saving: a file with the name of the game and the score
  const download = page.waitForEvent('download');
  await card.getByRole('link', { name: 'Save clip' }).click();
  expect((await download).suggestedFilename()).toMatch(/^bodyarcade-squat-flap-\d+\.(mp4|webm)$/);

  // sharing: the share sheet gets one video file, the words and the game's address (and nothing of the player but the score)
  await card.getByRole('button', { name: 'Share clip' }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
  const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; size: number; title?: string; text?: string; url?: string }[] }).__shared[0]);
  expect(shared?.name).toMatch(/^bodyarcade-squat-flap-\d+\.(mp4|webm)$/);
  expect(shared?.type).toMatch(/^video\//);
  expect(shared?.size).toBe(info.size);
  expect(shared?.text).toContain('on BodyArcade');
  expect(shared?.url).toContain('/games/squat-flap/');

  // the clip is the results' own: it is let go when the page goes on
  await page.getByRole('link', { name: /Choose another game|See all games|All \d+ games|games/i }).first().click();
  await expect(page.locator('[data-clip]')).toHaveCount(0);
  expect(errors.filter((e) => !/MediaRecorder|captureStream/i.test(e))).toEqual([]);
});

test('where the browser has no share sheet for files, sharing saves the clip and says so', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.goto(ROUND);
  await playToResults(page);
  await expect(page.locator('[data-clip]')).toBeVisible({ timeout: 15_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Share clip' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.(mp4|webm)$/);
  await expect(page.locator('.ba-toast')).toContainText('The clip was saved to your downloads.');
});

test('with the clips switched off in the settings a round ends with no clip', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(`${WEB_DEV_URL}/settings/`);
  await expect(page.locator('#set-clips')).toBeChecked();
  await page.locator('label[for="set-clips"]').click();
  await expect(page.locator('#set-clips')).not.toBeChecked();
  await page.goto(ROUND);
  await playToResults(page);
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('[data-clip]')).toHaveCount(0);
});
