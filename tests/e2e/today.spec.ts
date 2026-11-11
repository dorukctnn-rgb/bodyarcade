// Kol F end to end in one headless Chromium: the Today panel (goal, the 30-second check-in, today's plan with its game,
// food, the week, the quests), the knee-pain day that keeps its minutes, the progress page (records of moves and games,
// history, week bars, the weekly goal), the quests page (points, the week's challenge, badges, the friend race to come),
// every site language, reduced motion, the 360 capture step by step (the stop sign, the preview, retake and continue),
// and the privacy rule: nothing the person enters leaves the page. Phone first: 390 px, then 1440 and 1920.
import { expect, test, type Page, type Request } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEV_URL } from './support/ports.ts';

const SHOTS = process.env.TODAY_SHOTS ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  const path = SHOTS ? join(SHOTS, `${name}.png`) : test.info().outputPath(`${name}.png`);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path, fullPage: true });
};
const open = async (page: Page, q: string): Promise<void> => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/growth.html?${q}`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
};
const noSideScroll = async (page: Page): Promise<void> => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(1);
};
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

test('today: the goal, the check-in, a sample plan in three parts with its game, food to set up, the week and the quests', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [n, w, h] of [['390', 390, 844], ['1440', 1440, 900], ['1920', 1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, `lang=tr&profile=today${n}&play=1#home`);
    await expect(page.locator('[data-tab=home]')).toHaveText('Bugün');
    await expect(page.locator('[data-today-panel]')).toBeVisible();
    await expect(page.locator('[data-today-goal]')).toContainText('Bugünün hedefi: 20 dakika hareket');
    await expect(page.locator('[data-today-goal] [data-points]')).toBeVisible();
    await expect(page.locator('[data-checkin]')).toBeVisible();
    await expect(page.locator('[data-today-plan] [data-plan-line]')).toHaveText(/^Bugün \d+ dakikan var: \d+ dk ısınma, \d+ dk oyunlu antrenman(, \d+ dk esneme)?\.$/);
    await expect(page.locator('[data-today-plan]')).toContainText('Başlangıç planı');
    await expect(page.locator('[data-today-plan] [data-game] a')).toHaveAttribute('href', /^\/tr\/games\//);
    await expect(page.locator('[data-today-food]')).toHaveAttribute('data-state', 'setup');
    await expect(page.locator('[data-week-card] .gc-bar')).toHaveCount(7);
    await expect(page.locator('[data-today-quests] [data-quest]')).toHaveCount(3);
    await expect(page.locator('[data-today-quests] [data-quest=checkin]')).toHaveAttribute('data-done', 'false');
    await expect(page.locator('[data-tip]')).toHaveAttribute('data-tip', 'checkin-first');
    // the setup card and the shortcuts are still there
    await expect(page.locator('[data-setup]')).toBeVisible();
    await expect(page.locator('[data-shortcuts] .gc-card').first()).toBeVisible();
    await noSideScroll(page);
    await shot(page, `f1-today-${n}`);
  }
});

test('check-in: knee pain on a 20-minute day keeps 15+ minutes, nothing loads the knee, the note says ask a health professional, the quests turn gentle', async ({ page }) => {
  test.setTimeout(120_000);
  const reqs = watchRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'lang=tr&profile=painday&play=1#home');
  await page.locator('[data-name=sleep][data-value=ok]').click();
  await page.locator('[data-name=energy][data-value="3"]').click();
  await page.locator('[data-name=body][data-value=pain]').click();
  // a pain without its place is asked for
  await page.locator('[data-plan-today]').click();
  await expect(page.locator('.gc-toast')).toHaveText('Nerede?');
  await page.locator('[data-name=pain][data-value=knee]').click();
  await page.locator('[data-name=minutes][data-value="20"]').click();
  await page.locator('[data-plan-today]').click();
  await expect(page.locator('[data-checkin-done]')).toBeVisible();
  await expect(page.locator('[data-checkin-done]')).toContainText('Bir yerim ağrıyor: Diz');
  const minutes = Number(await page.locator('[data-today-plan]').getAttribute('data-today-plan'));
  expect(minutes).toBeGreaterThanOrEqual(15);
  expect(minutes).toBeLessThanOrEqual(20);
  await expect(page.locator('[data-today-plan] [data-note=see-professional]')).toHaveText('Ağrı sürerse sağlık uzmanına danış.');
  await expect(page.locator('[data-today-plan] [data-adj=pain-fill]')).toBeVisible();
  for (const knee of ['squat', 'reverseLunge', 'forwardLunge', 'jumpingJack', 'chairSquat', 'highKnees', 'skater', 'buttKicks']) await expect(page.locator(`[data-today-plan] [data-move=${knee}]`)).toHaveCount(0);
  await expect(page.locator('[data-today-plan] [data-game]')).not.toContainText('Squat Flap');
  await expect(page.locator('[data-tip]')).toHaveAttribute('data-tip', 'pain');
  await expect(page.locator('[data-today-quests] [data-quest]')).toHaveCount(2);
  await expect(page.locator('[data-today-quests] [data-quest=checkin]')).toHaveAttribute('data-done', 'true');
  await expect(page.locator('[data-today-quests] [data-quest=easy5]')).toBeVisible();
  await noSideScroll(page);
  await shot(page, 'f2-knee-390');
  // the program tab reads the same answers
  await page.locator('[data-start-today=sample]').click();
  await expect(page.locator('[data-checkin]')).toBeVisible();
  await expect(page.locator('[data-today] [data-note=see-professional]')).toBeVisible();
  await expect(page.locator('[data-today] [data-safe]')).toHaveCount(1);
  await shot(page, 'f2-program-knee-390');
  // back on Today the program is the person's now
  await page.locator('[data-tab=home]').click();
  await expect(page.locator('[data-start-today=program]')).toBeVisible();
  assertPrivate(reqs, ['Diz', 'painAreas']);
});

