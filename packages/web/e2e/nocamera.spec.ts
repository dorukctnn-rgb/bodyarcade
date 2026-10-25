// Playing without the camera, on the real games and the real session (no practice session): where the way around the camera is offered
// (the camera explainer, the camera that did not start, the settings, the game's page), what such a round looks like (no self view, the
// stage keeps its swipes) and what it is worth (practice: no calories, no record, no active day). A phone is offered it for a game that
// has swipes, and not for a mirror game. The keyboard and touch bindings of each game are held to the shell's rule in controls.test.ts.
import { expect, test, type Page } from '@playwright/test';
import { choose, collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** A camera that is blocked, and a count of the times the page asked for one. */
async function blockCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __asked: number }).__asked = 0;
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = () => { (window as unknown as { __asked: number }).__asked++; return Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); };
  });
}

/** The countdown and the loading are over and the HUD is up. */
async function inRound(page: Page): Promise<void> {
  await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 30_000 });
}

/** A finger on the screen, by the browser's own touch events (what a phone sends), from one point to another. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 8;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('on a laptop', () => {
  test('the camera explainer offers a round without the camera; it starts at once, asks for no camera and shows no self view', async ({ page }) => {
    const errors = collectErrors(page);
    await blockCamera(page);
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/`);
    const panel = page.getByRole('dialog', { name: 'Let the camera see your moves' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(panel).toContainText('is practice');
    await panel.getByRole('button', { name: 'Play without the camera' }).click();
    await expect(page).toHaveURL(/input=keyboard/);
    await inRound(page);
    expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked), 'the camera was never asked for').toBe(0);
    await expect(page.locator('[data-hud="pip"]')).toBeHidden();
    await expect(page.locator('[data-ref="showPip"]')).toBeHidden();
    expect(await page.evaluate(() => window.__BA__?.debug().playProblems)).toEqual([]);
    // the keys work: Escape pauses and leaving gives everything back
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Leave round' }).click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    expect(errors).toEqual([]);
  });

  test('a camera that did not start offers it too, and the camera can be tried again', async ({ page }) => {
    await blockCamera(page);
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/`);
    await page.getByRole('button', { name: 'Continue' }).click();
    const panel = page.getByRole('dialog', { name: 'The round could not start' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('The camera is blocked');
    await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Play without the camera' })).toBeVisible();
    await panel.getByRole('button', { name: 'Try again' }).click();
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Play without the camera' }).click();
    await inRound(page);
    await expect(page.locator('[data-hud="pip"]')).toBeHidden();
  });

  test('the setting makes the rounds begin without the camera, on the game page and on the way in, and is kept', async ({ page }) => {
    await blockCamera(page);
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await expect(page.locator('input[name="controls"][value="camera"]')).toBeChecked();
    await choose(page, 'controls', 'keyboard');
    await expect(page.locator('input[name="controls"][value="keyboard"]')).toBeChecked();
    await page.reload();
    await expect(page.locator('input[name="controls"][value="keyboard"]')).toBeChecked();
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await page.locator('details.k-more summary').click();
    await expect(page.locator('input[name="input"][value="keyboard"]')).toBeChecked();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // no camera panel at all: the round goes straight to its countdown
    await inRound(page);
    expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Let the camera see your moves' })).toHaveCount(0);
    // the choice of one game's page is its own: back to the camera there, and the setting stays
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await page.locator('details.k-more summary').click();
    await choose(page, 'input', 'camera');
    await expect(page.locator('input[name="input"][value="camera"]')).toBeChecked();
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await expect(page.locator('input[name="controls"][value="keyboard"]')).toBeChecked();
  });

  test('a whole round without the camera is practice: the score is shown, and no calories, no best, no active day and no round is kept', async ({ page }) => {
    const errors = collectErrors(page);
    // a weight is given, so that calories would be shown if the round were kept
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await page.locator('#set-weight').fill('70');
    await page.locator('#set-weight').blur();
    await page.clock.install();
    // the welcome tour's first round: Squat Flap for thirty seconds, with the keyboard
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?first=1&input=keyboard`);
    await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
    let finished = false;
    const keys = ['Space', 'ArrowDown', 'Space', 'Space', 'ArrowDown'];
    for (let s = 0; s < 90 && !finished; s++) {
      await page.keyboard.press(keys[s % keys.length] ?? 'Space');
      await page.clock.runFor(1000);
      if (s % 4 === 3) finished = await page.evaluate(() => !!window.__BA__?.debug().result);
    }
    expect(finished, 'the round reaches its end').toBe(true);
    await expect(page.locator('[data-practice]')).toContainText('it is practice');
    await expect(page.locator('.k-kcal')).toHaveCount(0);
    await expect(page.locator('[data-progress]')).toHaveCount(0);
    await expect(page.locator('[data-first-saved]')).toHaveCount(0);
    await expect(page.getByText('New personal best')).toHaveCount(0);
    expect(await page.evaluate(() => window.__BA__?.debug().result?.practice)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('ba2.shell.rounds'))).toBeNull();
    // the game's page has no best from it
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await expect(page.locator('.k-best')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a game with swipes: the camera that is blocked offers touch; the round has no self view, keeps its swipes and its HUD whole', async ({ page }) => {
    const errors = collectErrors(page);
    await blockCamera(page);
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    // the controls are on the game's page, with what such a round is
    await page.locator('details.k-more summary').click();
    await expect(page.locator('input[name="input"][value="keyboard"]')).toHaveCount(1);
    await expect(page.locator('#setup-input-hint')).toContainText('Those rounds are practice');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const panel = page.getByRole('dialog', { name: 'The round could not start' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('To allow the camera');
    await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
    await panel.getByRole('button', { name: 'Play without the camera' }).click();
    await expect(page).toHaveURL(/input=keyboard/);
    await inRound(page);
    await expect(page.locator('[data-hud="pip"]')).toBeHidden();
    expect(await page.evaluate(() => window.__BA__?.debug().playProblems)).toEqual([]);

    // the stage keeps the browser's own gestures out, and a swipe (from the middle of the stage, and from a plate) reaches the game
    const scene = await page.evaluate(() => {
      const el = document.querySelector('[data-scene]') as HTMLElement;
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      for (const t of ['pointerdown', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => seen.push(`${e.type}:${(e as PointerEvent).pointerType}`));
      return { touchAction: getComputedStyle(document.querySelector('.ba-stage') as HTMLElement).touchAction, plate: (document.querySelector('[data-hud="statusLeft"]') as HTMLElement).getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number } };
    });
    expect(scene.touchAction).toBe('none');
    await swipe(page, { x: 195, y: 500 }, { x: 195, y: 640 });
    await swipe(page, { x: scene.plate.x + scene.plate.width / 2, y: scene.plate.y + scene.plate.height / 2 }, { x: scene.plate.x + scene.plate.width / 2, y: scene.plate.y + scene.plate.height + 120 });
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen.filter((e) => e.startsWith('pointerdown')).length, `both swipes began on the stage (${seen.join(' ')})`).toBe(2);
    expect(seen.filter((e) => e.startsWith('pointerup')).length, `both swipes ended there (${seen.join(' ')})`).toBe(2);
    expect(seen.filter((e) => e.startsWith('pointercancel')), 'the browser took none of them for a gesture of its own').toEqual([]);
    expect(seen.every((e) => e.endsWith(':touch'))).toBe(true);

    // the pause button still takes a tap, and leaving works without a keyboard
    await page.getByRole('button', { name: 'Pause', exact: true }).tap();
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await page.waitForTimeout(600);
    const where = await page.evaluate(() => ({ url: location.pathname + location.search, dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.textContent ?? '').trim().slice(0, 50)), hud: !!document.querySelector('[data-hud]') }));
    await expect(paused, `after the tap: ${JSON.stringify(where)}`).toBeVisible();
    await paused.getByRole('button', { name: 'Leave round' }).tap();
    await page.getByRole('button', { name: 'Leave', exact: true }).tap();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    expect(errors.filter((e) => !/NotAllowedError|Permission denied|getUserMedia/i.test(e))).toEqual([]);
  });

  test('the camera explainer offers touch on a phone for a game with swipes, and a mirror game says it needs the camera and offers nothing else', async ({ page }) => {
    await blockCamera(page);
    // a phone has no keys: a development build takes an address with input=keyboard as a keyboard being there (a test on a laptop's headless
    // browser asks for one that way), so this phone says it has none
    await withHooks(page, { keyboard: false });
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/`);
    const panel = page.getByRole('dialog', { name: 'Let the camera see your moves' });
    await expect(panel.getByRole('button', { name: 'Play without the camera' })).toBeVisible();

    // Pad Work is a mirror game: its keys move a cursor over the camera picture and it has no swipes
    await page.goto(`${WEB_DEV_URL}/games/pad-work/`);
    await expect(page.locator('input[name="input"][value="keyboard"]')).toHaveCount(0);
    await expect(page.locator('#setup-input-hint')).toContainText('plays with the camera');
    await page.getByRole('button', { name: /^Play|^Start/ }).first().click();
    const explainer = page.getByRole('dialog', { name: 'Let the camera see your moves' });
    await expect(explainer).toBeVisible();
    await expect(explainer.getByRole('button', { name: 'Play without the camera' })).toHaveCount(0);
    await explainer.getByRole('button', { name: 'Continue' }).click();
    const needs = page.getByRole('dialog', { name: 'This game needs the camera' });
    await expect(needs).toBeVisible({ timeout: 30_000 });
    await expect(needs).toContainText('To allow the camera');
    await expect(needs.getByRole('button', { name: /camera|keyboard|touch/i })).toHaveCount(0);
    await expect(needs.getByRole('button', { name: 'Try again' })).toBeVisible();
    // an address that asks for touch plays with the camera: the camera panel (the explainer, or the refusal once it was explained), and no way around it
    await page.goto(`${WEB_DEV_URL}/play/pad-work/?input=keyboard`);
    const asked = page.getByRole('dialog', { name: /camera/i });
    await expect(asked).toBeVisible({ timeout: 30_000 });
    await expect(asked.getByRole('button', { name: /without the camera|keyboard|touch/i })).toHaveCount(0);
  });

  test('the settings page has the controls, in Turkish too', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await expect(page.locator('input[name="controls"]')).toHaveCount(2);
    await withHooks(page, {});
    await page.goto(`${WEB_DEV_URL}/tr/settings/`);
    await expect(page.getByText('Bir turun neyle başlayacağı')).toBeVisible();
  });
});
