// Races against a recording in a real browser: the window that asks who to race (a practice partner by default, its level, a code
// pasted in and kept for the next time, Cancel races nothing), a whole round against the practice partner on the real Squat Flap
// (the others under the score, the result in words, "Race again", the link of the player's run and the card it opens on a game's
// page), a friend's link, a child who cannot race a stranger's code, a recording that is not there, a game that cannot be raced,
// and the results of a race on all ten sizes.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { decodeRun } from '../../core/net/ghost.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from '../tools/layout-check.ts';
import { friendCode } from '../tools/scenarios.ts';
import { choose, collectErrors, useKeyboard, withHooks, type Hooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** A race of fifteen seconds (the shortest there is) on the real game, with a keyboard. */
const RACE: Hooks = { raceSeconds: 15, keyboard: true };

async function fresh(browser: Browser, hooks: Hooks = RACE, size = { w: 1280, h: 800 }): Promise<{ page: Page; context: BrowserContext; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await withHooks(page, hooks);
  return { page, context, errors };
}

/** The round is on the stage and the others are under the score. */
async function inRace(page: Page): Promise<void> {
  await page.waitForSelector('[data-hud-root] [data-hud="statusLeft"]', { timeout: 45_000 });
  await expect(page.locator('.rivals li')).toHaveCount(1, { timeout: 30_000 });
}

/** The keys that play Squat Flap, pressed until the results are on the screen. */
async function playToResults(page: Page): Promise<void> {
  const until = Date.now() + 90_000;
  while (!/\/results\//.test(page.url()) && Date.now() < until) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(330);
  }
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.locator('[data-race]')).toBeVisible();
}

async function leaveRound(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Leave round' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
}

test('the window asks who to race: a practice partner to begin with, its level, a code kept for next time, and Cancel races nothing', async ({ browser }) => {
  const { page, context, errors } = await fresh(browser);
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
  await useKeyboard(page);
  await page.getByRole('button', { name: 'Race a ghost' }).click();

  const dialog = page.getByRole('dialog', { name: 'Race a ghost' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('It is a recording: nobody is playing live.');
  // nothing of the player's own yet: the choice is there and says why it cannot be taken
  await expect(dialog.getByRole('radio', { name: /Your best run/ })).toBeDisabled();
  await expect(dialog).toContainText('Race a ghost once and your best run is kept here.');
  await expect(dialog.getByRole('radio', { name: /Practice partner/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Practice partner/ })).toBeFocused();
  await expect(dialog).toContainText('A bot, not a person.');
  // the level is a real group of radios, Medium to begin with
  await expect(dialog.locator('input[name="level"]:checked')).toHaveValue('medium');
  await choose(page, 'level', 'hard');
  await expect(dialog.locator('input[name="ghost"]:checked')).toHaveValue('practice:hard');

  // a code that is nothing, and one of another game, are said so at the field
  const code = dialog.locator('#race-code');
  await code.fill('this is not a code');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.locator('#race-code-note')).toHaveText('That is not a recording. Check the code and try again.');
  await code.fill(friendCode({ game: 'knee-sprint' }));
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.locator('#race-code-note')).toHaveText('That recording is of another game.');
  // a good one, pasted as the link a friend sent, is added and chosen
  await code.fill(`https://bodyarcade.example/games/squat-flap/?ghost=${friendCode({ name: 'Ada' })}`);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.locator('#race-code-note')).toHaveText('Recording of Ada is added to the list.');
  await expect(dialog.getByRole('radio', { name: /Recording of Ada/ })).toBeChecked();

  // Cancel races nothing
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/games\/squat-flap\/$/);

  // the recording was kept for the next time
  await page.reload({ waitUntil: 'networkidle' });
  await useKeyboard(page);
  await page.getByRole('button', { name: 'Race a ghost' }).click();
  await expect(page.getByRole('dialog', { name: 'Race a ghost' }).getByRole('radio', { name: /Recording of Ada/ })).toBeEnabled();
  await page.getByRole('dialog', { name: 'Race a ghost' }).getByRole('radio', { name: /Recording of Ada/ }).check();
  await page.getByRole('button', { name: 'Start the race' }).click();
  await page.waitForURL(/\/play\/squat-flap\/\?.*ghost=/);
  expect(new URL(page.url()).searchParams.get('input')).toBe('keyboard');
  expect(decodeRun(new URL(page.url()).searchParams.get('ghost') ?? '')?.name).toBe('Ada');
  await inRace(page);
  await expect(page.locator('.rivals li')).toContainText('Ada');
  expect(errors).toEqual([]);
  await context.close();
});

