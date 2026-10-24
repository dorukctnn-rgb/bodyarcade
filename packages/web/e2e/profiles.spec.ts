// The players of the Family plan in a real browser: a device with one player shows nothing of them; with the plan a player is added
// through the form (with its errors said at the field), chosen, edited and removed (the removal asks, and says what goes); a child
// is chosen from the main player without a word and the main player from a child only through the parent gate (a sum, a wrong
// answer, three wrong answers that close it and that a reload does not open); a child sees no calories, no weight, no friends,
// no trial notice, and no shop without a grown-up; the question of who is playing comes up when the app opens when it is asked
// for; the family's table is on a game's page; and every screen keeps the layout rule on all ten sizes in both languages.
import { expect, test, type Page } from '@playwright/test';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from '../tools/layout-check.ts';
import { openScenario } from '../tools/scenarios.ts';
import { collectErrors, withHooks, type Hooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const BASE: Hooks = { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };
const FAMILY: Hooks = { ...BASE, plan: 'family' };

/** The sum on the gate's window, solved. */
async function sumOf(page: Page): Promise<number> {
  const text = await page.locator('.pf-sum').innerText();
  const m = /(\d+)\s*×\s*(\d+)/.exec(text);
  if (!m) throw new Error(`no sum in "${text}"`);
  return Number(m[1]) * Number(m[2]);
}

async function answer(page: Page, value: number): Promise<void> {
  await page.locator('#gate-answer').fill(String(value));
  await page.getByRole('button', { name: 'Go on' }).click();
}

async function passGate(page: Page): Promise<void> {
  await expect(page.locator('dialog.pf-gatebox')).toBeVisible();
  await answer(page, await sumOf(page));
  await expect(page.locator('dialog.pf-gatebox')).toHaveCount(0);
}

/** A page of a device that has the Family plan and no other player yet. */
async function bare(browser: Parameters<typeof openScenario>[0], size = { w: 1280, h: 800 }) {
  return openScenario(browser, WEB_DEV_URL, 'players', { ...size, hooks: FAMILY });
}

async function addPlayer(page: Page, name: string, o: { avatar?: string; kid?: boolean } = {}): Promise<void> {
  await page.locator('[data-action="profile-add"]').first().click();
  await page.locator('#pf-name').fill(name);
  if (o.avatar) await page.getByRole('radio', { name: o.avatar }).check();
  if (o.kid) await page.locator('label.ba-row-label[for="pf-kid"]').click();
  await page.getByRole('button', { name: 'Add player' }).click();
}

test('a device with one player and no plan shows nothing of players: no switcher, no row in the settings', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'home', { w: 1280, h: 800 });
  await expect(page.locator('.pf-switch')).toHaveCount(0);
  await page.goto(`${WEB_DEV_URL}/settings/?plan=free`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Players', { exact: true })).toHaveCount(0);
  await page.goto(`${WEB_DEV_URL}/profiles/?plan=free`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who is playing?');
  await expect(page.locator('[data-action="profile-pick"]')).toHaveCount(1);
  await expect(page.locator('[data-action="profile-add"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('a player is added through the form, the switcher appears, and the list says who is who', async ({ browser }) => {
  const { page, context, errors } = await bare(browser);
  await expect(page.locator('[data-action="profile-pick"]')).toHaveCount(1);
  await addPlayer(page, 'Defne', { avatar: 'Fox', kid: true });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Players on this device');
  await expect(page.locator('.pf-notice')).toHaveText('Defne was added.');
  await expect(page.locator('[data-capacity]')).toHaveText('2 of 6 players');
  const rows = page.locator('.pf-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Defne');
  await expect(rows.nth(1)).toContainText('Child');
  await expect(rows.nth(0)).toContainText('Main');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-action="profile-pick"]')).toHaveCount(2);
  await expect(page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Me. Switch player');
  expect(errors).toEqual([]);
  await context.close();
});

test('what is wrong with a name is said at the name: empty, taken, the wrong characters, too long', async ({ browser }) => {
  const { page, context } = await bare(browser);
  await addPlayer(page, '');
  await expect(page.locator('#pf-name-err')).toHaveText('Write a name.');
  await expect(page.locator('#pf-name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#pf-name').fill('Me');
  await page.getByRole('button', { name: 'Add player' }).click();
  await expect(page.locator('#pf-name-err')).toHaveText('This name is already used on this device.');
  await page.locator('#pf-name').fill('De<b>ne');
  await page.getByRole('button', { name: 'Add player' }).click();
  await expect(page.locator('#pf-name-err')).toContainText('Use letters, digits and');
  await page.locator('#pf-name').fill('A'.repeat(21));
  await page.getByRole('button', { name: 'Add player' }).click();
  await expect(page.locator('#pf-name-err')).toHaveText('A name has up to 20 letters.');
  // the form is still there with what was typed; Cancel goes back to the list
  await expect(page.locator('#pf-name')).toHaveValue('A'.repeat(21));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Players on this device');
  await context.close();
});

test('the pictures are radio buttons: arrow keys move between them, the chosen one is kept in the list', async ({ browser }) => {
  const { page, context } = await bare(browser);
  await page.locator('[data-action="profile-add"]').first().click();
  await expect(page.getByRole('radio', { name: 'Fox' })).toBeChecked();
  await page.getByRole('radio', { name: 'Fox' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Owl' })).toBeChecked();
  await page.locator('#pf-name').fill('Mert');
  await page.getByRole('button', { name: 'Add player' }).click();
  await expect(page.locator('.pf-row').nth(1).locator('svg[aria-hidden="true"]').first()).toBeVisible();
  await expect(page.locator('.pf-row').nth(1)).toContainText('Mert');
  await context.close();
});

test('choosing a child is a tap; choosing the main player from a child needs a grown-up, who answers a sum', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'players', { w: 1280, h: 800 });
  await page.getByRole('button', { name: 'Play as Defne', exact: true }).click();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await expect(page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Defne. Switch player');
  await page.locator('.pf-switch').first().click();
  await page.waitForURL(/\/profiles\//);
  await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  // a wrong answer gives another sum; the right one switches and the gate is shut behind
  await expect(page.locator('dialog.pf-gatebox')).toBeVisible();
  await expect(page.locator('#gate-answer')).toBeFocused();
  const first = await page.locator('.pf-sum').innerText();
  await answer(page, 1);
  await expect(page.locator('#gate-note')).toHaveText('Not quite. Here is another one.');
  await expect(page.locator('.pf-sum')).toBeVisible();
  await passGate(page);
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await expect(page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Me. Switch player');
  expect(first).toMatch(/\d+ × \d+ =/);
  expect(errors).toEqual([]);
  await context.close();
});

test('three wrong answers close the gate for a while, and reloading the page does not open it', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players-kid', { w: 1280, h: 800 });
  await page.goto(`${WEB_DEV_URL}/profiles/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('#gate-answer')).toBeEnabled();
    await answer(page, 1);
  }
  await expect(page.locator('#gate-note')).toContainText('Try again in');
  await expect(page.locator('#gate-answer')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('dialog.pf-gatebox')).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await expect(page.locator('#gate-note')).toContainText('Try again in');
  await expect(page.locator('#gate-answer')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.pf-gatebox')).toHaveCount(0);
  await context.close();
});

test('a child has no weight, no friends, no trial notice and no shop without a grown-up', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'players-kid', { w: 1280, h: 800, hooks: { ...BASE, plan: 'family', social: true, trial: { endsInHours: 30 }, players: [{ name: 'Defne', kid: true, avatar: 'fox', active: true }, { name: 'Mert', avatar: 'robot' }] } });
  // the settings: no weight, and the row of players
  await expect(page.locator('[name="weightKg"]')).toHaveCount(0);
  await expect(page.getByText('2 of 6 on this device')).toBeVisible();
  // the bar has no Friends tab and the friends pages say who to ask
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first().getByText('Friends')).toHaveCount(0);
  await page.goto(`${WEB_DEV_URL}/friends/?social=1&plan=family`, { waitUntil: 'networkidle' });
  await expect(page.getByText('This player is a child. To add friends, open the main player.')).toBeVisible();
  // no notice of a trial (it is about buying)
  await page.goto(`${WEB_DEV_URL}/?plan=family`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-trial-notice]')).toHaveCount(0);
  // the shop is behind the gate: cancelled, the child is back at the home page
  await page.goto(`${WEB_DEV_URL}/pro/?plan=family`, { waitUntil: 'networkidle' });
  await expect(page.locator('dialog.pf-gatebox')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await page.goto(`${WEB_DEV_URL}/pro/?plan=family`, { waitUntil: 'networkidle' });
  await passGate(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/BodyArcade Pro|Play more|Pro/);
  expect(errors.filter((e) => !/social|friends/i.test(e))).toEqual([]);
  await context.close();
});

test('the main player sees the trial notice, the weight and the friends that the child does not', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players', { w: 1280, h: 800, hooks: { ...BASE, plan: 'family', social: true, trial: { endsInHours: 30 }, players: [{ name: 'Defne', kid: true, avatar: 'fox' }] } });
  await page.goto(`${WEB_DEV_URL}/?plan=family`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-trial-notice]')).toHaveCount(1);
  await page.goto(`${WEB_DEV_URL}/settings/?plan=family`, { waitUntil: 'networkidle' });
  await expect(page.locator('[name="weightKg"]')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first().getByText('Friends')).toHaveCount(1);
  await context.close();
});

test('a child\'s round has no calories and no line that asks for a weight', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players-kid', { w: 1280, h: 800 });
  await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard&plan=family`, { waitUntil: 'networkidle' });
  await page.waitForURL(/results/, { timeout: 60_000 });
  await expect(page.locator('.k-kcal')).toHaveCount(0);
  await expect(page.getByText(/weight/i)).toHaveCount(0);
  await context.close();
});

test('a player is removed only after the screen has said what goes, and the main player\'s record is cleared, not the player', async ({ browser }) => {
  const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'players-manage', { w: 1280, h: 800 });
  await page.getByRole('button', { name: 'Remove: Mert' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('Remove Mert?');
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.pf-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Remove: Mert' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.pf-notice')).toHaveText('Mert was removed.');
  await expect(page.locator('.pf-row')).toHaveCount(3);
  // the main player: the question is about records, and the player stays
  await page.getByRole('button', { name: 'Remove: Me', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('Clear your records?');
  await expect(page.locator('dialog')).toContainText('friends are not removed here');
  await page.locator('dialog').getByRole('button', { name: 'Clear records' }).click();
  await expect(page.locator('.pf-notice')).toHaveText('Your records on this device were cleared.');
  await expect(page.locator('.pf-row')).toHaveCount(3);
  expect(errors).toEqual([]);
  await context.close();
});

test('removing the player who is playing needs the gate for a child and moves the page to the main player', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players-kid', { w: 1280, h: 800 });
  await page.getByRole('button', { name: 'Clear data on this device' }).click();
  await passGate(page);
  await expect(page.locator('dialog')).toContainText('Remove Defne?');
  await page.locator('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.pf-switch')).toHaveCount(0);
  await page.goto(`${WEB_DEV_URL}/profiles/?plan=family`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-action="profile-pick"]')).toHaveCount(1);
  await context.close();
});

test('with the question switched on, the app opens on who is playing and goes on to where it was asked to', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players-manage', { w: 1280, h: 800 });
  await page.getByRole('button', { name: 'Done' }).click();
  const ask = page.getByRole('checkbox', { name: 'Ask who is playing when the app opens' });
  await expect(ask).not.toBeChecked();
  await ask.check({ force: true });
  await expect(ask).toBeChecked();
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?plan=family`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/profiles\/\?next=%2Fgames%2Fsquat-flap%2F/);
  await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await page.waitForURL(`${WEB_DEV_URL}/games/squat-flap/?plan=family`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Squat Flap');
  await context.close();
});

test('the way on after the picker is never another site', async ({ browser }) => {
  const { page, context } = await bare(browser);
  await page.goto(`${WEB_DEV_URL}/profiles/?next=//evil.example/x&plan=family`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await context.close();
});

test('the family is on the page of a game: each player and their best, the one who plays marked', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players', { w: 1280, h: 800 });
  await page.getByRole('button', { name: 'Play as Mert', exact: true }).click();
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard&plan=family`, { waitUntil: 'networkidle' });
  await page.waitForURL(/results/, { timeout: 60_000 });
  await page.goto(`${WEB_DEV_URL}/games/squat-flap/?plan=family`, { waitUntil: 'networkidle' });
  const table = page.locator('[data-family]');
  await expect(table).toContainText('Best in the family');
  await expect(table.locator('li')).toHaveCount(4);
  await expect(table.locator('li[aria-current="true"]')).toContainText('Mert');
  await expect(table.locator('li').first()).toContainText('Mert');
  await expect(table).toContainText('No score yet');
  await context.close();
});

test('a player keeps their own settings: the seat chosen for one is not the seat of the other', async ({ browser }) => {
  const { page, context } = await openScenario(browser, WEB_DEV_URL, 'players-kid', { w: 1280, h: 800 });
  const seated = page.getByRole('checkbox', { name: /Seated mode/ });
  await expect(seated).not.toBeChecked();
  await seated.check({ force: true });
  await expect(seated).toBeChecked();
  await page.goto(`${WEB_DEV_URL}/profiles/?plan=family`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await passGate(page);
  await page.waitForURL(`${WEB_DEV_URL}/`);
  await page.goto(`${WEB_DEV_URL}/settings/?plan=family`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('checkbox', { name: /Seated mode/ })).not.toBeChecked();
  await context.close();
});

test('two tabs of the same device see the same players', async ({ browser }) => {
  const { page, context } = await bare(browser);
  await addPlayer(page, 'Defne', { kid: true });
  await page.getByRole('button', { name: 'Done' }).click();
  const other = await context.newPage();
  await withHooks(other, FAMILY);
  await other.goto(`${WEB_DEV_URL}/profiles/?plan=family`, { waitUntil: 'networkidle' });
  await expect(other.locator('[data-action="profile-pick"]')).toHaveCount(2);
  await addPlayer(other, 'Mert');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-action="profile-pick"]')).toHaveCount(3);
  await context.close();
});

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: the players screens and the gate keep the layout rule`, async ({ browser }) => {
    test.setTimeout(180_000);
    const found: string[] = [];
    for (const name of ['players', 'players-manage', 'players-add'] as const) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w: bp.w, h: bp.h });
      try {
        for (const p of [...(await checkPage(page)), ...errors.map((e) => `console: ${e}`)]) found.push(`${name}: ${p}`);
        if (name === 'players') {
          // the gate's window, opened by choosing the main player from a child
          await page.getByRole('button', { name: 'Play as Defne', exact: true }).click();
          await page.waitForURL(`${WEB_DEV_URL}/`);
          await page.goto(`${WEB_DEV_URL}/profiles/?plan=family`, { waitUntil: 'networkidle' });
          await page.getByRole('button', { name: 'Play as Me', exact: true }).click();
          await page.locator('dialog.pf-gatebox').waitFor();
          const box = await page.locator('dialog.pf-gatebox').boundingBox();
          if (!box || box.x < 0 || box.y < 0 || box.x + box.width > bp.w + 1 || box.y + box.height > bp.h + 1) found.push(`gate: the window is not whole on the screen (${JSON.stringify(box)})`);
          const over = await page.locator('dialog.pf-gatebox').evaluate((d) => d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1);
          if (over) found.push('gate: the window scrolls');
          for (const p of await checkPage(page)) found.push(`gate: ${p}`);
        }
      } finally {
        await context.close();
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('the Turkish players screens keep the layout rule on a narrow phone and a laptop', async ({ browser }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  for (const [w, h] of [[360, 780], [1280, 800]] as const) {
    for (const name of ['players', 'players-manage', 'players-add'] as const) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w, h, lang: 'tr' });
      try {
        expect(await page.locator('html').getAttribute('lang')).toBe('tr');
        for (const p of [...(await checkPage(page)), ...errors.map((e) => `console: ${e}`)]) found.push(`tr ${name} ${w}: ${p}`);
      } finally {
        await context.close();
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
