// Presence: what friends see, how long it holds, what is written and who is told.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE } from '../../../core/social/rules.ts';
import type { FriendPresence } from '../../../core/social/types.ts';
import { beat, markOffline, markOnline, onlineFriends, presenceOf, pushPresence, setClientStatus, setRoomState, statusOf, sweepPresence, viewOf } from './presence.ts';
import { createTestApp, type TestApp, type TestPlayer } from './testkit.ts';

let app: TestApp;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const adult = () => app.signup('adult');
async function befriend(a: TestPlayer, b: TestPlayer): Promise<void> {
  await a.post('/api/social/friends/request', { code: b.me.code });
  await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
}
const seenBy = async (viewer: TestPlayer, friend: TestPlayer): Promise<FriendPresence | undefined> =>
  ((await viewer.get('/api/social/friends')).body.friends as { fid: string; presence: FriendPresence }[]).find((f) => f.fid === friend.me.fid)?.presence;
const lobby = (code: string, phase: 'lobby' | 'playing', open: number) =>
  app.db.raw.prepare("INSERT OR REPLACE INTO soc_lobbies (code, kind, grp, region, game, band, size, players, open, names, pids, phase, created_at, updated_at) VALUES (?, 'private', NULL, 'eu', 'jacks', NULL, 4, ?, ?, '[]', '[]', ?, ?, ?)")
    .run(code, 4 - open, open, phase, T0, T0);

