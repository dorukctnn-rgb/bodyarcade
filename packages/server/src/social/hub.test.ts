// The registry of the players' sockets, with fake sockets and a fake state: what it writes, who it tells, what it refuses. The
// upgrade, the directory object around it and the hibernation of real sockets are in directory.test.ts and the Miniflare tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE } from '../../../core/social/rules.ts';
import { HUB_CLOSE } from '../../../core/social/types.ts';
import { BEAT_MIN_GAP_MS, HubRegistry, STATUS_BURST, hubTag, type HubIdentity } from './hub.ts';
import { createTestApp, FakeSocket, FakeState, type TestApp, type TestPlayer } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let app: TestApp;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const who = (p: TestPlayer): HubIdentity => ({ pid: p.pid(), fid: p.me.fid, name: p.me.name, band: p.me.band });
const presenceRow = (p: TestPlayer) => app.db.raw.prepare('SELECT online, seen_at, c_status, c_game FROM soc_presence WHERE pid = ?').get(p.pid());

async function connect(p: TestPlayer): Promise<{ hub: HubRegistry; state: FakeState; ws: FakeSocket }> {
  const state = new FakeState();
  const hub = new HubRegistry(state, app.env);
  const ws = new FakeSocket();
  hub.accept(ws, who(p));
  await state.settle();
  return { hub, state, ws };
}

async function pair(): Promise<[TestPlayer, TestPlayer]> {
  const a = await app.signup('adult');
  const b = await app.signup('adult');
  await a.post('/api/social/friends/request', { code: b.me.code });
  await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
  return [a, b];
}

describe('connecting', () => {
  it('greets with the server time, marks the player online and tells the online friends', async () => {
    const [a, b] = await pair();
    // b is online already (its own hub), so b is told when a arrives
    await connect(b);
    app.hubs.connect(b.pid());
    app.hubs.take(b.pid());
    const { ws } = await connect(a);
    expect(ws.events()).toEqual([{ t: 'hello', now: T0 }]);
    expect(presenceRow(a)).toMatchObject({ online: 1, seen_at: T0, c_status: 'online' });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'online' } }]);
  });

  it('a second tab replaces the first: the old socket is told and closed, the player stays online', async () => {
    const [a, b] = await pair();
    const state = new FakeState();
    const hub = new HubRegistry(state, app.env);
    const first = new FakeSocket();
    hub.accept(first, who(a));
    await state.settle();
    await connect(b);
    app.hubs.connect(b.pid());
    app.hubs.take(b.pid());
    const second = new FakeSocket();
    hub.accept(second, who(a));
    await state.settle();
    expect(first.events()).toContainEqual({ t: 'closing', reason: 'replaced' });
    expect(first.closed?.code).toBe(HUB_CLOSE.REPLACED);
    expect(second.events()).toEqual([{ t: 'hello', now: T0 }]);
    // the old socket's close arrives after the new one is in place: nobody is told the player left
    hub.webSocketClose(first, HUB_CLOSE.REPLACED, 'replaced');
    await state.settle();
    expect(presenceRow(a)).toMatchObject({ online: 1 });
    expect(app.hubs.events(b.pid())).toEqual([]);
  });

  it('a reconnect inside a minute writes nothing and tells nobody', async () => {
    const [a, b] = await pair();
    await connect(a);
    app.hubs.connect(b.pid());
    app.db.raw.prepare('INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)').run(b.pid(), T0, T0);
    app.db.resetCounters();
    vi.setSystemTime(T0 + 5000);
    await connect(a);
    expect(app.db.counters.writes).toBe(0);
    expect(app.hubs.events(b.pid())).toEqual([]);
  });

  it('holds the sockets of many players in one state: a second tab of one player never touches the others', async () => {
    const [a, b] = await pair();
    const state = new FakeState();
    const hub = new HubRegistry(state, app.env);
    const wsA = new FakeSocket();
    const wsB = new FakeSocket();
    hub.accept(wsA, who(a));
    hub.accept(wsB, who(b));
    await state.settle();
    expect(state.getWebSockets(hubTag(a.pid()))).toEqual([wsA]);
    expect(state.getWebSockets(hubTag(b.pid()))).toEqual([wsB]);
    expect(hub.has(a.pid())).toBe(true);
    const wsA2 = new FakeSocket();
    hub.accept(wsA2, who(a));
    await state.settle();
    expect(wsA.closed?.code).toBe(HUB_CLOSE.REPLACED);
    expect(wsB.closed).toBeNull();
    expect(wsB.events()).toEqual([{ t: 'hello', now: T0 }]);
    expect(hub.open(a.pid())).toEqual([wsA2]);
    expect(hub.open(b.pid())).toEqual([wsB]);
  });
});