test('progress: a counted set and game rounds show as records and history; the week bars; the weekly goal changes', async ({ page }) => {
  test.setTimeout(120_000);
  const reqs = watchRequests(page);
  for (const [n, w, h] of [['390', 390, 844], ['1440', 1440, 900], ['1920', 1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, `lang=en&profile=prog${n}&play=1#progress`);
    // a program set of 12 push-ups, as the session runner writes it
    await page.evaluate(async () => {
      const g = (window as unknown as { __growth: { vault: { putJson(s: string, id: string, v: unknown): Promise<void> }; render(): Promise<void> } }).__growth;
      const t = Date.now() - 3_600_000;
      for (const [i, reps] of [[1, 10], [2, 12]] as const) await g.vault.putJson('logs', `log-${i}`, { sessionId: 's1', moveId: 'pushUp', setNo: i, reps, clean: reps, measured: [], rir: 1, corrected: false, startedAt: t + i * 90_000, endedAt: t + i * 90_000 + 40_000, source: 'camera' });
      await g.render();
    });
    await expect(page.locator('[data-progress-page]')).toBeVisible();
    await expect(page.locator('[data-tile=streak]')).toBeVisible();
    await expect(page.locator('[data-records] [data-record=pushUp]')).toContainText('12 reps');
    await expect(page.locator('[data-records] [data-game-record=squat-flap]')).toHaveAttribute('data-best', '1240');
    await expect(page.locator('[data-records] [data-game-record=squat-flap]')).toContainText('Squat Flap');
    await expect(page.locator('[data-history] li')).toHaveCount(4);
    await expect(page.locator('[data-history] li[data-kind=workout]')).toHaveCount(1);
    await expect(page.locator('[data-chart=weeks] .gc-bars').first().locator('.gc-bar')).toHaveCount(8);
    await expect(page.locator('[data-measures]')).toContainText('3D twin');
    await noSideScroll(page);
    await shot(page, `f3-progress-${n}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-name=goal-days][data-value="4"]').click();
  await expect(page.locator('[data-week-goal]')).toHaveAttribute('data-week-goal', '4/90');
  await page.locator('[data-name=goal-minutes][data-value="150"]').click();
  await expect(page.locator('[data-week-goal]')).toHaveAttribute('data-week-goal', '4/150');
  await expect(page.locator('[data-tile=week]')).toContainText('/4');
  assertPrivate(reqs, ['pushUp', 'log-1']);
});

test('quests: points, today\'s quests, the week\'s challenge, badges and the friend race to come', async ({ page }) => {
  test.setTimeout(90_000);
  for (const [n, w, h] of [['390', 390, 844], ['1440', 1440, 900], ['1920', 1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, `lang=tr&profile=quest${n}&play=1#home`);
    await page.locator('[data-plan-today]').click();
    await expect(page.locator('[data-checkin-done]')).toBeVisible();
    await page.locator('[data-tab=quests]').click();
    await expect(page.locator('[data-quests-page]')).toBeVisible();
    await expect(page.locator('[data-tile=points-total] b')).not.toHaveText('0');
    await expect(page.locator('[data-quests-today] [data-quest=checkin]')).toHaveAttribute('data-done', 'true');
    await expect(page.locator('[data-challenge]')).toBeVisible();
    await expect(page.locator('[data-badges] [data-badge=first-checkin]')).toHaveAttribute('data-earned', 'true');
    await expect(page.locator('[data-badges] [data-badge=workouts-10]')).toHaveAttribute('data-earned', 'false');
    await expect(page.locator('[data-friend-race=soon] button')).toBeDisabled();
    await expect(page.locator('[data-friend-race=soon]')).toContainText('Arkadaşınla yarış');
    await noSideScroll(page);
    await shot(page, `f4-quests-${n}`);
  }
});

test('every site language: the panel, the progress page and the quests in that language, no placeholder left', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const title: Record<string, string> = { en: 'Today', tr: 'Bugün', de: 'Heute', es: 'Hoy', fr: 'Aujourd’hui' };
  const progress: Record<string, string> = { en: 'Progress', tr: 'İlerleme', de: 'Fortschritt', es: 'Progreso', fr: 'Progrès' };
  for (const lang of ['en', 'tr', 'de', 'es', 'fr']) {
    await open(page, `lang=${lang}&profile=lang-${lang}&play=1#home`);
    await expect(page.locator('[data-today-goal] h2')).toHaveText(title[lang]!);
    await expect(page.locator('[data-tab=progress]')).toHaveText(progress[lang]!);
    for (const tab of ['home', 'progress', 'quests']) {
      await page.locator(`[data-tab=${tab}]`).click();
      await expect(page.locator('main')).toHaveAttribute('data-ready', tab);
      const text = await page.locator('main').innerText();
      expect(text, `${lang} ${tab}`).not.toMatch(/\{[a-z]+\}/i);
      expect(text, `${lang} ${tab}`).not.toMatch(/undefined|NaN/);
    }
    await shot(page, `f5-lang-${lang}-390`);
  }
});

test('reduced motion: the panel renders the same and nothing moves', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await open(page, 'lang=tr&profile=reduced&play=1#home');
  await expect(page.locator('[data-today-panel]')).toBeVisible();
  const moving = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => {
    const s = getComputedStyle(e);
    const timed = (v: string): boolean => v.split(',').some((x) => parseFloat(x) > 0);
    return (s.animationName !== 'none' && timed(s.animationDuration)) || timed(s.transitionDuration);
  }).length);
  expect(moving).toBe(0);
  await shot(page, 'f6-reduced-390');
  await ctx.close();
});

