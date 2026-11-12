// Prints how the turn tracker does on each fixture trace against the hand labels: main directions right, 360 steps two or
// more off, and every miss (time, labelled angle, the tracker's bucket). Tune thresholds on the tuning clip only.
// Also: the photos the guided capture saves (quick and 360), each against the labelled angle at its time.
// Usage: node tools/growth-fixtures/measure.ts [--split tune|holdout]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { photoScore, score, type LabelSample } from '../../packages/core/growth/photos/measure-lib.ts';
import { parseTrace } from '../../packages/core/pose/trace.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'tests/traces/growth');
const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as { clips: Record<string, { split: string; samples: LabelSample[] }> };
const want = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] : null;
for (const [id, l] of Object.entries(labels.clips)) {
  if (want && l.split !== want) continue;
  const f = join(dir, `${id}.trace.json`);
  if (!existsSync(f)) { console.log(`${id}: no trace yet`); continue; }
  const s = score(parseTrace(JSON.parse(readFileSync(f, 'utf8'))), l.samples);
  console.log(`${id} (${l.split}): main ${s.main.right}/${s.main.n}, 360 near ${s.full.near}/${s.full.n}, two+ off ${s.full.far}`);
  for (const m of s.misses) console.log(`   t=${m.t}s label ${m.deg} got ${m.got}`);
  for (const mode of ["quick", "full"] as const) {
    const p = photoScore(parseTrace(JSON.parse(readFileSync(f, "utf8"))), l.samples, mode);
    console.log(`   photos ${mode}: ${p.right}/${p.wanted} right (${p.filled} filled): ${p.photos.map((x) => `${x.bucket}@${x.t}s=${x.deg} (${x.off} off)`).join(", ")}`);
  }
}
