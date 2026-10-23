// End-to-end tests of the web shell: headless Chromium only (never a visible window), local servers started and stopped by
// Playwright. Run with `npm run web:e2e`. Two servers: the Vite dev server (the development build with the fixtures and
// the practice session, for the flows) and a static server of the built site (what a host serves, for the pages
// a crawler reads and the first paint). Ports come from the checkout path (e2e/support/ports.ts).
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { WEB_DEV_PORT, WEB_SITE_PORT } from './e2e/support/ports.ts';

// The servers start from the repository root (Playwright's default would be this folder).
const root = fileURLToPath(new URL('../..', import.meta.url));
// BA_WEB_E2E_NO_SITE=1 leaves out the built-site server (and its build) while the flows are being written; the built-site specs then cannot run.
const withSite = process.env['BA_WEB_E2E_NO_SITE'] !== '1';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    launchOptions: baseLaunchOptions,
  },
  webServer: [
    {
      command: `npx vite --config packages/web/vite.config.ts --port ${WEB_DEV_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_DEV_PORT}/`,
      reuseExistingServer: false,
      cwd: root,
      timeout: 90_000,
      env: { BA_FIXTURES: 'only' },
    },
    ...(withSite ? [{
      command: `node packages/web/tools/build.ts && node packages/web/e2e/support/static-spa.mjs packages/web/dist ${WEB_SITE_PORT}`,
      url: `http://127.0.0.1:${WEB_SITE_PORT}/robots.txt`,
      reuseExistingServer: false,
      cwd: root,
      timeout: 240_000,
      env: { BA_FIXTURES: 'only' },
    }] : []),
  ],
});
