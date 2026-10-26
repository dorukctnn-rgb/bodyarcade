// Fakes for camera tests in Node (no browser): tracks, streams, a controllable getUserMedia and a video element.
// They follow the browser rules that matter here: stop() ends a track WITHOUT an 'ended' event; the device going
// away (unplug(), revoke) ends it WITH one.

export class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  readonly kind = 'video';
  readonly label: string;
  stops = 0;
  private readonly settings: MediaTrackSettings;
  constructor(label = 'Fake camera', settings: MediaTrackSettings = { width: 640, height: 480, frameRate: 30, facingMode: 'user', deviceId: 'fake-1' }) {
    super();
    this.label = label;
    this.settings = settings;
  }
  stop(): void { this.stops++; this.readyState = 'ended'; }
  getSettings(): MediaTrackSettings { return { ...this.settings }; }
  /** The device disappeared (unplugged, permission revoked, taken by another app). */
  unplug(): void {
    if (this.readyState === 'ended') return;
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(n = 1) { this.tracks = Array.from({ length: n }, (_, i) => new FakeTrack(`Fake camera ${i + 1}`)); }
  getTracks(): FakeTrack[] { return this.tracks.slice(); }
  getVideoTracks(): FakeTrack[] { return this.tracks.slice(); }
}

export interface FakeGumOptions {
  /** Time the "permission prompt" stays open, ms. */
  delayMs?: number;
  /** Reject with an error of this name (NotAllowedError, NotFoundError, NotReadableError, ...). */
  failWith?: string;
  /** Tracks per stream. */
  tracks?: number;
}

/** A getUserMedia whose every stream is remembered, so tests can check that none is left live. */
export function fakeMediaDevices(o: FakeGumOptions = {}): {
  mediaDevices: { getUserMedia(c: MediaStreamConstraints): Promise<MediaStream> };
  streams: FakeStream[];
  calls: MediaStreamConstraints[];
  liveTracks(): number;
} {
  const streams: FakeStream[] = [];
  const calls: MediaStreamConstraints[] = [];
  return {
    streams,
    calls,
    liveTracks: () => streams.reduce((n, s) => n + s.tracks.filter((t) => t.readyState === 'live').length, 0),
    mediaDevices: {
      getUserMedia(c: MediaStreamConstraints): Promise<MediaStream> {
        calls.push(c);
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            if (o.failWith) {
              const e = new Error(`fake ${o.failWith}`);
              e.name = o.failWith;
              reject(e);
              return;
            }
            const s = new FakeStream(o.tracks ?? 1);
            streams.push(s);
            resolve(s as unknown as MediaStream);
          }, o.delayMs ?? 0);
        });
      },
    },
  };
}

/** Enough of HTMLVideoElement for CameraLease: srcObject, play/pause, readyState and 'loadeddata'. */
export class FakeVideo extends EventTarget {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  readyState = 0;
  paused = true;
  /** ms until the first frame after play(); null = never (a frozen camera). */
  private readonly firstFrameMs: number | null;
  constructor(firstFrameMs: number | null = 5) { super(); this.firstFrameMs = firstFrameMs; }
  setAttribute(): void { /* attributes are irrelevant here */ }
  play(): Promise<void> {
    this.paused = false;
    if (this.firstFrameMs !== null && this.readyState < 2) {
      setTimeout(() => {
        if (this.srcObject === null) return;
        this.readyState = 2;
        this.dispatchEvent(new Event('loadeddata'));
      }, this.firstFrameMs);
    }
    return Promise.resolve();
  }
  pause(): void { this.paused = true; }
}
