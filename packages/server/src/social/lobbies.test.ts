// The lobby directory, quick match, the join gate and invitations.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GHOST_OFFER_AFTER_MS } from '../../../core/social/levels.ts';
import { INVITE_TTL_MS, MINUTE } from '../../../core/social/rules.ts';
import type { AgeBand, LobbyEntry } from '../../../core/social/types.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import { LOBBY_REFRESH_MS, LOBBY_STALE_MS, mayJoinPublic, publishRoom, removeRoom } from './lobbies.ts';
import { markOnline, setRoomState } from './presence.ts';
import { createTestApp, type TestApp, type TestPlayer } from './testkit.ts';

let app: TestApp;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const player = (band: AgeBand = 'adult', extra: Record<string, unknown> = {}) => app.signup(band, extra);
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let seq = 0;
/** A valid six-character room code, different every call. */
const code = (): string => {
  let n = ++seq;
  let s = '';
  for (let i = 0; i < 6; i++) { s = ALPHA[n % 32] + s; n = Math.floor(n / 32); }
  return s;
};

function summary(over: Partial<RoomSummary> & { code: string }): RoomSummary {
  return { kind: 'public', gameId: 'jacks', band: null, audience: 'adult', size: 4, players: 1, open: 3, names: ['Host'], phase: 'lobby', updatedAt: T0, ...over };
}
const publish = (s: RoomSummary, ...members: TestPlayer[]) => publishRoom(app.db, s, members.map((m) => m.pid()), Date.now());
const lobbies = async (p: TestPlayer, q = '') => (await p.get(`/api/social/lobbies${q}`)).body.lobbies as LobbyEntry[];
const lobbyRow = (c: string) => app.db.raw.prepare('SELECT * FROM soc_lobbies WHERE code = ?').get(c) as Record<string, unknown> | undefined;
const match = (p: TestPlayer, body: Record<string, unknown>) => p.post('/api/social/match', body);

describe('what the Room reports', () => {
  it('stores a room once somebody sits in it, with the region of the first member', async () => {
    const host = await player('adult', { region: 'na' });
    const c = code();
    expect(await publishRoom(app.db, summary({ code: c, players: 0, open: 4, names: [] }), [], T0)).toBe(false);
    expect(lobbyRow(c)).toBeUndefined();
    expect(await publish(summary({ code: c, names: [host.me.name] }), host)).toBe(true);
    expect(lobbyRow(c)).toMatchObject({ kind: 'public', grp: 'adult', region: 'na', game: 'jacks', players: 1, open: 3, phase: 'lobby', created_at: T0 });
    expect(JSON.parse(lobbyRow(c)?.names as string)).toEqual([host.me.name]);
  });

  it('keeps the region and the creation time while the room changes, and updates the rest', async () => {
    const host = await player('adult', { region: 'as' });
    const guest = await player('adult', { region: 'eu' });
    const c = code();
    await publish(summary({ code: c }), host);
    vi.setSystemTime(T0 + 30_000);
    await publish(summary({ code: c, players: 2, open: 2, names: ['A', 'B'] }), host, guest);
    expect(lobbyRow(c)).toMatchObject({ region: 'as', players: 2, open: 2, created_at: T0, updated_at: T0 + 30_000 });
    vi.setSystemTime(T0 + 60_000);
    await publish(summary({ code: c, players: 2, open: 2, phase: 'playing', names: ['A', 'B'] }), host, guest);
    expect(lobbyRow(c)?.phase).toBe('playing');
  });

  it('an unchanged report is not written again for five minutes, so a busy room stays cheap', async () => {
    const host = await player();
    const c = code();
    const s = summary({ code: c });
    await publish(s, host);
    app.db.resetCounters();
    vi.setSystemTime(T0 + LOBBY_REFRESH_MS - 1000);
    expect(await publish(s, host)).toBe(false);
    expect(app.db.counters.writes).toBe(0);
    vi.setSystemTime(T0 + LOBBY_REFRESH_MS + 1000);
    expect(await publish(s, host)).toBe(true);
    expect(app.db.counters.writes).toBe(1);
  });

  it('private rooms are stored too (a friend can see that the room can be joined) but have no group', async () => {
    const host = await player();
    const c = code();
    await publish(summary({ code: c, kind: 'private', audience: null }), host);
    expect(lobbyRow(c)).toMatchObject({ kind: 'private', grp: null });
    expect(await lobbies(await player())).toEqual([]);
  });

  it('removeRoom forgets the room', async () => {
    const host = await player();
    const c = code();
    await publish(summary({ code: c }), host);
    await removeRoom(app.db, c);
    expect(lobbyRow(c)).toBeUndefined();
    await removeRoom(app.db, c);
  });
});

