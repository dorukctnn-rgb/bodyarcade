// MediaPipe Pose Landmarker creation and result handling, shared by the worker and the main-thread backend.
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { LANDMARK_COUNT, type Landmark, type LoadProgress } from '../types/index.ts';
import { blockPoseTelemetry } from './no-telemetry.ts';

export interface CreateLandmarkerOptions {
  wasmBase: string;
  modelUrl: string;
  prefer: 'GPU' | 'CPU';
  /** ES-module WASM loader: required in module workers (no importScripts). */
  useModule: boolean;
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
}

/** Fetches a file, reporting progress when the server sends a length. */
export async function fetchWithProgress(url: string, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); onProgress?.(b.length, b.length); return b; }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total || loaded);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * The WASM module prints TFLite and MediaPipe INFO lines on stderr, which lands in console.error and would trip the
 * "no console errors" gate. tasks-vision reads `self.Module` as the Emscripten config when it creates a task, so the
 * log routing is set right before each creation: INFO lines go to console.debug, warnings to console.warn, and
 * everything else stays an error.
 */
function routeWasmLogs(): void {
  const route = (text: string): void => {
    if (/^INFO[: ]/.test(text) || /^I\d{4} /.test(text)) console.debug(text);
    else if (/^WARNING[: ]/.test(text) || /^W\d{4} /.test(text)) console.warn(text);
    else console.error(text);
  };
  (globalThis as { Module?: unknown }).Module = { print: (t: string) => console.debug(t), printErr: route };
}

const abortIf = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Pose loading was cancelled.'), { name: 'AbortError' }));
};

/** Loads the WASM fileset and the model, then creates the landmarker on the preferred delegate, falling back to CPU. */
export async function createLandmarker(o: CreateLandmarkerOptions): Promise<{ landmarker: PoseLandmarker; delegate: 'GPU' | 'CPU' }> {
  blockPoseTelemetry();
  const vision = await import('@mediapipe/tasks-vision');
  abortIf(o.signal);
  o.onProgress?.({ phase: 'wasm', loaded: 0, total: 1 });
  const fileset = await vision.FilesetResolver.forVisionTasks(o.wasmBase, o.useModule);
  o.onProgress?.({ phase: 'wasm', loaded: 1, total: 1 });
  abortIf(o.signal);
  const model = await fetchWithProgress(o.modelUrl, (loaded, total) => o.onProgress?.({ phase: 'model', loaded, total }), o.signal);
  abortIf(o.signal);
  const make = (delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> => (routeWasmLogs(), vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: model.slice(), delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  }));
  if (o.prefer === 'GPU') {
    try { return { landmarker: await make('GPU'), delegate: 'GPU' }; } catch { /* no WebGL2 here: use the CPU */ }
  }
  return { landmarker: await make('CPU'), delegate: 'CPU' };
}

type RawLandmark = { x: number; y: number; z: number; visibility?: number };

/** The first pose of a result as contract landmarks, or null. */
export function firstPose(result: { landmarks?: RawLandmark[][] } | null | undefined): Landmark[] | null {
  const lm = result?.landmarks?.[0];
  if (!lm || lm.length < LANDMARK_COUNT) return null;
  return lm.slice(0, LANDMARK_COUNT).map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }));
}

/** 33 landmarks as 132 floats (x, y, z, visibility), for transfer between threads. */
export function packLandmarks(lm: Landmark[]): Float32Array {
  const out = new Float32Array(LANDMARK_COUNT * 4);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = lm[i];
    if (!p) continue;
    out[i * 4] = p.x; out[i * 4 + 1] = p.y; out[i * 4 + 2] = p.z; out[i * 4 + 3] = p.visibility;
  }
  return out;
}

export function unpackLandmarks(f: Float32Array): Landmark[] {
  const out: Landmark[] = new Array<Landmark>(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) out[i] = { x: f[i * 4] ?? 0, y: f[i * 4 + 1] ?? 0, z: f[i * 4 + 2] ?? 0, visibility: f[i * 4 + 3] ?? 0 };
  return out;
}
