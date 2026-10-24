// End-to-end tests of the shell with the REAL catalogue (every packages/games/<id>/manifest.json) and the real game code:
// each game is opened, played with the keyboard on the platform's own session, paused, finished, left. Headless Chromium
// only. Run with `npx playwright test -c packages/web/playwright.real.config.ts`; BA_GAMES=star-catch,pad-work picks games.
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { WEB_REAL_PORT } from './e2e/support/ports.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: 'e2e-real',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    launchOptions: baseLaunchOptions,
  },
  webServer: [{
    command: `npx vite --config packages/web/vite.config.ts --port ${WEB_REAL_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${WEB_REAL_PORT}/`,
    reuseExistingServer: false,
    cwd: root,
    timeout: 90_000,
    env: { BA_FIXTURES: 'none' },
  }],
});
