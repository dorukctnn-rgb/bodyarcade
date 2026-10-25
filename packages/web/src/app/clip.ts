// The highlight clip of a round: the last seconds of the game view, recorded on this device while the round is played, so that the
// results can offer it to be shared (TikTok, Instagram, a friend). Nothing leaves the device unless the player shares the file.
//
// A recorder cannot keep "the last ten seconds": a recording only grows. So two recorders take turns, each restarted when it has
// run SEGMENT_MS, the second one started STAGGER_MS after the first; when the round ends the one that has recorded longest is kept
// and the other thrown away, which gives a clip of STAGGER_MS to SEGMENT_MS that ends with the round, and none for a round shorter
// than MIN_CLIP_MS. The recording stops while the round is paused.
//
// What is recorded is the stage's canvas and nothing else: the self view of the camera is a tile of the page, never in it. A mirror
// game draws the camera picture on its canvas itself, so its clip has the picture in it: the shell only makes one when the player
// allowed that (the settings), and says so under the clip.
//
// Everything here is a nicety: a browser without a recorder, an encoder that fails or a canvas that changes its size gives no clip
// and no error to the round.

export interface ClipFile {
  blob: Blob;
  /** The type of the file, without codec details ("video/mp4"). */
  mime: string;
  ext: 'mp4' | 'webm';
  /** How long it is, in seconds. */
  seconds: number;
}

/**
 * Whether a round's last seconds are kept for a clip: the player's switch, a profile that may share at all (a child's does not),
 * and, for a mirror game, only when the camera picture in its game view is allowed in a clip.
 */
export function clipAllowed(o: { clips: boolean; clipCamera: boolean; share: boolean; mirror: boolean }): boolean {
  return o.clips && o.share && (!o.mirror || o.clipCamera);
}

export const SEGMENT_MS = 10_000;
export const STAGGER_MS = 5_000;
export const MIN_CLIP_MS = 3_000;
export const CLIP_FPS = 24;
/** The long edge of the clip in pixels: a phone screen at full resolution would cost the encoders more than a clip is worth. */
export const CLIP_MAX_EDGE = 960;
export const CLIP_BITS = 2_000_000;

/** What the browser can record, best first: MP4 is what the apps that take a shared clip like best. */
const KINDS: readonly { mime: string; ext: 'mp4' | 'webm' }[] = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

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

/** The kind of file this browser makes, or null when it makes none (no recorder, or no way to take a picture of a canvas). */
export function clipKind(win: Window & typeof globalThis): { mime: string; ext: 'mp4' | 'webm' } | null {
  const R = (win as unknown as { MediaRecorder?: RecorderCtor }).MediaRecorder;
  if (typeof R !== 'function' || typeof R.isTypeSupported !== 'function') return null;
  if (typeof (win.HTMLCanvasElement?.prototype as { captureStream?: unknown } | undefined)?.captureStream !== 'function') return null;
  for (const k of KINDS) {
    try { if (R.isTypeSupported(k.mime)) return k; } catch { /* a type this browser cannot even judge */ }
  }
  return null;
}

/** The browser's own parts of a recorder: its MediaRecorder, its clock and timers, and a small copy of the canvas to record. */
export function browserDeps(win: Window & typeof globalThis): ClipDeps | null {
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
        const edge = Math.max(canvas.width, canvas.height);
        if (edge < 2) return null;
        // A 2D canvas is copied smaller onto a canvas of its own several times a second (and `getContext('2d')` hands back the same
        // context it already has). A WebGL canvas gives none (null), and is recorded as it is: its own picture is already sized by its kit.
        const flat = canvas.getContext('2d');
        if (!flat) {
          const stream = canvas.captureStream(CLIP_FPS);
          return { stream, close: () => stream.getTracks().forEach((t) => t.stop()) };
        }
        const scale = Math.min(1, CLIP_MAX_EDGE / edge);
        const out = doc.createElement('canvas');
        out.width = Math.max(2, Math.round((canvas.width * scale) / 2) * 2);
        out.height = Math.max(2, Math.round((canvas.height * scale) / 2) * 2);
        const c = out.getContext('2d');
        if (!c) return null;
        const draw = (): void => { try { c.drawImage(canvas, 0, 0, out.width, out.height); } catch { /* a frame that could not be copied is skipped */ } };
        draw();
        const stop = every(draw, 1000 / CLIP_FPS);
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
export function createClipRecorder(win: Window & typeof globalThis, canvas: HTMLCanvasElement): ClipRecorder | null {
  const kind = clipKind(win);
  const deps = browserDeps(win);
  if (!kind || !deps) return null;
  return new ClipRecorder(canvas, deps, kind);
}
