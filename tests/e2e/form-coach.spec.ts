// The form coach page end to end, in a headless browser: a landmark trace from a real person (tests/traces/form, extracted
// from a freely licensed video) plays through the same pose service path a camera uses; the page counts, colours and cues.
// The real-video camera run (the video as Chromium's fake camera, the real pose model) is form-coach-camera.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

interface Snap { reps: number; clean: number; cue: string | null; view: string | null; ready: boolean; segments: Record<string, string>; frames: number; move: string }
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as unknown as { __formCoach: { snapshot(): Snap } }).__formCoach.snapshot());

async function playTrace(page: Page, move: string, trace: string, lang: string, seconds: number): Promise<Snap[]> {
  await page.goto(`${DEV_URL}/tests/e2e/pages/form-coach.html?move=${move}&lang=${lang}&trace=/tests/traces/form/${trace}.trace.json`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  await page.locator('.fc-btn--primary').click();
  const seen: Snap[] = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { seen.push(await snap(page)); await page.waitForTimeout(250); }
  return seen;
}

test('squat from the front (a real person): three clean repetitions, green thighs at depth, Turkish words', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const seen = await playTrace(page, 'squat', 'sq-mixkit-52106-front', 'tr', 11);
  const last = seen.at(-1)!;
  expect(last.frames).toBeGreaterThan(200);
  expect(last.reps).toBe(3);
  expect(last.clean).toBe(3);
  expect(seen.some((s) => s.segments.thighL === 'ok' && s.segments.thighR === 'ok')).toBe(true);
  expect(seen.every((s) => !Object.values(s.segments).includes('bad'))).toBe(true);
  await expect(page.locator('[data-reps]')).toHaveText('3');
  await expect(page.locator('h1')).toHaveText('Form koçu');
  await expect(page.locator('.fc-btn--primary')).toHaveText('Kamerayı kapat');
  await page.screenshot({ path: test.info().outputPath('squat-front.png') });
  expect(errors).toEqual([]);
});

test('half squats (a real person, CDC clip): the depth cue in English and red thighs, the set summary names it', async ({ page }) => {
  test.setTimeout(90_000);
  const seen = await playTrace(page, 'squat', 'sq-cdc-half-45', 'en', 30);
  expect(seen.at(-1)!.reps).toBe(2);
  expect(seen.at(-1)!.clean).toBe(0);
  expect(seen.some((s) => s.cue === 'squat.deeper')).toBe(true);
  expect(seen.some((s) => s.segments.thighL === 'bad')).toBe(true);
  await page.getByRole('button', { name: 'End the set' }).click();
  await expect(page.locator('.fc-summary')).toContainText('2 reps, 0 clean');
  await expect(page.locator('.fc-summary')).toContainText('Most often: not deep enough');
  await page.screenshot({ path: test.info().outputPath('squat-half-summary.png') });
});

test('push-ups from the side (a real person): six repetitions, and the move switch keeps the page alive', async ({ page }) => {
  test.setTimeout(120_000);
  const seen = await playTrace(page, 'pushUp', 'pu-interval-side', 'en', 54);
  expect(seen.at(-1)!.reps).toBe(6);
  expect(seen.at(-1)!.view).toBe('side');
  await page.screenshot({ path: test.info().outputPath('push-up-side.png') });
  await page.getByRole('tab', { name: 'Dumbbell shoulder press' }).click();
  expect((await snap(page)).move).toBe('dbShoulderPress');
});

test('the page fits a phone: no horizontal scroll, the counter inside the picture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await playTrace(page, 'squat', 'sq-mixkit-52106-front', 'de', 3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const stage = await page.locator('.fc-stage').boundingBox();
  const count = await page.locator('.fc-num').first().boundingBox();
  expect(!!stage && !!count && count.x >= stage.x && count.x + count.width <= stage.x + stage.width).toBe(true);
  await page.screenshot({ path: test.info().outputPath('phone-de.png'), fullPage: true });
});
