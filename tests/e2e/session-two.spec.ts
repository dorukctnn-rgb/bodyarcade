// Session end to end in headless Chromium, mode 'local2': two people side by side in Chromium's fake camera, the real
// detectCapabilities on a 1280 x 720 desktop viewport, both players calibrated, two input streams, and quit() leaves
// no camera on.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { open, view, waitState } from './support/session.ts';

test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/two-standing-640x360.mjpeg') });


test('offered on a desktop viewport; both players calibrated; two input streams; quit leaves no camera on', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  let v = await view(page);
  expect(v.caps).toEqual({ device: 'desktop', local2: true, local2Reason: 'ok' });
  await page.evaluate(() => { void (window as unknown as { run: any }).run.session.start('test', { mode: 'local2', difficulty: 'normal', input: 'camera', seated: false }); });
  await waitState(page, 'running', 45_000);
  await page.waitForTimeout(800);
  v = await view(page);
  expect(v.seen.errors).toEqual([]);
  expect(v.starts).toEqual([{ seed: v.starts[0]!.seed, mode: 'local2', profile: true, profiles: ['1', '2'] }]);
  expect(v.twoStreams).toBe(true);
  expect(v.seen.players.filter((p) => !p.present)).toEqual([]);
  await page.evaluate(() => (window as unknown as { run: any }).run.session.quit());
  v = await view(page);
  expect(v.state).toBe('idle');
  expect(v.live).toBe(0);
  expect(v.disposed).toBe(1);
});
