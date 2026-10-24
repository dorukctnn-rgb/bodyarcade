// The release checks: run against a DEPLOYED build (the preview by default), never a local server.
//   npm run test:release                                     the preview, https://bodyarcade-v2-preview.railer-iot.workers.dev
//   BA_RELEASE_URL=https://bodyarcade.com npm run test:release   production after the switch (read-only checks; the live
//                                                            race makes rooms, which is harmless)
// Headless Chromium only. Evidence (screenshots, logs) goes to tests/release/out/ (not committed).
import { defineConfig } from '@playwright/test';
import { baseLaunchOptions } from '../e2e/support/browser.ts';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: 'out/test-results',
  use: { headless: true, launchOptions: baseLaunchOptions, ignoreHTTPSErrors: false },
});
