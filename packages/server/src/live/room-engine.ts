// The Room's brain: one room of 2-4 seats, the single authority for members, presence, the match clock, the seed,
// pauses, results and the rules around them (tech.md 2.4 to 2.11, 5, 9.2). It has no Cloudflare types: sockets,
// storage, the alarm and the clock come in through EngineHost, so the unit tests run it in Node with fake sockets
// and a fake clock, and room.ts is a thin adapter for the Durable Object.
//
// Rules the code keeps:
//  - Everything is synchronous after construction. State is read from storage once (RoomEngine.create); every change
//    marks keys dirty and commit() writes them at the end of the operation. Results are acknowledged at once and
//    flushed in batches (the end-of-match final list heals anything lost in a crash).
//  - A player is a device id (pid, secret, from the signed ticket) and, inside this room, a seat id. Seat ids are the
//    only identity other players ever see.
//  - One socket per player is current (`mem.conn`). A newer tab replaces an older one (close 4000) and a replaced tab
//    can never come back. Messages from a socket that is not current are ignored.
//  - A socket that drops pauses nothing for offlineDebounceMs; hello adopts the pause reasons the client reports now.
//  - Time-driven changes happen in tick(), which the adapter calls from the alarm and which also runs before every
//    message, so a late alarm cannot make the room wrong.
import {
  CLOSE, MAX_SEATS, MIN_SEATS, MIN_DURATION_MS, MAX_DURATION_MS, NET_PROTOCOL,
  type AckRejection, type AgeBand, type ChatMode, type ClientMessage, type MatchInfo, type MatchPhase, type MatchResult,
  type MemberInfo, type NetPauseReason, type ObstacleResult, type PresetId, type ReactionId, type ReportReason,
  type ResultReason, type RoomCode, type RoomConfig, type RoomErrorCode, type RoomInfo, type RoomKind, type RoomMessage,
  type RoomPreview, type RoomSummary, type SeatId, type TicketClaims,
} from '../../../core/types/net.ts';
import { makeSchedule, scoreOf, specFor, places as placesOf, winnerOf, type Obstacle } from '../../../core/net/schedule.ts';
import { outcomeString } from '../../../core/net/ghost.ts';
import { checkChat, checkName, CHAT_INTERVAL_MS } from '../../../core/net/chat-filter.ts';
import { MAX_BLOCKS, parseClientMessage } from '../../../core/net/validate.ts';
import type { RoomReport } from './hooks.ts';
import {
  CHAT_LOG_LINES, DEFAULT_TIMING, EARLY_MS, FINAL_EARLY_MS, MAX_PAUSES, MAX_REPLACED_TABS, MAX_REPORTS_PER_ROOM,
  MAX_USER_PAUSES, MUTE_MS, PRESET_MIN_GAP_MS, RATE, REPORTS_TO_MUTE, type Timing,
} from './config.ts';

// ───────── host interface ─────────

/** Who a socket is. Lives in the socket's attachment, so it survives hibernation. Kept small (2 KB limit). */
export interface ConnAtt {
  /** Connection id. */
  c: string;
  /** Device id, name, age band, block key and mute (epoch ms, 0 = none) from the signed ticket. */
  p: string;
  n: string;
  a: AgeBand;
  k: string;
  m: number;
  /** Seat and tab, set by hello. */
  s: SeatId | null;
  t: string | null;
  /** hello done. */
  h: boolean;
  /** When the socket was accepted (epoch ms): the least known about when it last spoke, after a hibernation wake. */
  at?: number;
}

export interface EngineConn {
  readonly id: string;
  att: ConnAtt;
  send(text: string): void;
  close(code: number, reason?: string): void;
  /**
   * When the platform last answered a keep-alive ping on this socket by itself (epoch ms), or null. Pings are answered
   * without waking the Room, so only the platform knows; the silent-socket sweep reads it.
   */
  heardAt?(): number | null;
}

export interface EngineHooks {
  publish?(summary: RoomSummary, pids: string[]): void;
  removed?(code: RoomCode): void;
  playing?(pid: string, inRoom: boolean, playing: boolean, gameId: string): void;
  report?(r: RoomReport): void;
  block?(pid: string, targetPid: string): void;
}

export interface EngineHost {
  now(): number;
  /** Open sockets of this room (hello or not). */
  conns(): EngineConn[];
  /** Everything stored for this room, once, at construction. */
  load(): Promise<Record<string, unknown>>;
  /** Writes these keys (fire and forget: the platform holds outgoing messages until the write is durable). */
  save(patch: Record<string, unknown>): void;
  deleteAll(): void;
  /** Wake the room at this time (epoch ms), or never (null). */
  setAlarm(at: number | null): void;
  randomU32(): number;
  uuid(): string;
  log(line: Record<string, unknown>): void;
  hooks?: EngineHooks;
}

// ───────── stored state ─────────

interface Meta {
  code: RoomCode;
  kind: RoomKind;
  size: number;
  config: RoomConfig;
  audience: AgeBand | null;
  creator: string;
  host: SeatId | null;
  createdAt: number;
  activityAt: number;
  nextSeat: number;
  banned: string[];
  matches: number;
  emptySince: number | null;
}

interface MemberRec {
  pid: string;
  seat: SeatId;
  name: string;
  age: AgeBand;
  /** This player's own block key, and the block keys they hold. */
  bk: string;
  blocks: string[];
  online: boolean;
  ready: boolean;
  sess: string;
  video: boolean;
  tab: string;
  replaced: string[];
  /** The current socket's connection id. */
  conn: string;
  offlineAt: number | null;
  offlineHandled: boolean;
  joinedAt: number;
  mutedUntil: number;
}

interface MatchRec {
  id: string;
  seed: number;
  gameId: string;
  startAt: number;
  duration: number;
  phase: MatchPhase;
  pausedAt: number | null;
  resumeAt: number | null;
  pauseTotal: number;
  reasons: Record<SeatId, NetPauseReason>;
  /** When each seat's current reason was first set (the grace runs from here). */
  reasonAt: Record<SeatId, number>;
  seats: SeatId[];
  forfeited: SeatId[];
  result: MatchResult | null;
  pauses: Record<SeatId, number>;
  userPauses: Record<SeatId, number>;
  finals: Record<SeatId, true>;
  settleUntil: number | null;
}

interface ChatLine { seat: SeatId; name: string; text: string; at: number }
interface ReportRec { from: SeatId; target: SeatId; reason: ReportReason; at: number }

type DirtyKey = 'meta' | 'members' | 'match' | 'ev' | 'chat' | 'reports';
type Hello = Extract<ClientMessage, { t: 'hello' }>;

export interface InitInput {
  code: RoomCode;
  kind: RoomKind;
  size: number;
  config: RoomConfig;
  audience: AgeBand | null;
  /** Device id of the creator: the first host. */
  creator: string;
}

export type InitResult = { ok: true } | { ok: false; error: 'exists' | 'bad_config' | 'bad_size' | 'bad_audience' };
export type CheckResult = { ok: true; preview: RoomPreview } | { ok: false; error: 'no_room' | 'full' | 'banned' | 'not_allowed' };

/** Token buckets per socket (general, relay, signal), the messages counted in this wall-clock second, bad messages, the second a warning was last sent. */
interface RateRec { sec: number; n: number; at: number; general: number; relay: number; signal: number; bad: number; warned: number }

