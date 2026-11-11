// The moving pictures at the top of the home page (packages/web/src/clips.ts HERO_*): a loop of each showcase game in play, made from
// the frames of tools/gfx-shots/clip.ts. Each loop is HERO_SECONDS of the game; its last FADE seconds dissolve into its first ones, so
// it plays round and round without a jump (the page changes slides on that loop, so a visitor sees the loop once, from its start).
// Each comes as AV1 in WebM and as H.264 in MP4: the 21:9 crop at 1280 and 2000 px wide (never enlarged: the capture is 2000
// wide) and the 4:3 crop at 960. Silent, each under its budget: the best quality (lowest CRF) that fits.
//
//   node design/tools/hero-clips.mjs <frames dir> [--only=<id>] [--ffmpeg=<path to ffmpeg>] [--work=<dir for the loop frames>]
//
// The files are written to design/art/clips; design/art/clips/hero-clips.report.json keeps what each file came to, and a file that is
// already in the report is not made again (delete its line to make it again).
//
// The frames used on 10 Nov 2026 (one browser, one clip after the other; the crops are the ones of the still frames,
// design/tools/hero-frames.mjs SHOWCASE_SHOTS; --warm is the game's own time before the first frame):
//   node tools/gfx-shots/clip.ts <dir> road-run --world=coast --size=2000x1125 --quality=high --warm=3000 --seconds=5.5   (-> road-run-coast)
//   node tools/gfx-shots/clip.ts <dir> road-run --size=2000x1125 --quality=high --warm=3000 --seconds=5.5                 (-> road-run, the alps)
//   node tools/gfx-shots/clip.ts <dir> road-run --world=city --size=2000x1125 --quality=high --warm=3000 --seconds=5.5    (-> road-run-city)
//   node tools/gfx-shots/clip.ts <dir> squat-flap --size=2000x1125 --warm=3000 --seconds=5.5 --pilot=ArrowUp:Squat --query=difficulty=easy
// and the phone crops of the Road Run frames, rendered 4:3 (the clip is 960x720: the frames are supersampled from 1280x960):
//   node tools/gfx-shots/clip.ts <dir>/m road-run --world=coast --size=1280x960 --quality=high --warm=3000 --seconds=5.5  (and the alps, the city)
// (the Squat Flap phone crop is cut from its 2000x1125 frames: the rect of the still frame's [380, 288, 1536, 1152] at 2000 px)
import path from 'node:path';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sharp } from './pw.mjs';

if (!sharp) throw new Error('sharp is needed (design/tools/pw.mjs SHARP_CANDIDATES)');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const frames = process.argv[2];
if (!frames) throw new Error('usage: node design/tools/hero-clips.mjs <frames dir> [--only=<id>] [--ffmpeg=<path>] [--work=<dir>]');
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const FFMPEG = opt('ffmpeg') ?? process.env.FFMPEG ?? 'ffmpeg';
const only = opt('only');
const work = path.resolve(opt('work') ?? path.join(frames, '_loop'));

const FPS = 30;
/** Same as packages/web/src/clips.ts: HERO_SECONDS, HERO_CLIP_WIDE, HERO_CLIP_PHONE. */
const LOOP = 5;
const FADE = 0.5;
const WIDE = [1280, 2000];
const PHONE = [960];
/** At most this many bytes per file, by crop and width (a clip is under 1.5 MB at its largest). */
const BUDGET = { wide: { 1280: 700_000, 2000: 1_500_000 }, phone: { 960: 600_000 } };
/** A clip whose picture needs more: the Alps road is grass from edge to edge, and at the common budget it came out at CRF 52 (AV1) /
 * 37 (H.264), smeared (11 Nov). Only the clip on the screen and the next are fetched, so one larger clip does not slow the page. */
const BUDGET_FOR = { alps: { wide: { 1280: 1_200_000, 2000: 2_600_000 }, phone: { 960: 950_000 } } };
const budgetOf = (id, crop, w) => BUDGET_FOR[id]?.[crop]?.[w] ?? BUDGET[crop][w];
/** The CRF the first try of each codec starts from; the search goes on from what it measures. */
const START = { av1: 38, h264: 28 };
const CRF_RANGE = { av1: [24, 60], h264: [18, 40] };

