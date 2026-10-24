// The record of the player, end to end in a browser: the challenge of the day on the home page, a round that makes an active
// day and finishes the challenge, the week that follows, and a workout plan from its first game to its end (rests, skipping,
// leaving). The practice session plays the games; the record is S's real arcade on the page's own storage.
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, useKeyboard, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** A round of "200 seconds" that takes five: long enough to make an active day (180 s) and to finish the challenge (60 s). */
const LONG = { timeScale: 40, roundSeconds: 200, forceDemo: true, keyboard: true } as const;
/** A round of two minutes in three seconds, for the games of a plan. */
const PLAN = { timeScale: 40, roundSeconds: 120, forceDemo: true, keyboard: true } as const;

/** The camera is explained and allowed already, so a round goes straight to its calibration. */
async function cameraReady(page: Page): Promise<void> {
  await page.context().grantPermissions(['camera']);
  await page.addInitScript(() => { localStorage.setItem('ba2.shell.cameraExplained', JSON.stringify({ v: 1, d: true })); });
}

test.describe('the challenge of the day and the week', () => {
  test('a long round finishes the challenge and makes an active day, and the home page tells the same afterwards', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, LONG);
    await page.goto(`${WEB_DEV_URL}/`);
    const card = page.locator('[data-challenge]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Challenge of the day');
    await expect(card).toContainText('0 of the last 7 days done.');
    const id = await card.getAttribute('data-challenge');
    expect(id).toBeTruthy();
    // a new player has no week yet and says nothing about one
    await expect(page.locator('.k-week')).toHaveCount(0);

    await card.getByRole('link', { name: /^Play / }).click();
    await expect(page.locator('[data-challenge-today]')).toContainText('Challenge of the day');
    await useKeyboard(page);
    await page.getByRole('button', { name: /^Play/ }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });

    const progress = page.locator('[data-progress]');
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('Today is an active day.');
    await expect(progress).toContainText('Challenge of the day done.');

    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page.locator('[data-challenge]')).toContainText('Done for today.');
    await expect(page.locator('[data-challenge]')).toContainText('1 of the last 7 days done.');
    await expect(page.locator('.k-week')).toContainText('1 of 3 active days this week.');
    await expect(page.locator('.k-week')).toContainText('Recent bests');
    await expect(page.locator('.k-week [data-week-goal]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the same home page in Turkish', async ({ page }) => {
    await withHooks(page, LONG);
    await page.goto(`${WEB_DEV_URL}/tr/`);
    await expect(page.locator('[data-challenge]')).toContainText('Günün görevi');
    await expect(page.locator('[data-challenge]')).toContainText('Son 7 günün 0 tanesinde tamamlandı.');
  });

  test('a short round of another game neither makes a day active nor finishes the challenge, and says nothing about either', async ({ page }) => {
    await withHooks(page, { timeScale: 40, roundSeconds: 30, forceDemo: true, keyboard: true });
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: /^Play/ }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });
    await expect(page.locator('[data-progress]')).toHaveCount(0);
  });

  test('clearing the data resets the record and keeps the licence', async ({ page }) => {
    await withHooks(page, LONG);
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: /^Play/ }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });
    await page.evaluate(() => localStorage.setItem('ba2.entitlements.current', JSON.stringify({ v: 1, d: { kept: true } })));
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await page.getByRole('button', { name: 'Clear data on this device' }).click();
    await page.getByRole('button', { name: 'Clear data', exact: true }).click();
    await expect(page.locator('.ba-toast')).toContainText('Data cleared');
    expect(await page.evaluate(() => localStorage.getItem('ba2.entitlements.current'))).toContain('kept');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ba2.squat-flap.')))).toEqual([]);
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page.locator('.k-week')).toHaveCount(0);
  });
});

