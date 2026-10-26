// CameraService: the only code that calls getUserMedia. Every stream belongs to exactly one CameraLease, and
// every lease is released by its owner. Fixes, by construction:
// - B9: aborting while the permission prompt is open rejects at once; a stream that arrives later is stopped.
// - B8: a track that ends (unplugged, revoked, taken) marks the lease dead and tells the owner; a dead lease is
//   never handed out again, so "Recalibrate" acquires a fresh one.
// - B10: release() stops every track and detaches the video, so the camera light goes off on the results screen.
import type {
  CameraAcquireOptions, CameraErrorCode, CameraFailure, CameraInfo, CameraLease, CameraService, Unsubscribe,
} from '../types/index.ts';

export class CameraError extends Error implements CameraFailure {
  override readonly name = 'CameraError' as const;
  readonly code: CameraErrorCode;
  constructor(code: CameraErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** The DOMException-like error acquire() rejects with when its signal fires. */
export function abortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const e = typeof DOMException === 'function' ? new DOMException('The camera request was cancelled.', 'AbortError') : Object.assign(new Error('The camera request was cancelled.'), { name: 'AbortError' });
  return e as Error;
}

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/** Maps getUserMedia failures to codes the UI can explain (B8 showed the wrong message). */
export function cameraErrorFrom(e: unknown, secure = true): CameraError {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError('denied', 'Camera permission was refused.', { cause: e });
    case 'SecurityError':
      return new CameraError(secure ? 'denied' : 'insecure', 'The browser blocked the camera on this page.', { cause: e });
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('not_found', 'No camera was found.', { cause: e });
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':   // getUserMedia's own AbortError (Firefox: "Starting videoinput failed"), not our signal
      return new CameraError('in_use', 'The camera could not be started. Another app may be using it.', { cause: e });
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraError('overconstrained', 'No camera matches the requested settings.', { cause: e });
    default:
      return new CameraError('unknown', `The camera failed: ${msg}`, { cause: e });
  }
}

/** Minimal shapes so tests can pass fakes; real browsers pass navigator.mediaDevices and document. */
export interface CameraDeps {
  mediaDevices?: { getUserMedia(c: MediaStreamConstraints): Promise<MediaStream> } | undefined;
  createVideo?: () => HTMLVideoElement;
  isSecureContext?: boolean;
  /** How long start() waits for the first frame (default 8000 ms). */
  startTimeoutMs?: number;
}

function constraints(o: CameraAcquireOptions): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: o.width ?? 640 },
    height: { ideal: o.height ?? 480 },
    frameRate: { ideal: o.frameRate ?? 30, max: Math.max(o.frameRate ?? 30, 30) },
  };
  if (o.deviceId) video.deviceId = { exact: o.deviceId };
  else video.facingMode = { ideal: o.facingMode ?? 'user' };
  return { audio: false, video };
}

function stopAll(stream: MediaStream): void {
  for (const t of stream.getTracks()) { try { t.stop(); } catch { /* already stopped */ } }
}

