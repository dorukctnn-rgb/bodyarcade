// LiveClient against the real RoomEngine in one process: a manual clock, sockets with latency, and the failures a
// phone meets (drops, half-open sockets, a deploy, a second tab). The two-browser suite (tests/live) repeats the
// important ones with real browsers, WebRTC and workerd; this is the fast layer that pins the client logic down.
import { describe, expect, it } from 'vitest';
import { CLOSE, type JoinGrant, type MatchInfo, type ObstacleResult } from '../../../core/types/net.ts';
import { LiveClient, type LiveClientOptions, type LiveEvents } from '../../../core/net/client.ts';
import { makeSchedule, specFor } from '../../../core/net/schedule.ts';
import { LoopSocket, Net, seeded } from './loopkit.ts';
import { Room, claimsFor } from './testkit.ts';

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
    expect(a.all('status').map((s) => s.state)).toEqual(['connecting', 'online']);
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

describe('connection attempts that get no answer', () => {
  it('abandons an attempt that hangs and connects as soon as the network answers', async () => {
    const net = await Net.make();
    net.blackhole = true;
    const a = client(net, 'alice-device-01');
    net.run(9000);
    expect(a.c.m.deadSockets).toBe(0);                          // the lobby gives an attempt 10 s
    net.run(2500);
    expect(a.c.m.deadSockets).toBe(1);
    expect(a.all('welcome')).toHaveLength(0);
    net.blackhole = false;
    net.run(11_000);                                            // the attempt in flight is abandoned too, then the next one connects
    expect(a.all('welcome')).toHaveLength(1);
    expect(a.c.members).toHaveLength(1);
  });

  it('in a match a hanging reconnect is abandoned after 6 s, the match pauses meanwhile and resumes on return', async () => {
    const { net, a, b, match } = await startedPair();
    net.run(match.startAt - net.room.host.now() + 1000);
    const dead = net.sockets.filter((s) => s.pid === 'bob-device-0002').at(-1) as LoopSocket;
    net.blackhole = true;
    dead.kill();
    net.run(7500);
    expect(b.c.m.deadSockets).toBe(1);
    expect(phases(a).some((p) => p.includes('paused'))).toBe(true);
    net.blackhole = false;
    net.run(9000);
    expect(b.all('welcome').length).toBeGreaterThanOrEqual(2);
    expect(a.c.match?.phase).toBe('running');
  });
});

describe('the Room drops a socket that went silent', () => {
  it('a phone that vanished mid-match (no close, no pings) is a ghost no longer: the match pauses for it and then forfeits it', async () => {
    const { net, a, b, match } = await startedPair({ silentLobbyMs: 40_000, silentMatchMs: 9000, sweepLobbyMs: 15_000, sweepMatchMs: 3000 });
    net.run(match.startAt - net.room.host.now() + 2000);
    // bob's phone locks: his page stops running (no pings, no messages) and his socket never closes
    const ghost = net.sockets.filter((s) => s.pid === 'bob-device-0002').at(-1) as LoopSocket;
    ghost.frozen = true;
    b.c.stop();                                                 // no close frame ever reaches the Room
    const ghostConn = ghost.conn as LoopConn;
    net.run(8000);
    expect(ghostConn.open).toBe(true);
    net.run(6000);
    expect(ghostConn.closeInfo?.code).toBe(CLOSE.SILENT);
    expect(net.room.engine.inspect().members.find((m) => m.seat === 's2')?.online).toBe(false);
    net.run(6000);
    expect(phases(a).some((p) => p.includes('paused'))).toBe(true);
    net.run(46_000);
    expect(a.all('forfeit')[0]?.seat).toBe('s2');
    expect(a.all('result')[0]).toMatchObject({ winner: 's1' });
  });

  it('live clients that only ping are never dropped, in a lobby or a match', async () => {
    const { net, a, b, match } = await startedPair({ silentLobbyMs: 40_000, silentMatchMs: 9000, sweepLobbyMs: 15_000, sweepMatchMs: 3000 });
    net.run(match.startAt - net.room.host.now() + 20_000);
    expect(a.c.members.every((m) => m.online)).toBe(true);
    expect(net.room.host.all.filter((c) => c.closeInfo?.code === CLOSE.SILENT)).toHaveLength(0);
    expect(b.c.m.deadSockets).toBe(0);
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
