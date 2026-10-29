// The pictures of the game's own screens that the SEO pages show (site/assets/shots/*.webp), made headless from the app itself:
// the web shell through Vite, the practice session and the keyboard hook, no camera and no person in front of one. A round with
// the keyboard shows the app's own warm-up note where the game has one; the captions say what is on the screen and nothing more.
//
//   node tools/seo-shots/run.ts [--out site/assets/shots] [name ...]
//
// Needs ffmpeg (FFMPEG=<path>, else `ffmpeg` on the PATH) to turn the screenshots into webp. After a change to the app's screens,
// run it, look at every picture, then run node packages/web/content/build.ts (content.test.ts checks each picture's size against
// the width and height the page states: SHOT in packages/web/content/copy/seo-shared.ts).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { openScenario, type Scenario } from '../../packages/web/tools/scenarios.ts';
import { repoRoot, startWeb } from '../page-check/servers.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

interface Shot {
  name: string;
  /** A scenario of packages/web/tools/scenarios.ts, or a game played with the keyboard. */
  kind: { scenario: Scenario } | { game: string };
  size: [number, number];
  /** The width of the webp (the height follows). */
  width: number;
  /** Keep only this many pixels from the top (a screen taller than the picture wanted). */
  crop?: number;
}

const DESKTOP: [number, number] = [1440, 900];
const PHONE: [number, number] = [390, 844];
const SHOTS: Shot[] = [
  { name: 'road-run-desktop', kind: { game: 'road-run' }, size: DESKTOP, width: 1200 },
  { name: 'star-catch-desktop', kind: { game: 'star-catch' }, size: DESKTOP, width: 1200 },
  { name: 'firework-jacks-desktop', kind: { game: 'firework-jacks' }, size: DESKTOP, width: 1200 },
  { name: 'pose-wall-desktop', kind: { game: 'pose-wall' }, size: DESKTOP, width: 1200 },
  { name: 'pose-wall-phone', kind: { game: 'pose-wall' }, size: PHONE, width: 390 },
  { name: 'camera-check-desktop', kind: { scenario: 'calibrate' }, size: DESKTOP, width: 1200 },
  { name: 'desk-offer-desktop', kind: { scenario: 'calibrate-desk' }, size: DESKTOP, width: 1200 },
  { name: 'settings-desktop', kind: { scenario: 'settings' }, size: DESKTOP, width: 1200 },
  { name: 'plans-desktop', kind: { scenario: 'plans' }, size: [1440, 1250], width: 1200, crop: 1120 },
];

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const out = resolve(outFlag >= 0 ? (args[outFlag + 1] ?? '') : join(repoRoot(), 'site', 'assets', 'shots'));
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const todo = wanted.length ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS;
if (todo.length === 0) { console.error(`no such picture; the names are ${SHOTS.map((s) => s.name).join(', ')}`); process.exit(2); }
const ffmpeg = process.env['FFMPEG'] ?? 'ffmpeg';

mkdirSync(out, { recursive: true });
const tmp = join(out, '.png-tmp');
mkdirSync(tmp, { recursive: true });

async function takeGame(browser: Browser, base: string, game: string, [w, h]: [number, number], png: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', locale: 'en-US', deviceScaleFactor: 1, hasTouch: w < 1000 });
  const page = await context.newPage();
  // the real game and session with the keyboard hook; the camera is not asked for
  await page.addInitScript(() => { window.__BA_TEST__ = { timeScale: 1, keyboard: true }; });
  await page.goto(`${base}/play/${game}/?input=keyboard&plan=pro`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal'), undefined, { timeout: 20_000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: png });
  await context.close();
}

const web = await startWeb('none');
const browser = await chromium.launch(baseLaunchOptions);
let failed = 0;
try {
  for (const s of todo) {
    const png = join(tmp, `${s.name}.png`);
    try {
      if ('game' in s.kind) await takeGame(browser, web.url, s.kind.game, s.size, png);
      else {
        const o = await openScenario(browser, web.url, s.kind.scenario, { w: s.size[0], h: s.size[1] });
        await o.page.screenshot({ path: png });
        await o.context.close();
      }
      const crop = s.crop ? `crop=${s.size[0]}:${s.crop}:0:0,` : '';
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', png, '-vf', `${crop}scale=${s.width}:-1:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', join(out, `${s.name}.webp`)], { stdio: 'inherit', windowsHide: true });
      console.log(`ok ${s.name}`);
    } catch (e) {
      failed += 1;
      console.error(`FAILED ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} finally {
  await browser.close();
  await web.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
