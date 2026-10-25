// Shared by the release checks: the deployed origin under test, the build it should be, and the evidence folder.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identitiesDir } from './players.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = (process.env['BA_RELEASE_URL'] ?? 'https://bodyarcade-v2-preview.railer-iot.workers.dev').replace(/\/$/, '');
export const IS_PREVIEW = !/^https:\/\/bodyarcade\.com$/.test(BASE);

export type Engine = 'chromium' | 'webkit' | 'firefox';
/**
 * The browser engine of this run (BUILD-PLAN: the final test runs Chromium, WebKit and Firefox at phone and desktop sizes).
 * BA_RELEASE_ENGINE=chromium (default) runs every check; webkit and firefox run the checks a page's engine can change (layout at the
 * ten sizes, the keyboard round of every game, axe on a phone and a laptop, the scope items, the service worker); the HTTP checks
 * (urls), the CSP round and the live races are Chromium's (the first two do not depend on the engine, the races have their own engine
 * spec: tests/live/engines.spec.ts). The camera flows of the other engines are tools/browsers (QA).
 */
export const ENGINE: Engine = (() => {
  const e = (process.env['BA_RELEASE_ENGINE'] ?? 'chromium').trim().toLowerCase();
  if (e !== 'chromium' && e !== 'webkit' && e !== 'firefox') throw new Error(`BA_RELEASE_ENGINE must be chromium, webkit or firefox, not "${e}"`);
  return e;
})();

/**
 * The evidence folder: tests/release/out for Chromium, tests/release/out/<engine> for the others (so one engine's evidence never
 * overwrites another's). BA_RELEASE_OUT moves it (a rehearsal against a local stack keeps its evidence apart from the deployed build's).
 */
export const OUT = process.env['BA_RELEASE_OUT'] ? resolve(process.env['BA_RELEASE_OUT'])
  : join(ROOT, 'tests', 'release', 'out', ...(ENGINE === 'chromium' ? [] : [ENGINE]));
mkdirSync(OUT, { recursive: true });

/**
 * How the players of the live checks identify themselves (tests/release/players.ts).
 *   auto    signed players when the deployed build has the social module (and always on bodyarcade.com, which takes no guests),
 *           guests on an older build that does not
 *   signed  always signed; guest  never signed (only a build that still has the preview bridge SOCIAL_ALLOW_UNSIGNED accepts them)
 */
export const SIGNING = process.env['BA_RELEASE_SIGNING'] ?? 'auto';

/** The Worker under test runs on this machine (tests/release/local-stack.ts), not on Cloudflare. */
export const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);

/**
 * Chromium flags for the browsers that play the live races. The races' page is served by request interception (a response Chromium
 * does not see as coming from this machine), and Chromium 138+ blocks such a page's WebSocket to a Worker on loopback
 * (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS): only a local stack needs the check off. A deployed https origin never does.
 */
export const LOCAL_ARGS: string[] = IS_LOCAL ? ['--disable-features=LocalNetworkAccessChecks'] : [];

/** Where the saved device keys of the signed players live (private keys of test profiles: under out/, never committed). Null for a local stack: its profiles die with it. */
export const IDENTITIES: string | null = identitiesDir(BASE, OUT);

/** The test profiles stay on the server after a run (so the next run signs in with them and uses no sign-up of the address' hourly allowance), except on bodyarcade.com, where they are deleted again. */
export const KEEP_PROFILES = IS_PREVIEW || process.env['BA_RELEASE_KEEP_PROFILES'] === '1';

/** The build stamp of the local dist/ (what was deployed), or null when there is no local build. */
export function localBuild(): { build: string; commit: string; target: string } | null {
  const f = join(ROOT, 'dist', 'version.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { build: string; commit: string; target: string }) : null;
}

/** Every app page of the build (from the local dist sitemap): the indexable ones; plus the player pages that are noindex. */
export function sitemapUrls(): string[] {
  const f = join(ROOT, 'dist', 'sitemap.xml');
  return [...readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1] as string).pathname);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
