// The shell as a player uses it: finding a game, choosing how to play, a round with the practice session, the results,
// the Pro offer, the settings and the language. Development build (Vite dev server), the fixtures as the catalogue.
import { expect, test } from '@playwright/test';
import { choose, collectErrors, useKeyboard, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const FAST = { timeScale: 40, roundSeconds: 5, forceDemo: true } as const;

test.describe('finding a game', () => {
  test('the home page lists every game and a region chip filters without reloading the page', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page.locator('a.ba-tile')).toHaveCount(11);
    await expect(page.locator('h1')).toContainText('The game moves when you do');
    await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });

    await page.locator('.ba-filters a.ba-chip', { hasText: 'Legs and hips' }).click();
    await expect(page).toHaveURL(/\/workouts\/legs\/$/);
    await expect(page.locator('a.ba-tile')).toHaveCount(3);
    await expect(page.locator('h1')).toContainText('Legs and hips');
    await expect(page).toHaveTitle(/Legs and hips: camera workout games/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('a.ba-tile')).toHaveCount(11);
    expect(errors).toEqual([]);
  });

  test('a tile opens the game page, with the picture, how to play and a way back', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/`);
    await page.locator('a.ba-tile', { hasText: 'Pad Work' }).click();
    await expect(page).toHaveURL(/\/games\/pad-work\/$/);
    await expect(page.locator('h1')).toHaveText('Pad Work');
    await expect(page.locator('ol.k-how li')).toHaveCount(3);
    await page.locator('.k-head a.ba-icon-btn').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('the mode chips keep seated and quiet mode and say how many games they hide', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/`);
    const quiet = page.locator('button[data-mode="quiet"]');
    await expect(quiet).toHaveAttribute('aria-pressed', 'false');
    await quiet.click();
    await expect(quiet).toHaveAttribute('aria-pressed', 'true');
    await expect(quiet).toBeFocused();
    await expect(page.locator('.ba-hiddennote')).toContainText('2 games are hidden by your modes.');
    await expect(page.locator('a.ba-tile[data-game="road-run"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('button[data-mode="quiet"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('button[data-mode="quiet"]').click();
    await expect(page.locator('a.ba-tile')).toHaveCount(11);
  });
});

