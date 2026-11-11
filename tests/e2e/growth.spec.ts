// The progress coach end to end in one headless Chromium: the vault on the browser's real IndexedDB and WebCrypto (PIN,
// lock, backup, restore, delete), the guided capture with a synthetic turning body (the trace plays through the same pose
// path a camera uses), the comparison, the 3D twin with ghost and heat map, the program with the daily check-in and a
// form-coach-counted set, the food gates, and the privacy rule: nothing the person enters leaves the page.
import { expect, test, type Page, type Request } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEV_URL } from './support/ports.ts';

const SHOTS = process.env.GROWTH_SHOTS ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  const path = SHOTS ? join(SHOTS, `${name}.png`) : test.info().outputPath(`${name}.png`);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path, fullPage: true });
};
const open = async (page: Page, q: string): Promise<void> => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/growth.html?${q}`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
};

/** Every request the page makes, with its body: nothing typed or captured may be in any of them. */
function watchRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  return seen;
}
function assertPrivate(reqs: Request[], secrets: readonly string[]): void {
  for (const r of reqs) {
    const url = new URL(r.url());
    expect(['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:', r.url()).toBe(true);
    expect(r.method(), r.url()).toBe('GET');
    for (const s of secrets) expect(r.url().includes(s), `${s} in ${r.url()}`).toBe(false);
  }
}

test.describe.configure({ mode: 'serial' });
// the browser's language as on CI (en-US: inches and pounds until a test picks metric), so a run on any machine is the same run
test.use({ locale: 'en-US' });

test('vault: PIN lock, wrong and right PIN, backup, delete all, restore; nothing readable in IndexedDB', async ({ page }) => {
  test.setTimeout(120_000);
  const reqs = watchRequests(page);
  await open(page, 'lang=en&profile=vault#settings');
  await page.locator('[data-new-pin]').fill('482916');
  await page.getByRole('button', { name: 'Lock with a PIN' }).click();
  await expect(page.getByText('PIN lock is on.').first()).toBeVisible();
  // a measurement to protect
  await page.locator('[data-tab=twin]').click();
  await page.locator('[data-height]').fill('171');
  await page.locator('[data-part=waist]').fill('82.5');
  await page.getByRole('button', { name: 'Save measurements' }).click();
  await expect(page.locator('[data-twin-stage] canvas')).toBeVisible();
  // IndexedDB holds sealed bytes only
  const raw = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('ba-growth-vault'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all: unknown[] = await new Promise((res) => { const q = db.transaction('measures').objectStore('measures').getAll(); q.onsuccess = () => res(q.result); });
    return all.map((v) => (v instanceof Uint8Array ? Array.from(v).map((b) => String.fromCharCode(b)).join('') : JSON.stringify(v)));
  });
  expect(raw.length).toBe(1);
  expect(raw[0]).not.toContain('82.5');
  // reload: locked
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  await expect(page.locator('[data-lock]')).toBeVisible();
  await shot(page, 'g1-lock-1440');
  await page.getByLabel('Enter your PIN').first().fill('111111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That PIN did not open it.')).toBeVisible();
  await page.getByLabel('Enter your PIN').first().fill('482916');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('[data-tab=settings]')).toBeVisible();
  // backup
  await page.locator('[data-tab=settings]').click();
  await page.locator('[data-backup-pass]').fill('backup-pass-1');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Take a backup' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^bodyarcade-gelisim-\d{4}-\d{2}-\d{2}\.bagelisim$/);
  const path = test.info().outputPath('backup.bagelisim');
  await file.saveAs(path);
  await expect(page.locator('[data-backup-status]')).toHaveText('Backup saved.');
  await shot(page, 'g1-settings-1440');
  // delete everything (two steps)
  await page.getByRole('button', { name: 'Delete all my progress data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('Everything was deleted.')).toBeVisible();
  // restore: wrong password first, then the right one
  await page.locator('[data-tab=settings]').click();
  await page.locator('[data-restore-file]').setInputFiles(path);
  await page.locator('[data-backup-pass]').fill('not-the-pass');
  await page.getByRole('button', { name: 'Restore a backup' }).click();
  await expect(page.locator('[data-backup-status]')).toHaveText('Wrong password.');
  await page.locator('[data-backup-pass]').fill('backup-pass-1');
  await page.getByRole('button', { name: 'Restore a backup' }).click();
  await expect(page.locator('[data-backup-status]')).toContainText('Restored:');
  await page.locator('[data-tab=twin]').click();
  await expect(page.locator('[data-part=waist]')).toHaveValue('82.5');
  assertPrivate(reqs, ['82.5', '482916', 'backup-pass']);
});

test('capture: a slow turn fills the four directions, the review saves them, compare and timeline show them', async ({ page }) => {
  test.setTimeout(200_000);
  const reqs = watchRequests(page);
  for (const [n, w, h] of [['1440', 1440, 900], ['1920', 1920, 1080], ['390', 390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, `lang=tr&profile=cap${n}&trace=/tests/traces/growth/synth-turn.trace.json#photos`);
    await page.locator('[data-setup]').count();
    await page.getByRole('button', { name: 'Başla', exact: true }).click();
    await expect(page.locator('[data-review] [data-shot]')).toHaveCount(4, { timeout: 45_000 });
    await expect(page.locator('[data-review] [data-shot]').first()).toContainText('Ön');
    await shot(page, `g2-review-${n}`);
    await page.locator('[data-note]').fill('siyah şort');
    await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(page.locator('[data-timeline] [data-session]')).toHaveCount(1);
    await expect(page.locator('[data-compare-area] canvas')).toHaveCount(2);
    await shot(page, `g3-compare-${n}`);
    if (n === '1440') {
      // free views: slider and overlay; Pro views say so
      await page.locator('[data-name=view][data-value=slider]').click();
      await expect(page.locator('[data-compare-area]')).toHaveAttribute('data-mode', 'slider');
      await page.locator('[data-name=view][data-value=turn]').click();
      await expect(page.locator('.gc-toast')).toContainText('Pro');
    }
  }
  assertPrivate(reqs, ['siyah']);
});

