// LiveRace: what a page calls to race a friend (or three) live. One object covers the whole flow the player sees:
// make an invite or open one, wait in the lobby, press ready, race, see the result, rematch. It wraps LiveClient (the
// socket, clock, peer links) with the pieces every page would otherwise write again and get slightly wrong: the
// identity, ticket renewal, the course from the seed, the player's own outcomes (kept across a reload and a reconnect),
// the final list at the end, a monotonic race clock, the ghost at 15 Hz, pausing while the tab is hidden, and one
// state machine for the screens.
//
//   const race = await LiveRace.host({ who, gameId: 'squat-flap', durationMs: 45_000 });  // or LiveRace.join({ who, invite })
//   race.invite.link / race.invite.code / race.invite.qrSvg()          what to show and share
//   race.on('lobby', (v) => ...)      members, ready flags, host, seats left    (the Room starts by itself when all are ready)
//   race.ready()                      the ready button
//   race.on('state', ({ state }) => ...)   connecting | lobby | countdown | racing | paused | settling | result | closed
//   race.on('start', ({ course }) => ...) a match begins (or this page rejoined one): obstacles { id, t } by match time
//   in the game loop:  const t = race.time();  for each obstacle the player has just passed or hit: race.report(ob.id, 'pass' | 'hit');
//                      race.sendGhost(frame);  race.on('ghost', ({ from, d }) => ...)
//   race.on('result', ({ result, place, won }) => ...)      the same on every device
//   race.rematch()                    ready again after a result
//
// The Room is the authority: it keeps the clock, the pauses and the scores. A page that reloads or loses its network
// comes back into the same match; what it reported meanwhile is resent and the final list heals any gap.
import {
  type AgeBand, type ChatRejectReason, type MatchInfo, type MatchResult, type MemberInfo, type NetPauseReason, type ObstacleResult,
  type Outcome, type PresetId, type ReactionId, type ReportReason, type RoomCode, type RoomErrorCode, type RoomInfo, type RoomPreview,
  type SeatId, type SeatScore, type JoinGrant,
} from '../types/net.ts';
import { LiveApiError, createRoom, fetchIce, joinRoom, previewRoom, type Identity } from './api.ts';
import { LiveClient, type FatalReason, type LiveClientOptions } from './client.ts';
import { codeFromInvite, inviteLink } from './codes.ts';
import { loadBlocks, saveBlocks } from './identity.ts';
import { encodeQr, qrToSvg, type QrSvgOptions } from './qr.ts';
import { Emitter, realScheduler, type Scheduler } from './runtime.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from './schedule.ts';

export type RaceState = 'connecting' | 'lobby' | 'countdown' | 'racing' | 'paused' | 'settling' | 'result' | 'closed';
export type RaceCloseReason = FatalReason | 'left' | 'disposed';

/** What to show and share for a room. */
export interface Invite {
  code: RoomCode;
  /** `<origin>/r/<CODE>`: the page at that address calls LiveRace.join with it. */
  link: string;
  /** The link as a QR code (SVG text; pass `label` for an accessible name). */
  qrSvg(o?: QrSvgOptions): string;
}

/** Everything a lobby screen draws. */
export interface LobbyView {
  you: SeatId;
  members: MemberInfo[];
  room: RoomInfo;
  isHost: boolean;
  /** Everyone in the room has pressed ready. With two or more members the Room then starts the countdown by itself. */
  allReady: boolean;
  /** Seats still free in this room. */
  openSeats: number;
  /** A match is running without this player (they joined late): they wait for the next one. */
  watching: boolean;
  /** The camera toggle may be offered: a private room and an adult player (the friend must be an adult who also switches it on). */
  canVideo: boolean;
}

export interface RaceResult {
  result: MatchResult;
  you: SeatId;
  /** 1 for first; null when this player has no place (forfeited, or no contest). */
  place: number | null;
  /** The single winner is this player. */
  won: boolean;
  /** First place is shared (or nobody has one) and this player is among those without a loser. */
  draw: boolean;
  /** This player's own seat forfeited. */
  forfeited: boolean;
  /** This player's score as the Room counted it. */
  score: SeatScore | null;
}

