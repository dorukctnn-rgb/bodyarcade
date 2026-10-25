// The two sites the cross-browser run opens, built from this checkout and served on local ports (nothing is deployed):
//   demo     the web shell's production bundle built with the practice catalogue (BA_FIXTURES=fill): the test hooks, the practice
//            session and `?social=1` exist in it, every game that has code runs for real. -> qa-out/browsers/site-demo
//   release  what bodyarcade.com serves: the release build (node release/build.ts preview) with the content pages (privacy, terms, FAQ,
//            EN and TR), the web app manifest and the service worker. -> dist/
// The builds are kept between runs and made again when the sources changed (a stamp of HEAD and of what is not committed).
//   node tools/browsers/support/sites.ts            build when needed, serve both, hold until stopped
//   node tools/browsers/support/sites.ts --build    only build (what CI does before the browsers start)
//   node tools/browsers/support/sites.ts --rebuild  build again even when the stamp says nothing changed
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PORT, RELEASE_PORT } from './ports.ts';
import { startSite } from './serve.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const OUT = join(ROOT, 'qa-out', 'browsers');
export const DEMO_DIR = join(OUT, 'site-demo');
export const RELEASE_DIR = join(ROOT, 'dist');
const STAMP = join(OUT, 'sites.stamp');

const git = (...args: string[]): string => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return ''; } };

/** HEAD plus the uncommitted changes of the folders the builds read: equal stamps mean the builds are still the sources' builds. */
export function sourceStamp(): string {
  const h = createHash('sha256');
  h.update(git('rev-parse', 'HEAD'));
  h.update(git('diff', 'HEAD', '--', 'packages', 'release', 'design', 'package.json', 'vite.config.ts', 'site'));
  for (const f of git('ls-files', '--others', '--exclude-standard', '--', 'packages', 'release', 'design').split('\n').filter(Boolean)) {
    try { h.update(f); h.update(readFileSync(join(ROOT, f))); } catch { /* gone */ }
  }
  return h.digest('hex');
}

function run(label: string, args: string[], env: Record<string, string> = {}): void {
  const t0 = Date.now();
  console.log(`[sites] ${label} ...`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true });
  if (r.status !== 0) { console.error(`[sites] ${label} failed (exit ${r.status})`); process.exit(1); }
  console.log(`[sites] ${label} done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

export function build(force = false): void {
  mkdirSync(OUT, { recursive: true });
  const now = sourceStamp();
  const kept = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : '';
  if (!force && kept === now && existsSync(join(DEMO_DIR, 'index.html')) && existsSync(join(RELEASE_DIR, 'sw.js'))) {
    console.log('[sites] the builds are current (the sources did not change)');
    return;
  }
  // The practice build first (packages/web/dist), kept apart; the release build then rebuilds packages/web/dist with the real catalogue.
  run('web shell, practice build', ['packages/web/tools/build.ts'], { BA_FIXTURES: 'fill' });
  rmSync(DEMO_DIR, { recursive: true, force: true });
  cpSync(join(ROOT, 'packages', 'web', 'dist'), DEMO_DIR, { recursive: true });
  run('release build', ['release/build.ts', 'preview']);
  writeFileSync(STAMP, now);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  build(args.includes('--rebuild'));
  if (!args.includes('--build')) {
    const servers = [await startSite(DEMO_DIR, DEMO_PORT, 'spa'), await startSite(RELEASE_DIR, RELEASE_PORT, '404')];
    console.log(`[sites] demo http://127.0.0.1:${DEMO_PORT}  release http://127.0.0.1:${RELEASE_PORT}  (ready)`);
    const stop = (): void => { for (const s of servers) { s.closeAllConnections(); s.close(); } process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