test('3D twin: shaped by the typed tape; two measurements give a ghost and a heat map (less at the waist)', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [n, w, h] of [['1440', 1440, 900], ['1920', 1920, 1080], ['390', 390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, `lang=en&profile=twin${n}#twin`);
    // an en-US browser (CI) starts in inches and pounds; this test types centimetres, so it picks metric first (as the food test does)
    await page.locator('[data-tab=settings]').click();
    await page.locator('[data-name=units][data-value=metric]').click();
    await page.locator('[data-tab=twin]').click();
    await page.locator('[data-name=base][data-value=male]').click();
    await page.locator('[data-height]').fill('180');
    for (const [p, v] of Object.entries({ neck: 41, chest: 108, waist: 100, hips: 106, thighL: 61, calfL: 39, upperArmL: 33 })) await page.locator(`[data-part=${p}]`).fill(String(v));
    await page.getByRole('button', { name: 'Save measurements' }).click();
    await page.locator('[data-height]').fill('180');
    await page.locator('[data-part=waist]').fill('90');
    await page.locator('[data-part=hips]').fill('101');
    await page.getByRole('button', { name: 'Save measurements' }).click();
    await page.locator('[data-name=twin][data-value=ghost]').click();
    await page.locator('[data-name=twin][data-value=heat]').click();
    await page.waitForFunction(() => { const s = (window as unknown as { __twin?: { stats(): { ready: boolean; heatMin: number; ghost: boolean } | null } }).__twin?.stats(); return !!s && s.ready && s.ghost && s.heatMin < -0.03; });
    await expect(page.locator('[data-ratios]')).toContainText('Waist to height');
    await shot(page, `g3-twin-${n}`);
  }
});

test('program: build, the check-in with knee pain leaves knee moves out with the note, a set is counted by the form coach', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'lang=tr&profile=prog&trace=/tests/traces/form/sq-mixkit-52106-front.trace.json#program');
  await page.locator('[data-name=goal][data-value=strength]').click();
  // one training day, today, so the test does not depend on the weekday it runs on (a one-day week is session A)
  const wd = await page.evaluate(() => new Date().getDay());
  for (const d of [1, 3, 5]) if (d !== wd) await page.locator(`[data-name=days][data-value="${d}"]`).click();
  if (![1, 3, 5].includes(wd)) await page.locator(`[data-name=days][data-value="${wd}"]`).click();
  await page.getByRole('button', { name: 'Kur', exact: true }).click();
  await expect(page.locator('[data-checkin]')).toBeVisible();
  await page.locator('[data-name=body][data-value=pain]').click();
  await page.locator('[data-name=pain][data-value=knee]').click();
  // minutes are ready options now (kol F: the 30-second form has no typing)
  await page.locator('[data-name=minutes][data-value="20"]').click();
  await page.getByRole('button', { name: 'Günümü planla' }).click();
  await expect(page.locator('[data-today] [data-note=see-professional]')).toHaveText('Ağrı sürerse sağlık uzmanına danış.');
  await expect(page.locator('[data-today] [data-move=squat]')).toHaveCount(0);
  await shot(page, 'g4-today-1440');
  // a normal day: the squat set counted by the form coach from the trace
  await page.locator('[data-name=body][data-value=fine]').click();
  await page.getByRole('button', { name: 'Günümü planla' }).click();
  await expect(page.locator('[data-today] [data-move=squat]')).toHaveCount(1);
  await page.locator('[data-start-session]').click();
  await page.waitForFunction(() => Number(document.querySelector('[data-count]')?.getAttribute('data-count') ?? 0) >= 2, undefined, { timeout: 30_000 });
  await shot(page, 'g4-session-1440');
  await page.locator('[data-set-done]').click();
  await page.getByRole('button', { name: '1-2' }).click();
  const logs = await page.evaluate(async () => (await (window as unknown as { __growth: { vault: { list(s: string): Promise<string[]> } } }).__growth.vault.list('logs')).length);
  expect(logs).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'g4-session-390');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await shot(page, 'g4-session-1920');
});

