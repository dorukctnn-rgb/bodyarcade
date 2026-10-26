// The highlight clip of a round: the last seconds of the game view, recorded on this device while the round is played, so that the
// results can offer it to be shared (TikTok, Instagram, a friend). Nothing leaves the device unless the player shares the file.
//
// A recorder cannot keep "the last ten seconds": a recording only grows. So two recorders take turns, each restarted when it has
// run SEGMENT_MS, the second one started STAGGER_MS after the first; when the round ends the one that has recorded longest is kept
// and the other thrown away, which gives a clip of STAGGER_MS to SEGMENT_MS that ends with the round, and none for a round shorter
// than MIN_CLIP_MS. The recording stops while the round is paused.
//
// A 2D stage is copied onto a canvas of its own several times a second, a WebGL stage (Road Run) at the moment its kit has drawn a frame; both
// copies have the same size (the stage's size on the screen, the long edge at most CLIP_MAX_EDGE) and carry the same score, time and name of the site.
//
// What is recorded is the stage's canvas and nothing else: the self view of the camera is a tile of the page, never in it. A mirror
// game draws the camera picture on its canvas itself, so it makes no clip at all (clipAllowed): the camera video is never recorded.
//
// Everything here is a nicety: a browser without a recorder, an encoder that fails or a canvas that changes its size gives no clip
// and no error to the round.

import { tapFrames } from '../../../core/render3d/frames.ts';

export interface ClipFile {
  blob: Blob;
  /** The type of the file, without codec details ("video/mp4"). */
  mime: string;
  ext: 'mp4' | 'webm';
  /** How long it is, in seconds. */
  seconds: number;
}

/**
 * Whether a round's last seconds are kept for a clip: the player's switch, a profile that may share at all (a child's does not), and
 * never for a mirror game: it draws the camera picture on its own canvas, and the camera video is promised never to be recorded or saved.
 */
export function clipAllowed(o: { clips: boolean; share: boolean; mirror: boolean }): boolean {
  return o.clips && o.share && !o.mirror;
}

export const SEGMENT_MS = 10_000;
export const STAGGER_MS = 5_000;
export const MIN_CLIP_MS = 3_000;
export const CLIP_FPS = 24;
/** The long edge of the clip in pixels: a phone screen at full resolution would cost the encoders more than a clip is worth. */
export const CLIP_MAX_EDGE = 960;
export const CLIP_BITS = 2_000_000;
/** The name of the site, in a corner of the picture of every clip. */
export const CLIP_BRAND = 'bodyarcade.com';

/** What the HUD shows at this moment, to be put on the picture of the clip: the score and the time, as the plates say them. */
export interface ClipOverlay { score: string; time: string }

/** The two minimal parts of a 2D context that the overlay is drawn with (tests give a stand-in). */
type Pen = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'measureText' | 'fillText' | 'beginPath' | 'fill'> & { roundRect?: CanvasRenderingContext2D['roundRect']; rect: CanvasRenderingContext2D['rect']; fillStyle: unknown; font: string; textBaseline: unknown; textAlign: unknown };

/** Draws the score at the top left, the time at the top right and the site's name at the bottom, on plates the colour of the HUD's. */
export function paintOverlay(c: Pen, w: number, h: number, o: ClipOverlay | null): void {
  const pad = Math.round(w * 0.04);
  const stack = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const plate = (text: string, px: number, anchor: 'left' | 'right' | 'center', y: number): void => {
    if (!text) return;
    c.font = `800 ${px}px ${stack}`;
    const textW = c.measureText(text).width;
    const padX = px * 0.5;
    const boxW = textW + padX * 2;
    const boxH = px * 1.5;
    const x = anchor === 'left' ? pad : anchor === 'right' ? w - pad - boxW : (w - boxW) / 2;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, boxW, boxH, boxH * 0.3); else c.rect(x, y, boxW, boxH);
    c.fillStyle = 'rgba(28, 20, 51, 0.72)';
    c.fill();
    c.fillStyle = '#F4F2F8';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText(text, x + padX, y + boxH / 2 + px * 0.04);
  };
  c.save();
  if (o) {
    const numeral = Math.max(14, w * 0.075);
    plate(o.score, numeral, 'left', pad);
    plate(o.time, numeral, 'right', pad);
  }
  plate(CLIP_BRAND, Math.max(11, w * 0.036), 'center', h - pad - Math.max(11, w * 0.036) * 1.5);
  c.restore();
}

