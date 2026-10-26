// The family switch on the REAL build (tests/release/family/real-build.ts made it), served by the production Worker in Miniflare:
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tests/release/local-stack.ts --dist tests/release/out/family/dist -- node tests/release/family/real.ts
// At the ten sizes: the paywall offers the Family plan once, with its price, and its buy button opens the Family plan's own Gumroad
// checkout (window.open is kept, no tab opens, nothing is bought); nothing overlaps; the players screen of a device with no plan offers
// the Family plan. Evidence: tests/release/out/family/real/ (a picture of each screen at each size, real.json). Exit 1 on any finding.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { GUMROAD_CHECKOUT } from '../../../packages/core/entitlements/catalog.ts';
import { BREAKPOINTS } from '../../../packages/core/ui/layout.ts';
import { checkPage } from '../../../packages/web/tools/layout-check.ts';
import { baseLaunchOptions } from '../../e2e/support/browser.ts';
import { BASE, IS_LOCAL, LOCAL_ARGS, ROOT, watchErrors } from '../support.ts';

if (!IS_LOCAL) {
  console.error(`run through tests/release/local-stack.ts (BA_RELEASE_URL is ${BASE}: the deployed builds have the switch off)`);
  process.exit(2);
}
const FAMILY = GUMROAD_CHECKOUT['family-yearly'];
const out = join(ROOT, 'tests', 'release', 'out', 'family', 'real');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...baseLaunchOptions, args: [...(baseLaunchOptions.args ?? []), ...LOCAL_ARGS] });
const found: string[] = [];
const seen: Record<string, unknown> = {};
for (const bp of BREAKPOINTS) {
  const context = await browser.newContext({ viewport: { width: bp.w, height: bp.h }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'en-US' });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = (url?: string | URL) => { w.__opened.push(String(url)); return null; };
  });
  await page.goto(`${BASE}/pro/`, { waitUntil: 'load' });
  await page.locator('[data-action="buy"]').waitFor({ state: 'visible', timeout: 30_000 });
  const family = page.locator('label.k-plan', { hasText: 'Family' });
  const n = await family.count();
  const text = n ? (await family.first().innerText()).replace(/\s+/g, ' ') : '';
  if (n !== 1) found.push(`${bp.id} pro: ${n} Family plan cards`);
  if (!/59\.99/.test(text)) found.push(`${bp.id} pro: the Family card says "${text}"`);
  let checkout: string | null = null;
  if (n) {
    await family.first().click();
    const buy = page.locator('[data-action="buy"]');
    await page.waitForFunction(() => document.querySelector('[data-action="buy"]')?.getAttribute('data-plan') === 'family-yearly', null, { timeout: 5000 })
      .catch(() => found.push(`${bp.id} pro: the buy button is not for family-yearly after choosing Family`));
    await buy.click();
    await page.waitForFunction(() => (window as unknown as { __opened: string[] }).__opened.length > 0, null, { timeout: 5000 }).catch(() => undefined);
    checkout = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1) ?? null);
    if (checkout !== FAMILY) found.push(`${bp.id} pro: Family's buy opens ${checkout}, not ${FAMILY}`);
  }
  const plans = (await page.locator('label.k-plan').allInnerTexts()).map((p) => p.replace(/\s+/g, ' ').slice(0, 60));
  await page.screenshot({ path: join(out, `${bp.id}-pro.png`) });
  for (const p of await checkPage(page)) found.push(`${bp.id} pro: ${p}`);
  await page.goto(`${BASE}/profiles/`, { waitUntil: 'load' });
  await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => found.push(`${bp.id} profiles: no heading`));
  const upsell = await page.locator('a[href*="/pro"]').filter({ hasText: /family/i }).count();
  if (upsell < 1) found.push(`${bp.id} profiles: no offer of the Family plan on a device without it`);
  await page.screenshot({ path: join(out, `${bp.id}-profiles.png`) });
  for (const p of await checkPage(page)) found.push(`${bp.id} profiles: ${p}`);
  for (const e of errors.list()) found.push(`${bp.id}: ${e}`);
  seen[bp.id] = { plans, familyText: text, checkout, upsell };
  await context.close();
}
await browser.close();
writeFileSync(join(out, 'real.json'), JSON.stringify({ base: BASE, seen, found }, null, 1));
console.log(JSON.stringify(seen['laptop-1280'] ?? seen, null, 1));
console.log(found.length ? `FOUND ${found.length}:\n${found.join('\n')}` : 'family on the real build: clean at the ten sizes');
process.exit(found.length ? 1 : 0);