export interface RaceEvents {
  state: { state: RaceState; prev: RaceState };
  lobby: LobbyView;
  start: { match: MatchInfo; course: readonly Obstacle[]; /** This page rejoined a match that was already running. */ resumed: boolean };
  /** Someone paused or resumed the match; `reasons` says who holds it and why. */
  pause: { paused: boolean; reasons: Record<SeatId, NetPauseReason>; match: MatchInfo };
  forfeit: { seat: SeatId; mine: boolean };
  /** A rival's fast state at about 15 Hz (the ghost): whatever the rival's page passed to sendGhost. */
  ghost: { from: SeatId; d: unknown; path: 'dc' | 'relay'; latencyMs: number };
  /** This player's time ran out and the outcome list went to the Room. */
  finished: { match: MatchInfo; outcomes: ObstacleResult[] };
  result: RaceResult;
  /** The connection to the Room went away or came back; `offlineMs` is how long it has been away. */
  connection: { online: boolean; offlineMs: number };
  closed: { reason: RaceCloseReason; code: number };
  chat: { from: SeatId; text: string; at: number };
  preset: { from: SeatId; id: PresetId; at: number };
  react: { from: SeatId; id: ReactionId; at: number };
  chatRejected: { reason: ChatRejectReason; retryAt?: number };
  blocked: { seat: SeatId };
  reported: { seat: SeatId };
  removed: { reason: 'kicked' | 'banned' | 'dropped' };
  track: { from: SeatId; stream: MediaStream };
  roomError: { code: RoomErrorCode };
}

export interface RaceOptions {
  /** Who is playing (name and age band are self-declared once; see identity.ts). */
  who: Identity;
  /** Origin of the site; defaults to location.origin. */
  origin?: string;
  /** Offer this camera to friends who also opt in (adults, private rooms; the Room decides). Off by default. */
  stream?: MediaStream | null;
  video?: boolean;
  /** 'webrtc' (default): the ghost and video go peer to peer when they can. 'none': everything through the Room. */
  peers?: 'webrtc' | 'none';
  /** Pause the match for everyone while this tab is hidden (default true). Turn off when the game's own session already does it. */
  pauseWhenHidden?: boolean;
  /** Persist block keys (default: localStorage through identity.ts). */
  blocks?: { load(): string[]; save(keys: string[]): void };
  /** Replaces fetch for the HTTP calls; replaces the client's scheduler, sockets and the rest in tests. */
  fetcher?: typeof fetch;
  client?: Partial<LiveClientOptions>;
}

export interface HostOptions extends RaceOptions {
  gameId: string;
  /** 2 to 4 seats (default 2). */
  size?: number;
  durationMs?: number;
  /** 'private' (default): friends by link, code or QR. 'public': the lobby directory; strangers play as ghosts only. */
  kind?: 'private' | 'public';
  band?: string | null;
}

export interface JoinOptions extends RaceOptions {
  /** The invite link or the typed code (case, spaces and dashes are forgiven). */
  invite: string;
}

const GHOST_GAP_MS = 60;
const LOOP_MS = 100;

/** Reason codes of the HTTP calls that a page can fix by trying again. */
export function isRetryable(e: unknown): boolean {
  return e instanceof LiveApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
}

export class LiveRace extends Emitter<RaceEvents> {
  readonly client: LiveClient;
  readonly invite: Invite;
  readonly who: Identity;
  readonly origin: string;

  private readonly sched: Scheduler;
  private readonly opts: RaceOptions;
  private readonly code: RoomCode;
  private st: RaceState = 'connecting';
  private courseList: Obstacle[] = [];
  private courseMatch: string | null = null;
  private readonly outcomes = new Map<number, Outcome>();
  private high = 0;
  private finalFor: string | null = null;
  private resultFor: string | null = null;
  private lastResult: RaceResult | null = null;
  private lastGhostAt = -Infinity;
  private offlineSince: number | null = null;
  private loop: unknown = null;
  private done = false;
  private lobbyKey = '';
  private visibilityOff: (() => void) | null = null;
  private closedWhy: RaceCloseReason | null = null;

