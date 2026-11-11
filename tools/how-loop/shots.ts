// Pictures of the top of the home page for review: the first screen at a few sizes (the still), and the scene at four moments of
// its loop (moving, the test hook on), to see that the character squats with the person. One headless browser, the Vite dev server.
//
//   node tools/how-loop/shots.ts <out dir> [--sizes=1440x900,1920x1080,390x844] [--lang=en]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { startWeb } from '../page-check/servers.ts';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'how-shots');
const sizes = (flag('sizes') ?? '1440x900,1920x1080,390x844').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const lang = flag('lang') ?? 'en';
mkdirSync(out, { recursive: true });

const web = await startWeb('none');
const browser = await chromium.launch(baseLaunchOptions);
try {
  for (const [w, h] of sizes) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: lang === 'tr' ? 'tr-TR' : 'en-US', hasTouch: w < 760 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${web.url}/${lang === 'en' ? '' : `${lang}/`}`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `home-${lang}-${w}x${h}.png`) });
    console.log(`ok ${w}x${h}${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`);
    await context.close();
  }
  // four moments of the moving scene
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
  const page = await context.newPage();
  await page.addInitScript(() => { (window as unknown as { __BA_TEST__: object }).__BA_TEST__ = { clips: true }; });
  await page.goto(`${web.url}/`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('[data-how-live]', { timeout: 20_000 }).catch(() => console.log('the scene did not start'));
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(600);
    await page.locator('.k-how-scene').screenshot({ path: join(out, `scene-moment-${i}.png`) });
  }
  await context.close();
} finally {
  await browser.close();
  await web.close();
}
