// Looks at one page of the web shell the way page-check does and prints what is on it: handy to see why a target fails.
//
//   node tools/page-check/dump.ts /play/pad-work/?input=keyboard [--size 1280x800] [--wait 2500] [--sel body] [--html] [--hook '{"timeScale":5}'] [--shot out.jpg] [--click ".ba-btn--primary"] [--eval "document.title"] [--site]
//
// Prints the console messages, the visible text of the selector (or its HTML with --html) and the layout findings.
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { layoutProbe } from './probe.ts';
import { startStatic, startWeb, repoRoot } from './servers.ts';
import { beNice } from './nice.ts';

beNice();

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const path = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--') && opt((args[i - 1] as string).slice(2)) === a)) ?? '/';
const [w, h] = (opt('size') ?? '1280x800').split('x').map(Number) as [number, number];
const server = args.includes('--site') ? await startStatic(join(repoRoot(), 'site')) : await startWeb('fill');
const browser = await chromium.launch(baseLaunchOptions);
try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1000, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const hooks = JSON.parse(opt('hook') ?? '{"timeScale":5,"roundSeconds":120}') as Record<string, unknown>;
  await page.addInitScript((x) => { (window as unknown as { __BA_TEST__: unknown }).__BA_TEST__ = x; }, hooks);
  page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text().split('\n')[0]}`));
  page.on('pageerror', (e) => console.log(`[uncaught] ${e.message.split('\n')[0]}`));
  page.on('requestfailed', (r) => console.log(`[request failed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) console.log(`[HTTP ${r.status()}] ${r.url()}`); });
  await page.goto(`${server.url}${path}${path.includes('?') ? '&' : '?'}plan=${opt('plan') ?? 'free'}`, { waitUntil: 'networkidle' });
  for (let i = 0; i < args.length; i++) if (args[i] === '--click') { await page.locator(args[i + 1] as string).first().click({ timeout: 8000 }); await page.waitForTimeout(400); }
  await page.waitForTimeout(Number(opt('wait') ?? 2500));
  const ev = opt('eval');
  if (ev) console.log(JSON.stringify(await page.evaluate(ev), null, 1));
  const sel = opt('sel') ?? 'body';
  if (args.includes('--html')) console.log(await page.locator(sel).first().evaluate((e) => e.outerHTML));
  else console.log(await page.locator(sel).first().evaluate((e) => (e as HTMLElement).innerText));
  const probe = await page.evaluate(layoutProbe, { ignore: [], touch: w < 1000, minTarget: 24, primary: [] });
  for (const f of probe.findings) console.log(`[${f.severity} ${f.kind}] ${f.message}`);
  const shot = opt('shot');
  if (shot) await page.screenshot({ path: shot, type: 'jpeg', quality: 80 });
} finally {
  await browser.close();
  await server.close();
}
