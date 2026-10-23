// End-to-end tests: headless Chromium only (never a visible window), local servers started and stopped by
// Playwright. Several worktrees can run this at once: the ports are derived from the checkout path
// (tests/e2e/support/ports.ts; BA_E2E_PORT pins them). The camera is Chromium's fake device unless a test passes its own file.
import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEV_PORT, SITE_PORT } from './tests/e2e/support/ports.ts';

// Playwright's pinned headless shell, or (on a machine that has only an older one installed) the newest
// chromium_headless_shell-* folder in the browser cache. CI installs the pinned one.
function headlessShell(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright')
      : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
  let wanted = '';
  try {
    const core = dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
    const b = JSON.parse(readFileSync(join(core, 'browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
    wanted = b.browsers.find((x) => x.name === 'chromium-headless-shell')?.revision || '';
  } catch { /* fall through to the scan */ }
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium_headless_shell-\d+$/.test(d));
  if (wanted && dirs.includes(`chromium_headless_shell-${wanted}`)) return undefined;   // Playwright finds it itself
  const newest = dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
  if (!newest) return undefined;
  const sub = process.platform === 'win32' ? ['chrome-headless-shell-win64', 'chrome-headless-shell.exe']
    : process.platform === 'darwin' ? ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'] : ['chrome-headless-shell-linux64', 'chrome-headless-shell'];
  const exe = join(cache, newest, ...sub);
  return existsSync(exe) ? exe : undefined;
}

const executablePath = headlessShell();

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
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    },
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
