// A fixture trace cut from a landmark trace that already exists for the same video (same model and settings as extract.ts,
// tools/trace-recorder), so no video and no browser are needed: the fixture's windows (seconds of that video, the source
// trace starting at second 0) are kept and joined with `gapS` of empty frames exactly as extract.ts joins them.
// Usage: node tools/form-fixtures/slice.ts <fixture id>   (the fixture names its source in "fromTrace")
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceFile } from '../../packages/core/types/index.ts';
import { root } from './run-lib.ts';

interface Fx { id: string; move: string; angle: string; windows: [number, number][]; source: string; fromTrace?: string }
const id = process.argv[2];
const manifest = JSON.parse(readFileSync(join(root, 'tools/form-fixtures/fixtures.json'), 'utf8')) as { gapS: number; fixtures: Fx[] };
const f = manifest.fixtures.find((x) => x.id === id);
if (!f?.fromTrace) { console.error(`fixture ${id} has no "fromTrace"`); process.exit(2); }
const src = JSON.parse(readFileSync(join(root, f.fromTrace), 'utf8')) as TraceFile;
const out: TraceFile = { ...src, frames: [] };
let offset = 0;
f.windows.forEach(([from, to], w) => {
  if (w > 0) {
    const gapFrames = Math.round(manifest.gapS * 30);
    for (let i = 1; i <= gapFrames; i++) out.frames.push({ t: Math.round((offset + (i * 1000) / 30) * 10) / 10, lm: null });
    offset += ((gapFrames + 1) * 1000) / 30;
  }
  const part = src.frames.filter((x) => x.t >= from * 1000 && x.t <= to * 1000);
  const t0 = part[0]?.t ?? from * 1000;
  for (const fr of part) out.frames.push({ ...fr, t: Math.round((fr.t - t0 + offset) * 10) / 10 });
  offset += part.length ? part.at(-1)!.t - t0 : 0;
});
out.meta = { ...src.meta, id: f.id, notes: `Form coach fixture: ${f.move}, camera ${f.angle}. Source ${f.source} (tools/form-fixtures/SOURCES.md), seconds ${f.windows.map(([a, b]) => `${a}-${b}`).join(', ')}, cut from ${f.fromTrace} (slice.ts); windows joined with ${manifest.gapS} s of empty frames.` };
writeFileSync(join(root, 'tests/traces/form', `${f.id}.trace.json`), JSON.stringify(out) + '\n');
console.log(`${f.id}: ${out.frames.length} frames`);
