// Pictures of every game in play, for comparing the look before and after a change to the graphics: the web shell through
// Vite, the practice session with the keyboard hook (no camera, nobody in front of one), headless, one browser at a time.
//
//   node tools/gfx-shots/run.ts <out dir> [game ...] [--sizes=1440x900,390x844] [--wait=9000] [--query=worlds=1]
//
// Each picture is <game>-<w>x<h>.png. A game that does not reach its HUD is reported and the rest carry on.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { startWeb } from '../page-check/servers.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

export const GAMES = ['squat-flap', 'road-run', 'pose-wall', 'star-catch', 'twist-turbine', 'knee-sprint', 'summit-climb', 'firework-jacks', 'pad-work', 'reaction-tag', 'limbo-bend'] as const;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith('--'));
const out = resolve(positional[0] ?? 'gfx-shots');
const wanted = positional.slice(1);
const games = wanted.length ? wanted : [...GAMES];
const sizes = (flag('sizes') ?? '1440x900,390x844').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const wait = Number(flag('wait') ?? 9000);
const extra = flag('query');

async function take(browser: Browser, base: string, game: string, [w, h]: [number, number], png: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', locale: 'en-US', deviceScaleFactor: 1, hasTouch: w < 1000 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => { window.__BA_TEST__ = { timeScale: 1, keyboard: true }; });
    await page.goto(`${base}/play/${game}/?input=keyboard&plan=pro${extra ? `&${extra}` : ''}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 45_000 });
    await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal'), undefined, { timeout: 30_000 });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: png });
    console.log(`ok ${game} ${w}x${h}${errors.length ? ` (page errors: ${errors.slice(0, 2).join(' | ')})` : ''}`);
  } finally {
    await context.close();
  }
}

mkdirSync(out, { recursive: true });
const web = await startWeb('none');
const browser = await chromium.launch(baseLaunchOptions);
let failed = 0;
try {
  for (const game of games) {
    for (const size of sizes) {
      try { await take(browser, web.url, game, size, join(out, `${game}-${size[0]}x${size[1]}.png`)); }
      catch (e) { failed += 1; console.error(`FAILED ${game} ${size.join('x')}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); }
    }
  }
} finally {
  await browser.close();
  await web.close();
}
console.log(failed ? `${failed} picture(s) failed` : 'all pictures taken');
process.exit(failed ? 1 : 0);
