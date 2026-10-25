// LiveClient: one player's side of a live room (tech.md 2.4 to 2.8). The Room socket is the one thing a match needs:
// it resumes after any drop (backoff, outbox, resend of unacknowledged results), detects half-open sockets, keeps a
// server clock estimate and the player's pause reasons. Peer links (peer.ts) make the fast state and video smooth
// but the match never waits for them.
import {
  CLOSE, NET_PROTOCOL,
  type AckRejection, type ChatRejectReason, type ClientMessage, type IceGrant, type JoinGrant, type MatchInfo, type MatchResult, type MemberInfo,
  type NetPauseReason, type ObstacleResult, type Outcome, type PresetId, type ReactionId, type ReportReason, type RoomErrorCode, type RoomInfo,
  type RoomMessage, type SeatId, type SignalData,
} from '../types/net.ts';
import { ClockFilter, type ClockInfo } from './clock.ts';
import { isProGame } from './live-games.ts';
import { currentProToken } from './pro-token.ts';
import { PeerLink, DEFAULT_VIDEO_LIMITS, type LinkStats, type PeerHost, type PeerMetrics, type VideoLimits } from './peer.ts';
import { Emitter, WS_CONNECTING, WS_OPEN, browserSocket, randomId, realScheduler, type Scheduler, type SocketFactory, type SocketLike } from './runtime.ts';
import { parseRoomMessage } from './validate.ts';
import { VideoTracker, type VideoProbe, type VideoStatus } from './video.ts';

export type FatalReason = 'replaced' | 'full' | 'removed' | 'no_room' | 'version' | 'not_allowed' | 'ticket' | 'stopped';

export interface LiveEvents {
  status: { state: 'connecting' | 'online' | 'reconnecting' | 'stopped'; attempt: number; delayMs?: number };
  welcome: Extract<RoomMessage, { t: 'welcome' }>;
  presence: MemberInfo[];
  room: RoomInfo;
  /** A match to play: it just started, or this client rejoined one that is running (`mine` holds the results the Room already has). */
  match: { match: MatchInfo; mine: ObstacleResult[]; why: 'start' | 'welcome' };
  /** Any change of the match state (start, paused, resumed, forfeit, welcome). */
  phase: { why: string; match: MatchInfo };
  settling: { mid: string };
  forfeit: { seat: SeatId; match: MatchInfo };
  result: MatchResult;
  chat: { from: SeatId; text: string; at: number };
  preset: { from: SeatId; id: PresetId; at: number };
  react: { from: SeatId; id: ReactionId; at: number };
  chatRejected: { reason: ChatRejectReason; retryAt?: number };
  blocked: { seat: SeatId; key: string };
  reported: { seat: SeatId };
  removed: { reason: 'kicked' | 'banned' | 'dropped' };
  /** Fast game state from a rival (the ghost). `path` says which way it came. */
  state: { from: SeatId; d: unknown; path: 'dc' | 'relay'; latency: number };
  ctrl: { from: SeatId; d: unknown };
  track: { from: SeatId; stream: MediaStream; track: MediaStreamTrack };
  /** The optional camera link to one friend changed (see video.ts): connecting, live, or failed with a reason; the skeleton is on the screen meanwhile. */
  video: VideoStatus;
  synced: ClockInfo;
  roomError: { code: RoomErrorCode };
  /** The client stopped for good (taken over by another tab, removed, room gone...). */
  fatal: { reason: FatalReason; code: number };
  log: string;
}

export interface LiveClientOptions {
  grant: JoinGrant;
  /** Origin of the site, `http://host:port`. Defaults to location.origin. */
  origin?: string;
  /** A fresh grant when the Room rejects the ticket (close 4002). Without it a rejected ticket is fatal. */
  refreshTicket?: () => Promise<JoinGrant>;
  /**
   * The player's current signed Pro token (core/entitlements: `entitlements.current().token`), or null for a free player: the same
   * function `refreshTicket` presents it from. With `proSent` (the token the grant in `grant` was made with) it lets `configure` see that
   * the player bought Pro, or the app renewed an old token, after the Room read the ticket, and renew the ticket before a Pro game is picked.
   */
  pro?: () => string | null | undefined;
  proSent?: string | null;
  /** Block keys this device holds (from earlier `blocked` events), sent with every hello. */
  blocks?: string[];
  /** Offer our camera to the rivals who also opted in (needs `stream`). */
  video?: boolean;
  stream?: MediaStream | null;
  /** 'webrtc': peer links (browsers). 'none': everything goes through the Room relay. */
  peers?: 'webrtc' | 'none';
  /** TURN/STUN servers; fetched from /api/ice when omitted and peers are on. */
  ice?: IceGrant | (() => Promise<IceGrant>);
  /** Test switches: only relayed candidates; no usable peer path at all (`noP2P` can be flipped later on the client). */
  forceRelay?: boolean;
  noP2P?: boolean;
  /** Create and drop one throwaway RTCPeerConnection in the lobby (the first one blocks the main thread for seconds). */
  warmup?: boolean;
  videoLimits?: VideoLimits;
  sched?: Scheduler;
  socket?: SocketFactory;
  random?: () => number;
  tab?: string;
  log?: (s: string) => void;
  /** Tests: replaces `new RTCPeerConnection(cfg)`. */
  createPeerConnection?: (cfg: RTCConfiguration) => RTCPeerConnection;
}

