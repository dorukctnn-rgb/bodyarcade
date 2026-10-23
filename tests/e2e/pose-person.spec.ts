// Headless camera run with a real person: Chromium's fake camera plays a public-domain clip of a person standing
// (tests/e2e/fixtures/SOURCES.txt), through CameraService and PoseService with the real model.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { DEV_URL } from './support/ports.ts';
import { runCamera } from './support/pose-run.ts';

test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/standing-640x360.mjpeg') });

test('a person in front of the camera: landmarks in nearly every frame, in body order', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/pose.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  // Prefer the GPU like the game does; on a software WebGL renderer (headless, CI) the service must pick the CPU.
  const r = await runCamera(page, 'auto', 4, 'GPU');
  if (r.renderer.kind !== 'hardware') expect(r.loaded.delegate).toBe('CPU');
  expect(r.stats.hz).toBeGreaterThanOrEqual(5);   // sanity floor; the GPU delegate on SwiftShader gave 3-4 Hz

  expect(r.info.width / r.info.height).toBeCloseTo(16 / 9, 2);
  expect(r.frames.length).toBeGreaterThan(20);
  const seen = r.frames.filter((f) => f.person).length / r.frames.length;
  expect(seen).toBeGreaterThan(0.9);
  expect(r.frames.every((f) => f.inRange && f.aspect > 1.7)).toBe(true);

  // Standing, facing the camera: nose above shoulders above hips above knees above ankles (image y grows down),
  // and the person's left shoulder (11) appears on the image's right (raw camera image, not mirrored).
  const lm = r.last!;
  const y = (i: number) => lm[i]!.y;
  expect(y(0)).toBeLessThan((y(11) + y(12)) / 2);
  expect((y(11) + y(12)) / 2).toBeLessThan((y(23) + y(24)) / 2);
  expect((y(23) + y(24)) / 2).toBeLessThan((y(25) + y(26)) / 2);
  expect((y(25) + y(26)) / 2).toBeLessThan((y(27) + y(28)) / 2);
  expect(lm[11]!.x).toBeGreaterThan(lm[12]!.x);

  test.info().annotations.push({ type: 'pose', description: `renderer=${r.renderer.kind} (${r.renderer.renderer}) worker=${r.loaded.worker} delegate=${r.loaded.delegate} frames=${r.frames.length} hz=${r.stats.hz} p50=${r.stats.p50.toFixed(1)}ms p95=${r.stats.p95.toFixed(1)}ms warm=${r.warmMs.toFixed(0)}ms load=${r.loaded.loadMs.toFixed(0)}ms` });
  console.log(test.info().annotations.at(-1)?.description);
  expect(r.camStats.live).toBe(0);
});
