// Screenshots of the shell, headless, at the ten screen sizes of the layout rule (BUILD-PLAN "Screen layout rule"), with
// the automated checks of tools/layout-check.ts. Starts its own Vite server on a free port and stops it at the end; no
// window ever opens.
//
//   node packages/web/tools/shots.ts <out dir> [page ...] [--sizes=360x780,1280x800] [--lang=tr] [--plan=pro] [--dark]
//
// Pages: see SCENARIOS in tools/scenarios.ts (home, home-week, region, game, game-more, game-pro, game-locked, settings, pro, results, play, calibrate, notfound, friends).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../../tests/e2e/support/browser.ts';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from './layout-check.ts';
import { openScenario, SCENARIOS, type Scenario } from './scenarios.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const out = args.find((a) => !a.startsWith('--')) ?? 'shots';
const pages = args.filter((a) => !a.startsWith('--')).slice(1);
const lang = flag('lang') ?? 'en';
const plan = flag('plan') ?? 'free';
const dark = args.includes('--dark');
const sizes = (flag('sizes')?.split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { id: s, w: w as number, h: h as number }; })) ?? BREAKPOINTS.map((b) => ({ id: b.id, w: b.w, h: b.h }));
const known = new Set<string>(SCENARIOS);

const here = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ configFile: join(here, 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${(server.httpServer?.address() as { port: number }).port}`;
const browser = await chromium.launch(baseLaunchOptions);
mkdirSync(out, { recursive: true });

let failed = 0;
const list = pages.length ? pages : [...SCENARIOS.filter((n) => n !== 'friends')];
for (const name of list) {
  if (!known.has(name)) { console.error(`unknown page ${name}`); continue; }
  for (const size of sizes) {
    const { page, context, errors } = await openScenario(browser, base, name as Scenario, { w: size.w, h: size.h, lang, plan: plan as 'free' | 'pro', dark });
    const hud = name === 'play' ? await page.evaluate(() => window.__BA__?.debug().playProblems ?? ['no HUD']) : [];
    const problems = [...(await checkPage(page)), ...hud.map((h) => `HUD: ${h}`), ...errors.map((e) => `console: ${e}`)];
    // A sticky bar sits at the bottom of the first screen in a full-page capture and hides what is under it; for the overview it goes static.
    if (!args.includes('--view')) await page.addStyleTag({ content: '.k-actionbar { position: static !important; }' });
    await page.screenshot({ path: join(out, `${name}-${size.id}${lang === 'en' ? '' : `-${lang}`}${dark ? '-dark' : ''}.png`), fullPage: !args.includes('--view') && name !== 'play' && name !== 'calibrate' });
    if (problems.length) { failed += 1; console.log(`${name} ${size.id}: ${problems.length} problem(s)\n  ${problems.slice(0, 8).join('\n  ')}`); }
    await context.close();
  }
}
await browser.close();
await server.close();
console.log(failed ? `${failed} screen(s) with problems` : 'no problems found');
process.exit(failed ? 1 : 0);