test.describe('a round', () => {
  test('the Play form starts a round, the round ends in the results, and Play again starts the same one', async ({ page }) => {
    const errors = collectErrors(page);
    await withHooks(page, FAST);
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/\/play\/squat-flap\/\?.*input=keyboard/);
    await expect(page.locator('[data-hud="statusLeft"]')).toBeVisible();

    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });
    await expect(page.locator('h1')).toHaveText('Round complete');
    await expect(page.locator('.k-score .n')).not.toHaveText('');
    await expect(page.locator('.k-misses li').first()).toBeVisible();
    await expect(page.locator('.k-stats')).toContainText('Time');
    // The first round of a free game is not a record (there was nothing before it to beat).
    await expect(page.locator('.k-pb')).toHaveCount(0);

    await page.getByRole('link', { name: 'Play again' }).click();
    await expect(page).toHaveURL(/\/play\/squat-flap\/\?.*input=keyboard/);
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });
    // Back leaves the results for the game page (the play entry was replaced).
    await page.goBack();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    expect(errors).toEqual([]);
  });

  test('the second round can beat the first: a personal best shows, and the game page remembers the best', async ({ page }) => {
    await withHooks(page, { ...FAST, roundSeconds: 8 });
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });
    // Seed a lower best so the next round is one.
    await page.evaluate(() => localStorage.setItem('ba2.shell.bests', JSON.stringify({ v: 1, d: { 'squat-flap': { normal: 1 } } })));
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await expect(page.locator('.k-best')).toContainText('Your best: 1');
  });

  test('a Pro game: one free round, then the lock, then the license key opens it', async ({ page }) => {
    await withHooks(page, FAST);
    await page.goto(`${WEB_DEV_URL}/games/pad-work/`);
    await expect(page.getByRole('button', { name: 'Play once free' })).toBeVisible();
    await expect(page.locator('.k-note')).toContainText('You can play it once for free.');
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play once free' }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });

    await page.goto(`${WEB_DEV_URL}/games/pad-work/`);
    await expect(page.locator('.k-lockcard')).toContainText('Pad Work is part of Pro.');
    await expect(page.locator('form[data-form="setup"]')).toHaveCount(0);
    await page.getByRole('link', { name: 'See Pro plans' }).click();
    await expect(page).toHaveURL(/\/pro\/\?game=pad-work$/);
    await expect(page.locator('.k-pw .lead')).toContainText('Pad Work is part of Pro.');

    await page.locator('details.k-keybox summary').click();
    await page.locator('#pw-key').fill('PRO-DEMO-0000');
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('h1')).toHaveText('BodyArcade Pro');
    await expect(page.locator('.ba-callout')).toContainText('Pro is active on this device.');

    // A development build keeps the plan in memory (a published one keeps the licence), so the game's page is reached without loading the page again.
    await page.evaluate(() => { history.pushState(null, '', '/games/pad-work/'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.locator('form[data-form="setup"]')).toHaveCount(1);
    await expect(page.locator('a.ba-tile, .ba-badge--pro').first()).toBeVisible();
  });

  test('Hard difficulty is Pro: choosing it opens the offer, and closing the offer comes back to the page', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await expect(page.locator('input[name="difficulty"][value="normal"]')).toBeChecked();
    await choose(page, 'difficulty', 'hard');
    await expect(page).toHaveURL(/\/pro\/\?game=squat-flap$/);
    await expect(page.locator('input[name="plan"]:checked')).toHaveValue('pro-yearly');
    await page.getByRole('link', { name: 'Close and continue free' }).click();
    await expect(page).toHaveURL(/\/games\/squat-flap\/$/);
    await expect(page.locator('input[name="difficulty"][value="normal"]')).toBeChecked();
  });

  test('the Pro offer says a trial only when it applies, and picking a plan changes the button', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/pro/`);
    await expect(page.getByRole('button', { name: 'Try 7 days free' })).toBeVisible();
    await expect(page.locator('.k-note').first()).toContainText('We remind you two days before the trial ends');
    await page.locator('label.k-plan', { hasText: 'Lifetime' }).click();
    await expect(page.getByRole('button', { name: 'Choose this plan' })).toBeVisible();
    await expect(page.locator('.k-note').first()).not.toContainText('7 days free');
    await expect(page.locator('.k-note').first()).not.toContainText('remind you');
    // Family has no free trial: not in its row, not on its button, not in the note
    await page.locator('label.k-plan', { hasText: 'Family' }).click();
    await expect(page.getByRole('button', { name: 'Choose this plan' })).toBeVisible();
    await expect(page.locator('label.k-plan', { hasText: 'Family' })).not.toContainText(/free|trial/i);
    await expect(page.locator('.k-note').first()).not.toContainText(/free|remind/i);
    await page.locator('label.k-plan', { hasText: 'Pro yearly' }).click();
    await expect(page.getByRole('button', { name: 'Try 7 days free' })).toBeVisible();
  });

  test('a preview build has made-up offers and says that nothing can be bought, instead of a button that does nothing', async ({ page }) => {
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = ((u: string) => { opened.push(u); return null; }) as typeof window.open;
    });
    await page.goto(`${WEB_DEV_URL}/pro/`);
    await expect(page.locator('[data-paywall-preview]')).toContainText('Preview build: the checkout link is not set yet');
    await page.getByRole('button', { name: 'Try 7 days free' }).click();
    await expect(page.locator('.ba-toast')).toContainText('Preview build: the checkout link is not set yet');
    // nothing was opened: a made-up address is never sent a player to
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);
  });
});

test.describe('the free trial', () => {
  test('the last two days of a trial are said on every open, on every page, and closing the notice lasts for the visit only', async ({ page }) => {
    await withHooks(page, { trial: { endsInHours: 30 }, forceDemo: true });
    await page.goto(`${WEB_DEV_URL}/`);
    const note = page.locator('[data-trial-notice]');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/Your free trial ends (today|tomorrow|the day after tomorrow)\./);
    await expect(note).toContainText('cancel in your Gumroad library');
    // it follows the player from page to page
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(page).toHaveURL(/\/settings\/$/);
    await expect(note).toBeVisible();
    // closing hides it for now; the next open shows it again
    await note.getByRole('button', { name: 'Got it' }).click();
    await expect(note).toHaveCount(0);
    await page.getByRole('link', { name: 'Games' }).first().click();
    await expect(note).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-trial-notice]')).toBeVisible();
  });

  test('there is no notice before the last two days, and none on the stage of a round', async ({ page }) => {
    await withHooks(page, { trial: { endsInHours: 100 }, forceDemo: true });
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page.locator('a.ba-tile').first()).toBeVisible();
    await expect(page.locator('[data-trial-notice]')).toHaveCount(0);
    const near = await page.context().newPage();
    await withHooks(near, { trial: { endsInHours: 30 }, forceDemo: true, keyboard: true, timeScale: 40, roundSeconds: 5 });
    await near.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard`);
    await expect(near.locator('[data-stage]')).toBeVisible();
    await expect(near.locator('[data-trial-notice]')).toHaveCount(0);
    await near.close();
  });

  test('a cancelled membership says nothing will be charged, and Google Play says where to cancel', async ({ page }) => {
    await withHooks(page, { trial: { endsInHours: 30, cancelled: true }, forceDemo: true });
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page.locator('[data-trial-notice]')).toContainText('You already cancelled, so nothing will be charged.');
    const play = await page.context().newPage();
    await withHooks(play, { trial: { endsInHours: 30, where: 'play' }, forceDemo: true });
    await play.goto(`${WEB_DEV_URL}/`);
    await expect(play.locator('[data-trial-notice]')).toContainText('cancel in Google Play subscriptions');
    await play.close();
  });

  test('the notice in Turkish, and the plan page with the one reminder e-mail: a wrong address is refused in words, a good one is kept masked and can be taken back', async ({ page }) => {
    await withHooks(page, { trial: { endsInHours: 30 }, forceDemo: true, plan: 'pro' });
    await page.goto(`${WEB_DEV_URL}/tr/`);
    await expect(page.locator('[data-trial-notice]')).toContainText(/Ücretsiz denemen (bugün|yarın|öbür gün) bitiyor\./);
    await page.goto(`${WEB_DEV_URL}/pro/`);
    const block = page.locator('[data-trial]');
    await expect(block).toContainText('Your free trial ends on');
    await expect(block.locator('[data-trial-email="offer"]')).toBeVisible();

    await block.locator('#tr-email').fill('not an address');
    await block.getByRole('button', { name: 'Remind me by e-mail' }).click();
    await expect(block.locator('[data-trial-note]')).toHaveText('That does not look like an e-mail address.');

    await block.locator('#tr-email').fill('alice@example.com');
    await block.getByRole('button', { name: 'Remind me by e-mail' }).click();
    await expect(block.locator('[data-trial-email="set"]')).toContainText('a***@example.com');
    await expect(block).not.toContainText('alice@');
    await expect(block.locator('[data-trial-note]')).toHaveText('Done. The reminder is set.');

    await block.getByRole('button', { name: 'Take my address back' }).click();
    await expect(block.locator('[data-trial-email="offer"]')).toBeVisible();
    await expect(block.locator('[data-trial-note]')).toHaveText('Your address is deleted. You will still see the notice in the app.');
  });

  test('there is no e-mail box in Google Play, which sends its own reminder', async ({ page }) => {
    await withHooks(page, { trial: { endsInHours: 30, where: 'play' }, forceDemo: true, plan: 'pro' });
    await page.goto(`${WEB_DEV_URL}/pro/`);
    await expect(page.locator('[data-trial]')).toBeVisible();
    await expect(page.locator('[data-trial-email]')).toHaveCount(0);
  });
});

