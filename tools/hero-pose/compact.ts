// Turns a raw hero trace (tools/hero-pose/extract.ts, 30 frames a second, every MediaPipe point) into the small file the home page
// hero draws from: the points of the body line only, smoothed, 15 frames a second, as whole thousandths of the picture, plus the
// moments of the score pops, taken from the athlete's own movement (the lowest point of each rope slam of a wrist).
//
//   node tools/hero-pose/compact.ts <in.trace.json> <out.json> [--pops=6] [--from=0.6] [--gap=1.3] [--pad=W,H] [--beat=hips|wrists]
//
// --beat: what a scoring moment is. hips (default): the lowest point of each squat or lunge (the middle of the hips at its lowest);
// wrists: the lowest point of each slam of a wrist (battle ropes).
//
// --pad=W,H: the trace was made from the clip centred on a black square (W x H in a square of the longer side). The model places the
// points of a picture that is not square a little off (MediaPipe: "NORM_RECT without IMAGE_DIMENSIONS is only supported for the
// square ROI"), so extract.ts is given square copies and the points are turned back into fractions of the clip's own picture here.
//
// The page interpolates between the frames (Catmull-Rom), so 15 frames a second keep up with the arms.
import { readFileSync, writeFileSync } from 'node:fs';
import { HERO_POINTS, type HeroPose } from '../../packages/web/src/hero-pose.ts';

const args = process.argv.slice(2);
const [input, output] = args.filter((a) => !a.startsWith('--'));
const flag = (n: string, d: number): number => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? Number(a.slice(n.length + 3)) : d; };
if (!input || !output) { console.error('usage: node tools/hero-pose/compact.ts <in.trace.json> <out.json> [--pops=6] [--from=0.6]'); process.exit(2); }

interface RawTrace { fps: number; aspect: number; frames: { t: number; lm: number[] | null }[] }
const raw = JSON.parse(readFileSync(input, 'utf8')) as RawTrace;
const padArg = args.find((x) => x.startsWith('--pad='))?.slice(6).split(',').map(Number);
const [padW, padH] = padArg && padArg.length === 2 ? padArg as [number, number] : [0, 0];
const side = Math.max(padW, padH);
const unpadX = (x: number): number => (padW ? (x * side - (side - padW) / 2) / padW : x);
const unpadY = (y: number): number => (padH ? (y * side - (side - padH) / 2) / padH : y);
const aspect = padW ? padW / padH : raw.aspect;
// --video-fps=<frames a second of the clip> (24000/1001 for the Mixkit clips): one pose per frame of the clip, exactly the one the
// model read from that frame and not smoothed, so the line sits on the athlete in every frame (a smoothed or 15 fps line lags a jump).
const videoFpsArg = args.find((x) => x.startsWith('--video-fps='))?.slice(12);
const VIDEO_FPS = videoFpsArg ? (videoFpsArg.includes('/') ? Number(videoFpsArg.split('/')[0]) / Number(videoFpsArg.split('/')[1]) : Number(videoFpsArg)) : 0;
const OUT_FPS = VIDEO_FPS || 15;
const step = Math.round(raw.fps / 15);
const ids = HERO_POINTS.map((p) => p.mp);

// 1. the kept points per frame, null where the model saw nobody
type P = { x: number; y: number };
const seen: (P[] | null)[] = raw.frames.map((f) => (f.lm ? ids.map((i) => ({ x: unpadX(f.lm![i * 4] as number), y: unpadY(f.lm![i * 4 + 1] as number) })) : null));
// 2. fill a frame without a person from its neighbours (linear), so the line never jumps to nothing
const filled: P[][] = seen.map((f, i) => {
  if (f) return f;
  let a = i - 1; while (a >= 0 && !seen[a]) a -= 1;
  let b = i + 1; while (b < seen.length && !seen[b]) b += 1;
  const A = a >= 0 ? seen[a] : null, B = b < seen.length ? seen[b] : null;
  if (A && B) { const k = (i - a) / (b - a); return A.map((p, j) => ({ x: p.x + (B[j]!.x - p.x) * k, y: p.y + (B[j]!.y - p.y) * k })); }
  return (A ?? B) as P[];
});
if (filled.some((f) => !f)) throw new Error('the clip has no person in it');
// 3. smoothing: the arms move fast (a light 3-tap filter keeps the rope slams), the rest a 5-tap mean takes the model's jitter out
const fast = new Set(['wristL', 'wristR', 'elbowL', 'elbowR']);
const smooth = filled.map((_, i) => HERO_POINTS.map((p, j) => {
  const taps = fast.has(p.name) ? [[-1, 1], [0, 2], [1, 1]] : [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1]];
  let x = 0, y = 0, w = 0;
  for (const [d, k] of taps) { const f = filled[Math.min(filled.length - 1, Math.max(0, i + d!))]!; x += f[j]!.x * k!; y += f[j]!.y * k!; w += k!; }
  return { x: x / w, y: y / w };
}));
// 4. per frame of the clip (the sample whose seek time shows that frame, not smoothed), or 15 frames a second; whole thousandths
const perFrame = (): P[][] => {
  const n = Math.floor(((raw.frames.length - 1) / raw.fps) * VIDEO_FPS + 1e-6) + 1;
  const out: P[][] = [];
  for (let k = 0; k < n; k += 1) {
    // the first sample at or after the frame's start time shows frame k (seeking to t shows the frame whose time is the last one at or before t)
    const i = Math.min(filled.length - 1, Math.ceil(((k + 0.02) / VIDEO_FPS) * raw.fps - 1e-6));
    out.push(filled[i]!);
  }
  return out;
};
const frames = VIDEO_FPS ? perFrame() : smooth.filter((_, i) => i % step === 0);
const q = (v: number): number => Math.max(-200, Math.min(1200, Math.round(v * 1000)));
const f = frames.flatMap((pts) => pts.flatMap((p) => [q(p.x), q(p.y)]));

