// PoseService: MediaPipe Pose Landmarker in a module worker, with a main-thread fallback, fed by a camera lease
// (one inference per new camera frame, never two at once) or by a landmark source (traces, tests).
import type {
  FrameSource, Landmark, LoadProgress, PoseFrame, PoseLoadOptions, PoseLoadResult, PoseService, PoseStats, Unsubscribe,
} from '../types/index.ts';
import { allPoses, createLandmarker, unpackPoses } from './landmarker.ts';
import { LIGHT_COLS, LIGHT_EVERY_MS, LIGHT_ROWS, createLightMeter, toLightGrid } from './light-grid.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** `light`: the brightness cells of this picture (light-grid.ts), present only when asked for and measurable. */
export interface DetectResult { poses: Landmark[][]; inferenceMs: number; light?: Uint8Array }

/** One inference engine. The service owns exactly one at a time. */
export interface PoseBackend {
  readonly worker: boolean;
  load(o: { modelUrl: string; wasmBase: string; prefer: 'GPU' | 'CPU'; numPoses?: 1 | 2; onProgress?: (p: LoadProgress) => void; signal?: AbortSignal }): Promise<'GPU' | 'CPU'>;
  setNumPoses(n: 1 | 2): Promise<void>;
  /** One dummy inference; resolves with its duration in ms. */
  warmUp(): Promise<number>;
  /** Every person found in the current video frame, in the detector's order. */
  detect(video: HTMLVideoElement, ts: number, o?: { light?: boolean }): Promise<DetectResult>;
  dispose(): void;
}

const abortError = (): Error => Object.assign(new Error('Pose loading was cancelled.'), { name: 'AbortError' });

/** Runs the landmarker in a module worker; frames travel as transferred ImageBitmaps. */
export class WorkerBackend implements PoseBackend {
  readonly worker = true;
  private readonly w: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: DetectResult) => void; reject: (e: Error) => void }>();
  private onLoaded: ((m: FromWorker) => void) | null = null;
  private onWarm: ((ms: number) => void) | null = null;
  private onNumPoses: ((m: FromWorker) => void) | null = null;
  private progress: ((p: LoadProgress) => void) | undefined;
  private dead: Error | null = null;

  constructor(createWorker: () => Worker) {
    this.w = createWorker();
    this.w.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
    this.w.onerror = (e: ErrorEvent) => { e.preventDefault?.(); this.fail(new Error(`Pose worker failed: ${e.message || 'script error'}`)); };
    this.w.onmessageerror = () => this.fail(new Error('Pose worker sent an unreadable message.'));
  }

  private fail(err: Error): void {
    if (this.dead) return;
    this.dead = err;
    this.onLoaded?.({ type: 'error', message: err.message });
    this.onNumPoses?.({ type: 'error', message: err.message });
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private handle(m: FromWorker): void {
    if (m.type === 'progress') this.progress?.(m.p);
    else if (m.type === 'loaded') this.onLoaded?.(m);
    else if (m.type === 'warm') this.onWarm?.(m.ms);
    else if (m.type === 'numPosesSet') this.onNumPoses?.(m);
    else if (m.type === 'result') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      p.resolve({ poses: unpackPoses(m.poses), inferenceMs: m.ms, ...(m.light ? { light: m.light } : {}) });
    } else if (m.type === 'error') {
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.reject(new Error(m.message));
      } else if (this.onNumPoses) this.onNumPoses(m);
      else this.onLoaded?.(m);
    }
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void { this.w.postMessage(m, transfer); }

  load(o: Parameters<PoseBackend['load']>[0]): Promise<'GPU' | 'CPU'> {
    if (this.dead) return Promise.reject(this.dead);
    this.progress = o.onProgress;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => reject(abortError());
      o.signal?.addEventListener('abort', onAbort, { once: true });
      this.onLoaded = (m) => {
        this.onLoaded = null;
        o.signal?.removeEventListener('abort', onAbort);
        if (m.type === 'loaded') resolve(m.delegate); else reject(new Error(m.type === 'error' ? m.message : 'Pose worker did not load.'));
      };
      this.send({ type: 'load', wasmBase: absolute(o.wasmBase), modelUrl: absolute(o.modelUrl), prefer: o.prefer, numPoses: o.numPoses ?? 1 });
    });
  }

  setNumPoses(n: 1 | 2): Promise<void> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.onNumPoses = (m) => {
        this.onNumPoses = null;
        if (m.type === 'numPosesSet') resolve(); else reject(new Error(m.type === 'error' ? m.message : 'Pose worker did not switch.'));
      };
      this.send({ type: 'numPoses', n });
    });
  }

  warmUp(): Promise<number> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve) => { this.onWarm = (ms) => { this.onWarm = null; resolve(ms); }; this.send({ type: 'warmup' }); });
  }

  async detect(video: HTMLVideoElement, ts: number, o?: { light?: boolean }): Promise<DetectResult> {
    if (this.dead) throw this.dead;
    const bitmap = await createImageBitmap(video);
    if (this.dead) { bitmap.close(); throw this.dead; }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'frame', id, ts, bitmap, ...(o?.light ? { light: true } : {}) }, [bitmap]);
    });
  }

  dispose(): void {
    if (!this.dead) {
      try { this.send({ type: 'dispose' }); } catch { /* worker already gone */ }
    }
    this.fail(new Error('The pose service was disposed.'));
    this.w.terminate();
  }
}