const GAME_RE = /^[a-z0-9-]{1,40}$/;
const BAND_RE = /^[a-z0-9-]{1,16}$/;

export class RoomEngine {
  private readonly host: EngineHost;
  private readonly timing: Timing;
  private meta: Meta | null;
  private members: Record<string, MemberRec>;
  private match: MatchRec | null;
  private events: Record<SeatId, ObstacleResult[]>;
  private chat: ChatLine[];
  private reports: ReportRec[];
  private dirty = new Set<DirtyKey>();
  /** Results and chat lines waiting for the next batched write; evDirtyAt is when the first of them arrived. */
  private pendingEv = false;
  private pendingChat = false;
  private evDirtyAt: number | null = null;
  private metaSavedAt = 0;
  /** The alarm time last handed to the host (undefined: not known yet, set it at the next opportunity). */
  private armed: number | null | undefined = undefined;
  private lastPub = '';
  private rates = new Map<string, RateRec>();
  private lastChatAt = new Map<SeatId, number>();
  private lastPresetAt = new Map<SeatId, number>();
  private sched: { key: string; list: Obstacle[]; byId: Map<number, Obstacle> } | null = null;
  /** When this engine last received a message on each socket (memory only; after a hibernation wake a socket counts from its last keep-alive, or from when it was accepted). */
  private heard = new Map<string, number>();
  /** When the silent-socket sweep last ran; null while no socket is open. */
  private lastSweep: number | null = null;

  private constructor(host: EngineHost, timing: Timing, raw: Record<string, unknown>) {
    this.host = host;
    this.timing = timing;
    this.meta = (raw.meta as Meta | null | undefined) ?? null;
    this.members = (raw.members as Record<string, MemberRec> | undefined) ?? {};
    this.match = (raw.match as MatchRec | null | undefined) ?? null;
    this.events = (raw.ev as Record<SeatId, ObstacleResult[]> | undefined) ?? {};
    this.chat = (raw.chat as ChatLine[] | undefined) ?? [];
    this.reports = (raw.reports as ReportRec[] | undefined) ?? [];
  }

  static async create(host: EngineHost, timing: Timing = DEFAULT_TIMING): Promise<RoomEngine> {
    const engine = new RoomEngine(host, timing, await host.load());
    engine.reconcile();
    return engine;
  }

  /**
   * After a restart (a deploy) the stored members still say "online" but their sockets are gone, and the platform may
   * not report the closes. A member without a live socket is offline from now on: the debounce, the pause and the
   * grace then work as if the socket had closed at this moment.
   */
  private reconcile(): void {
    if (!this.meta) return;
    const live = new Set(this.host.conns().filter((c) => c.att.h).map((c) => c.id));
    const now = this.now();
    let changed = false;
    for (const m of Object.values(this.members)) {
      if (m.online && !live.has(m.conn)) { m.online = false; m.offlineAt = now; m.offlineHandled = false; changed = true; }
    }
    if (changed) { this.dirty.add('members'); this.commit(); }
  }

  // ───────── lifecycle: init, preview, check, destroy ─────────

  get exists(): boolean {
    return this.meta !== null;
  }

  init(input: InitInput): InitResult {
    if (this.meta) return { ok: false, error: 'exists' };
    if (!Number.isInteger(input.size) || input.size < MIN_SEATS || input.size > MAX_SEATS) return { ok: false, error: 'bad_size' };
    const c = input.config;
    if (!GAME_RE.test(c.gameId) || !Number.isInteger(c.durationMs) || c.durationMs < MIN_DURATION_MS || c.durationMs > MAX_DURATION_MS
      || (c.band !== null && !BAND_RE.test(c.band))) return { ok: false, error: 'bad_config' };
    if (input.kind === 'public' && input.audience !== 'teen' && input.audience !== 'adult') return { ok: false, error: 'bad_audience' };
    const now = this.now();
    this.meta = {
      code: input.code, kind: input.kind, size: input.size, config: { gameId: c.gameId, durationMs: c.durationMs, band: input.kind === 'public' ? c.band : null },
      audience: input.kind === 'public' ? input.audience : null, creator: input.creator, host: null, createdAt: now, activityAt: now,
      nextSeat: 1, banned: [], matches: 0, emptySince: now,
    };
    this.dirty.add('meta');
    this.publish();
    this.commit();
    return { ok: true };
  }

  preview(): RoomPreview | null {
    const m = this.meta;
    if (!m) return null;
    return { code: m.code, kind: m.kind, gameId: m.config.gameId, size: m.size, players: Object.keys(this.members).length, phase: this.phase() };
  }

  summary(): RoomSummary | null {
    const m = this.meta;
    if (!m) return null;
    const mem = Object.values(this.members).sort((a, b) => a.joinedAt - b.joinedAt);
    return {
      code: m.code, kind: m.kind, gameId: m.config.gameId, band: m.config.band, audience: m.audience, size: m.size, players: mem.length,
      open: Math.max(0, m.size - mem.length), names: mem.map((x) => x.name), phase: this.phase(), updatedAt: this.now(),
    };
  }

  /** The HTTP join pre-check: can this player take a seat (or already has one)? hello decides for good. */
  check(claims: Pick<TicketClaims, 'p' | 'a' | 'k'>): CheckResult {
    const m = this.meta;
    if (!m) return { ok: false, error: 'no_room' };
    if (m.banned.includes(claims.p)) return { ok: false, error: 'banned' };
    const preview = this.preview() as RoomPreview;
    if (this.members[claims.p]) return { ok: true, preview };
    const verdict = this.admit(claims.a, claims.k, [], true);
    return verdict === 'ok' ? { ok: true, preview } : { ok: false, error: verdict };
  }

  /** Closes every socket with `code` (a deploy does this to every socket; tests use it on purpose). */
  closeAll(code: number, reason: string): void {
    for (const c of this.host.conns()) { try { c.close(code, reason); } catch { /* already closing */ } }
  }

  /** A debugging and test view of the room (never sent to players). */
  inspect(): { meta: Meta | null; members: MemberRec[]; match: MatchRec | null; events: Record<SeatId, ObstacleResult[]> } {
    return { meta: this.meta, members: Object.values(this.members), match: this.match, events: this.events };
  }

  private destroy(why: string): void {
    const m = this.meta;
    if (!m) return;
    for (const c of this.host.conns()) { try { c.close(CLOSE.NO_ROOM, why); } catch { /* ignore */ } }
    this.host.log({ evt: 'room_end', code: m.code, why, matches: m.matches });
    try { this.host.hooks?.removed?.(m.code); } catch { /* hooks never break the room */ }
    this.meta = null; this.members = {}; this.match = null; this.events = {}; this.chat = []; this.reports = [];
    this.dirty.clear(); this.pendingEv = false; this.pendingChat = false; this.evDirtyAt = null; this.sched = null;
    this.host.deleteAll();
    this.host.setAlarm(null);
    this.armed = null;
  }

  // ───────── entry points ─────────

