// One WebRTC link to one rival (tech.md 2.5; every rule here exists because a two-browser test failed without it).
// Browser only: it needs RTCPeerConnection. The match never depends on this link: when it is down the Room relays the
// game state, and video is a bonus on top.
//
//  1. Perfect negotiation: the higher seat id is polite and rolls back on collisions; the other ignores them.
//  2. Only the impolite peer shapes the first offer (data channels and the video transceiver). Creating them on both
//     sides made the m-lines disagree after a collision and Chrome rejected the data section.
//  3. Epochs: every signal carries the sender's and the receiver's `sess`; a signal from a stale epoch is dropped.
//  4. ICE restart on `failed` and after 2 s of `disconnected`; a hard rebuild (new epoch on both sides) when the link
//     has not come back 10 s after failing, or has not connected 12 s after creation.
//  5. Health is judged per path: the data channel counts as healthy only if the rival's packets arrive on it within
//     700 ms. Traffic through the Room relay says nothing about the peer path.
//  6. Video limits are applied on both sides (the polite side too, after it attaches its camera).
import type { SeatId, SignalData } from '../types/net.ts';

export interface VideoLimits {
  maxBitrate: number;
  maxFramerate: number;
  /** 2 on phones: 320x240 is plenty for a small tile. */
  scaleDown: number;
}

export const DEFAULT_VIDEO_LIMITS: VideoLimits = { maxBitrate: 400_000, maxFramerate: 20, scaleDown: 1 };

export interface PeerMetrics {
  iceRestarts: number;
  hardResets: number;
  connectMs: number[];
  pathTypes: unknown[];
  /** Local time of the last hard reset (rate limit for rebuilds). */
  lastReset: number;
}

/** What a link needs from the client that owns it. */
export interface PeerHost {
  readonly me: SeatId;
  /** Our current epoch. */
  readonly sess: string;
  readonly iceConfig: RTCConfiguration;
  /** Tests: only relayed candidates (TURN), or no usable peer path at all. */
  readonly forceRelay: boolean;
  readonly noP2P: boolean;
  readonly stream: MediaStream | null;
  readonly videoLimits: VideoLimits;
  readonly metrics: PeerMetrics;
  now(): number;
  log(s: string): void;
  sendSignal(to: SeatId, d: SignalData): void;
  onState(from: SeatId, raw: string): void;
  onCtrl(from: SeatId, raw: string): void;
  onTrack(from: SeatId, stream: MediaStream, track: MediaStreamTrack): void;
  /** This link gave up: start a new epoch (both sides rebuild). */
  hardReset(link: PeerLink): void;
}

export interface PathInfo { local?: string; remote?: string; protocol?: string; relayProtocol?: string }
export interface LinkStats {
  seat: SeatId;
  ice: string;
  path: PathInfo | null;
  rtt: number | null;
  videoIn: { fps?: number; w?: number; h?: number; lost?: number; recv?: number; freezes?: number } | null;
  dc: [string, string];
  sctp: string;
  sig: string;
}

export class PeerLink {
  readonly seat: SeatId;
  readonly remoteSess: string;
  /** Whether this link carries our camera (both sides opted in, we have a stream). */
  readonly sendVideo: boolean;
  readonly polite: boolean;
  readonly pc: RTCPeerConnection;
  lastDcMsg = 0;
  lastMsg = 0;
  private readonly host: PeerHost;
  private readonly created: number;
  private dcCtrl: RTCDataChannel | null = null;
  private dcState: RTCDataChannel | null = null;
  private vtx: RTCRtpTransceiver | null = null;
  private connectedAt = 0;
  private discAt = 0;
  private restartAt = 0;
  private failedSince = 0;
  private makingOffer = false;
  private ignoreOffer = false;
  private srdAnswerPending = false;
  private closedFlag = false;