export interface LiveMetrics extends PeerMetrics {
  t0: number;
  wsOpens: number;
  wsCloses: number;
  deadSockets: number;
  relaySent: number;
  dcSent: number;
  stSent: number;
  stRecvDc: number;
  stRecvRelay: number;
  stDup: number;
  maxGap: number;
  gaps: number[];
  pings: number;
  pongs: number;
  syncSamples: number;
  warmupMs?: number;
  tWsOpen?: number;
  tWelcome?: number;
  clock?: ClockInfo;
}

const TICK_MS = 250;
const PING_MATCH_MS = 2000;
const PING_LOBBY_MS = 5000;
/** A connection attempt that has not opened after this long is abandoned and retried (plus 1 s for each earlier failed retry, up to 3 s more). */
const CONNECT_MATCH_MS = 6000;
const CONNECT_LOBBY_MS = 10_000;
const FINAL_RESEND_MS = 2000;
const CLOCK_REFRESH_MS = 5000;
const OUTBOX_MAX = 200;
const QUEUEABLE = new Set<ClientMessage['t']>(['ready', 'config', 'kick', 'block', 'report', 'signal']);
const FATAL_CODES: Readonly<Record<number, FatalReason>> = {
  [CLOSE.FULL]: 'full', [CLOSE.REMOVED]: 'removed', [CLOSE.NO_ROOM]: 'no_room', [CLOSE.VERSION]: 'version', [CLOSE.NOT_ALLOWED]: 'not_allowed',
};

interface StateEnvelope { q: number; s: string; ts: number; d: unknown }

export class LiveClient extends Emitter<LiveEvents> implements PeerHost {
  readonly tab: string;
  sess: string;
  you: SeatId | null = null;
  room: RoomInfo | null = null;
  members: MemberInfo[] = [];
  match: MatchInfo | null = null;
  blocks: string[];
  stream: MediaStream | null;
  readonly m: LiveMetrics;
  readonly clock = new ClockFilter();
  readonly iceConfig: RTCConfiguration = { iceServers: [] };
  readonly forceRelay: boolean;
  /** Test switch: no usable peer path at all (a strict network with no relay server). Flipping it takes effect with the next link. */
  noP2P: boolean;
  readonly videoLimits: VideoLimits;
  readonly opts: LiveClientOptions;
  closed = false;
  /** Set when a peer connection cannot be created on this device: everything goes through the Room relay. */
  peersBroken = false;

  private started = false;
  private readonly sched: Scheduler;
  private readonly socketFactory: SocketFactory;
  private readonly random: () => number;
  private grant: JoinGrant;
  /** The Pro token the ticket in `grant` carries (null: none), to tell when the player's own is newer than what the Room has read. */
  private proPresented: string | null;
  private renewing: Promise<boolean> | null = null;
  private ws: SocketLike | null = null;
  private online = false;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private tickTimer: unknown = null;
  private lastRefresh = 0;
  private outbox: ClientMessage[] = [];
  private seq = 0;
  private readonly unacked = new Map<number, Extract<ClientMessage, { t: 'ev' }>>();
  private readonly reasons = new Set<NetPauseReason>();
  private pendingFinal: Extract<ClientMessage, { t: 'final' }> | null = null;
  private finalAt = 0;
  private resultFor: string | null = null;
  /** What the player last asked for with the ready button; null once a match has used it up. Re-sent when the Room's view differs after a reconnect. */
  private wantReady: boolean | null = null;
  private lastPing = 0;
  private connectAt = 0;
  private lastPong = 0;
  private lastMsgIn = 0;
  private lastClockTry = 0;
  private burstActive = false;
  private clockRetries = 0;
  private stSeq = 0;
  private readonly peers = new Map<SeatId, PeerLink>();
  private readonly lastSq = new Map<SeatId, { s: string; q: number }>();
  private readonly lastStateAt = new Map<SeatId, number>();
  /** The friends' video tracks (negotiated; they carry a picture once unmuted) and the state of each camera link. */
  private readonly remoteVideo = new Map<SeatId, MediaStreamTrack>();
  /** The stream each friend's video track came in: the picture a page draws (videoStream), whenever it starts to look. */
  private readonly trackStreams = new WeakMap<MediaStreamTrack, MediaStream>();
  private readonly videos = new VideoTracker(() => this.sched.now(), (s) => { this.emit('video', s); });

  constructor(opts: LiveClientOptions) {
    super();
    this.opts = opts;
    this.grant = opts.grant;
    this.proPresented = opts.proSent ?? null;
    this.sched = opts.sched ?? realScheduler;
    this.socketFactory = opts.socket ?? browserSocket;
    this.random = opts.random ?? Math.random;
    this.tab = opts.tab ?? randomId(this.random);
    this.sess = randomId(this.random);
    this.blocks = [...(opts.blocks ?? [])];
    this.stream = opts.stream ?? null;
    this.forceRelay = !!opts.forceRelay;
    this.noP2P = !!opts.noP2P;
    this.videoLimits = opts.videoLimits ?? DEFAULT_VIDEO_LIMITS;
    this.m = {
      t0: this.sched.now(), wsOpens: 0, wsCloses: 0, deadSockets: 0, relaySent: 0, dcSent: 0, stSent: 0, stRecvDc: 0, stRecvRelay: 0, stDup: 0, maxGap: 0, gaps: [],
      pings: 0, pongs: 0, syncSamples: 0, iceRestarts: 0, hardResets: 0, connectMs: [], pathTypes: [], lastReset: 0,
    };
  }

