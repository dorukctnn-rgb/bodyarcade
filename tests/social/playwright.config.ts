// The social suite: players in separate headless Chromium contexts (each with its own IndexedDB, as separate devices have)
// against the production Worker run in Miniflare, with the real directory Durable Object (SQLite tables, hibernating sockets). The suite starts and stops
// its own Worker; nothing is left running. It holds two kinds of specs: tests/social/*.spec.ts drive the client in a harness page, and
// tests/e2e/social-ui*.spec.ts drive the real web shell (the Friends screens) the way a person does, on a phone and on a laptop.
//   npm run test:social
import { defineConfig } from '@playwright/test';
import { baseLaunchOptions } from '../e2e/support/browser.ts';

export default defineConfig({
  testDir: '..',
  testMatch: ['social/**/*.spec.ts', 'e2e/social-ui*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: { headless: true, launchOptions: baseLaunchOptions },
});
