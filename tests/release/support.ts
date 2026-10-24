// Shared by the release checks: the deployed origin under test, the build it should be, and the evidence folder.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = (process.env['BA_RELEASE_URL'] ?? 'https://bodyarcade-v2-preview.railer-iot.workers.dev').replace(/\/$/, '');
export const IS_PREVIEW = !/^https:\/\/bodyarcade\.com$/.test(BASE);
export const OUT = join(ROOT, 'tests', 'release', 'out');
mkdirSync(OUT, { recursive: true });

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