describe('what a friend sees', () => {
  it('statusOf: offline unless a hub socket is open; the room beats solo play', () => {
    expect(statusOf({ online: 0, c_status: 'playing', room: 'ABC234', r_state: 'lobby' })).toBe('offline');
    expect(statusOf({ online: 1, c_status: 'online', room: null, r_state: null })).toBe('online');
    expect(statusOf({ online: 1, c_status: 'playing', room: null, r_state: null })).toBe('playing');
    expect(statusOf({ online: 1, c_status: 'playing', room: 'ABC234', r_state: 'lobby' })).toBe('in_room');
    expect(statusOf({ online: 1, c_status: 'online', room: 'ABC234', r_state: 'playing' })).toBe('playing');
  });

  it('viewOf: the room code only while the room is waiting with a free seat; hidden when the owner wants to appear offline; silent for too long is offline', () => {
    const base = { online: 1, seen_at: T0, c_status: 'online', c_game: null, room: 'ABC234', r_state: 'lobby', r_game: 'jacks', joinable: 1 };
    expect(viewOf(base, false, T0)).toEqual({ status: 'in_room', game: 'jacks', room: 'ABC234' });
    expect(viewOf({ ...base, joinable: 0 }, false, T0)).toEqual({ status: 'in_room', game: 'jacks' });
    expect(viewOf({ ...base, r_state: 'playing' }, false, T0)).toEqual({ status: 'playing', game: 'jacks' });
    expect(viewOf(base, true, T0)).toEqual({ status: 'offline' });
    expect(viewOf(base, false, T0 + PRESENCE.ttlMs + 1)).toEqual({ status: 'offline' });
    expect(viewOf({ ...base, room: null, r_state: null, r_game: null, c_status: 'playing', c_game: 'star' }, false, T0)).toEqual({ status: 'playing', game: 'star' });
    expect(viewOf({ ...base, online: null, seen_at: null }, false, T0)).toEqual({ status: 'offline' });
  });

  it('a friend list shows each friend as offline, online, in a room, playing', async () => {
    const me = await adult();
    const [f1, f2, f3, f4] = [await adult(), await adult(), await adult(), await adult()] as [TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    for (const f of [f1, f2, f3, f4]) await befriend(me, f);
    await markOnline(app.db, f2.pid(), T0);
    await markOnline(app.db, f3.pid(), T0);
    await setClientStatus(app.db, f3.pid(), 'playing', 'star', T0);
    await markOnline(app.db, f4.pid(), T0);
    await setRoomState(app.db, f4.pid(), null, { room: 'ROOM22', state: 'lobby', game: 'jacks' }, T0);
    lobby('ROOM22', 'lobby', 2);
    expect(await seenBy(me, f1)).toEqual({ status: 'offline' });
    expect(await seenBy(me, f2)).toEqual({ status: 'online' });
    expect(await seenBy(me, f3)).toEqual({ status: 'playing', game: 'star' });
    expect(await seenBy(me, f4)).toEqual({ status: 'in_room', game: 'jacks', room: 'ROOM22' });
    // the room fills: the friend still sits in it, but the code is no longer offered
    lobby('ROOM22', 'lobby', 0);
    expect(await seenBy(me, f4)).toEqual({ status: 'in_room', game: 'jacks' });
    lobby('ROOM22', 'playing', 2);
    expect(await seenBy(me, f4)).toEqual({ status: 'in_room', game: 'jacks' });
  });

  it('appear offline hides everything, and a silent socket counts as offline after nine minutes', async () => {
    const me = await adult();
    const f = await adult();
    await befriend(me, f);
    await markOnline(app.db, f.pid(), T0);
    expect(await seenBy(me, f)).toEqual({ status: 'online' });
    await f.post('/api/social/me', { dnd: true });
    expect(await seenBy(me, f)).toEqual({ status: 'offline' });
    await f.post('/api/social/me', { dnd: false });
    expect(await seenBy(me, f)).toEqual({ status: 'online' });
    vi.setSystemTime(T0 + PRESENCE.ttlMs + 1000);
    expect(await seenBy(me, f)).toEqual({ status: 'offline' });
  });

  it('strangers see nothing: presence is only in the friend list', async () => {
    const me = await adult();
    const stranger = await adult();
    await markOnline(app.db, stranger.pid(), T0);
    const text = JSON.stringify((await me.get('/api/social/friends')).body);
    expect(text).not.toContain(stranger.me.fid);
  });
});

describe('writes', () => {
  it('markOnline writes once, then not again within a minute (a reconnecting tab costs one write)', async () => {
    const pid = (await adult()).pid();
    app.db.resetCounters();
    expect(await markOnline(app.db, pid, T0)).toBe(true);
    expect(app.db.counters.writes).toBe(1);
    expect(await markOnline(app.db, pid, T0 + 5000)).toBe(false);
    expect(await markOnline(app.db, pid, T0 + 30_000)).toBe(false);
    expect(app.db.counters.writes).toBe(1);
    // after a minute the row is refreshed, but nobody needs telling: the player was visibly online all along
    expect(await markOnline(app.db, pid, T0 + 61_000)).toBe(false);
    expect(app.db.counters.writes).toBe(2);
  });

  it('markOnline says so when the player was away: offline, expired, or in the middle of solo play', async () => {
    const pid = (await adult()).pid();
    expect(await markOnline(app.db, pid, T0)).toBe(true);
    await markOffline(app.db, pid, T0 + 1000);
    expect(await markOnline(app.db, pid, T0 + 2000)).toBe(true);
    expect(await markOnline(app.db, pid, T0 + 2000 + PRESENCE.ttlMs + 5000)).toBe(true);
    await setClientStatus(app.db, pid, 'playing', 'star', T0 + PRESENCE.ttlMs + 6000);
    expect(await markOnline(app.db, pid, T0 + PRESENCE.ttlMs + 70_000)).toBe(true);
  });

  it('markOffline reports a change only when the player was online, and clears solo play', async () => {
    const pid = (await adult()).pid();
    expect(await markOffline(app.db, pid, T0)).toBe(false);
    await markOnline(app.db, pid, T0);
    await setClientStatus(app.db, pid, 'playing', 'star', T0);
    expect(await markOffline(app.db, pid, T0 + 1)).toBe(true);
    expect(await markOffline(app.db, pid, T0 + 2)).toBe(false);
    const row = app.db.raw.prepare('SELECT online, c_status, c_game FROM soc_presence WHERE pid = ?').get(pid);
    expect(row).toMatchObject({ online: 0, c_status: 'online', c_game: null });
  });

  it('a heartbeat refreshes the time, and reports a player who had dropped out', async () => {
    const pid = (await adult()).pid();
    expect(await beat(app.db, pid, T0)).toBe(true);
    expect(await beat(app.db, pid, T0 + PRESENCE.beatEveryMs)).toBe(false);
    expect((app.db.raw.prepare('SELECT seen_at FROM soc_presence WHERE pid = ?').get(pid) as { seen_at: number }).seen_at).toBe(T0 + PRESENCE.beatEveryMs);
    await markOffline(app.db, pid, T0 + PRESENCE.beatEveryMs + 1);
    expect(await beat(app.db, pid, T0 + 2 * PRESENCE.beatEveryMs)).toBe(true);
  });

  it('a status that changes nothing writes nothing', async () => {
    const pid = (await adult()).pid();
    await markOnline(app.db, pid, T0);
    expect(await setClientStatus(app.db, pid, 'playing', 'star', T0)).toBe(true);
    app.db.resetCounters();
    expect(await setClientStatus(app.db, pid, 'playing', 'star', T0 + 1000)).toBe(false);
    expect(app.db.counters.writes).toBe(0);
    expect(await setClientStatus(app.db, pid, 'playing', 'jacks', T0 + 2000)).toBe(true);
    expect(await setClientStatus(app.db, pid, 'online', null, T0 + 3000)).toBe(true);
  });

  it('solo status needs an open socket: an offline player cannot claim to play', async () => {
    const pid = (await adult()).pid();
    expect(await setClientStatus(app.db, pid, 'playing', 'star', T0)).toBe(false);
  });

  it('the room state is the Room\'s word: set when entering, cleared only by the room that was left', async () => {
    const pid = (await adult()).pid();
    expect(await setRoomState(app.db, pid, null, { room: 'AAAAA2', state: 'lobby', game: 'jacks' }, T0)).toBe(true);
    // a quick hop: the new room is entered before the old one reports leaving
    expect(await setRoomState(app.db, pid, null, { room: 'BBBBB2', state: 'lobby', game: 'jacks' }, T0 + 1)).toBe(true);
    expect(await setRoomState(app.db, pid, 'AAAAA2', null, T0 + 2)).toBe(false);
    expect((app.db.raw.prepare('SELECT room FROM soc_presence WHERE pid = ?').get(pid) as { room: string }).room).toBe('BBBBB2');
    expect(await setRoomState(app.db, pid, 'BBBBB2', null, T0 + 3)).toBe(true);
    expect((app.db.raw.prepare('SELECT room, r_state FROM soc_presence WHERE pid = ?').get(pid))).toMatchObject({ room: null, r_state: null });
  });

  it('the sweep turns players whose heartbeat stopped into offline rows', async () => {
    const a = await adult();
    const b = await adult();
    await markOnline(app.db, a.pid(), T0);
    await markOnline(app.db, b.pid(), T0 + 8 * 60_000);
    expect(await sweepPresence(app.db, T0 + PRESENCE.ttlMs + 1000)).toBe(1);
    expect((app.db.raw.prepare('SELECT online FROM soc_presence WHERE pid = ?').get(a.pid()) as { online: number }).online).toBe(0);
    expect((app.db.raw.prepare('SELECT online FROM soc_presence WHERE pid = ?').get(b.pid()) as { online: number }).online).toBe(1);
  });
});

describe('telling friends', () => {
  it('only online friends are told, newest first, and the player is described as a friend sees them', async () => {
    const me = await adult();
    const on = await adult();
    const off = await adult();
    const stranger = await adult();
    await befriend(me, on);
    await befriend(me, off);
    await markOnline(app.db, me.pid(), T0);
    await markOnline(app.db, on.pid(), T0);
    await markOnline(app.db, stranger.pid(), T0);
    app.hubs.connect(on.pid());
    app.hubs.connect(off.pid());
    app.hubs.connect(stranger.pid());
    expect(await onlineFriends(app.db, me.pid(), T0)).toEqual([on.pid()]);
    expect(await pushPresence(app.env, me.pid(), T0)).toBe(1);
    expect(app.hubs.take(on.pid())).toEqual([{ t: 'presence', fid: me.me.fid, name: me.me.name, presence: { status: 'online' } }]);
    expect(app.hubs.events(off.pid())).toEqual([]);
    expect(app.hubs.events(stranger.pid())).toEqual([]);
  });

  it('tells at most thirty friends', async () => {
    const me = await adult();
    await markOnline(app.db, me.pid(), T0);
    for (let i = 0; i < 40; i++) {
      const pid = `fake-friend-${i}`;
      app.db.raw.prepare('INSERT INTO soc_friends (pid, friend, since) VALUES (?, ?, ?)').run(me.pid(), pid, T0);
      app.db.raw.prepare('INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)').run(pid, T0 + i, T0);
    }
    expect((await onlineFriends(app.db, me.pid(), T0 + 100)).length).toBe(PRESENCE.pushMax);
  });

  it('a friend who is appearing offline is announced as offline', async () => {
    const me = await adult();
    const f = await adult();
    await befriend(me, f);
    await markOnline(app.db, me.pid(), T0);
    await markOnline(app.db, f.pid(), T0);
    app.hubs.connect(f.pid());
    await me.post('/api/social/me', { dnd: true });
    expect(app.hubs.take(f.pid())).toEqual([{ t: 'presence', fid: me.me.fid, name: me.me.name, presence: { status: 'offline' } }]);
    await me.post('/api/social/me', { dnd: false });
    expect(app.hubs.take(f.pid())).toEqual([{ t: 'presence', fid: me.me.fid, name: me.me.name, presence: { status: 'online' } }]);
  });

  it('presenceOf gives the view of one player, and nothing for a player who is gone', async () => {
    const a = await adult();
    await markOnline(app.db, a.pid(), T0);
    expect(await presenceOf(app.db, a.pid(), T0)).toMatchObject({ fid: a.me.fid, presence: { status: 'online' } });
    expect(await presenceOf(app.db, 'nobody', T0)).toBeNull();
  });
});
