// LiveClient against the real RoomEngine in one process: a manual clock, sockets with latency, and the failures a
// phone meets (drops, half-open sockets, a deploy, a second tab). The two-browser suite (tests/live) repeats the
// important ones with real browsers, WebRTC and workerd; this is the fast layer that pins the client logic down.
import { describe, expect, it } from 'vitest';
import { CLOSE, type JoinGrant, type MatchInfo, type ObstacleResult } from '../../../core/types/net.ts';
import { LiveClient, type LiveClientOptions, type LiveEvents } from '../../../core/net/client.ts';
import { ManualScheduler } from '../../../core/net/testkit.ts';
import type { SocketFactory, SocketLike } from '../../../core/net/runtime.ts';
import { makeSchedule, specFor } from '../../../core/net/schedule.ts';
import { FakeConn, Room, claimsFor, type FakeHost } from './testkit.ts';

const SKEW = 5000;

class LoopConn extends FakeConn {
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

class LoopSocket implements SocketLike {
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
      if (data === 'ping') { this.net.after(() => { if (this.readyState === 1 && !this.frozen) this.onmessage?.({ data: 'pong' }); }); return; }
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
    const c = this.conn;
    this.net.after(() => {
      if (c && c.open) { c.open = false; c.closeInfo = { code, reason }; this.net.room.engine.closed(c); this.net.room.flush(); }
    });
  }
}

