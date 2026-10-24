// Turns any local video into a file that Chromium can use as a fake camera (--use-file-for-fake-video-capture): MJPEG at a
// fixed size, with a short sync leader in front (white and black pictures of known lengths, see cam.ts) so the runner can
// find the exact moment the video starts. Writes <name>.mjpeg and <name>.sync.json.
//
//   node tools/fake-camera/convert.ts clip.mp4 [--out dir/camera.mjpeg] [--size 640x360] [--fps 30] [--from 2] [--to 14]
//        [--repeat 3] [--cover] [--mirror] [--no-leader] [--quality 4] [--input-fps 15]
//
// --size: the camera picture (default 640x360). The video is fitted inside it with black bars, or with --cover it fills
// the picture and the edges are cut. --fps: the rate the file is made for; Chromium plays an MJPEG file at 30 pictures per
// second when the machine keeps up (a starved machine plays it slower: the leader measures the real rate, see timeline.json),
// so 30 is the default and the video then plays at its own speed. --from/--to: seconds of the source to use. --repeat: the content is put in the file this many
// times after the leader, because Chromium plays the file again from the start (leader included) when it ends: a game that
// needs the video for 90 s from a 6 s clip wants --repeat 15. --mirror: flips left and right. --input-fps: the rate of a raw
// .mjpeg input (such a file carries none; ffmpeg would assume 25). --quality: ffmpeg mjpeg quality 2 (best) to 31, default 4.
import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ffmpegCommand, LEADER_FRAMES, LEADER_SEGMENTS, type SyncInfo } from './cam.ts';

const run = promisify(execFile);

export interface ConvertOptions {
  input: string;
  /** The .mjpeg to write; the sync file goes next to it. Default tools/fake-camera/out/<name>/camera.mjpeg. */
  out?: string;
  width?: number;
  height?: number;
  fps?: number;
  from?: number;
  to?: number;
  leader?: boolean;
  /** How many times the content follows the leader (default 1). */
  repeat?: number;
  fit?: 'contain' | 'cover';
  mirror?: boolean;
  quality?: number;
  /** The rate of a raw .mjpeg input (such a file carries none; ffmpeg would assume 25). */
  inputFps?: number;
}

export const outRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), 'out');

function ffprobeCommand(): string {
  const f = ffmpegCommand();
  return /ffmpeg(\.exe)?$/i.test(f) ? f.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')) : 'ffprobe';
}

