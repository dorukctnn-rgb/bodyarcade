// The player's side of the Pro check, against the real Room in one process (loopkit): the token rides in the create and join calls
// (a flag never does), a host who bought Pro or whose app renewed its token after the ticket was signed takes a fresh ticket before a
// Pro game is picked, a room that waits for a lapsed proof goes on by itself when the host holds a newer token, and none of it ever
// interrupts a match or loops on a token the Room has already found wanting.
import { describe, expect, it } from 'vitest';
import type { JoinGrant } from '../../../core/types/net.ts';
import { LiveApiError, createRoom, joinRoom } from '../../../core/net/api.ts';
import { LiveClient, type LiveClientOptions, type LiveEvents } from '../../../core/net/client.ts';
import { LiveRace } from '../../../core/net/race.ts';
import { Net, seeded } from './loopkit.ts';
import type { claimsFor } from './testkit.ts';

const DAY = 86_400_000;
const FREE = { gameId: 'squat-flap', durationMs: 30_000, band: null } as const;
/** The ticket claim of a player whose Pro token is good until `ms` (epoch ms on the Room's clock), in the whole seconds the Worker writes. */
const x = (ms: number): { x: number } => ({ x: Math.floor(ms / 1000) });
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Probe {
  c: LiveClient;
  all<K extends keyof LiveEvents>(type: K): LiveEvents[K][];
}

function client(net: Net, pid: string, o: Partial<LiveClientOptions> = {}, over: Partial<ReturnType<typeof claimsFor>> = {}): Probe {
  const c = new LiveClient({
    grant: net.grant(pid, over), origin: 'http://loop', peers: 'none', sched: net.sched, socket: net.factory, random: seeded(pid), ...o,
  });
  const log: { type: string; detail: unknown }[] = [];
  for (const t of ['room', 'welcome', 'match', 'result', 'roomError', 'fatal', 'status'] as const) c.on(t, (detail) => { log.push({ type: t, detail }); });
  void c.start();
  return { c, all: (type) => log.filter((e) => e.type === type).map((e) => e.detail) as never };
}

interface TokenState {
  /** What the app holds now (null: no Pro). */
  token: string | null;
  /** What the ticket the client started with was made from. */
  sent: string | null;
  /** Whether the Worker finds a proof in a token that is presented now (false: it looks new and is not a Pro token). */
  proves: boolean;
}

/** The options of a player whose app holds `state.token`: every ticket asked for carries a proof of it, or none when `proves` is false. */
function renewing(net: Net, pid: string, state: TokenState): { opts: Partial<LiveClientOptions>; count: () => number } {
  let n = 0;
  return {
    opts: {
      pro: () => state.token, proSent: state.sent,
      refreshTicket: async (): Promise<JoinGrant> => { n++; return net.grant(pid, state.token && state.proves ? x(net.room.host.now() + DAY) : {}); },
    },
    count: () => n,
  };
}

describe('a host who got Pro after the ticket was signed', () => {
  it('is refused a Pro game with nothing to show, then renews the ticket and gets it once the app holds a token', async () => {
    const net = await Net.make({ config: FREE });
    const state: TokenState = { token: null, sent: null, proves: true };
    const r = renewing(net, 'alice-device-01', state);
    const a = client(net, 'alice-device-01', r.opts);
    const b = client(net, 'bob-device-0002');
    net.run(3000);
    expect(a.c.you).toBe('s1');

    a.c.configure({ gameId: 'limbo-bend' });                       // free: the Room says no and keeps the game
    net.run(300);
    expect(a.all('roomError')).toEqual([{ code: 'pro_required' }]);
    expect(a.c.room?.config.gameId).toBe('squat-flap');
    expect(r.count()).toBe(0);

    state.token = 'the-token-the-app-holds-now';                   // she bought Pro in this lobby
    a.c.configure({ gameId: 'limbo-bend' });
    net.run(50); await settle(); net.run(2000);
    expect(r.count()).toBe(1);
    expect(a.all('roomError')).toHaveLength(1);                    // the first refusal only
    expect(a.c.room).toMatchObject({ config: { gameId: 'limbo-bend' }, pro: { ok: true } });
    expect(b.c.room).toMatchObject({ config: { gameId: 'limbo-bend' }, pro: { ok: true } });
    expect(a.all('fatal')).toHaveLength(0);
    expect(a.c.you).toBe('s1');                                    // the same seat, still the host
  });

  it('goes straight to the Room when the Room already read the very token the app holds', async () => {
    const net = await Net.make({ config: FREE });
    const state: TokenState = { token: 'tok-1', sent: 'tok-1', proves: true };
    const r = renewing(net, 'alice-device-01', state);
    const a = client(net, 'alice-device-01', r.opts, x(net.room.host.now() + DAY));
    client(net, 'bob-device-0002');
    net.run(3000);
    a.c.configure({ gameId: 'pad-work' });
    net.run(300);
    expect(r.count()).toBe(0);
    expect(a.c.m.wsOpens).toBe(1);
    expect(a.all('roomError')).toHaveLength(0);
    expect(a.c.room).toMatchObject({ config: { gameId: 'pad-work' }, pro: { ok: true } });
  });

  it('never renews for a free game or a new length, however new the token is', async () => {
    const net = await Net.make({ config: FREE });
    const state: TokenState = { token: 'brand-new', sent: null, proves: true };
    const r = renewing(net, 'alice-device-01', state);
    const a = client(net, 'alice-device-01', r.opts);
    client(net, 'bob-device-0002');
    net.run(3000);
    a.c.configure({ gameId: 'knee-sprint' });
    a.c.configure({ durationMs: 45_000 });
    net.run(300);
    expect(r.count()).toBe(0);
    expect(a.c.room?.config).toMatchObject({ gameId: 'knee-sprint', durationMs: 45_000 });
    expect(a.all('roomError')).toHaveLength(0);
  });

  it('a player with no way to renew (no refresh, no token function) simply asks and is told', async () => {
    const net = await Net.make({ config: FREE });
    const a = client(net, 'alice-device-01');
    client(net, 'bob-device-0002');
    net.run(3000);
    a.c.configure({ gameId: 'reaction-tag' });
    net.run(300);
    expect(a.all('roomError')).toEqual([{ code: 'pro_required' }]);
    expect(await a.c.renewEntitlement()).toBe(false);
  });
});

