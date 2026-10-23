// End-to-end tests: headless Chromium only (never a visible window), local servers started and stopped by
// Playwright. Several worktrees can run this at once: the ports are derived from the checkout path
// (tests/e2e/support/ports.ts; BA_E2E_PORT pins them). Launch options: tests/e2e/support/browser.ts.
import { defineConfig } from '@playwright/test';
import { baseLaunchOptions } from './tests/e2e/support/browser.ts';
import { DEV_PORT, SITE_PORT } from './tests/e2e/support/ports.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    permissions: ['camera'],
    launchOptions: baseLaunchOptions,
  },
  webServer: [
    {
      command: `node tests/e2e/support/static-server.mjs site ${SITE_PORT}`,
      url: `http://127.0.0.1:${SITE_PORT}/robots.txt`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx vite --port ${DEV_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${DEV_PORT}/tests/e2e/pages/ping.html`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  metadata: { sitePort: SITE_PORT, devPort: DEV_PORT },
});