describe('the lobby list', () => {
  it('shows open public lobbies of the same age group with names and seats, and nothing that identifies a device', async () => {
    const host = await player('adult', { region: 'eu' });
    const me = await player('adult', { region: 'eu' });
    const c = code();
    await publish(summary({ code: c, band: 'medium', players: 2, open: 2, names: [host.me.name, 'Other'] }), host);
    const list = await lobbies(me);
    expect(list).toEqual([{ code: c, game: 'jacks', region: 'eu', band: 'medium', size: 4, players: 2, open: 2, hostName: host.me.name, names: [host.me.name, 'Other'], phase: 'lobby', createdAt: T0, updatedAt: T0 }]);
    expect(JSON.stringify(list)).not.toContain(host.pid());
  });

  it('keeps teens with teens and adults with adults; children have no public lobbies', async () => {
    const adultHost = await player('adult');
    const teenHost = await player('teen');
    const a = code();
    const t = code();
    await publish(summary({ code: a, audience: 'adult' }), adultHost);
    await publish(summary({ code: t, audience: 'teen' }), teenHost);
    expect((await lobbies(await player('adult'))).map((l) => l.code)).toEqual([a]);
    expect((await lobbies(await player('teen'))).map((l) => l.code)).toEqual([t]);
    const child = await player('child');
    const r = await child.get('/api/social/lobbies');
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'child_no_public' });
  });

  it('hides lobbies that are full, playing, empty or not reported for fifteen minutes', async () => {
    const host = await player();
    const me = await player();
    const full = code(); const playing = code(); const stale = code(); const ok = code();
    await publish(summary({ code: full, players: 4, open: 0 }), host);
    await publish(summary({ code: playing, phase: 'playing' }), host);
    await publish(summary({ code: ok }), host);
    await publish(summary({ code: stale }), host);
    app.db.raw.prepare('UPDATE soc_lobbies SET updated_at = ? WHERE code = ?').run(T0 - LOBBY_STALE_MS - 1000, stale);
    expect((await lobbies(me)).map((l) => l.code)).toEqual([ok]);
  });

  it('never lists a lobby that holds somebody who blocked you or whom you blocked, nor the lobby you are in', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const withB = code(); const withC = code(); const free = code(); const mine = code();
    await publish(summary({ code: withB }), b);
    await publish(summary({ code: withC }), c);
    await publish(summary({ code: free }), await player());
    await publish(summary({ code: mine }), a);
    await a.post('/api/social/blocks', { fid: b.me.fid });
    await c.post('/api/social/blocks', { fid: a.me.fid });
    expect((await lobbies(a)).map((l) => l.code)).toEqual([free]);
    // and the block works the other way too
    expect((await lobbies(b)).map((l) => l.code).sort()).toEqual([free, withC].sort());
  });

  it('filters by game and region, puts the own region and the fuller lobbies first', async () => {
    const eu = await player('adult', { region: 'eu' });
    const na = await player('adult', { region: 'na' });
    const me = await player('adult', { region: 'eu' });
    const a = code(); const b = code(); const c = code();
    await publish(summary({ code: a, players: 1, open: 3 }), na);
    await publish(summary({ code: b, players: 2, open: 2 }), eu);
    await publish(summary({ code: c, gameId: 'star', players: 3, open: 1 }), eu);
    expect((await lobbies(me)).map((l) => l.code)).toEqual([c, b, a]);
    expect((await lobbies(me, '?game=jacks')).map((l) => l.code)).toEqual([b, a]);
    expect((await lobbies(me, '?region=na')).map((l) => l.code)).toEqual([a]);
    expect((await me.get('/api/social/lobbies?game=%3Cx%3E')).status).toBe(400);
    expect((await me.get('/api/social/lobbies?region=moon')).status).toBe(400);
  });

  it('a player suspended from public play cannot list, and a banned or unknown caller is refused', async () => {
    const me = await player();
    app.db.raw.prepare('UPDATE soc_profiles SET public_blocked_until = ? WHERE pid = ?').run(T0 + 3 * 86_400_000, me.pid());
    const r = await me.get('/api/social/lobbies');
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'public_suspended', until: T0 + 3 * 86_400_000 });
    expect((await app.call('GET', '/api/social/lobbies')).status).toBe(401);
  });
});

