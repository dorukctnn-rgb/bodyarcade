// CameraService in a real browser (headless Chromium with its fake camera): frames arrive, release really stops the
// tracks (B10), leaving during the permission prompt leaves no live track (B9), and an ended track marks the lease
// dead (B8).
import { expect, test } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

type Harness = {
  createCameraService: typeof import('../../packages/core/camera/camera.ts').createCameraService;
  isAbortError: (e: unknown) => boolean;
};
declare global { interface Window { harness: Harness; harnessReady: boolean } }

test.beforeEach(async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/camera.html`);
  await page.waitForFunction(() => window.harnessReady === true);
});

test('B10: frames arrive, and release stops every track and detaches the video', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cam = window.harness.createCameraService();
    const lease = await cam.acquire();
    document.body.append(lease.video);
    await lease.start();
    const size = { w: lease.video.videoWidth, h: lease.video.videoHeight };
    const tracks = lease.stream.getTracks();
    const liveBefore = tracks.filter((t) => t.readyState === 'live').length;
    lease.release();
    return { size, info: lease.info, liveBefore, states: tracks.map((t) => t.readyState), src: lease.video.srcObject, alive: lease.alive, stats: cam.stats() };
  });
  expect(r.size.w).toBeGreaterThan(0);
  expect(r.size.h).toBeGreaterThan(0);
  expect(r.info.width).toBeGreaterThan(0);
  expect(r.liveBefore).toBe(1);
  expect(r.states).toEqual(['ended']);
  expect(r.src).toBeNull();
  expect(r.alive).toBe(false);
  expect(r.stats).toEqual({ acquired: 1, released: 1, live: 0 });
});

test('B9: Back during a slow permission prompt leaves no live track', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const streams: MediaStream[] = [];
    // The audit harness delayed getUserMedia to hold the prompt open; do the same here.
    navigator.mediaDevices.getUserMedia = (c) => new Promise((resolve, reject) => {
      setTimeout(() => { real(c).then((s) => { streams.push(s); resolve(s); }, reject); }, 400);
    });
    const cam = window.harness.createCameraService();
    const ac = new AbortController();
    const p = cam.acquire({ signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const err = await p.catch((e: unknown) => e);
    await new Promise((res) => setTimeout(res, 900));
    return {
      aborted: window.harness.isAbortError(err),
      streams: streams.length,
      states: streams.flatMap((s) => s.getTracks().map((t) => t.readyState)),
      stats: cam.stats(),
    };
  });
  expect(r.aborted).toBe(true);
  expect(r.streams).toBe(1);
  expect(r.states).toEqual(['ended']);
  expect(r.stats.live).toBe(0);
});

test('B8: an ended track marks the lease dead, and a new acquire gets a live camera', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cam = window.harness.createCameraService();
    const first = await cam.acquire();
    let ended = 0;
    first.onEnded(() => { ended++; });
    // Chromium cannot unplug its fake camera; the 'ended' event is what an unplug or a revoke delivers.
    first.stream.getVideoTracks()[0]!.dispatchEvent(new Event('ended'));
    const deadAlive = first.alive;
    first.release();
    const second = await cam.acquire();
    await second.start();
    const secondAlive = second.alive;
    second.release();
    return { ended, deadAlive, secondAlive, stats: cam.stats() };
  });
  expect(r.ended).toBe(1);
  expect(r.deadAlive).toBe(false);
  expect(r.secondAlive).toBe(true);
  expect(r.stats).toEqual({ acquired: 2, released: 2, live: 0 });
});
