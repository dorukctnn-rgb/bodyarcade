// Measures the form coach on the fixture traces: repetitions counted against the hand labels, false alarms on good-form
// repetitions, wrong repetitions caught. Prints a markdown table (SPEC.md section 12).
// Usage: node tools/form-fixtures/measure.ts [--debug] [--only <id prefix>] [--hz 15]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, labels, loadTrace, restIndex, root, runTrace, score } from './run-lib.ts';

const argv = process.argv.slice(2);
const debug = argv.includes('--debug');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
const hz = argv.includes('--hz') ? Number(argv[argv.indexOf('--hz') + 1]) : undefined;
const lab = existsSync(join(root, 'tools/form-fixtures/labels.json')) ? labels() : {};

const rows: string[] = [];
for (const f of fixtures()) {
  if (only && !f.id.startsWith(only)) continue;
  if (!existsSync(join(root, 'tests/traces/form', `${f.id}.trace.json`))) { rows.push(`| ${f.id} | (no trace yet) |`); continue; }
  const r = runTrace(f.move, loadTrace(f.id), hz);
  if (debug) {
    console.log(`\n== ${f.id} (${f.move}) frames ${r.frames} red ${r.redFrames} views ${JSON.stringify(r.views)}`);
    let line = '';
    for (let i = 0; i < r.progress.length; i += 8) { const p = r.progress[i]; line += p === null || p === undefined ? '.' : String(Math.min(9, Math.round(p * 9))); }
    console.log(' p (every 0.27 s, 0-9):', line);
    for (const rep of r.reps) console.log(`  rep ${rep.n} ${(rep.startT / 1000).toFixed(2)}-${(rep.endT / 1000).toFixed(2)} s, max ${rep.maxP.toFixed(2)}, errors [${rep.errors.join(', ')}], tips [${rep.tips.join(', ')}]`);
  }
  const l = lab[f.id];
  if (!l) { rows.push(`| ${f.id} | ${f.move} | ${f.angle} | ? | ${r.reps.length} | | | | |`); continue; }
  const s = score(r, l);
  const alarms = Object.entries(s.alarmRules).map(([k, v]) => `${k} x${v}`).join(', ');
  const cue = l.expectCue ? (r.cues.has(l.expectCue) ? `${l.expectCue}: yes` : `${l.expectCue}: NO`) : '';
  rows.push(`| ${f.id} | ${f.move} | ${f.angle} | ${s.truth} | ${s.counted} | ${s.matched} | ${s.good ? `${s.falseAlarm}/${s.good}` : '-'} | ${s.wrong ? `${s.caught}/${s.wrong}` : '-'} | ${[alarms, cue].filter(Boolean).join('; ')} |`);
}
console.log('\n| Fixture | Move | Camera | Labelled reps | Counted | Matched | False alarms / good reps | Caught / wrong reps | Notes (false alarm rules, expected cue) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);

// ---- controlled faults on real traces (semi-synthetic, SPEC.md 10): faults.ts ----
import { FAULTS } from './faults.ts';

if (!argv.includes('--no-faults')) {
  console.log('\n| Fixture | Fault (semi-synthetic) | Rule | Reps counted | Reps flagged with the rule | Cue seen |');
  console.log('|---|---|---|---|---|---|');
  for (const c of FAULTS) {
    if (only && !c.fixture.startsWith(only)) continue;
    if (!existsSync(join(root, 'tests/traces/form', `${c.fixture}.trace.json`))) continue;
    const r = runTrace(c.move, c.make(loadTrace(c.fixture)), hz);
    const hit = r.reps.filter((x) => x.errors.includes(c.rule) || x.tips.includes(c.rule)).length;
    const cue = c.cue ? (r.cues.has(c.cue) ? c.cue : `${c.cue}: no`) : '';
    console.log(`| ${c.fixture} | ${c.fault} | ${c.rule} | ${r.reps.length} | ${hit}/${r.reps.length} | ${cue} |`);
  }
}
