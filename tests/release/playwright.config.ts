// The release checks: run against a DEPLOYED build (the preview by default), never a local server.
//   npm run test:release                                     the preview, https://bodyarcade-v2-preview.railer-iot.workers.dev
//   BA_RELEASE_URL=https://bodyarcade.com npm run test:release   production after the switch (read-only checks; the live
//                                                            races make rooms as signed test profiles, which are deleted
//                                                            again at the end; BA_RELEASE_KEEP_PROFILES=1 keeps them)
// The players of the live races and of the room that urls.spec makes SIGN their room calls with a social profile (players.ts):
// that is how production takes players. BA_RELEASE_SIGNING=auto (default) | signed | guest; auto plays guests only on a
// deployed build from before the social module. Their keys are kept in tests/release/out/identities/<host>/ (never committed).
//   node tests/release/local-stack.ts -- <command>          the production Worker in Miniflare, to rehearse the live races locally
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