  private constructor(grant: JoinGrant, opts: RaceOptions) {
    super();
    this.opts = opts;
    this.who = opts.who;
    this.origin = (opts.origin ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '');
    this.code = grant.code;
    this.sched = opts.client?.sched ?? realScheduler;
    const origin = this.origin;
    const fetcher = opts.fetcher;
    const store = opts.blocks ?? { load: () => loadBlocks(), save: (k: string[]) => saveBlocks(k) };
    const link = grant.link || inviteLink(origin, grant.code);
    this.invite = { code: grant.code, link, qrSvg: (o) => qrToSvg(encodeQr(link, 'M'), o) };
    this.client = new LiveClient({
      grant, origin,
      refreshTicket: () => joinRoom(origin, grant.code, opts.who, fetcher),
      ice: () => fetchIce(origin, fetcher),
      blocks: store.load(),
      video: !!opts.video && !!opts.stream,
      stream: opts.stream ?? null,
      peers: opts.peers ?? 'webrtc',
      ...opts.client,
    });
    this.wire(store);
  }

  // ───────── making and opening a room ─────────

  /** Creates a room and a seat in it. Rejects with LiveApiError (see isRetryable) when the Worker refuses or cannot be reached. */
  static async host(o: HostOptions): Promise<LiveRace> {
    const origin = o.origin ?? (typeof location !== 'undefined' ? location.origin : '');
    const grant = await createRoom(origin, o.who, { kind: o.kind ?? 'private', gameId: o.gameId, size: o.size ?? 2, durationMs: o.durationMs, band: o.band ?? null }, o.fetcher);
    return LiveRace.attach(grant, o);
  }

  /** Takes a seat in the room an invite points at. Rejects with LiveApiError: bad_code, no_room, full, not_allowed, banned, rate_limited, network, timeout... */
  static async join(o: JoinOptions): Promise<LiveRace> {
    const code = codeFromInvite(o.invite);
    if (!code) throw new LiveApiError(400, 'bad_code');
    const origin = o.origin ?? (typeof location !== 'undefined' ? location.origin : '');
    const grant = await joinRoom(origin, code, o.who, o.fetcher);
    return LiveRace.attach(grant, o);
  }

  /** What an invite points at (game, seats, whether it is full), before asking the visitor for a name. */
  static preview(invite: string, o: { origin?: string; fetcher?: typeof fetch } = {}): Promise<RoomPreview> {
    const code = codeFromInvite(invite);
    if (!code) return Promise.reject(new LiveApiError(400, 'bad_code'));
    const origin = o.origin ?? (typeof location !== 'undefined' ? location.origin : '');
    return previewRoom(origin, code, o.fetcher);
  }

  /** Starts a race session from a grant the caller already holds (tests; a lobby that hands out grants). */
  static async attach(grant: JoinGrant, o: RaceOptions): Promise<LiveRace> {
    const r = new LiveRace(grant, o);
    await r.client.start();
    return r;
  }

  // ───────── what the screens read ─────────

  get state(): RaceState { return this.st; }
  get you(): SeatId | null { return this.client.you; }
  get members(): readonly MemberInfo[] { return this.client.members; }
  get room(): RoomInfo | null { return this.client.room; }
  get match(): MatchInfo | null { return this.client.match; }
  get isHost(): boolean { const y = this.client.you; return !!y && this.client.room?.host === y; }
  get course(): readonly Obstacle[] { return this.courseList; }
  get result(): RaceResult | null { return this.lastResult; }
  get closedReason(): RaceCloseReason | null { return this.closedWhy; }

  /** This player's outcomes so far (the Room's copy merged with what was reported here). */
  get reported(): ReadonlyMap<number, Outcome> { return this.outcomes; }