/** What the browser can record, best first: MP4 is what the apps that take a shared clip like best. */
const KINDS: readonly { mime: string; ext: 'mp4' | 'webm' }[] = [
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

/**
 * The same for a WebGL stage, whose kit changes its drawing buffer when its quality steps (Road Run on a phone does so in its first seconds):
 * the picture that is recorded is a copy of a fixed size, but it is a copy of a buffer that changes. As avc1, H.264 keeps one description of
 * the picture for the whole file (Chromium says on the console that it must not change, when a recorder was given frames of two sizes);
 * as avc3 the description travels with the frames, so whatever the stage does to its buffer cannot break the file. Where avc3 is not
 * recorded the list goes on as for any canvas.
 */
const RESIZABLE_KINDS: readonly { mime: string; ext: 'mp4' | 'webm' }[] = [{ mime: 'video/mp4;codecs=avc3', ext: 'mp4' }, ...KINDS];

/** The shape of the browser's MediaRecorder that is used here (tests give a stand-in). */
export interface RecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
}
export interface RecorderCtor {
  new (stream: MediaStream, o: { mimeType: string; videoBitsPerSecond: number }): RecorderLike;
  isTypeSupported(mime: string): boolean;
}

export interface ClipDeps {
  Recorder: RecorderCtor;
  /** Milliseconds, from a clock tests can move. */
  now(): number;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(fn: () => void, ms: number): () => void;
  /** The picture the recorders take: the canvas, made smaller where it is big (null: this canvas cannot be recorded). */
  source(canvas: HTMLCanvasElement): ClipSource | null;
}

export interface ClipSource {
  stream: MediaStream;
  close(): void;
}

/**
 * The kind of file this browser makes, or null when it makes none (no recorder, or no way to take a picture of a canvas). `webgl`: the
 * stage is a WebGL one, whose buffer changes size during the round (RESIZABLE_KINDS).
 */
export function clipKind(win: Window & typeof globalThis, o: { webgl?: boolean } = {}): { mime: string; ext: 'mp4' | 'webm' } | null {
  const R = (win as unknown as { MediaRecorder?: RecorderCtor }).MediaRecorder;
  if (typeof R !== 'function' || typeof R.isTypeSupported !== 'function') return null;
  if (typeof (win.HTMLCanvasElement?.prototype as { captureStream?: unknown } | undefined)?.captureStream !== 'function') return null;
  for (const k of o.webgl === true ? RESIZABLE_KINDS : KINDS) {
    try { if (R.isTypeSupported(k.mime)) return k; } catch { /* a type this browser cannot even judge */ }
  }
  return null;
}

/** What is needed of a canvas to size the picture of a clip made from it. */
export interface CanvasSize { width: number; height: number; clientWidth: number; clientHeight: number }

/**
 * The size of the clip's picture: the size the stage has on the screen (times the screen's pixel ratio, at most 2), the long edge at most CLIP_MAX_EDGE,
 * both sides even. The canvas's own width and height are not the answer when the recorder starts: the kit gives a stage canvas its size on its first
 * resize, and Chromium starts the round before that (the canvas still has the 300 by 150 of a canvas nobody has sized: a clip of 300 by 150).
 * A canvas with no box on the screen (not laid out) is sized by its own width and height.
 */
export function clipSize(c: CanvasSize, pixelRatio = 1): { width: number; height: number } {
  const laidOut = c.clientWidth >= 2 && c.clientHeight >= 2;
  const ratio = laidOut ? Math.min(2, Math.max(1, pixelRatio)) : 1;
  const w = (laidOut ? c.clientWidth : c.width) * ratio;
  const h = (laidOut ? c.clientHeight : c.height) * ratio;
  const scale = Math.min(1, CLIP_MAX_EDGE / Math.max(w, h));
  return { width: Math.max(2, Math.round((w * scale) / 2) * 2), height: Math.max(2, Math.round((h * scale) / 2) * 2) };
}