describe('a room that waits for a lapsed proof', () => {
  /**
   * Alice (host) holds a proof that ends 20 s into the lobby and picks the Pro game with it; the app renews its token later (`newToken`),
   * the proof lapses, and both players press ready.
   */
  async function lapsed(newToken: string, proves: boolean): Promise<{ net: Net; a: Probe; b: Probe; r: ReturnType<typeof renewing>; state: TokenState }> {
    const net = await Net.make({ config: FREE });
    const state: TokenState = { token: 'old-token', sent: 'old-token', proves };
    const r = renewing(net, 'alice-device-01', state);
    const a = client(net, 'alice-device-01', r.opts, x(net.room.host.now() + 20_000));
    const b = client(net, 'bob-device-0002');
    net.run(3000);
    a.c.configure({ gameId: 'limbo-bend' });                       // her proof stands behind it for 20 s
    net.run(300);
    expect(a.c.room).toMatchObject({ config: { gameId: 'limbo-bend' }, pro: { ok: true } });
    state.token = newToken;
    net.run(25_000);                                               // the proof ended meanwhile; nobody was ready, so nobody was told
    a.c.setReady(true); b.c.setReady(true);
    net.run(400);
    return { net, a, b, r, state };
  }

  it('the host renews the ticket by itself when the app holds a newer token, and the match starts', async () => {
    const { net, a, b, r } = await lapsed('renewed-by-the-app', true);
    expect(a.all('room').some((m) => m.pro?.ok === false)).toBe(true);
    await settle(); net.run(2500);
    expect(r.count()).toBe(1);
    expect(a.all('match')).toHaveLength(1);
    expect(b.all('match')).toHaveLength(1);
    expect(a.c.room?.pro).toEqual({ ok: true });
  });

  it('a token the Room found wanting is tried once and never again: the room waits and nothing loops', async () => {
    const { net, a, b, r } = await lapsed('looks-new-but-is-not-pro', false);
    await settle(); net.run(2500);
    net.run(60_000);
    await settle();
    expect(r.count()).toBe(1);
    expect(a.all('match')).toHaveLength(0);
    expect(b.all('match')).toHaveLength(0);
    expect(a.c.room?.pro).toEqual({ ok: false });
    expect(a.all('fatal')).toHaveLength(0);
  });

  it('with no newer token the room just waits and nothing is asked again', async () => {
    const { net, a, b, r } = await lapsed('old-token', true);
    await settle(); net.run(5000);
    expect(r.count()).toBe(0);
    expect(a.c.room?.pro).toEqual({ ok: false });
    expect(b.c.room?.pro).toEqual({ ok: false });
    expect(a.all('match')).toHaveLength(0);
  });

  it('a friend who is not the host never renews anything', async () => {
    const net = await Net.make({ config: FREE });
    const a = client(net, 'alice-device-01', {}, x(net.room.host.now() + 20_000));
    const state: TokenState = { token: 'friend-holds-one', sent: null, proves: true };
    const r = renewing(net, 'bob-device-0002', state);
    const b = client(net, 'bob-device-0002', r.opts);
    net.run(3000);
    a.c.configure({ gameId: 'limbo-bend' });
    net.run(300);
    net.run(25_000);
    a.c.setReady(true); b.c.setReady(true);
    net.run(400); await settle(); net.run(3000);
    expect(b.all('room').some((m) => m.pro?.ok === false)).toBe(true);
    expect(r.count()).toBe(0);
    expect(b.all('match')).toHaveLength(0);
  });
});

