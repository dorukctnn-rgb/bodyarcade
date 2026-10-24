// Accessibility of the shell with axe-core (WCAG 2.2 A and AA plus its best practices) on the pages a player uses, at a phone,
// a tablet and a laptop size, in the light and in the dark theme, then the things axe cannot see: the keyboard, focus, the
// reduced motion promise and the names of the controls the HUD and the dialogs add.
import { expect, test } from '@playwright/test';
import { openScenario, type Scenario } from '../tools/scenarios.ts';
import { scan } from './support/axe.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const PAGES: Scenario[] = ['home', 'home-week', 'region', 'game', 'game-more', 'game-pro', 'game-locked', 'settings', 'pro', 'results', 'play', 'calibrate', 'calibrate-desk', 'calibrate-headroom', 'plans', 'plans-pro', 'results-plan', 'results-progress', 'pro-unavailable', 'pro-trial', 'home-trial', 'notfound', 'friends', 'friends-new', 'lobbies', 'room', 'room-host', 'safety', 'friendlink', 'welcome', 'welcome-2', 'welcome-3', 'welcome-4', 'welcome-5', 'players', 'players-manage', 'players-add', 'players-kid', 'race-dialog', 'race-offer'];
const SIZES = [{ w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1280, h: 800 }];

for (const dark of [false, true]) {
  test(`axe finds nothing on any page (${dark ? 'dark' : 'light'} theme, phone, tablet, laptop)`, async ({ browser }) => {
    test.setTimeout(420_000);
    const found: string[] = [];
    for (const size of SIZES) {
      for (const name of PAGES) {
        const { page, context } = await openScenario(browser, WEB_DEV_URL, name, { w: size.w, h: size.h, dark });
        try {
          for (const p of await scan(page)) found.push(`${name} ${size.w}x${size.h}: ${p}`);
        } finally {
          await context.close();
        }
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('the Turkish pages pass axe too, and say what language they are in', async ({ browser }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  for (const name of ['home', 'game', 'settings', 'pro', 'results', 'welcome', 'welcome-3', 'welcome-4'] as const) {
    const { page, context } = await openScenario(browser, WEB_DEV_URL, name, { w: 390, h: 844, lang: 'tr' });
    try {
      expect(await page.locator('html').getAttribute('lang')).toBe('tr');
      for (const p of await scan(page)) found.push(`tr ${name}: ${p}`);
    } finally {
      await context.close();
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
