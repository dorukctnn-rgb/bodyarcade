// Messages between the pose service (main thread) and the pose worker.
import type { LoadProgress } from '../types/index.ts';

export type ToWorker =
  | { type: 'load'; wasmBase: string; modelUrl: string; prefer: 'GPU' | 'CPU' }
  | { type: 'warmup' }
  | { type: 'frame'; id: number; ts: number; bitmap: ImageBitmap }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'progress'; p: LoadProgress }
  | { type: 'loaded'; delegate: 'GPU' | 'CPU' }
  | { type: 'warm'; ms: number }
  /** `lm` is 132 floats or null; `ms` is the inference time inside the worker. */
  | { type: 'result'; id: number; lm: Float32Array | null; ms: number }
  | { type: 'error'; id?: number; message: string };
