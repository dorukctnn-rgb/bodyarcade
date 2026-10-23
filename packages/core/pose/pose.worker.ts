// Module worker: MediaPipe Pose Landmarker off the main thread (tech.md 3.2: detect() blocks the thread it runs on).
// The main thread sends one ImageBitmap per camera frame (transferred) and gets 132 floats back.
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { allPoses, createLandmarker, packPoses } from './landmarker.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const scope = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  close(): void;
};

let landmarker: PoseLandmarker | null = null;
let lastTs = 0;

function detect(source: TexImageSource, ts: number): { poses: Float32Array; ms: number } {
  if (!landmarker) throw new Error('The pose model is not loaded.');
  const t = Math.max(ts, lastTs + 1);   // MediaPipe VIDEO mode needs increasing timestamps
  lastTs = t;
  const a = performance.now();
  const poses = allPoses(landmarker.detectForVideo(source, t));
  return { poses: packPoses(poses), ms: performance.now() - a };
}

scope.onmessage = (e: MessageEvent<ToWorker>): void => {
  const m = e.data;
  if (m.type === 'load') {
    createLandmarker({ wasmBase: m.wasmBase, modelUrl: m.modelUrl, prefer: m.prefer, numPoses: m.numPoses, useModule: true, onProgress: (p) => scope.postMessage({ type: 'progress', p }) })
      .then((r) => { landmarker = r.landmarker; scope.postMessage({ type: 'loaded', delegate: r.delegate }); })
      .catch((err: unknown) => scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  } else if (m.type === 'numPoses') {
    if (!landmarker) { scope.postMessage({ type: 'error', message: 'The pose model is not loaded.' }); return; }
    landmarker.setOptions({ numPoses: m.n })
      .then(() => scope.postMessage({ type: 'numPosesSet', n: m.n }))
      .catch((err: unknown) => scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  } else if (m.type === 'warmup') {
    try {
      const c = new OffscreenCanvas(64, 64);
      const ctx = c.getContext('2d');
      if (ctx) { ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 64, 64); }
      const a = performance.now();
      detect(c, performance.now());
      scope.postMessage({ type: 'warm', ms: performance.now() - a });
    } catch (err) {
      scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  } else if (m.type === 'frame') {
    try {
      const r = detect(m.bitmap, m.ts);
      scope.postMessage({ type: 'result', id: m.id, poses: r.poses, ms: r.ms }, [r.poses.buffer]);
    } catch (err) {
      scope.postMessage({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      m.bitmap.close();
    }
  } else if (m.type === 'dispose') {
    try { landmarker?.close(); } catch { /* already closed */ }
    landmarker = null;
    scope.close();
  }
};
