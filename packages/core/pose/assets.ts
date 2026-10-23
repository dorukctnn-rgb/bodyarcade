// Self-hosted, pinned pose assets (P5, tech.md 3.2): no CDN on the critical path, no third party in the privacy
// policy. The WASM files come from the pinned @mediapipe/tasks-vision package; the model file is committed in
// packages/core/pose/assets/. The Vite plugin (vite-plugin.ts) serves both in dev and copies them into builds.

/** Must equal the exact version pinned in package.json (a unit test checks this). */
export const MEDIAPIPE_VERSION = '1.1.1';

/** URL folder of the WASM loader and binaries (vision_wasm_internal.*, vision_wasm_module_internal.*, nosimd). */
export const WASM_BASE = `/vendor/mediapipe/${MEDIAPIPE_VERSION}/wasm`;

export const POSE_MODEL = {
  /** File name in packages/core/pose/assets/ and in the URL. */
  file: 'pose_landmarker_lite.f16.v1.task',
  url: '/vendor/mediapipe/models/pose_landmarker_lite.f16.v1.task',
  bytes: 5_777_746,
  sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  /** Where it came from (same bytes as .../float16/latest/ on 23 Oct 2026). Apache-2.0, see the MediaPipe model card. */
  source: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
} as const;

export const WASM_FILES = [
  'vision_wasm_internal.js', 'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm',
] as const;
