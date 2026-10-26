// Session end to end in headless Chromium, one player: the real CameraService and PoseService (MediaPipe) with
// Chromium's fake camera (one person standing) and a small test game. Calibrates, counts down, runs; a pause renders
// nothing (B12); resume calibrates again; at results the camera is off (B10).
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { open, view, waitState } from './support/session.ts';

test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/standing-640x360.mjpeg') });


test('calibrate, count down, run; pause renders nothing (B12); resume calibrates again; results turn the camera off (B10)', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await page.evaluate(() => { void (window as unknown as { run: any }).run.session.start('test', { mode: 'solo', difficulty: 'normal', input: 'camera', seated: false }); });
  await waitState(page, 'running');
  let v = await view(page);
  expect(v.seen.errors).toEqual([]);
  expect(v.seen.states).toEqual(['setup', 'calibrating', 'countdown', 'running']);
  expect(v.seen.calibration).toBeGreaterThan(3);
  expect(v.seen.countdown).toEqual([1, 0]);
  expect(v.starts).toEqual([{ seed: v.starts[0]!.seed, mode: 'solo', profile: true, profiles: null }]);
  expect(v.live).toBe(1);

  await page.waitForTimeout(1000);
  v = await view(page);
  expect(v.steps).toBeGreaterThan(20);
  expect(v.renders).toBeGreaterThan(5);

  await page.evaluate(() => (window as unknown as { run: any }).run.session.pause('user'));
  const paused = await view(page);
  await page.waitForTimeout(1500);
  v = await view(page);
  expect(v.state).toBe('paused');
  expect([v.steps, v.renders]).toEqual([paused.steps, paused.renders]);

  await page.evaluate(() => (window as unknown as { run: any }).run.session.resume());
  v = await view(page);
  expect(v.state).toBe('calibrating');
  await waitState(page, 'running');

  await page.evaluate(() => { (window as unknown as { run: any }).run.game.end = true; });
  await waitState(page, 'results', 5000);
  v = await view(page);
  expect(v.seen.over?.score).toBe(v.steps);
  expect(v.live).toBe(0);
  expect(v.acquired).toBe(1);
  expect(v.starts.length).toBe(1);
  const tracksLive = await page.evaluate(() => [...document.querySelectorAll('video')].some((el) => {
    const s = (el as HTMLVideoElement).srcObject as MediaStream | null;
    return !!s && s.getTracks().some((t) => t.readyState === 'live');
  }));
  expect(tracksLive).toBe(false);
});

test('a person standing in full view is never taken for a desk, even when the game has a seated variant: the full profile, measured, played standing', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, { seated: true });
  await page.evaluate(() => { void (window as unknown as { run: any }).run.session.start('test', { mode: 'solo', difficulty: 'normal', input: 'camera', seated: false }); });
  await waitState(page, 'running');
  const v = await view(page);
  expect(v.seen.errors).toEqual([]);
  expect(v.seen.profile).toEqual([{ profile: 'full', outcome: 'measured', seated: false, supports: { full: true, upper: true, seated: true, side: false } }]);
  expect(v.startDetail).toEqual([{ seated: false, kind: 'full', framing: 'full', hipsEstimated: false, headroom: null }]);
  await page.evaluate(() => (window as unknown as { run: any }).run.session.quit());
});