// 5. the pops: the lowest point of each rep (a local maximum of y, the picture's y grows downwards), deep enough to be a rep; then
//    every pop at least --gap seconds after the one before, from --from seconds on.
const from = flag('from', 0.6);
const want = flag('pops', 6);
const gap = flag('gap', 1.3);
const beatArg = args.find((x) => x.startsWith('--beat='))?.slice(7) ?? 'hips';
const beats: { t: number; j: number; depth: number }[] = [];
const hipL = HERO_POINTS.findIndex((p) => p.name === 'hipL'), hipR = HERO_POINTS.findIndex((p) => p.name === 'hipR');
const series: { j: number; ys: number[] }[] = beatArg === 'wrists'
  ? (['wristL', 'wristR'] as const).map((name) => { const j = HERO_POINTS.findIndex((p) => p.name === name); return { j, ys: smooth.map((pts) => pts[j]!.y) }; })
  : [{ j: hipL, ys: smooth.map((pts) => (pts[hipL]!.y + pts[hipR]!.y) / 2) }];
for (const { j, ys } of series) {
  for (let i = 3; i < ys.length - 3; i += 1) {
    const y = ys[i]!;
    if (!(y >= ys[i - 1]! && y > ys[i + 1]!)) continue;
    const before = Math.min(...ys.slice(Math.max(0, i - 12), i)), after = Math.min(...ys.slice(i + 1, i + 13));
    const depth = Math.min(y - before, y - after);
    if (depth < (beatArg === 'wrists' ? 0.035 : 0.02)) continue;
    beats.push({ t: i / raw.fps, j, depth });
  }
  // hips: the top of each rep too (standing up from a squat, the height of a jump), so a slow set still scores every second or so
  if (beatArg !== 'wrists') {
    for (let i = 3; i < ys.length - 3; i += 1) {
      const y = ys[i]!;
      if (!(y <= ys[i - 1]! && y < ys[i + 1]!)) continue;
      const before = Math.max(...ys.slice(Math.max(0, i - 12), i)), after = Math.max(...ys.slice(i + 1, i + 13));
      if (Math.min(before - y, after - y) < 0.02) continue;
      beats.push({ t: i / raw.fps, j, depth: Math.min(before - y, after - y) });
    }
  }
}
beats.sort((a, b) => a.t - b.t);
const picked: typeof beats = [];
for (const b of beats) {
  if (b.t < from) continue;
  const last = picked[picked.length - 1];
  if (last && b.t - last.t < gap) continue;
  picked.push(b);
  if (picked.length >= want) break;
}
// a slow set (a squat every three seconds): the moment half way between two reps is the athlete standing up again, and scores too
const end = (raw.frames.length - 1) / raw.fps - 0.6;
for (let k = 0; k < picked.length && picked.length < want; k += 1) {
  const a = picked[k]!, b = picked[k + 1];
  const next = b ? b.t : a.t + (k > 0 ? a.t - picked[k - 1]!.t : 0);
  if (next - a.t >= 2 * gap && (a.t + next) / 2 <= end) { picked.splice(k + 1, 0, { t: (a.t + next) / 2, j: a.j, depth: 0 }); k += 1; }
}
// the sequence a round of a game gives: points, points, a combo, more points, a bigger combo, a perfect one
const KINDS: HeroPose['pops'][number][1][] = ['pts', 'pts', 'combo', 'pts', 'combo', 'perfect'];
const NUMS = [50, 50, 2, 100, 3, 0];
const pops: HeroPose['pops'] = picked.map((b, i) => [Math.round(b.t * 100) / 100, KINDS[i % KINDS.length]!, NUMS[i % NUMS.length]!, b.j]);

const out: HeroPose = { v: 1, fps: Math.round(OUT_FPS * 100000) / 100000, n: frames.length, aspect: Math.round(aspect * 10000) / 10000, f, pops };
writeFileSync(output, `${JSON.stringify(out)}\n`);
console.log(`${output}: ${frames.length} frames at ${OUT_FPS} fps, ${HERO_POINTS.length} points, ${beats.length} moments found, pops at ${pops.map((p) => p[0]).join(', ')} s, ${JSON.stringify(out).length} bytes`);
