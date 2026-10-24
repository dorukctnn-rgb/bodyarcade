// Session end to end in headless Chromium with a person at a desk (24 Oct, Doruk: "kamera hips'i algılamadı, daha kolay ve
// hızlı olmalı"): Chromium's fake camera plays a real person framed like a laptop camera (head and shoulders, the hips under
// the picture; tests/e2e/fixtures/SOURCES.txt), through the real CameraService, PoseService (MediaPipe), calibrator, pose feed
// and feature extractor. A game that wants the whole body and has a seated variant plays its seated variant instead of waiting
// for ever; a person standing in full view is never taken for a desk.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { open, view, waitState } from './support/session.ts';

const START = { mode: 'solo', difficulty: 'normal', input: 'camera', seated: false };
const run = (page: import('@playwright/test').Page) => page.evaluate((o) => { void (window as unknown as { run: any }).run.session.start('test', o); }, START);

test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/desk-640x480.mjpeg') });

test('a whole-body game with a seated variant takes the desk profile by itself, plays the seated variant, and does not lose the player for having no hips in view', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, { seated: true });
  await run(page);
  await waitState(page, 'running', 90_000);
  await page.waitForTimeout(3000);
  const v = await view(page);
  expect(v.seen.errors).toEqual([]);
  expect(v.seen.states).toEqual(['setup', 'calibrating', 'countdown', 'running']);
  expect(v.state).toBe('running');
  expect(v.seen.pauses).toEqual([]);                           // the gate asks for the shoulders at a desk, not the hips
  expect(v.seen.profile).toEqual([{ profile: 'upper', outcome: 'fallback', seated: true, supports: { full: false, upper: true, seated: true, side: false } }]);
  expect(v.startDetail).toEqual([{ seated: true, kind: 'upper', framing: 'upper', hipsEstimated: true, headroom: null }]);
  // what the screen could say while it waited: the hips were the first thing missing, or the picture was too close
  expect(v.seen.codes.some((c) => c === 'hips_out' || c === 'too_close')).toBe(true);
  expect(v.seen.codes.at(-1)).toBe('ok');
  expect(v.steps).toBeGreaterThan(30);
  await page.evaluate(() => (window as unknown as { run: any }).run.session.quit());
  expect((await view(page)).live).toBe(0);
});

test('"play at the desk" a moment in ends the wait at once', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, { seated: true });
  await run(page);
  await waitState(page, 'calibrating', 90_000);
  // a steady spell is needed first (about half a second of pose frames); the button may be pressed again until it takes
  const started = Date.now();
  let state = 'calibrating';
  while (state === 'calibrating' && Date.now() - started < 60_000) {
    await page.waitForTimeout(400);
    await page.evaluate(() => (window as unknown as { run: any }).run.session.playAtDesk?.());
    state = (await view(page)).state;
  }
  expect(state).not.toBe('calibrating');
  await waitState(page, 'running', 20_000);
  const v = await view(page);
  expect(v.seen.profile).toEqual([{ profile: 'upper', outcome: 'fallback', seated: true, supports: { full: false, upper: true, seated: true, side: false } }]);
  expect(v.startDetail[0]).toMatchObject({ seated: true, kind: 'upper', hipsEstimated: true });
  expect(v.seen.errors).toEqual([]);
  await page.evaluate(() => (window as unknown as { run: any }).run.session.quit());
});

test('a game without a seated variant is not taken at the desk: it keeps asking for the body (and play-at-desk does nothing)', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, { seated: false });
  await run(page);
  await waitState(page, 'calibrating', 90_000);
  await page.waitForTimeout(6000);
  await page.evaluate(() => (window as unknown as { run: any }).run.session.playAtDesk?.());
  await page.waitForTimeout(500);
  const v = await view(page);
  expect(v.state).toBe('calibrating');
  expect(v.seen.profile).toEqual([]);
  expect(v.seen.errors).toEqual([]);
  await page.evaluate(() => (window as unknown as { run: any }).run.session.quit());
});