describe('the join gate of a public room', () => {
  const gate = (s: Pick<RoomSummary, 'code' | 'audience'>, p: TestPlayer) => mayJoinPublic(app.db, s, p.pid(), Date.now());

  it('lets a player in whose age group the room is for', async () => {
    const adult = await player('adult');
    const teen = await player('teen');
    expect(await gate({ code: code(), audience: 'adult' }, adult)).toBe(true);
    expect(await gate({ code: code(), audience: 'teen' }, teen)).toBe(true);
    expect(await gate({ code: code(), audience: 'adult' }, teen)).toBe(false);
    expect(await gate({ code: code(), audience: 'teen' }, adult)).toBe(false);
  });

  it('keeps children out of every public room, and unknown, banned and suspended players too', async () => {
    const child = await player('child');
    expect(await gate({ code: code(), audience: 'teen' }, child)).toBe(false);
    expect(await mayJoinPublic(app.db, { code: code(), audience: 'adult' }, 'nobody', T0)).toBe(false);
    const banned = await player('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(T0 + 1000, banned.pid());
    expect(await gate({ code: code(), audience: 'adult' }, banned)).toBe(false);
    const suspended = await player('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET public_blocked_until = ? WHERE pid = ?').run(T0 + 1000, suspended.pid());
    expect(await gate({ code: code(), audience: 'adult' }, suspended)).toBe(false);
    vi.setSystemTime(T0 + 2000);
    expect(await gate({ code: code(), audience: 'adult' }, suspended)).toBe(true);
  });

  it('refuses a room that holds somebody who blocked the player or whom the player blocked', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const room = code();
    await publish(summary({ code: room, players: 2, open: 2 }), b, c);
    expect(await gate({ code: room, audience: 'adult' }, a)).toBe(true);
    await a.post('/api/social/blocks', { fid: c.me.fid });
    expect(await gate({ code: room, audience: 'adult' }, a)).toBe(false);
    await a.post('/api/social/blocks/remove', { fid: c.me.fid });
    expect(await gate({ code: room, audience: 'adult' }, a)).toBe(true);
    await b.post('/api/social/blocks', { fid: a.me.fid });
    expect(await gate({ code: room, audience: 'adult' }, a)).toBe(false);
  });
});

