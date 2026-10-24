// A local rehearsal of the deployed Worker for the release checks: the production Worker (packages/server, every module on one
// router) in Miniflare, i.e. workerd with the real Room and directory Durable Objects, run under the production rules (no guest bridge
// SOCIAL_ALLOW_UNSIGNED, the per-address limits on, links built from the request's own origin). It starts and stops with the command it
// runs, so nothing is left running.
//
//   node tests/release/local-stack.ts [--dist dist] -- <command...>
//       starts the stack, runs the command with BA_RELEASE_URL set to its address (and the evidence going to tests/release/out/local),
//       stops the stack, exits with the command's code, e.g.
//       node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tests/release/local-stack.ts -- npx playwright test -c tests/release/playwright.config.ts live.spec.ts --workers=1
//   node tests/release/local-stack.ts [--dist dist] --hold [--origin-file f]
//       starts the stack, prints its address (and writes it to `f`) and holds until Ctrl+C, SIGTERM or the file `f.stop` appearing
//
// What it rehearses: live.spec.ts (signed players, rooms of 2 to 4, relay and video, rematch, reload) and the social and API checks of
// urls.spec.ts (`-g "social module|API answers"`; with --dist the invite and friend-link pages come from the release build).
// What it does not: the old addresses' redirects, the headers, the service worker and the layout (those are the Cloudflare assets and
// headers of the real deployment), the TURN relay, Cloudflare's own limits. The result of a local run says nothing about the preview.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStack } from '../../packages/server/src/social/stack.ts';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const flags = sep === -1 ? argv : argv.slice(0, sep);
const command = sep === -1 ? [] : argv.slice(sep + 1);
const flag = (name: string): string | undefined => { const i = flags.indexOf(name); return i === -1 ? undefined : flags[i + 1]; };
const dist = flag('--dist');
const originFile = flag('--origin-file');
const hold = flags.includes('--hold');
if (!hold && command.length === 0) {
  console.error('usage: node tests/release/local-stack.ts [--dist dist] (--hold [--origin-file f] | -- <command...>)');
  process.exit(2);
}
if (dist && !existsSync(resolve(dist))) { console.error(`no build at ${resolve(dist)} (node release/build.ts preview)`); process.exit(2); }

const stack = await startStack({
  ...(dist ? { assetsDir: resolve(dist) } : {}),
  // the production rules; TEST_CLOCK off means the test routes (/api/__test/*) answer 404 as they do on the deployed Worker
  vars: { SOCIAL_NO_LIMITS: '0', LIVE_NO_LIMITS: '0', TEST_CLOCK: '0', PUBLIC_ORIGIN: '' },
});
console.log(`local stack: ${stack.origin}`);
if (originFile) writeFileSync(originFile, stack.origin);

let child: ReturnType<typeof spawn> | null = null;
let stopping = false;
const stop = async (code: number): Promise<never> => {
  if (stopping) return process.exit(code);
  stopping = true;
  if (child?.pid !== undefined && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
  await stack.stop().catch(() => undefined);
  return process.exit(code);
};
process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));

if (hold) {
  console.log('holding: Ctrl+C or the stop file ends it');
  setInterval(() => { if (originFile && existsSync(`${originFile}.stop`)) void stop(0); }, 500);
} else {
  const [cmd, ...args] = command as [string, ...string[]];
  // the evidence of a rehearsal goes to tests/release/out/local, apart from the evidence of the deployed build
  const evidence = fileURLToPath(new URL('./out/local', import.meta.url));
  const env = { BA_RELEASE_OUT: evidence, ...process.env, BA_RELEASE_URL: stack.origin };
  // npx and the like are .cmd files on Windows and need a shell; the shell takes ONE line, so an argument with a space or a | (a test filter) is quoted here
  const quote = (a: string): string => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  child = process.platform === 'win32'
    ? spawn([cmd, ...args].map(quote).join(' '), { stdio: 'inherit', env, shell: true, windowsHide: true })
    : spawn(cmd, args, { stdio: 'inherit', env });
  child.on('exit', (code, signal) => { void stop(code ?? (signal ? 1 : 0)); });
  child.on('error', (e) => { console.error(String(e)); void stop(1); });
}
