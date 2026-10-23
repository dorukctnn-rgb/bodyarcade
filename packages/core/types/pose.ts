// core/pose: MediaPipe Pose Landmarker behind one service, in a module worker when possible.
import type { FrameSource } from './camera.ts';
import type { Ms, Unsubscribe } from './common.ts';

/**
 * One MediaPipe landmark, image-normalised in the RAW camera image (not mirrored): x is a fraction of the image
 * width, y a fraction of the height (y grows downwards), z is relative depth, visibility is 0..1.
 * "left" landmarks (11, 13, 15, ...) are the person's own left side.
 */
export interface Landmark { x: number; y: number; z: number; visibility: number }

export const LANDMARK_COUNT = 33;

/** MediaPipe BlazePose landmark indices. */
export const LM = {
  nose: 0,
  leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3, rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20, leftThumb: 21, rightThumb: 22,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
} as const;

/** Bones for skeleton drawing (pairs of landmark indices). */
export const POSE_CONNECTIONS: readonly (readonly [number, number])[] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export type PoseFrameSource = 'camera' | 'trace' | 'test';

export interface PoseFrame {
  /** Per source frame; keeps counting when an inference is dropped, so gaps are visible. */
  seq: number;
  t: Ms;
  /** 33 landmarks in MediaPipe order, or null when no person was found. */
  landmarks: Landmark[] | null;
  inferenceMs: number;
  /** Ranked and live modes accept 'camera' only (B20). */
  source: PoseFrameSource;
  /** Width / height of the analysed image. Needed for distances that mix x and y. */
  aspect: number;
}

export interface LoadProgress { phase: 'wasm' | 'model' | 'warmup'; loaded: number; total: number }

export interface PoseLoadOptions {
  /** Self-hosted and pinned (P5): no CDN on the critical path. */
  modelUrl: string;
  wasmBase: string;
  prefer?: 'GPU' | 'CPU';
  /** 'auto' (default): module worker when the browser supports it, else the main thread. */
  worker?: 'auto' | 'never' | 'only';
  /** Inference rate cap; tech.md 3.2 drops pose to 20 Hz under load before render quality. */
  maxHz?: number;
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
}

export interface PoseLoadResult { delegate: 'GPU' | 'CPU'; worker: boolean; loadMs: number }

export interface PoseStats {
  /** Delivered frames per second over the last second. */
  hz: number;
  /** Inference time percentiles over the last 120 frames, ms. */
  p50: number;
  p95: number;
  /** Source frames skipped because an inference was still running or the rate cap applied. */
  dropped: number;
  frames: number;
}

export interface PoseService {
  load(o: PoseLoadOptions): Promise<PoseLoadResult>;
  /** One dummy inference; the first GPU inference took 3.1 s cold (tech.md 3.1). Run it behind a progress bar. */
  warmUp(): Promise<void>;
  /** One source at a time; attaching a new one detaches the old one. */
  attach(src: FrameSource): void;
  detach(): void;
  onFrame(cb: (f: PoseFrame) => void): Unsubscribe;
  setMaxHz(hz: number): void;
  readonly stats: PoseStats;
  /** Terminates the worker and closes the landmarker. The service cannot be used afterwards. */
  dispose(): void;
}
