// A fake host for RoomEngine: fake sockets, a controllable clock, in-memory storage and an alarm. Used by the engine
// tests and by the client tests (which wire real LiveClient objects to an engine in the same process).
import type { AgeBand, ClientMessage, MatchInfo, RoomMessage, TicketClaims } from '../../../core/types/net.ts';
import { NET_PROTOCOL } from '../../../core/types/net.ts';
import { DEFAULT_TIMING, type Timing } from './config.ts';
import { RoomEngine, type ConnAtt, type EngineConn, type EngineHooks, type InitInput } from './room-engine.ts';
import type { RoomReport } from './hooks.ts';

export class FakeConn implements EngineConn {
  readonly id: string;
  att: ConnAtt;
  open = true;
  closeInfo: { code: number; reason: string } | null = null;
  readonly inbox: RoomMessage[] = [];
  private readonly hostRef: FakeHost;

  constructor(host: FakeHost, id: string) {
    this.hostRef = host;
    this.id = id;
    this.att = { c: id, p: '', n: '', a: 'adult', k: '', m: 0, s: null, t: null, h: false };
  }

  send(text: string): void {
    if (!this.open) throw new Error('socket closed');
    this.inbox.push(JSON.parse(text) as RoomMessage);
  }

  close(code: number, reason = ''): void {
    if (!this.open) return;
    this.open = false;
    this.closeInfo = { code, reason };
    this.hostRef.pendingCloses.push(this);
  }
}

export class FakeHost {
  t = 1_700_000_000_000;
  readonly all: FakeConn[] = [];
  readonly store = new Map<string, unknown>();
  readonly pendingCloses: FakeConn[] = [];
  alarmAt: number | null = null;
  saves = 0;
  rowsWritten = 0;
  deleted = false;
  logs: Record<string, unknown>[] = [];
  published: { summary: unknown; pids: string[] }[] = [];
  removed: string[] = [];
  reports: RoomReport[] = [];
  blocks: [string, string][] = [];
  playing: { pid: string; inRoom: boolean; playing: boolean }[] = [];
  private seed = 1000;
  private uid = 0;
  private nextConn = 0;

  hooks: EngineHooks = {
    publish: (summary, pids) => { this.published.push({ summary, pids }); },
    removed: (code) => { this.removed.push(code); },
    playing: (pid, inRoom, playing) => { this.playing.push({ pid, inRoom, playing }); },
    report: (r) => { this.reports.push(r); },
    block: (pid, target) => { this.blocks.push([pid, target]); },
  };

  now = (): number => this.t;
  conns = (): EngineConn[] => this.all.filter((c) => c.open);
  load = async (): Promise<Record<string, unknown>> => Object.fromEntries(this.store);
  save = (patch: Record<string, unknown>): void => {
    this.saves++;
    for (const [k, v] of Object.entries(patch)) { this.store.set(k, JSON.parse(JSON.stringify(v))); this.rowsWritten++; }
  };
  deleteAll = (): void => { this.store.clear(); this.deleted = true; };
  setAlarm = (at: number | null): void => { this.alarmAt = at; };
  randomU32 = (): number => (this.seed += 7919);
  uuid = (): string => `m${++this.uid}`;
  log = (line: Record<string, unknown>): void => { this.logs.push(line); };

  newConn(): FakeConn {
    const c = new FakeConn(this, `c${++this.nextConn}`);
    this.all.push(c);
    return c;
  }
}

export function claimsFor(code: string, pid: string, over: Partial<TicketClaims> = {}): TicketClaims {
  return { v: 1, c: code, p: pid, n: over.n ?? pid.slice(0, 20), a: 'adult', k: `bk_${pid}_0123456789`.slice(0, 40), e: 4_000_000_000, ...over };
}

/** One simulated player: a socket plus the helpers the tests need. */
export class TestPlayer {
  readonly pid: string;
  conn: FakeConn;
  tab: string;
  sess: string;
  seat = '';
  private readonly room: Room;
  private readCursor = 0;

  constructor(room: Room, pid: string, conn: FakeConn, tab: string) {
    this.room = room; this.pid = pid; this.conn = conn; this.tab = tab; this.sess = `sess_${tab}`;
  }