describe('quick match', () => {
  it('opens a room when nothing fits, in the band of the player level', async () => {
    const me = await player('adult', { level: 30 });
    const r = await match(me, { game: 'jacks' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: 'create', band: 'hard' });
    expect(r.body.searchId).toMatch(/^s1\./);
    const easy = await player('adult', { level: 3 });
    expect((await match(easy, { game: 'jacks' })).body).toMatchObject({ action: 'create', band: 'easy' });
  });

  it('joins the open lobby that fits: same game, same age group, same band', async () => {
    const host = await player('adult', { level: 12 });
    const me = await player('adult', { level: 15 });
    const c = code();
    await publish(summary({ code: c, band: 'medium' }), host);
    expect((await match(me, { game: 'jacks' })).body).toMatchObject({ action: 'join', code: c });
    expect((await match(me, { game: 'star' })).body).toMatchObject({ action: 'create' });
    const teen = await player('teen', { level: 15 });
    expect((await match(teen, { game: 'jacks' })).body).toMatchObject({ action: 'create' });
  });

  it('widens the level window while the player waits: neighbours after 8 seconds, everyone after 16', async () => {
    const host = await player('adult', { level: 40 });
    const me = await player('adult', { level: 3 });
    const hard = code();
    await publish(summary({ code: hard, band: 'hard' }), host);
    const first = await match(me, { game: 'jacks' });
    expect(first.body.action).toBe('create');
    const sid = first.body.searchId as string;
    vi.setSystemTime(T0 + 9_000);
    expect((await match(me, { game: 'jacks', searchId: sid })).body.action).toBe('create');
    vi.setSystemTime(T0 + 17_000);
    expect((await match(me, { game: 'jacks', searchId: sid })).body).toMatchObject({ action: 'join', code: hard });
  });

  it('looks in the own region first, and in other regions after twelve seconds', async () => {
    const host = await player('adult', { level: 3, region: 'as' });
    const me = await player('adult', { level: 3, region: 'eu' });
    await publish(summary({ code: code(), band: 'easy' }), host);
    const first = await match(me, { game: 'jacks' });
    expect(first.body.action).toBe('create');
    vi.setSystemTime(T0 + 13_000);
    expect((await match(me, { game: 'jacks', searchId: first.body.searchId })).body.action).toBe('join');
  });

  it('keeps waiting in its own room, offers a ghost after twenty seconds, and the search id stays', async () => {
    const me = await player('adult', { level: 3 });
    const c = code();
    const first = await match(me, { game: 'jacks' });
    await publish(summary({ code: c, band: 'easy', names: [me.me.name] }), me);
    const sid = first.body.searchId as string;
    const second = await match(me, { game: 'jacks', searchId: sid, hosting: c });
    expect(second.body).toMatchObject({ action: 'wait', searchId: sid, offerGhost: false });
    vi.setSystemTime(T0 + GHOST_OFFER_AFTER_MS + 1000);
    const third = await match(me, { game: 'jacks', searchId: sid, hosting: c });
    expect(third.body).toMatchObject({ action: 'wait', offerGhost: true });
    expect(third.body.waitedMs).toBeGreaterThanOrEqual(GHOST_OFFER_AFTER_MS);
  });

  it('answers wait while the Room has not reported the new room yet, instead of creating a second one', async () => {
    const me = await player('adult');
    const r = await match(me, { game: 'jacks', hosting: 'ABCDEF' });
    expect(r.body).toMatchObject({ action: 'wait' });
    // a room that is not the player\'s own does not count as hosted
    const other = await player('adult');
    await publish(summary({ code: 'XYZXYZ' }), other);
    expect((await match(me, { game: 'jacks', hosting: 'XYZXYZ' })).body.action).toBe('wait');
    expect((await match(me, { game: 'jacks', hosting: 12 })).status).toBe(400);
  });

  it('two players who open a room at the same moment end up together: the younger one merges into the older', async () => {
    const a = await player('adult', { level: 3 });
    const b = await player('adult', { level: 3 });
    const ca = code();
    const cb = code();
    await publish(summary({ code: ca, band: 'easy', names: [a.me.name] }), a);
    vi.setSystemTime(T0 + 1000);
    await publish(summary({ code: cb, band: 'easy', names: [b.me.name] }), b);
    const ra = await match(a, { game: 'jacks', hosting: ca });
    const rb = await match(b, { game: 'jacks', hosting: cb });
    expect(ra.body.action).toBe('wait');
    expect(rb.body).toMatchObject({ action: 'merge', code: ca });
  });

  it('never matches players who blocked each other', async () => {
    const host = await player('adult', { level: 3 });
    const me = await player('adult', { level: 3 });
    await publish(summary({ code: code(), band: 'easy' }), host);
    await me.post('/api/social/blocks', { fid: host.me.fid });
    expect((await match(me, { game: 'jacks' })).body.action).toBe('create');
    await me.post('/api/social/blocks/remove', { fid: host.me.fid });
    await host.post('/api/social/blocks', { fid: me.me.fid });
    expect((await match(me, { game: 'jacks' })).body.action).toBe('create');
  });

  it('starts a new search for an id that is not ours, too old or from the future', async () => {
    const me = await player('adult');
    const first = await match(me, { game: 'jacks' });
    const sid = first.body.searchId as string;
    vi.setSystemTime(T0 + 3 * MINUTE);
    const old = await match(me, { game: 'jacks', searchId: sid });
    expect(old.body.searchId).not.toBe(sid);
    expect((await match(me, { game: 'jacks', searchId: 'whatever' })).body.searchId).toMatch(/^s1\./);
    const future = `s1.${(Date.now() + 3_600_000).toString(36)}.abcdefgh`;
    expect((await match(me, { game: 'jacks', searchId: future })).body.searchId).not.toBe(future);
  });

  it('is closed to children and to players suspended from public play, and needs a game id', async () => {
    const child = await player('child');
    const r = await match(child, { game: 'jacks' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'child_no_public' });
    const me = await player('adult');
    expect((await match(me, {})).status).toBe(400);
    expect((await match(me, { game: '../x' })).status).toBe(400);
    app.db.raw.prepare('UPDATE soc_profiles SET public_blocked_until = ? WHERE pid = ?').run(T0 + 1000, me.pid());
    expect((await match(me, { game: 'jacks' })).body).toMatchObject({ error: 'public_suspended' });
  });

  it('limits how often a client may ask: forty a minute', async () => {
    const me = await player('adult');
    for (let i = 0; i < 40; i++) expect((await match(me, { game: 'jacks' })).status).toBe(200);
    const r = await match(me, { game: 'jacks' });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    vi.setSystemTime(T0 + 61_000);
    expect((await match(me, { game: 'jacks' })).status).toBe(200);
  });

  it('reads the database and writes nothing', async () => {
    const me = await player('adult');
    await match(me, { game: 'jacks' });
    app.db.resetCounters();
    await match(me, { game: 'jacks' });
    expect(app.db.counters.writes).toBe(0);
  });
});