  constructor(host: PeerHost, seat: SeatId, remoteSess: string, sendVideo: boolean, createPc: (cfg: RTCConfiguration) => RTCPeerConnection = (c) => new RTCPeerConnection(c)) {
    this.host = host;
    this.seat = seat;
    this.remoteSess = remoteSess;
    this.polite = host.me > seat;
    this.created = host.now();
    this.sendVideo = sendVideo && !!host.stream;
    const cfg: RTCConfiguration = { ...host.iceConfig, iceTransportPolicy: host.forceRelay || host.noP2P ? 'relay' : 'all', bundlePolicy: 'max-bundle' };
    const pc = this.pc = createPc(cfg);
    if (!this.polite) this.ensureChannels();
    const track = this.sendVideo ? host.stream?.getVideoTracks()[0] : undefined;
    if (!this.polite && track && host.stream) {
      const lim = host.videoLimits;
      try {
        this.vtx = pc.addTransceiver(track, {
          direction: 'sendrecv', streams: [host.stream],
          sendEncodings: [{ maxBitrate: lim.maxBitrate, maxFramerate: lim.maxFramerate, scaleResolutionDownBy: lim.scaleDown }],
        });
      } catch (err) {
        host.log('addTransceiver with encodings failed, retrying plain: ' + String(err));
        this.vtx = pc.addTransceiver(track, { direction: 'sendrecv', streams: [host.stream] });
      }
      void this.tuneSender(this.vtx.sender);
    }
    pc.ontrack = (e) => {
      host.onTrack(seat, e.streams[0] ?? new MediaStream([e.track]), e.track);
      const mine = host.stream?.getVideoTracks()[0];
      if (this.polite && this.sendVideo && mine && e.track.kind === 'video' && !this.vtx) {
        this.vtx = e.transceiver;
        e.transceiver.direction = 'sendrecv';
        e.transceiver.sender.replaceTrack(mine).then(() => this.tuneSender(e.transceiver.sender)).catch((err: unknown) => host.log('video attach failed ' + String(err)));
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.signal({ description: pc.localDescription ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp } : undefined });
      } catch (err) { host.log('negotiation error ' + String(err)); }
      finally { this.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => this.signal({ candidate: candidate ? candidate.toJSON() : null });
    pc.oniceconnectionstatechange = () => this.onIce(pc.iceConnectionState);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') this.onConnected(); };
  }

  /** The video limits the sender must obey, and "keep the frame rate, drop resolution" under load. */
  private async tuneSender(sender: RTCRtpSender): Promise<void> {
    const lim = this.host.videoLimits;
    try {
      const p = sender.getParameters();
      const enc = p.encodings && p.encodings.length ? p.encodings : [{}];
      enc[0] = { ...enc[0], maxBitrate: lim.maxBitrate, maxFramerate: lim.maxFramerate, scaleResolutionDownBy: lim.scaleDown };
      p.encodings = enc;
      (p as { degradationPreference?: string }).degradationPreference = 'maintain-framerate';
      await sender.setParameters(p);
    } catch (err) { this.host.log('setParameters failed ' + String(err)); }
  }

  private ensureChannels(): void {
    if (this.dcState) return;
    const { host, pc, seat } = this;
    const ctrl = this.dcCtrl = pc.createDataChannel('ctrl', { negotiated: true, id: 0 });
    const st = this.dcState = pc.createDataChannel('state', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    st.onmessage = (e) => { if (typeof e.data === 'string') { this.lastDcMsg = host.now(); host.onState(seat, e.data); } };
    ctrl.onmessage = (e) => { if (typeof e.data === 'string') host.onCtrl(seat, e.data); };
    st.onopen = () => host.log(`data channel open after ${Math.round(host.now() - this.created)} ms`);
    st.onclose = () => host.log('state channel closed');
    st.onerror = (e) => host.log('state channel error ' + String((e as RTCErrorEvent).error?.message ?? ''));
  }

  private signal(d: { description?: { type: RTCSdpType; sdp?: string } | undefined; candidate?: RTCIceCandidateInit | null }): void {
    if (this.closedFlag) return;
    const out: SignalData = { sess: this.host.sess, rsess: this.remoteSess };
    if (d.description) out.description = { type: d.description.type, ...(d.description.sdp !== undefined ? { sdp: d.description.sdp } : {}) };
    if (d.candidate !== undefined) out.candidate = d.candidate ? { candidate: d.candidate.candidate, sdpMid: d.candidate.sdpMid ?? null, sdpMLineIndex: d.candidate.sdpMLineIndex ?? null, usernameFragment: d.candidate.usernameFragment ?? null } : null;
    this.host.sendSignal(this.seat, out);
  }

  async onSignal(d: SignalData): Promise<void> {
    if (this.closedFlag || d.sess !== this.remoteSess || d.rsess !== this.host.sess) return;      // another epoch: ignore
    const pc = this.pc;
    try {
      if (d.description) {
        const desc = { type: d.description.type as RTCSdpType, ...(d.description.sdp !== undefined ? { sdp: d.description.sdp } : {}) };
        const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.srdAnswerPending);
        const collision = desc.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        this.srdAnswerPending = desc.type === 'answer';
        await pc.setRemoteDescription(desc);
        this.srdAnswerPending = false;
        if (desc.type === 'offer') {
          if (this.polite) this.ensureChannels();
          await pc.setLocalDescription();
          this.signal({ description: pc.localDescription ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp } : undefined });
        }
      } else if (d.candidate !== undefined) {
        try { await pc.addIceCandidate(d.candidate ?? undefined); } catch (err) { if (!this.ignoreOffer) throw err; }
      }
    } catch (err) {
      this.host.log('signal error ' + String(err));
    }
  }