/** Worker URLs resolve against the worker script, so pass absolute ones. */
function absolute(url: string): string {
  const base = (globalThis as { location?: { href: string } }).location?.href;
  return base ? new URL(url, base).href : url;
}

/** Runs the landmarker on the main thread (fallback when workers or OffscreenCanvas are missing). */
export class MainBackend implements PoseBackend {
  readonly worker = false;
  private lm: Awaited<ReturnType<typeof createLandmarker>>['landmarker'] | null = null;
  private lastTs = 0;
  private readonly meter = createLightMeter();

  async load(o: Parameters<PoseBackend['load']>[0]): Promise<'GPU' | 'CPU'> {
    const opts: Parameters<typeof createLandmarker>[0] = { wasmBase: o.wasmBase, modelUrl: o.modelUrl, prefer: o.prefer, useModule: false, numPoses: o.numPoses ?? 1 };
    if (o.onProgress) opts.onProgress = o.onProgress;
    if (o.signal) opts.signal = o.signal;
    const r = await createLandmarker(opts);
    this.lm = r.landmarker;
    return r.delegate;
  }

  private run(src: TexImageSource, ts: number): DetectResult {
    if (!this.lm) throw new Error('The pose model is not loaded.');
    const t = Math.max(ts, this.lastTs + 1);
    this.lastTs = t;
    const a = performance.now();
    const poses = allPoses(this.lm.detectForVideo(src, t));
    return { poses, inferenceMs: performance.now() - a };
  }

  async setNumPoses(n: 1 | 2): Promise<void> {
    if (!this.lm) throw new Error('The pose model is not loaded.');
    await this.lm.setOptions({ numPoses: n });
  }

  warmUp(): Promise<number> {
    const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(64, 64) : Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const ctx = (c as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (ctx) { ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 64, 64); }
    return Promise.resolve(this.run(c, performance.now()).inferenceMs);
  }

  detect(video: HTMLVideoElement, ts: number, o?: { light?: boolean }): Promise<DetectResult> {
    try {
      const r = this.run(video, ts);
      if (o?.light) {
        const light = this.meter.measure(video);
        if (light) r.light = light;
      }
      return Promise.resolve(r);
    } catch (e) { return Promise.reject(e); }
  }

  dispose(): void {
    try { this.lm?.close(); } catch { /* already closed */ }
    this.lm = null;
  }
}

export interface PoseServiceDeps {
  /** Makes the module worker (tests and tools can swap it). */
  createWorker?: () => Worker;
  /** Replaces MediaPipe entirely (unit tests). */
  createBackend?: (kind: 'worker' | 'main') => PoseBackend;
  /** Whether this browser can run the worker path (default: Worker, OffscreenCanvas and createImageBitmap exist). */
  workerSupported?: () => boolean;
}

const defaultWorker = (): Worker => new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module', name: 'pose' });

const canUseWorker = (): boolean => typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function';

type VideoWithCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime?: number; presentedFrames?: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export function createPoseService(deps: PoseServiceDeps = {}): PoseService & { readonly loaded: PoseLoadResult | null } {
  const listeners = new Set<(f: PoseFrame) => void>();
  let backend: PoseBackend | null = null;
  let loaded: PoseLoadResult | null = null;
  let disposed = false;
  let detachCurrent: (() => void) | null = null;
  let maxHz = Infinity;
  let numPoses: 1 | 2 = 1;
  const recent = { inference: [] as number[], delivered: [] as number[] };
  const counts = { frames: 0, dropped: 0, errors: 0 };

  const emit = (f: PoseFrame): void => {
    counts.frames++;
    const now = performance.now();
    recent.delivered.push(now);
    while (recent.delivered.length && (recent.delivered[0] as number) < now - 1000) recent.delivered.shift();
    if (f.source === 'camera') {
      recent.inference.push(f.inferenceMs);
      if (recent.inference.length > 120) recent.inference.shift();
    }
    for (const cb of [...listeners]) cb(f);
  };

  const makeBackend = (kind: 'worker' | 'main'): PoseBackend =>
    deps.createBackend ? deps.createBackend(kind) : kind === 'worker' ? new WorkerBackend(deps.createWorker ?? defaultWorker) : new MainBackend();

  function pumpVideo(video: VideoWithCallback): () => void {
    let active = true;
    let busy = false;
    let seq = -1;
    let lastMediaTime = -1;
    let lastStart = -Infinity;
    let lastLight = -Infinity;
    let handle: number | null = null;
    const hasRvfc = typeof video.requestVideoFrameCallback === 'function';

    const onFrame = (now: number, meta?: { mediaTime?: number; presentedFrames?: number }): void => {
      if (!active) return;
      schedule();
      const mediaTime = meta?.presentedFrames ?? meta?.mediaTime ?? video.currentTime;
      if (!hasRvfc && mediaTime === lastMediaTime) return;   // rAF fallback: same camera frame as last time
      lastMediaTime = mediaTime;
      if (video.readyState < 2) return;
      seq++;
      const minGap = Number.isFinite(maxHz) ? 1000 / maxHz : 0;
      if (busy || now - lastStart < minGap * 0.9) { counts.dropped++; return; }
      const b = backend;
      if (!b) return;
      busy = true;
      lastStart = now;
      // The brightness map rides on one frame in a few (about every 400 ms), for the calibration's light codes.
      const wantLight = now - lastLight >= LIGHT_EVERY_MS;
      if (wantLight) lastLight = now;
      const mySeq = seq;
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
      b.detect(video, now, wantLight ? { light: true } : undefined).then(
        (r) => {
          busy = false;
          if (!active) return;
          const frame: PoseFrame = { seq: mySeq, t: now, landmarks: r.poses[0] ?? null, inferenceMs: r.inferenceMs, source: 'camera', aspect };
          if (numPoses === 2) frame.poses = r.poses;
          if (r.light) frame.light = toLightGrid(r.light, LIGHT_COLS, LIGHT_ROWS);
          emit(frame);
        },
        () => { busy = false; counts.errors++; counts.dropped++; },
      );
    };
    const schedule = (): void => {
      if (!active) return;
      handle = hasRvfc ? (video.requestVideoFrameCallback as NonNullable<VideoWithCallback['requestVideoFrameCallback']>)(onFrame) : requestAnimationFrame((t) => onFrame(t));
    };
    schedule();
    return () => {
      active = false;
      if (handle !== null) {
        if (hasRvfc) video.cancelVideoFrameCallback?.(handle); else cancelAnimationFrame(handle);
      }
    };
  }

  const service: PoseService & { readonly loaded: PoseLoadResult | null } = {
    get loaded() { return loaded; },

    async load(o: PoseLoadOptions): Promise<PoseLoadResult> {
      if (disposed) throw new Error('The pose service was disposed.');
      if (loaded) return loaded;
      const t0 = performance.now();
      const mode = o.worker ?? 'auto';
      const supported = (deps.workerSupported ?? canUseWorker)();
      if (o.maxHz) maxHz = o.maxHz;
      numPoses = o.numPoses ?? 1;
      const args: Parameters<PoseBackend['load']>[0] = { modelUrl: o.modelUrl, wasmBase: o.wasmBase, prefer: o.prefer ?? 'GPU', numPoses };
      if (o.onProgress) args.onProgress = o.onProgress;
      if (o.signal) args.signal = o.signal;
      if (mode !== 'never' && supported) {
        const b = makeBackend('worker');
        try {
          const delegate = await b.load(args);
          backend = b;
          loaded = { delegate, worker: true, loadMs: performance.now() - t0 };
          return loaded;
        } catch (e) {
          b.dispose();
          if (mode === 'only' || (e instanceof Error && e.name === 'AbortError')) throw e;
          // Fall through to the main thread (e.g. a browser without WebGL in workers).
        }
      } else if (mode === 'only') {
        throw new Error('This browser cannot run the pose model in a worker.');
      }
      const b = makeBackend('main');
      try {
        const delegate = await b.load(args);
        backend = b;
        loaded = { delegate, worker: false, loadMs: performance.now() - t0 };
        return loaded;
      } catch (e) {
        b.dispose();
        throw e;
      }
    },

    async warmUp(): Promise<void> {
      if (!backend) throw new Error('Call load() before warmUp().');
      await backend.warmUp();
    },

    attach(src: FrameSource): void {
      if (disposed) throw new Error('The pose service was disposed.');
      service.detach();
      if (src.kind === 'landmarks') {
        let seq = -1;
        const off: Unsubscribe = src.onFrame((f) => {
          seq++;
          const frame: PoseFrame = { seq, t: f.t, landmarks: f.landmarks, inferenceMs: f.inferenceMs ?? 0, source: src.source, aspect: src.aspect };
          if (f.poses) frame.poses = f.poses;
          emit(frame);
        });
        detachCurrent = off;
      } else {
        if (!backend) throw new Error('Call load() before attaching a camera.');
        detachCurrent = pumpVideo(src.video as VideoWithCallback);
      }
    },

    detach(): void {
      detachCurrent?.();
      detachCurrent = null;
    },

    onFrame(cb: (f: PoseFrame) => void): Unsubscribe {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    setMaxHz(hz: number): void { maxHz = hz > 0 ? hz : Infinity; },

    async setNumPoses(n: 1 | 2): Promise<void> {
      if (!backend) { numPoses = n; return; }
      if (n === numPoses) return;
      await backend.setNumPoses(n);
      numPoses = n;
    },

    get stats(): PoseStats {
      const now = performance.now();
      const hz = recent.delivered.filter((t) => t >= now - 1000).length;
      const sorted = recent.inference.slice().sort((a, b) => a - b);
      const pct = (p: number): number => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number) : 0);
      return { hz, p50: pct(0.5), p95: pct(0.95), dropped: counts.dropped, frames: counts.frames };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      service.detach();
      backend?.dispose();
      backend = null;
      listeners.clear();
    },
  };
  return service;
}
