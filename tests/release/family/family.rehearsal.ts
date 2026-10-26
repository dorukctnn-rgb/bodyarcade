// The family switch rehearsal (tests/release/family/playwright.config.ts; FAMILY_ON on locally, never committed): what launch day's switch
// shows, at the ten sizes of the layout rule. The players screens, the form and the gate at ten sizes are packages/web/e2e/profiles.spec.ts
// (run beside this); here: the family table on a game page, a child's rules on every screen (home, region, game, settings, plans,
// friends, players, a round's results, the shop behind the gate), and the main player's players screen with the upsell gone (the plan
// is there). First written for the final test rehearsal of 25 Oct (20/20 with the shell's specs 50/50).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { BREAKPOINTS } from '../../../packages/core/ui/layout.ts';
import { checkPage } from '../../../packages/web/tools/layout-check.ts';
import { openScenario } from '../../../packages/web/tools/scenarios.ts';
import { WEB_DEV_URL } from '../../../packages/web/e2e/support/ports.ts';

const SHOTS = fileURLToPath(new URL('../out/family/shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const FAST = { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };
const MAIN = { ...FAST, plan: 'family' as const, players: [{ name: 'Defne', kid: true, avatar: 'fox' }, { name: 'Mert', avatar: 'robot' }, { name: 'Elif', avatar: 'rocket' }] };
const KID = { ...FAST, plan: 'family' as const, social: true, trial: { endsInHours: 30 }, players: [{ name: 'Defne', kid: true, avatar: 'fox', active: true }, { name: 'Mert', avatar: 'robot' }] };
/** The friends side of the practice build says things on the console under a child (profiles.spec filters the same). */
const ours = (e: string): boolean => !/social|friends/i.test(e);

async function look(page: Page, label: string, file: string, errors: string[], found: string[]): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  for (const p of await checkPage(page)) found.push(`${label}: ${p}`);
  for (const e of errors.splice(0).filter(ours)) found.push(`${label}: console: ${e}`);
  await page.screenshot({ path: join(SHOTS, `${file}.png`) });
}

async function childRules(page: Page, label: string, found: string[]): Promise<void> {
  if (await page.locator('[data-trial-notice]').count()) found.push(`${label}: a trial notice under a child`);
  if (await page.locator('[name="weightKg"]').count()) found.push(`${label}: a weight field under a child`);
  if (await page.locator('.k-kcal').count()) found.push(`${label}: calories under a child`);
  const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
  if (await nav.count() && await nav.getByText('Friends', { exact: true }).count()) found.push(`${label}: a Friends tab under a child`);
}

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: the family table on a game page, and the players screen of the main player`, async ({ browser }) => {
    test.setTimeout(180_000);
    const found: string[] = [];
    const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'players', { w: bp.w, h: bp.h, hooks: MAIN });
    try {
      await look(page, 'players', `${bp.id}-players-main`, errors, found);
      // the plan is there: the screen offers to add, never to buy
      if (await page.locator('a[href*="/pro"]', { hasText: /Family/i }).count()) found.push('players: an offer of the Family plan to a device that has it');
      await page.goto(`${WEB_DEV_URL}/games/squat-flap/?plan=family`, { waitUntil: 'networkidle' });
      const table = page.locator('[data-family]');
      await expect(table).toContainText('Best in the family');
      await expect(table.locator('li')).toHaveCount(4);
      await expect(table.locator('li[aria-current="true"]')).toHaveCount(1);
      await table.scrollIntoViewIfNeeded();
      await look(page, 'game page', `${bp.id}-game-family`, errors, found);
      const box = await table.boundingBox();
      if (!box || box.x < 0 || box.x + box.width > bp.w + 1) found.push(`family table: not whole across the screen (${JSON.stringify(box)})`);
    } finally {
      await context.close();
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  test(`${bp.label}: a child's rules on every screen`, async ({ browser }) => {
    test.setTimeout(240_000);
    const found: string[] = [];
    const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'players-kid', { w: bp.w, h: bp.h, hooks: KID });
    try {
      await childRules(page, 'settings', found);
      await look(page, 'settings', `${bp.id}-kid-settings`, errors, found);
      for (const [name, path] of [['home', '/'], ['region', '/workouts/legs/'], ['game', '/games/squat-flap/'], ['plans', '/plans/'], ['friends', '/friends/?social=1'], ['players', '/profiles/']] as const) {
        await page.goto(`${WEB_DEV_URL}${path}${path.includes('?') ? '&' : '?'}plan=family`, { waitUntil: 'networkidle' });
        await page.locator('main').first().waitFor();
        await childRules(page, name, found);
        if (name === 'friends' && !(await page.getByText('This player is a child. To add friends, open the main player.').count())) found.push('friends: the page does not say who to ask');
        await look(page, name, `${bp.id}-kid-${name}`, errors, found);
      }
      // a round: no calories, no line that asks for a weight
      await page.goto(`${WEB_DEV_URL}/play/squat-flap/?input=keyboard&plan=family`, { waitUntil: 'networkidle' });
      await page.waitForURL(/results/, { timeout: 60_000 });
      await childRules(page, 'results', found);
      if (await page.getByText(/weight/i).count()) found.push('results: a line about weight under a child');
      await look(page, 'results', `${bp.id}-kid-results`, errors, found);
      // the shop is behind the parent gate, and the gate's window is whole on the screen
      await page.goto(`${WEB_DEV_URL}/pro/?plan=family`, { waitUntil: 'networkidle' });
      const gate = page.locator('dialog.pf-gatebox');
      await expect(gate).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      const box = await gate.boundingBox();
      if (!box || box.x < 0 || box.y < 0 || box.x + box.width > bp.w + 1 || box.y + box.height > bp.h + 1) found.push(`shop gate: the window is not whole on the screen (${JSON.stringify(box)})`);
      await look(page, 'shop gate', `${bp.id}-kid-pro-gate`, errors, found);
    } finally {
      await context.close();
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}
