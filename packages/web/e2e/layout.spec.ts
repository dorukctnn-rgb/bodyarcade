// The screen layout rule (BUILD-PLAN "Screen layout rule") on every one of the ten sizes and every page of the shell:
// nothing sideways, nothing cut off, no two controls over each other, nothing left under the bar, the HUD inside its
// safe area and clear of the camera view, and no error in the console.
import { test, expect } from '@playwright/test';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from '../tools/layout-check.ts';
import { openScenario, type Scenario } from '../tools/scenarios.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const PAGES: Scenario[] = ['home', 'home-week', 'region', 'game', 'game-more', 'game-pro', 'game-locked', 'settings', 'pro', 'results', 'play', 'calibrate', 'calibrate-desk', 'calibrate-headroom', 'plans', 'plans-pro', 'results-plan', 'results-progress', 'home-week', 'notfound', 'friends', 'friends-new', 'lobbies', 'room', 'room-host', 'safety', 'friendlink'];

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: every page keeps the layout rule`, async ({ browser }) => {
    test.setTimeout(300_000);
    const found: string[] = [];
    for (const name of PAGES) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w: bp.w, h: bp.h });
      try {
        const hud = name === 'play' ? await page.evaluate(() => window.__BA__?.debug().playProblems ?? ['no HUD']) : [];
        const problems = [...(await checkPage(page)), ...hud.map((h) => `HUD: ${h}`), ...errors.map((e) => `console: ${e}`)];
        for (const p of problems) found.push(`${name}: ${p}`);
      } finally {
        await context.close();
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('the Turkish pages keep the layout rule on a narrow phone and a laptop (longer words)', async ({ browser }) => {
  test.setTimeout(300_000);
  const found: string[] = [];
  for (const [w, h] of [[360, 780], [1280, 800]] as const) {
    for (const name of ['home', 'game', 'game-more', 'settings', 'pro', 'results', 'calibrate', 'calibrate-desk', 'calibrate-headroom'] as const) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w, h, lang: 'tr' });
      try {
        for (const p of [...(await checkPage(page)), ...errors.map((e) => `console: ${e}`)]) found.push(`tr ${name} ${w}: ${p}`);
      } finally {
        await context.close();
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
