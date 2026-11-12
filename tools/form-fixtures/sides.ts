// Debug view of a fixture: every 0.1 s the view, the near side, the coach's progress (and each side's, for one-sided moves),
// both thighs' drop below the hips (1 standing, 0 level), the phase, the count and the cue.
// Usage: node tools/form-fixtures/sides.ts <fixture id> [move] [--every ms]
import { createFormCoach } from '../../packages/core/form/coach.ts';
import { thighDrop } from '../../packages/core/form/moves/legs.ts';
import type { FormMoveId } from '../../packages/core/form/types.ts';
import { traceFrames } from '../../packages/core/pose/trace.ts';
import { fixtures, loadTrace } from './run-lib.ts';

const id = process.argv[2]!;
const f = fixtures().find((x) => x.id === id)!;
const move = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : f.move) as FormMoveId;
const every = process.argv.includes('--every') ? Number(process.argv[process.argv.indexOf('--every') + 1]) : 100;
const coach = createFormCoach(move);
let next = 0;
const fmt = (v: number | null | undefined): string => (v === null || v === undefined ? '   - ' : v.toFixed(2).padStart(5));
for (const fr of traceFrames(loadTrace(id))) {
  const s = coach.push(fr);
  if (s.repDone) console.log(`   >> rep ${s.repDone.n} ${s.repDone.side ?? ''} max ${s.repDone.maxP.toFixed(2)} errors [${s.repDone.errors}] tips [${s.repDone.tips}]`);
  if (fr.t < next) continue;
  next = fr.t + every;
  if (!s.present) { console.log(`${(fr.t / 1000).toFixed(1).padStart(5)} -`); continue; }
  const b = { pts: s.pts, near: s.near, view: s.view ?? 'front', len: s.len! };
  console.log(`${(fr.t / 1000).toFixed(1).padStart(5)} ${(s.view ?? '-').padEnd(5)} ${s.near} p ${fmt(s.progress)} L ${fmt(s.sideP?.L)} R ${fmt(s.sideP?.R)} hL ${fmt(thighDrop(b, 'L'))} hR ${fmt(thighDrop(b, 'R'))} thigh ${fmt(s.len?.thigh)} ${s.phase.padEnd(6)} n ${s.reps}${s.holding ? ` hold ${(s.holdMs / 1000).toFixed(1)}` : ''} ${s.cue ?? ''}`);
}
