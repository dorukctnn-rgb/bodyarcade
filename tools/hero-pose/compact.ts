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
const OUT_FPS = args.includes('--per-frame') ? raw.fps : VIDEO_FPS || 15;
const step = Math.round(raw.fps / 15);
// --all: every one of the 33 points (MediaPipe order) instead of the body line's 19, for a picture that shows all the points the model finds.
const ALL = args.includes('--all');
const ids = ALL ? Array.from({ length: 33 }, (_, i) => i) : HERO_POINTS.map((p) => p.mp);
// --per-frame: the trace has one pose per frame of the clip (extract-still.ts), so frame k is sample k and the clip's frames a second are the
// trace's. --smooth: a lag-free filter (the median of three frames, then 1-2-1 weights, centred, so it never trails a move); --loop: the clip
// plays round and round, so the filter wraps from the last frame to the first.
const PER_FRAME = args.includes('--per-frame');
const SMOOTH = args.includes('--smooth');
const LOOP = args.includes('--loop');

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
// --repair: a frame the model read wrong (the body jumps away from where it is in the frames round it, or swells or shrinks: it took a
// knee for a head, or a dumbbell for an arm) is not drawn as read: it is filled from the nearest good frames on each side. Judged by the
// trunk (the middle of the shoulders and hips, and its length) against the median of the four frames on each side.
const REPAIR = args.includes('--repair');
const nameIndex = (name: string): number => { const h = HERO_POINTS.findIndex((q) => q.name === name); return ALL ? HERO_POINTS[h]!.mp : h; };
const trunk = (f: P[]): { x: number; y: number; s: number } => {
  const [a, b, c, d] = ['shoulderL', 'shoulderR', 'hipL', 'hipR'].map((n) => f[nameIndex(n)]!) as [P, P, P, P];
  const sx = (a.x + b.x) / 2, sy = (a.y + b.y) / 2, hx = (c.x + d.x) / 2, hy = (c.y + d.y) / 2;
  return { x: (sx + hx) / 2, y: (sy + hy) / 2, s: Math.hypot(sx - hx, sy - hy) + Math.hypot(a.x - b.x, a.y - b.y) * 0.5 };
};
const median = (v: number[]): number => { const o = [...v].sort((m, n) => m - n); return o[Math.floor(o.length / 2)]!; };
let repairedFrames = 0;
if (REPAIR) {
  const n = filled.length;
  const tr = filled.map(trunk);
  const near = (k: number): number[] => [-4, -3, -2, -1, 1, 2, 3, 4].map((d) => k + d).filter((i) => args.includes('--loop') || (i >= 0 && i < n)).map((i) => (i + n) % n);
  const bad = tr.map((t, k) => {
    const nb = near(k).map((i) => tr[i]!);
    const mx = median(nb.map((q) => q.x)), my = median(nb.map((q) => q.y)), ms = median(nb.map((q) => q.s));
    return Math.hypot(t.x - mx, t.y - my) > 0.45 * ms || t.s / ms < 0.65 || t.s / ms > 1.5;
  });
  const good = bad.map((b) => !b);
  if (good.some(Boolean)) {
    for (let k = 0; k < n; k += 1) {
      if (good[k]) continue;
      let a = k, b = k, da = 0, db = 0;
      do { a = (a - 1 + n) % n; da += 1; } while (!good[a] && da < n);
      do { b = (b + 1) % n; db += 1; } while (!good[b] && db < n);
      const A = filled[a]!, B = filled[b]!, u = da / (da + db);
      filled[k] = A.map((q, j) => ({ x: q.x + (B[j]!.x - q.x) * u, y: q.y + (B[j]!.y - q.y) * u }));
      repairedFrames += 1;
    }
  }
}
// 3. smoothing: the arms move fast (a light 3-tap filter keeps the rope slams), the rest a 5-tap mean takes the model's jitter out
const fast = new Set(['wristL', 'wristR', 'elbowL', 'elbowR']);
const nameOf = (j: number): string => (ALL ? HERO_POINTS.find((p) => p.mp === j)?.name ?? `mp${j}` : HERO_POINTS[j]!.name);
const smooth = filled.map((_, i) => ids.map((_mp, j) => ({ name: nameOf(j) })).map((p, j) => {
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
// the lag-free filter of --smooth, per point and axis: median of 3, then 1-2-1 (the wrists only the median: they move fastest)
const at = <T,>(a: T[], i: number): T => a[LOOP ? (i + a.length) % a.length : Math.min(a.length - 1, Math.max(0, i))]!;
const lagFree = (src: P[][]): P[][] => {
  const med = src.map((_, i) => src[i]!.map((_p, j) => {
    const xs = [at(src, i - 1)[j]!.x, src[i]![j]!.x, at(src, i + 1)[j]!.x].sort((a, b) => a - b);
    const ys = [at(src, i - 1)[j]!.y, src[i]![j]!.y, at(src, i + 1)[j]!.y].sort((a, b) => a - b);
    return { x: xs[1]!, y: ys[1]! };
  }));
  return med.map((_, i) => med[i]!.map((p, j) => {
    if (/^wrist/.test(nameOf(j))) return p;
    const a = at(med, i - 1)[j]!, b = at(med, i + 1)[j]!;
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
  }));
};
const frames = PER_FRAME ? (SMOOTH ? lagFree(filled) : filled) : VIDEO_FPS ? perFrame() : smooth.filter((_, i) => i % step === 0);
const q = (v: number): number => Math.max(-200, Math.min(1200, Math.round(v * 1000)));
const f = frames.flatMap((pts) => pts.flatMap((p) => [q(p.x), q(p.y)]));

// 5. the pops: the lowest point of each rep (a local maximum of y, the picture's y grows downwards), deep enough to be a rep; then
//    every pop at least --gap seconds after the one before, from --from seconds on.
const from = flag('from', 0.6);
const want = flag('pops', 6);
const gap = flag('gap', 1.3);
const beatArg = args.find((x) => x.startsWith('--beat='))?.slice(7) ?? 'hips';
const beats: { t: number; j: number; depth: number }[] = [];
const idx = (name: string): number => { const h = HERO_POINTS.findIndex((p) => p.name === name); return ALL ? HERO_POINTS[h]!.mp : h; };
const hipL = idx('hipL'), hipR = idx('hipR');
const series: { j: number; ys: number[] }[] = beatArg === 'wrists'
  ? (['wristL', 'wristR'] as const).map((name) => { const j = idx(name); return { j, ys: smooth.map((pts) => pts[j]!.y) }; })
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

// --upper: the clip shows the upper body only; the page draws no leg (the model's guess of legs out of the picture is not drawn)
const out: HeroPose = { v: 1, fps: Math.round(OUT_FPS * 100000) / 100000, n: frames.length, aspect: Math.round(aspect * 10000) / 10000, f, pops, ...(ALL ? { k: 33 as const } : {}), ...(args.includes('--upper') ? { parts: 'upper' as const } : {}) };
writeFileSync(output, `${JSON.stringify(out)}\n`);
console.log(`${output}: ${frames.length} frames at ${OUT_FPS} fps, ${ids.length} points, ${repairedFrames} repaired, ${beats.length} moments found, pops at ${pops.map((p) => p[0]).join(', ')} s, ${JSON.stringify(out).length} bytes`);