describe('messages', () => {
  it('a heartbeat refreshes the time (one write), and a second one within thirty seconds is ignored', async () => {
    const [a] = await pair();
    const { hub, state, ws } = await connect(a);
    vi.setSystemTime(T0 + PRESENCE.beatEveryMs);
    app.db.resetCounters();
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'beat' }));
    await state.settle();
    expect(app.db.counters.writes).toBe(1);
    expect((presenceRow(a) as { seen_at: number }).seen_at).toBe(T0 + PRESENCE.beatEveryMs);
    vi.setSystemTime(T0 + PRESENCE.beatEveryMs + BEAT_MIN_GAP_MS - 1000);
    app.db.resetCounters();
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'beat' }));
    await state.settle();
    expect(app.db.counters.writes).toBe(0);
    vi.setSystemTime(T0 + PRESENCE.beatEveryMs + BEAT_MIN_GAP_MS + 1000);
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'beat' }));
    await state.settle();
    expect(app.db.counters.writes).toBe(1);
  });

  it('a heartbeat from a player the sweep had marked offline brings them back and tells friends', async () => {
    const [a, b] = await pair();
    const { hub, state, ws } = await connect(a);
    await connect(b);
    app.hubs.connect(b.pid());
    app.db.raw.prepare('UPDATE soc_presence SET online = 0 WHERE pid = ?').run(a.pid());
    vi.setSystemTime(T0 + PRESENCE.beatEveryMs);
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'beat' }));
    await state.settle();
    expect(presenceRow(a)).toMatchObject({ online: 1 });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'online' } }]);
  });

  it('a status change is stored and pushed; the same status again is not', async () => {
    const [a, b] = await pair();
    const { hub, state, ws } = await connect(a);
    await connect(b);
    app.hubs.connect(b.pid());
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'status', status: 'playing', game: 'jacks' }));
    await state.settle();
    expect(presenceRow(a)).toMatchObject({ c_status: 'playing', c_game: 'jacks' });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'playing', game: 'jacks' } }]);
    app.db.resetCounters();
    vi.setSystemTime(T0 + 2000);
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'status', status: 'playing', game: 'jacks' }));
    await state.settle();
    expect(app.db.counters.writes).toBe(0);
    expect(app.hubs.events(b.pid())).toEqual([]);
    vi.setSystemTime(T0 + 4000);
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'status', status: 'online' }));
    await state.settle();
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'online' } }]);
  });

  it('a client that flaps its status costs a burst of writes and then one a minute', async () => {
    const [a] = await pair();
    const { hub, state, ws } = await connect(a);
    app.db.resetCounters();
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(T0 + 1000 + i * 50);
      await hub.webSocketMessage(ws, JSON.stringify({ t: 'status', status: i % 2 === 0 ? 'playing' : 'online', game: 'jacks' }));
    }
    await state.settle();
    // each accepted change is one write; the burst is STATUS_BURST
    expect(app.db.counters.writes).toBeLessThanOrEqual(STATUS_BURST);
    expect(app.db.counters.writes).toBeGreaterThanOrEqual(STATUS_BURST - 1);
    // a minute later one more is allowed
    app.db.resetCounters();
    vi.setSystemTime(T0 + 70_000);
    await hub.webSocketMessage(ws, JSON.stringify({ t: 'status', status: 'playing', game: 'star' }));
    await state.settle();
    expect(app.db.counters.writes).toBe(1);
  });

  it('ignores a status that is not one of ours, a game id that is not an id, and anything that is not JSON', async () => {
    const [a] = await pair();
    const { hub, state, ws } = await connect(a);
    app.db.resetCounters();
    for (const m of ['{"t":"status","status":"god"}', '{"t":"status","status":"playing","game":"<script>"}', 'not json', '{"t":"other"}', '[]', '{"t":"status"}']) {
      await hub.webSocketMessage(ws, m);
    }
    await state.settle();
    expect(app.db.counters.writes).toBe(0);
    expect(ws.closed).toBeNull();
  });

  it('closes a socket that sends too much or too fast', async () => {
    const [a] = await pair();
    const { hub, ws } = await connect(a);
    await hub.webSocketMessage(ws, 'x'.repeat(513));
    expect(ws.closed?.code).toBe(1009);
    const { hub: hub2, ws: ws2 } = await connect(a);
    for (let i = 0; i < PRESENCE.maxMessagesPerSec + 5; i++) await hub2.webSocketMessage(ws2, '{"t":"x"}');
    expect(ws2.closed?.code).toBe(HUB_CLOSE.RATE);
  });
});

