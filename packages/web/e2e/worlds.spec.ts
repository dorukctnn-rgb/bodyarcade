// Road Run's world picker through the real page: a free player sees the three free worlds playable and the seven Pro ones
// locked (a click opens the offer), a Pro player (the test hook fakes the entitlement the way the other specs do) starts any
// of the ten and the scene is built for that world (the canvas says data-world), the last choice is kept on the device, and
// the picker works with the keyboard and a screen reader's names. Real game code and the 3D scene, headless Chromium.
import { expect, test, type Page } from '@playwright/test';
import { scan } from './support/axe.ts';
import { collectErrors, useKeyboard, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const IDS = ['alps', 'desert', 'forest', 'storm', 'sunset', 'arctic', 'jungle', 'city', 'volcano', 'coast'] as const;
const FREE = ['alps', 'desert', 'forest'];
const NAMES = ['Alps', 'Desert', 'Forest', 'Storm', 'Sunset', 'Arctic', 'Jungle', 'City', 'Volcano', 'Coast'];

/** The countdown and the loading are over and the HUD is up. */
async function inRound(page: Page): Promise<void> {
  await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 60_000 });
}

const checked = (page: Page): Promise<string> => page.locator('input[name="world"]:checked').inputValue();
const tile = (page: Page, id: string) => page.locator(`label.k-world:has(input[name="world"][value="${id}"])`);

async function leaveRound(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const paused = page.getByRole('dialog', { name: 'Paused' });
  await expect(paused).toBeVisible();
  await paused.getByRole('button', { name: 'Leave round' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/\/games\/road-run\/$/);
}

test.describe('a free player', () => {
  test('sees ten worlds, three of them free and seven locked, and a locked one opens the offer instead of changing the choice', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/games/road-run/`);
    const group = page.getByRole('group', { name: 'World' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(10);
    for (const [i, id] of IDS.entries()) {
      const locked = !FREE.includes(id);
      await expect(tile(page, id)).toContainText(NAMES[i] as string);
      await expect(tile(page, id).locator('.wlock'), id).toHaveCount(locked ? 1 : 0);
      // a screen reader hears that the world is part of Pro
      await expect(group.getByRole('radio', { name: locked ? `${NAMES[i]} (Pro)` : (NAMES[i] as string) }), id).toHaveCount(1);
    }
    await expect(group).toContainText('3 of 10 worlds are free. The others are part of Pro.');
    expect(await checked(page)).toBe('alps');

    await tile(page, 'storm').click();
    await expect(page).toHaveURL(/\/pro\/\?game=road-run$/);
    await expect(page.locator('h1').first()).toBeVisible();
    // back to the game: the choice is still a free world, never the locked one
    await page.goBack();
    await expect(page).toHaveURL(/\/games\/road-run\/$/);
    expect(await checked(page)).toBe('alps');
    expect(errors).toEqual([]);
  });

  test('plays a free world (the scene is that world), and the next visit opens on it', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/games/road-run/`);
    await tile(page, 'desert').click();
    expect(await checked(page)).toBe('desert');
    await expect(page.locator('#setup-world-hint')).toContainText('Heat haze, dunes and tall saguaros.');
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/world=desert/);
    await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
    await inRound(page);
    await expect(page.locator('[data-scene] canvas')).toHaveAttribute('data-world', 'desert');
    await leaveRound(page);
    expect(await checked(page)).toBe('desert');
    await page.reload();
    expect(await checked(page)).toBe('desert');
    expect(errors).toEqual([]);
  });

  test('cannot start a Pro world by writing its address: the round plays a free world', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/play/road-run/?input=keyboard&world=volcano`);
    await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
    await inRound(page);
    await expect(page.locator('[data-scene] canvas')).toHaveAttribute('data-world', 'alps');
    expect(errors).toEqual([]);
  });

  test('the picker works with the keyboard: the arrows move between worlds and the line under the tiles follows', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/road-run/`);
    await page.locator('input[name="world"][value="alps"]').focus();
    await page.keyboard.press('ArrowRight');
    expect(await checked(page)).toBe('desert');
    await expect(page.locator('input[name="world"][value="desert"]')).toBeFocused();
    await expect(page.locator('#setup-world-hint')).toContainText('Desert');
    await page.keyboard.press('ArrowRight');
    expect(await checked(page)).toBe('forest');
    await expect(page.locator('input[name="world"][value="forest"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    expect(await checked(page)).toBe('desert');
  });
});

