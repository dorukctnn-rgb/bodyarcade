// "Too dark" and "the light is behind you" on the real camera path: Chromium's fake camera plays the real desk picture made
// very dark, and the same picture made into a silhouette against a bright wall (ffmpeg, tests/e2e/fixtures/SOURCES.txt); the
// brightness map is measured from the real pixels in the worker and the calibration says so instead of waiting without a word.
// Each test launches its own headless browser, because the picture is a launch option of the fake camera.
import { chromium, expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { open, view } from './support/session.ts';

const START = { mode: 'solo', difficulty: 'normal', input: 'camera', seated: false };

async function watch(fixture: string, want: string): Promise<{ codes: string[]; state: string; profiles: number; errors: number }> {
  const browser = await chromium.launch(withFakeVideo(fixture));
  try {
    const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await open(page, { seated: true });
    await page.evaluate((o) => { void (window as unknown as { run: any }).run.session.start('test', o); }, START);
    const end = Date.now() + 75_000;
    let v = await view(page);
    while (!v.seen.codes.includes(want) && Date.now() < end) { await page.waitForTimeout(250); v = await view(page); }
    await page.waitForTimeout(1500);
    v = await view(page);
    await page.evaluate(() => (window as unknown as { run: any }).run.session.quit());
    return { codes: v.seen.codes, state: v.state, profiles: v.seen.profile.length, errors: v.seen.errors.length };
  } finally {
    await browser.close();
  }
}

test('a very dark picture: the calibration says too_dark, and the player is not calibrated on it', async () => {
  test.setTimeout(120_000);
  const r = await watch('tests/e2e/fixtures/desk-dark-640x480.mjpeg', 'too_dark');
  expect(r.codes).toContain('too_dark');
  expect(r.codes).not.toContain('ok');
  expect(r.state).toBe('calibrating');
  expect(r.profiles).toBe(0);
  expect(r.errors).toBe(0);
});

test('a person against a bright wall with the face in shadow: the calibration says backlit', async () => {
  test.setTimeout(120_000);
  const r = await watch('tests/e2e/fixtures/desk-backlit-640x480.mjpeg', 'backlit');
  expect(r.codes).toContain('backlit');
  expect(r.errors).toBe(0);
});