test.describe('a workout plan', () => {
  test('the free desk break from its first game to its end: the rest, the next game, the end', async ({ page }) => {
    const errors = collectErrors(page);
    await cameraReady(page);
    await withHooks(page, PLAN);
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await expect(page.locator('h1')).toHaveText('Workout plans');
    await expect(page.locator('.k-plancard')).toHaveCount(5);
    // a free player starts the desk break; the other four lead to Pro
    await expect(page.locator('[data-action="plan-start"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Start with Pro' })).toHaveCount(4);

    await page.getByRole('button', { name: 'Start Desk break' }).click();
    await expect(page).toHaveURL(/\/play\/twist-turbine\/\?.*plan=1/);
    await expect(page).toHaveURL(/seated=1/);
    await expect(page).toHaveURL(/difficulty=easy/);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });

    const panel = page.locator('[data-plan-panel="next"]');
    await expect(panel).toContainText('Desk break: game 1 of 2 done');
    await expect(panel).toContainText('Next: Star Catch');
    await expect(panel).toContainText('Rest 10 seconds first.');
    await expect(panel.locator('[data-plan-count]')).toBeVisible();
    // the rest counts down by itself and says when it is over
    await expect(panel.locator('[data-plan-rest-text]')).toHaveText('Rest is over.', { timeout: 15_000 });
    await expect(panel.locator('[data-plan-count]')).toBeHidden();

    await panel.getByRole('link', { name: 'Start Star Catch' }).click();
    await expect(page).toHaveURL(/\/play\/star-catch\/\?.*plan=1/);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    const over = page.locator('[data-plan-panel="over"]');
    await expect(over).toContainText('Plan done: Desk break');
    await expect(over).toContainText('2 of 2 games played in 4 minutes.');

    // the plan was done today: it says so on the page of plans, and it can be started again
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await expect(page.locator('#desk-break')).toContainText('Done 1 time this week');
    await expect(page.getByRole('button', { name: 'Start Desk break' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a Pro player skips the games that are left, and a plan with too few games played is closed without counting', async ({ page }) => {
    await cameraReady(page);
    await withHooks(page, { ...PLAN, plan: 'pro' });
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await expect(page.locator('[data-action="plan-start"]')).toHaveCount(5);
    await page.getByRole('button', { name: 'Start Full body' }).click();
    await expect(page).toHaveURL(/\/play\/firework-jacks\/\?.*plan=1/);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    const panel = page.locator('[data-plan-panel="next"]');
    await expect(panel).toContainText('Full body: game 1 of 3 done');
    await expect(panel).toContainText('Next: Squat Flap');
    await panel.getByRole('button', { name: 'Skip this game' }).click();
    await expect(page.locator('[data-plan-panel="next"]')).toContainText('Next: Twist Turbine');
    await page.locator('[data-plan-panel="next"]').getByRole('button', { name: 'Skip this game' }).click();
    const over = page.locator('[data-plan-panel="over"]');
    await expect(over).toContainText('only 1 of 3 games were played');
    await expect(over).toContainText('the day does not count for the plan');
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await expect(page.locator('#full-body')).not.toContainText('Done');
  });

  test('leaving a plan closes it, and the page of plans offers it again', async ({ page }) => {
    await cameraReady(page);
    await withHooks(page, PLAN);
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await page.getByRole('button', { name: 'Start Desk break' }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    await page.locator('[data-plan-panel="next"]').getByRole('button', { name: 'Leave the plan' }).click();
    await expect(page.locator('.ba-toast')).toContainText('The plan is closed.');
    await expect(page.locator('[data-plan-panel]')).toHaveCount(0);
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await expect(page.getByText('Your plan today')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Desk break' })).toBeVisible();
  });

  test('a plan that is going is on the home page and the page of plans, and leads back into its next game', async ({ page }) => {
    await cameraReady(page);
    await withHooks(page, PLAN);
    await page.goto(`${WEB_DEV_URL}/plans/`);
    await page.getByRole('button', { name: 'Start Desk break' }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 40_000 });
    await page.goto(`${WEB_DEV_URL}/`);
    const active = page.locator('.k-planactive');
    await expect(active).toContainText('Your plan today');
    await expect(active).toContainText('Desk break: game 2 of 2, Star Catch next.');
    await active.getByRole('link', { name: 'Continue Desk break' }).click();
    await expect(page).toHaveURL(/\/play\/star-catch\/\?.*plan=1/);
  });

  test('the page of plans in Turkish', async ({ page }) => {
    await withHooks(page, PLAN);
    await page.goto(`${WEB_DEV_URL}/tr/plans/`);
    await expect(page.locator('h1')).toHaveText('Antrenman planları');
    await expect(page.getByRole('button', { name: 'Masa molası planını başlat' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pro ile başlat' })).toHaveCount(4);
  });
});
