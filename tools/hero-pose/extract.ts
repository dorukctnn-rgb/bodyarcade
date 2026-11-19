// The home page hero's body line: our own pose model (tools/trace-recorder, the same PoseLandmarker the games use) run frame by
// frame over the encoded hero clips, in one headless browser. Writes one raw trace per clip; tools/hero-pose/compact.ts turns a
// trace into the small file the page draws from (packages/web/src/hero-pose/*.json).
//
//   node tools/hero-pose/extract.ts --out <folder> <clip.webm> [<clip.webm> ...] [--fps 30] [--model <file.task>]
//
// --model: a MediaPipe pose landmarker file to load in place of the lite model the games ship (the same PoseLandmarker, the same
// code path; the page asks for the lite file and gets this one). This runs once, offline: the hero uses the heavy model's points
// (pose_landmarker_heavy, Apache-2.0) because the rope hides the athlete's arms and the lite model loses them there. Nothing of the
// heavy model is shipped; the site only carries the points.
//
// Give it the WebM files that the page plays (the same pixels, the same crop): the points are fractions of that picture, so they
// sit on the athlete only when they come from the file the visitor sees. The headless shell plays VP9, not H.264.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { POSE_MODEL } from '../../packages/core/pose/assets.ts';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import type { TraceFile } from '../../packages/core/types/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const out = flag('out');
const fps = Number(flag('fps') ?? 30);
const model = flag('model');
const clips = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]?.startsWith('--'))).map((c) => resolve(c));
if (!out || clips.length === 0) { console.error('usage: node tools/hero-pose/extract.ts --out <folder> <clip.webm> [...] [--fps 30]'); process.exit(2); }
mkdirSync(resolve(out), { recursive: true });

const port = 41000 + Math.floor(Math.random() * 8000);
const allow = [root, ...new Set(clips.map((c) => dirname(c)))];
const server = await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn', server: { port, strictPort: false, host: '127.0.0.1', fs: { allow } } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`;
const browser = await chromium.launch(baseLaunchOptions);
try {
  const page = await browser.newPage();
  if (model) {
    const body = readFileSync(resolve(model));
    await page.context().route(`**${POSE_MODEL.url}`, (r) => r.fulfill({ status: 200, body, contentType: 'application/octet-stream' }));
  }
  page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
  await page.goto(`${base}tools/trace-recorder/index.html`);
  await page.waitForFunction(() => (window as unknown as { __traceToolReady?: boolean }).__traceToolReady === true);
  for (const clip of clips) {
    const t0 = Date.now();
    const id = basename(clip).replace(/\.[^.]+$/, '');
    const src = `/@fs/${clip.replace(/\\/g, '/')}`;
    const file = await page.evaluate(async ({ src, opts }) => {
      const tool = (window as unknown as { __traceTool: { analyse(u: string, o: unknown): Promise<{ file: unknown }> } }).__traceTool;
      return (await tool.analyse(src, opts)).file;
    }, { src, opts: { id, fps, framing: 'full', prefer: 'CPU', consent: 'licensed' } }) as TraceFile;
    writeFileSync(join(resolve(out), `${id}.trace.json`), `${JSON.stringify(file)}\n`);
    const seen = file.frames.filter((x) => x.lm !== null).length;
    console.log(`${id}: ${file.frames.length} frames, ${seen} with a person, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  await server.close();
}