  /** A socket was accepted with a verified ticket. Rejects it at once when the room is gone or the player is banned. */
  accept(conn: EngineConn, claims: TicketClaims): void {
    const m = this.meta;
    this.heard.set(conn.id, this.now());
    if (!m || m.code !== claims.c) { conn.close(CLOSE.NO_ROOM, 'no room'); return; }
    conn.att = { c: conn.id, p: claims.p, n: claims.n, a: claims.a, k: claims.k, m: claims.m ?? 0, s: null, t: null, h: false, at: this.now() };
    if (m.banned.includes(claims.p)) { this.send(conn, { t: 'removed', reason: 'banned' }); conn.close(CLOSE.REMOVED, 'banned'); }
  }

  message(conn: EngineConn, raw: unknown): void {
    try {
      this.heard.set(conn.id, this.now());
      this.tick();
      this.handle(conn, raw);
    } catch (e) {
      this.host.log({ evt: 'engine_error', where: 'message', error: String(e) });
      try { this.send(conn, { t: 'error', code: 'bad' }); } catch { /* ignore */ }
    } finally {
      this.commit();
    }
  }

  /** A socket closed or errored. */
  closed(conn: EngineConn): void {
    try {
      this.rates.delete(conn.id);
      this.heard.delete(conn.id);
      const att = conn.att;
      const meta = this.meta;
      if (!meta || !att.h || !att.s) return;
      const mem = this.members[att.p];
      if (!mem || mem.conn !== att.c) return;              // a replaced socket closing: nothing to do
      if (!mem.online) return;                             // already offline (the silent sweep got there first): keep the first time
      mem.online = false; mem.offlineAt = this.now(); mem.offlineHandled = false;
      this.dirty.add('members');
      this.flushEvents();
      this.broadcastPresence();
      this.publish();
    } catch (e) {
      this.host.log({ evt: 'engine_error', where: 'closed', error: String(e) });
    } finally {
      this.commit();
    }
  }

  /** The alarm fired (or a message arrived and something was already due). */
  alarm(): void {
    try {
      this.tick(true);
    } catch (e) {
      this.host.log({ evt: 'engine_error', where: 'alarm', error: String(e) });
    } finally {
      this.commit();
    }
  }

  // ───────── message dispatch ─────────

  private handle(conn: EngineConn, raw: unknown): void {
    const meta = this.meta;
    if (!meta) { conn.close(CLOSE.NO_ROOM, 'no room'); return; }
    const att = conn.att;
    if (!this.rateOk(conn, att, raw)) return;
    const m = parseClientMessage(raw);
    if (!m) { this.bad(conn); return; }
    meta.activityAt = this.now();
    if (meta.activityAt - this.metaSavedAt > 600_000) { this.metaSavedAt = meta.activityAt; this.dirty.add('meta'); }
    if (m.t === 'sync') { this.send(conn, { t: 'sync', c: m.c, s: this.now() }); return; }
    if (m.t === 'hello') { this.hello(conn, att, m); return; }
    if (!att.h || !att.s) { this.err(conn, 'no_hello'); return; }
    const mem = this.members[att.p];
    if (!mem || mem.seat !== att.s) { this.err(conn, 'no_seat'); return; }
    if (mem.conn !== att.c) return;                          // superseded socket: ignore until it closes
    switch (m.t) {
      case 'signal': this.onSignal(mem, m.to, m.d); break;
      case 'relay': this.onRelay(mem, m.d); break;
      case 'sess': mem.sess = m.sess; this.dirty.add('members'); this.broadcastPresence(); break;
      case 'video': mem.video = m.on; this.dirty.add('members'); this.broadcastPresence(); break;
      case 'ready': this.onReady(conn, mem, m.ready); break;
      case 'config': this.onConfig(conn, mem, m); break;
      case 'kick': this.onKick(conn, mem, m.seat); break;
      case 'ev': this.onEvent(conn, mem, m); break;
      case 'final': this.onFinal(mem, m.mid, m.evs); break;
      case 'pause': this.onPause(mem, m.reason); break;
      case 'unpause': this.onUnpause(mem); break;
      case 'chat': this.onChat(conn, mem, m.text); break;
      case 'preset': this.onPreset(mem, m.id); break;
      case 'react': this.onReact(mem, m.id); break;
      case 'block': this.onBlock(mem, m.seat); break;
      case 'report': this.onReport(mem, m.seat, m.reason, m.block); break;
      case 'bye': this.onBye(mem); break;
    }
  }

  private rateOk(conn: EngineConn, att: ConnAtt, raw: unknown): boolean {
    const now = this.now();
    const sec = Math.floor(now / 1000);
    const cap = (perSec: number): number => perSec * RATE.burstSeconds;
    let r = this.rates.get(conn.id);
    if (!r) { r = { sec, n: 0, at: now, general: cap(RATE.generalPerSec), relay: cap(RATE.relayPerSec), signal: cap(RATE.signalPerSec), bad: 0, warned: 0 }; this.rates.set(conn.id, r); }
    const dt = Math.max(0, now - r.at) / 1000;
    r.at = now;
    r.general = Math.min(cap(RATE.generalPerSec), r.general + dt * RATE.generalPerSec);
    r.relay = Math.min(cap(RATE.relayPerSec), r.relay + dt * RATE.relayPerSec);
    r.signal = Math.min(cap(RATE.signalPerSec), r.signal + dt * RATE.signalPerSec);
    if (r.sec !== sec) { r.sec = sec; r.n = 0; }
    r.n++;
    if (r.n > RATE.hardPerSec) { conn.close(CLOSE.RATE, 'rate'); return false; }
    const head = typeof raw === 'string' ? raw.slice(0, 24) : '';
    const kind = head.startsWith('{"t":"relay"') ? 'relay' : head.startsWith('{"t":"signal"') ? 'signal' : 'general';
    if (r[kind] < 1) {
      if (r.warned !== sec && att.h) { r.warned = sec; this.err(conn, 'rate'); }
      return false;
    }
    r[kind] -= 1;
    return true;
  }

  private bad(conn: EngineConn): void {
    const r = this.rates.get(conn.id);
    if (r && ++r.bad > RATE.badMax) { conn.close(CLOSE.RATE, 'bad messages'); return; }
    this.err(conn, 'bad');
  }

  // ───────── hello ─────────

