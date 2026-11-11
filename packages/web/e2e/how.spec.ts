// The top of the home page (views/how.ts, app/how-scene.ts): the scene is there as a still at once (the bottom of the squat), moves once
// the page has loaded (both pictures from the same moment), keeps the still for a script, reduced motion and saving data, and never
// shifts the layout. Development build (Vite dev server).
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** The first moving shape of each picture: the person's left thigh and the character's outline of it. */
const first = (page: Page) => page.evaluate(() => ['[data-how-person] [data-g]', '[data-how-mover] [data-g]'].map((s) => document.querySelector(s)?.getAttribute('y2') ?? ''));

test.describe('how it works, at the top of the home page', () => {
  test('the heading, one line, two buttons, the two pictures and the three steps; a script gets the still', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/`);
    const how = page.locator('section.k-how');
    await expect(how.getByRole('heading', { level: 1 })).toHaveText('Your body is the controller.');
    await expect(how.locator('.k-actions a')).toHaveCount(2);
    await expect(how.locator('.k-how-pane svg')).toHaveCount(2);
    await expect(how.locator('.k-how-steps li')).toHaveCount(3);
    const still = await first(page);
    await page.waitForTimeout(800);
    expect(await first(page)).toEqual(still);
    await expect(how).not.toHaveAttribute('data-how-live', '');
    expect(errors).toEqual([]);
  });

  test('moves once the page has loaded, the character with the person, and the layout stays put', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, { clips: true });
    await page.goto(`${WEB_DEV_URL}/`);
    const box = await page.locator('.k-how-scene').boundingBox();
    const still = await first(page);
    await expect(page.locator('section.k-how')).toHaveAttribute('data-how-live', '', { timeout: 15_000 });
    await expect.poll(async () => (await first(page))[0], { timeout: 10_000 }).not.toBe(still[0]);
    const a = await first(page);
    // both pictures moved in the same frame (the character's thigh is drawn from the person's)
    expect(a[1]).not.toBe(still[1]);
    expect(await page.locator('.k-how-scene').boundingBox()).toEqual(box);
    expect(errors).toEqual([]);
  });

  test('reduced motion and saving data keep the still', async ({ page }) => {
    await withHooks(page, { clips: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${WEB_DEV_URL}/`);
    const still = await first(page);
    await page.waitForTimeout(1200);
    expect(await first(page)).toEqual(still);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }); });
    await page.goto(`${WEB_DEV_URL}/`);
    await page.waitForTimeout(1200);
    expect(await first(page)).toEqual(still);
  });
});