  /** This player's score so far, counted like the Room counts it. */
  score(): SeatScore { return scoreOf(this.courseList, this.outcomeList()); }

  /** Milliseconds the connection has been down, 0 when it is up. */
  offlineMs(): number { return this.offlineSince === null ? 0 : Math.max(0, this.sched.now() - this.offlineSince); }

  /**
   * The race clock in ms: 0 until the countdown is over, then the Room's match time. It never goes backwards (the Room's
   * clock steps back during the 3-2-1 after a pause, which is when a game should hold still), so it can drive the game.
   */
  time(): number {
    const raw = this.client.match ? this.client.matchTime() : 0;
    if (raw > this.high) this.high = raw;
    return this.high;
  }

  /** The Room's own match time (negative before time zero, steps back after a pause). Most pages want time(). */
  rawMatchTime(): number { return this.client.matchTime(); }

  /** Milliseconds left of the 3-2-1 (before the start and after a pause), 0 when the race is on. */
  countdownMs(): number {
    const m = this.client.match;
    if (!m || m.phase !== 'running') return 0;
    const now = this.client.serverNow();
    const left = Math.max(m.startAt + m.pauseTotal - now, m.resumeAt !== null ? m.resumeAt - now : 0);
    return Math.max(0, left);
  }

  // ───────── what the buttons do ─────────

  /** The ready button. The Room starts the countdown once everyone present is ready. */
  ready(on = true): void {
    if (on) this.resultFor = this.client.match?.id ?? this.resultFor;     // leaving the result screen
    this.client.setReady(on);
    this.update();
  }

  /** Ready again after a result. */
  rematch(): void { this.ready(true); }

  /** Host only, between matches: the game and the length. Everyone's ready flag is cleared. */
  configure(c: { gameId?: string; durationMs?: number }): void { this.client.configure(c); }

  /** Host only, private rooms. */
  kick(seat: SeatId): void { this.client.kick(seat); }

  /**
   * Records what happened at one obstacle. The first outcome per obstacle counts (also in the Room). Returns false
   * for an unknown obstacle, one already reported, or when no race is going on.
   */
  report(ob: number, k: Outcome): boolean {
    const m = this.client.match;
    if (!m || m.phase === 'over' || this.finalFor === m.id || this.courseMatch !== m.id) return false;
    if (this.outcomes.has(ob) || !this.courseList.some((o) => o.id === ob)) return false;
    this.outcomes.set(ob, k);
    this.client.reportResult(ob, k);
    return true;
  }

  /** The ghost: any small JSON-able frame (pose points, the score) for the rivals' screens; sent at most about 15 times a second. */
  sendGhost(frame: unknown): boolean {
    const m = this.client.match;
    if (!m || m.phase === 'over') return false;
    const now = this.sched.now();
    if (now - this.lastGhostAt < GHOST_GAP_MS) return false;
    this.lastGhostAt = now;
    this.client.sendState(frame);
    return true;
  }

  /** The game's own pauses (camera lost, calibration, framing, the player's pause button): the Room pauses everyone while any is held. */
  pause(reason: NetPauseReason): void { this.client.pause(reason); }
  unpause(reason?: NetPauseReason): void { this.client.unpause(reason); }

  /** Text chat (adults in a private room) or presets and reactions (everyone else). The Room says why a line was refused through `chatRejected`. */
  chat(text: string): void { this.client.chat(text); }
  sendPreset(id: PresetId): void { this.client.preset(id); }
  react(id: ReactionId): void { this.client.react(id); }
  /**
   * Camera on or off for friends who also opted in (off by default). A page that had no camera when the race began passes
   * the stream the first time it switches on; the links to the friends are rebuilt with the picture.
   */
  setVideo(on: boolean, stream?: MediaStream | null): void {
    if (stream !== undefined) this.client.stream = stream;
    this.client.setVideo(on);
  }
  block(seat: SeatId): void { this.client.block(seat); }
  reportPlayer(seat: SeatId, reason: ReportReason, alsoBlock: boolean): void { this.client.reportPlayer(seat, reason, alsoBlock); }

