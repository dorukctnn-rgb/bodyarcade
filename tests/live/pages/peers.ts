// The peer layer of live play on whatever engine runs this page (Chromium, Firefox, WebKit), with no Worker and no real camera: two
// PeerLinks (packages/core/net/peer.ts, the code the match uses) in one page, their signals handed to each other, a canvas as the camera.
// It answers the questions a Safari or a Firefox player raises: does the negotiated state channel (ordered: false, maxRetransmits: 0) open,
// do messages cross it both ways, does the friend's picture arrive and start, does an ICE restart keep the channel, does the connection report
// its path. `window.__run()` resolves with what happened; the spec (tests/live/engines.spec.ts) judges it.
import { PeerLink, DEFAULT_VIDEO_LIMITS, type PeerHost, type PeerMetrics } from '../../../packages/core/net/peer.ts';
import type { SeatId, SignalData } from '../../../packages/core/types/net.ts';

const logEl = document.getElementById('log') as HTMLElement;
const t0 = performance.now();
const stamp = (): string => ((performance.now() - t0) / 1000).toFixed(2);

interface Side {
  name: string;
  host: PeerHost;
  link: PeerLink | null;
  states: string[];
  ctrl: string[];
  tracks: { kind: string; muted: boolean }[];
  frames: number;
  unmutedAtMs: number | null;
  signals: number;
}

function makeSide(name: string, me: SeatId, sess: string, stream: MediaStream | null, log: string[], deliver: (to: Side, d: SignalData) => void, other: () => Side): Side {
  const metrics: PeerMetrics = { iceRestarts: 0, hardResets: 0, connectMs: [], pathTypes: [], lastReset: 0 };
  const s: Side = {
    name, link: null, states: [], ctrl: [], tracks: [], frames: 0, unmutedAtMs: null, signals: 0,
    host: {
      me, sess, iceConfig: { iceServers: [] }, forceRelay: false, noP2P: false, stream, videoLimits: DEFAULT_VIDEO_LIMITS, metrics,
      now: () => performance.now(),
      log: (m) => { const line = `${stamp()} ${name} ${m}`; log.push(line); logEl.textContent += line + '\n'; },
      sendSignal: (_to, d) => { s.signals++; deliver(other(), d); },
      onState: (_from, raw) => { s.states.push(raw); },
      onCtrl: (_from, raw) => { s.ctrl.push(raw); },
      onTrack: (_from, st, track) => {
        s.tracks.push({ kind: track.kind, muted: track.muted });
        if (track.kind !== 'video') return;
        const v = document.createElement('video');
        v.muted = true; v.autoplay = true; v.playsInline = true;
        v.srcObject = st;
        document.getElementById('videos')?.appendChild(v);
        void v.play().catch(() => undefined);
        track.addEventListener('unmute', () => { s.unmutedAtMs = Math.round(performance.now() - t0); });
        const rv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
        if (rv.requestVideoFrameCallback) { const tick = (): void => { s.frames++; rv.requestVideoFrameCallback?.(tick); }; rv.requestVideoFrameCallback(tick); }
        else v.addEventListener('timeupdate', () => { s.frames++; });
      },
      hardReset: () => { metrics.hardResets++; },
    },
  };
  return s;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number): Promise<number | null> {
  const t = performance.now();
  while (performance.now() - t < ms) { if (cond()) return Math.round(performance.now() - t); await sleep(50); }
  return cond() ? Math.round(performance.now() - t) : null;
}

export interface PeersReport {
  engine: string;
  /** The engine has RTCPeerConnection, and a canvas that can be captured as a camera (without it the smoke runs on the data channels alone). */
  webrtc: boolean;
  canCapture: boolean;
  log: string[];
  dcOpenMs: [number | null, number | null];
  aToB: boolean;
  bToA: boolean;
  ctrlAB: boolean;
  tracks: { a: { kind: string; muted: boolean }[]; b: { kind: string; muted: boolean }[] };
  videoFrames: { a: number; b: number };
  unmutedMs: { a: number | null; b: number | null };
  path: { a: unknown; b: unknown };
  afterRestart: { dcOpen: boolean; roundTrip: boolean; ms: number | null };
  signals: { a: number; b: number };
  error: string | null;
}