  private hello(conn: EngineConn, att: ConnAtt, m: Hello): void {
    const meta = this.meta as Meta;
    if (att.h) { this.err(conn, 'bad'); return; }
    if (m.v !== NET_PROTOCOL) { conn.close(CLOSE.VERSION, 'version'); return; }
    if (meta.banned.includes(att.p)) { this.send(conn, { t: 'removed', reason: 'banned' }); conn.close(CLOSE.REMOVED, 'banned'); return; }
    const now = this.now();
    let mem = this.members[att.p];
    let joined = false;
    if (mem) {
      if (mem.replaced.includes(m.tab)) { conn.close(CLOSE.REPLACED, 'replaced'); return; }
      if (mem.tab !== m.tab) {
        mem.replaced.push(mem.tab);
        while (mem.replaced.length > MAX_REPLACED_TABS) mem.replaced.shift();
        mem.tab = m.tab;
      }
    } else {
      const verdict = this.admit(att.a, att.k, m.blocks, false);
      if (verdict !== 'ok') { conn.close(verdict === 'full' ? CLOSE.FULL : CLOSE.NOT_ALLOWED, verdict); return; }
      mem = this.newMember(att, m, now);
      joined = true;
    }
    // older sockets of this player give way: the same tab reconnecting (quietly) or an older tab (4000)
    for (const c of this.host.conns()) {
      if (c.id === conn.id) continue;
      const a = c.att;
      if (a.p === att.p && a.h) { try { c.close(a.t === m.tab ? 1000 : CLOSE.REPLACED, a.t === m.tab ? 'superseded' : 'replaced'); } catch { /* closing */ } }
    }
    att.s = mem.seat; att.t = m.tab; att.h = true; conn.att = att;
    mem.conn = conn.id; mem.online = true; mem.offlineAt = null; mem.offlineHandled = false;
    mem.sess = m.sess; mem.video = m.video; mem.blocks = m.blocks.slice(0, MAX_BLOCKS);
    if (att.m > mem.mutedUntil) mem.mutedUntil = att.m;
    if (!meta.host) meta.host = mem.seat;
    meta.emptySince = null;
    this.dirty.add('members'); this.dirty.add('meta');

    // pause reasons belong to the connection that set them: replace them with what this client says now. The pause
    // state is settled before the welcome is built, so the welcome already shows it; the others are told afterwards.
    const match = this.match;
    const inMatch = !!match && match.phase !== 'over' && this.isPlayer(match, mem.seat);
    let announce: 'paused' | 'resumed' | null = null;
    if (inMatch && match) {
      delete match.reasons[mem.seat]; delete match.reasonAt[mem.seat];
      this.dirty.add('match');
      if (m.reasons.length) { if (this.pauseIn(mem.seat, m.reasons[0] as NetPauseReason)) announce = 'paused'; }
      else if (match.phase === 'paused' && this.resumeIfClear(mem.seat)) announce = 'resumed';
    }
    this.send(conn, {
      t: 'welcome', v: NET_PROTOCOL, you: mem.seat, now, room: this.roomInfo(), members: this.membersFor(mem),
      match: this.view(), mine: match ? (this.events[mem.seat] ?? []).slice() : [], blocked: this.blockedSeats(mem),
    });
    this.broadcastPresence(mem.seat);
    if (joined) { this.broadcastRoom(); this.hookPlaying(mem, true, false); }
    if (announce === 'paused') this.broadcast({ t: 'paused', by: mem.seat, match: this.view() as MatchInfo }, mem.seat);
    this.publish();
    this.maybeStart();
  }

  /** May a player with this age band and block key take a new seat? `dry`: no eviction (the HTTP pre-check). */
  private admit(age: AgeBand, key: string, blocks: readonly string[], dry: boolean): 'ok' | 'full' | 'not_allowed' {
    const meta = this.meta as Meta;
    if (meta.kind === 'public') {
      if (age === 'child' || meta.audience !== age) return 'not_allowed';
      for (const o of Object.values(this.members)) if (blocks.includes(o.bk) || o.blocks.includes(key)) return 'not_allowed';
    }
    if (Object.keys(this.members).length >= meta.size) {
      const free = this.evictable();
      if (!free) return 'full';
      if (!dry) this.removeMember(free, 'dropped');
    }
    return 'ok';
  }

  /** In the lobby, the member offline longest (at least lobbyEvictMs): their seat goes to a newcomer. */
  private evictable(): MemberRec | null {
    if (this.matchActive()) return null;
    const now = this.now();
    let best: MemberRec | null = null;
    for (const m of Object.values(this.members)) {
      if (m.online || m.offlineAt === null || now - m.offlineAt < this.timing.lobbyEvictMs) continue;
      if (!best || (m.offlineAt < (best.offlineAt as number))) best = m;
    }
    return best;
  }

  private newMember(att: ConnAtt, m: Hello, now: number): MemberRec {
    const meta = this.meta as Meta;
    const named = checkName(att.n);
    let name = named.ok ? named.text : 'Player';
    const taken = new Set(Object.values(this.members).map((x) => x.name));
    for (let i = 2; taken.has(name) && i < 10; i++) if (!taken.has(`${named.ok ? named.text : 'Player'} ${i}`)) name = `${named.ok ? named.text : 'Player'} ${i}`;
    const mem: MemberRec = {
      pid: att.p, seat: `s${meta.nextSeat++}`, name, age: att.a, bk: att.k, blocks: [],
      online: true, ready: false, sess: m.sess, video: m.video, tab: m.tab, replaced: [], conn: att.c, offlineAt: null,
      offlineHandled: false, joinedAt: now, mutedUntil: att.m,
    };
    this.members[att.p] = mem;
    return mem;
  }

  // ───────── lobby: ready, config, kick, leave ─────────

  private onReady(conn: EngineConn, mem: MemberRec, ready: boolean): void {
    if (this.matchActive()) { this.err(conn, 'busy'); return; }
    if (mem.ready === ready) return;
    mem.ready = ready;
    this.dirty.add('members');
    this.broadcastPresence();
    this.maybeStart();
  }

  private onConfig(conn: EngineConn, mem: MemberRec, m: { gameId?: string; durationMs?: number }): void {
    const meta = this.meta as Meta;
    if (meta.host !== mem.seat) { this.err(conn, 'not_host'); return; }
    if (this.matchActive()) { this.err(conn, 'busy'); return; }
    if (meta.kind === 'public') { this.err(conn, 'not_allowed'); return; }
    if (m.durationMs !== undefined && (m.durationMs < MIN_DURATION_MS || m.durationMs > MAX_DURATION_MS)) { this.err(conn, 'bad_config'); return; }
    if (m.gameId !== undefined && !GAME_RE.test(m.gameId)) { this.err(conn, 'bad_config'); return; }
    const next: RoomConfig = { ...meta.config };
    if (m.gameId !== undefined) next.gameId = m.gameId;
    if (m.durationMs !== undefined) next.durationMs = m.durationMs;
    if (next.gameId === meta.config.gameId && next.durationMs === meta.config.durationMs) return;
    meta.config = next;
    for (const x of Object.values(this.members)) x.ready = false;           // nobody starts a game they did not see
    this.dirty.add('meta'); this.dirty.add('members');
    this.broadcastRoom(); this.broadcastPresence(); this.publish();
  }

  private onKick(conn: EngineConn, mem: MemberRec, seat: SeatId): void {
    const meta = this.meta as Meta;
    if (meta.host !== mem.seat) { this.err(conn, 'not_host'); return; }
    if (meta.kind !== 'private') { this.err(conn, 'not_allowed'); return; }
    const target = this.bySeat(seat);
    if (!target || target === mem) { this.err(conn, 'bad'); return; }
    if (!meta.banned.includes(target.pid)) meta.banned.push(target.pid);
    this.dirty.add('meta');
    this.removeMember(target, 'kicked');
  }

  private onBye(mem: MemberRec): void {
    this.removeMember(mem, null);
  }

  /** Takes a member out of the room for good: forfeits their match seat, hands over the host, closes their sockets. */
  private removeMember(mem: MemberRec, why: 'kicked' | 'banned' | 'dropped' | null): void {
    const meta = this.meta as Meta;
    const match = this.match;
    if (match && match.phase !== 'over' && match.seats.includes(mem.seat)) this.forfeitSeat(mem.seat);
    delete this.members[mem.pid];
    this.lastChatAt.delete(mem.seat); this.lastPresetAt.delete(mem.seat);
    for (const c of this.host.conns()) {
      const a = c.att;
      if (a.p !== mem.pid) continue;
      try {
        if (why) this.send(c, { t: 'removed', reason: why });
        c.close(why ? CLOSE.REMOVED : 1000, why ?? 'bye');
      } catch { /* closing */ }
    }
    if (meta.host === mem.seat) meta.host = this.nextHost();
    if (!Object.keys(this.members).length) meta.emptySince = this.now();
    this.dirty.add('members'); this.dirty.add('meta');
    this.hookPlaying(mem, false, false);
    this.broadcastPresence(); this.broadcastRoom(); this.publish();
    this.maybeStart();
  }

