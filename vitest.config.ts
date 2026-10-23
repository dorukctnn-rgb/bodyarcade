// Unit tests run in Node (no browser): packages/**/*.test.ts, tests/unit, and the legacy tests of site/.
// Browser behaviour is covered by Playwright (tests/e2e, `npm run test:e2e`).
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: [
        'packages/**/*.test.ts',
        'tests/unit/**/*.test.ts',
        'tests/legacy/**/*.test.mjs',
        'tools/**/*.test.ts',
      ],
      exclude: ['**/node_modules/**', 'tests/e2e/**', 'site/**', 'dist/**'],
      environment: 'node',
    },
  }),
);
