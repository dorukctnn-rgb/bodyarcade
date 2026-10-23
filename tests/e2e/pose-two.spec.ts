// Two players, one camera (mode 'local2'), headless: Chromium's fake camera shows two people side by side
// (tests/e2e/fixtures/SOURCES.txt). The same run measures the pose rate with numPoses 1 and then 2 (switched
// without reloading the model), keeps both players in their slots, and completes the two-person calibration.
import { expect, test } from '@playwright/test';
import { withFakeVideo } from './support/browser.ts';
import { DEV_URL } from './support/ports.ts';

test.use({ launchOptions: withFakeVideo('tests/e2e/fixtures/two-standing-640x360.mjpeg') });

type Harness = {
  createCameraService: typeof import('../../packages/core/camera/camera.ts').createCameraService;
  createPoseService: typeof import('../../packages/core/pose/service.ts').createPoseService;
  webglRenderer: typeof import('../../packages/core/pose/landmarker.ts').webglRenderer;
  createPlayerAssignment: typeof import('../../packages/core/body/players.ts').createPlayerAssignment;
  createTwoPlayerCalibrator: typeof import('../../packages/core/body/calibrator2.ts').createTwoPlayerCalibrator;
  wasmBase: string;
  modelUrl: string;
};

interface Phase {
  frames: number;
  withPoses: number[];        // poses per frame (numPoses 2) or 1/0 (numPoses 1)
  inference: number[];
  stats: { hz: number; p50: number; p95: number; dropped: number; frames: number };
}

test('two people side by side: numPoses 2, stable players, two-person calibration, frame budget', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`${DEV_URL}/tests/e2e/pages/pose-two.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);

  const r = await page.evaluate(async () => {
    const h = (window as unknown as { harness: Harness }).harness;
    const pose = h.createPoseService();
    const loaded = await pose.load({ modelUrl: h.modelUrl, wasmBase: h.wasmBase, prefer: 'GPU', worker: 'auto', numPoses: 1 });
    await pose.warmUp();
    const cam = h.createCameraService();
    const lease = await cam.acquire();
    await lease.start();

    const players = h.createPlayerAssignment();
    const cal = h.createTwoPlayerCalibrator();
    cal.begin('full');
    let phase: Phase = { frames: 0, withPoses: [], inference: [], stats: { hz: 0, p50: 0, p95: 0, dropped: 0, frames: 0 } };
    let two = false;
    const order: { t: number; x1: number | null; x2: number | null }[] = [];
    const codes: string[] = [];
    let readyAt: number | null = null;
    let firstTwoT: number | null = null;
    let aspect = 0;
    const hipX = (lm: { x: number }[] | null): number | null => (lm ? (1 - ((lm[23]!.x + lm[24]!.x) / 2)) * aspect : null);

    pose.onFrame((f) => {
      aspect = f.aspect;
      phase.frames++;
      phase.inference.push(f.inferenceMs);
      phase.withPoses.push(two ? (f.poses?.length ?? 0) : f.landmarks ? 1 : 0);
      if (!two) return;
      firstTwoT ??= f.t;
      const [p1, p2] = players.push(f);
      order.push({ t: f.t, x1: hipX(p1.landmarks), x2: hipX(p2.landmarks) });
      const st = cal.push([p1, p2]);
      if (codes.at(-1) !== st.code) codes.push(st.code);
      if (st.ready && readyAt === null) readyAt = f.t;
    });
    pose.attach(lease);
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

    await wait(4000);
    phase.stats = pose.stats;
    const one = phase;

    await pose.setNumPoses(2);
    two = true;
    phase = { frames: 0, withPoses: [], inference: [], stats: { hz: 0, p50: 0, p95: 0, dropped: 0, frames: 0 } };
    // The inference percentiles cover the last 120 frames; give the two-person phase enough of them.
    await wait(7000);
    phase.stats = pose.stats;
    const both = phase;

    pose.detach();
    pose.dispose();
    lease.release();
    const profiles = cal.profiles();
    return {
      loaded, one, both, order, codes, aspect,
      readyAfterMs: readyAt !== null && firstTwoT !== null ? readyAt - firstTwoT : null,
      presence: players.presence,
      profiles,
      camLive: cam.stats().live,
      renderer: h.webglRenderer(),
    };
  });

  const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };
  const line = `renderer=${r.renderer.kind} worker=${r.loaded.worker} delegate=${r.loaded.delegate} `
    + `numPoses1: frames=${r.one.frames} hz=${r.one.stats.hz} p50=${pct(r.one.inference, 0.5).toFixed(1)}ms p95=${pct(r.one.inference, 0.95).toFixed(1)}ms | `
    + `numPoses2: frames=${r.both.frames} hz=${r.both.stats.hz} p50=${pct(r.both.inference, 0.5).toFixed(1)}ms p95=${pct(r.both.inference, 0.95).toFixed(1)}ms | `
    + `calibrated after ${r.readyAfterMs?.toFixed(0)} ms, codes ${r.codes.join(' > ')}`;
  test.info().annotations.push({ type: 'pose-two', description: line });
  console.log(line);

  // One-person mode on a two-person picture still finds a person in nearly every frame.
  expect(r.one.frames).toBeGreaterThan(10);
  expect(r.one.withPoses.filter((n) => n === 1).length / r.one.frames).toBeGreaterThan(0.9);

  // numPoses 2: both people in nearly every frame.
  expect(r.both.frames).toBeGreaterThan(15);
  expect(r.both.withPoses.filter((n) => n === 2).length / r.both.frames).toBeGreaterThan(0.85);

  // Player 1 is the person on the left of the mirror view, Player 2 on the right, in every frame: no swaps.
  const pairs = r.order.filter((o) => o.x1 !== null && o.x2 !== null);
  expect(pairs.length / r.order.length).toBeGreaterThan(0.85);
  expect(pairs.every((o) => o.x1! < r.aspect / 2 && o.x2! > r.aspect / 2)).toBe(true);
  expect(r.presence[1].present && r.presence[2].present).toBe(true);

  // Two-person calibration completes with a profile per player on the right side, same person so similar size.
  expect(r.readyAfterMs).not.toBeNull();
  expect(r.readyAfterMs!).toBeLessThan(6000);
  expect(r.profiles).not.toBeNull();
  const p = r.profiles!;
  expect(p[1].rest.hipX).toBeLessThan(r.aspect / 2);
  expect(p[2].rest.hipX).toBeGreaterThan(r.aspect / 2);
  expect(p[1].T / p[2].T).toBeGreaterThan(0.85);
  expect(p[1].T / p[2].T).toBeLessThan(1.15);

  // Frame budget sanity floor on a shared, software-rendered machine; real budgets are measured on devices.
  expect(r.both.stats.hz).toBeGreaterThanOrEqual(3);
  expect(r.camLive).toBe(0);
});