  private onConnected(): void {
    const m = this.host.metrics;
    if (!this.connectedAt) { this.connectedAt = this.host.now(); m.connectMs.push(Math.round(this.connectedAt - this.created)); }
    this.discAt = 0; this.restartAt = 0; this.failedSince = 0;
    void this.stats().then((s) => { m.pathTypes.push(s.path); this.host.log('peer path ' + JSON.stringify(s.path)); });
  }

  private onIce(state: RTCIceConnectionState): void {
    this.host.log('ice ' + state);
    const now = this.host.now();
    if (state === 'disconnected') this.discAt = now;
    if (state === 'failed') { this.failedSince = this.failedSince || now; this.restart('failed'); }
    if (state === 'connected' || state === 'completed') this.onConnected();
  }

  private restart(why: string): void {
    const now = this.host.now();
    if (this.restartAt && now - this.restartAt < 3000) return;
    this.restartAt = now;
    this.host.metrics.iceRestarts++;
    this.host.log('ICE restart (' + why + ')');
    try { this.pc.restartIce(); } catch { /* closed */ }
  }

  /** Called every 250 ms by the client. */
  watch(): void {
    if (this.closedFlag) return;
    const s = this.pc.iceConnectionState;
    const now = this.host.now();
    const m = this.host.metrics;
    if (s === 'disconnected' && this.discAt && now - this.discAt > 2000) this.restart('disconnected 2s');
    const notUp = s !== 'connected' && s !== 'completed';
    // a link that has not come (back) up in 10 s gets a brand-new connection on both sides
    const since = this.connectedAt ? (this.failedSince || (s === 'disconnected' ? this.discAt : 0)) : this.created;
    if (notUp && since && now - since > (this.connectedAt ? 10_000 : 12_000) && (!m.lastReset || now - m.lastReset > (m.hardResets >= 3 ? 60_000 : 15_000))) {
      m.lastReset = now; m.hardResets++;
      this.host.log('hard reset of the peer link');
      this.host.hardReset(this);
    }
  }

  /** Is the state channel open and fed by the rival right now? */
  get stale(): boolean {
    return !this.lastDcMsg || this.host.now() - this.lastDcMsg > 700;
  }

  get stateOpen(): boolean {
    return this.dcState?.readyState === 'open';
  }

  /** Sends one state message on the peer path; false when the channel is not open. */
  sendState(text: string): boolean {
    if (this.dcState?.readyState !== 'open') return false;
    try { this.dcState.send(text); return true; } catch { return false; }
  }

  sendCtrl(text: string): boolean {
    if (this.dcCtrl?.readyState !== 'open') return false;
    try { this.dcCtrl.send(text); return true; } catch { return false; }
  }

  /** The camera came back (a new track after a loss): swap it into the running connection without renegotiating. */
  async replaceTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.vtx) return;
    try { await this.vtx.sender.replaceTrack(track); } catch (e) { this.host.log('replaceTrack failed ' + String(e)); }
  }

  async stats(): Promise<LinkStats> {
    const out: LinkStats = {
      seat: this.seat, ice: this.pc.iceConnectionState, path: null, rtt: null, videoIn: null,
      dc: [this.dcCtrl?.readyState ?? 'none', this.dcState?.readyState ?? 'none'], sctp: this.pc.sctp ? this.pc.sctp.state : 'none', sig: this.pc.signalingState,
    };
    try {
      const st = await this.pc.getStats();
      const by = new Map<string, Record<string, unknown>>();
      st.forEach((r: Record<string, unknown>) => by.set(String(r.id), r));
      let pair: Record<string, unknown> | undefined;
      st.forEach((r: Record<string, unknown>) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = by.get(String(r.selectedCandidatePairId)); });
      if (!pair) st.forEach((r: Record<string, unknown>) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (pair) {
        const lc = by.get(String(pair.localCandidateId)) as Record<string, string> | undefined;
        const rc = by.get(String(pair.remoteCandidateId)) as Record<string, string> | undefined;
        out.path = { ...(lc?.candidateType ? { local: lc.candidateType } : {}), ...(rc?.candidateType ? { remote: rc.candidateType } : {}), ...(lc?.protocol ? { protocol: lc.protocol } : {}), ...(lc?.relayProtocol ? { relayProtocol: lc.relayProtocol } : {}) };
        out.rtt = typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime : null;
      }
      st.forEach((r: Record<string, unknown>) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          out.videoIn = { fps: r.framesPerSecond as number, w: r.frameWidth as number, h: r.frameHeight as number, lost: r.packetsLost as number, recv: r.packetsReceived as number, freezes: r.freezeCount as number };
        }
      });
    } catch { /* closed */ }
    return out;
  }

  close(): void {
    this.closedFlag = true;
    try { this.pc.close(); } catch { /* already closed */ }
  }
}
