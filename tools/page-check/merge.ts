// Adds the report of a run of a few pages or sizes to the report of an earlier run (see mergeReports in summarize.ts).
//
//   node tools/page-check/merge.ts <new report.json> <older report.json> [--out dir]
//
// Writes report.json and FINDINGS.md into --out (default: the folder of the new report).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mergeReports, renderMarkdown, type Report } from './summarize.ts';

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (files.length !== 2) { console.error('usage: node tools/page-check/merge.ts <new report.json> <older report.json> [--out dir]'); process.exit(2); }
const [freshFile, oldFile] = files.map((f) => resolve(f)) as [string, string];
const outArg = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : undefined;
const out = resolve(outArg ?? dirname(freshFile));
mkdirSync(out, { recursive: true });
const merged = mergeReports(JSON.parse(readFileSync(freshFile, 'utf8')) as Report, JSON.parse(readFileSync(oldFile, 'utf8')) as Report, { fresh: out, old: dirname(oldFile) });
writeFileSync(join(out, 'report.json'), JSON.stringify(merged, null, 1));
writeFileSync(join(out, 'FINDINGS.md'), renderMarkdown(merged, out, { warnings: true, max: 60 }).text);
console.log(`merged: ${merged.results.length} screens (${(merged as Report & { carried: number }).carried} from the older report) in ${out}`);
