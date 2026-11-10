// The moving game tiles of the home page: a short loop of each redrawn game in play (packages/web/src/clips.ts), made from the frames
// of tools/gfx-shots/clip.ts. Each loop is LOOP seconds of the game; its last FADE seconds fade into its first ones, so it plays round
// and round without a jump. Each comes as AV1 in WebM and as H.264 in MP4 (a browser without AV1, Safari on most devices), at the
// tile's two sizes (400x300 and 800x600), silent, each under its budget: the best quality (lowest CRF) of the list that fits.
//
//   node design/tools/tile-clips.mjs <frames dir> [--only=<game>] [--ffmpeg=<path to ffmpeg>]
//
// The frames used on 10 Nov 2026 (one browser, one game after the other):
//   node tools/gfx-shots/clip.ts <dir> squat-flap --size=2560x1440 --rect=380,288,1536,1152 --warm=8000 --seconds=4.5 --press=ArrowUp:900
//   (the others: see CLIP_SHOTS below, the same rect as their tile in hero-frames.mjs TILE_SHOTS)
import path from 'node:path';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sharp } from './pw.mjs';

if (!sharp) throw new Error('sharp is needed (design/tools/pw.mjs SHARP_CANDIDATES)');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const frames = process.argv[2];
if (!frames) throw new Error('usage: node design/tools/tile-clips.mjs <frames dir> [--only=<game>] [--ffmpeg=<path>]');
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const FFMPEG = opt('ffmpeg') ?? process.env.FFMPEG ?? 'ffmpeg';
const only = opt('only');

const FPS = 30;
/** Seconds of the game in a loop, and of the fade from its end into its start. */
const LOOP = 4;
const FADE = 0.5;
/** The tile's two sizes (packages/web/src/clips.ts CLIP_WIDTHS). */
const SIZES = [[400, 300], [800, 600]];
/** At most this many bytes per file, by width. */
const BUDGET = { 400: 170_000, 800: 390_000 };
/** CRFs tried from the best quality down until a file fits its budget. */
const CRF = { av1: [30, 33, 36, 39, 42, 45, 48, 52], h264: [22, 24, 26, 28, 30, 32, 34] };

/**
 * The frames of each clip: the folder tools/gfx-shots/clip.ts wrote, and the first frame used (the most lively stretch of the
 * capture). The capture must hold LOOP + FADE seconds from there.
 */
export const CLIP_SHOTS = {
  'squat-flap': { dir: 'squat-flap', from: 0 },
  'road-run': { dir: 'road-run', from: 0 },
  'pose-wall': { dir: 'pose-wall', from: 0 },
  'star-catch': { dir: 'star-catch', from: 0 },
};

const out = path.join(repo, 'design', 'art', 'clips');
await mkdir(out, { recursive: true });

/** A frame as raw RGB at 800x600 (the larger size; the smaller is scaled from it by ffmpeg). */
async function rawFrame(file) {
  return sharp(file).resize(800, 600, { kernel: 'lanczos3', fit: 'cover' }).removeAlpha().raw().toBuffer();
}

function encode(list, codec, w, h, crf, file) {
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(list, 'l%04d.png')];
  const scale = ['-vf', `scale=${w}:${h}:flags=lanczos,format=yuv420p`, '-an'];
  const args = codec === 'av1'
    ? [...input, ...scale, '-c:v', 'libaom-av1', '-crf', String(crf), '-b:v', '0', '-cpu-used', '3', '-row-mt', '1', '-g', String(LOOP * FPS), '-f', 'webm', file]
    : [...input, ...scale, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(crf), '-profile:v', 'high', '-level', '3.1', '-g', String(LOOP * FPS), '-tag:v', 'avc1', '-movflags', '+faststart', '-f', 'mp4', file];
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
}

for (const [id, spec] of Object.entries(CLIP_SHOTS)) {
  if (only && only !== id) continue;
  const src = path.join(frames, spec.dir);
  const names = (await readdir(src)).filter((f) => /^f\d{4}\.(jpg|png)$/.test(f)).sort();
  const L = LOOP * FPS;
  const F = Math.round(FADE * FPS);
  if (names.length < spec.from + L + F) throw new Error(`${id}: ${names.length} frames, ${spec.from + L + F} needed`);
  const at = (i) => rawFrame(path.join(src, names[spec.from + i]));
  // The loop: frames F .. L+F-1 of the stretch, where the last F of them fade into frames 0 .. F-1 (which come just before frame F).
  const list = path.join(out, `.${id}-loop`);
  await rm(list, { recursive: true, force: true });
  await mkdir(list, { recursive: true });
  for (let j = 0; j < L; j += 1) {
    let px = await at(F + j);
    if (j >= L - F) {
      const k = j - (L - F);
      const a = (k + 1) / F;
      const head = await at(k);
      const mixed = Buffer.allocUnsafe(px.length);
      for (let p = 0; p < px.length; p += 1) mixed[p] = Math.round(px[p] * (1 - a) + head[p] * a);
      px = mixed;
    }
    await sharp(px, { raw: { width: 800, height: 600, channels: 3 } }).png({ compressionLevel: 1 }).toFile(path.join(list, `l${String(j).padStart(4, '0')}.png`));
  }
  const report = [];
  for (const [w, h] of SIZES) {
    for (const codec of ['av1', 'h264']) {
      const file = path.join(out, `${id}-${w}.${codec === 'av1' ? 'webm' : 'mp4'}`);
      let size = Infinity;
      let used = 0;
      for (const crf of CRF[codec]) {
        encode(list, codec, w, h, crf, file);
        size = (await stat(file)).size;
        used = crf;
        if (size <= BUDGET[w]) break;
      }
      if (size > BUDGET[w]) throw new Error(`${path.basename(file)}: ${size} bytes at the last CRF, over the budget of ${BUDGET[w]}`);
      report.push(`${path.basename(file)} ${Math.round(size / 1024)} KB (crf ${used})`);
    }
  }
  await rm(list, { recursive: true, force: true });
  console.log(`clip ${id}: ${report.join(', ')}`);
}