describe('invitations', () => {
  async function inRoom(): Promise<{ host: TestPlayer; friend: TestPlayer; room: string }> {
    const host = await player('adult');
    const friend = await player('adult');
    await host.post('/api/social/friends/request', { code: friend.me.code });
    await friend.post('/api/social/friends/respond', { fid: host.me.fid, accept: true });
    const room = code();
    await publish(summary({ code: room, kind: 'private', audience: null, names: [host.me.name] }), host);
    await setRoomState(app.db, host.pid(), null, { room, state: 'lobby', game: 'jacks' }, T0);
    await markOnline(app.db, host.pid(), T0);
    await markOnline(app.db, friend.pid(), T0);
    app.hubs.connect(friend.pid());
    return { host, friend, room };
  }

  it('pushes the invitation to the friend\'s open socket and stores nothing', async () => {
    const { host, friend, room } = await inRoom();
    app.db.resetCounters();
    const r = await host.post('/api/social/invite', { fid: friend.me.fid, room });
    expect(r.status).toBe(200);
    expect(r.body.exp).toBe(T0 + INVITE_TTL_MS);
    expect(app.hubs.take(friend.pid())).toEqual([{ t: 'invite', id: r.body.id, from: { fid: host.me.fid, name: host.me.name }, room, game: 'jacks', exp: T0 + INVITE_TTL_MS }]);
    // only the two limit counters are written
    expect(app.db.counters.writes).toBe(2);
  });

  it('takes the room as typed', async () => {
    const { host, friend, room } = await inRoom();
    const r = await host.post('/api/social/invite', { fid: friend.me.fid, room: room.toLowerCase() });
    expect(r.status).toBe(200);
  });

  it('only a friend can be invited', async () => {
    const { host, room } = await inRoom();
    const stranger = await player('adult');
    await markOnline(app.db, stranger.pid(), T0);
    app.hubs.connect(stranger.pid());
    const r = await host.post('/api/social/invite', { fid: stranger.me.fid, room });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: 'not_friends' });
    expect(app.hubs.events(stranger.pid())).toEqual([]);
  });

  it('only into the room the player is really in, as the Room reported it', async () => {
    const { host, friend } = await inRoom();
    const other = code();
    await publish(summary({ code: other, kind: 'private', audience: null }), await player());
    const r = await host.post('/api/social/invite', { fid: friend.me.fid, room: other });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'not_in_room' });
  });

  it('only while the room can still be joined', async () => {
    const { host, friend, room } = await inRoom();
    await publish(summary({ code: room, kind: 'private', audience: null, players: 4, open: 0 }), host);
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).body).toMatchObject({ error: 'not_joinable' });
    await publish(summary({ code: room, kind: 'private', audience: null, phase: 'playing' }), host);
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).body).toMatchObject({ error: 'not_joinable' });
    await removeRoom(app.db, room);
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).body).toMatchObject({ error: 'not_joinable' });
  });

  it('a public room cannot take a friend of the other age group', async () => {
    const adult = await player('adult');
    const teen = await player('teen');
    await teen.post('/api/social/friends/request', { code: adult.me.code });
    await adult.post('/api/social/friends/respond', { fid: teen.me.fid, accept: true });
    const room = code();
    await publish(summary({ code: room, audience: 'adult' }), adult);
    await setRoomState(app.db, adult.pid(), null, { room, state: 'lobby', game: 'jacks' }, T0);
    await markOnline(app.db, teen.pid(), T0);
    app.hubs.connect(teen.pid());
    expect((await adult.post('/api/social/invite', { fid: teen.me.fid, room })).body).toMatchObject({ error: 'not_joinable' });
  });

  it('an offline friend, or one who appears offline, cannot be invited (the player shares the link instead)', async () => {
    const { host, friend, room } = await inRoom();
    await friend.post('/api/social/me', { dnd: true });
    const dnd = await host.post('/api/social/invite', { fid: friend.me.fid, room });
    expect(dnd.status).toBe(409);
    expect(dnd.body).toMatchObject({ error: 'offline' });
    await friend.post('/api/social/me', { dnd: false });
    app.hubs.disconnect(friend.pid());
    // the row still says online (fresh) but no socket is open: nothing was delivered
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).body).toMatchObject({ error: 'offline' });
    app.db.raw.prepare('UPDATE soc_presence SET online = 0 WHERE pid = ?').run(friend.pid());
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).body).toMatchObject({ error: 'offline' });
  });

  it('limits invitations: three to one friend in ten minutes, twenty an hour', async () => {
    const { host, friend, room } = await inRoom();
    for (let i = 0; i < 3; i++) expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).status).toBe(200);
    const r = await host.post('/api/social/invite', { fid: friend.me.fid, room });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    expect(r.body.retryAfterMs).toBeGreaterThan(0);
    vi.setSystemTime(T0 + 10 * MINUTE + 1000);
    await markOnline(app.db, friend.pid(), Date.now());
    await markOnline(app.db, host.pid(), Date.now());
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room })).status).toBe(200);
  });

  it('twenty an hour across friends', async () => {
    const host = await player('adult');
    const room = code();
    await publish(summary({ code: room, kind: 'private', audience: null }), host);
    await setRoomState(app.db, host.pid(), null, { room, state: 'lobby', game: 'jacks' }, T0);
    const friends: TestPlayer[] = [];
    for (let i = 0; i < 8; i++) {
      const f = await player('adult');
      await host.post('/api/social/friends/request', { code: f.me.code });
      await f.post('/api/social/friends/respond', { fid: host.me.fid, accept: true });
      await markOnline(app.db, f.pid(), T0);
      app.hubs.connect(f.pid());
      friends.push(f);
    }
    let sent = 0;
    for (let round = 0; round < 3 && sent < 20; round++) {
      for (const f of friends) {
        if (sent >= 20) break;
        const r = await host.post('/api/social/invite', { fid: f.me.fid, room });
        if (r.status === 200) sent++;
      }
    }
    expect(sent).toBe(20);
    const over = await host.post('/api/social/invite', { fid: (friends[7] as TestPlayer).me.fid, room });
    expect(over.status).toBe(429);
  });

  it('declining tells the friend who invited, and only a friend', async () => {
    const { host, friend } = await inRoom();
    app.hubs.connect(host.pid());
    const r = await friend.post('/api/social/invite/decline', { fid: host.me.fid, id: 'inv12345' });
    expect(r.status).toBe(200);
    expect(app.hubs.take(host.pid())).toEqual([{ t: 'invite_declined', id: 'inv12345', fid: friend.me.fid }]);
    const stranger = await player('adult');
    expect((await stranger.post('/api/social/invite/decline', { fid: host.me.fid, id: 'inv12345' })).status).toBe(404);
    expect((await friend.post('/api/social/invite/decline', { fid: host.me.fid, id: 'x' })).status).toBe(400);
    expect((await friend.post('/api/social/invite/decline', { fid: 'bad', id: 'inv12345' })).status).toBe(400);
  });

  it('needs a valid friend id and room code', async () => {
    const { host, friend } = await inRoom();
    expect((await host.post('/api/social/invite', { fid: 'no', room: 'ABCDEF' })).status).toBe(400);
    expect((await host.post('/api/social/invite', { fid: friend.me.fid, room: 'no' })).status).toBe(400);
    expect((await host.post('/api/social/invite', { fid: friend.me.fid })).status).toBe(400);
  });
});