  private nextHost(): SeatId | null {
    const all = Object.values(this.members).sort((a, b) => a.joinedAt - b.joinedAt || a.seat.localeCompare(b.seat));
    return (all.find((m) => m.online) ?? all[0])?.seat ?? null;
  }

  // ───────── starting a match ─────────

  private maybeStart(): void {
    const meta = this.meta;
    if (!meta || this.matchActive()) return;
    const all = Object.values(this.members);
    if (all.length < MIN_SEATS || !all.every((m) => m.ready && m.online)) return;
    const now = this.now();
    all.sort((a, b) => a.joinedAt - b.joinedAt || a.seat.localeCompare(b.seat));
    this.match = {
      id: this.host.uuid(), seed: this.host.randomU32() >>> 0, gameId: meta.config.gameId, startAt: now + this.timing.startCountdownMs,
      duration: meta.config.durationMs, phase: 'running', pausedAt: null, resumeAt: null, pauseTotal: 0, reasons: {}, reasonAt: {},
      seats: all.map((m) => m.seat), forfeited: [], result: null, pauses: {}, userPauses: {}, finals: {}, settleUntil: null,
    };
    this.events = {};
    this.pendingEv = false;
    if (!this.pendingChat) this.evDirtyAt = null;
    this.sched = null;
    meta.matches++;
    for (const m of all) { m.ready = false; this.hookPlaying(m, true, true); }
    this.dirty.add('match'); this.dirty.add('ev'); this.dirty.add('members'); this.dirty.add('meta');
    this.broadcast({ t: 'start', match: this.view() as MatchInfo });
    this.broadcastPresence(); this.broadcastRoom(); this.publish();
  }

  // ───────── match clock and course ─────────

  private matchTime(m: MatchRec, at = this.now()): number {
    if (m.phase === 'settling' || m.phase === 'over') return m.duration;
    const t = m.phase === 'paused' ? (m.pausedAt as number) : at;
    return Math.max(0, t - m.startAt - m.pauseTotal);
  }

  private course(m: MatchRec): { list: Obstacle[]; byId: Map<number, Obstacle> } {
    const key = `${m.id}`;
    if (!this.sched || this.sched.key !== key) {
      const list = makeSchedule(m.seed, m.duration, specFor(m.gameId));
      this.sched = { key, list, byId: new Map(list.map((o) => [o.id, o])) };
    }
    return this.sched;
  }

  private matchActive(): boolean {
    return !!this.match && this.match.phase !== 'over';
  }

  private isPlayer(m: MatchRec, seat: SeatId): boolean {
    return m.seats.includes(seat) && !m.forfeited.includes(seat);
  }

  // ───────── results ─────────

  private onEvent(conn: EngineConn, mem: MemberRec, m: Extract<ClientMessage, { t: 'ev' }>): void {
    const match = this.match;
    const reject = (r: AckRejection) => this.send(conn, { t: 'ack', seq: m.seq, rejected: r });
    if (!match || match.id !== m.mid) { reject('no_match'); return; }
    if (match.phase === 'over') { reject('over'); return; }
    if (!this.isPlayer(match, mem.seat)) { reject('not_player'); return; }
    const o = this.course(match).byId.get(m.ob);
    if (!o) { reject('bad'); return; }
    if (this.matchTime(match) + EARLY_MS < o.t) { reject('early'); return; }
    const list = this.events[mem.seat] ?? (this.events[mem.seat] = []);
    if (!list.some((e) => e.ob === m.ob)) {
      list.push({ ob: m.ob, k: m.k });
      this.markEvents();
    }
    this.send(conn, { t: 'ack', seq: m.seq });
  }

  /** The end-of-match handshake: the full list fills anything lost on the way. */
  private onFinal(mem: MemberRec, mid: string, evs: ObstacleResult[]): void {
    const match = this.match;
    if (!match || match.id !== mid) return;
    if (match.phase === 'over') { const c = this.connOf(mem); if (c && match.result) this.send(c, { t: 'result', result: match.result }); return; }
    if (!this.isPlayer(match, mem.seat)) return;
    if (match.phase === 'paused' || this.matchTime(match) < match.duration - FINAL_EARLY_MS) return;
    const byId = this.course(match).byId;
    const list = this.events[mem.seat] ?? (this.events[mem.seat] = []);
    let added = false;
    for (const e of evs) {
      if (byId.has(e.ob) && !list.some((x) => x.ob === e.ob)) { list.push({ ob: e.ob, k: e.k }); added = true; }
    }
    if (added) this.markEvents();
    match.finals[mem.seat] = true;
    this.dirty.add('match');
    if (match.phase === 'settling') this.finishIfAllFinal();
  }

  private finishIfAllFinal(): void {
    const m = this.match;
    if (!m || m.phase !== 'settling') return;
    if (m.seats.filter((s) => !m.forfeited.includes(s)).every((s) => m.finals[s])) this.finish('complete');
  }

  private enterSettling(): void {
    const m = this.match;
    if (!m || m.phase !== 'running') return;
    m.phase = 'settling'; m.settleUntil = this.now() + this.timing.settleMs;
    this.dirty.add('match');
    this.flushEvents();
    this.broadcast({ t: 'settling', mid: m.id });
    this.finishIfAllFinal();
  }

  private finish(reason: ResultReason): void {
    const m = this.match;
    if (!m || m.phase === 'over') return;
    const sched = this.course(m).list;
    const played = this.matchTime(m);
    const scores: MatchResult['scores'] = {};
    for (const s of m.seats) scores[s] = scoreOf(sched, this.events[s] ?? []);
    const active = m.seats.filter((s) => !m.forfeited.includes(s));
    let eff = reason;
    if ((reason === 'forfeit' || reason === 'abandoned') && played < m.duration * this.timing.noContestShare) eff = 'no_contest';
    let pl: Record<SeatId, number> = {};
    let winner: SeatId | null = null;
    if (eff === 'complete') { pl = placesOf(scores, active); winner = winnerOf(pl); }
    else if (eff === 'forfeit') { pl = active.length === 1 ? { [active[0] as SeatId]: 1 } : placesOf(scores, active); winner = winnerOf(pl); }
    m.phase = 'over'; m.pausedAt = null; m.resumeAt = null; m.settleUntil = null; m.reasons = {}; m.reasonAt = {};
    m.result = { mid: m.id, reason: eff, winner, places: pl, scores, forfeited: [...m.forfeited] };
    // A private room hands every seat's run to the players (their friends' recordings to keep); a public room never does.
    if (this.meta?.kind === 'private') {
      const runs: Record<SeatId, string> = {};
      for (const s of m.seats) runs[s] = outcomeString(sched, this.events[s] ?? []);
      m.result.runs = runs;
    }
    for (const x of Object.values(this.members)) { x.ready = false; this.hookPlaying(x, true, false); }
    this.dirty.add('match'); this.dirty.add('members');
    this.flushEvents();
    this.broadcast({ t: 'result', result: m.result });
    this.broadcastPresence(); this.broadcastRoom(); this.publish();
    this.host.log({
      evt: 'match_end', mid: m.id, game: m.gameId, reason: eff, seats: m.seats.length, forfeited: m.forfeited.length, playedMs: Math.round(played),
      pauses: m.pauses, ms: this.now() - m.startAt,
    });
  }

