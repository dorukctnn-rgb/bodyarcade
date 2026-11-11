// The share clip and the two modes, end to end in a browser on the practice session: the office break from its card on the home page
// through its four short seated rounds, family mode in turns on a phone and together on a big screen (two scores a round, the board, the
// winner), and the vertical clip of a round made by the browser's own recorder (nine seconds of 9:16, the site's name on every frame,
// the 3D figure, shared as a file or saved). The rules are held in the unit tests (short-round, family, story-clip, modes-views).
import { expect, test, type Page } from '@playwright/test';
import { STORY_H, STORY_W } from '../src/app/story-clip.ts';
import { CLIP_BRAND } from '../src/app/clip.ts';
import { collectErrors, useKeyboard, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** A round of the practice session takes a second or two. */
const FAST = { timeScale: 40, forceDemo: true, keyboard: true } as const;

/** The camera is explained and allowed already, so a round goes straight to its calibration. */
async function cameraReady(page: Page): Promise<void> {
  await page.context().grantPermissions(['camera']);
  await page.addInitScript(() => { localStorage.setItem('ba2.shell.cameraExplained', JSON.stringify({ v: 1, d: true })); });
}

test.describe('the office break', () => {
  test('from its card on the home page through its four short seated rounds, 45 seconds each, to the end of the plan', async ({ page }) => {
    const errors = collectErrors(page);
    await cameraReady(page);
    await withHooks(page, FAST);
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('[data-mode-card="office"]').click();
    await expect(page).toHaveURL(/\/office\/$/);
    await expect(page.locator('h1')).toHaveText('Desk break');
    await expect(page.locator('[data-office]')).toContainText('Office break');
    await expect(page.locator('[data-office-step]')).toHaveCount(4);
    await expect(page.locator('[data-office-tip]')).toHaveCount(4);
    await expect(page.locator('.k-officemoves')).toContainText('45 seconds');

    await page.getByRole('button', { name: 'Start the office break' }).click();
    const games = [['star-catch', 'Star Catch'], ['twist-turbine', 'Twist Turbine'], ['squat-flap', 'Squat Flap'], ['pose-wall', 'Pose Wall']] as const;
    for (const [i, [slug]] of games.entries()) {
      await expect(page).toHaveURL(new RegExp(`/play/${slug}/\\?.*plan=1`));
      await expect(page).toHaveURL(/seated=1/);
      await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
      // the round was the short one
      await expect(page.locator('.k-stats')).toContainText('0:45');
      const next = games[i + 1];
      if (next) {
        const panel = page.locator('[data-plan-panel="next"]');
        await expect(panel).toContainText(`Desk break: game ${i + 1} of 4 done`);
        await expect(panel).toContainText(`Next: ${next[1]}`);
        await panel.getByRole('link', { name: `Start ${next[1]}` }).click();
      }
    }
    const over = page.locator('[data-plan-panel="over"]');
    await expect(over).toContainText('Plan done: Desk break');
    await expect(over).toContainText('4 of 4 games played in 3 minutes.');
    expect(errors).toEqual([]);
  });
});

test.describe('family mode', () => {
  test('on a phone the two players take turns: Player 1, then Player 2 on the same game, three games, then who won', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await cameraReady(page);
    await withHooks(page, FAST);
    await page.goto(`${WEB_DEV_URL}/family/`);
    await expect(page.locator('h1')).toHaveText('Family mode');
    await expect(page.locator('[data-family-hint="narrow"]')).toContainText('needs a bigger screen');
    await expect(page.locator('input[name="family-mode"][value="together"]')).toBeDisabled();
    await expect(page.locator('input[name="family-mode"][value="turns"]')).toBeChecked();
    // the party set is part of Pro
    await expect(page.locator('[data-family-set-card="party"]').getByRole('link', { name: 'Start with Pro' })).toBeVisible();

    await page.getByRole('button', { name: 'Start Family classic' }).click();
    const order = ['star-catch', 'star-catch', 'pose-wall', 'pose-wall', 'squat-flap', 'squat-flap'];
    for (const [i, slug] of order.entries()) {
      await expect(page).toHaveURL(new RegExp(`/play/${slug}/\\?.*family=1`));
      await expect(page).toHaveURL(/players=1/);
      await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
      if (i === order.length - 1) break;
      const panel = page.locator('[data-family-panel="next"]');
      await expect(panel).toBeVisible();
      if (i % 2 === 0) await expect(panel.locator('[data-family-next]')).toHaveText(/^Now hand over to Player 2 for /);
      else await expect(panel.locator('[data-family-next]')).toHaveText(/^Player 1 plays .* next\.$/);
      await panel.locator('[data-action="family-go"]').click();
    }
    const over = page.locator('[data-family-panel="over"]');
    await expect(over).toContainText('The family evening is over');
    await expect(over.locator('.k-verdict')).toHaveText(/wins the evening, \d[\d,]* points to \d[\d,]*\.|^A draw, /);
    await expect(over.locator('.k-familytable tbody tr')).toHaveCount(3);
    // the evening is over: the family page offers a new one, and no evening is going
    await page.goto(`${WEB_DEV_URL}/family/`);
    await expect(page.locator('[data-family-going]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('on a big screen they play together: two players a round, two scores on the board, and the evening can be ended', async ({ page }) => {
    const errors = collectErrors(page);
    await cameraReady(page);
    await withHooks(page, FAST);
    await page.goto(`${WEB_DEV_URL}/family/`);
    await expect(page.locator('input[name="family-mode"][value="together"]')).toBeChecked();
    await expect(page.locator('[data-family-hint="together"]')).toContainText('Player 1 on the left, Player 2 on the right');
    await page.getByRole('button', { name: 'Start Family classic' }).click();
    await expect(page).toHaveURL(/\/play\/star-catch\/\?.*players=2/);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    const panel = page.locator('[data-family-panel="next"]');
    await expect(panel.locator('[data-family-next]')).toHaveText('Next game: Pose Wall. Both of you in front of the camera.');
    const p1 = Number((await panel.locator('[data-family-total="1"]').textContent())?.replace(/\D/g, ''));
    const p2 = Number((await panel.locator('[data-family-total="2"]').textContent())?.replace(/\D/g, ''));
    expect(p1 + p2).toBeGreaterThan(0);
    // the round's own results are the two players'
    await expect(page.locator('.k-duocols').first()).toBeVisible();
    await panel.locator('[data-action="family-go"]').click();
    await expect(page).toHaveURL(/\/play\/pose-wall\/\?.*players=2/);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    await page.locator('[data-family-panel="next"]').getByRole('button', { name: 'End the evening' }).click();
    await expect(page.locator('.ba-toast')).toContainText('The family evening is closed.');
    await expect(page.locator('[data-family-panel]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

type Wrote = { text: string; w: number; h: number };

test.describe('the vertical clip', () => {
  test('a round ends with the offer; nine seconds later the clip is there, 9:16, with the 3D figure and the site on it, and it is saved where it cannot be shared', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __wrote: Wrote[] };
      w.__wrote = [];
      const real = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, ...rest: [number, number, number?]): void {
        try { if (w.__wrote.length < 20000) w.__wrote.push({ text: String(text), w: this.canvas.width, h: this.canvas.height }); } catch { /* no size to tell */ }
        return real.call(this, text, ...rest);
      } as typeof real;
    });
    await withHooks(page, { ...FAST, roundSeconds: 30 });
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: /^Play/ }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });

    const card = page.locator('[data-story]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('There is no camera picture in it');
    // no video on the page until there is a clip to show
    await expect(card.locator('video')).toHaveCount(0);
    await card.getByRole('button', { name: 'Make the clip' }).click();
    await expect(card.locator('[data-story-progress]')).toBeVisible();
    await expect(card).toHaveAttribute('data-story', 'ready', { timeout: 40_000 });
    await expect(card).toHaveAttribute('data-story-figure', '3d');

    const video = card.locator('video');
    const src = (await video.getAttribute('src')) as string;
    expect(src).toMatch(/^blob:/);
    const info = await page.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return { size: b.size, type: b.type }; }, src);
    expect(info.size, 'a clip with something in it').toBeGreaterThan(20_000);
    expect(info.type).toMatch(/^video\/(mp4|webm)$/);
    await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const dims = await video.evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight, d: v.duration }));
    expect(dims.w).toBe(STORY_W);
    expect(dims.h).toBe(STORY_H);
    if (Number.isFinite(dims.d)) { expect(dims.d).toBeGreaterThan(7.5); expect(dims.d).toBeLessThan(10.5); }

    // what was written on the clip's own canvas: the site's name on every frame, the game, the score's unit
    const wrote = (await page.evaluate(() => (window as unknown as { __wrote: Wrote[] }).__wrote)).filter((x) => x.w === STORY_W && x.h === STORY_H);
    const texts = new Set(wrote.map((x) => x.text));
    expect(texts.has(CLIP_BRAND)).toBe(true);
    expect(texts.has('Squat Flap')).toBe(true);
    expect([...texts].some((t) => /Can you beat/.test(t))).toBe(true);
    expect(wrote.filter((x) => x.text === CLIP_BRAND).length, 'the site on frame after frame').toBeGreaterThan(100);

    // frames that are not black: the figure and the card over the game
    const shots = process.env['BA_STORY_SHOTS'];
    for (const at of [1.2, 3.5, 6.1, 8.6]) {
      const dark = await video.evaluate(async (v: HTMLVideoElement, t: number) => {
        v.muted = true;
        v.pause();
        v.currentTime = t;
        await new Promise<void>((res) => { v.addEventListener('seeked', () => res(), { once: true }); window.setTimeout(res, 3000); });
        const c = document.createElement('canvas');
        c.width = 36;
        c.height = 64;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.drawImage(v, 0, 0, 36, 64);
        const d = g.getImageData(0, 0, 36, 64).data;
        let black = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.max(d[i] as number, d[i + 1] as number, d[i + 2] as number) < 10) black++;
        return black / (36 * 64);
      }, at);
      expect(dark, `the frame at ${at} s is drawn`).toBeLessThan(0.6);
      // BA_STORY_SHOTS=<folder> keeps the frames, to look at
      if (shots) {
        const png = await video.evaluate(async (v: HTMLVideoElement) => {
          const c = document.createElement('canvas');
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          (c.getContext('2d') as CanvasRenderingContext2D).drawImage(v, 0, 0);
          return c.toDataURL('image/png');
        });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(`${shots}/story-${String(at).replace('.', '_')}.png`, Buffer.from(png.split(',')[1] as string, 'base64'));
      }
    }

    // where the browser cannot share files, the clip is saved, and the player is told
    const download = page.waitForEvent('download', { timeout: 15_000 });
    await card.getByRole('button', { name: 'Share' }).click();
    expect((await download).suggestedFilename()).toMatch(/^bodyarcade-squat-flap-\d+-vertical\.(mp4|webm)$/);
    await expect(page.locator('.ba-toast', { hasText: 'The clip was saved to your downloads.' })).toBeVisible();
    await expect(card.locator('[data-story-save]')).toHaveAttribute('download', /-vertical\.(mp4|webm)$/);
    expect(errors).toEqual([]);
  });

  test('a child\'s profile, which may not share, is not offered the clip', async ({ page }) => {
    await withHooks(page, { ...FAST, roundSeconds: 20, plan: 'family', players: [{ name: 'Ada', active: false }, { name: 'Kid', kid: true, active: true }] });
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: /^Play/ }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    await expect(page.locator('[data-story]')).toHaveCount(0);
  });
});
