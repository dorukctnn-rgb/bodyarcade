// The welcome tour in a real browser: a first visit is taken to it once and a script never is, the five pages move on and back
// (the address, the heading and the focus follow), what the player chose is kept, the 3D stage draws and steps down to the
// pre-rendered pictures where it cannot, the camera page hands over to the real first game and its own result, and every
// page keeps the layout rule on all ten sizes in both languages.
import { expect, test, type Page } from '@playwright/test';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from '../tools/layout-check.ts';
import { openScenario, type Scenario } from '../tools/scenarios.ts';
import { collectErrors, withHooks, type Hooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const STEPS: Scenario[] = ['welcome', 'welcome-2', 'welcome-3', 'welcome-4', 'welcome-5'];
const BASE_HOOKS: Hooks = { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };

const settingsOf = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('ba2.shell.settings') ?? '{"d":{}}') as { d: Record<string, unknown> }).d);

/** How many different colours (in sixteen steps per channel) a canvas shows: a stage that drew nothing shows one. */
const coloursOf = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const c = document.querySelector('canvas[data-canvas]') as HTMLCanvasElement;
    const t = document.createElement('canvas');
    t.width = 48;
    t.height = 48;
    const x = t.getContext('2d') as CanvasRenderingContext2D;
    x.drawImage(c, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4) seen.add(((d[i] as number) >> 4 << 8) | ((d[i + 1] as number) >> 4 << 4) | ((d[i + 2] as number) >> 4));
    return seen.size;
  });

test('a first visit to the home page is taken to the tour once, and skipping it is remembered', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await withHooks(page, { ...BASE_HOOKS, tour: 'static' });
  await page.addInitScript(() => { window.__BA_TEST__ = { ...(window.__BA_TEST__ ?? {}), tour: 'first' }; });
  await page.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/welcome\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Squat, jump, punch/);
  await page.getByRole('button', { name: 'Skip the tour' }).click();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  expect((await settingsOf(page))['onboardingDone']).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(`${WEB_DEV_URL}/`);
  expect(errors).toEqual([]);
  await context.close();
});

test('a script is not taken to the tour: the page that is listed is the page it gets', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await withHooks(page, BASE_HOOKS);
  await page.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(`${WEB_DEV_URL}/`);
  await context.close();
});

test('the five pages move on and back with the address, the heading and the focus, and the stage stays', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome', { w: 390, h: 844 });
  await page.evaluate(() => { (window as unknown as { __canvas: Element | null }).__canvas = document.querySelector('canvas[data-canvas]'); });
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(/Squat, jump, punch/);
  await page.getByRole('button', { name: 'Start' }).click();
  for (const n of [2, 3, 4, 5]) {
    await expect(page).toHaveURL(new RegExp(`/welcome/\\?step=${n}`));
    await expect(page.locator('.ob-progress span')).toHaveText(`Step ${n} of 7`);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    if (n < 5) await page.getByRole('button', { name: n === 4 ? 'I have the space' : 'Next' }).click();
  }
  // Back (the browser's own) goes one page back without drawing the page again: the very same canvas is there.
  await page.goBack();
  await expect(page).toHaveURL(/step=4/);
  await page.goBack();
  await expect(page).toHaveURL(/step=3/);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Element | null }).__canvas === document.querySelector('canvas[data-canvas]'))).toBe(true);
  // The button too.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/step=2/);
  expect(errors).toEqual([]);
  await context.close();
});

test('the choices are real controls, work from the keyboard, and are kept when the tour moves on', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome-3', { w: 1280, h: 800 });
  // regions: two are on to begin with, the player takes legs off and puts arms on
  const legs = page.getByRole('button', { name: 'Legs' });
  const arms = page.getByRole('button', { name: 'Arms' });
  await expect(legs).toHaveAttribute('aria-pressed', 'true');
  await expect(arms).toHaveAttribute('aria-pressed', 'false');
  await legs.click();
  await arms.focus();
  await page.keyboard.press('Space');
  await expect(legs).toHaveAttribute('aria-pressed', 'false');
  await expect(arms).toHaveAttribute('aria-pressed', 'true');
  // level: a radio group, the arrow keys move inside it
  await page.getByRole('radio', { name: /Strong/ }).check({ force: true });
  await expect(page.getByRole('radio', { name: /Strong/ })).toBeChecked();
  await page.getByRole('radio', { name: /Gentle/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Steady/ })).toBeChecked();
  await page.getByRole('radio', { name: /Strong/ }).check({ force: true });
  // the two modes
  await page.getByRole('checkbox', { name: /Seated mode/ }).check({ force: true });
  await expect(page.locator('.ob-mode', { hasText: 'Seated mode' })).toContainText('seated version');
  await page.getByRole('button', { name: 'Next' }).click();
  // the camera: a laptop, and two players on a screen that has the room
  await expect(page.getByRole('radio', { name: 'Just me' })).toBeChecked();
  await page.getByRole('radio', { name: 'Laptop' }).check({ force: true });
  await expect(page.locator('[data-device-text]')).toContainText('Tilt the screen back');
  await page.getByRole('radio', { name: '2 players, one camera' }).check({ force: true });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clear about 3 metres for the two of you.');
  await expect(page.getByRole('radio', { name: 'TV' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Upright' })).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('value'))).toBe('2');
  await page.getByRole('radio', { name: 'Just me' }).check({ force: true });
  await page.getByRole('button', { name: 'I have the space' }).click();
  await expect(page).toHaveURL(/step=5/);
  // the last page: what was chosen is kept the moment the camera is asked for
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/play\/squat-flap\/\?/);
  const s = await settingsOf(page);
  expect(s).toMatchObject({ regions: ['arms', 'cardio'], level: 'strong', seated: true, quiet: false, device: 'laptop', onboardingDone: true });
  expect(errors).toEqual([]);
  await context.close();
});

