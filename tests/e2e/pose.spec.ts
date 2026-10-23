// PoseService with the real MediaPipe model in headless Chromium: self-hosted WASM and model, the module worker
// and the main-thread fallback, fed by Chromium's fake camera through CameraService.
import { expect, test } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

type Harness = {
  createCameraService: typeof import('../../packages/core/camera/camera.ts').createCameraService;
  createPoseService: typeof import('../../packages/core/pose/service.ts').createPoseService;
  wasmBase: string;
  modelUrl: string;
};

export async function runCamera(page: import('@playwright/test').Page, worker: 'only' | 'never', seconds: number) {
  return page.evaluate(async ({ worker, seconds }) => {
    const h = (window as unknown as { harness: Harness }).harness;
    const pose = h.createPoseService();
    const phases: string[] = [];
    const loaded = await pose.load({ modelUrl: h.modelUrl, wasmBase: h.wasmBase, prefer: 'CPU', worker, onProgress: (p) => { if (!phases.includes(p.phase)) phases.push(p.phase); } });
    const w0 = performance.now();
    await pose.warmUp();
    const warmMs = performance.now() - w0;
    const cam = h.createCameraService();
    const lease = await cam.acquire();
    await lease.start();
    const frames: { seq: number; t: number; person: boolean; ms: number; src: string; aspect: number; inRange: boolean }[] = [];
    pose.onFrame((f) => frames.push({
      seq: f.seq, t: f.t, person: f.landmarks !== null, ms: f.inferenceMs, src: f.source, aspect: f.aspect,
      inRange: f.landmarks ? f.landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.visibility >= 0 && p.visibility <= 1) : true,
    }));
    pose.attach(lease);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const stats = pose.stats;
    pose.detach();
    const afterDetach = frames.length;
    await new Promise((r) => setTimeout(r, 300));
    pose.dispose();
    lease.release();
    return { loaded, phases, warmMs, frames, afterDetach, stats, camStats: cam.stats(), trackStates: lease.stream.getTracks().map((t) => t.readyState), info: lease.info };
  }, { worker, seconds });
}

test.describe('pose service (Chromium fake camera)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DEV_URL}/tests/e2e/pages/pose.html`);
    await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  });

  for (const worker of ['only', 'never'] as const) {
    test(`${worker === 'only' ? 'module worker' : 'main thread'}: loads the self-hosted model and analyses camera frames`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const external: string[] = [];
      page.on('request', (r) => { if (!r.url().startsWith(DEV_URL)) external.push(r.url()); });

      const r = await runCamera(page, worker, 3);
      expect(r.loaded.worker).toBe(worker === 'only');
      expect(r.loaded.delegate).toBe('CPU');
      expect(r.phases).toEqual(['wasm', 'model']);
      expect(r.frames.length).toBeGreaterThan(15);
      expect(r.frames.every((f) => f.src === 'camera' && f.ms > 0 && f.inRange)).toBe(true);
      expect(r.frames[0]!.aspect).toBeCloseTo(r.info.width / r.info.height, 3);
      for (let i = 1; i < r.frames.length; i++) {
        expect(r.frames[i]!.seq).toBeGreaterThan(r.frames[i - 1]!.seq);
        expect(r.frames[i]!.t).toBeGreaterThan(r.frames[i - 1]!.t);
      }
      expect(r.stats.p50).toBeGreaterThan(0);
      expect(r.afterDetach).toBe(r.frames.length);       // nothing arrives after detach
      expect(r.camStats).toEqual({ acquired: 1, released: 1, live: 0 });
      expect(r.trackStates).toEqual(['ended']);
      expect(external).toEqual([]);                     // no CDN: WASM and model are self-hosted
      expect(errors).toEqual([]);
    });
  }
});
