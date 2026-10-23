// The live-play suite: real matches between headless Chromium players against the Worker on workerd.
//   npm run test:live                      every scenario (about 25 minutes)
//   LIVE_ONLY=p2p_video,ws_kick npm run test:live
// The suite starts and stops its own Worker, TURN server and link shapers; nothing is left running.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 420_000,
  reporter: [['list']],
  use: { headless: true },
});
