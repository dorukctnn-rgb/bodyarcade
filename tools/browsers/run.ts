// The browser matrix: builds the two sites, starts them, runs the flows on the engines, and writes the table (browser x flow).
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node tools/browsers/run.ts --engines webkit,firefox
//   options: --engines webkit,firefox,chromium   --sizes phone,desktop   --set flows|ui|all   --grep "camera"   --grep-invert "legal"
//            (--set peers: the peer layer of live play in four variants, to see what an engine needs)
//            --repeat-each 3 (every test three times: how steady is it?)
//            --out qa-out/browsers   --rebuild (build the sites again)   --table <results.json> (only print the table of an earlier run)
//            --probe (what each engine can do on this machine, then stop)
// Result: qa-out/browsers/results.json (Playwright's), TABLE.md, shots/<project>/<name>.jpg. Exit code 1 when a flow failed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowsOf, tableMarkdown, type JsonReport } from './table.ts';
import { probe } from './probe.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string): boolean => args.includes(`--${name}`);
const out = resolve(flag('out') ?? join(root, 'qa-out', 'browsers'));
mkdirSync(out, { recursive: true });

const engines = (flag('engines') ?? 'webkit,firefox').split(',').map((s) => s.trim()).filter(Boolean);

if (has('probe')) {
  const list = await probe(engines);
  for (const f of list) console.log(`=== ${f.engine} ${String(f['version'] ?? '')}\n${JSON.stringify(f, null, 1)}`);
  writeFileSync(join(out, 'engines.json'), JSON.stringify(list, null, 1));
  process.exit(0);
}

const setName = flag('set') ?? 'flows';

function table(file: string, name = setName): string {
  const rows = rowsOf(JSON.parse(readFileSync(file, 'utf8')) as JsonReport);
  const what = name === 'ui' ? 'the web shell specs' : name === 'peers' ? 'the peer layer of live play, four variants' : name === 'all' ? 'flows, the web shell specs and the peer layer' : 'flows';
  const md = tableMarkdown(rows, `Browser matrix, ${what} (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`);
  writeFileSync(join(out, name === 'flows' ? 'TABLE.md' : `TABLE-${name}.md`), md);
  return md;
}

const tableOnly = flag('table');
if (tableOnly) { console.log(table(resolve(tableOnly))); process.exit(0); }

const resultsFile = join(root, 'qa-out', 'browsers', setName === 'flows' ? 'results.json' : `results-${setName}.json`);
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  BA_BROWSERS: engines.join(','),
  BA_BROWSERS_SIZES: flag('sizes') ?? 'phone,desktop',
  BA_BROWSERS_SET: setName,
  BA_BROWSERS_RESULTS: resultsFile,
};
if (has('rebuild')) {
  const r = spawnSync(process.execPath, [join(here, 'support', 'sites.ts'), '--build', '--rebuild'], { cwd: root, stdio: 'inherit', env, windowsHide: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const pw = ['test', '-c', join(here, 'playwright.config.ts'), '--workers=1'];
if (flag('grep')) pw.push('--grep', flag('grep') as string);
if (flag('grep-invert')) pw.push('--grep-invert', flag('grep-invert') as string);
if (flag('repeat-each')) pw.push('--repeat-each', flag('repeat-each') as string);
const files = args.filter((a, i) => !a.startsWith('--') && !['--engines', '--sizes', '--set', '--grep', '--grep-invert', '--repeat-each', '--out', '--table'].includes(args[i - 1] ?? ''));
pw.push(...files);
const res = spawnSync(process.execPath, [cli, ...pw], { cwd: root, stdio: 'inherit', env, windowsHide: true });
if (existsSync(resultsFile)) {
  console.log(`
${table(resultsFile)}

Pictures: ${join(root, 'qa-out', 'browsers', 'shots')}`);
}
process.exit(res.status ?? 1);
