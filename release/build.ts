// The release build: the web app (vite + page generator) and the live site's content pages in one folder, dist/,
// which the Worker serves (wrangler.jsonc for the preview, wrangler.prod.jsonc for bodyarcade.com).
//   node release/build.ts preview              build the app, then put the release folder together for the preview
//   node release/build.ts production           the same for bodyarcade.com (indexable, no noindex header)
//   node release/build.ts preview --skip-web   reuse packages/web/dist as it is
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assemble } from './assemble.ts';
import { TARGETS, type TargetId } from './site.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) as TargetId | undefined;
if (!id || !(id in TARGETS)) {
  console.error('usage: node release/build.ts preview|production [--skip-web]');
  process.exit(2);
}
const target = TARGETS[id];

if (!args.includes('--skip-web')) {
  const r = spawnSync(process.execPath, [join(root, 'packages/web/tools/build.ts')], { cwd: root, stdio: 'inherit', env: { ...process.env, BA_FIXTURES: 'none' }, windowsHide: true });
  if (r.status !== 0) { console.error('the web app build failed'); process.exit(1); }
}

const report = assemble({ root, web: join(root, 'packages/web/dist'), out: join(root, 'dist'), target });
for (const w of report.warnings) console.warn(`note: ${w}`);
for (const p of report.problems) console.error(`problem: ${p}`);
console.log(`release ${report.build} (${report.commit}) for ${target.id}: ${report.files} files, ${(report.bytes / 1048576).toFixed(1)} MB, ${report.appPages} app pages, ${report.precache} precached by the service worker -> dist/`);
if (report.problems.length) process.exit(1);
