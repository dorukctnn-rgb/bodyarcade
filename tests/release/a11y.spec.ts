// Accessibility of the deployed build (code-audit 11.7: zero serious violations): axe-core (WCAG 2.2 A/AA and best
// practices) on every kind of page, the app's and the old content pages', on a phone and a laptop. Serious and
// critical violations fail; the rest is recorded. Evidence: tests/release/out/a11y-<size>.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { scan } from '../../packages/web/e2e/support/axe.ts';
import { BASE, OUT } from './support.ts';

const PAGES: [string, string][] = [
  ['home', '/'], ['home-tr', '/tr/'], ['region', '/workouts/legs/'], ['game', '/games/road-run/'], ['game-tr', '/tr/games/squat-flap/'],
  ['play', '/play/road-run/'], ['pro', '/pro/'], ['settings', '/settings/'], ['results', '/results/'], ['welcome', '/welcome/'], ['notfound', '/no-such-page'],
  ['privacy', '/privacy'], ['terms', '/terms'], ['guide', '/webcam-fitness-games'], ['ringfit', '/ring-fit-adventure-alternative'], ['blog', '/blog/'],
  ['post', '/blog/why-browser-fitness-games-are-the-future'],
];
const SIZES = [{ id: 'phone-390', width: 390, height: 844 }, { id: 'laptop-1280', width: 1280, height: 800 }];

for (const size of SIZES) {
  test(`axe at ${size.id}: no serious or critical violation on any page`, async ({ browser }) => {
    test.setTimeout(300_000);
    const all: Record<string, string[]> = {};
    const blocking: string[] = [];
    for (const [name, path] of PAGES) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.route(/plausible\.io/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
        await page.waitForTimeout(800);
        const found = await scan(page);
        all[name] = found;
        for (const f of found) if (/\((serious|critical)\)/.test(f)) blocking.push(`${name}: ${f}`);
      } finally {
        await context.close();
      }
    }
    writeFileSync(join(OUT, `a11y-${size.id}.json`), JSON.stringify(all, null, 1));
    expect(blocking, blocking.join('\n')).toEqual([]);
  });
}
