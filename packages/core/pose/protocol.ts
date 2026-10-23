// Messages between the pose service (main thread) and the pose worker.
import type { LoadProgress } from '../types/index.ts';

export type ToWorker =
  | { type: 'load'; wasmBase: string; modelUrl: string; prefer: 'GPU' | 'CPU'; numPoses: 1 | 2 }
  | { type: 'numPoses'; n: 1 | 2 }
  | { type: 'warmup' }
  | { type: 'frame'; id: number; ts: number; bitmap: ImageBitmap }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'progress'; p: LoadProgress }
  | { type: 'loaded'; delegate: 'GPU' | 'CPU' }
  | { type: 'warm'; ms: number }
  | { type: 'numPosesSet'; n: 1 | 2 }
  /** `poses` holds 132 floats per person found (0, 1 or 2 people); `ms` is the inference time inside the worker. */
  | { type: 'result'; id: number; poses: Float32Array; ms: number }
  | { type: 'error'; id?: number; message: string };