  // ───────── pauses, forfeits ─────────

  /** Marks this seat as holding the match paused. True when the match is (now) paused. */
  private pauseIn(seat: SeatId, reason: NetPauseReason): boolean {
    const m = this.match;
    if (!m || m.phase === 'over' || m.phase === 'settling' || !this.isPlayer(m, seat)) return false;
    const now = this.now();
    if (m.phase !== 'paused') {
      const n = (m.pauses[seat] ?? 0) + 1;
      const u = (m.userPauses[seat] ?? 0) + (reason === 'user' ? 1 : 0);
      if (reason !== 'offline' && (n > MAX_PAUSES || u > MAX_USER_PAUSES)) return false;
      m.pauses[seat] = n; m.userPauses[seat] = u;
      if (m.resumeAt && now < m.resumeAt) m.pauseTotal -= m.resumeAt - now;       // paused again during the 3-2-1
      m.phase = 'paused'; m.pausedAt = now; m.resumeAt = null;
    }
    if (m.reasons[seat] === undefined) m.reasonAt[seat] = now;
    m.reasons[seat] = reason;
    this.dirty.add('match');
    return true;
  }

  private onPause(mem: MemberRec, reason: NetPauseReason): void {
    if (this.pauseIn(mem.seat, reason)) {
      this.flushEvents();
      this.broadcast({ t: 'paused', by: mem.seat, match: this.view() as MatchInfo });
    }
  }

  private onUnpause(mem: MemberRec): void {
    const m = this.match;
    if (!m || m.phase !== 'paused' || m.reasons[mem.seat] === undefined) return;
    delete m.reasons[mem.seat]; delete m.reasonAt[mem.seat];
    this.dirty.add('match');
    this.resumeIfClear();
  }

  /**
   * Resumes with a 3-2-1 when nobody holds the pause any more; otherwise tells everyone who still does. The others
   * (not `exceptSeat`) are told. True when the match was resumed.
   */
  private resumeIfClear(exceptSeat?: SeatId): boolean {
    const m = this.match;
    if (!m || m.phase !== 'paused') return false;
    for (const mem of Object.values(this.members)) {
      if (this.isPlayer(m, mem.seat) && !mem.online && mem.offlineHandled && m.reasons[mem.seat] === undefined) {
        m.reasons[mem.seat] = 'offline'; m.reasonAt[mem.seat] = this.now();
      }
    }
    this.dirty.add('match');
    if (Object.keys(m.reasons).length) { this.broadcast({ t: 'paused', by: null, match: this.view() as MatchInfo }, exceptSeat); return false; }
    const resumeAt = this.now() + this.timing.resumeCountdownMs;
    const pausedAt = m.pausedAt as number;
    // The countdown counts as paused time, so match time never jumps. A pause before time zero makes the 3-2-1 the
    // start countdown: match time zero is its end.
    if (pausedAt - m.startAt - m.pauseTotal <= 0) m.pauseTotal = resumeAt - m.startAt;
    else m.pauseTotal += resumeAt - pausedAt;
    m.phase = 'running'; m.resumeAt = resumeAt; m.pausedAt = null;
    this.broadcast({ t: 'resumed', match: this.view() as MatchInfo }, exceptSeat);
    return true;
  }

  /** A seat is out of this match (left, removed, or away for the whole grace); the others play on. */
  private forfeitSeat(seat: SeatId): void {
    if (this.markForfeit(seat)) this.afterForfeits();
  }

  private markForfeit(seat: SeatId): boolean {
    const m = this.match;
    if (!m || m.phase === 'over' || !m.seats.includes(seat) || m.forfeited.includes(seat)) return false;
    m.forfeited.push(seat); delete m.reasons[seat]; delete m.reasonAt[seat];
    this.dirty.add('match');
    this.broadcast({ t: 'forfeit', seat, match: this.view() as MatchInfo });
    return true;
  }

  /** After one or more seats forfeited: end the match when no contest is left, else carry on. */
  private afterForfeits(): void {
    const m = this.match;
    if (!m || m.phase === 'over') return;
    const active = m.seats.filter((s) => !m.forfeited.includes(s));
    if (active.length < 2) { this.finish(active.length === 1 ? 'forfeit' : 'abandoned'); return; }
    if (m.phase === 'paused') this.resumeIfClear();
    else if (m.phase === 'settling') this.finishIfAllFinal();
  }

  // ───────── time ─────────

  /** Does everything that is due. Called from the alarm and before every message. */
  private tick(force = false): void {
    const meta = this.meta;
    if (!meta) return;
    const now = this.now();
    const t = this.timing;
    const slack = 25;
    if (!force && this.armed !== undefined && this.armed !== null && now + slack < this.armed) { /* nothing due yet */ return; }
    // 0. a socket that went silent without closing (a locked phone, a dead network) is dropped; its player goes offline
    // (a Room that just woke from hibernation has no sweep time yet and looks at once: the platform kept the sockets)
    const every = this.sweepEvery();
    if (Number.isFinite(every) && this.hasOpenSockets() && (this.lastSweep === null || now + slack >= this.lastSweep + every)) {
      this.lastSweep = now;
      this.sweepSilent(now);
    }
    // 1. a socket gone for the whole debounce pauses the match; in the lobby a long absence loses the seat
    for (const mem of Object.values(this.members)) {
      if (mem.online || mem.offlineAt === null) continue;
      const m = this.match;
      if (m && this.matchActive() && this.isPlayer(m, mem.seat)) {
        if (!mem.offlineHandled && now + slack >= mem.offlineAt + t.offlineDebounceMs) {
          mem.offlineHandled = true; this.dirty.add('members');
          if (this.pauseIn(mem.seat, 'offline')) { this.flushEvents(); this.broadcast({ t: 'paused', by: mem.seat, match: this.view() as MatchInfo }); }
        }
      } else if (now + slack >= mem.offlineAt + t.lobbyDropMs) {
        this.removeMember(mem, 'dropped');
      }
    }
    // 2. a seat that held the pause for the whole grace forfeits
    const m = this.match;
    if (m && m.phase === 'paused') {
      let any = false;
      for (const [seat, at] of Object.entries(m.reasonAt)) {
        if (now + slack >= at + t.graceMs && this.markForfeit(seat)) any = true;
      }
      if (any) this.afterForfeits();
    }
    // 3. match end, settle
    const m2 = this.match;
    if (m2 && m2.phase === 'running' && this.matchTime(m2, now + slack) >= m2.duration) this.enterSettling();
    const m3 = this.match;
    if (m3 && m3.phase === 'settling' && m3.settleUntil !== null && now + slack >= m3.settleUntil) this.finish('complete');
    // 4. event flush
    if (this.evDirtyAt !== null && now + slack >= this.evDirtyAt + t.eventFlushMs) this.flushEvents();
    // 5. expiry
    if (this.meta) {
      const mm = this.meta;
      if (mm.emptySince !== null && now + slack >= mm.emptySince + t.emptyTtlMs) this.destroy('empty');
      else if (now + slack >= mm.activityAt + t.roomTtlMs) this.destroy('idle');
    }
  }