/** The browser's own parts of a recorder: its MediaRecorder, its clock and timers, and a small copy of the canvas to record. */
export function browserDeps(win: Window & typeof globalThis, overlay?: () => ClipOverlay | null): ClipDeps | null {
  const Recorder = (win as unknown as { MediaRecorder?: RecorderCtor }).MediaRecorder;
  if (!Recorder) return null;
  const every = (fn: () => void, ms: number): (() => void) => { const id = win.setInterval(fn, ms); return () => win.clearInterval(id); };
  return {
    Recorder,
    now: () => win.performance.now(),
    every,
    source: (canvas) => {
      try {
        const doc = canvas.ownerDocument;
        const size = clipSize(canvas, win.devicePixelRatio || 1);
        if (Math.max(canvas.width, canvas.height, canvas.clientWidth) < 2) return null;
        const out = doc.createElement('canvas');
        out.width = size.width;
        out.height = size.height;
        const c = out.getContext('2d');
        if (!c) return null;
        const draw = (): void => {
          try {
            c.drawImage(canvas, 0, 0, out.width, out.height);
            paintOverlay(c, out.width, out.height, overlay?.() ?? null);
          } catch { /* a frame that could not be copied is skipped */ }
        };
        // A 2D canvas is copied smaller onto the canvas of its own several times a second (`getContext('2d')` hands back the same context it
        // already has). A WebGL canvas gives none (null), and its picture is gone once the browser has shown it: the copy is taken in the very
        // task in which the kit has drawn a frame (core/render3d/frames.ts), at the clip's rate, never on a timer (a copy on a timer is blank).
        const flat = canvas.getContext('2d');
        let stop: () => void;
        if (flat) {
          draw();
          stop = every(draw, 1000 / CLIP_FPS);
        } else {
          let last = Number.NEGATIVE_INFINITY;
          stop = tapFrames(canvas, () => {
            const now = win.performance.now();
            if (now - last < 1000 / CLIP_FPS - 3) return;   // 3 ms of slack, as the kit's own frame gate has
            last = now;
            draw();
          });
        }
        const stream = out.captureStream(CLIP_FPS);
        return { stream, close: () => { stop(); stream.getTracks().forEach((t) => t.stop()); } };
      } catch { return null; }
    },
  };
}

interface Slot {
  rec: RecorderLike;
  chunks: Blob[];
  /** Milliseconds this recorder has recorded (not counting a pause). */
  active: number;
}

