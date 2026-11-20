// The body line of a clip, read one frame at a time (tools/hero-pose/still.ts: MediaPipe's pose landmarker in IMAGE mode, every frame on
// its own, no smoothing over time, so the points never trail a fast move), in the square round the person (found by a first look at one
// frame in four). One raw trace per clip, one pose per frame of the clip;
// compact.ts --per-frame turns it into the small file a page draws from.
//
//   node tools/hero-pose/extract-still.ts --out <folder> --model <pose_landmarker_heavy.task> <clip.webm> [<clip.webm> ...]
//
// Give it the WebM files the page plays (the same pixels, the same crop). The headless shell plays VP9, not H.264. The heavy model
// (pose_landmarker_heavy, Apache-2.0) runs here once, offline; only the points are shipped.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { POSE_MODEL } from '../../packages/core/pose/assets.ts';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const out = flag('out');
const model = flag('model');
// --mask <n>: also keep the person's outline, one pixel in n (to score a body line: tools/hero-pose, the alignment check)
const maskStep = Number(flag('mask') ?? 0);
const clips = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]?.startsWith('--'))).map((c) => resolve(c));
if (!out || clips.length === 0) { console.error('usage: node tools/hero-pose/extract-still.ts --out <folder> [--model <file.task>] <clip.webm> [...]'); process.exit(2); }
mkdirSync(resolve(out), { recursive: true });

/** Frames a second and the number of frames, as ffprobe counts them. */
function probe(file: string): { fps: number; frames: number; w: number; h: number } {
  const txt = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=r_frame_rate,nb_read_frames,width,height', '-of', 'json', file], { encoding: 'utf8' });
  const s = (JSON.parse(txt) as { streams: { r_frame_rate: string; nb_read_frames: string; width: number; height: number }[] }).streams[0]!;
  const [a, b] = s.r_frame_rate.split('/').map(Number) as [number, number];
  return { fps: a / (b || 1), frames: Number(s.nb_read_frames), w: s.width, h: s.height };
}

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
  await page.goto(`${base}tools/hero-pose/still.html`);
  await page.waitForFunction(() => (window as unknown as { __stillReady?: boolean }).__stillReady === true, undefined, { timeout: 120_000 });
  for (const clip of clips) {
    const t0 = Date.now();
    const id = basename(clip).replace(/\.[^.]+$/, '');
    const info = probe(clip);
    const src = `/@fs/${clip.replace(/\\/g, '/')}`;
    type Run = { lm: (number[] | null)[]; masks: string[] };
    type Roi = { x: number; y: number; side: number };
    const read = (o: { maskStep: number; roi: Roi | null; every: number }): Promise<Run> => page.evaluate(async ({ src, fps, frames, maskStep, roi, every }) => {
      const tool = (window as unknown as { __still: { analyse(u: string, f: number, n: number, m: number, r: Roi | null, e: number): Promise<Run> } }).__still;
      return tool.analyse(src, fps, frames, maskStep, roi, every);
    }, { src, fps: info.fps, frames: info.frames, ...o });
    // A first look at one frame in four finds where the person is over the whole clip; every frame is then read in the square round
    // them (a small figure in a wide shot, or a clip with black sides, then fills the model's view). Without a first look that finds
    // the person in most frames, the whole picture is read.
    // --whole: the whole picture only (a clip where an object in the hands, a plate or a dumbbell, fills the square and fools the model)
    const look = argv.includes('--whole') ? { lm: [], masks: [] } : await read({ maskStep: 0, roi: null, every: 4 });
    const seen = look.lm.filter((x): x is number[] => !!x);
    let roi: Roi | null = null;
    if (look.lm.length > 0 && seen.length >= look.lm.length * 0.6) {
      const xs: number[] = [], ys: number[] = [];
      for (const lm of seen) for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]) {
        const x = lm[i * 4]!, y = lm[i * 4 + 1]!;
        if (lm[i * 4 + 3]! > 0.5 && x > -0.05 && x < 1.05 && y > -0.05 && y < 1.05) { xs.push(x * info.w); ys.push(y * info.h); }
      }
      xs.sort((m, n) => m - n); ys.sort((m, n) => m - n);
      const q = (v: number[], f: number): number => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))]!;
      const x0 = q(xs, 0.02), x1 = q(xs, 0.98), y0 = q(ys, 0.02), y1 = q(ys, 0.98);
      const side = Math.max(x1 - x0, y1 - y0) * 1.35;
      if (side < Math.max(info.w, info.h) * 0.85) roi = { x: (x0 + x1) / 2 - side / 2, y: (y0 + y1) / 2 - side / 2, side };
    }
    const { lm: lms, masks } = await read({ maskStep, roi, every: 1 });
    const file = { fps: info.fps, aspect: info.w / info.h, perFrame: true, frames: lms.map((lm, k) => ({ t: Math.round((k * 1000 / info.fps) * 10) / 10, lm })) };
    if (maskStep > 0) writeFileSync(join(resolve(out), `${id}.mask.json`), `${JSON.stringify({ step: maskStep, w: Math.floor(info.w / maskStep), h: Math.floor(info.h / maskStep), masks })}
`);
    writeFileSync(join(resolve(out), `${id}.trace.json`), `${JSON.stringify(file)}\n`);
    console.log(`${id}: ${lms.length} frames (${info.w}x${info.h}, ${info.fps.toFixed(3)} fps), read in ${roi ? `the square of ${Math.round(roi.side)} px round the person` : 'the whole picture'}, ${lms.filter((x) => x).length} with a person, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
  await server.close();
}
