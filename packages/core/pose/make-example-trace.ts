// Regenerates packages/core/types/trace.example.json, a tiny synthetic trace that shows the file format.
// Run: node packages/core/pose/make-example-trace.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { absentBetween, combine, jumpAt, synthTrace } from './synth.ts';
import { serializeTrace } from './trace.ts';

const trace = synthTrace({
  id: 'example-stand-jump',
  durationMs: 700,
  fps: 30,
  seed: 7,
  motion: combine(jumpAt(200, 0.45, 450), absentBetween(660, 1000)),
  labels: [
    { t: 0, id: 'still', kind: 'marker', note: 'standing, arms down' },
    { t: 200, id: 'jump', kind: 'rep' },
    { t: 660, id: 'leave', kind: 'marker' },
  ],
  notes: 'Format example only. Synthetic frames are not evidence for any threshold.',
});
const out = fileURLToPath(new URL('../types/trace.example.json', import.meta.url));
writeFileSync(out, JSON.stringify(serializeTrace(trace)) + '\n');
console.log(`wrote ${trace.frames.length} frames to ${out}`);