test('360 step by step: no photo while turning, the stop sign, a preview with retake and continue at each direction, eight photos saved', async ({ page }) => {
  test.setTimeout(180_000);
  const reqs = watchRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'lang=en&plan=pro&profile=step360&trace=/tests/traces/growth/synth-step-turn.trace.json#photos');
  await page.locator('[data-name=mode][data-value=full]').click();
  await expect(page.locator('[data-full-note]')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // the stop sign shows while the body holds still at the front
  await expect(page.locator('[data-hold]')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'f7-360-hold-390');
  const preview = page.locator('[data-step-preview]');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toHaveAttribute('data-bucket', '0');
  await expect(page.locator('[data-cue]')).toHaveText('Check the photo: retake it or continue.');
  await shot(page, 'f7-360-preview-390');
  // retake: the front is taken again while the person still stands there
  await page.locator('[data-step-retake]').click();
  await expect(preview).toBeHidden();
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toHaveAttribute('data-bucket', '0');
  await page.setViewportSize({ width: 1440, height: 900 });
  const order: string[] = [];
  for (let k = 0; k < 8; k++) {
    await expect(preview).toBeVisible({ timeout: 25_000 });
    order.push((await preview.getAttribute('data-bucket')) ?? '');
    if (k === 1) {
      await expect(page.locator('[data-bucket="45"][data-state=now]')).toHaveCount(1);
      await shot(page, 'f7-360-preview-1440');
    }
    await page.locator('[data-step-continue]').click();
    if (k < 7) await expect(preview).toBeHidden();
  }
  expect(order).toEqual(['0', '45', '90', '135', '180', '225', '270', '315']);
  await expect(page.locator('[data-review] [data-shot]')).toHaveCount(8, { timeout: 20_000 });
  await shot(page, 'f7-360-review-1440');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-timeline] [data-session]')).toHaveCount(1);
  assertPrivate(reqs, []);
});
