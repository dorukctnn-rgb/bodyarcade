// Shared pieces of the fake-camera tools: the sync leader that convert.ts puts in front of a video, the script that
// the runner injects into the page to see when the video starts, and the maths that turns what the page saw into
// "video time zero on the page clock". No browser or ffmpeg is needed to import this file.

/**
 * The leader: white, black, white, black pictures of different lengths (in frames) in front of the content. The lengths
 * differ so that the pattern fits the observed pictures at exactly one start time, even when the first frames are lost
 * or the page sees the stream a few frames late.
 */
export const LEADER_SEGMENTS: readonly { white: boolean; frames: number }[] = [
  { white: true, frames: 6 },
  { white: false, frames: 9 },
  { white: true, frames: 12 },
  { white: false, frames: 15 },
];
export const LEADER_FRAMES: number = LEADER_SEGMENTS.reduce((n, s) => n + s.frames, 0);

/** Brightness the leader shows in frame f (true = white). */
export function leaderWhiteAt(f: number): boolean {
  let at = 0;
  for (const s of LEADER_SEGMENTS) {
    if (f < at + s.frames) return s.white;
    at += s.frames;
  }
  return false;
}

/** What convert.ts writes next to the converted video. */
export interface SyncInfo {
  /** Format version. */
  v: 1;
  source: string;
  /** Picture size and the rate the file was made for. */
  width: number;
  height: number;
  fps: number;
  /** Frames of the sync leader at the start of the file (0 without a leader); the content starts at this frame. */
  leaderFrames: number;
  /** Frames of the content and its length in seconds (without the leader). */
  contentFrames: number;
  contentSeconds: number;
  /** How many times the content follows the leader in the file. */
  repeat: number;
  /** Seconds of the source that were used. */
  from: number;
  to: number;
  mirrored: boolean;
  fit: 'contain' | 'cover';
}

/** One look at the camera picture in the page: when (page clock, ms) and how bright (0 to 1). */
export type Sample = readonly [t: number, lum: number];

export interface StartFound {
  /** Page clock (performance.now, ms) at which frame 0 of the file was shown. */
  t0: number;
  /** Observed pictures that agree with the leader at that start, and those that do not. */
  agree: number;
  disagree: number;
  /** Frames per second the stream really played at: the rate the file was made for unless the pictures only fit another. */
  playbackFps: number;
}

const RATES = [30, 15, 25, 24, 60, 20, 10, 50];

interface Fit { t0: number; agree: number; disagree: number; white: number; black: number; changes: number }

function scoreStart(samples: readonly Sample[], fps: number, leaderFrames: number): Fit | null {
  const first = samples[0]?.[0] ?? 0;
  const len = (leaderFrames / fps) * 1000;
  // The leader began before the first look (a few frames earlier at most) or right at it.
  const from = Math.floor(first - len - 120);
  const to = Math.ceil(first + 120);
  const at = (t0: number): Fit => {
    let agree = 0;
    let disagree = 0;
    let white = 0;
    let black = 0;
    let changes = 0;
    let prev: boolean | null = null;
    for (const [t, lum] of samples) {
      const f = Math.floor(((t - t0) / 1000) * fps);
      if (f < 0 || f >= leaderFrames) continue;
      const w = lum > 0.5;
      if (w === leaderWhiteAt(f)) { agree++; if (w) white++; else black++; if (prev !== null && prev !== w) changes++; prev = w; } else disagree++;
    }
    return { t0, agree, disagree, white, black, changes };
  };
  const score = (r: Fit): number => r.agree - 2 * r.disagree;
  // The latest start that fits best: the looks are taken at the moments the pictures were captured, so the true start
  // is the late end of the range of starts that give the same fit.
  let best: Fit | null = null;
  for (let t0 = from; t0 <= to; t0 += 1) {
    const r = at(t0);
    if (!best || score(r) >= score(best)) best = r;
  }
  return best;
}

/**
 * Finds the time at which the leader began, from what the page saw. Every candidate start is scored by how many looks
 * agree with the leader pattern (and how many do not); the best wins. The rate the file was made for is tried first, then
 * the usual others (a player may run a file at its own rate); the rate that explains the looks best wins. Both colours must
 * be seen, with a change between them, or it is not the leader. A stream seen only after the leader is over, or a file
 * without a leader, gives null.
 */