/** Length of a video in seconds (0 when ffprobe cannot tell). */
export async function probeSeconds(file: string): Promise<number> {
  try {
    const { stdout } = await run(ffprobeCommand(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

/** The number of pictures in an MJPEG file (decodes it once; fast at camera sizes). */
export async function countFrames(file: string): Promise<number> {
  const { stdout } = await run(ffprobeCommand(), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', file], { maxBuffer: 1 << 20 });
  return Number(stdout.trim()) || 0;
}

type Base = { width: number; height: number; fps: number; quality: number; out: string };

/** The ffmpeg arguments for the content (exported for the tests). */
export function contentArgs(o: Base & { input: string; fit: 'contain' | 'cover'; mirror: boolean; from?: number; to?: number; inputFps?: number }): string[] {
  const { width: W, height: H, fps } = o;
  const fit = o.fit === 'cover'
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (o.from !== undefined && o.from > 0) args.push('-ss', String(o.from));
  if (o.to !== undefined) args.push('-t', String(Math.max(0.1, o.to - (o.from ?? 0))));
  if (o.inputFps) args.push('-framerate', String(o.inputFps));
  args.push('-i', o.input, '-an', '-vf', `${o.mirror ? 'hflip,' : ''}fps=${fps},${fit},setsar=1,format=yuvj420p`, '-fps_mode', 'cfr', '-r', String(fps), '-c:v', 'mjpeg', '-q:v', String(o.quality), '-f', 'mjpeg', o.out);
  return args;
}

/** The ffmpeg arguments for the leader: white, black, white, black pictures with exact frame counts. */
export function leaderArgs(o: Base): string[] {
  const size = `${o.width}x${o.height}`;
  const graph: string[] = [];
  const labels: string[] = [];
  LEADER_SEGMENTS.forEach((s, i) => {
    graph.push(`color=c=${s.white ? 'white' : 'black'}:s=${size}:r=${o.fps},trim=end_frame=${s.frames},setpts=PTS-STARTPTS,format=yuvj420p[l${i}]`);
    labels.push(`[l${i}]`);
  });
  graph.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[out]`);
  return ['-y', '-hide_banner', '-loglevel', 'error', '-filter_complex', graph.join(';'), '-map', '[out]', '-fps_mode', 'cfr', '-r', String(o.fps), '-c:v', 'mjpeg', '-q:v', String(o.quality), '-f', 'mjpeg', o.out];
}

export async function convertVideo(opts: ConvertOptions): Promise<{ file: string; syncFile: string; sync: SyncInfo }> {
  const input = resolve(opts.input);
  if (!existsSync(input)) throw new Error(`video not found: ${input}`);
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const fps = opts.fps ?? 30;
  const leader = opts.leader ?? true;
  const repeat = Math.max(1, Math.round(opts.repeat ?? 1));
  const quality = opts.quality ?? 4;
  const name = basename(input, extname(input)).replace(/[^a-z0-9._-]+/gi, '-');
  const file = resolve(opts.out ?? join(outRoot(), name, 'camera.mjpeg'));
  mkdirSync(dirname(file), { recursive: true });
  const total = await probeSeconds(input);
  const from = opts.from ?? 0;
  const to = opts.to ?? (total > 0 ? total : undefined);
  const base = { width, height, fps, quality };
  const contentFile = `${file}.content.tmp`;
  const leaderFile = `${file}.leader.tmp`;
  let contentFrames = 0;
  try {
    await run(ffmpegCommand(), contentArgs({ ...base, out: contentFile, input, fit: opts.fit ?? 'contain', mirror: opts.mirror ?? false, ...(opts.inputFps ? { inputFps: opts.inputFps } : {}), ...(from > 0 ? { from } : {}), ...(to !== undefined ? { to } : {}) }), { maxBuffer: 1 << 24 });
    contentFrames = await countFrames(contentFile);
    // An MJPEG file is its pictures one after the other, so the file is the leader's bytes and the content's bytes, repeated.
    if (leader) { await run(ffmpegCommand(), leaderArgs({ ...base, out: leaderFile }), { maxBuffer: 1 << 24 }); copyFileSync(leaderFile, file); } else writeFileSync(file, '');
    const content = readFileSync(contentFile);
    for (let i = 0; i < repeat; i++) appendFileSync(file, content);
  } finally {
    rmSync(contentFile, { force: true });
    rmSync(leaderFile, { force: true });
  }
  const leaderFrames = leader ? LEADER_FRAMES : 0;
  const sync: SyncInfo = {
    v: 1, source: input, width, height, fps, leaderFrames, contentFrames, contentSeconds: Math.round((contentFrames / fps) * 1000) / 1000, repeat,
    from, to: to ?? from + contentFrames / fps, mirrored: opts.mirror ?? false, fit: opts.fit ?? 'contain',
  };
  const syncFile = file.replace(/\.mjpeg$/i, '') + '.sync.json';
  writeFileSync(syncFile, JSON.stringify(sync, null, 1));
  return { file, syncFile, sync };
}

// ---- command line -------------------------------------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const input = args.find((a, i) => !a.startsWith('--') && !['--out', '--size', '--fps', '--from', '--to', '--quality', '--input-fps', '--repeat'].includes(args[i - 1] ?? ''));
  if (!input) {
    console.error('usage: node tools/fake-camera/convert.ts <video> [--out file.mjpeg] [--size 640x360] [--fps 30] [--from s] [--to s] [--repeat n] [--cover] [--mirror] [--no-leader] [--quality 4] [--input-fps 15]');
    process.exit(2);
  }
  const size = (opt('size') ?? '640x360').split('x').map(Number);
  try {
    const r = await convertVideo({
      input, ...(opt('out') ? { out: opt('out') as string } : {}), width: size[0] ?? 640, height: size[1] ?? 360, fps: Number(opt('fps') ?? 30),
      ...(opt('from') ? { from: Number(opt('from')) } : {}), ...(opt('to') ? { to: Number(opt('to')) } : {}), ...(opt('repeat') ? { repeat: Number(opt('repeat')) } : {}),
      leader: !args.includes('--no-leader'), fit: args.includes('--cover') ? 'cover' : 'contain', mirror: args.includes('--mirror'), ...(opt('quality') ? { quality: Number(opt('quality')) } : {}), ...(opt('input-fps') ? { inputFps: Number(opt('input-fps')) } : {}),
    });
    console.log(`${r.file}\n  ${r.sync.width}x${r.sync.height} at ${r.sync.fps} fps, ${r.sync.contentSeconds} s of content x ${r.sync.repeat}${r.sync.leaderFrames ? ` after a ${r.sync.leaderFrames}-frame sync leader` : ''}\n  ${r.syncFile}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
