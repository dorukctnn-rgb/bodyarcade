// Renders synthetic-person clips (moves.ts) in headless Chromium and writes, per clip and variant:
//   <videos>/<id>.mjpeg       the camera's pictures (30 per second, the same JPEGs the pose model was shown)
//   <videos>/<id>.truth.json  the true joints of every frame (world metres and picture position)
//   <traces>/<id>.trace.json  the landmarks the real pose model found in those pictures (trace format), with labels
//   <traces>/<id>.report.json how well it found them (see quality.ts)
//
//   node tools/synth-video/render.ts --clip squat-6x [--variant default] [--no-detect] [--fps 30] [--sheet out.jpg]
//   node tools/synth-video/render.ts --all [--variants default,far-dim]
// Videos go to tests/traces/videos/synth (ignored by git); the traces and reports to tests/traces/synth-video (committed).
// --sheet: only a contact sheet of a few frames of the clip, for looking at the rig.
import { chromium, type Page } from '@playwright/test';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { repoRoot } from '../page-check/servers.ts';
import type { TraceFile, TraceLabel, TraceMeta } from '../../packages/core/types/index.ts';
import { labelsFor, type Dims, type TruthFrame } from './labels.ts';
import { CLIPS, clipById, type Clip } from './moves.ts';
import { qualityOf, type ClipQuality } from './quality.ts';
import { VARIANTS, variantById, type Variant } from './variants.ts';
import type { FrameResult, SceneDef } from './render.page.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

export interface RenderOptions { fps: number; detect: boolean; jpegQuality: number }

export interface Rendered {
  id: string;
  clip: string;
  variant: string;
  dims: Dims[];
  frames: number;
  trace: TraceFile | null;
  labels: TraceLabel[];
  quality: ClipQuality | null;
  wallSeconds: number;
}

type Synth = { init(d: SceneDef, o: { detect: boolean }): Promise<{ people: Dims[]; camera: { x: number; y: number; z: number; fovY: number; aspect: number } }>; frame(specs: unknown[], o: { quality: number; detect: boolean; tMs: number }): Promise<FrameResult>; finish(meta: TraceMeta, fps: number, decimals?: number): TraceFile; done(): void };

/** The scene of a clip in a variant: the camera frames the person (or the people) the way the clip says. */
export function sceneFor(clip: Clip, v: Variant, size: { width: number; height: number }): SceneDef {
  const h = v.personHeight;
  const fullBody = clip.framing === 'full';
  // The share of the picture height that the person (head to feet, or head to hips) takes.
  const frame = fullBody ? v.frame : Math.min(0.9, v.frame * 1.15);
  const span = fullBody ? h : h * 0.58;
  const dist = (span / frame / 2) / Math.tan((v.fovY * Math.PI) / 360) * (clip.people > 1 ? 1.35 : 1);
  const lookAt = fullBody ? h * 0.5 : h * 0.72;
  const gap = clip.people > 1 ? 0.55 * (span / frame / 2) : 0;
  return {
    ...size, fovY: v.fovY, camHeight: v.camHeight ?? lookAt + 0.08, camDist: dist, lookAtY: lookAt,
    wall: v.wall, floor: v.floor, background: v.background, hemi: v.hemi, sun: v.sun, sunColor: v.sunColor, sunPos: v.sunPos,
    people: Array.from({ length: clip.people }, (_, i) => ({ skin: i === 0 ? v.skin : v.skin2 ?? v.skin, height: i === 0 ? h : h * (v.personHeight2 ?? 0.94), x: clip.people > 1 ? (i === 0 ? -gap : gap) : v.x ?? 0, yaw: v.yaw ?? 0 })),
  };
}

export async function renderClip(page: Page, clip: Clip, v: Variant, o: RenderOptions, outDirs: { videos: string; traces: string }): Promise<Rendered> {
  const t0 = Date.now();
  const synth = (): Synth => (window as unknown as { synth: Synth }).synth;
  void synth;
  const size = v.picture ?? { width: 640, height: 360 };
  const scene = sceneFor(clip, v, size);
  const info = await page.evaluate(({ scene, detect }) => (window as unknown as { synth: Synth }).synth.init(scene, { detect }), { scene, detect: o.detect });
  const id = `${clip.id}.${v.id}`;
  mkdirSync(outDirs.videos, { recursive: true });
  const video = createWriteStream(join(outDirs.videos, `${id}.mjpeg`));
  const n = Math.round(clip.seconds * o.fps);
  const truth: TruthFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / o.fps;
    const specs = Array.from({ length: clip.people }, (_, k) => clip.pose(t, k));
    const r = await page.evaluate(({ specs, tMs, quality, detect }) => (window as unknown as { synth: Synth }).synth.frame(specs, { quality, detect, tMs }), { specs, tMs: t * 1000, quality: o.jpegQuality, detect: o.detect });
    video.write(Buffer.from(r.jpeg, 'base64'));
    truth.push({ t: Math.round(t * 1000 * 10) / 10, people: r.truth });
  }
  await new Promise<void>((ok) => video.end(ok));
  const meta: TraceMeta = {
    id, origin: 'video', framing: clip.framing === 'upper' ? 'upper' : 'full', model: 'pose_landmarker_lite float16, tasks-vision 1.1.1, CPU',
    recordedAt: new Date().toISOString(), consent: 'own',
    notes: `SYNTHETIC PERSON, not a real body: a CC0 cartoon character (Kenney, Animated Characters Protagonists, skin ${v.skin}) posed by tools/synth-video, filmed by a virtual camera, shown to the real pose model as camera JPEGs. Clip ${clip.id}: ${clip.about} Variant ${v.id}: ${v.about}`,
  };
  const trace = o.detect ? await page.evaluate(({ meta, fps }) => (window as unknown as { synth: Synth }).synth.finish(meta, fps), { meta, fps: o.fps }) : null;
  const labels = labelsFor(clip, truth, info.people, o.fps);
  let quality: ClipQuality | null = null;
  if (trace) {
    trace.labels = labels;
    quality = qualityOf(trace, truth, info.people, { clip: clip.id, variant: v.id });
    mkdirSync(outDirs.traces, { recursive: true });
    writeFileSync(join(outDirs.traces, `${id}.trace.json`), JSON.stringify(trace) + '\n');
    writeFileSync(join(outDirs.traces, `${id}.report.json`), JSON.stringify(quality, null, 1) + '\n');
  }
  writeFileSync(join(outDirs.videos, `${id}.truth.json`), JSON.stringify({ fps: o.fps, dims: info.people, camera: info.camera, scene, frames: truth }));
  return { id, clip: clip.id, variant: v.id, dims: info.people, frames: n, trace, labels, quality, wallSeconds: Math.round((Date.now() - t0) / 100) / 10 };
}