class Net {
  readonly sched = new ManualScheduler();
  readonly sockets: LoopSocket[] = [];
  readonly expired = new Set<string>();
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

interface Probe {
  c: LiveClient;
  log: { type: string; detail: unknown }[];
  all<K extends keyof LiveEvents>(type: K): LiveEvents[K][];
}

function client(net: Net, pid: string, o: Partial<LiveClientOptions> = {}, over: Partial<ReturnType<typeof claimsFor>> = {}): Probe {
  const c = new LiveClient({
    grant: net.grant(pid, over), origin: 'http://loop', peers: 'none', sched: net.sched, socket: net.factory, random: seeded(pid), ...o,
  });
  const log: Probe['log'] = [];
  for (const t of ['status', 'welcome', 'presence', 'room', 'match', 'phase', 'settling', 'forfeit', 'result', 'chat', 'preset', 'react', 'chatRejected', 'blocked', 'reported', 'removed', 'state', 'synced', 'roomError', 'fatal'] as const) {
    c.on(t, (detail) => { log.push({ type: t, detail }); });
  }
  void c.start();
  return { c, log, all: (type) => log.filter((x) => x.type === type).map((x) => x.detail) as never };
}

function seeded(s: string): () => number {
  let a = 0;
  for (const ch of s) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const phases = (p: Probe): string[] => p.all('phase').map((x) => `${x.why}:${x.match.phase}`);

/** Both clients ready, the match started, the clock at match time zero. */
async function startedPair(timing: Parameters<typeof Room.make>[1] = {}): Promise<{ net: Net; a: Probe; b: Probe; match: MatchInfo }> {
  const net = await Net.make({}, timing);
  const a = client(net, 'alice-device-01'); const b = client(net, 'bob-device-0002');
  net.run(3000);
  a.c.setReady(true); b.c.setReady(true);
  net.run(300);
  const match = a.c.match as MatchInfo;
  return { net, a, b, match };
}

describe('connecting and the clock', () => {
  it('joins, finds the server clock despite a 5 s skew and both see match time zero together', async () => {
    const { net, a, b, match } = await startedPair();
    expect(a.c.you).toBe('s1'); expect(b.c.you).toBe('s2');
    expect(a.c.members.map((m) => m.online)).toEqual([true, true]);
    for (const p of [a, b]) {
      expect(p.c.clock.synced).toBe(true);
      expect(Math.abs(p.c.serverNow() - net.room.host.now())).toBeLessThan(30);
    }
    expect(a.all('match')).toHaveLength(1);
    expect(b.all('match')[0]?.match).toEqual(a.all('match')[0]?.match);
    net.run(match.startAt - net.room.host.now());
    expect(Math.abs(a.c.matchTime())).toBeLessThan(30);
    expect(Math.abs(a.c.matchTime() - b.c.matchTime())).toBeLessThan(5);
  });

  it('refuses nothing it should not: statuses go connecting then online', async () => {
    const net = await Net.make();
    const a = client(net, 'alice-device-01');
    net.run(500);
    expect(a.all('status').map((s) => s.state)).toEqual(['connecting']);
    expect(a.all('welcome')).toHaveLength(1);
  });
});

describe('results survive bad networks', () => {
  function course(match: MatchInfo) { return makeSchedule(match.seed, match.duration, specFor(match.gameId)); }

  it('resends a result that was lost in a drop and the Room ends up with it', async () => {
    const { net, a, match } = await startedPair();
    const o = course(match)[0];
    if (!o) throw new Error('no obstacle');
    net.run(match.startAt - net.room.host.now() + o.t);
    a.c.reportResult(o.id, 'pass');
    for (const s of net.sockets) s.kill();                     // the phone loses the network before the Room hears of it
    net.run(1500);
    expect(a.c.members).toHaveLength(2);
    expect(net.room.engine.inspect().events['s1']).toEqual([{ ob: o.id, k: 'pass' }]);
    expect(a.log.filter((x) => x.type === 'welcome')).toHaveLength(2);
  });

  it('a deploy (every socket closed) between obstacles never pauses the match and loses nothing', async () => {
    const { net, a, b, match } = await startedPair();
    const list = course(match);
    net.run(match.startAt - net.room.host.now());
    for (const [i, o] of list.slice(0, 6).entries()) {
      net.run(Math.max(0, match.startAt + o.t - net.room.host.now()));
      a.c.reportResult(o.id, 'pass'); b.c.reportResult(o.id, i % 2 ? 'hit' : 'pass');
      if (i === 2) net.kickAll();
    }
    net.run(2000);
    expect(phases(a).some((p) => p.includes('paused'))).toBe(false);
    expect(a.c.members.every((m) => m.online)).toBe(true);
    expect(net.room.engine.inspect().events['s1']).toHaveLength(6);
    expect(net.room.engine.inspect().events['s2']).toHaveLength(6);
  });

  it('detects a half-open socket, replaces it and still pauses nothing', async () => {
    const { net, a, b, match } = await startedPair();
    net.run(match.startAt - net.room.host.now() + 1000);
    const dead = net.sockets.filter((s) => s.pid === 'bob-device-0002').at(-1) as LoopSocket;
    dead.frozen = true;                                        // nothing arrives, nothing is sent, nothing closes
    net.run(7500);
    expect(b.c.m.deadSockets).toBe(1);
    expect(b.c.m.wsOpens).toBe(2);
    expect(phases(a).some((p) => p.includes('paused'))).toBe(false);
    expect(a.c.members.every((m) => m.online)).toBe(true);
  });

  it('sends the final list again after a reconnect and gets the result', async () => {
    const { net, a, b, match } = await startedPair();
    const list = course(match);
    net.run(match.startAt - net.room.host.now());
    const mineA: ObstacleResult[] = []; const mineB: ObstacleResult[] = [];
    for (const o of list) {
      net.run(Math.max(0, match.startAt + o.t - net.room.host.now()));
      a.c.reportResult(o.id, 'pass'); b.c.reportResult(o.id, 'hit');
      mineA.push({ ob: o.id, k: 'pass' }); mineB.push({ ob: o.id, k: 'hit' });
    }
    net.run(Math.max(0, match.startAt + match.duration - net.room.host.now()) + 50);
    for (const s of net.sockets.filter((x) => x.pid === 'bob-device-0002')) s.frozen = true;      // B's link dies right at the end
    a.c.finish(mineA); b.c.finish(mineB);
    net.run(15_000);
    for (const p of [a, b]) {
      const r = p.all('result');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ reason: 'complete', winner: 's1' });
    }
    expect(b.c.m.deadSockets).toBeGreaterThanOrEqual(1);
  });
});

describe('who may stay', () => {
  it('a newer tab of the same player stops the older client for good', async () => {
    const net = await Net.make();
    const a1 = client(net, 'alice-device-01', { tab: 'tabone' });
    net.run(500);
    const a2 = client(net, 'alice-device-01', { tab: 'tabtwo' });
    net.run(10_000);
    expect(a1.all('fatal')).toEqual([{ reason: 'replaced', code: CLOSE.REPLACED }]);
    expect(a1.c.closed).toBe(true);
    expect(a1.c.m.wsOpens).toBe(1);
    expect(a2.c.you).toBe('s1');
    expect(a2.all('fatal')).toHaveLength(0);
  });

  it('a full room, a removal and a vanished room are fatal and not retried', async () => {
    const net = await Net.make();
    client(net, 'alice-device-01'); client(net, 'bob-device-0002');
    net.run(500);
    const c = client(net, 'carol-device-03');
    net.run(5000);
    expect(c.all('fatal')).toEqual([{ reason: 'full', code: CLOSE.FULL }]);
    expect(c.c.m.wsOpens).toBe(1);
  });

  it('renews a rejected ticket once and carries on', async () => {
    const net = await Net.make();
    const old = net.grant('alice-device-01');
    net.expired.add(old.ticket);
    let renewed = 0;
    const a = client(net, 'alice-device-01', { grant: old, refreshTicket: async () => { renewed++; return net.grant('alice-device-01', { n: 'Alice' }); } });
    net.run(200);
    await settle();
    net.run(3000);
    expect(renewed).toBe(1);
    expect(a.c.you).toBe('s1');
    expect(a.all('fatal')).toHaveLength(0);
  });

  it('a rejected ticket without a way to renew it is fatal', async () => {
    const net = await Net.make();
    const old = net.grant('alice-device-01');
    net.expired.add(old.ticket);
    const a = client(net, 'alice-device-01', { grant: old });
    net.run(3000);
    expect(a.all('fatal')).toEqual([{ reason: 'ticket', code: CLOSE.TICKET }]);
  });
});

