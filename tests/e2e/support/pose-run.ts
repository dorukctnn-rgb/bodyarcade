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
  frames: { seq: number; t: number; person: boolean; ms: number; src: string; aspect: number; inRange: boolean }[];
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
      });
    });
    pose.attach(lease);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const stats = pose.stats;
    pose.detach();
    const afterDetach = frames.length;
    await new Promise((r) => setTimeout(r, 300));
    pose.dispose();
    lease.release();
    return { loaded, phases, warmMs, frames, afterDetach, stats, camStats: cam.stats(), trackStates: lease.stream.getTracks().map((t) => t.readyState), info: lease.info, last, renderer: h.webglRenderer() };
  }, { worker, seconds, prefer });
}