  /** The next time something is due, or null. */
  private nextDue(): number | null {
    const meta = this.meta;
    if (!meta) return null;
    const t = this.timing;
    let min = Infinity;
    const want = (x: number) => { if (x < min) min = x; };
    // the idle deadline moves with every message: round it up to 10 minutes so the alarm is not rewritten each time
    want(meta.emptySince !== null ? meta.emptySince + t.emptyTtlMs : Math.ceil((meta.activityAt + t.roomTtlMs) / 600_000) * 600_000);
    const m = this.match;
    for (const mem of Object.values(this.members)) {
      if (mem.online || mem.offlineAt === null) continue;
      if (m && this.matchActive() && this.isPlayer(m, mem.seat)) { if (!mem.offlineHandled) want(mem.offlineAt + t.offlineDebounceMs); }
      else want(mem.offlineAt + t.lobbyDropMs);
    }
    if (m) {
      if (m.phase === 'running') want(m.startAt + m.pauseTotal + m.duration);
      else if (m.phase === 'paused') for (const at of Object.values(m.reasonAt)) want(at + t.graceMs);
      else if (m.phase === 'settling' && m.settleUntil !== null) want(m.settleUntil);
    }
    if (this.evDirtyAt !== null) want(this.evDirtyAt + t.eventFlushMs);
    if (this.hasOpenSockets()) {
      if (this.lastSweep === null) this.lastSweep = this.now();
      want(this.lastSweep + this.sweepEvery());
    } else this.lastSweep = null;
    return min === Infinity ? null : min;
  }

  /** Is any socket open? (Members that say they are online, and sockets this engine has heard from and not seen close.) */
  private hasOpenSockets(): boolean {
    if (this.heard.size > 0) return true;
    for (const mem of Object.values(this.members)) if (mem.online) return true;
    return false;
  }

  /** The gap between two silent-socket sweeps: short while a match runs, Infinity when silence is not judged at all. */
  private sweepEvery(): number {
    const t = this.timing;
    const active = this.matchActive();
    if (!Number.isFinite(active ? t.silentMatchMs : t.silentLobbyMs)) return Infinity;
    return active ? t.sweepMatchMs : t.sweepLobbyMs;
  }

  /**
   * Drops every socket that has been silent for longer than its limit. The close is sent but never awaited: a dead
   * socket never answers a close frame, so the member is marked offline here and the platform's own close event
   * (which may come minutes later) finds nothing left to do.
   */
  private sweepSilent(now: number): void {
    const t = this.timing;
    const match = this.match;
    const seen = new Set<string>();
    for (const c of this.host.conns()) {
      seen.add(c.id);
      const att = c.att;
      const mem = att.h && att.s ? this.members[att.p] : undefined;
      const inMatch = !!match && match.phase !== 'over' && !!mem && this.isPlayer(match, mem.seat);
      const limit = inMatch ? t.silentMatchMs : t.silentLobbyMs;
      if (!Number.isFinite(limit)) continue;
      const last = Math.max(this.heard.get(c.id) ?? att.at ?? now, c.heardAt?.() ?? 0);
      const quiet = now - last;
      if (quiet <= limit) continue;
      this.host.log({ evt: 'silent_socket', quietMs: Math.round(quiet), limitMs: limit, inMatch, hello: att.h });
      try { c.close(CLOSE.SILENT, 'silent'); } catch { /* already closing */ }
      this.closed(c);
    }
    for (const id of [...this.heard.keys()]) if (!seen.has(id)) this.heard.delete(id);
  }

  // ───────── relay, signalling ─────────

  private onSignal(mem: MemberRec, to: SeatId, d: Extract<ClientMessage, { t: 'signal' }>['d']): void {
    const target = this.bySeat(to);
    if (!target || target === mem || !target.online) return;
    const c = this.connOf(target);
    if (c) this.send(c, { t: 'signal', from: mem.seat, d });
  }

  private onRelay(mem: MemberRec, d: unknown): void {
    this.broadcast({ t: 'relay', from: mem.seat, d }, mem.seat);
  }

  // ───────── chat, presets, reactions, blocks, reports ─────────

  private chatMode(): ChatMode {
    const meta = this.meta as Meta;
    return meta.kind === 'private' && Object.values(this.members).every((m) => m.age === 'adult') ? 'text' : 'preset';
  }

  private onChat(conn: EngineConn, mem: MemberRec, text: string): void {
    const now = this.now();
    const rej = (reason: 'not_allowed' | 'muted' | 'rate' | 'empty' | 'too_long' | 'link' | 'email' | 'phone' | 'handle' | 'profanity', retryAt?: number) =>
      this.send(conn, retryAt === undefined ? { t: 'chat_rejected', reason } : { t: 'chat_rejected', reason, retryAt });
    if (this.chatMode() !== 'text' || mem.age !== 'adult') { rej('not_allowed'); return; }
    if (mem.mutedUntil > now) { rej('muted'); return; }
    const last = this.lastChatAt.get(mem.seat) ?? 0;
    if (now - last < CHAT_INTERVAL_MS) { rej('rate', last + CHAT_INTERVAL_MS); return; }
    const r = checkChat(text);
    if (!r.ok) { rej(r.reason); return; }
    this.lastChatAt.set(mem.seat, now);
    this.chat.push({ seat: mem.seat, name: mem.name, text: r.text, at: now });
    while (this.chat.length > CHAT_LOG_LINES) this.chat.shift();
    this.pendingChat = true;
    if (this.evDirtyAt === null) this.evDirtyAt = now;
    this.deliver(mem, { t: 'chat', from: mem.seat, text: r.text, at: now });
  }

  private onPreset(mem: MemberRec, id: PresetId): void {
    if (!this.presetGap(mem)) return;
    this.deliver(mem, { t: 'preset', from: mem.seat, id, at: this.now() });
  }

  private onReact(mem: MemberRec, id: ReactionId): void {
    if (!this.presetGap(mem)) return;
    this.deliver(mem, { t: 'react', from: mem.seat, id, at: this.now() });
  }

  private presetGap(mem: MemberRec): boolean {
    const now = this.now();
    if (now - (this.lastPresetAt.get(mem.seat) ?? 0) < PRESET_MIN_GAP_MS) return false;
    this.lastPresetAt.set(mem.seat, now);
    return true;
  }

  /** To everyone who has not blocked the sender (and whom the sender has not blocked), the sender included. */
  private deliver(from: MemberRec, msg: RoomMessage): void {
    this.each((c, to) => { if (to === from || !this.blockedEither(from, to)) this.send(c, msg); });
  }

  private blockedEither(a: MemberRec, b: MemberRec): boolean {
    return a.blocks.includes(b.bk) || b.blocks.includes(a.bk);
  }

  private onBlock(mem: MemberRec, seat: SeatId): void {
    const t = this.bySeat(seat);
    if (!t || t === mem) return;
    this.applyBlock(mem, t);
  }