  /** Leaving on purpose: during a match the seat forfeits at once. Not for page unload (a reload is not a leave). */
  leave(): void {
    if (this.done) return;
    this.client.leave();
    this.shutdown('left', 1000);
  }

  /** Stops without telling the Room (the page is going away, or another tab took over). */
  dispose(): void {
    if (this.done) return;
    this.client.stop();
    this.shutdown('disposed', 1000);
  }

  // ───────── wiring ─────────

  private outcomeList(): ObstacleResult[] {
    return [...this.outcomes].map(([ob, k]) => ({ ob, k })).sort((a, b) => a.ob - b.ob);
  }

  private wire(store: { save(keys: string[]): void }): void {
    const c = this.client;
    c.on('welcome', () => { this.emitLobby(); this.update(); });
    c.on('presence', () => { this.emitLobby(); this.update(); });
    c.on('room', () => { this.emitLobby(); this.update(); });
    c.on('match', (d) => this.onMatch(d.match, d.mine, d.why === 'welcome'));
    c.on('phase', (d) => this.onPhase(d.why, d.match));
    c.on('settling', () => { this.finishNow(); this.update(); });
    c.on('forfeit', (d) => this.emit('forfeit', { seat: d.seat, mine: d.seat === c.you }));
    c.on('result', (r) => this.onResult(r));
    c.on('status', (s) => this.onStatus(s.state));
    c.on('fatal', (d) => this.shutdown(d.reason, d.code));
    c.on('state', (d) => this.emit('ghost', { from: d.from, d: d.d, path: d.path, latencyMs: d.latency }));
    c.on('chat', (d) => this.emit('chat', d));
    c.on('preset', (d) => this.emit('preset', d));
    c.on('react', (d) => this.emit('react', d));
    c.on('chatRejected', (d) => this.emit('chatRejected', d));
    c.on('blocked', (d) => { try { store.save(c.blocks); } catch { /* storage is optional */ } this.emit('blocked', { seat: d.seat }); });
    c.on('reported', (d) => this.emit('reported', d));
    c.on('removed', (d) => this.emit('removed', d));
    c.on('track', (d) => this.emit('track', { from: d.from, stream: d.stream }));
    c.on('roomError', (d) => this.emit('roomError', d));
    if (this.opts.pauseWhenHidden !== false && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVis = (): void => {
        if (document.visibilityState !== 'hidden') { c.unpause('hidden'); return; }          // always: a pause must never outlive the match
        if (this.st === 'countdown' || this.st === 'racing' || this.st === 'paused') c.pause('hidden');
      };
      document.addEventListener('visibilitychange', onVis);
      this.visibilityOff = () => document.removeEventListener('visibilitychange', onVis);
    }
  }

  private onStatus(s: 'connecting' | 'online' | 'reconnecting' | 'stopped'): void {
    if (s === 'reconnecting') {
      if (this.offlineSince === null) { this.offlineSince = this.sched.now(); this.emit('connection', { online: false, offlineMs: 0 }); }
    } else if (s === 'online') {
      const ms = this.offlineMs();
      const wasOffline = this.offlineSince !== null;
      this.offlineSince = null;
      if (wasOffline) this.emit('connection', { online: true, offlineMs: ms });
    }
    this.update();
  }

  private onMatch(match: MatchInfo, mine: ObstacleResult[], resumed: boolean): void {
    if (this.courseMatch !== match.id) {
      this.courseMatch = match.id;
      this.courseList = makeSchedule(match.seed, match.duration, specFor(match.gameId));
      this.outcomes.clear();
      this.high = 0;
      this.finalFor = null;
      this.resultFor = null;
      this.lastResult = null;
    }
    for (const e of mine) if (!this.outcomes.has(e.ob)) this.outcomes.set(e.ob, e.k);     // the Room's copy is the one that counts
    this.startLoop();
    this.update();
    this.emit('start', { match, course: this.courseList, resumed });
  }

