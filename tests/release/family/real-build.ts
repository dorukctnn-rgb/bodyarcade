// The family switch rehearsal on the REAL build (what launch day deploys), beside the shell rehearsal of playwright.config.ts here.
// Builds the web shell from the real catalogue with the switch on and assembles the production release into tests/release/out/family/dist
// (never dist/: that is the build the deployed preview is checked against). Refuses to run while FAMILY_ON is off.
//
// The whole family rehearsal of the final test, in order (PowerShell, from the repository root):
//   1. packages/web/src/app/boot.ts: `export const FAMILY_ON = false;` -> `true` (locally, never committed)
//   2. $env:BA_RELEASE='1'; npx vitest run --maxWorkers=2 packages/web/content/content.test.ts packages/core/entitlements/catalog.test.ts; Remove-Item Env:BA_RELEASE
//        green: every test passes (with the switch off, the one red line is "the Family plan is on the paywall")
//   3. $env:BA_WEB_E2E_NO_SITE='1'; node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/release/family/playwright.config.ts --workers=1; Remove-Item Env:BA_WEB_E2E_NO_SITE
//        green: every test passes (the shell's players specs and the 20 rehearsal tests at the ten sizes)
//   4. node tests/release/family/real-build.ts
//        green: "release <build> (<commit>) for production with FAMILY_ON ... -> tests/release/out/family/dist"
//   5. node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tests/release/local-stack.ts --dist tests/release/out/family/dist -- node tests/release/family/real.ts
//        green: "family on the real build: clean at the ten sizes" (the Family card, its Gumroad checkout, the players screen)
//   6. $env:BA_RELEASE_OUT='tests/release/out/family/release'; node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tests/release/local-stack.ts --dist tests/release/out/family/dist -- npx playwright test -c tests/release/playwright.config.ts scope.spec.ts layout.spec.ts --workers=1; Remove-Item Env:BA_RELEASE_OUT
//        green: every test passes; out/family/release/scope-paywall.json lists four plans, family-yearly among them, each with its checkout
//   7. git checkout -- packages/web/src/app/boot.ts; git diff --exit-code   (the switch is off again, nothing else changed)
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '../../../release/assemble.ts';
import { TARGETS } from '../../../release/site.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
if (!/^export const FAMILY_ON = true;/m.test(readFileSync(join(root, 'packages/web/src/app/boot.ts'), 'utf8'))) {
  console.error('FAMILY_ON is off in packages/web/src/app/boot.ts: switch it on locally for the rehearsal (never commit it)');
  process.exit(2);
}

const web = spawnSync(process.execPath, [join(root, 'packages/web/tools/build.ts')], { cwd: root, stdio: 'inherit', env: { ...process.env, BA_FIXTURES: 'none' }, windowsHide: true });
if (web.status !== 0) process.exit(web.status ?? 1);

const out = join(root, 'tests', 'release', 'out', 'family', 'dist');
rmSync(out, { recursive: true, force: true });
const report = assemble({ root, web: join(root, 'packages/web/dist'), out, target: TARGETS.production });
for (const p of report.problems) console.error(`problem: ${p}`);
console.log(`release ${report.build} (${report.commit}) for production with FAMILY_ON: ${report.files} files, ${report.appPages} app pages -> ${out}`);
if (report.problems.length) process.exit(1);
