// Writes tests/traces/growth/synth-turn.trace.json: a synthetic person (core/growth/photos/synth-turn.ts) standing still
// for a second, then turning one full slow turn in place, head to feet in the picture (origin 'synthetic': software
// tests of the capture flow only; real-body evidence is the stock-clip measurement, tools/growth-fixtures/measure.ts).
// Usage: node tools/growth-fixtures/synth.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnFrames } from '../../packages/core/growth/photos/synth-turn.ts';
import { serializeTrace } from '../../packages/core/pose/trace.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'tests/traces/growth');
mkdirSync(out, { recursive: true });
const aspect = 3 / 4;
const frames = turnFrames({ seconds: 22, degPerS: 18, seed: 21, aspect, fill: 0.78, stillS: 1.5 });
const file = serializeTrace({ fps: 30, aspect, meta: { id: 'synth-turn', origin: 'synthetic', framing: 'full', notes: 'Synthetic slow turn in place (18 deg/s, 1.5 s still first), portrait 3:4, for the capture flow tests.' }, labels: [], frames: frames.map((f) => ({ t: f.t, lm: f.lm })) });
writeFileSync(join(out, 'synth-turn.trace.json'), JSON.stringify(file) + '\n');
console.log(`synth-turn.trace.json: ${frames.length} frames`);
