// The phase 2 gate run (code-audit 11.7) in headless Chromium: Road Run with the camera (fake camera: a person
// standing), the pose model in its worker and the 3D view at the same time. No console errors, the camera is off at
// the results, frame times and pose rate are reported. The 33 ms p95 frame-time gate applies on a hardware GPU; on
// software WebGL (most CI and this headless shell) the numbers are reported only.
// BA_GATE_SECONDS=90 runs the full 90 s; the default is 30 s.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { DEV_URL } from './support/ports.ts';

// BA_GPU=1 asks Chromium for the hardware GPU (ANGLE on D3D11), so the 33 ms gate can be checked on a desktop.
const video = withFakeVideo('tests/e2e/fixtures/standing-640x360.mjpeg');
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
test.use({ launchOptions: process.env.BA_GPU === '1' ? { ...video, args: [...(video.args ?? []), ...GPU_ARGS] } : video });

const SECONDS = Number(process.env.BA_GATE_SECONDS || 30);

test(`camera run of Road Run (${SECONDS} s): pose and 3D together, no console errors, camera off at results`, async ({ page }) => {
  test.setTimeout((SECONDS + 90) * 1000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${DEV_URL}/tests/e2e/pages/road-run-camera.html?sec=${SECONDS}`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  await page.evaluate(() => { void (window as unknown as { ba: any }).ba.session.start('road-run', { mode: 'solo', difficulty: 'medium', input: 'camera', seated: false, world: 'alps' }); });
  await page.waitForFunction(() => {
    const s = (window as unknown as { ba: any }).ba.session.state;
    return s === 'results' || s === 'error';
  }, null, { timeout: (SECONDS + 60) * 1000, polling: 500 });
  const r = await page.evaluate(() => {
    const ba = (window as unknown as { ba: any }).ba;
    const f = [...ba.frames].sort((a: number, b: number) => a - b);
    const pct = (p: number) => (f.length ? f[Math.min(f.length - 1, Math.floor(p * f.length))] : 0);
    return {
      states: ba.seen.states, over: ba.seen.over, errors: ba.seen.errors, frames: f.length, p50: pct(0.5), p95: pct(0.95),
      pose: ba.pose.stats, live: ba.camera.stats().live, renderer: ba.renderer, level: ba.kit.level,
    };
  });
  console.log(`gate run ${SECONDS} s: renderer=${r.renderer.kind} (${r.renderer.renderer}) level=T${r.level} frames=${r.frames} p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms pose hz=${r.pose.hz} p95=${r.pose.p95.toFixed(0)}ms score=${r.over?.score}`);
  expect(r.errors).toEqual([]);
  expect(r.states).toEqual(['setup', 'calibrating', 'countdown', 'running', 'results']);
  expect(r.over.seconds).toBeGreaterThan(SECONDS - 0.1);
  expect(r.live).toBe(0);
  expect(r.frames).toBeGreaterThan(SECONDS * 5);
  if (r.renderer.kind === 'hardware') expect(r.p95).toBeLessThan(33);
  expect(errors).toEqual([]);
});
