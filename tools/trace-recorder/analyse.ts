// Frame-by-frame analysis of a video file into a trace: seek to every 1/fps second, run the landmarker, collect.
// Unlike a live recording this does not depend on the machine's speed, so the trace has exact frame times.
import { POSE_MODEL, WASM_BASE } from '../../packages/core/pose/assets.ts';
import { MainBackend, WorkerBackend, type PoseBackend } from '../../packages/core/pose/service.ts';
import { serializeTrace } from '../../packages/core/pose/trace.ts';
import type { Framing, Trace, TraceFile, TraceFrame, TraceLabel, TraceMeta } from '../../packages/core/types/index.ts';

export interface AnalyseOptions {
  id: string;
  framing?: Framing;
  fps?: number;
  /** Seconds into the video. */
  from?: number;
  to?: number;
  prefer?: 'GPU' | 'CPU';
  worker?: boolean;
  notes?: string;
  consent?: TraceMeta['consent'];
  labels?: TraceLabel[];
  /** Look for two people; the trace then keeps everyone found in `people`. */
  numPoses?: 1 | 2;
  onProgress?: (done: number, total: number) => void;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); resolve(); };
    const fail = (): void => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); reject(new Error('The video could not be read.')); };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = t;
  });
}

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error(`Cannot open ${url}`)), { once: true });
  });
  return video;
}

export async function analyseVideo(url: string, o: AnalyseOptions): Promise<{ trace: Trace; file: TraceFile; ms: number }> {
  const t0 = performance.now();
  const video = await loadVideo(url);
  const fps = o.fps ?? 30;
  const from = Math.max(0, o.from ?? 0);
  const to = Math.min(video.duration, o.to ?? video.duration);
  const backend: PoseBackend = o.worker === false ? new MainBackend() : new WorkerBackend(() => new Worker(new URL('../../packages/core/pose/pose.worker.ts', import.meta.url), { type: 'module' }));
  try {
    await backend.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: o.prefer ?? 'CPU', numPoses: o.numPoses ?? 1 });
    const frames: TraceFrame[] = [];
    const n = Math.floor((to - from) * fps) + 1;
    for (let i = 0; i < n; i++) {
      const tSec = from + i / fps;
      if (tSec > to) break;
      await seek(video, tSec);
      const r = await backend.detect(video, Math.round(i * 1000 / fps) + 1);
      const frame: TraceFrame = { t: Math.round((i * 1000 / fps) * 10) / 10, lm: r.poses[0] ?? null, inferenceMs: Math.round(r.inferenceMs * 100) / 100 };
      if ((o.numPoses ?? 1) === 2) frame.people = r.poses;
      frames.push(frame);
      o.onProgress?.(i + 1, n);
    }
    const meta: TraceMeta = { id: o.id, origin: 'video', framing: o.framing ?? 'full', model: `${POSE_MODEL.file}, tasks-vision, ${o.worker === false ? 'main thread' : 'worker'}` , recordedAt: new Date().toISOString() };
    if (o.notes) meta.notes = o.notes;
    if (o.consent) meta.consent = o.consent;
    const trace: Trace = { fps, aspect: video.videoWidth / video.videoHeight, meta, labels: o.labels ?? [], frames };
    return { trace, file: serializeTrace(trace), ms: performance.now() - t0 };
  } finally {
    backend.dispose();
    video.removeAttribute('src');
    video.load();
  }
}