  // ───────── PeerHost ─────────

  get me(): SeatId { return this.you ?? ''; }
  get metrics(): PeerMetrics { return this.m; }
  now(): number { return this.sched.now(); }
  log(s: string): void { this.opts.log?.(s); this.emit('log', s); }
  sendSignal(to: SeatId, d: SignalData): void { this.send({ t: 'signal', to, d }); }

  onCtrl(from: SeatId, raw: string): void {
    try { this.emit('ctrl', { from, d: JSON.parse(raw) as unknown }); } catch { /* not JSON */ }
  }

  onTrack(from: SeatId, stream: MediaStream, track: MediaStreamTrack): void {
    if (track.kind === 'video') {
      this.remoteVideo.set(from, track);
      this.trackStreams.set(track, stream);
      const again = (): void => { if (this.remoteVideo.get(from) === track) this.probeVideo(from); };
      for (const ev of ['unmute', 'mute', 'ended']) track.addEventListener?.(ev, again);
      this.probeVideo(from);
    }
    this.emit('track', { from, stream, track });
  }

  hardReset(link: PeerLink): void {
    this.newEpoch();
    link.close();
    this.peers.delete(link.seat);
    this.remoteVideo.delete(link.seat);
    this.setMembers(this.members);
  }

  // ───────── lifecycle ─────────