describe('pauses, outbox, state, chat', () => {
  it('reports pause reasons in hello after a reconnect, and unpauses only when none is left', async () => {
    const { net, a, b } = await startedPair();
    net.run(5000);
    b.c.pause('hidden'); b.c.pause('camera');
    net.run(100);
    expect(a.c.match?.phase).toBe('paused');
    b.c.unpause('hidden');
    net.run(100);
    expect(a.c.match?.phase).toBe('paused');                   // the camera still holds it
    for (const s of net.sockets.filter((x) => x.pid === 'bob-device-0002')) s.kill();
    net.run(1500);
    expect(net.room.engine.inspect().match?.reasons).toEqual({ s2: 'camera' });
    b.c.unpause('camera');
    net.run(100);
    expect(a.all('phase').at(-1)?.why).toBe('resumed');
  });

  it('keeps a ready press made while offline and sends it with the welcome', async () => {
    const net = await Net.make();
    const a = client(net, 'alice-device-01'); const b = client(net, 'bob-device-0002');
    net.run(1000);
    net.kickAll();
    net.run(30);                                                       // the page has seen the close, the new socket is not there yet
    b.c.setReady(true); b.c.setReady(false); b.c.setReady(true);       // all while the socket is down; only the last counts
    a.c.setReady(true);
    net.run(2000);
    expect(a.c.match?.phase).toBe('running');
  });

  it('says a ready press again when it was sent into a socket that had already died', async () => {
    const net = await Net.make();
    const a = client(net, 'alice-device-01'); const b = client(net, 'bob-device-0002');
    net.run(1000);
    net.kickAll();                                                     // the page does not know yet
    b.c.setReady(true);                                                // goes nowhere
    a.c.setReady(true);
    net.run(2500);
    expect(a.c.match?.phase).toBe('running');
    expect(b.c.match?.id).toBe(a.c.match?.id);
  });

  it('relays game state through the Room once per message and tells a restarted rival from a repeat', async () => {
    const { net, a, b } = await startedPair();
    net.run(4000);
    for (let i = 0; i < 5; i++) { a.c.sendState({ n: i }); net.run(70); }
    const got = b.all('state');
    expect(got.map((s) => (s.d as { n: number }).n)).toEqual([0, 1, 2, 3, 4]);
    expect(got.every((s) => s.path === 'relay' && s.from === 's1')).toBe(true);
    expect(Math.abs(got[0]?.latency ?? 999)).toBeLessThan(80);
    // a rival whose page was reloaded numbers its messages from 1 again: not duplicates
    const a2 = client(net, 'alice-device-01', { tab: 'newpage' });
    net.run(1500);
    a2.c.sendState({ n: 'again' });
    net.run(200);
    expect(b.all('state').at(-1)?.d).toEqual({ n: 'again' });
  });

  it('delivers chat, reports why a message was refused and keeps presets working', async () => {
    const net = await Net.make();
    const a = client(net, 'alice-device-01'); const b = client(net, 'bob-device-0002');
    net.run(1000);
    a.c.chat('hello there');
    net.run(100);
    expect(b.all('chat')).toEqual([{ from: 's1', text: 'hello there', at: expect.any(Number) }]);
    net.run(5100);
    a.c.chat('see https://example.com');
    net.run(100);
    expect(a.all('chatRejected')).toEqual([{ reason: 'link' }]);
    a.c.preset('gg');
    net.run(100);
    expect(b.all('preset')[0]).toMatchObject({ from: 's1', id: 'gg' });
  });

  it('leaving on purpose forfeits at once and does not reconnect', async () => {
    const { net, a, b } = await startedPair();
    net.run(20_000);
    b.c.leave();
    net.run(500);
    expect(a.all('result')[0]).toMatchObject({ reason: 'forfeit', winner: 's1' });
    expect(b.c.closed).toBe(true);
    net.run(10_000);
    expect(b.c.m.wsOpens).toBe(1);
  });
});
