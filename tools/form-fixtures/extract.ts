// Form coach fixtures: every fixture of fixtures.json run through the real pose model, frame by frame, in ONE headless
// Chromium (the trace recorder page, tools/trace-recorder). Each window of a fixture is one fixed camera shot of the
// source video; windows are joined with `gapS` seconds of empty frames. Output: tests/traces/form/<id>.trace.json
// (landmarks only). A fixture whose trace already exists is skipped, so an interrupted run continues where it stopped.
// Usage:
//   node tools/form-fixtures/extract.ts --clips <folder with the videos> [--only id,id] [--force]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import type { TraceFile } from '../../packages/core/types/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'tests/traces/form');

interface Fixture { id: string; move: string; clip: string; angle: string; windows: [number, number][]; source: string; trace?: string }
interface Manifest { gapS: number; fixtures: Fixture[] }

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (!k?.startsWith('--')) continue;
    const v = a[i + 1];
    if (v === undefined || v.startsWith('--')) out[k.slice(2)] = '1'; else { out[k.slice(2)] = v; i++; }
  }
  return out;
}

const o = args();
if (!o.clips) { console.error('Usage: node tools/form-fixtures/extract.ts --clips <folder> [--only id,id] [--force]'); process.exit(2); }
const clips = resolve(o.clips);
const manifest = JSON.parse(readFileSync(join(root, 'tools/form-fixtures/fixtures.json'), 'utf8')) as Manifest;
const only = o.only ? new Set(o.only.split(',')) : null;
const todo = manifest.fixtures.filter((f) => !f.trace && (!only || only.has(f.id)) && (o.force || !existsSync(join(outDir, `${f.id}.trace.json`))));
if (todo.length === 0) { console.log('Every fixture trace exists already.'); process.exit(0); }
mkdirSync(outDir, { recursive: true });

const port = 41000 + Math.floor(Math.random() * 8000);
const server = await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn', server: { port, strictPort: false, host: '127.0.0.1', fs: { allow: [root, clips] } } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`;
const browser = await chromium.launch(baseLaunchOptions);
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
  await page.goto(`${base}tools/trace-recorder/index.html`);
  await page.waitForFunction(() => (window as unknown as { __traceToolReady?: boolean }).__traceToolReady === true);
  for (const f of todo) {
    const t0 = Date.now();
    const src = `/@fs/${join(clips, f.clip).replace(/\\/g, '/')}`;
    let merged: TraceFile | null = null;
    let offset = 0;
    for (const [from, to] of f.windows) {
      const file = await page.evaluate(async ({ src, opts }) => {
        const tool = (window as unknown as { __traceTool: { analyse(u: string, o: unknown): Promise<{ file: unknown }> } }).__traceTool;
        return (await tool.analyse(src, opts)).file;
      }, { src, opts: { id: f.id, fps: 30, from, to, framing: f.angle === 'side' ? 'side' : 'full', prefer: 'CPU', consent: 'licensed' } }) as TraceFile;
      if (!merged) { merged = { ...file, frames: [] }; }
      else {
        // the gap: empty frames, as if the person stepped out of the picture between two shots
        const gapFrames = Math.round(manifest.gapS * 30);
        for (let i = 1; i <= gapFrames; i++) merged.frames.push({ t: Math.round((offset + (i * 1000) / 30) * 10) / 10, lm: null });
        offset += (gapFrames + 1) * 1000 / 30;
      }
      for (const fr of file.frames) merged.frames.push({ ...fr, t: Math.round((fr.t + offset) * 10) / 10 });
      const last = file.frames.at(-1);
      offset += (last ? last.t : 0);
    }
    if (!merged) continue;
    merged.meta = {
      ...merged.meta,
      id: f.id,
      notes: `Form coach fixture: ${f.move}, camera ${f.angle}. Source ${f.source} (tools/form-fixtures/SOURCES.md), seconds ${f.windows.map(([a, b]) => `${a}-${b}`).join(', ')}; windows joined with ${manifest.gapS} s of empty frames.`,
      consent: 'licensed',
    };
    writeFileSync(join(outDir, `${f.id}.trace.json`), JSON.stringify(merged) + '\n');
    const seen = merged.frames.filter((x) => x.lm !== null).length;
    console.log(`${f.id}: ${merged.frames.length} frames, ${seen} with a person, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  await server.close();
}
