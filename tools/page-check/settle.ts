// Waits until a page holds still: fonts, the pictures, the animations that end. Used before the probe and the picture of a screen.
import type { Page } from '@playwright/test';

/**
 * A picture the browser has not loaded yet (a lazy one under the first screen) is loaded on purpose, so that the picture of the
 * screen and the checks see what a visitor who scrolls sees. decode() alone would wait for ever for it: WebKit never loads a lazy
 * image that is far from the screen, and its decode() never answers (the page check of the home page hung there for 180 s). Every
 * wait is bounded.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 6000))]);
    const pending = [...document.images].filter((i) => !i.complete);
    for (const i of pending) if (i.loading === 'lazy') i.loading = 'eager';
    await Promise.race([Promise.all(pending.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 6000))]);
    const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2500))]);
  });
  await page.waitForTimeout(120);
}
