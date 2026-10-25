// The screen layout rule (BUILD-PLAN "Screen layout rule") on every one of the ten sizes and every page of the shell:
// nothing sideways, nothing cut off, no two controls over each other, nothing left under the bar, the HUD inside its
// safe area and clear of the camera view, and no error in the console.
import { test, expect } from '@playwright/test';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from '../tools/layout-check.ts';
import { openScenario, type Scenario } from '../tools/scenarios.ts';
import { WEB_DEV_URL } from './support/ports.ts';

// BA_PAGES=results-replay,calibrate runs the check on those pages only (a new page is tried alone before the whole run)
const ONLY = (process.env['BA_PAGES'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const PAGES: Scenario[] = (['home', 'home-week', 'region', 'game', 'game-more', 'game-pro', 'game-locked', 'settings', 'pro', 'results', 'play', 'calibrate', 'calibrate-desk', 'calibrate-headroom', 'plans', 'plans-pro', 'results-plan', 'results-progress', 'results-replay', 'pro-unavailable', 'pro-trial', 'home-trial', 'notfound', 'friends', 'friends-new', 'lobbies', 'room', 'room-host', 'safety', 'friendlink', 'race-dialog', 'race-offer', 'explainer', 'camera-error', 'play-nocamera'] as Scenario[]).filter((p) => ONLY.length === 0 || ONLY.includes(p));

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: every page keeps the layout rule`, async ({ browser }) => {
    test.setTimeout(300_000);
    const found: string[] = [];
    for (const name of PAGES) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w: bp.w, h: bp.h });
      try {
        const hud = name === 'play' || name === 'play-nocamera' ? await page.evaluate(() => window.__BA__?.debug().playProblems ?? ['no HUD']) : [];
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
    for (const name of ['home', 'game', 'game-more', 'settings', 'pro', 'results', 'calibrate', 'calibrate-desk', 'calibrate-headroom', 'race-dialog', 'race-offer', 'explainer', 'camera-error'] as const) {
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

test('the Turkish plans keep the layout rule on the narrowest phones (the engines measure words a few pixels apart, so no button may sit at the edge of its card)', async ({ browser }) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  for (const w of [320, 340, 375]) {
    for (const name of ['plans', 'plans-pro'] as const) {
      const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, name, { w, h: 700, lang: 'tr' });
      try {
        // every button and every badge is inside the card it belongs to
        const outside = await page.evaluate(() => [...document.querySelectorAll('.k-plancard')].flatMap((card) => {
          const c = card.getBoundingClientRect();
          return [...card.querySelectorAll('.ba-btn, .ba-badge')].filter((el) => el.getBoundingClientRect().right > c.right + 1).map((el) => `${el.className.split(' ')[0]} "${(el.textContent ?? '').trim().slice(0, 30)}" leaves its card`);
        }));
        for (const p of [...(await checkPage(page)), ...outside, ...errors.map((e) => `console: ${e}`)]) found.push(`tr ${name} ${w}: ${p}`);
      } finally {
        await context.close();
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