  /** Warms up WebRTC, gets ICE servers, connects. Resolves when the first socket is being opened (not when it is welcomed). */
  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    const rtc = this.opts.peers === 'webrtc' && typeof RTCPeerConnection !== 'undefined' && !this.peersBroken;
    if (rtc && this.opts.warmup !== false && typeof RTCPeerConnection !== 'undefined') {
      const w0 = this.sched.now();
      try {
        const pc = new RTCPeerConnection();
        pc.createDataChannel('warm');
        await pc.setLocalDescription(await pc.createOffer());
        pc.close();
      } catch { /* optional */ }
      this.m.warmupMs = Math.round(this.sched.now() - w0);
    }
    if (rtc) {
      try {
        const ice = typeof this.opts.ice === 'function' ? await this.opts.ice() : this.opts.ice;
        if (ice) this.applyIce(ice);
      } catch { /* STUN-less: host candidates still work on one network, the Room relay covers the rest */ }
      if (this.noP2P) this.applyIce(null);
    }
    if (this.closed) return;
    this.connect();
    this.armTick();
    (globalThis as { addEventListener?: (type: string, fn: () => void) => void }).addEventListener?.('online', this.onNetworkBack);
  }

  /** The servers new links use. The TURN part is whatever the Worker's /api/ice gave: STUN only when no TURN key is set up, and nothing here changes when one is. */
  private applyIce(ice: { iceServers: unknown[] } | null): void {
    const cfg = this.iceConfig as { iceServers: RTCIceServer[] };
    if (ice) cfg.iceServers = ice.iceServers as RTCIceServer[];
    if (this.noP2P) cfg.iceServers = [{ urls: ['turn:127.0.0.1:9?transport=udp'], username: 'x', credential: 'x' }];
  }

  /** Asks for fresh servers (credentials expire, and a TURN key may have been added since the page opened). A failure keeps the servers we have. */
  private async renewIce(): Promise<void> {
    const src = this.opts.ice;
    if (typeof src !== 'function') { this.applyIce(null); return; }
    let timer: unknown = null;
    try {
      const wait = new Promise<undefined>((resolve) => { timer = this.sched.setTimeout(() => resolve(undefined), 4000); });
      const ice = await Promise.race([src(), wait]);
      this.applyIce(ice ?? null);
    } catch { this.applyIce(null); } finally { if (timer !== null) this.sched.clearTimeout(timer); }
  }

  /** The browser says the network is back: a hanging attempt is retried at once, a live-looking socket is tested at the next tick. */
  private readonly onNetworkBack = (): void => {
    const ws = this.ws;
    if (this.closed || !ws) return;
    if (ws.readyState === WS_CONNECTING) { this.log('network is back: connecting again'); this.dropSocket(); return; }
    this.lastPing = 0;
  };

  /** Stops without telling the Room (another tab took the seat, the page is closing). */
  stop(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.tickTimer) this.sched.clearTimeout(this.tickTimer);
    if (this.reconnectTimer) this.sched.clearTimeout(this.reconnectTimer);
    this.tickTimer = this.reconnectTimer = null;
    (globalThis as { removeEventListener?: (type: string, fn: () => void) => void }).removeEventListener?.('online', this.onNetworkBack);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    const ws = this.ws;
    this.ws = null;
    this.online = false;
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; try { ws.close(1000, 'stop'); } catch { /* closing */ } }
    this.emit('status', { state: 'stopped', attempt: this.attempt });
  }

  /** Leaving on purpose: during a match the seat forfeits at once. Never call this on page unload (a reload is not a leave). */
  leave(): void {
    if (this.closed) return;
    this.sendNow({ t: 'bye' });
    this.stop();
  }

  private fatal(reason: FatalReason, code: number): void {
    this.stop();
    this.emit('fatal', { reason, code });
  }

  // ───────── socket ─────────

  private wsUrl(): string {
    const origin = (this.opts.origin ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/^http/, 'ws').replace(/\/+$/, '');
    return `${origin}/api/rooms/${this.grant.code}/ws?ticket=${encodeURIComponent(this.grant.ticket)}`;
  }

  private connect(): void {
    if (this.closed) return;
    this.reconnectTimer = null;
    const ws = this.socketFactory(this.wsUrl());
    this.ws = ws;
    this.online = false;
    this.connectAt = this.sched.now();
    this.emit('status', { state: this.attempt ? 'reconnecting' : 'connecting', attempt: this.attempt });
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.m.wsOpens++;
      this.lastPong = this.lastMsgIn = this.sched.now();
      if (this.m.tWsOpen === undefined) this.m.tWsOpen = this.sched.now() - this.m.t0;
      // The pause reasons say why this player is paused right now; the Room adopts them instead of resuming the match
      // and pausing it again a moment later.
      ws.send(JSON.stringify({
        t: 'hello', v: NET_PROTOCOL, tab: this.tab, sess: this.sess, video: !!this.opts.video && !!this.stream, reasons: [...this.reasons], blocks: this.blocks.slice(0, 200),
      } satisfies ClientMessage));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (e.data === 'pong') { this.lastPong = this.sched.now(); this.m.pongs++; return; }
      this.lastMsgIn = this.sched.now();
      const msg = parseRoomMessage(e.data);
      if (msg) this.onRoom(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.online = false;
      this.m.wsCloses++;
      this.onClosed(e.code, e.reason);
    };
    ws.onerror = () => { /* the close event follows */ };
  }

  private onClosed(code: number, reason: string): void {
    if (this.closed) return;
    if (code === CLOSE.REPLACED) { this.fatal('replaced', code); return; }
    const fatal = FATAL_CODES[code];
    if (fatal) { this.fatal(fatal, code); return; }
    if (code === CLOSE.TICKET) { void this.renewTicket(); return; }
    this.log(`room socket closed (${code}${reason ? ' ' + reason : ''})`);
    this.scheduleReconnect();
  }

  private async renewTicket(): Promise<void> {
    const refresh = this.opts.refreshTicket;
    const now = this.sched.now();
    if (!refresh || now - this.lastRefresh < 3000) { this.fatal('ticket', CLOSE.TICKET); return; }
    this.lastRefresh = now;
    const sent = currentProToken(this.opts.pro);                 // what the refresh below presents (it reads the same token in the same breath)
    try {
      this.grant = await refresh();
      this.proPresented = sent;
      this.scheduleReconnect(0);
    } catch {
      this.scheduleReconnect();
    }
  }

  /** Is the player's own Pro token a different one from the one the Room read at the door? (A free player has nothing to present.) */
  private proIsNewer(): boolean {
    const tok = currentProToken(this.opts.pro);
    return !!tok && tok !== this.proPresented;
  }

  /**
   * The player's Pro token changed after the ticket was signed (Pro was bought in this lobby, or the app renewed an old token): asks for a
   * fresh ticket and reconnects, so the Room reads the new claim when this client says hello again. Only between matches: a running match
   * is never interrupted for it. Resolves to true when the new ticket is in place (the socket is back within a moment; queued messages go
   * out with the welcome), false when there is nothing to renew with, a match is on, or the call failed.
   */
  renewEntitlement(): Promise<boolean> {
    if (!this.renewing) this.renewing = this.renew().finally(() => { this.renewing = null; });
    return this.renewing;
  }

  /**
   * The Room says the Pro game it holds has no Pro proof behind it any more (`pro.ok` false: the host's token ran out, or the host
   * changed) and this client is the host with a token that is not the one the Room read: the ticket is renewed, the next hello shows the
   * new token and a room that was waiting for it goes on. A token the Room already read and found wanting is not tried again (no loop).
   * Called when the Room says so and on every tick while it stays so, because the app renews its token on its own schedule and the Room
   * says "no proof" only once.
   */
  private proWaiting(room: RoomInfo): void {
    if (room.pro?.ok === false && this.you !== null && room.host === this.you && this.proIsNewer()) void this.renewEntitlement();
  }

  private async renew(): Promise<boolean> {
    const refresh = this.opts.refreshTicket;
    if (!refresh || this.closed || !this.started || this.playing) return false;
    const sent = currentProToken(this.opts.pro);                 // what the refresh below presents (it reads the same token in the same breath)
    try {
      this.grant = await refresh();
    } catch {
      return false;
    }
    this.proPresented = sent;
    this.lastRefresh = this.sched.now();
    if (this.ws && !this.closed) this.dropSocket();
    return true;
  }

  /** Backoff 250 ms, 500 ms, 1 s, 2 s, 4 s, then 5 s, each with +-30% jitter. */
  private scheduleReconnect(fixed?: number): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = fixed ?? Math.round(Math.min(5000, 250 * 2 ** this.attempt) * (0.7 + this.random() * 0.6));
    this.attempt++;
    this.emit('status', { state: 'reconnecting', attempt: this.attempt, delayMs: delay });
    // a ticket that expires within a minute is renewed before it is used
    const refresh = this.opts.refreshTicket;
    if (refresh && this.grant.exp * 1000 - Date.now() < 60_000 && this.sched.now() - this.lastRefresh > 3000) {
      this.lastRefresh = this.sched.now();
      // `proPresented` is not touched here: the Room has read only what a hello carried, and a socket that connected before this answer
      // came holds the older ticket's claim. A Pro pick after it may renew once more (renewEntitlement), which is safe; believing the Room
      // had read a ticket it never saw would leave that pick refused with nothing left to try.
      void refresh().then((g) => { this.grant = g; }).catch(() => { /* the old ticket may still work */ });
    }
    this.reconnectTimer = this.sched.setTimeout(() => this.connect(), delay);
  }

  /** Drops a socket that looks alive but is not (half-open) and reconnects at once. */
  private dropSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    this.online = false;
    this.m.wsCloses++;
    ws.onclose = null; ws.onmessage = null; ws.onerror = null;
    try { ws.close(); } catch { /* closing */ }
    this.scheduleReconnect(Math.round(100 + this.random() * 200));
  }

  private sendNow(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (ws && ws.readyState === WS_OPEN && this.online) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  /** Sends to the Room; messages that must not be lost (ready, config, block, report, signals) wait for the next welcome. */
  private send(msg: ClientMessage): boolean {
    if (this.sendNow(msg)) return true;
    if (QUEUEABLE.has(msg.t)) {
      if (msg.t === 'ready') this.outbox = this.outbox.filter((x) => x.t !== 'ready');
      this.outbox.push(msg);
      if (this.outbox.length > OUTBOX_MAX) this.outbox.shift();
    }
    return false;
  }

  // ───────── messages from the Room ─────────

  private onRoom(msg: RoomMessage): void {
    switch (msg.t) {
      case 'welcome': this.onWelcome(msg); break;
      case 'sync': this.onSync(msg.c, msg.s); break;
      case 'presence': this.setMembers(msg.members); break;
      case 'room': this.room = msg.room; this.emit('room', msg.room); this.proWaiting(msg.room); break;
      case 'signal': this.peers.get(msg.from)?.onSignal(msg.d).catch(() => { /* logged inside */ }); break;
      case 'relay': this.onStateEnvelope(msg.from, msg.d, 'relay'); break;
      case 'start': this.setMatch(msg.match, 'start'); break;
      case 'paused': case 'resumed': this.setMatch(msg.match, msg.t); break;
      case 'forfeit': this.setMatch(msg.match, 'forfeit'); this.emit('forfeit', { seat: msg.seat, match: msg.match }); break;
      case 'settling': this.emit('settling', { mid: msg.mid }); break;
      case 'ack': this.onAck(msg.seq, msg.rejected); break;
      case 'result': this.onResult(msg.result); break;
      case 'chat': this.emit('chat', { from: msg.from, text: msg.text, at: msg.at }); break;
      case 'preset': this.emit('preset', { from: msg.from, id: msg.id, at: msg.at }); break;
      case 'react': this.emit('react', { from: msg.from, id: msg.id, at: msg.at }); break;
      case 'chat_rejected': this.emit('chatRejected', msg.retryAt === undefined ? { reason: msg.reason } : { reason: msg.reason, retryAt: msg.retryAt }); break;
      case 'blocked': if (!this.blocks.includes(msg.key)) this.blocks.push(msg.key); this.emit('blocked', { seat: msg.seat, key: msg.key }); break;
      case 'reported': this.emit('reported', { seat: msg.seat }); break;
      case 'removed': this.emit('removed', { reason: msg.reason }); break;
      case 'error': this.log('room error ' + msg.code); this.emit('roomError', { code: msg.code }); break;
    }
  }

  private onWelcome(msg: Extract<RoomMessage, { t: 'welcome' }>): void {
    const now = this.sched.now();
    this.online = true;
    this.attempt = 0;
    this.emit('status', { state: 'online', attempt: 0 });
    this.you = msg.you;
    this.room = msg.room;
    if (this.m.tWelcome === undefined) this.m.tWelcome = now - this.m.t0;
    this.clock.provisional(msg.now, now);
    this.syncBurst(8, 60);
    this.setMembers(msg.members);
    const prev = this.match;
    this.match = msg.match;
    const m = msg.match;
    // resend what the Room has not acknowledged, then what was queued while offline
    for (const ev of this.unacked.values()) if (m && ev.mid === m.id && m.phase !== 'over') this.sendNow(ev); else this.unacked.delete(ev.seq);
    if (this.pendingFinal && m && m.id === this.pendingFinal.mid && m.phase !== 'over') this.sendNow(this.pendingFinal);
    const queued = this.outbox;
    this.outbox = [];
    for (const q of queued) this.send(q);
    // a ready press sent into a socket that was already dead never arrived: say it again if the Room disagrees
    const mine = msg.members.find((x) => x.seat === msg.you);
    if (this.wantReady !== null && mine && mine.ready !== this.wantReady && (!m || m.phase === 'over')) this.sendNow({ t: 'ready', ready: this.wantReady });
    this.emit('welcome', msg);
    if (m) {
      if (m.phase !== 'over' && (!prev || prev.id !== m.id)) this.emit('match', { match: m, mine: msg.mine, why: 'welcome' });
      this.emit('phase', { why: 'welcome', match: m });
      if (m.phase === 'over' && m.result && this.pendingFinal && this.pendingFinal.mid === m.id) this.onResult(m.result);
    }
    this.updateSlew();
    this.proWaiting(msg.room);
  }

  /**
   * The clock glides only while match time is really advancing on screen. During the start countdown, the 3-2-1 after a
   * pause, a pause and in the lobby a better estimate is adopted at once: nothing visible moves.
   */
  private updateSlew(): void {
    const m = this.match;
    let advancing = false;
    if (m && m.phase === 'running') {
      const now = this.serverNow();
      advancing = now >= m.startAt + m.pauseTotal && !(m.resumeAt !== null && now < m.resumeAt);
    }
    this.clock.setSlew(advancing);
  }

  private setMatch(match: MatchInfo, why: 'start' | 'paused' | 'resumed' | 'forfeit'): void {
    this.match = match;
    this.updateSlew();
    if (why === 'start') { this.resultFor = null; this.wantReady = null; this.emit('match', { match, mine: [], why: 'start' }); }
    this.emit('phase', { why, match });
    if (why === 'start' || why === 'paused') this.syncBurst(6, 70);
  }

  private onAck(seq: number, rejected?: AckRejection): void {
    this.unacked.delete(seq);
    if (rejected) this.log('result rejected: ' + rejected);
  }

  private onResult(result: MatchResult): void {
    if (this.resultFor === result.mid) return;
    this.resultFor = result.mid;
    if (this.pendingFinal && this.pendingFinal.mid === result.mid) this.pendingFinal = null;
    for (const [seq, ev] of this.unacked) if (ev.mid === result.mid) this.unacked.delete(seq);
    if (this.match && this.match.id === result.mid) this.match = { ...this.match, phase: 'over', result };
    this.updateSlew();
    this.wantReady = null;
    this.emit('result', result);
  }

  // ───────── room actions ─────────

  setReady(ready: boolean): void {
    this.wantReady = ready;
    this.send({ t: 'ready', ready });
  }
  /**
   * Host only. A Pro game needs the host's Pro token behind it in the Room: when the player's own token is newer than the ticket the Room
   * read (see renewEntitlement), the ticket is renewed first and the choice goes out with the welcome that follows.
   */
  configure(c: { gameId?: string; durationMs?: number }): void {
    if (c.gameId !== undefined && isProGame(c.gameId) && this.proIsNewer()) {
      void this.renewEntitlement().then(() => { this.send({ t: 'config', ...c }); });
      return;
    }
    this.send({ t: 'config', ...c });
  }
  kick(seat: SeatId): void { this.send({ t: 'kick', seat }); }
  chat(text: string): void { this.send({ t: 'chat', text }); }
  preset(id: PresetId): void { this.send({ t: 'preset', id }); }
  react(id: ReactionId): void { this.send({ t: 'react', id }); }
  block(seat: SeatId): void { this.send({ t: 'block', seat }); }
  reportPlayer(seat: SeatId, reason: ReportReason, block: boolean): void { this.send({ t: 'report', seat, reason, block }); }

  /** Camera on or off for rivals who also opted in (the Room decides who may see it). */
  setVideo(on: boolean): void {
    (this.opts as { video?: boolean }).video = on;
    this.send({ t: 'video', on: on && !!this.stream });
  }

  /** The player's own state: the Room keeps one reason per player, so `unpause` is only sent when none is left. */
  pause(reason: NetPauseReason): void {
    this.reasons.add(reason);
    this.sendNow({ t: 'pause', reason });          // offline: the next hello carries it
  }

  unpause(reason?: NetPauseReason): void {
    if (reason) this.reasons.delete(reason); else this.reasons.clear();
    if (!this.reasons.size) this.sendNow({ t: 'unpause' });
  }

  /** The player's result for one obstacle: acknowledged by the Room, resent after any reconnect until it is. */
  reportResult(ob: number, k: Outcome): void {
    const m = this.match;
    if (!m) return;
    const ev: Extract<ClientMessage, { t: 'ev' }> = { t: 'ev', mid: m.id, seq: ++this.seq, ob, k };
    this.unacked.set(ev.seq, ev);
    this.sendNow(ev);
  }

  /** End of match: the full outcome list. Resent every 2 s and after reconnects until the result arrives. */
  finish(evs: readonly ObstacleResult[]): void {
    const m = this.match;
    if (!m || (this.pendingFinal && this.pendingFinal.mid === m.id) || this.resultFor === m.id) return;
    this.pendingFinal = { t: 'final', mid: m.id, evs: evs.map((e) => ({ ob: e.ob, k: e.k })) };
    this.finalAt = this.sched.now();
    this.sendNow(this.pendingFinal);
  }

  // ───────── clock ─────────

  serverNow(): number {
    const now = this.sched.now();
    return now + this.clock.offset(now);
  }

  /** Match time in ms from the Room's numbers: the same on every device within the clock error. Negative before time zero. */
  matchTime(): number {
    const m = this.match;
    if (!m) return 0;
    if (m.phase === 'settling' || m.phase === 'over') return m.duration;
    const t = m.phase === 'paused' ? (m.pausedAt as number) : this.serverNow();
    return t - m.startAt - m.pauseTotal;
  }

  /** Is this client one of the players of the current match (not a spectator, not forfeited)? */
  get playing(): boolean {
    const m = this.match;
    return !!m && !!this.you && m.phase !== 'over' && m.seats.includes(this.you) && !m.forfeited.includes(this.you);
  }

  get self(): MemberInfo | undefined {
    return this.members.find((x) => x.seat === this.you);
  }

  private syncBurst(n: number, gap: number): void {
    if (this.burstActive) return;
    this.burstActive = true;
    let i = 0;
    const one = (): void => {
      if (this.closed || i++ >= n || !this.sendNow({ t: 'sync', c: this.sched.now() })) { this.burstActive = false; return; }
      this.sched.setTimeout(one, gap);
    };
    one();
  }

  private onSync(c: number, s: number): void {
    const now = this.sched.now();
    this.m.syncSamples++;
    if (this.clock.add(now - c, s, now)) {
      this.m.clock = this.clock.info(now);
      this.emit('synced', this.m.clock);
    }
  }

  // ───────── members and peer links ─────────

  private desiredVideo(rival: MemberInfo): boolean {
    return !!this.opts.video && !!this.stream && !!this.self?.video && rival.video;
  }

  private setMembers(list: MemberInfo[]): void {
    this.members = list;
    if (this.opts.peers === 'webrtc' && !this.peersBroken && this.you) {
      for (const mem of list) {
        if (mem.seat === this.you || !mem.online) continue;
        const p = this.peers.get(mem.seat);
        const want = this.desiredVideo(mem);
        if (p && p.remoteSess === mem.sess && p.sendVideo === want) continue;
        if (p) {
          p.close();
          this.remoteVideo.delete(mem.seat);
          if (p.remoteSess === mem.sess) this.newEpoch();         // we change the link (video on or off): the rival must rebuild too
        }
        try {
          this.peers.set(mem.seat, new PeerLink(this, mem.seat, mem.sess, want, this.opts.createPeerConnection));
        } catch (err) {
          // no WebRTC here (an old browser, a locked-down webview): the Room relay carries the match
          this.peersBroken = true;
          this.log('peer links unavailable: ' + String(err));
          break;
        }
      }
      for (const [seat, p] of this.peers) if (!list.some((x) => x.seat === seat)) { p.close(); this.peers.delete(seat); this.remoteVideo.delete(seat); }
    }
    this.emit('presence', list);
    this.probeVideos();
  }

  // ───────── the friends' cameras ─────────

  private probeVideo(seat: SeatId): void {
    const mem = this.members.find((m) => m.seat === seat);
    if (!mem || seat === this.you) return;
    const link = this.peers.get(seat);
    const track = this.remoteVideo.get(seat);
    const probe: VideoProbe = {
      wanted: mem.online && this.desiredVideo(mem),
      supported: this.opts.peers === 'webrtc' && !this.peersBroken,
      flowing: !!track && track.readyState === 'live' && !track.muted,
      ice: link ? link.pc.iceConnectionState : null,
      track: !!track,
    };
    this.videos.update(seat, probe);
  }

  private probeVideos(): void {
    for (const m of this.members) if (m.seat !== this.you) this.probeVideo(m.seat);
    for (const s of this.videos.all()) if (!this.members.some((m) => m.seat === s.seat)) this.videos.forget(s.seat);
  }

  /** Where the camera link to a friend stands: off, connecting, live, or failed (and why). The match never waits for it. */
  videoStatus(seat: SeatId): VideoStatus { return this.videos.status(seat); }

  /** Every friend whose camera is wanted or was: the ones to draw a note and a retry button for. */
  videoStatuses(): VideoStatus[] { return this.videos.all(); }

  /**
   * The picture of a friend's camera as it came in (the stream of their video track), null while there is none. A page that starts
   * to draw after the track arrived (the stage of a race, opened from the room's page) takes it from here, not from the 'track' event.
   */
  videoStream(seat: SeatId): MediaStream | null {
    const track = this.remoteVideo.get(seat);
    return track ? (this.trackStreams.get(track) ?? null) : null;
  }

  /**
   * "Try again": a brand new attempt at the camera links (fresh servers, new epoch on both sides) for the friend given, or for
   * every friend whose link failed. False when there was nothing to try or the last try was a moment ago. The match is not touched.
   */
  retryVideo(seat?: SeatId): boolean {
    if (this.closed) return false;
    const seats = seat !== undefined ? [seat] : this.videos.all().filter((s) => s.state === 'failed').map((s) => s.seat);
    let any = false;
    for (const s of seats) if (this.videos.retry(s)) any = true;
    if (!any) return false;
    // The epoch belongs to this client, not to one link: a new one makes every friend rebuild theirs, so ours are rebuilt too.
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.remoteVideo.clear();
    void this.renewIce().then(() => {
      if (this.closed) return;
      // a link made while the servers were on their way (a presence update) still has the old epoch: it goes too
      for (const p of this.peers.values()) p.close();
      this.peers.clear();
      this.remoteVideo.clear();
      this.newEpoch();
      this.setMembers(this.members);
    });
    return true;
  }

  /** A new peer-connection epoch: every rival rebuilds its link to us. */
  private newEpoch(): void {
    this.sess = randomId(this.random);
    this.sendNow({ t: 'sess', sess: this.sess });       // offline: the next hello carries the new epoch
  }

  /** Replaces the camera track in every running link (no renegotiation). */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    this.stream = new MediaStream([track]);
    for (const p of this.peers.values()) await p.replaceTrack(track);
  }

  // ───────── fast game state ─────────

  /** The ghost and the live score at about 15 Hz: peer channel when healthy, Room relay when not, both while degraded. */
  sendState(d: unknown): void {
    const env: StateEnvelope = { q: ++this.stSeq, s: this.tab, ts: this.serverNow(), d };
    const text = JSON.stringify(env);
    this.m.stSent++;
    let viaDc = false;
    for (const p of this.peers.values()) if (p.sendState(text)) { viaDc = true; this.m.dcSent++; }
    // degraded: no open channel, or a rival has gone quiet on it. The receiver drops duplicates by sequence number.
    const degraded = !viaDc || [...this.peers.values()].some((p) => p.stale);
    if (degraded && this.sendNow({ t: 'relay', d: env })) this.m.relaySent++;
  }

  /** A message for the rivals' reliable control channel (rarely needed; the Room is the reliable path). */
  sendCtrl(d: unknown): void {
    const text = JSON.stringify(d);
    for (const p of this.peers.values()) p.sendCtrl(text);
  }

  onState(from: SeatId, raw: string): void {
    let env: unknown;
    try { env = JSON.parse(raw); } catch { return; }
    this.onStateEnvelope(from, env, 'dc');
  }

  private onStateEnvelope(from: SeatId, env: unknown, path: 'dc' | 'relay'): void {
    if (typeof env !== 'object' || env === null) return;
    const e = env as Partial<StateEnvelope>;
    if (typeof e.q !== 'number' || typeof e.s !== 'string' || typeof e.ts !== 'number') return;
    const last = this.lastSq.get(from);
    if (last && last.s === e.s && e.q <= last.q) { this.m.stDup++; return; }
    this.lastSq.set(from, { s: e.s, q: e.q });
    const now = this.sched.now();
    const p = this.peers.get(from);
    const prevAt = this.lastStateAt.get(from);
    if (prevAt !== undefined) {
      const gap = now - prevAt;
      if (gap > this.m.maxGap) this.m.maxGap = gap;
      if (gap > 400) this.m.gaps.push(Math.round(gap));
    }
    this.lastStateAt.set(from, now);
    if (p) { p.lastMsg = now; }
    if (path === 'dc') this.m.stRecvDc++; else this.m.stRecvRelay++;
    this.emit('state', { from, d: e.d, path, latency: this.serverNow() - e.ts });
  }

  // ───────── the 250 ms tick ─────────

  private armTick(): void {
    if (this.closed) return;
    this.tickTimer = this.sched.setTimeout(() => { this.tick(); this.armTick(); }, TICK_MS);
  }

  private tick(): void {
    const now = this.sched.now();
    // Half-open detection (a Wi-Fi to 4G hand-over leaves a TCP connection that never closes): ping every 2 s in a
    // match, 5 s otherwise; no pong for three periods drops the socket and reconnects.
    const live = !!this.match && this.match.phase !== 'over';
    const period = live ? PING_MATCH_MS : PING_LOBBY_MS;
    const ws = this.ws;
    // A network that swallows the connection request (a black hole) leaves a WebSocket "connecting" for a minute or
    // more in a browser. Give up after a few seconds and ask again: the next attempt may take another path.
    if (ws && ws.readyState === WS_CONNECTING && this.connectAt) {
      const limit = (live ? CONNECT_MATCH_MS : CONNECT_LOBBY_MS) + Math.min(Math.max(0, this.attempt - 1), 3) * 1000;
      if (now - this.connectAt > limit) {
        this.log(`connection attempt got no answer for ${Math.round(now - this.connectAt)} ms: trying again`);
        this.m.deadSockets++;
        this.dropSocket();
      }
    }
    if (ws && ws.readyState === WS_OPEN) {
      if (!this.lastPing || now - this.lastPing > period) { this.lastPing = now; this.m.pings++; try { ws.send('ping'); } catch { /* closing */ } }
      if (this.lastPong && now - this.lastPong > period * 3 + 500) {
        this.log(`no pong: reconnecting (last pong ${Math.round(now - this.lastPong)} ms ago, last message ${Math.round(now - this.lastMsgIn)} ms ago)`);
        this.m.deadSockets++;
        this.dropSocket();
      }
    }
    this.updateSlew();
    // a room that waits for a lapsed Pro proof: the app may have renewed its token since the Room said so (it says it only once)
    if (this.online && this.room?.pro?.ok === false) this.proWaiting(this.room);
    for (const p of this.peers.values()) p.watch();
    this.probeVideos();
    if (this.pendingFinal && this.online && now - this.finalAt > FINAL_RESEND_MS) { this.finalAt = now; this.sendNow(this.pendingFinal); }
    if (this.online && now - this.lastClockTry > CLOCK_REFRESH_MS) {
      this.lastClockTry = now;
      // a first estimate built on slow round trips is improved at once, a few times
      if (!this.clock.good && this.clockRetries < 4) { this.clockRetries++; this.syncBurst(6, 70); } else { if (this.clock.good) this.clockRetries = 0; this.syncBurst(2, 70); }
    }
  }

  /** Link statistics for tests and the connection indicator. */
  async stats(): Promise<LinkStats[]> {
    const out: LinkStats[] = [];
    for (const p of this.peers.values()) out.push(await p.stats());
    return out;
  }

  get peerLinks(): ReadonlyMap<SeatId, PeerLink> {
    return this.peers;
  }
}