describe('leaving', () => {
  it('the last socket closing makes the player offline and tells the online friends', async () => {
    const [a, b] = await pair();
    const { hub, state, ws } = await connect(a);
    await connect(b);
    app.hubs.connect(b.pid());
    ws.close(1000, 'bye');
    hub.webSocketClose(ws, 1000, 'bye');
    await state.settle();
    expect(presenceRow(a)).toMatchObject({ online: 0 });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'offline' } }]);
    // closing again tells nobody twice
    hub.webSocketClose(ws, 1000, 'bye');
    await state.settle();
    expect(app.hubs.events(b.pid())).toEqual([]);
  });

  it('an error on the socket is a close', async () => {
    const [a] = await pair();
    const { hub, state, ws } = await connect(a);
    ws.close(1006);
    hub.webSocketError(ws);
    await state.settle();
    expect(presenceRow(a)).toMatchObject({ online: 0 });
  });
});

/** The registry's namespace: what the handlers call to reach a player's sockets (`env.HUB.get(env.HUB.idFromName(pid)).fetch(...)`). */
const stubOf = (hub: HubRegistry, p: TestPlayer) => hub.namespace().get(hub.namespace().idFromName(p.pid()));
const post = (path: string, body: unknown) => new Request(`https://hub.internal${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('pushes and closes from the handlers', () => {
  it('delivers an event to every open socket of that player only, answers 204 when none is open, refuses what is not an event', async () => {
    const [a, b] = await pair();
    const { hub, state, ws } = await connect(a);
    const other = new FakeSocket();
    hub.accept(other, who(b));
    await state.settle();
    const ev = { t: 'friend_removed', fid: 'ABCDEFGHJK' };
    const res = await stubOf(hub, a).fetch(post('/push', ev));
    expect(res.status).toBe(200);
    expect(ws.events().at(-1)).toEqual(ev);
    expect(other.events().filter((e) => e.t === 'friend_removed')).toEqual([]);
    expect((await stubOf(hub, a).fetch(post('/push', { t: 'hack' }))).status).toBe(400);
    expect((await stubOf(hub, a).fetch(post('/push', 'x'))).status).toBe(400);
    expect((await stubOf(hub, a).fetch(new Request('https://hub.internal/nope'))).status).toBe(404);
    ws.close(1000);
    expect((await stubOf(hub, a).fetch(post('/push', ev))).status).toBe(204);
    // a player nobody holds a socket for is simply offline
    expect((await hub.namespace().get(hub.namespace().idFromName('nobody')).fetch(post('/push', ev))).status).toBe(204);
  });

  it('closes with the code of the reason: deleted or banned', async () => {
    const [a] = await pair();
    const one = await connect(a);
    const r = await stubOf(one.hub, a).fetch(post('/close', { reason: 'deleted' }));
    expect(r.status).toBe(204);
    expect(one.ws.events().at(-1)).toEqual({ t: 'closing', reason: 'deleted' });
    expect(one.ws.closed?.code).toBe(HUB_CLOSE.DELETED);
    const two = await connect(a);
    await stubOf(two.hub, a).fetch(post('/close', { reason: 'banned' }));
    expect(two.ws.closed?.code).toBe(HUB_CLOSE.BANNED);
    expect((await stubOf(two.hub, a).fetch(post('/close', { reason: 'x' }))).status).toBe(400);
  });
});
