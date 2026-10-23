// Builds the web shell: the scripts and styles with Vite, then the static pages. The result is in packages/web/dist.
//   node packages/web/tools/build.ts                 the real catalogue only (what is published)
//   BA_FIXTURES=only node packages/web/tools/build.ts   a build with the development fixtures, for screenshots and tests
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { FixtureMode } from '../catalogue/load.ts';
import { generate } from '../generator/generate.ts';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const fixtures = (process.env['BA_FIXTURES'] ?? 'none') as FixtureMode;
const out = here('../dist');

await build({ configFile: here('../vite.config.ts'), logLevel: 'warn', mode: 'production' });
const report = generate({ out, fixtures });
for (const p of report.problems) console.error(`problem: ${p}`);
console.log(`${report.pages.length} pages (${report.pages.filter((p) => p.indexable).length} in the sitemap), ${report.assets} pictures, catalogue source: ${fixtures === 'none' ? 'real manifests' : `fixtures (${fixtures})`}`);
if (report.problems.length) process.exit(1);