test('food: numbers for an adult, none in pregnancy, none under 18; general-information footer and the USDA credit', async ({ page }) => {
  test.setTimeout(120_000);
  const reqs = watchRequests(page);
  for (const [n, w, h] of [['1440', 1440, 900], ['1920', 1920, 1080], ['390', 390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, `lang=en&profile=food${n}&plan=pro#home`);
    await page.locator('[data-birth-year]').fill('1996');
    await page.getByRole('button', { name: 'Continue' }).click();
    // an en-US browser starts in inches and pounds; this test types centimetres and kilos, so it picks metric first
    await page.locator('[data-tab=settings]').click();
    await page.locator('[data-name=units][data-value=metric]').click();
    await page.locator('[data-tab=food]').click();
    await expect(page.getByText('Height (cm)')).toBeVisible();
    await page.locator('[data-f-height]').fill('165');
    await page.locator('[data-f-weight]').fill('70');
    await page.locator('[data-name=formula][data-value=female]').click();
    await page.locator('[data-name=pregnant][data-value=no]').click();
    await page.locator('[data-name=concern][data-value=no]').click();
    await page.locator('[data-name=goal][data-value=lose-medium]').click();
    await page.locator('[data-show-plan]').click();
    await expect(page.locator('[data-food-result]')).toHaveAttribute('data-numbers', 'true');
    await expect(page.locator('[data-food-result] [data-kcal]')).toHaveAttribute('data-kcal', /^18[0-9]{2}$/);
    await expect(page.locator('[data-meals] [data-meal]').first()).toBeVisible();
    await expect(page.locator('[data-footer]').first()).toContainText('not medical advice');
    await expect(page.locator('[data-footer]').first()).toContainText('FoodData Central');
    await expect(page.locator('[data-shopping]')).toBeVisible();
    await shot(page, `g5-food-${n}`);
  }
  // pregnancy: no numbers
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-name=pregnant][data-value=yes]').click();
  await page.locator('[data-show-plan]').click();
  await expect(page.locator('[data-food-result]')).toHaveAttribute('data-numbers', 'false');
  await expect(page.locator('[data-food-result] [data-kcal]')).toHaveCount(0);
  await expect(page.locator('[data-gate=pregnant]')).toBeVisible();
  // under 18: the food tab shows only the note, the photo tab is gone
  await open(page, 'lang=en&profile=minor#home');
  await page.locator('[data-birth-year]').fill(String(new Date().getFullYear() - 15));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-tab=photos]')).toHaveCount(0);
  await page.locator('[data-tab=food]').click();
  await expect(page.locator('[data-gate=minor]')).toBeVisible();
  await shot(page, 'g5-minor-1440');
  assertPrivate(reqs, ['1996', '165', '70']);
});

test('home band: one body moves between two tapes, a ghost and heat map beside it, "illustration" on both; reduced motion keeps stills', async ({ page, browser }) => {
  test.setTimeout(90_000);
  for (const [n, w, h] of [['1440', 1440, 700], ['1920', 1920, 800], ['390', 390, 1100]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${DEV_URL}/tests/e2e/pages/growth-band.html?lang=en`);
    await page.waitForFunction(() => (window as unknown as { bandReady?: boolean }).bandReady === true, undefined, { timeout: 30_000 });
    await expect(page.locator('.bab-tag')).toHaveText(['illustration', 'illustration']);
    await expect(page.locator('.bab h2')).toHaveText('Track your own before and after');
    await page.waitForTimeout(1500);
    await shot(page, `band-${n}`);
  }
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 700 } });
  const p2 = await ctx.newPage();
  await p2.goto(`${DEV_URL}/tests/e2e/pages/growth-band.html?lang=tr`);
  await p2.waitForFunction(() => (window as unknown as { bandReady?: boolean }).bandReady === true, undefined, { timeout: 30_000 });
  await expect(p2.locator('.bab-stage img')).toHaveCount(2, { timeout: 10_000 });
  await expect(p2.locator('.bab-stage canvas')).toHaveCount(0);
  await shot(p2, 'band-reduced-1440');
  await ctx.close();
});