test.describe('settings and language', () => {
  test('quiet mode and the theme apply at once and last after a reload', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await page.locator('label[for="set-quiet"]').click();
    await expect(page.locator('#set-quiet')).toBeChecked();
    await page.locator('label:has(input[name="theme"][value="dark"])').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('#set-quiet')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('input[name="theme"][value="dark"]')).toBeChecked();
  });

  test('the camera view corner is one of five choices, Hidden included', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await expect(page.locator('input[name="pipCorner"][value="bottom-right"]')).toBeChecked();
    await page.locator('input[name="pipCorner"][value="top-left"]').check({ force: true });
    await page.reload();
    await expect(page.locator('input[name="pipCorner"][value="top-left"]')).toBeChecked();
    await page.locator('label:has(input[name="pipCorner"][value="hidden"])').click();
    await page.reload();
    await expect(page.locator('input[name="pipCorner"][value="hidden"]')).toBeChecked();
  });

  test('the weight is kept on the device and gives the results a calorie estimate', async ({ page }) => {
    await withHooks(page, FAST);
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await page.locator('#set-weight').fill('74');
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await useKeyboard(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/\/results\/$/, { timeout: 30_000 });
    await expect(page.locator('.k-kcal')).toContainText(/About \d+ kcal/);
    await expect(page.locator('.k-kcal')).toContainText('An estimate from your weight');
  });

  test('choosing Turkish moves to the Turkish address, in Turkish, and stays after a reload', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await page.locator('#set-lang').selectOption('tr');
    await expect(page).toHaveURL(/\/tr\/settings\/$/);
    await expect(page.locator('h1')).toHaveText('Ayarlar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Ayarlar');
    await page.locator('.ba-tab, .ba-topbar nav a', { hasText: 'Oyunlar' }).first().click();
    await expect(page).toHaveURL(/\/tr\/$/);
    await expect(page.locator('h1')).toContainText('Çömel, zıpla, yumruk at');
  });

  test('a Turkish browser is taken to the Turkish home page once; a German one gets English (German is a draft)', async ({ browser }) => {
    const tr = await browser.newContext({ locale: 'tr-TR' });
    const p1 = await tr.newPage();
    await p1.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await expect(p1).toHaveURL(/\/tr\/games\/squat-flap\/$/);
    await tr.close();
    const de = await browser.newContext({ locale: 'de-DE' });
    const p2 = await de.newPage();
    await p2.goto(`${WEB_DEV_URL}/`);
    await expect(p2).toHaveURL(/\/$/);
    await expect(p2.locator('html')).toHaveAttribute('lang', 'en');
    await de.close();
  });

  test('the footer language links change the language and remember it', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/squat-flap/`);
    await page.locator('.ba-footer-langs a', { hasText: 'Türkçe' }).click();
    await expect(page).toHaveURL(/\/tr\/games\/squat-flap\/$/);
    await expect(page.locator('h1')).toHaveText('Squat Flap');
    await expect(page.locator('.k-facts')).toContainText('tur');
    await page.goto(`${WEB_DEV_URL}/`);
    await expect(page).toHaveURL(/\/tr\/$/);
  });

  test('clearing the data asks first, then resets settings and results', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/settings/`);
    await page.locator('label[for="set-quiet"]').click();
    await page.getByRole('button', { name: 'Clear data on this device' }).click();
    await expect(page.getByRole('dialog')).toContainText('Clear your records?');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#set-quiet')).toBeChecked();
    await page.getByRole('button', { name: 'Clear data on this device' }).click();
    await page.getByRole('button', { name: 'Clear records', exact: true }).click();
    await expect(page.locator('#set-quiet')).not.toBeChecked();
    await expect(page.locator('.ba-toast')).toContainText('Your records on this device were cleared.');
  });

  test('going offline says so once, even when the event comes twice', async ({ page, context }) => {
    await page.goto(`${WEB_DEV_URL}/`);
    // the app has started (it listens for the event from then on): cut off before that, the dev server's last modules never came and there was no
    // app to say anything (no toast at all in the final test's web:e2e on ff5d073, on a loaded machine)
    await page.waitForFunction(() => window.__BA__ !== undefined, undefined, { timeout: 30_000 });
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.locator('.ba-toast')).toHaveCount(1);
    await expect(page.locator('.ba-toast')).toContainText('You are offline.');
    await context.setOffline(false);
  });

  test('an address that does not exist shows the not found page and a way out', async ({ page }) => {
    await page.goto(`${WEB_DEV_URL}/games/nothing-here/`);
    await expect(page.locator('h1')).toHaveText('Page not found');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.getByRole('link', { name: 'See all games' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