test('a phone is not offered two players on one camera', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'welcome-4', { w: 390, h: 844 });
  await expect(page.getByRole('radio', { name: '2 players, one camera' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Upright' })).toBeChecked();
  await page.getByRole('radio', { name: 'Sideways' }).check({ force: true });
  await expect(page.locator('[data-device-text]')).toContainText('Sideways shows more of the room');
  await context.close();
});

test('the camera page hands over to the real first game, and the result is the first game\'s own', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome-5', { w: 390, h: 844 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/play\/squat-flap\/\?.*first=1/);
  // the tour has just said what the camera is for: the play page does not say it again
  await page.waitForSelector('.cal, .ba-countdown, [data-hud="statusLeft"]', { timeout: 20_000 });
  expect(await page.locator('[data-action="camera-continue"]').count()).toBe(0);
  await page.waitForURL(/\/results\//, { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your first game is done.');
  await expect(page.locator('[data-first-saved]')).toHaveText('Saved on this device.');
  await expect(page.getByRole('link', { name: 'Play the full round' })).toHaveAttribute('href', /\/play\/squat-flap\/\?(?!.*first)/);
  await expect(page.getByRole('link', { name: /See all \d+ games/ })).toHaveAttribute('href', '/');
  expect(errors).toEqual([]);
  await context.close();
});

test('the 3D stage draws a picture on every page, and a still one when the tour is told to hold it', async ({ browser }) => {
  for (const name of STEPS) {
    const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w: 1280, h: 800 });
    expect(await coloursOf(page), name).toBeGreaterThan(8);
    expect(errors, name).toEqual([]);
    await context.close();
  }
});

test('where the stage cannot be drawn the pictures made of the same scene stand in, a loop on the first page and a still on the others', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome', { w: 390, h: 844, hooks: { ...BASE_HOOKS, tour: 'fallback' } });
  await expect(page.locator('.ob-stage')).toHaveClass(/is-fallback/);
  await expect(page.locator('canvas[data-canvas]')).toBeHidden();
  const loop = page.locator('video[data-loop]');
  await expect(loop).toBeVisible();
  expect(await loop.locator('source').count()).toBe(2);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/step=2/);
  const still = page.locator('img[data-poster]');
  await expect(still).toBeVisible();
  await expect.poll(() => still.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 100)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('where the browser has no WebGL the tour falls back to the pictures by itself', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await withHooks(page, BASE_HOOKS);
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
      return (real as (k: string, ...r: unknown[]) => unknown).call(this, kind, ...rest) as never;
    } as typeof real;
  });
  await page.goto(`${WEB_DEV_URL}/welcome/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-welcome][data-ready="1"]');
  await expect(page.locator('.ob-stage')).toHaveClass(/is-fallback/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Squat, jump, punch/);
  expect(errors.filter((e) => !/WebGL|webgl|context/i.test(e))).toEqual([]);
  await context.close();
});

test('a visitor who asked for less motion gets the stage still', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await withHooks(page, BASE_HOOKS);
  await page.goto(`${WEB_DEV_URL}/welcome/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-welcome][data-ready="1"]');
  await page.waitForTimeout(500);
  const first = await page.evaluate(() => (document.querySelector('canvas[data-canvas]') as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(900);
  const later = await page.evaluate(() => (document.querySelector('canvas[data-canvas]') as HTMLCanvasElement).toDataURL());
  expect(later).toBe(first);
  await context.close();
});

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: every page of the tour keeps the layout rule, with its button in sight`, async ({ browser }) => {
    test.setTimeout(180_000);
    const found: string[] = [];
    for (const name of STEPS) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w: bp.w, h: bp.h });
      try {
        for (const p of [...(await checkPage(page)), ...errors.map((e) => `console: ${e}`)]) found.push(`${name}: ${p}`);
        // the one button that moves the tour on is whole on the screen, and the panel's text is not cut off by its own box
        const box = await page.locator('[data-action="tour-next"]').boundingBox();
        if (!box || box.y < 0 || box.y + box.height > bp.h + 1 || box.x < 0 || box.x + box.width > bp.w + 1) found.push(`${name}: the button is not whole on the screen (${JSON.stringify(box)})`);
        const clipped = await page.evaluate(() => {
          const out: string[] = [];
          for (const n of document.querySelectorAll<HTMLElement>('.ob-panel h1, .ob-panel .ob-text, .ob-panel .ob-points b, .ob-panel .ob-level b, .ob-panel .ob-mode b')) {
            if (n.scrollWidth > n.clientWidth + 1) out.push(`${n.className || n.tagName} is wider than its box`);
          }
          return out;
        });
        for (const c of clipped) found.push(`${name}: ${c}`);
      } finally {
        await context.close();
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('the Turkish tour keeps the layout rule on a narrow phone and a laptop (longer words)', async ({ browser }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  for (const [w, h] of [[360, 780], [1280, 800]] as const) {
    for (const name of STEPS) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w, h, lang: 'tr' });
      try {
        expect(await page.locator('html').getAttribute('lang')).toBe('tr');
        for (const p of [...(await checkPage(page)), ...errors.map((e) => `console: ${e}`)]) found.push(`tr ${name} ${w}: ${p}`);
        const box = await page.locator('[data-action="tour-next"]').boundingBox();
        if (!box || box.y + box.height > h + 1) found.push(`tr ${name} ${w}: the button is not whole on the screen`);
      } finally {
        await context.close();
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
