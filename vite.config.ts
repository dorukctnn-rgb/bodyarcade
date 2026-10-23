// Vite config for the v2 tree. The live site (site/) is static and is not served or built by Vite.
// Dev pages (trace recorder, camera and pose harness pages) live under tools/ and packages/*/dev/.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  publicDir: false,
  resolve: {
    alias: {
      '@core': here('./packages/core'),
      '@games': here('./packages/games'),
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, open: false },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