/**
 * Where the frames of each clip are: the folder tools/gfx-shots/clip.ts wrote (named <game>[-<world>]), the first frame used, and for
 * each crop its folder, the part of the frame it is (rect: [left, top, width, height] of the frame; for the wide crop y places the 21:9
 * window in the frame, 0 = top, 1 = bottom, as in hero-frames.mjs).
 */
export const HERO_SHOTS = {
  coast: { from: 0, wide: { dir: 'road-run-coast', y: 0.55 }, phone: { dir: 'm/road-run-coast' } },
  flap: { from: 0, wide: { dir: 'squat-flap', y: 1 }, phone: { dir: 'squat-flap', rect: [297, 225, 1200, 900] } },
  alps: { from: 0, wide: { dir: 'road-run', y: 0.4 }, phone: { dir: 'm/road-run' } },
  city: { from: 0, wide: { dir: 'road-run-city', y: 0.35 }, phone: { dir: 'm/road-run-city' } },
};

const out = path.join(repo, 'design', 'art', 'clips');
await mkdir(out, { recursive: true });
const reportFile = path.join(out, 'hero-clips.report.json');
const report = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, 'utf8')) : {};
const save = () => writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);

const even = (n) => n - (n % 2);
const heightOf = (crop, w) => even(Math.round(crop === 'wide' ? (w * 9) / 21 : (w * 3) / 4));

function encode(dir, codec, w, h, crf, file) {
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'l%04d.jpg')];
  const scale = ['-vf', `scale=${w}:${h}:flags=lanczos,format=yuv420p`, '-an'];
  const args = codec === 'av1'
    ? [...input, ...scale, '-c:v', 'libaom-av1', '-crf', String(crf), '-b:v', '0', '-cpu-used', '4', '-row-mt', '1', '-tile-columns', w >= 1920 ? '2' : '1', '-g', '300', '-f', 'webm', file]
    : [...input, ...scale, '-c:v', 'libx264', '-preset', 'slower', '-crf', String(crf), '-profile:v', 'high', '-level', w >= 1920 ? '5.0' : '4.0', '-g', '300', '-tag:v', 'avc1', '-movflags', '+faststart', '-f', 'mp4', file];
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
}

/**
 * The best (lowest) CRF whose file fits the budget, found by a few tries: size falls about 8% per CRF step, so each try aims at the
 * budget from the size the last one gave, inside the bracket of what is known to fit (that CRF and above) and not to fit (below).
 */
async function fit(dir, codec, w, h, budget, file) {
  const tried = new Map();
  const [lo, hi] = CRF_RANGE[codec];
  const size = async (crf) => {
    if (!tried.has(crf)) { encode(dir, codec, w, h, crf, file); tried.set(crf, (await stat(file)).size); }
    return tried.get(crf);
  };
  let crf = START[codec];
  let fits = Infinity;   // the lowest CRF that fit
  let over = -Infinity;  // the highest CRF that did not
  for (let n = 0; n < 8; n += 1) {
    const s = await size(crf);
    if (s <= budget) fits = Math.min(fits, crf); else over = Math.max(over, crf);
    if (fits <= over + 1) break;
    const est = crf + Math.round(Math.log(s / budget) / Math.log(1.08));
    let next = s <= budget ? Math.min(est, crf - 1) : Math.max(est, crf + 1);
    next = Math.min(Math.max(next, over + 1, lo), Math.min(fits - 1, hi));
    if (tried.has(next) || next === crf) break;
    crf = next;
  }
  if (fits === Infinity) throw new Error(`${path.basename(file)}: no CRF in ${lo}..${hi} fits ${budget} bytes (${[...tried].map(([c, s]) => `${c}:${s}`).join(' ')})`);
  // the file on disk is the last try: make the best one again when it was not
  if ((await stat(file)).size !== tried.get(fits)) encode(dir, codec, w, h, fits, file);
  return { crf: fits, bytes: (await stat(file)).size, tries: tried.size };
}

