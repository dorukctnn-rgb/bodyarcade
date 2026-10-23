// Trace recorder dev page: live recording from the camera or a video file, labels by key, download as JSON.
// Also exposes window.__traceTool for headless extraction (tools/trace-recorder/extract.ts). Dev only, never shipped.
import { createCameraService } from '../../packages/core/camera/camera.ts';
import { POSE_MODEL, WASM_BASE } from '../../packages/core/pose/assets.ts';
import { createPoseService } from '../../packages/core/pose/service.ts';
import { recordTrace, serializeTrace } from '../../packages/core/pose/trace.ts';
import { POSE_CONNECTIONS, type CameraLease, type Framing, type PoseFrame, type Trace, type TraceLabel, type TraceRecording, type VideoFrameSource } from '../../packages/core/types/index.ts';
import { analyseVideo } from './analyse.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('v');
const canvas = $<HTMLCanvasElement>('c');
const status = $('status');
const statsLine = $('stats');
const say = (s: string): void => { status.textContent = s; };

const pose = createPoseService();
const camera = createCameraService();
let lease: CameraLease | null = null;
let fileUrl: string | null = null;
let recording: TraceRecording | null = null;
let recStart = 0;
let labels: TraceLabel[] = [];
let last: Trace | null = null;

function draw(f: PoseFrame): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  if (!f.landmarks) return;
  // object-fit: contain, same as the video element
  const scale = Math.min(w / f.aspect, h);
  const vw = scale * f.aspect, vh = scale, ox = (w - vw) / 2, oy = (h - vh) / 2;
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.strokeStyle = '#fb923c';
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = f.landmarks[a], q = f.landmarks[b];
    if (!p || !q || p.visibility < 0.5 || q.visibility < 0.5) continue;
    ctx.beginPath(); ctx.moveTo(ox + p.x * vw, oy + p.y * vh); ctx.lineTo(ox + q.x * vw, oy + q.y * vh); ctx.stroke();
  }
}

pose.onFrame((f) => {
  draw(f);
  const s = pose.stats;
  statsLine.textContent = (`${pose.loaded?.worker ? 'worker' : 'main thread'}, ${pose.loaded?.delegate}, ${s.hz} Hz, p50 ${s.p50.toFixed(1)} ms, p95 ${s.p95.toFixed(1)} ms, dropped ${s.dropped}${recording ? `, recording ${recording.frames} frames` : ''}`);
});

async function ensureModel(): Promise<void> {
  if (pose.loaded) return;
  say('Loading the pose model...');
  await pose.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: 'GPU', onProgress: (p) => say(`Loading ${p.phase}: ${Math.round((100 * p.loaded) / Math.max(1, p.total))}%`) });
  await pose.warmUp();
}

function fileSource(url: string): VideoFrameSource {
  return {
    kind: 'video',
    video,
    async start() { video.srcObject = null; video.src = url; video.loop = true; await video.play(); },
    stop() { video.pause(); },
  };
}

function enable(): void {
  $<HTMLButtonElement>('b-rec').disabled = false;
  $<HTMLButtonElement>('b-analyse').disabled = fileUrl === null;
}

$('b-camera').addEventListener('click', async () => {
  try {
    await ensureModel();
    lease?.release();
    lease = await camera.acquire();
    video.srcObject = lease.stream;
    await video.play();
    pose.attach({ kind: 'video', video, start: async () => {}, stop: () => {} });
    enable();
  } catch (e) { say(`Camera: ${e instanceof Error ? e.message : String(e)}`); }
});

$<HTMLInputElement>('f-video').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await ensureModel();
    lease?.release(); lease = null;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(file);
    $<HTMLInputElement>('t-id').value = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'trace';
    const src = fileSource(fileUrl);
    await src.start();
    pose.attach(src);
    enable();
  } catch (err) { say(`Video: ${err instanceof Error ? err.message : String(err)}`); }
});

$('b-rec').addEventListener('click', () => {
  labels = [];
  recStart = performance.now();
  recording = recordTrace(pose, { id: $<HTMLInputElement>('t-id').value || 'trace', framing: $<HTMLSelectElement>('s-framing').value as Framing, consent: 'own' });
  $<HTMLButtonElement>('b-rec').disabled = true;
  $<HTMLButtonElement>('b-stop').disabled = false;
});

$('b-stop').addEventListener('click', () => {
  if (!recording) return;
  last = recording.stop();
  last.labels = labels;
  recording = null;
  $<HTMLButtonElement>('b-rec').disabled = false;
  $<HTMLButtonElement>('b-stop').disabled = true;
  $<HTMLButtonElement>('b-save').disabled = false;
  say(`Recorded ${last.frames.length} frames at about ${last.fps} fps with ${labels.length} labels.`);
});

$('b-analyse').addEventListener('click', async () => {
  if (!fileUrl) return;
  try {
    const r = await analyseVideo(fileUrl, {
      id: $<HTMLInputElement>('t-id').value || 'trace', framing: $<HTMLSelectElement>('s-framing').value as Framing, consent: 'own',
      onProgress: (d, n) => say(`Analysing frame ${d} of ${n}`),
    });
    last = r.trace;
    $<HTMLButtonElement>('b-save').disabled = false;
    say(`Analysed ${r.trace.frames.length} frames in ${(r.ms / 1000).toFixed(1)} s.`);
  } catch (e) { say(`Analyse: ${e instanceof Error ? e.message : String(e)}`); }
});

$('b-save').addEventListener('click', () => {
  if (!last) return;
  const blob = new Blob([JSON.stringify(serializeTrace(last))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${last.meta.id}.trace.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

const KEYS: Record<string, Omit<TraceLabel, 't'>> = {
  j: { id: 'jump', kind: 'rep' }, s: { id: 'squat', kind: 'rep' }, k: { id: 'kneeLift', kind: 'rep' },
  a: { id: 'lean', kind: 'holdStart', side: 'L' }, d: { id: 'lean', kind: 'holdStart', side: 'R' }, ' ': { id: 'still', kind: 'marker' },
};
addEventListener('keydown', (e) => {
  if (!recording || e.repeat || (e.target as HTMLElement).tagName === 'INPUT') return;
  const l = KEYS[e.key.toLowerCase()];
  if (!l) return;
  e.preventDefault();
  labels.push({ ...l, t: Math.round(performance.now() - recStart) });
});

addEventListener('pagehide', () => { lease?.release(); pose.dispose(); });

// Headless extraction hook (dev page only).
(window as unknown as { __traceTool: unknown }).__traceTool = { analyse: analyseVideo };
(window as unknown as { __traceToolReady: boolean }).__traceToolReady = true;
