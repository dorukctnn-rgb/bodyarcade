// The release checks: run against a DEPLOYED build (the preview by default), never a local server.
//   npm run test:release                                     the preview, https://bodyarcade-v2-preview.railer-iot.workers.dev
//   BA_RELEASE_URL=https://bodyarcade.com npm run test:release   production after the switch (read-only checks; the live
//                                                            races make rooms as signed test profiles, which are deleted
//                                                            again at the end; BA_RELEASE_KEEP_PROFILES=1 keeps them)
// The players of the live races and of the room that urls.spec makes SIGN their room calls with a social profile (players.ts):
// that is how production takes players. BA_RELEASE_SIGNING=auto (default) | signed | guest; auto plays guests only on a
// deployed build from before the social module. Their keys are kept in tests/release/out/identities/<host>/ (never committed).
//   node tests/release/local-stack.ts -- <command>          the production Worker in Miniflare, to rehearse the live races locally
// Engines (BUILD-PLAN: Chromium, WebKit and Firefox at phone and desktop sizes): BA_RELEASE_ENGINE=chromium (default, every check) |
// webkit | firefox (the checks a page's engine can change: layout at the ten sizes, games, axe, scope, service worker; support.ts ENGINE).
//   BA_RELEASE_ENGINE=webkit npm run test:release    evidence in tests/release/out/webkit/
// Headless only. Evidence (screenshots, logs) goes to tests/release/out/ (not committed).
import { defineConfig, type LaunchOptions } from '@playwright/test';
import { baseLaunchOptions } from '../e2e/support/browser.ts';
import { ENGINE } from './support.ts';

/** Checks that do not depend on the page's engine (HTTP answers, the CSP round on Chromium's fake camera) or have their own engine spec (the live races). */
const CHROMIUM_ONLY = ['urls.spec.ts', 'csp.spec.ts', 'live.spec.ts'];

const launchOptions: LaunchOptions = ENGINE === 'chromium' ? baseLaunchOptions : { headless: true };

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: ENGINE === 'chromium' ? [] : CHROMIUM_ONLY.map((f) => `**/${f}`),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: ENGINE === 'chromium' ? 'out/test-results' : `out/${ENGINE}/test-results`,
  // English, whatever the machine's language: the app moves an English address to the visitor's language (a Turkish Windows gets the
  // Turkish pages and "$39,99"), and the checks read English words and prices. The Turkish pages have their own addresses (/tr/...).
  use: { browserName: ENGINE, headless: true, launchOptions, ignoreHTTPSErrors: false, locale: 'en-US' },
});