  private applyBlock(mem: MemberRec, t: MemberRec): void {
    if (!mem.blocks.includes(t.bk)) {
      mem.blocks.push(t.bk);
      if (mem.blocks.length > MAX_BLOCKS) mem.blocks.shift();
      this.dirty.add('members');
      try { this.host.hooks?.block?.(mem.pid, t.pid); } catch { /* hooks never break the room */ }
    }
    const c = this.connOf(mem);
    if (c) this.send(c, { t: 'blocked', seat: t.seat, key: t.bk });
    this.broadcastPresence();
  }

  private onReport(mem: MemberRec, seat: SeatId, reason: ReportReason, block: boolean): void {
    const t = this.bySeat(seat);
    if (!t || t === mem) return;
    const now = this.now();
    if (!this.reports.some((r) => r.from === mem.seat && r.target === seat)) {
      this.reports.push({ from: mem.seat, target: seat, reason, at: now });
      while (this.reports.length > MAX_REPORTS_PER_ROOM) this.reports.shift();
      this.dirty.add('reports');
      const reporters = new Set(this.reports.filter((r) => r.target === seat).map((r) => r.from));
      if (reporters.size >= REPORTS_TO_MUTE && t.mutedUntil < now + MUTE_MS / 2) { t.mutedUntil = now + MUTE_MS; this.dirty.add('members'); }
      const evidence: RoomReport = {
        code: (this.meta as Meta).code, matchId: this.match ? this.match.id : null, reporterPid: mem.pid, targetPid: t.pid, reporterSeat: mem.seat,
        targetSeat: t.seat, reason, at: now, chat: this.chat.slice(-CHAT_LOG_LINES),
      };
      try { this.host.hooks?.report?.(evidence); } catch { /* hooks never break the room */ }
      this.host.log({ evt: 'report', code: evidence.code, reason, reporters: reporters.size });
    }
    const c = this.connOf(mem);
    if (c) this.send(c, { t: 'reported', seat });
    if (block) this.applyBlock(mem, t);
  }

  // ───────── views and broadcasts ─────────

  private phase(): 'lobby' | 'playing' {
    return this.matchActive() ? 'playing' : 'lobby';
  }

  private roomInfo(): RoomInfo {
    const meta = this.meta as Meta;
    return { code: meta.code, kind: meta.kind, size: meta.size, host: meta.host, config: { ...meta.config }, chat: this.chatMode(), video: meta.kind === 'private', phase: this.phase() };
  }

  private view(): MatchInfo | null {
    const m = this.match;
    if (!m) return null;
    return {
      id: m.id, seed: m.seed, gameId: m.gameId, startAt: m.startAt, duration: m.duration, phase: m.phase, pausedAt: m.pausedAt, resumeAt: m.resumeAt,
      pauseTotal: m.pauseTotal, reasons: { ...m.reasons }, seats: [...m.seats], forfeited: [...m.forfeited], result: m.result,
    };
  }

  /** Video between a member and the reader: both adults in a private room, the member switched it on, nobody blocked anybody. */
  private videoFor(mem: MemberRec, reader: MemberRec): boolean {
    const meta = this.meta as Meta;
    if (meta.kind !== 'private' || !mem.video || mem.age !== 'adult') return false;
    return reader === mem || (reader.age === 'adult' && !this.blockedEither(mem, reader));
  }

  private membersFor(reader: MemberRec): MemberInfo[] {
    const meta = this.meta as Meta;
    return Object.values(this.members).sort((a, b) => a.joinedAt - b.joinedAt || a.seat.localeCompare(b.seat)).map((m) => ({
      seat: m.seat, name: m.name, host: meta.host === m.seat, online: m.online, ready: m.ready, sess: m.sess, video: this.videoFor(m, reader),
    }));
  }

  private blockedSeats(reader: MemberRec): SeatId[] {
    return Object.values(this.members).filter((m) => m !== reader && reader.blocks.includes(m.bk)).map((m) => m.seat);
  }

  private send(conn: EngineConn, msg: RoomMessage): void {
    try { conn.send(JSON.stringify(msg)); } catch { /* the socket is closing */ }
  }

  private err(conn: EngineConn, code: RoomErrorCode): void {
    this.send(conn, { t: 'error', code });
  }

  private bySeat(seat: SeatId): MemberRec | null {
    for (const m of Object.values(this.members)) if (m.seat === seat) return m;
    return null;
  }

  private connOf(mem: MemberRec): EngineConn | null {
    for (const c of this.host.conns()) if (c.id === mem.conn && c.att.h) return c;
    return null;
  }

  /** Visits the current socket of every member that said hello. */
  private each(fn: (conn: EngineConn, mem: MemberRec) => void, exceptSeat?: SeatId): void {
    const bySeat = new Map<SeatId, MemberRec>();
    for (const m of Object.values(this.members)) bySeat.set(m.seat, m);
    for (const c of this.host.conns()) {
      const a = c.att;
      if (!a.h || !a.s || a.s === exceptSeat) continue;
      const mem = bySeat.get(a.s);
      if (!mem || mem.conn !== a.c) continue;
      fn(c, mem);
    }
  }

  private broadcast(msg: RoomMessage, exceptSeat?: SeatId): void {
    const text = JSON.stringify(msg);
    this.each((c) => { try { c.send(text); } catch { /* closing */ } }, exceptSeat);
  }

  private broadcastPresence(exceptSeat?: SeatId): void {
    this.each((c, reader) => this.send(c, { t: 'presence', members: this.membersFor(reader) }), exceptSeat);
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.roomInfo() });
  }

  // ───────── persistence and hooks ─────────

  private markEvents(): void {
    this.pendingEv = true;
    if (this.evDirtyAt === null) this.evDirtyAt = this.now();
  }

  /** Queues the batched keys (results, chat) for the next write. */
  private flushEvents(): void {
    if (this.pendingEv) this.dirty.add('ev');
    if (this.pendingChat) this.dirty.add('chat');
    this.pendingEv = false; this.pendingChat = false; this.evDirtyAt = null;
  }

  /** Writes what changed and sets the alarm. Called at the end of every entry point. */
  private commit(): void {
    const meta = this.meta;
    if (!meta) { this.dirty.clear(); return; }
    if (this.dirty.size) {
      const patch: Record<string, unknown> = {};
      for (const k of this.dirty) {
        if (k === 'meta') patch.meta = meta;
        else if (k === 'members') patch.members = this.members;
        else if (k === 'match') patch.match = this.match;
        else if (k === 'ev') patch.ev = this.events;
        else if (k === 'chat') patch.chat = this.chat;
        else patch.reports = this.reports;
      }
      this.dirty.clear();
      this.host.save(patch);
    }
    const next = this.nextDue();
    if (next !== this.armed) { this.armed = next; this.host.setAlarm(next === null ? null : Math.max(next, this.now() + 20)); }
  }

  private publish(): void {
    const s = this.summary();
    const hook = this.host.hooks?.publish;
    if (!s || !hook) return;
    const sig = JSON.stringify({ ...s, updatedAt: 0 });
    if (sig === this.lastPub) return;
    this.lastPub = sig;
    try { hook(s, Object.values(this.members).map((m) => m.pid)); } catch { /* hooks never break the room */ }
  }

  private hookPlaying(mem: MemberRec, inRoom: boolean, playing: boolean): void {
    const hook = this.host.hooks?.playing;
    if (!hook) return;
    try { hook(mem.pid, inRoom, playing, (this.meta as Meta).config.gameId); } catch { /* hooks never break the room */ }
  }

  private now(): number {
    return this.host.now();
  }
}