test('a whole race against the practice partner: the others under the score, the result in words, the link of the run, and the same race again', async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, context, errors } = await fresh(browser);
  await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard&ghost=practice%3Aeasy`);
  await inRace(page);
  await expect(page.locator('.rivals li')).toContainText('Practice bot');
  await expect(page.locator('.rivals li')).toHaveCount(1);
  // the plate with the score is whole and the rest of the HUD is clear of it
  expect(await page.evaluate(() => window.__BA__?.debug().playProblems)).toEqual([]);
  await playToResults(page);

  const race = page.locator('[data-race]');
  await expect(race.getByRole('heading', { name: 'The race' })).toBeVisible();
  await expect(race.locator('[data-race-verdict]')).toHaveText(/^(You won by \d+ points?\.|The practice partner won by \d+ points?\.|A draw\.)$/);
  await expect(race.locator('.rc-scores > div')).toHaveCount(2);
  await expect(race).toContainText('You are racing a practice partner, a bot. Nobody is playing live.');
  // a race is no personal best of the game: the page does not say so
  await expect(page.getByText('New personal best')).toHaveCount(0);

  // the layout rule on all ten sizes, on the page as the race left it
  const found: string[] = [];
  for (const bp of BREAKPOINTS) {
    await page.setViewportSize({ width: bp.w, height: bp.h });
    for (const p of await checkPage(page)) found.push(`${bp.label}: ${p}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(found, found.join('\n')).toEqual([]);

  // "Send my run": the link goes to the clipboard, and what it opens is the card of a recording
  await race.getByRole('button', { name: 'Send my run' }).click();
  await expect(page.getByText('The link to your run is copied.')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/games\/squat-flap\/\?ghost=/);
  const sent = decodeRun(new URL(link).searchParams.get('ghost') ?? '');
  expect(sent?.gameId).toBe('squat-flap');
  expect(sent?.durationMs).toBe(15_000);
  const other = await context.newPage();
  await withHooks(other, RACE);
  await other.goto(link);
  await expect(other.locator('[data-ghost-offer]')).toBeVisible();
  await expect(other.locator('[data-ghost-offer]')).toContainText('Nobody is playing live.');
  await other.close();

  // the same race again
  await race.getByRole('link', { name: 'Race again' }).click();
  await page.waitForURL(/\/play\/squat-flap\/\?.*ghost=practice/);
  await inRace(page);
  await expect(page.locator('.rivals li')).toContainText('Practice bot');
  await leaveRound(page);
  await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
  expect(errors).toEqual([]);
  await context.close();
});

test("a friend's link opens a card on the game's page, and the race is of the recording in it", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context, errors } = await fresh(browser);
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?ghost=${friendCode({ name: 'Ada' })}`);
  const offer = page.locator('[data-ghost-offer]');
  await expect(offer).toBeVisible();
  await expect(offer.getByRole('heading', { name: 'Race the recording of Ada?' })).toBeVisible();
  await expect(offer).toContainText(/\d+ points? on the same course\. Nobody is playing live\./);
  // a recording of another game is no offer here
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?ghost=${friendCode({ game: 'knee-sprint' })}`);
  await expect(page.locator('[data-ghost-offer]')).toHaveCount(0);
  // the offer starts the race with the keys the page had chosen
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?ghost=${friendCode({ name: 'Ada' })}`);
  await useKeyboard(page);
  await page.locator('[data-ghost-offer]').getByRole('link', { name: 'Start the race' }).click();
  await page.waitForURL(/\/play\/squat-flap\/\?.*ghost=/);
  await inRace(page);
  await expect(page.locator('.rivals li')).toContainText('Ada');
  await leaveRound(page);
  expect(errors).toEqual([]);
  await context.close();
});

test('a recording that is not there, and a game that cannot be raced', async ({ browser }) => {
  const { page, context, errors } = await fresh(browser);
  // your best run, before there is one
  await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard&ghost=own`);
  await page.waitForURL(/\/games\/squat-flap\/$/);
  await expect(page.getByText('There is no recording to race yet.')).toBeVisible();
  // a code that is not a recording
  await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard&ghost=0123456789notacode`);
  await page.waitForURL(/\/games\/squat-flap\/$/);
  await expect(page.getByText('That recording could not be opened.')).toBeVisible();
  // a game with no race has no button, and a round of it ignores the address
  await page.goto(`${WEB_DEV_URL}/games/pad-work/`);
  await expect(page.getByRole('button', { name: 'Race a ghost' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("a child's profile races its own and the family's recordings and a practice partner, never a code from outside", async ({ browser }) => {
  test.setTimeout(120_000);
  const hooks: Hooks = { ...RACE, plan: 'family', players: [{ name: 'Defne', kid: true, avatar: 'fox', active: true }, { name: 'Mert', avatar: 'robot' }] };
  const { page, context, errors } = await fresh(browser, hooks);
  // no card for a link from outside, and a round asked for with one goes back to the page with a word
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?plan=family&ghost=${friendCode()}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('[data-ghost-offer]')).toHaveCount(0);
  await page.goto(`${WEB_DEV_URL}/play/squat-flap/?plan=family&input=keyboard&ghost=${friendCode()}`);
  await page.waitForURL(/\/games\/squat-flap\/$/);
  await expect(page.getByText('That recording could not be opened.')).toBeVisible();
  // the window has no box for a code
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?plan=family`);
  await page.getByRole('button', { name: 'Race a ghost' }).click();
  const dialog = page.getByRole('dialog', { name: 'Race a ghost' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#race-code')).toHaveCount(0);
  await expect(dialog.getByRole('radio', { name: /Practice partner/ })).toBeChecked();
  expect(errors).toEqual([]);
  await context.close();
});
