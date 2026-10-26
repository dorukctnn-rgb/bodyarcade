// The screen layout rule on the deployed build: every page of the app and every old content page at the ten sizes of
// the build plan, a screenshot each (tests/release/out/shots/<size>/<page>.png) and the automated check of the shell
// (nothing sideways, nothing cut off, no two controls over each other, nothing under the bar) plus console errors.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BREAKPOINTS } from '../../packages/core/ui/layout.ts';
import { checkPage } from '../../packages/web/tools/layout-check.ts';
import { BASE, OUT, legalPages, watchErrors } from './support.ts';

const PAGES: [string, string][] = [
  ['home', '/'], ['home-tr', '/tr/'], ['region', '/workouts/legs/'], ['game-runner', '/games/road-run/'], ['game-mirror', '/games/star-catch/'],
  ['game-flap', '/games/squat-flap/'], ['play', '/play/road-run/'], ['pro', '/pro/'], ['settings', '/settings/'], ['results', '/results/'],
  ['welcome', '/welcome/'], ['notfound', '/no-such-page'], ['privacy', '/privacy'], ['terms', '/terms'], ['guide', '/webcam-fitness-games'],
  ['ringfit', '/ring-fit-adventure-alternative'], ['blog', '/blog/'], ['post', '/blog/why-browser-fitness-games-are-the-future'],
];

// the FAQ, the Turkish legal pages and the delete-account page (when the build has it) are content pages too
const LEGAL = legalPages();
PAGES.push(...LEGAL);
const LEGACY = new Set(['privacy', 'terms', 'guide', 'ringfit', 'blog', 'post', ...LEGAL.map(([name]) => name)]);
/** The content pages' skip link waits off screen until it gets focus (ba.css .skip / .skip:focus): by design. */
const byDesign = (name: string, problem: string): boolean => LEGACY.has(name) && /^a\.skip "Skip to content" starts left of the screen$/.test(problem);

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: every page keeps the layout rule`, async ({ browser }) => {
    test.setTimeout(600_000);
    const dir = join(OUT, 'shots', bp.id);
    mkdirSync(dir, { recursive: true });
    const found: string[] = [];
    const summary: Record<string, string[]> = {};
    for (const [name, path] of PAGES) {
      const context = await browser.newContext({ viewport: { width: bp.w, height: bp.h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = watchErrors(page);
      // the content pages count visits with Plausible: not from a test (an empty script, so nothing fails to load)
      await page.route(/plausible\.io/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForTimeout(name === 'welcome' || name === 'play' ? 2500 : 600);
        await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
        const problems = [...(await checkPage(page)).filter((p) => !byDesign(name, p)), ...errors.list()];
        summary[name] = problems;
        for (const p of problems) found.push(`${name}: ${p}`);
      } finally {
        await context.close();
      }
    }
    writeFileSync(join(OUT, `layout-${bp.id}.json`), JSON.stringify(summary, null, 1));
    expect(found, found.join('\n')).toEqual([]);
  });
}