describe('a match that is running', () => {
  it('is never interrupted to renew a ticket', async () => {
    const net = await Net.make({ config: FREE });
    const state: TokenState = { token: 'tok-new', sent: null, proves: true };
    const r = renewing(net, 'alice-device-01', state);
    const a = client(net, 'alice-device-01', r.opts);
    const b = client(net, 'bob-device-0002');
    net.run(3000);
    a.c.setReady(true); b.c.setReady(true);
    net.run(400);
    expect(a.c.playing).toBe(true);
    expect(await a.c.renewEntitlement()).toBe(false);
    a.c.configure({ gameId: 'limbo-bend' });                       // not a lobby: the Room says so, and the socket is the same one
    net.run(500); await settle(); net.run(500);
    expect(r.count()).toBe(0);
    expect(a.c.m.wsOpens).toBe(1);
    expect(a.all('fatal')).toHaveLength(0);
    expect(b.all('match')).toHaveLength(1);
  });
});

describe('the calls of a page', () => {
  const who = { pid: 'alice-device-01', name: 'Alice', age: 'adult' as const };
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const answer = (net: Net, status = 201, over: Record<string, unknown> | null = null): typeof fetch => (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    seen.push({ url, body });
    return new Response(JSON.stringify(over ?? net.grant(String(body.pid))), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;

  it('the token goes in the body of the create and join calls, and a free player sends none (never a flag)', async () => {
    const net = await Net.make();
    seen.length = 0;
    await createRoom('http://loop', who, { gameId: 'limbo-bend', size: 2 }, answer(net), 'TOKEN-1');
    await createRoom('http://loop', who, { gameId: 'squat-flap', size: 2 }, answer(net));
    await joinRoom('http://loop', 'K7P2QX', who, answer(net), 'TOKEN-2');
    await joinRoom('http://loop', 'K7P2QX', who, answer(net), null);
    expect(seen.map((s) => s.body.pro)).toEqual(['TOKEN-1', undefined, 'TOKEN-2', undefined]);
    for (const s of seen) { expect('free' in s.body).toBe(false); expect(s.body.isPro).toBeUndefined(); }
  });

  it('a Pro refusal keeps its reason (none, expired, invalid) so the page can say what to do', async () => {
    const net = await Net.make();
    for (const reason of ['none', 'expired', 'invalid']) {
      const e = await createRoom('http://loop', who, { gameId: 'limbo-bend', size: 2 }, answer(net, 403, { error: 'pro_required', reason })).catch((v: unknown) => v);
      expect(e).toBeInstanceOf(LiveApiError);
      expect(e).toMatchObject({ status: 403, code: 'pro_required', info: { reason } });
    }
    const plain = await joinRoom('http://loop', 'K7P2QX', who, answer(net, 404, { error: 'no_room' })).catch((v: unknown) => v);
    expect((plain as LiveApiError).info).toBeUndefined();
  });

  it('LiveRace asks for the current token at every create, join and ticket renewal', async () => {
    const net = await Net.make({ config: FREE });
    seen.length = 0;
    let token: string | null = 'T-1';
    const common = { origin: 'http://loop', peers: 'none' as const, pauseWhenHidden: false, pro: () => token, fetcher: answer(net), client: { sched: net.sched, socket: net.factory } };
    const host = await LiveRace.host({ ...common, who, gameId: 'squat-flap', durationMs: 30_000 });
    net.run(1500);
    token = 'T-2';
    const guest = await LiveRace.join({ ...common, who: { pid: 'bob-device-0002', name: 'Bob', age: 'adult' }, invite: host.invite.link });
    expect(seen.map((s) => s.body.pro)).toEqual(['T-1', 'T-2']);

    token = 'T-3';                                                 // the app renewed its token; the host picks a Pro game: the ticket is renewed first
    host.configure({ gameId: 'pad-work' });
    net.run(50); await settle(); net.run(500);
    expect(seen.map((s) => s.body.pro)).toEqual(['T-1', 'T-2', 'T-3']);
    expect(seen[2]?.url).toBe(`http://loop/api/rooms/${host.invite.code}/join`);
    host.dispose(); guest.dispose();
  });
});
