// The round itself as the shell runs it: pausing and leaving, two players on one camera, the calibration screen, and
// Road Run on the real session (the platform's browser session, the 3D scene and the sound) with the keyboard.
import { expect, test, type Page } from '@playwright/test';
import { choose, collectErrors, useKeyboard, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const SLOW = { timeScale: 1, roundSeconds: 120, forceDemo: true } as const;

/** The countdown and the calibration are over and the HUD is up. */
async function inRound(page: Page): Promise<void> {
  await page.waitForSelector('[data-hud-root] [data-hud]', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal') && !document.querySelector('.ba-loading'), undefined, { timeout: 30_000 });
}

test.describe('pause and leave', () => {
  test('Escape pauses, Escape again resumes, and leaving asks first and saves nothing', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, SLOW);
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await inRound(page);

    const paused = page.getByRole('dialog', { name: 'Paused' });
    await page.keyboard.press('Escape');
    await expect(paused).toBeVisible();
    await expect(paused.getByRole('button', { name: 'Resume' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(paused).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(paused).toBeVisible();
    await paused.getByRole('button', { name: 'Leave round' }).click();
    const confirm = page.getByRole('dialog', { name: 'Leave this round?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Your score in this round will not be saved.');
    await page.getByRole('button', { name: 'Keep playing' }).click();
    await expect(confirm).toBeHidden();
    await expect(paused).toBeVisible();

    await paused.getByRole('button', { name: 'Leave round' }).click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    expect(await page.evaluate(() => localStorage.getItem('ba2.shell.rounds'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('the pause button in the HUD pauses, and a hidden tab pauses by itself', async ({ page }) => {
    await withHooks(page, SLOW);
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await inRound(page);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toContainText('You paused the round.');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('dialog', { name: 'Paused' })).toContainText('The tab was hidden, so the round paused.');
  });

  test('the browser Back button during a round leaves it the same way, after asking', async ({ page }) => {
    await withHooks(page, SLOW);
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await inRound(page);
    await page.goBack();
    // Back from a round is a way out like any other: the page asks before it drops the score.
    await expect(page.getByRole('dialog', { name: /Leave this round\?|Paused/ }).first()).toBeVisible();
  });
});

test.describe('two players on one camera', () => {
  test('on a laptop the choice is there, the keyboard is off, and the round shows a plate for each player', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, { timeScale: 8, roundSeconds: 120, forceDemo: true });
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await expect(page.locator('input[name="players"]')).toHaveCount(2);
    await expect(page.locator('input[name="players"][value="1"]')).toBeChecked();
    await choose(page, 'players', '2');
    await expect(page.locator('.k-duo')).toContainText('Player 1 stands on the left');
    await expect(page.locator('input[name="input"][value="keyboard"]')).toBeDisabled();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/players=2/);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.cal h2')).toContainText('Both of you in view');
    await inRound(page);
    for (const slot of ['statusP1', 'statusP2', 'timer']) await expect(page.locator(`[data-hud="${slot}"]`)).toBeVisible();
    expect(await page.evaluate(() => window.__BA__?.debug().playProblems)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a game with one player on the camera says so instead of offering two', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/summit-climb/`);
    await expect(page.locator('input[name="players"][value="2"]')).toBeDisabled();
    await expect(page.locator('#setup-players-hint')).toContainText('is 1 player on one camera.');
  });

  test('on a phone there is no two player choice, and an address asking for two plays one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withHooks(page, { timeScale: 8, roundSeconds: 120, forceDemo: true, keyboard: true });
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await expect(page.locator('input[name="players"]')).toHaveCount(0);
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?players=2&input=keyboard`);
    await inRound(page);
    await expect(page.locator('[data-hud="statusP2"]')).toHaveCount(0);
    await expect(page.locator('[data-hud="statusLeft"]')).toBeVisible();
  });
});

test.describe('calibration', () => {
  test('the screen shows the four checks and the distance gauge, fills in as the player is found, then counts down', async ({ page }) => {
    const errors = collectErrors(page);
    // the practice session never asks the browser for the camera, so the permission a real first round would have given is given here
    await page.context().grantPermissions(['camera']);
    await withHooks(page, { timeScale: 3, roundSeconds: 120, forceDemo: true });
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);

    // The camera is explained once, before the browser asks.
    const explainer = page.getByRole('dialog', { name: 'Let the camera see your moves' });
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText('never uploaded or saved');
    await explainer.getByRole('button', { name: 'Continue' }).click();

    const cal = page.locator('.cal');
    await expect(cal).toBeVisible();
    await expect(cal.locator('[data-calib-check]')).toHaveCount(4);
    await expect(cal.locator('[data-calib-msg]')).not.toBeEmpty();
    await expect(cal.locator('svg.ring')).toHaveAttribute('aria-label', /of 4/);
    await expect(cal.getByRole('button', { name: 'Close' })).toBeVisible();

    await expect(cal.locator('[data-calib-check].is-ok')).toHaveCount(4, { timeout: 30_000 });
    await expect(page.locator('.ba-countdown')).toBeVisible({ timeout: 15_000 });
    await inRound(page);

    // Having seen the explainer, the next round goes straight to calibration.
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);
    await expect(page.locator('.cal')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('closing the calibration screen leaves, and the seated shortcut is there for games that allow it', async ({ page }) => {
    await withHooks(page, { timeScale: 1, roundSeconds: 120, forceDemo: true });
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.cal')).toBeVisible();
    await expect(page.locator('.cal [data-calib-skip]')).toBeVisible();
    await page.locator('.cal').getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
  });
});

test.describe('calibration at a desk', () => {
  test('the hips never come into view: plain words, the desk is offered, and choosing it plays seated and keeps desk mode on', async ({ page }) => {
    const errors = collectErrors(page);
    await page.context().grantPermissions(['camera']);
    await withHooks(page, { timeScale: 4, roundSeconds: 120, forceDemo: true, desk: true });
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);
    await page.getByRole('button', { name: 'Continue' }).click();

    const cal = page.locator('.cal');
    await expect(cal.locator('h2')).toContainText('whole body');
    // an instruction in the words of the player, and the way out is on the screen from the start
    await expect(cal.locator('[data-calib-msg]')).toHaveText('We cannot see your hips. Take one or two steps back.');
    await expect(cal.getByRole('button', { name: 'Skip, play seated' })).toBeVisible();
    // the picture guide names the part that is out of view
    await expect(cal.locator('[data-cal-guide] svg text')).toHaveText('Hips');

    // a moment later, the desk
    const card = cal.locator('[data-calib-desk="offer"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Are you at a desk?');
    await expect(cal.getByRole('button', { name: 'Skip, play seated' })).toBeVisible();
    await card.getByRole('button', { name: 'Play at the desk' }).click();

    // seated: head and shoulders are what is asked for, the round starts by itself
    await expect(page).toHaveURL(/seated=1/);
    await expect(cal.locator('h2')).toContainText('head and shoulders');
    await expect(cal.locator('[data-calib-check]')).toHaveCount(2);
    await expect(card).toBeHidden();
    await expect(page.locator('.ba-countdown')).toBeVisible({ timeout: 15_000 });
    await inRound(page);
    // and the mode stays on: Settings turns it off
    expect(await page.evaluate(() => document.documentElement.dataset['seated'])).toBe('1');
    expect(await page.evaluate(() => localStorage.getItem('ba2.shell.settings') ?? '')).toContain('"seated":true');
    expect(errors).toEqual([]);
  });

  test('"Skip, play seated" plays this round seated and leaves the settings alone', async ({ page }) => {
    await page.context().grantPermissions(['camera']);
    await withHooks(page, { timeScale: 4, roundSeconds: 120, forceDemo: true, desk: true });
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.cal').getByRole('button', { name: 'Skip, play seated' }).click();
    await expect(page).toHaveURL(/seated=1/);
    await expect(page.locator('.ba-countdown')).toBeVisible({ timeout: 15_000 });
    await inRound(page);
    expect(await page.evaluate(() => document.documentElement.dataset['seated'])).toBe('0');
  });

  test('stuck for a while on a laptop: the keyboard way shows up, and it starts the round', async ({ page }) => {
    await page.context().grantPermissions(['camera']);
    // the practice session runs 12 times faster here, and so does the clock of the screen
    await withHooks(page, { timeScale: 12, roundSeconds: 120, forceDemo: true, desk: true });
    await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=camera`);
    await page.getByRole('button', { name: 'Continue' }).click();
    const cal = page.locator('.cal');
    const keyboard = cal.getByRole('button', { name: 'Skip, use the keyboard' });
    await expect(keyboard).toBeVisible({ timeout: 10_000 });
    await keyboard.click();
    await inRound(page);
  });

  test('the same screen in Turkish says it plainly', async ({ page }) => {
    await page.context().grantPermissions(['camera']);
    await withHooks(page, { timeScale: 4, roundSeconds: 120, forceDemo: true, desk: true });
    await page.goto(`${WEB_DEV_URL}/tr/play/squat-flap/?input=camera`);
    await page.getByRole('button', { name: 'Devam' }).click();
    const cal = page.locator('.cal');
    await expect(cal.locator('[data-calib-msg]')).toHaveText('Kalçan görünmüyor: 1-2 adım geri git.');
    await expect(cal.getByRole('button', { name: 'Atla, oturarak oyna' })).toBeVisible();
    await expect(cal.locator('[data-calib-desk="offer"]')).toContainText('Masada mısın?', { timeout: 10_000 });
    await expect(cal.getByRole('button', { name: 'Masada oyna' })).toBeVisible();
  });
});

test.describe('Road Run on the real session', () => {
  test('the scene draws, the keys steer it, the HUD counts, and pause and leave work', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/games/road-run/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('[data-scene] canvas')).toBeVisible({ timeout: 60_000 });
    await inRound(page);

    const time = page.locator('[data-ref="timer"]').first();
    const t0 = await time.textContent();
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']) { await page.keyboard.press(k); await page.waitForTimeout(250); }
    await page.waitForTimeout(1500);
    expect(await time.textContent()).not.toBe(t0);
    expect(await page.evaluate(() => window.__BA__?.debug().playProblems)).toEqual([]);

    await page.keyboard.press('Escape');
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await paused.getByRole('button', { name: 'Leave round' }).click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL(/\/games\/road-run\/$/);
    // The scene and the sound are released: nothing from the round stays on the page.
    expect(await page.locator('canvas').count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