export function createCameraService(deps: CameraDeps = {}): CameraService {
  const counts = { acquired: 0, released: 0 };
  const g = globalThis as { navigator?: { mediaDevices?: CameraDeps['mediaDevices'] }; document?: Document; isSecureContext?: boolean };
  const md = (): CameraDeps['mediaDevices'] => ('mediaDevices' in deps ? deps.mediaDevices : g.navigator?.mediaDevices);
  const secure = deps.isSecureContext ?? g.isSecureContext ?? true;
  const createVideo = deps.createVideo ?? ((): HTMLVideoElement => {
    if (!g.document) throw new CameraError('unsupported', 'No document to create a video element in.');
    return g.document.createElement('video');
  });
  const startTimeoutMs = deps.startTimeoutMs ?? 8000;

  function makeLease(stream: MediaStream): CameraLease {
    const video = createVideo();
    video.muted = true;
    video.playsInline = true;
    video.setAttribute?.('playsinline', '');
    const tracks = stream.getTracks();
    const settings = (tracks[0]?.getSettings?.() ?? {}) as MediaTrackSettings;
    const info: CameraInfo = { width: settings.width ?? 0, height: settings.height ?? 0 };
    if (settings.frameRate !== undefined) info.frameRate = settings.frameRate;
    if (settings.facingMode !== undefined) info.facingMode = settings.facingMode;
    if (settings.deviceId !== undefined) info.deviceId = settings.deviceId;
    if (tracks[0]?.label) info.label = tracks[0].label;

    const endedCbs = new Set<() => void>();
    let released = false;
    let ended = false;
    let startAbort: (() => void) | null = null;

    const fireEnded = (): void => {
      if (ended || released) return;
      ended = true;
      for (const cb of [...endedCbs]) { try { cb(); } catch (e) { queueMicrotask(() => { throw e; }); } }
    };
    const onTrackEnded = (): void => fireEnded();
    for (const t of tracks) t.addEventListener('ended', onTrackEnded);
    if (tracks.length === 0 || tracks.some((t) => t.readyState === 'ended')) queueMicrotask(fireEnded);

    const lease: CameraLease = {
      kind: 'video',
      video,
      stream,
      info,
      get alive() { return !released && !ended && tracks.every((t) => t.readyState !== 'ended'); },
      start(): Promise<void> {
        if (released) return Promise.reject(abortError());
        if (video.srcObject !== stream) video.srcObject = stream;
        return new Promise<void>((resolve, reject) => {
          let done = false;
          const finish = (err?: unknown): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener('loadeddata', onData);
            startAbort = null;
            if (err === undefined) resolve(); else reject(err);
          };
          const onData = (): void => finish();
          const timer = setTimeout(() => finish(new CameraError('no_frames', 'The camera started but sent no picture.')), startTimeoutMs);
          startAbort = () => finish(abortError());
          video.addEventListener('loadeddata', onData);
          const p = video.play?.();
          if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay rules: frames still arrive for muted video */ });
          if (video.readyState >= 2) finish();
        });
      },
      stop(): void {
        try { video.pause(); } catch { /* not playing */ }
      },
      release(): void {
        if (released) return;
        released = true;
        counts.released++;
        for (const t of tracks) t.removeEventListener('ended', onTrackEnded);
        stopAll(stream);
        try { video.pause(); } catch { /* not playing */ }
        video.srcObject = null;
        endedCbs.clear();
        startAbort?.();
      },
      onEnded(cb): Unsubscribe {
        if (released) return () => {};
        endedCbs.add(cb);
        if (ended) queueMicrotask(() => { if (endedCbs.has(cb)) cb(); });
        return () => { endedCbs.delete(cb); };
      },
    };
    return lease;
  }

  return {
    acquire(o: CameraAcquireOptions = {}): Promise<CameraLease> {
      const signal = o.signal;
      if (signal?.aborted) return Promise.reject(abortError(signal.reason));
      const devices = md();
      if (!devices || typeof devices.getUserMedia !== 'function') {
        return Promise.reject(secure
          ? new CameraError('unsupported', 'This browser cannot use a camera.')
          : new CameraError('insecure', 'The camera needs a secure (https) page.'));
      }
      return new Promise<CameraLease>((resolve, reject) => {
        let settled = false;
        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          reject(abortError(signal?.reason));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        let pending: Promise<MediaStream>;
        try { pending = devices.getUserMedia(constraints(o)); } catch (e) { pending = Promise.reject(e); }
        pending.then(
          (stream) => {
            signal?.removeEventListener('abort', onAbort);
            if (settled) { stopAll(stream); return; }   // B9: the caller left; never leave a live track behind
            settled = true;
            try {
              const lease = makeLease(stream);
              counts.acquired++;
              resolve(lease);
            } catch (e) {
              stopAll(stream);
              reject(e instanceof CameraError ? e : cameraErrorFrom(e, secure));
            }
          },
          (e: unknown) => {
            signal?.removeEventListener('abort', onAbort);
            if (settled) return;
            settled = true;
            reject(cameraErrorFrom(e, secure));
          },
        );
      });
    },
    stats() {
      return { acquired: counts.acquired, released: counts.released, live: counts.acquired - counts.released };
    },
  };
}