export class ClipRecorder {
  private readonly deps: ClipDeps;
  private readonly kind: { mime: string; ext: 'mp4' | 'webm' };
  private source: ClipSource | null = null;
  private slots: Slot[] = [];
  private off: (() => void) | null = null;
  private last = 0;
  private running = false;
  private paused = false;
  private ended = false;
  /** Recorders that failed one after another: after a few the browser is not going to make this clip, and nothing more is tried. */
  private failed = 0;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, deps: ClipDeps, kind: { mime: string; ext: 'mp4' | 'webm' }) {
    this.canvas = canvas;
    this.deps = deps;
    this.kind = kind;
  }

  /** Starts taking turns. A canvas that cannot be recorded makes this do nothing. */
  start(): void {
    if (this.running || this.ended) return;
    this.source = this.deps.source(this.canvas);
    if (!this.source) { this.ended = true; return; }
    this.running = true;
    this.last = this.deps.now();
    this.open();
    this.off = this.deps.every(() => this.tick(), 200);
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.advance();
    this.paused = true;
    for (const s of this.slots) { try { if (s.rec.state === 'recording') s.rec.pause(); } catch { /* it is not recording */ } }
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.last = this.deps.now();
    for (const s of this.slots) { try { if (s.rec.state === 'paused') s.rec.resume(); } catch { /* it is not paused */ } }
  }

  /** The round is over: the clip of the last seconds, or null when there is none worth keeping. Everything is let go. */
  async finish(): Promise<ClipFile | null> {
    if (!this.running) { this.dispose(); return null; }
    this.advance();
    this.stopTicking();
    const slots = [...this.slots].sort((a, b) => b.active - a.active);
    this.slots = [];
    const best = slots[0];
    for (const s of slots.slice(1)) this.discard(s);
    let file: ClipFile | null = null;
    if (best && best.active >= MIN_CLIP_MS && best.rec.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => { best.rec.onstop = () => resolve(); best.rec.onerror = () => resolve(); });
      try {
        if (best.rec.state === 'paused') best.rec.resume();
        best.rec.stop();
        // A recorder that never says it stopped must not hold the results back.
        await Promise.race([stopped, new Promise<void>((resolve) => { const off = this.deps.every(() => { off(); resolve(); }, 1500); })]);
        const blob = new Blob(best.chunks, { type: this.kind.mime.split(';')[0] ?? 'video/webm' });
        if (blob.size > 0) file = { blob, mime: this.kind.mime.split(';')[0] ?? 'video/webm', ext: this.kind.ext, seconds: Math.round(Math.min(best.active, SEGMENT_MS) / 100) / 10 };
      } catch { file = null; }
    } else if (best) this.discard(best);
    this.release();
    return file;
  }

  /** Lets everything go without a clip (the round was left). */
  dispose(): void {
    this.stopTicking();
    for (const s of this.slots.splice(0)) this.discard(s);
    this.release();
  }

  // ---- the turns ------------------------------------------------------------------------------------------------------

  private open(): void {
    const src = this.source;
    if (!src) return;
    try {
      const rec = new this.deps.Recorder(src.stream, { mimeType: this.kind.mime, videoBitsPerSecond: CLIP_BITS });
      const slot: Slot = { rec, chunks: [], active: 0 };
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) slot.chunks.push(e.data); };
      rec.onerror = () => { this.failure(); this.drop(slot); };
      rec.start();
      if (this.paused) rec.pause();
      this.slots.push(slot);
    } catch { this.failure(); /* this recorder could not start: the other one, or none, carries on */ }
  }

  private failure(): void {
    if (++this.failed >= 5) this.dispose();
  }

  /** Time passes for every recorder that is recording. */
  private advance(): void {
    const now = this.deps.now();
    const dt = this.paused ? 0 : Math.max(0, now - this.last);
    this.last = now;
    for (const s of this.slots) s.active += dt;
  }

  private tick(): void {
    if (this.paused || this.ended) return;
    this.advance();
    // a recorder that has been going for a second has not failed
    if (this.slots.some((s) => s.active >= 1000)) this.failed = 0;
    // a recorder that has run its length is thrown away and starts again; the second one joins half a length after the first
    for (const s of [...this.slots]) {
      if (s.active >= SEGMENT_MS) { this.drop(s); this.open(); }
    }
    if (this.slots.length === 1 && (this.slots[0]?.active ?? 0) >= STAGGER_MS) this.open();
    if (this.slots.length === 0) this.open();
  }

  private drop(slot: Slot): void {
    this.slots = this.slots.filter((s) => s !== slot);
    this.discard(slot);
  }

  private discard(slot: Slot): void {
    slot.rec.ondataavailable = null;
    slot.rec.onstop = null;
    slot.rec.onerror = null;
    slot.chunks.length = 0;
    try { if (slot.rec.state !== 'inactive') slot.rec.stop(); } catch { /* it has stopped */ }
  }

  private stopTicking(): void {
    this.off?.();
    this.off = null;
  }

  private release(): void {
    this.running = false;
    this.ended = true;
    this.source?.close();
    this.source = null;
  }
}

/** A recorder for this canvas, or null where the browser makes no clips. */
export function createClipRecorder(win: Window & typeof globalThis, canvas: HTMLCanvasElement, overlay?: () => ClipOverlay | null): ClipRecorder | null {
  const kind = clipKind(win, { webgl: isWebGLStage(canvas) });
  const deps = browserDeps(win, overlay);
  if (!kind || !deps) return null;
  return new ClipRecorder(canvas, deps, kind);
}

/**
 * Whether this stage is a WebGL one: a canvas with no 2D context (a canvas has one kind of context for good, and `getContext('2d')` makes none
 * on a canvas that has another kind). The stage already has its context when a round starts. A canvas that cannot say is taken for a 2D one.
 */
export function isWebGLStage(canvas: Pick<HTMLCanvasElement, 'getContext'>): boolean {
  try { return canvas.getContext('2d') === null; } catch { return false; }
}
