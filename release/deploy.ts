// Builds and deploys one target with its secrets in the same version (no moment without them).
//   node release/deploy.ts preview                          build + deploy https://bodyarcade-v2-preview.railer-iot.workers.dev
//   node release/deploy.ts production --confirm-production  build + deploy bodyarcade.com (the main session, after the final test)
//   add --skip-build to deploy dist/ as it is (it must have been built for the same target), --dry-run to stop before uploading
// Production first runs its gates (release/gates.ts): the Gumroad catalog must hold no placeholder
// (node tools/entitlements/check-catalog.mjs --release), and a failed gate stops everything before anything is built or uploaded.
// --dry-run runs the gates too. They are not part of the CI build: they fail until the Gumroad products exist.
// Settings that only the preview may carry (SOCIAL_ALLOW_UNSIGNED) stop a production deploy while the preview still has them,
// and stop a preview deploy once the shell signs its room calls (release/gates.ts, PREVIEW_ONLY).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, type TargetId } from './site.ts';
import { SECRETS, isRequired, readSecrets, secretsFile } from './secrets.ts';
import { bridgeProblems, gatesFor, readShellSources, runGates, secretProblems, shellSignsRoomCalls } from './gates.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) as TargetId | undefined;
if (!id || !(id in TARGETS)) {
  console.error('usage: node release/deploy.ts preview|production [--confirm-production] [--skip-build] [--dry-run]');
  process.exit(2);
}
const target = TARGETS[id];
if (id === 'production' && !args.includes('--confirm-production')) {
  console.error('production replaces the live site on bodyarcade.com: add --confirm-production (main session only, after the final test)');
  process.exit(2);
}

const run = (cmd: string, cmdArgs: string[], env: NodeJS.ProcessEnv = process.env): void => {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env, windowsHide: true });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${cmdArgs.join(' ')}`); process.exit(1); }
};

// 0. The gates of this target (production: the Gumroad catalog is real). Before the secrets, the build and the upload.
const failedGate = runGates(gatesFor(id, root), root);
if (failedGate) { console.error(`stopped by the ${failedGate.name} gate: ${failedGate.why}`); process.exit(1); }

// 1. Secrets: every required one present (names only are printed; PLAY_SA_JSON is required for production: see release/secrets.ts).
const secrets = readSecrets(id);
const missing = SECRETS.filter((s) => isRequired(s, id) && !secrets[s.name]);
if (missing.length) {
  const lines = missing.map((s) => `  ${s.name}: ${s.why}`);
  console.error(`missing secrets in ${secretsFile(id)}:\n${lines.join('\n')}\n(node release/secrets.ts init ${id} makes the ones that can be generated; the others come from a person or a dashboard)`);
  process.exit(1);
}
const together = secretProblems(secrets);
if (together.length) { console.error(`${secretsFile(id)}: ${together.join('; ')}`); process.exit(1); }
const optional = SECRETS.filter((s) => !isRequired(s, id) && !secrets[s.name]).map((s) => s.name);
if (optional.length) console.warn(`not set (features off): ${optional.join(', ')}`);

// 2. The config must not carry placeholders.
const config = readFileSync(join(root, target.config), 'utf8');
if (/SET_AT_DEPLOY|TODO|<[A-Z_]+>/.test(config)) { console.error(`${target.config} still has a placeholder`); process.exit(1); }

// 2b. Preview-only settings (PREVIEW_ONLY in release/gates.ts, today SOCIAL_ALLOW_UNSIGNED): production never has one and waits until the
// preview has dropped them too (the final test runs there, on the rules production has); the preview drops them once the shell signs its room calls.
const configText = (file: string): string => readFileSync(join(root, file), 'utf8');
const bridges = bridgeProblems(id, { preview: configText(TARGETS.preview.config), production: configText(TARGETS.production.config), server: configText('packages/server/wrangler.jsonc') }, shellSignsRoomCalls(readShellSources(root)));
if (bridges.length) { console.error(`${bridges.join('\n')}\nstopped: a setting that only the preview may carry (release/gates.ts)`); process.exit(1); }

// 3. Build for this target (or check that dist/ was built for it).
if (!args.includes('--skip-build')) run(process.execPath, [join(root, 'release/build.ts'), id]);
const stamp = join(root, 'dist', 'version.json');
if (!existsSync(stamp)) { console.error('dist/ has no version.json: build first'); process.exit(1); }
const built = JSON.parse(readFileSync(stamp, 'utf8')) as { build: string; commit: string; target: string };
if (built.target !== id) { console.error(`dist/ was built for ${built.target}, not ${id}`); process.exit(1); }

// 4. Deploy: code, assets and secrets in one version.
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const deployArgs = [wrangler, 'deploy', '-c', target.config, '--secrets-file', secretsFile(id), '--message', `release ${built.build} (${built.commit})`];
if (args.includes('--dry-run')) deployArgs.push('--dry-run');
run(process.execPath, deployArgs, { ...process.env, WRANGLER_SEND_METRICS: 'false' });
console.log(`${args.includes('--dry-run') ? 'dry run, nothing uploaded: would deploy' : 'deployed'} release ${built.build} (${built.commit}) to ${target.origin}`);
