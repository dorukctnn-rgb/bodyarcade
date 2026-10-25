// The browser matrix of the web app: the same flows on Chromium (Android Chrome, desktop Chrome and Edge), WebKit (the engine under Safari
// and under every browser on an iPhone) and Firefox, each on a phone (390x844) and on a desktop (1440x900). Headless only, never a window.
// Normally started through run.ts, which builds the two sites first and prints the table (browser x flow):
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tools/browsers/run.ts [--engines webkit,firefox] [--sizes phone,desktop] [--grep text]
//
// Projects: <engine>-phone and <engine>-desktop run tools/browsers/flows.spec.ts. <engine>-ui runs the web shell's own end-to-end specs
// (packages/web/e2e) on that engine (BA_BROWSERS_SET=ui or all; they start the shell's dev server and built site as their own config does).
import { defineConfig, type LaunchOptions, type Project } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { WEB_DEV_PORT } from '../../packages/web/e2e/support/ports.ts';
import { DEMO_PORT } from './support/ports.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const set = process.env['BA_BROWSERS_SET'] ?? 'flows';          // flows | ui | all
const engines = (process.env['BA_BROWSERS'] ?? 'webkit,firefox').split(',').map((s) => s.trim()).filter(Boolean) as ('chromium' | 'firefox' | 'webkit')[];
const sizes = (process.env['BA_BROWSERS_SIZES'] ?? 'phone,desktop').split(',').map((s) => s.trim()).filter(Boolean);
const CI = !!process.env['CI'];

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID_FIREFOX_UA = 'Mozilla/5.0 (Android 15; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0';
const ANDROID_CHROME_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';

type Engine = 'chromium' | 'firefox' | 'webkit';

/** What an engine is launched with. Chromium: the headless shell and the fake device flags of the platform's e2e; Firefox: its fake camera and no prompt. */
function launch(engine: Engine): LaunchOptions {
  if (engine === 'chromium') return baseLaunchOptions;
  if (engine === 'firefox') return { headless: true, firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.peerconnection.ice.obfuscate_host_addresses': false } };
  return { headless: true };
}

function viewportUse(engine: Engine, size: string): NonNullable<Project['use']> {
  if (size === 'phone') {
    // WebKit and Chromium have phones (isMobile); Firefox only a touch screen of that size.
    const common = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 };
    if (engine === 'webkit') return { ...common, isMobile: true, userAgent: IPHONE_UA };
    if (engine === 'chromium') return { ...common, isMobile: true, userAgent: ANDROID_CHROME_UA };
    return { ...common, userAgent: ANDROID_FIREFOX_UA };
  }
  return { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
}

const projects: Project[] = [];
for (const engine of engines) {
  if (set === 'flows' || set === 'all') {
    for (const size of sizes) {
      projects.push({
        name: `${engine}-${size}`,
        testDir: '.',
        testMatch: 'flows.spec.ts',
        use: { browserName: engine, locale: 'en-US', launchOptions: launch(engine), ...viewportUse(engine, size) },
      });
    }
  }
  if (set === 'ui' || set === 'all') {
    projects.push({
      name: `${engine}-ui`,
      testDir: '../../packages/web/e2e',
      testMatch: '**/*.spec.ts',
      use: { browserName: engine, viewport: { width: 1280, height: 800 }, locale: 'en-US', launchOptions: launch(engine) },
    });
  }
}

const needsUi = set === 'ui' || set === 'all';
const needsFlows = set === 'flows' || set === 'all';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  // run.ts names the file after the set it runs (results-flows.json, results-ui.json), so one run does not overwrite the other.
  reporter: [['list'], ['json', { outputFile: process.env['BA_BROWSERS_RESULTS'] ?? fileURLToPath(new URL('../../qa-out/browsers/results.json', import.meta.url)) }]],
  outputDir: fileURLToPath(new URL('../../qa-out/browsers/test-results', import.meta.url)),
  use: { headless: true, screenshot: 'only-on-failure', trace: CI ? 'retain-on-failure' : 'off', actionTimeout: 15_000, navigationTimeout: 45_000 },
  projects,
  webServer: [
    ...(needsFlows ? [{
      command: 'node tools/browsers/support/sites.ts',
      url: `http://127.0.0.1:${DEMO_PORT}/__ready`,
      reuseExistingServer: false,
      cwd: root,
      timeout: 900_000,
    }] : []),
    // The shell's own specs open its Vite dev server (the development build with the fixtures as the catalogue).
    ...(needsUi ? [{
      command: `npx vite --config packages/web/vite.config.ts --port ${WEB_DEV_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_DEV_PORT}/`,
      reuseExistingServer: false,
      cwd: root,
      timeout: 90_000,
      env: { BA_FIXTURES: 'only' },
    }] : []),
  ],
});