export function findStart(samples: readonly Sample[], fps: number, leaderFrames = LEADER_FRAMES): StartFound | null {
  if (leaderFrames <= 0 || samples.length < 8) return null;
  let best: StartFound | null = null;
  for (const rate of [fps, ...RATES.filter((r) => r !== fps)]) {
    const r = scoreStart(samples, rate, leaderFrames);
    if (!r || r.agree < 8 || r.disagree > r.agree / 10 || r.white < 3 || r.black < 3 || r.changes < 2) continue;
    // The rate that explains the looks best; the rate the file was made for wins a tie.
    if (!best || r.agree - 2 * r.disagree > best.agree - 2 * best.disagree) best = { t0: r.t0, agree: r.agree, disagree: r.disagree, playbackFps: rate };
  }
  return best;
}

/** The newest ffmpeg: FFMPEG_PATH, then the one on the PATH. */
export function ffmpegCommand(): string {
  return process.env['FFMPEG_PATH'] || 'ffmpeg';
}

// ---- the page side ------------------------------------------------------------------------------------------------------

/**
 * The script the runner adds to every page before it loads. It (1) makes the page's random numbers repeatable when a seed
 * is given (the seed of a round comes from crypto.getRandomValues and Math.random), and (2) watches every camera stream
 * the page opens: when it started and how bright its first pictures were, to find the start of the video. The look is
 * taken from a second hidden video that shows the same track, so the game sees the stream exactly as it would without the runner.
 */
export function pageScript(o: { seed: number | null; lookFrames: number }): string {
  return `(() => {
  const seed = ${o.seed === null ? 'null' : String(o.seed >>> 0)};
  if (seed !== null) {
    // mulberry32: a small generator with a fixed sequence for a given seed.
    let a = seed >>> 0;
    const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    Math.random = next;
    const orig = crypto.getRandomValues.bind(crypto);
    let rounds = 0;
    crypto.getRandomValues = function (arr) {
      // The seed of a round is read as one 32-bit number; the k-th round gets seed + k, so a rematch differs but a rerun repeats.
      if (arr instanceof Uint32Array && arr.length === 1) { arr[0] = (seed + rounds++) >>> 0; return arr; }
      return orig(arr);
    };
  }
  const state = window.__fakeCam = { streams: [], errors: [] };
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const getUserMedia = md.getUserMedia.bind(md);
  md.getUserMedia = async function (constraints) {
    const stream = await getUserMedia(constraints);
    try {
      const track = stream.getVideoTracks()[0];
      if (track) {
        const rec = { openedAt: performance.now(), timeOrigin: performance.timeOrigin, label: track.label, settings: track.getSettings(), samples: [] };
        state.streams.push(rec);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        video.style.cssText = 'position:fixed;left:-8px;top:-8px;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
        // The same track in a second stream: no clone, because stopping a clone of a camera track can end the camera for the game.
        video.srcObject = new MediaStream([track]);
        const canvas = document.createElement('canvas');
        canvas.width = 8; canvas.height = 8;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        let n = 0;
        const look = (now, meta) => {
          try {
            g.drawImage(video, 0, 0, 8, 8);
            const d = g.getImageData(0, 0, 8, 8).data;
            let s = 0;
            for (let i = 0; i < d.length; i += 4) s += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            const t = (meta && (meta.captureTime || meta.presentationTime)) || now;
            rec.samples.push([t, s / 64 / 255]);
          } catch (e) { state.errors.push(String(e)); }
          if (++n < ${o.lookFrames}) video.requestVideoFrameCallback(look);
          else { video.srcObject = null; video.remove(); }
        };
        (document.documentElement || document).appendChild(video);
        video.requestVideoFrameCallback(look);
        video.play().catch((e) => state.errors.push('play: ' + e));
      }
    } catch (e) { state.errors.push(String(e)); }
    return stream;
  };
})();`;
}

/** What pageScript leaves in window.__fakeCam. */
export interface PageCam {
  streams: { openedAt: number; timeOrigin: number; label: string; settings: Record<string, unknown>; samples: [number, number][] }[];
  errors: string[];
}
