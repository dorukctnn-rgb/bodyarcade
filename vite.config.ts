// Vite config for the v2 tree. The live site (site/) is static and is not served or built by Vite.
// Dev pages (trace recorder, camera and pose harness pages) live under tools/ and tests/e2e/pages/.
// The pose plugin serves the pinned MediaPipe WASM and model at /vendor/mediapipe/ (see packages/core/pose/assets.ts).
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { poseAssets } from './packages/core/pose/vite-plugin.ts';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  publicDir: false,
  plugins: [poseAssets()],
  resolve: {
    alias: {
      '@core': here('./packages/core'),
      '@games': here('./packages/games'),
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, open: false },
  worker: { format: 'es' },
  // tasks-vision is already one ES module; pre-bundling it only causes a page reload on first use in dev.
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