async function run(): Promise<PeersReport> {
  const log: string[] = [];
  const rep: PeersReport = {
    engine: navigator.userAgent, webrtc: typeof RTCPeerConnection !== 'undefined', canCapture: false, log, dcOpenMs: [null, null], aToB: false, bToA: false, ctrlAB: false, tracks: { a: [], b: [] }, videoFrames: { a: 0, b: 0 },
    unmutedMs: { a: null, b: null }, path: { a: null, b: null }, afterRestart: { dcOpen: false, roundTrip: false, ms: null }, signals: { a: 0, b: 0 }, error: null,
  };
  try {
    if (typeof RTCPeerConnection === 'undefined') { rep.error = 'no RTCPeerConnection in this engine'; return rep; }
    const canvas = document.getElementById('cam') as HTMLCanvasElement;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    let n = 0;
    setInterval(() => { n++; g.fillStyle = `hsl(${(n * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillRect((n * 5) % 300, 100, 20, 40); }, 60);
    rep.canCapture = typeof canvas.captureStream === 'function';
    const captured = rep.canCapture ? canvas.captureStream(15) : null;
    const streamA = captured;
    const streamB = captured ? captured.clone() : null;
    // A (seat s1, impolite) shapes the first offer; B (s2, polite) answers
    const a: Side = makeSide('A', 's1', 'sess-a', streamA, log, (to, d) => { setTimeout(() => { void to.link?.onSignal(d); }, 3); }, () => b);
    const b: Side = makeSide('B', 's2', 'sess-b', streamB, log, (to, d) => { setTimeout(() => { void to.link?.onSignal(d); }, 3); }, () => a);
    a.link = new PeerLink(a.host, 's2', 'sess-b', true);
    b.link = new PeerLink(b.host, 's1', 'sess-a', true);
    const watch = setInterval(() => { a.link?.watch(); b.link?.watch(); }, 250);

    const openA = until(() => !!a.link?.stateOpen, 15_000);
    const openB = until(() => !!b.link?.stateOpen, 15_000);
    rep.dcOpenMs = [await openA, await openB];

    a.link.sendState(JSON.stringify({ q: 1, s: 'A', ts: 1, d: { sc: 7 } }));
    b.link.sendState(JSON.stringify({ q: 1, s: 'B', ts: 2, d: { sc: 9 } }));
    a.link.sendCtrl(JSON.stringify({ hello: 'ctrl' }));
    rep.aToB = (await until(() => b.states.length > 0, 3000)) !== null;
    rep.bToA = (await until(() => a.states.length > 0, 3000)) !== null;
    rep.ctrlAB = (await until(() => b.ctrl.length > 0, 3000)) !== null;

    // the friend's picture: the track arrives, unmutes, and frames are painted (when the engine can make a camera out of a canvas)
    if (rep.canCapture) await until(() => a.frames > 8 && b.frames > 8, 10_000);
    rep.tracks = { a: a.tracks, b: b.tracks };
    rep.videoFrames = { a: a.frames, b: b.frames };
    rep.unmutedMs = { a: a.unmutedAtMs, b: b.unmutedAtMs };
    rep.path = { a: (await a.link.stats()).path, b: (await b.link.stats()).path };

    // an ICE restart (what the client does on a flaky link) keeps the channel and the messages
    const before = performance.now();
    a.link.pc.restartIce();
    await sleep(300);
    const reopened = await until(() => !!a.link?.stateOpen && !!b.link?.stateOpen && (a.link?.pc.iceConnectionState === 'connected' || a.link?.pc.iceConnectionState === 'completed'), 10_000);
    b.states.length = 0;
    a.link.sendState(JSON.stringify({ q: 2, s: 'A', ts: 3, d: { sc: 8 } }));
    const rt = await until(() => b.states.length > 0, 3000);
    rep.afterRestart = { dcOpen: reopened !== null, roundTrip: rt !== null, ms: reopened === null ? null : Math.round(performance.now() - before) };
    rep.signals = { a: a.signals, b: b.signals };
    clearInterval(watch);
    a.link.close(); b.link.close();
  } catch (e) {
    rep.error = String(e);
  }
  return rep;
}

(window as unknown as { __run: () => Promise<PeersReport> }).__run = run;