  get msgs(): RoomMessage[] { return this.conn.inbox; }
  all<T extends RoomMessage['t']>(type: T): Extract<RoomMessage, { t: T }>[] { return this.conn.inbox.filter((m) => m.t === type) as Extract<RoomMessage, { t: T }>[]; }
  last<T extends RoomMessage['t']>(type: T): Extract<RoomMessage, { t: T }> | undefined { const a = this.all(type); return a[a.length - 1]; }
  /** Messages received since the last call to fresh(). */
  fresh(): RoomMessage[] { const out = this.conn.inbox.slice(this.readCursor); this.readCursor = this.conn.inbox.length; return out; }
  get closeCode(): number | null { return this.conn.closeInfo ? this.conn.closeInfo.code : null; }
  get closeInfo(): { code: number; reason: string } | null { return this.conn.closeInfo; }

  send(m: ClientMessage | Record<string, unknown> | string): void { this.room.send(this, m); }
  hello(over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}): this {
    this.send({ t: 'hello', v: NET_PROTOCOL, tab: this.tab, sess: this.sess, video: false, reasons: [], blocks: [], ...over });
    const w = this.last('welcome');
    if (w) this.seat = w.you;
    return this;
  }
  ready(ready = true): void { this.send({ t: 'ready', ready }); }
}

/** An engine plus its fake host and a few drivers (join, advance time, reload from storage, drop sockets). */
export class Room {
  readonly host: FakeHost;
  engine!: RoomEngine;
  readonly code: string;
  readonly players = new Map<string, TestPlayer>();
  private readonly timing: Timing;
  private tabs = 0;

  private constructor(host: FakeHost, code: string, timing: Timing) {
    this.host = host; this.code = code; this.timing = timing;
  }

  static async make(init: Partial<InitInput> = {}, timing: Partial<Timing> = {}): Promise<Room> {
    const host = new FakeHost();
    const t: Timing = { ...DEFAULT_TIMING, ...timing };
    const r = new Room(host, init.code ?? 'K7P2QX', t);
    r.engine = await RoomEngine.create(host, t);
    const res = r.engine.init({
      code: r.code, kind: 'private', size: 2, config: { gameId: 'squat-flap', durationMs: 30_000, band: null }, audience: null, creator: 'creator', ...init,
    });
    if (!res.ok) throw new Error('init failed: ' + res.error);
    r.flush();
    return r;
  }

  /** Opens a socket with a ticket for `pid` (no hello yet). */
  connect(pid: string, over: Partial<TicketClaims> = {}, tab?: string): TestPlayer {
    const conn = this.host.newConn();
    const p = new TestPlayer(this, pid, conn, tab ?? `tab${++this.tabs}`);
    this.engine.accept(conn, claimsFor(this.code, pid, over));
    this.flush();
    this.players.set(`${pid}/${conn.id}`, p);
    return p;
  }

  /** connect + hello. */
  join(pid: string, over: Partial<TicketClaims> = {}, hello: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}, tab?: string): TestPlayer {
    return this.connect(pid, over, tab).hello(hello);
  }

  send(p: TestPlayer, m: ClientMessage | Record<string, unknown> | string): void {
    this.engine.message(p.conn, typeof m === 'string' ? m : JSON.stringify(m));
    this.flush();
  }

  /** Delivers pending close events like the platform does after a socket closes. */
  flush(): void {
    while (this.host.pendingCloses.length) {
      const c = this.host.pendingCloses.shift() as FakeConn;
      this.engine.closed(c);
    }
  }

  /** The network under this player's socket vanished (no close frame was sent by anyone before it was noticed). */
  drop(p: TestPlayer): void {
    if (!p.conn.open) return;
    p.conn.open = false;
    p.conn.closeInfo = { code: 1006, reason: 'drop' };
    this.engine.closed(p.conn);
    this.flush();
  }

  /** Moves the clock forward, running every alarm that falls due on the way. */
  advance(ms: number): void {
    const end = this.host.t + ms;
    for (let guard = 0; guard < 10_000; guard++) {
      const a = this.host.alarmAt;
      if (a === null || a > end) break;
      this.host.t = Math.max(this.host.t, a);
      this.engine.alarm();
      this.flush();
    }
    this.host.t = end;
  }

  /** What a hibernation wake does: a new engine from storage, the sockets stay. */
  async reload(): Promise<void> {
    this.engine = await RoomEngine.create(this.host, this.timing);
  }

  match(): MatchInfo {
    const m = this.engine.inspect().match;
    if (!m) throw new Error('no match');
    return m as unknown as MatchInfo;
  }
}

export const age = (a: AgeBand): Partial<TicketClaims> => ({ a });
