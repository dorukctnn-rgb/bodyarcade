// A small network for the unit tests that run LiveClient (and LiveRace) against the real RoomEngine in one process: a manual
// clock, sockets with latency, and the failures a phone meets (drops, frozen links, hanging connection attempts, a deploy).
import { CLOSE, type JoinGrant } from '../../../core/types/net.ts';
import { ManualScheduler } from '../../../core/net/testkit.ts';
import type { SocketFactory, SocketLike } from '../../../core/net/runtime.ts';
import { FakeConn, Room, claimsFor, type FakeHost } from './testkit.ts';

export const SKEW = 5000;

export class LoopConn extends FakeConn {
  deliver: ((text: string) => void) | null = null;
  onServerClose: ((code: number, reason: string) => void) | null = null;
  override send(text: string): void {
    if (!this.open) throw new Error('socket closed');
    this.deliver?.(text);
  }
  override close(code: number, reason = ''): void {
    const was = this.open;
    super.close(code, reason);
    if (was) this.onServerClose?.(code, reason);
  }
}

export class LoopSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  conn: LoopConn | null = null;
  frozen = false;
  readonly net: Net;
  readonly pid: string;

  constructor(net: Net, url: string) {
    this.net = net;
    const ticket = new URL(url).searchParams.get('ticket') ?? '';
    const claims = JSON.parse(ticket) as ReturnType<typeof claimsFor>;
    this.pid = claims.p;
    net.sockets.push(this);
    net.after(() => {
      if (this.readyState === 3) return;
      if (net.blackhole) return;                           // the connection request is swallowed: the socket stays "connecting"
      if (net.expired.has(ticket)) {                       // the Worker accepts the upgrade and closes at once with 4002
        this.readyState = 1; this.onopen?.({});
        net.after(() => { this.readyState = 3; this.onclose?.({ code: CLOSE.TICKET, reason: 'expired' }); });
        return;
      }
      const conn = new LoopConn(net.room.host, `lc${net.n++}`);
      net.room.host.all.push(conn);
      this.conn = conn;
      conn.deliver = (text) => net.after(() => { if (this.readyState === 1 && !this.frozen) this.onmessage?.({ data: text }); });
      conn.onServerClose = (code, reason) => net.after(() => {
        if (this.readyState === 3 || this.frozen) return;
        this.readyState = 3; this.onclose?.({ code, reason });
      });
      net.room.engine.accept(conn, claims);
      net.room.flush();
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    if (this.frozen) return;
    this.net.after(() => {
      const c = this.conn;
      if (!c || !c.open || this.frozen) return;
      if (data === 'ping') {                                // answered by the platform: the Room never sees it, only its timestamp moves
        c.autoHeard = this.net.room.host.now();
        this.net.after(() => { if (this.readyState === 1 && !this.frozen) this.onmessage?.({ data: 'pong' }); });
        return;
      }
      this.net.room.engine.message(c, data);
      this.net.room.flush();
    });
  }

  /** The network under the phone vanished: the page sees the close, the Room learns of it at once. */
  kill(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const c = this.conn;
    if (c && c.open) { c.open = false; c.closeInfo = { code, reason: 'lost' }; this.net.room.engine.closed(c); this.net.room.flush(); }
    this.net.after(() => this.onclose?.({ code, reason: 'lost' }));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.frozen) return;                                    // a frozen network delivers no close frame either
    const c = this.conn;
    this.net.after(() => {
      if (c && c.open) { c.open = false; c.closeInfo = { code, reason }; this.net.room.engine.closed(c); this.net.room.flush(); }
    });
  }
}

export class Net {
  readonly sched = new ManualScheduler();
  readonly sockets: LoopSocket[] = [];
  readonly expired = new Set<string>();
  /** New connection attempts get no answer at all. */
  blackhole = false;
  n = 1;
  latency = 20;
  readonly room: Room;

  constructor(room: Room) {
    this.room = room;
    (room.host as FakeHost).now = () => this.sched.now() + SKEW;
    room.host.t = this.sched.now() + SKEW;
    const pump = (): void => {
      const h = room.host;
      if (h.alarmAt !== null && h.now() >= h.alarmAt) { h.alarmAt = null; room.engine.alarm(); room.flush(); }
      this.sched.setTimeout(pump, 10);
    };
    pump();
  }

  static async make(init: Parameters<typeof Room.make>[0] = {}, timing: Parameters<typeof Room.make>[1] = {}): Promise<Net> {
    return new Net(await Room.make(init, timing));
  }

  after(fn: () => void): void { this.sched.setTimeout(fn, this.latency); }

  readonly factory: SocketFactory = (url) => new LoopSocket(this, url);

  /** What a deploy does: the Room closes every socket. */
  kickAll(): void { this.room.engine.closeAll(1012, 'service restart'); this.room.flush(); }

  run(ms: number): void { this.sched.advance(ms); }

  grant(pid: string, over: Partial<ReturnType<typeof claimsFor>> = {}): JoinGrant {
    const claims = claimsFor(this.room.code, pid, over);
    return { code: this.room.code, link: '', ticket: JSON.stringify(claims), exp: 4_000_000_000, room: { code: this.room.code, kind: 'private', gameId: 'squat-flap', size: 2, players: 0, phase: 'lobby' } };
  }
}

export function seeded(s: string): () => number {
  let a = 0;
  for (const ch of s) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

