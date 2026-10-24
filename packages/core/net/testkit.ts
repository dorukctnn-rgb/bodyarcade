// Test helpers for code that uses LiveClient without a browser: a scheduler whose time only moves when the test says, and a
// peer connection, a video track and a stream that the test drives by hand (what the network and the friend's camera do).
import type { Scheduler } from './runtime.ts';

interface Timer { id: number; at: number; fn: () => void }

export class ManualScheduler implements Scheduler {
  t = 1_000_000;
  private timers: Timer[] = [];
  private nextId = 1;

  now(): number { return this.t; }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  /** Moves time forward, running timers in order (timers they set inside the window run too). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (let guard = 0; guard < 1_000_000; guard++) {
      let next: Timer | undefined;
      for (const x of this.timers) if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }

  get pending(): number { return this.timers.length; }
}

/** A video track: muted until the first packet (`unmute()`), like a remote track in a browser. */
export class FakeVideoTrack {
  readonly kind = 'video';
  muted = true;
  readyState: 'live' | 'ended' = 'live';
  private readonly ls = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void { (this.ls.get(type) ?? this.ls.set(type, new Set()).get(type)!).add(fn); }
  removeEventListener(type: string, fn: () => void): void { this.ls.get(type)?.delete(fn); }
  private fire(type: string): void { for (const fn of [...(this.ls.get(type) ?? [])]) fn(); }
  unmute(): void { this.muted = false; this.fire('unmute'); }
  mute(): void { this.muted = true; this.fire('mute'); }
  end(): void { this.readyState = 'ended'; this.fire('ended'); }
  stop(): void { this.readyState = 'ended'; }
}

export class FakeMediaStream {
  private readonly tracks: FakeVideoTrack[];
  constructor(tracks: FakeVideoTrack[] = [new FakeVideoTrack()]) { this.tracks = tracks; }
  getVideoTracks(): FakeVideoTrack[] { return this.tracks; }
  getTracks(): FakeVideoTrack[] { return this.tracks; }
}

const fakeChannel = (label: string): Record<string, unknown> => ({ label, readyState: 'connecting', send: () => undefined, onmessage: null, onopen: null, onclose: null, onerror: null });

/** Enough of RTCPeerConnection for PeerLink: it never negotiates by itself; the test says when the network connects, fails, or the picture starts. */
export class FakePeerConnection {
  iceConnectionState = 'new';
  connectionState = 'new';
  signalingState = 'stable';
  localDescription: { type: string; sdp: string } | null = null;
  sctp = null;
  closed = false;
  restarts = 0;
  readonly cfg: RTCConfiguration;
  onicecandidate: unknown = null;
  ontrack: ((e: unknown) => void) | null = null;
  onnegotiationneeded: unknown = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(cfg: RTCConfiguration = {}) { this.cfg = cfg; }
  createDataChannel(label: string): Record<string, unknown> { return fakeChannel(label); }
  addTransceiver(): Record<string, unknown> { return { direction: 'sendrecv', sender: { getParameters: () => ({ encodings: [{}] }), setParameters: async () => undefined, replaceTrack: async () => undefined } }; }
  async setLocalDescription(): Promise<void> { this.localDescription = { type: 'offer', sdp: 'v=0' }; }
  async setRemoteDescription(): Promise<void> { /* nothing to negotiate */ }
  async addIceCandidate(): Promise<void> { /* ignored */ }
  restartIce(): void { this.restarts++; }
  close(): void { this.closed = true; this.iceConnectionState = 'closed'; }
  async getStats(): Promise<Map<string, unknown>> { return new Map(); }
  /** A path between the two devices was found. */
  connect(): void { this.iceConnectionState = 'connected'; this.connectionState = 'connected'; this.oniceconnectionstatechange?.(); this.onconnectionstatechange?.(); }
  /** The browser gave up on every path. */
  fail(): void { this.iceConnectionState = 'failed'; this.oniceconnectionstatechange?.(); }
  /** The friend's picture is negotiated; the returned track is muted until it is told to `unmute()` (the first packet). */
  receive(): FakeVideoTrack {
    const track = new FakeVideoTrack();
    const transceiver = { direction: 'recvonly', sender: { getParameters: () => ({ encodings: [{}] }), setParameters: async () => undefined, replaceTrack: async () => undefined } };
    this.ontrack?.({ track, streams: [new FakeMediaStream([track])], transceiver });
    return track;
  }
}
