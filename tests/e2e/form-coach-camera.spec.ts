// The form coach with a REAL VIDEO as the camera: Chromium's fake camera plays a freely licensed clip of a real person
// (converted with tools/fake-camera/convert.ts), the real pose model runs on it in the browser, and the page counts.
// The clips are not in the repository (licences: tools/form-fixtures/SOURCES.md); point BA_FORM_CAMERA at the converted file:
//   node tools/fake-camera/convert.ts <clips>/squat-mixkit-52106.mp4 --out <dir>/squat-52106.mjpeg --to 9.5 --repeat 4
//   BA_FORM_CAMERA=<dir>/squat-52106.mjpeg npx playwright test tests/e2e/form-coach-camera.spec.ts
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { DEV_URL } from './support/ports.ts';

const file = process.env.BA_FORM_CAMERA ?? '';
test.skip(!file || !existsSync(file), 'BA_FORM_CAMERA is not set to a converted clip');
if (file) test.use({ launchOptions: withFakeVideo(file) });

interface S { reps: number; clean: number; segments: Record<string, string>; frames: number; view: string | null }

test('a real person squatting in front of the (fake) camera: the real model, repetitions counted, nothing red', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${DEV_URL}/tests/e2e/pages/form-coach.html?move=squat&lang=en`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  await page.locator('.fc-btn--primary').click();
  const snap = (): Promise<S> => page.evaluate(() => (window as unknown as { __formCoach: { snapshot(): S } }).__formCoach.snapshot());
  await page.waitForFunction(() => (window as unknown as { __formCoach: { snapshot(): { frames: number } } }).__formCoach.snapshot().frames > 10, null, { timeout: 120_000 });
  const seen: S[] = [];
  const end = Date.now() + Number(process.env.BA_FORM_CAMERA_S ?? 32) * 1000;
  while (Date.now() < end) { seen.push(await snap()); await page.waitForTimeout(300); }
  const last = seen.at(-1)!;
  await page.screenshot({ path: test.info().outputPath('camera-squat.png') });
  console.log(`camera run: frames ${last.frames}, reps ${last.reps}, clean ${last.clean}, view ${last.view}`);
  test.info().annotations.push({ type: 'camera', description: `frames ${last.frames}, reps ${last.reps}, clean ${last.clean}` });
  // the clip (3 squats in 9.5 s, plus the 1.7 s sync leader) loops in the camera file: about three passes in 32 s
  expect(last.reps).toBeGreaterThanOrEqual(Number(process.env.BA_FORM_CAMERA_MIN ?? 5));
  expect(last.clean).toBe(last.reps);
  expect(errors).toEqual([]);
});
