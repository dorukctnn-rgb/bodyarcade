// The family switch rehearsal (BUILD-PLAN, launch day: before FAMILY_ON goes on, the final test covers the players screen, the parent
// gate, a child's rules and the family table at the ten sizes WITH THE SWITCH ON). FAMILY_ON (packages/web/src/app/boot.ts) is changed
// to true in the checkout for the run only and changed back after it: launch day commits it, in the commit that publishes the Gumroad
// products. This config refuses to run while the switch is off. The whole sequence: tests/release/family/real-build.ts (top).
//   $env:BA_WEB_E2E_NO_SITE='1'; node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/release/family/playwright.config.ts --workers=1
// On the shell's dev server: the shell's own players specs (packages/web/e2e/profiles.spec.ts, browse.spec.ts) and family.rehearsal.ts.
// Evidence: tests/release/out/family/ (shots/, results.json). Never at the same time as `npm run web:e2e` (the same dev server port).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../../packages/web/playwright.config.ts';

const boot = readFileSync(new URL('../../../packages/web/src/app/boot.ts', import.meta.url), 'utf8');
if (!/^export const FAMILY_ON = true;/m.test(boot)) {
  throw new Error('the family rehearsal needs FAMILY_ON = true in packages/web/src/app/boot.ts (locally, for the run only; change it back after)');
}

const here = fileURLToPath(new URL('.', import.meta.url));
const out = fileURLToPath(new URL('../out/family/', import.meta.url));
const web = fileURLToPath(new URL('../../../packages/web/e2e/', import.meta.url));

export default defineConfig({
  ...base,
  testDir: here,
  outputDir: `${out}test-results`,
  reporter: [['list'], ['json', { outputFile: `${out}results.json` }]],
  projects: [
    { name: 'shell-specs', testDir: web, testMatch: ['profiles.spec.ts', 'browse.spec.ts'] },
    { name: 'rehearsal', testDir: here, testMatch: 'family.rehearsal.ts' },
  ],
});
