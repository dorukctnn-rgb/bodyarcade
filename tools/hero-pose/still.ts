// The page of tools/hero-pose/extract-still.ts: MediaPipe's pose landmarker in IMAGE mode, one frame of a clip at a time.
//
// Why IMAGE and not VIDEO (what the games and tools/trace-recorder use): in VIDEO mode the landmarker follows the person from one frame
// to the next and smooths the points over time, so on a fast move (a jumping lunge, a punch) the points trail the body by a frame or two.
// The games want that steadiness; a body line drawn over a known clip wants every frame read on its own.
//
// Each frame is drawn on a square canvas (the landmarker places the points of a picture that is not square a little off): the whole
// picture centred, or, given a region (`roi`), only the square round the person, so that a small figure (a wide shot, a clip with black
// sides) fills the model's view. The points are turned back into fractions of the clip's own picture here.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { POSE_MODEL, WASM_BASE } from '../../packages/core/pose/assets.ts';

let files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
let model: Uint8Array | null = null;

async function load(): Promise<void> {
  files = await FilesetResolver.forVisionTasks(WASM_BASE);
  model = new Uint8Array(await (await fetch(POSE_MODEL.url)).arrayBuffer());
}

/**
 * A landmarker for one clip (a new one each time: MediaPipe's graph does not take a picture of another size once it has output
 * segmentation masks). The outline is asked for only to score how well a body line sits on the body (extract-still.ts --mask).
 */
const landmarkerFor = (masks: boolean): Promise<PoseLandmarker> => PoseLandmarker.createFromOptions(files!, {
  baseOptions: { modelAssetBuffer: model!.slice(), delegate: 'CPU' },
  runningMode: 'IMAGE',
  numPoses: 1,
  minPoseDetectionConfidence: 0.3,
  minPosePresenceConfidence: 0.3,
  outputSegmentationMasks: masks,
});

const seek = (video: HTMLVideoElement, t: number): Promise<void> => new Promise((resolve, reject) => {
  const done = (): void => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); resolve(); };
  const fail = (): void => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); reject(new Error('seek failed')); };
  video.addEventListener('seeked', done);
  video.addEventListener('error', fail);
  video.currentTime = t;
});

/** A square of the clip's picture, in its pixels (it may reach past the picture's edges: that part is black). */
interface Roi { x: number; y: number; side: number }

/**
 * Frames of the clip: frame k is shown by seeking to the middle of its time ((k + 0.5) / fps), so the decoder cannot land on the frame
 * before or after it. `every`: one frame in that many (a quick first look). One entry per frame read: the 33 points as x, y, z,
 * visibility (x and y fractions of the clip's picture), or null.
 */
async function analyse(src: string, fps: number, frames: number, maskStep = 0, roi: Roi | null = null, every = 1): Promise<{ lm: (number[] | null)[]; masks: string[]; w: number; h: number }> {
  if (!files || !model) throw new Error('not loaded');
  const landmarker = await landmarkerFor(maskStep > 0);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error(`cannot open ${src}`)), { once: true });
  });
  const w = video.videoWidth, h = video.videoHeight;
  // the square that is read: the region round the person, or the whole picture centred
  const r: Roi = roi ?? { x: (w - Math.max(w, h)) / 2, y: (h - Math.max(w, h)) / 2, side: Math.max(w, h) };
  const S = 720;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d context');
  // the part of the picture inside the square, and where it goes on the canvas
  const ix = Math.max(0, r.x), iy = Math.max(0, r.y), iw = Math.min(w, r.x + r.side) - ix, ih = Math.min(h, r.y + r.side) - iy;
  const k2 = S / r.side;
  const out: (number[] | null)[] = [];
  const masks: string[] = [];
  for (let k = 0; k < frames; k += every) {
    await seek(video, Math.min(video.duration - 0.001, (k + 0.5) / fps));
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.drawImage(video, ix, iy, iw, ih, (ix - r.x) * k2, (iy - r.y) * k2, iw * k2, ih * k2);
    const res = landmarker.detect(canvas);
    const lm = res.landmarks[0];
    out.push(lm ? lm.flatMap((p) => [(r.x + p.x * r.side) / w, (r.y + p.y * r.side) / h, p.z, p.visibility ?? 0]) : null);
    // --mask: the outline at one pixel in maskStep of the clip's own picture, 0 to 255, base64 (row by row)
    const m = res.segmentationMasks?.[0];
    if (maskStep > 0) {
      const mw = Math.floor(w / maskStep), mh = Math.floor(h / maskStep);
      const bytes = new Uint8Array(mw * mh);
      if (m) {
        const a = m.getAsFloat32Array(), ms = m.width;
        for (let y = 0; y < mh; y += 1) for (let x = 0; x < mw; x += 1) {
          const u = (x * maskStep - r.x) / r.side, v = (y * maskStep - r.y) / r.side;
          if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
          bytes[y * mw + x] = Math.round(255 * (a[Math.floor(v * ms) * ms + Math.floor(u * ms)] ?? 0));
        }
      }
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      masks.push(btoa(bin));
    }
    for (const mm of res.segmentationMasks ?? []) mm.close();
  }
  landmarker.close();
  video.removeAttribute('src');
  video.load();
  return { lm: out, masks, w, h };
}

(window as unknown as { __still: unknown }).__still = { analyse };
load().then(() => { (window as unknown as { __stillReady: boolean }).__stillReady = true; }).catch((e: unknown) => { console.error(String(e)); });
