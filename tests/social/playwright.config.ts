// The social suite: players in separate headless Chromium contexts (each with its own IndexedDB, as separate devices have)
// against the production Worker run in Miniflare, with the real directory Durable Object (SQLite tables, hibernating sockets). The suite starts and stops
// its own Worker; nothing is left running.
//   npm run test:social
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
  use: { headless: true, launchOptions: baseLaunchOptions },
});