  private onPhase(why: string, match: MatchInfo): void {
    if (why === 'paused' || why === 'resumed' || (why === 'welcome' && match.phase === 'paused')) {
      this.emit('pause', { paused: match.phase === 'paused', reasons: match.reasons, match });
    }
    // a page that reloaded after the match ended still shows the result it missed
    if (why === 'welcome' && match.phase === 'over' && match.result && this.client.you && match.seats.includes(this.client.you) && this.resultFor !== match.id) {
      this.onResult(match.result);
      return;
    }
    this.update();
  }

  private onResult(result: MatchResult): void {
    const you = this.client.you ?? '';
    if (this.lastResult && this.lastResult.result.mid === result.mid) return;
    this.stopLoop();
    this.resultFor = null;
    const place = result.places[you] ?? null;
    const forfeited = result.forfeited.includes(you);
    const best = Object.values(result.places).filter((p) => p === 1).length;
    const r: RaceResult = {
      result, you, place, forfeited, won: result.winner === you,
      draw: !forfeited && place === 1 && best > 1, score: result.scores[you] ?? null,
    };
    this.lastResult = r;
    this.update();
    this.emit('result', r);
  }

  // ───────── the race loop (100 ms) ─────────

  private startLoop(): void {
    this.stopLoop();
    this.tick();
  }

  private stopLoop(): void {
    if (this.loop !== null) this.sched.clearTimeout(this.loop);
    this.loop = null;
  }

  private tick(): void {
    this.loop = null;
    if (this.done) return;
    const m = this.client.match;
    if (!m || m.phase === 'over') return;
    this.time();
    if (m.phase === 'running' && this.high >= m.duration) this.finishNow();
    this.update();
    this.loop = this.sched.setTimeout(() => this.tick(), LOOP_MS);
  }

  /** Time is up for this player: the full list goes to the Room (resent by the client until the result arrives). */
  private finishNow(): void {
    const m = this.client.match;
    if (!m || this.finalFor === m.id || this.courseMatch !== m.id || !this.client.playing) return;
    this.finalFor = m.id;
    const outcomes = this.outcomeList();
    this.client.finish(outcomes);
    this.emit('finished', { match: m, outcomes });
  }

  // ───────── state ─────────

  private compute(): RaceState {
    const c = this.client;
    if (this.done || c.closed) return 'closed';
    if (!c.you) return 'connecting';
    const m = c.match;
    if (!m) return 'lobby';
    if (m.phase === 'over') return this.lastResult && this.lastResult.result.mid === m.id && this.resultFor !== m.id ? 'result' : 'lobby';
    if (!c.playing) return 'lobby';
    if (m.phase === 'paused') return 'paused';
    if (m.phase === 'settling' || this.finalFor === m.id) return 'settling';       // this player is done, the Room waits for the others
    return this.countdownMs() > 0 ? 'countdown' : 'racing';
  }

  private update(): void {
    const prev = this.st;
    const next = this.compute();
    if (next === prev) return;
    this.st = next;
    this.emit('state', { state: next, prev });
  }

  private lobbyView(): LobbyView | null {
    const c = this.client;
    const room = c.room;
    if (!c.you || !room) return null;
    const members = c.members;
    return {
      you: c.you, members: [...members], room, isHost: room.host === c.you,
      allReady: members.length > 0 && members.every((m) => m.ready), openSeats: Math.max(0, room.size - members.length),
      watching: room.phase === 'playing' && !c.playing,
      canVideo: room.video && this.who.age === 'adult',
    };
  }

  private emitLobby(): void {
    const v = this.lobbyView();
    if (!v) return;
    const key = JSON.stringify([v.members, v.room, v.watching]);
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    this.emit('lobby', v);
  }

  private shutdown(reason: RaceCloseReason, code: number): void {
    if (this.done) return;
    this.done = true;
    this.closedWhy = reason;
    this.stopLoop();
    this.visibilityOff?.();
    this.visibilityOff = null;
    this.update();
    this.emit('closed', { reason, code });
  }
}
