// Headless trace extraction from a video file: Vite serves the recorder page, headless Chromium analyses the video
// frame by frame with the real model, and the trace JSON is written to disk. Nothing stays running afterwards.
// Usage:
//   node tools/trace-recorder/extract.ts --video <file.webm> --out <file.trace.json> --id <name>
//        [--fps 30] [--from 0] [--to 12] [--framing full] [--consent licensed] [--notes "attribution"] [--thread main]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k?.startsWith('--')) { out[k.slice(2)] = a[i + 1] ?? ''; i++; }
  }
  return out;
}

const o = args();
if (!o.video || !o.out || !o.id) {
  console.error('Usage: node tools/trace-recorder/extract.ts --video <file> --out <file.trace.json> --id <name> [--fps 30] [--from s] [--to s] [--framing full|upper|side] [--consent own|licensed|opt-in] [--notes text]');
  process.exit(2);
}
const video = resolve(o.video);
const port = 41000 + Math.floor(Math.random() * 8000);
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  logLevel: 'warn',
  server: { port, strictPort: false, host: '127.0.0.1', fs: { allow: [root, dirname(video)] } },
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`;
const browser = await chromium.launch(baseLaunchOptions);
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
  await page.goto(`${base}tools/trace-recorder/index.html`);
  await page.waitForFunction(() => (window as unknown as { __traceToolReady?: boolean }).__traceToolReady === true);
  const opts: Record<string, unknown> = { id: o.id, fps: Number(o.fps || 30), framing: o.framing || 'full', prefer: 'CPU' };
  if (o.from) opts.from = Number(o.from);
  if (o.to) opts.to = Number(o.to);
  if (o.notes) opts.notes = o.notes;
  if (o.consent) opts.consent = o.consent;
  if (o.thread === 'main') opts.worker = false;
  const src = `/@fs/${video.replace(/\\/g, '/')}`;
  const t0 = Date.now();
  const file = await page.evaluate(async ({ src, opts }) => {
    const tool = (window as unknown as { __traceTool: { analyse(u: string, o: unknown): Promise<{ file: unknown }> } }).__traceTool;
    return (await tool.analyse(src, opts)).file;
  }, { src, opts });
  const out = resolve(o.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file) + '\n');
  const frames = (file as { frames: { lm: unknown }[] }).frames;
  console.log(`${o.id}: ${frames.length} frames, ${frames.filter((f) => f.lm !== null).length} with a person, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`);
} finally {
  await browser.close();
  await server.close();
}
