// PoseService with the real MediaPipe model in headless Chromium: self-hosted WASM and model, the module worker
// and the main-thread fallback, fed by Chromium's fake camera through CameraService.
import { expect, test } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import { runCamera } from './support/pose-run.ts';

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