/** The frames of one crop of a clip, as the loop: LOOP seconds, the last FADE seconds dissolving into the first (written as JPEGs of the crop's own width). */
async function makeLoop(id, crop) {
  const spec = HERO_SHOTS[id];
  const c = spec[crop];
  const src = path.join(frames, c.dir);
  const names = (await readdir(src)).filter((f) => /^f\d{4}\.(jpg|png)$/.test(f)).sort();
  const L = Math.round(LOOP * FPS);
  const F = Math.round(FADE * FPS);
  if (names.length < spec.from + L + F) throw new Error(`${id} ${crop}: ${names.length} frames, ${spec.from + L + F} needed`);
  const meta = await sharp(path.join(src, names[0])).metadata();
  const [fw, fh] = [meta.width, meta.height];
  // the part of the frame this crop is
  let region;
  if (c.rect) region = { left: c.rect[0], top: c.rect[1], width: c.rect[2], height: c.rect[3] };
  else if (crop === 'wide') { const ch = Math.round((fw * 9) / 21); region = { left: 0, top: Math.round((fh - ch) * c.y), width: fw, height: ch }; }
  else region = { left: 0, top: 0, width: fw, height: fh };
  if (crop === 'wide' && Math.abs(region.width / region.height - 21 / 9) > 0.01) throw new Error(`${id} wide: the crop is ${region.width}x${region.height}, not 21:9`);
  if (crop === 'phone' && Math.abs(region.width / region.height - 4 / 3) > 0.01) throw new Error(`${id} phone: the crop is ${region.width}x${region.height}, not 4:3`);
  // the loop's own size: the crop's, but not above the largest size the page shows
  const top = crop === 'wide' ? WIDE[WIDE.length - 1] : PHONE[PHONE.length - 1];
  const [lw, lh] = region.width > top ? [top, heightOf(crop, top)] : [region.width, region.height];
  if (crop === 'wide' && region.width < top) throw new Error(`${id} wide: the capture is ${region.width} px wide, the largest clip is ${top}: a clip is never enlarged`);
  const dir = path.join(work, `${id}-${crop}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const raw = async (i) => sharp(path.join(src, names[spec.from + i])).extract(region).resize(lw, lh, { kernel: 'lanczos3', fit: 'fill' }).removeAlpha().raw().toBuffer();
  const jpg = (buf, file) => sharp(buf, { raw: { width: lw, height: lh, channels: 3 } }).jpeg({ quality: 97, chromaSubsampling: '4:4:4', mozjpeg: false }).toFile(file);
  // The loop: frames F .. L+F-1 of the stretch, where the last F of them dissolve into frames 0 .. F-1 (which come just before frame F).
  for (let j = 0; j < L; j += 1) {
    const file = path.join(dir, `l${String(j).padStart(4, '0')}.jpg`);
    let px = await raw(F + j);
    if (j >= L - F) {
      const k = j - (L - F);
      const a = (k + 1) / F;
      const head = await raw(k);
      const mixed = Buffer.allocUnsafe(px.length);
      for (let p = 0; p < px.length; p += 1) mixed[p] = Math.round(px[p] * (1 - a) + head[p] * a);
      px = mixed;
    }
    await jpg(px, file);
  }
  return { dir, width: lw };
}

for (const id of Object.keys(HERO_SHOTS)) {
  if (only && only !== id) continue;
  for (const crop of ['wide', 'phone']) {
    const widths = crop === 'wide' ? WIDE : PHONE;
    const todo = widths.flatMap((w) => ['av1', 'h264'].map((codec) => ({ w, codec, name: `hero-${id}${crop === 'phone' ? '-m' : ''}-${w}.${codec === 'av1' ? 'webm' : 'mp4'}` }))).filter((t) => !report[t.name]);
    if (todo.length === 0) { console.log(`${id} ${crop}: done`); continue; }
    const { dir } = await makeLoop(id, crop);
    for (const t of todo) {
      const file = path.join(out, t.name);
      const h = heightOf(crop, t.w);
      const r = await fit(dir, t.codec, t.w, h, budgetOf(id, crop, t.w), file);
      report[t.name] = { width: t.w, height: h, codec: t.codec, crf: r.crf, bytes: r.bytes, budget: budgetOf(id, crop, t.w) };
      await save();
      console.log(`${t.name} ${t.w}x${h} ${Math.round(r.bytes / 1024)} KB (crf ${r.crf}, ${r.tries} tries)`);
    }
    await rm(dir, { recursive: true, force: true });
  }
}
console.log('hero clips done');