test.describe('a Pro player', () => {
  test.beforeEach(async ({ page }) => { await withHooks(page, { plan: 'pro' }); });

  test('sees no lock, chooses a Pro world, plays it, and the next visit opens on it', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/games/road-run/`);
    await expect(page.locator('.k-world .wlock')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'World' })).not.toContainText('worlds are free');
    await tile(page, 'storm').click();
    await expect(page).toHaveURL(/\/games\/road-run\/$/);
    expect(await checked(page)).toBe('storm');
    await expect(page.locator('#setup-world-hint')).toContainText('Rain on the asphalt and lightning on the ridge.');
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/world=storm/);
    await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
    await inRound(page);
    await expect(page.locator('[data-scene] canvas')).toHaveAttribute('data-world', 'storm');
    await leaveRound(page);
    expect(await checked(page)).toBe('storm');
    await page.reload();
    expect(await checked(page)).toBe('storm');
    expect(errors).toEqual([]);
  });

  test('can start every one of the ten worlds, and the scene is built for each', async ({ page }) => {
    test.setTimeout(400_000);
    const errors = collectErrors(page);
    for (const id of IDS) {
      await page.goto(`${WEB_DEV_URL}/play/road-run/?input=keyboard&world=${id}`);
      await expect(page.locator('[data-scene] canvas'), id).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-scene] canvas'), id).toHaveAttribute('data-world', id, { timeout: 60_000 });
      await inRound(page);
    }
    expect(errors).toEqual([]);
  });

  test('a link to the game page that names a world opens on it', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/road-run/?world=coast`);
    expect(await checked(page)).toBe('coast');
  });
});

test.describe('in Turkish', () => {
  test('the picker has its Turkish names, legend and hint', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/tr/games/road-run/`);
    const group = page.getByRole('group', { name: 'Dünya' });
    await expect(group).toBeVisible();
    for (const name of ['Alpler', 'Çöl', 'Orman', 'Fırtına', 'Gün batımı', 'Kutup', 'Cangıl', 'Şehir', 'Yanardağ', 'Kıyı']) await expect(group).toContainText(name);
    await expect(group).toContainText('10 dünyadan 3 tanesi ücretsiz. Diğerleri Pro içindir.');
    await expect(group.getByRole('radio', { name: 'Fırtına (Pro)' })).toHaveCount(1);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the tiles fit the width and are big enough to touch', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/road-run/`);
    await expect(page.locator('.k-worldgrid')).toBeVisible();
    const sizes = await page.locator('label.k-world').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right }; }));
    expect(sizes).toHaveLength(10);
    for (const s of sizes) {
      expect(s.w).toBeGreaterThanOrEqual(44);
      expect(s.h).toBeGreaterThanOrEqual(44);
      expect(s.right).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await tile(page, 'forest').tap();
    expect(await checked(page)).toBe('forest');
  });

  test('on the narrowest common phones the ten tiles make rows of four, four and two, never a lone tile', async ({ page }) => {
    for (const width of [360, 375, 390, 412]) {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(`${WEB_DEV_URL}/games/road-run/`);
      await expect(page.locator('.k-worldgrid')).toBeVisible();
      const tops = await page.locator('label.k-world').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      const rows = [...new Set(tops)].map((t) => tops.filter((x) => x === t).length);
      expect(rows, `${width} px`).toEqual([4, 4, 2]);
    }
  });
});

test.describe('accessibility', () => {
  const SIZES = [{ w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }];

  for (const plan of ['free', 'pro'] as const) {
    test(`axe finds nothing on the game page with the picker (${plan}, English and Turkish, light and dark, phone, tablet and desktop)`, async ({ browser }) => {
      test.setTimeout(240_000);
      const found: string[] = [];
      for (const lang of ['en', 'tr'] as const) {
        for (const scheme of ['light', 'dark'] as const) {
          for (const size of SIZES) {
            const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, colorScheme: scheme, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
            try {
              const page = await context.newPage();
              await withHooks(page, { plan });
              await page.goto(`${WEB_DEV_URL}${lang === 'tr' ? '/tr' : ''}/games/road-run/`);
              await expect(page.locator('.k-worldgrid')).toBeVisible();
              for (const p of await scan(page)) found.push(`${plan} ${lang} ${scheme} ${size.w}x${size.h}: ${p}`);
            } finally {
              await context.close();
            }
          }
        }
      }
      expect(found, found.join(String.fromCharCode(10))).toEqual([]);
    });
  }
});
