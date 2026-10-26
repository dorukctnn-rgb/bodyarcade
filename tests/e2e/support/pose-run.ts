// One camera run through the real stack (CameraService -> PoseService), executed inside the harness page
// tests/e2e/pages/pose.html. Returns per-frame facts plus the last landmarks for shape checks.
import type { Page } from '@playwright/test';

type Harness = {
  createCameraService: typeof import('../../../packages/core/camera/camera.ts').createCameraService;
  createPoseService: typeof import('../../../packages/core/pose/service.ts').createPoseService;
  webglRenderer: typeof import('../../../packages/core/pose/landmarker.ts').webglRenderer;
  wasmBase: string;
  modelUrl: string;
};

export interface CameraRun {
  loaded: { delegate: 'GPU' | 'CPU'; worker: boolean; loadMs: number };
  phases: string[];
  warmMs: number;
  frames: {
    seq: number; t: number; person: boolean; ms: number; src: string; aspect: number; inRange: boolean;
    /** The brightness map when this frame carried one: its size and what is in it. */
    light: { cols: number; rows: number; n: number; mean: number; min: number; max: number; luma: number[]; lm: { x: number; y: number; z: number; visibility: number }[] | null } | null;
  }[];
  afterDetach: number;
  stats: { hz: number; p50: number; p95: number; dropped: number; frames: number };
  camStats: { acquired: number; released: number; live: number };
  trackStates: string[];
  info: { width: number; height: number };
  last: { x: number; y: number; z: number; visibility: number }[] | null;
  renderer: { kind: 'hardware' | 'software' | 'none'; renderer: string };
}

export function runCamera(page: Page, worker: 'only' | 'never' | 'auto', seconds: number, prefer: 'GPU' | 'CPU' = 'CPU'): Promise<CameraRun> {
  return page.evaluate(async ({ worker, seconds, prefer }) => {
    const h = (window as unknown as { harness: Harness }).harness;
    const pose = h.createPoseService();
    const phases: string[] = [];
    const loaded = await pose.load({ modelUrl: h.modelUrl, wasmBase: h.wasmBase, prefer, worker, onProgress: (p) => { if (!phases.includes(p.phase)) phases.push(p.phase); } });
    const w0 = performance.now();
    await pose.warmUp();
    const warmMs = performance.now() - w0;
    const cam = h.createCameraService();
    const lease = await cam.acquire();
    await lease.start();
    const frames: CameraRun['frames'] = [];
    let last: CameraRun['last'] = null;
    pose.onFrame((f) => {
      if (f.landmarks) last = f.landmarks;
      frames.push({
        seq: f.seq, t: f.t, person: f.landmarks !== null, ms: f.inferenceMs, src: f.source, aspect: f.aspect,
        inRange: f.landmarks ? f.landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.visibility >= 0 && p.visibility <= 1) : true,
        light: f.light
          ? { cols: f.light.cols, rows: f.light.rows, n: f.light.luma.length, mean: f.light.luma.reduce((a, b) => a + b, 0) / f.light.luma.length, min: Math.min(...f.light.luma), max: Math.max(...f.light.luma), luma: f.light.luma, lm: f.landmarks }
          : null,
      });
    });
    pose.attach(lease);
    // At least `seconds`; on a machine busy with other test runs, up to four times as long until 20 frames are in.
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000 || (frames.length < 20 && performance.now() - t0 < seconds * 4000)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const stats = pose.stats;
    pose.detach();
    const afterDetach = frames.length;
    await new Promise((r) => setTimeout(r, 300));
    pose.dispose();
    lease.release();
    return { loaded, phases, warmMs, frames, afterDetach, stats, camStats: cam.stats(), trackStates: lease.stream.getTracks().map((t) => t.readyState), info: lease.info, last, renderer: h.webglRenderer() };
  }, { worker, seconds, prefer });
}