/** A contact sheet of a clip: `count` pictures spread over its length, with the true joints drawn on them. */
export async function sheet(page: Page, clip: Clip, v: Variant, count: number, from = 0, to = clip.seconds): Promise<string> {
  const size = v.picture ?? { width: 640, height: 360 };
  const scene = sceneFor(clip, v, size);
  await page.evaluate(({ scene }) => (window as unknown as { synth: Synth }).synth.init(scene, { detect: true }), { scene });
  const pics: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / Math.max(1, count - 1);
    const r = await page.evaluate(({ specs, tMs }) => (window as unknown as { synth: Synth }).synth.frame(specs, { quality: 0.9, detect: true, tMs }), { specs: Array.from({ length: clip.people }, (_, k) => clip.pose(t, k)), tMs: t * 1000 });
    pics.push(r.jpeg + (r.found.length ? '' : '!'));
  }
  return pics.join(',');
}

export async function withRenderer<T>(fn: (page: Page, base: string) => Promise<T>): Promise<T> {
  const root = repoRoot();
  const server = await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', server: { port: 41800 + Math.floor(Math.random() * 400), strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? '';
  const browser = await chromium.launch({ ...baseLaunchOptions, args: [...(baseLaunchOptions.args ?? []), '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
    await page.goto(`${base}tools/synth-video/render.html`);
    await page.waitForFunction(() => (window as unknown as { synthReady?: boolean }).synthReady === true, null, { timeout: 90_000 });
    return await fn(page, base);
  } finally {
    await browser.close();
    await server.close();
  }
}

// ---- command line -------------------------------------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const root = repoRoot();
  const dirs = { videos: resolve(opt('videos') ?? join(root, 'tests', 'traces', 'videos', 'synth')), traces: resolve(opt('traces') ?? join(root, 'tests', 'traces', 'synth-video')) };
  const clips = args.includes('--all') ? CLIPS : (opt('clip') ?? '').split(',').map((id) => clipById(id)).filter((c): c is Clip => !!c);
  const variants = (opt('variants') ?? opt('variant') ?? 'default').split(',').map((id) => variantById(id)).filter((v): v is Variant => !!v);
  if (!clips.length || !variants.length) {
    console.error(`usage: node tools/synth-video/render.ts --clip <id[,id]>|--all [--variant <id[,id]>] [--no-detect] [--sheet file.jpg]\nclips: ${CLIPS.map((c) => c.id).join(', ')}\nvariants: ${VARIANTS.map((v) => v.id).join(', ')}`);
    process.exit(2);
  }
  const o: RenderOptions = { fps: Number(opt('fps') ?? 30), detect: !args.includes('--no-detect'), jpegQuality: Number(opt('quality') ?? 0.88) };
  await withRenderer(async (page) => {
    if (opt('sheet')) {
      const clip = clips[0] as Clip;
      const v = variants[0] as Variant;
      const count = Number(opt('count') ?? 6);
      const joined = await sheet(page, clip, v, count, Number(opt('from') ?? 0), Number(opt('to') ?? clip.seconds));
      const dir = resolve(opt('sheet') as string);
      mkdirSync(join(dir, '..'), { recursive: true });
      joined.split(',').forEach((p, i) => writeFileSync(`${dir.replace(/\.jpg$/, '')}-${i}${p.endsWith('!') ? '-nobody' : ''}.jpg`, Buffer.from(p.replace('!', ''), 'base64')));
      console.log(`${count} picture(s) of ${clip.id} (${v.id}) written as ${dir.replace(/\.jpg$/, '')}-N.jpg`);
      return;
    }
    for (const clip of clips) for (const v of variants) {
      const r = await renderClip(page, clip, v, o, dirs);
      const q = r.quality;
      console.log(`${r.id}: ${r.frames} frames in ${r.wallSeconds} s, ${r.labels.length} label(s)${q ? `, found in ${(q.detectionRate * 100).toFixed(0)} % of the frames, joint error ${q.errorMedian.toFixed(3)} T (median)` : ''}`);
    }
  });
}
