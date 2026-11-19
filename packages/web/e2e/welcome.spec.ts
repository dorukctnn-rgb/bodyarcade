// The welcome tour in a real browser: nobody is taken to it by the address, the hero's Play free opens it for a first-timer, the five pages move on and back
// (the address, the heading and the focus follow), what the player chose is kept, the stage shows a real person with our body line
// (the poster for reduced motion, a script or where the clip is not to play), the camera page hands over to the real first game and
// its own result, and every page keeps the layout rule on all ten sizes in both languages.
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

/** How many different colours (in sixteen steps per channel) the stage's canvas shows: one that drew nothing shows one. */
const coloursOf = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const c = document.querySelector('.ob-stage canvas.k-mo-canvas') as HTMLCanvasElement;
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

const HERO_PLAY = '[data-hero] a[data-action="hero-play"]';

test('a first visit lands on the home hero and stays there: nobody is taken to the tour by the address', async ({ browser }) => {
  for (const [home, h1] of [['/', /Your body is the controller/], ['/tr/', /Kumanda senin vücudun/]] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = collectErrors(page);
    // 'first' makes this browser what a person's is for the tour: not a script
    await withHooks(page, { ...BASE_HOOKS, tour: 'first' });
    await page.goto(`${WEB_DEV_URL}${home}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await expect(page, home).toHaveURL(`${WEB_DEV_URL}${home}`);
    await expect(page.getByRole('heading', { level: 1 }), home).toHaveText(h1);
    await expect(page.locator(HERO_PLAY), home).toBeVisible();
    expect(await page.locator('[data-welcome]').count(), home).toBe(0);
    expect(errors, home).toEqual([]);
    await context.close();
  }
});

test('Play free in the hero opens the tour for a first-timer, Back returns to the hero, and skipping the tour is remembered', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await withHooks(page, { ...BASE_HOOKS, tour: 'first' });
  await page.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await page.locator(HERO_PLAY).click();
  await page.waitForURL(/\/welcome\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Squat, jump, punch/);
  // the tour is a page on top of the home page: the browser's Back button returns to the hero
  await page.goBack();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await expect(page.locator(HERO_PLAY)).toBeVisible();
  await page.locator(HERO_PLAY).click();
  await page.waitForURL(/\/welcome\/$/);
  await page.getByRole('button', { name: 'Skip the tour' }).click();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  expect((await settingsOf(page))['onboardingDone']).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(`${WEB_DEV_URL}/`);
  // the first-timer who skipped the tour is a returning player now: Play free goes to the game page, as it always did
  await page.locator(HERO_PLAY).click();
  await page.waitForURL(/\/games\/squat-flap\/$/);
  expect(errors).toEqual([]);
  await context.close();
});

test('Play free in the Turkish hero opens the Turkish tour for a first-timer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'tr-TR' });
  const page = await context.newPage();
  await withHooks(page, { ...BASE_HOOKS, tour: 'first' });
  await page.goto(`${WEB_DEV_URL}/tr/`, { waitUntil: 'networkidle' });
  await page.locator(HERO_PLAY).click();
  await page.waitForURL(/\/tr\/welcome\/$/);
  expect(await page.locator('html').getAttribute('lang')).toBe('tr');
  await context.close();
});

test('Play free in the hero goes where it did before for a player who has played, for a script and for a new tab', async ({ browser }) => {
  // a player who has finished rounds on this device (the shell counts them under ba2.shell.rounds) is no first-timer
  const record = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const played = await record.newPage();
  const errors = collectErrors(played);
  await withHooks(played, { ...BASE_HOOKS, tour: 'first' });
  await played.addInitScript(() => { localStorage.setItem('ba2.shell.rounds', JSON.stringify({ v: 1, d: 3 })); });
  await played.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await played.locator(HERO_PLAY).click();
  await played.waitForURL(/\/games\/squat-flap\/$/);
  expect(errors).toEqual([]);
  await record.close();
  // a script (no hook: a published build never takes it into the tour) follows the link to the game page
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await withHooks(page, BASE_HOOKS);
  await page.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await page.locator(HERO_PLAY).click();
  await page.waitForURL(/\/games\/squat-flap\/$/);
  await context.close();
  // a first-timer who opens the link in a new tab (a click with Control or Command held) gets the game page the link names
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const first = await fresh.newPage();
  await withHooks(first, { ...BASE_HOOKS, tour: 'first' });
  await first.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await expect(first.locator(HERO_PLAY)).toHaveAttribute('href', '/games/squat-flap/');
  const [tab] = await Promise.all([fresh.waitForEvent('page'), first.locator(HERO_PLAY).click({ modifiers: ['Control'] })]);
  await tab.waitForURL(/\/games\/squat-flap\//);
  await expect(first).toHaveURL(`${WEB_DEV_URL}/`);
  await fresh.close();
});

test('How it works in the hero still scrolls to its part of the page, for a first-timer too', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await withHooks(page, { ...BASE_HOOKS, tour: 'first' });
  await page.goto(`${WEB_DEV_URL}/`, { waitUntil: 'networkidle' });
  await page.locator('[data-hero] a[href="#how"]').click();
  await expect(page).toHaveURL(/#how$/);
  expect(await page.locator('[data-welcome]').count()).toBe(0);
  await context.close();
});

test('the tour stays a page of its own: its address opens it for anyone, step by step', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await withHooks(page, { ...BASE_HOOKS, tour: 'static' });
  await page.goto(`${WEB_DEV_URL}/welcome/?step=3`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-welcome][data-ready="1"]');
  await expect(page.locator('.ob-progress span')).toHaveText('Step 3 of 7');
  expect(errors).toEqual([]);
  await context.close();
});

test('the five pages move on and back with the address, the heading and the focus, and the stage stays', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome', { w: 390, h: 844 });
  await page.evaluate(() => { (window as unknown as { __stage: Element | null }).__stage = document.querySelector('[data-stage]'); });
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(/Squat, jump, punch/);
  await page.getByRole('button', { name: 'Start' }).click();
  for (const n of [2, 3, 4, 5]) {
    await expect(page).toHaveURL(new RegExp(`/welcome/\\?step=${n}`));
    await expect(page.locator('.ob-progress span')).toHaveText(`Step ${n} of 7`);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    if (n < 5) await page.getByRole('button', { name: n === 4 ? 'I have the space' : 'Next' }).click();
  }
  // Back (the browser's own) goes one page back without drawing the page again: the very same stage is there.
  await page.goBack();
  await expect(page).toHaveURL(/step=4/);
  await page.goBack();
  await expect(page).toHaveURL(/step=3/);
  expect(await page.evaluate(() => (window as unknown as { __stage: Element | null }).__stage === document.querySelector('[data-stage]'))).toBe(true);
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

test('the stage shows a real person with the body line on every page (held on one frame for the test), the right person for each page', async ({ browser }) => {
  const want: Record<string, RegExp> = { welcome: /^squat$/, 'welcome-2': /^reach$/, 'welcome-3': /^(lunge|ropes)$/, 'welcome-4': /^warmup$/, 'welcome-5': /^warmup$/ };
  for (const name of STEPS) {
    const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w: 1280, h: 800 });
    expect(await page.locator('[data-stage]').getAttribute('data-clip'), name).toMatch(want[name] as RegExp);
    await expect(page.locator('.ob-stage .k-mo'), name).toHaveClass(/is-live/);
    expect(await coloursOf(page), name).toBeGreaterThan(8);
    expect(errors, name).toEqual([]);
    await context.close();
  }
});

test('the third page shows the area the player turns on, and the space page puts its labels by the person', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome-3', { w: 1280, h: 800 });
  await page.getByRole('button', { name: 'Arms' }).click();
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-clip', 'press');
  await page.getByRole('button', { name: 'Core' }).click();
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-clip', 'halo');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/step=4/);
  await expect(page.locator('.ob-tag3d')).toHaveCount(3);
  await expect(page.locator('.ob-floor')).toHaveCount(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('where the clip is not to play (the test asks for the posters) the poster stands in: the first frame with its body line', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'welcome', { w: 390, h: 844, hooks: { ...BASE_HOOKS, tour: 'fallback' } });
  const poster = page.locator('.ob-stage .k-mo-poster img');
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 100)).toBe(true);
  expect(await page.locator('.ob-stage video').getAttribute('src')).toBeNull();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/step=2/);
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-clip', 'reach');
  await expect.poll(() => page.locator('.ob-stage .k-mo-poster img').evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 100)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('a script and a visitor who asked for less motion get the poster, and no clip is fetched', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
    const page = await context.newPage();
    const fetched: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/assets/clips/mo-')) fetched.push(r.url()); });
    await withHooks(page, BASE_HOOKS);
    await page.goto(`${WEB_DEV_URL}/welcome/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-welcome][data-ready="1"]');
    await page.waitForTimeout(800);
    await expect(page.locator('.ob-stage .k-mo-poster img'), reducedMotion).toBeVisible();
    expect(await page.locator('.ob-stage video').getAttribute('src'), reducedMotion).toBeNull();
    expect(fetched, reducedMotion).toEqual([]);
    await context.close();
  }
});

test('for a visitor the first page plays squat, jump and punch one after the other', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await withHooks(page, { ...BASE_HOOKS, tour: 'first' });
  await page.goto(`${WEB_DEV_URL}/welcome/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-welcome][data-ready="1"]');
  const playable = await page.evaluate(() => document.createElement('video').canPlayType('video/webm; codecs="vp9"') === 'probably');
  test.skip(!playable, 'this engine does not play VP9 here');
  await expect(page.locator('.ob-stage .k-mo')).toHaveClass(/is-live/, { timeout: 20_000 });
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-clip', 'jacks', { timeout: 15_000 });
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-clip', 'punch', { timeout: 15_000 });
  expect(errors).toEqual([]);
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
