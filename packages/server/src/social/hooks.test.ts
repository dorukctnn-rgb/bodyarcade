// The hooks live play (builder N) calls: identity from signed requests, the join gate, the lobby directory, presence and blocks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signRequest } from '../../../core/social/sign.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import { HttpError } from '../http.ts';
import type { LiveEnv } from '../live/env.ts';
import { anonymousPlayer, socialHooks } from './hooks.ts';
import { createTestApp, TEST_ORIGIN, type TestApp, type TestPlayer } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let app: TestApp;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const env = (): LiveEnv => app.env as unknown as LiveEnv;
const bare = {} as unknown as LiveEnv;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const summary = (over: Partial<RoomSummary> & { code: string }): RoomSummary => ({
  kind: 'public', gameId: 'jacks', band: null, audience: 'adult', size: 4, players: 1, open: 3, names: ['Host'], phase: 'lobby', updatedAt: T0, ...over,
});

/** A signed request as N's route would receive it: the body is already parsed and handed to the hook. */
async function roomRequest(p: TestPlayer, path: string, body: Record<string, unknown>): Promise<Request> {
  const url = `${TEST_ORIGIN}${path}`;
  const header = await signRequest(p.dev.keys, { method: 'POST', url, body }, Date.now());
  return new Request(url, { method: 'POST', headers: { 'X-BA-Auth': header, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('verifyPlayer', () => {
  it('takes the name, the band and the mute from the stored profile, never from the body', async () => {
    const p = await app.signup('teen');
    const body = { kind: 'private', gameId: 'jacks', pid: 'liar-liar-liar', age: 'adult', name: 'Evil Name' };
    const who = await socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms', body), env(), body);
    expect(who).toEqual({ pid: p.pid(), name: p.me.name, age: 'teen' });
    expect(who).not.toHaveProperty('mutedUntil');
  });

  it('carries a mute that is still running', async () => {
    const p = await app.signup('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET muted_until = ? WHERE pid = ?').run(T0 + 3_600_000, p.pid());
    const who = await socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms/ABCDEF/join', {}), env(), {});
    expect(who?.mutedUntil).toBe(T0 + 3_600_000);
    vi.setSystemTime(T0 + 4_000_000);
    const later = await socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms/ABCDEF/join', {}), env(), {});
    expect(later).not.toHaveProperty('mutedUntil');
  });

  it('refuses an unsigned request, an unknown device, a tampered body and a replay, with the server time', async () => {
    const p = await app.signup('adult');
    const body = { kind: 'private' };
    const status = async (req: Request, b: Record<string, unknown>): Promise<HttpError> => {
      try { await socialHooks.verifyPlayer?.(req, env(), b); } catch (e) { return e as HttpError; }
      throw new Error('did not throw');
    };
    const unsigned = await status(new Request(`${TEST_ORIGIN}/api/rooms`, { method: 'POST' }), body);
    expect([unsigned.status, unsigned.code, unsigned.extra?.serverTime]).toEqual([401, 'unauthorized', T0]);
    const stranger = await app.newDevice();
    const strangerReq = await roomRequest({ ...p, dev: stranger } as TestPlayer, '/api/rooms', body);
    expect((await status(strangerReq, body)).code).toBe('unknown_device');
    const signed = await roomRequest(p, '/api/rooms', body);
    expect((await status(signed, { kind: 'public' })).code).toBe('unauthorized');
    const again = await roomRequest(p, '/api/rooms', body);
    await socialHooks.verifyPlayer?.(again, env(), body);
    expect((await status(again, body)).code).toBe('replayed');
  });

  it('refuses a banned player', async () => {
    const p = await app.signup('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(T0 + 1000, p.pid());
    await expect(socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms', {}), env(), {})).rejects.toMatchObject({ status: 403, code: 'banned' });
  });

  it('a player suspended from public play cannot open a public room, but private rooms and joins are not its business', async () => {
    const p = await app.signup('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET public_blocked_until = ? WHERE pid = ?').run(T0 + 86_400_000, p.pid());
    const pub = { kind: 'public', gameId: 'jacks' };
    await expect(socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms', pub), env(), pub)).rejects.toMatchObject({ status: 403, code: 'public_suspended' });
    const priv = { kind: 'private', gameId: 'jacks' };
    expect((await socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms', priv), env(), priv))?.pid).toBe(p.pid());
    expect((await socialHooks.verifyPlayer?.(await roomRequest(p, '/api/rooms/ABCDEF/join', {}), env(), {}))?.pid).toBe(p.pid());
  });

  it('without the social bindings it falls back to the anonymous identity live play uses on its own', async () => {
    const who = await socialHooks.verifyPlayer?.(new Request(`${TEST_ORIGIN}/api/rooms`), bare, { pid: 'device-1234', age: 'teen', name: 'Kai One' });
    expect(who).toEqual({ pid: 'device-1234', name: 'Kai One', age: 'teen' });
    expect(() => anonymousPlayer({ pid: 'x', age: 'teen', name: 'Kai' })).toThrow(HttpError);
    expect(() => anonymousPlayer({ pid: 'device-1234', age: 'giant', name: 'Kai' })).toThrow(/bad_age/);
    expect(() => anonymousPlayer({ pid: 'device-1234', age: 'adult', name: 'call 0555 123 45 67' })).toThrow(/bad_name/);
  });
});

describe('without the social bindings every other hook does nothing and lets live play through', () => {
  it('gateJoin allows, the rest are no-ops', async () => {
    expect(await socialHooks.gateJoin?.(bare, summary({ code: 'ABCDEF' }), { pid: 'x', name: 'x', age: 'child' })).toBe(true);
    await socialHooks.publishRoom?.(bare, summary({ code: 'ABCDEF' }), ['a']);
    await socialHooks.removeRoom?.(bare, 'ABCDEF');
    await socialHooks.setPlaying?.(bare, { code: 'ABCDEF', pid: 'a', inRoom: true, playing: false, gameId: 'jacks' });
    await socialHooks.blockByPid?.(bare, 'a', 'b');
    await socialHooks.submitReport?.(bare, { code: 'ABCDEF', matchId: null, reporterPid: 'a', targetPid: 'b', reporterSeat: 's1', targetSeat: 's2', reason: 'abuse', at: T0, chat: [] });
  });
});

describe('publishRoom, removeRoom and gateJoin', () => {
  it('the directory follows what the Room reports, and the gate follows the directory', async () => {
    const host = await app.signup('adult');
    const guest = await app.signup('adult');
    const teen = await app.signup('teen');
    await socialHooks.publishRoom?.(env(), summary({ code: 'ABCDEF', names: [host.me.name] }), [host.pid()]);
    expect((await guest.get('/api/social/lobbies')).body.lobbies.map((l: { code: string }) => l.code)).toEqual(['ABCDEF']);
    const s = summary({ code: 'ABCDEF' });
    expect(await socialHooks.gateJoin?.(env(), s, { pid: guest.pid(), name: guest.me.name, age: 'adult' })).toBe(true);
    expect(await socialHooks.gateJoin?.(env(), s, { pid: teen.pid(), name: teen.me.name, age: 'teen' })).toBe(false);
    await guest.post('/api/social/blocks', { fid: host.me.fid });
    expect(await socialHooks.gateJoin?.(env(), s, { pid: guest.pid(), name: guest.me.name, age: 'adult' })).toBe(false);
    await socialHooks.removeRoom?.(env(), 'ABCDEF');
    expect((await teen.get('/api/social/lobbies')).body.lobbies).toEqual([]);
  });
});

describe('setPlaying', () => {
  async function friends(): Promise<[TestPlayer, TestPlayer]> {
    const a = await app.signup('adult');
    const b = await app.signup('adult');
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    app.db.raw.prepare('INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)').run(a.pid(), T0, T0);
    app.db.raw.prepare('INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)').run(b.pid(), T0, T0);
    app.hubs.connect(b.pid());
    return [a, b];
  }

  it('a player entering a room, starting a match and leaving shows up for friends, live and in the list', async () => {
    const [a, b] = await friends();
    await socialHooks.publishRoom?.(env(), summary({ code: 'ABCDEF', kind: 'private', audience: null, names: [a.me.name] }), [a.pid()]);
    await socialHooks.setPlaying?.(env(), { code: 'ABCDEF', pid: a.pid(), inRoom: true, playing: false, gameId: 'jacks' });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'in_room', game: 'jacks', room: 'ABCDEF' } }]);
    expect((await b.get('/api/social/friends')).body.friends[0].presence).toEqual({ status: 'in_room', game: 'jacks', room: 'ABCDEF' });
    await socialHooks.setPlaying?.(env(), { code: 'ABCDEF', pid: a.pid(), inRoom: true, playing: true, gameId: 'jacks' });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'playing', game: 'jacks' } }]);
    await socialHooks.setPlaying?.(env(), { code: 'ABCDEF', pid: a.pid(), inRoom: false, playing: false, gameId: 'jacks' });
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'presence', fid: a.me.fid, name: a.me.name, presence: { status: 'online' } }]);
  });

  it('leaving a room the player is no longer in tells nobody and writes nothing', async () => {
    const [a, b] = await friends();
    await socialHooks.setPlaying?.(env(), { code: 'AAAAAA', pid: a.pid(), inRoom: true, playing: false, gameId: 'jacks' });
    app.hubs.take(b.pid());
    app.db.resetCounters();
    await socialHooks.setPlaying?.(env(), { code: 'BBBBBB', pid: a.pid(), inRoom: false, playing: false, gameId: 'jacks' });
    expect(app.hubs.events(b.pid())).toEqual([]);
    expect(app.db.counters.writes).toBe(0);
  });

  it('a player with no profile leaves no trace', async () => {
    await socialHooks.setPlaying?.(env(), { code: 'AAAAAA', pid: 'device-unknown', inRoom: true, playing: false, gameId: 'jacks' });
    expect((app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_presence').get() as { n: number }).n).toBe(0);
  });
});

describe('blockByPid', () => {
  it('a block made inside a room ends the friendship and is kept for matchmaking', async () => {
    const a = await app.signup('adult');
    const b = await app.signup('adult');
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    app.hubs.connect(b.pid());
    await socialHooks.blockByPid?.(env(), a.pid(), b.pid());
    expect((await a.get('/api/social/blocks')).body.blocks.map((x: { fid: string }) => x.fid)).toEqual([b.me.fid]);
    expect((await a.get('/api/social/friends')).body.friends).toEqual([]);
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'friend_removed', fid: a.me.fid }]);
    // asking twice, blocking yourself or someone who is not a profile does nothing
    await socialHooks.blockByPid?.(env(), a.pid(), b.pid());
    await socialHooks.blockByPid?.(env(), a.pid(), a.pid());
    await socialHooks.blockByPid?.(env(), a.pid(), 'nobody');
    expect((app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_blocks').get() as { n: number }).n).toBe(1);
  });
});
