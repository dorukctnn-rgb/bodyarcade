// Pro games in a room (the paywall's "rooms where everyone plays the Pro games the host picks"), at the Room's own level:
// a Pro game starts only while a Pro authorisation stands behind it, which a member whose signed Pro token the Worker verified
// gives by creating the room with the game or by picking it; the players of the room never need Pro, and free games are open to all.
// The Room trusts the verified end time in the ticket (`x`) and its own clock; a message can claim nothing.
import { describe, expect, it } from 'vitest';
import { NET_PROTOCOL, type MatchInfo, type RoomInfo } from '../../../core/types/net.ts';
import { RoomEngine } from './room-engine.ts';
import { FakeHost, Room, type TestPlayer } from './testkit.ts';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRO = { gameId: 'limbo-bend', durationMs: 30_000, band: null } as const;
const FREE = { gameId: 'squat-flap', durationMs: 30_000, band: null } as const;
/** The ticket claim of a player whose Pro token is good until `ms` (epoch ms): epoch seconds, as the Worker writes it. */
const x = (ms: number): { x: number } => ({ x: Math.floor(ms / 1000) });

const lastRoom = (p: TestPlayer): RoomInfo | undefined => p.last('room')?.room ?? p.last('welcome')?.room;
const started = (r: Room): MatchInfo | null => (r.engine.inspect().match as unknown as MatchInfo | null);

describe('making a room', () => {
  it('a Pro game needs a creator whose Pro token was verified: none, or one that has run out, is refused and nothing is made', async () => {
    for (const proUntil of [undefined, 0, T0 - 1, T0, Number.NaN]) {
      const e = await RoomEngine.create(new FakeHost());
      const input = { code: 'AAAAAA', kind: 'private' as const, size: 2, config: PRO, audience: null, creator: 'c', ...(proUntil === undefined ? {} : { proUntil }) };
      expect(e.init(input), String(proUntil)).toEqual({ ok: false, error: 'pro_required' });
      expect(e.exists).toBe(false);
      expect(e.preview()).toBeNull();
    }
  });

  it('a Pro game with a verified creator is made, and the room says it is covered', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    expect(r.engine.preview()).toMatchObject({ gameId: 'limbo-bend', phase: 'lobby' });
    const a = r.join('alice', x(T0 + DAY));
    expect(a.last('welcome')?.room.pro).toEqual({ ok: true });
    expect(a.last('welcome')?.room.config.gameId).toBe('limbo-bend');
  });

  it('a free game needs nothing and the room info says nothing about Pro', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice');
    expect(a.last('welcome')?.room.pro).toBeUndefined();
    expect('pro' in (a.last('welcome')?.room as object)).toBe(false);
    expect(r.engine.inspect().meta?.auth).toBeNull();
  });

  it('every game that is not a Pro game is open: a game nobody knows is not locked either', async () => {
    for (const gameId of ['squat-flap', 'knee-sprint', 'road-run', 'star-catch', 'jacks', 'anything-else']) {
      const e = await RoomEngine.create(new FakeHost());
      expect(e.init({ code: 'AAAAAA', kind: 'private', size: 2, config: { gameId, durationMs: 30_000, band: null }, audience: null, creator: 'c' }), gameId).toEqual({ ok: true });
    }
    for (const gameId of ['limbo-bend', 'pad-work', 'reaction-tag']) {
      const e = await RoomEngine.create(new FakeHost());
      expect(e.init({ code: 'AAAAAA', kind: 'private', size: 2, config: { gameId, durationMs: 30_000, band: null }, audience: null, creator: 'c' }), gameId).toEqual({ ok: false, error: 'pro_required' });
    }
  });

  it('a public room with a Pro game is covered the same way', async () => {
    const e = await RoomEngine.create(new FakeHost());
    const pub = { code: 'AAAAAA', kind: 'public' as const, size: 3, config: { ...PRO, band: 'easy' }, audience: 'adult' as const, creator: 'c' };
    expect(e.init(pub)).toEqual({ ok: false, error: 'pro_required' });
    expect(e.init({ ...pub, proUntil: T0 + DAY })).toEqual({ ok: true });
  });
});

describe('everyone plays the Pro game the host picked', () => {
  it('a Pro host and a free friend start the Pro game together, and rematch it', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    const host = r.join('alice', x(T0 + DAY));
    const friend = r.join('bob');                                      // no token, no Pro: free
    expect(friend.last('welcome')?.room.pro).toEqual({ ok: true });
    host.ready(); friend.ready();
    expect(started(r)?.gameId).toBe('limbo-bend');
    expect(started(r)?.seats).toEqual(['s1', 's2']);
    expect(friend.all('start')).toHaveLength(1);
    r.advance(30_000 + 3500 + 9000);                                   // nobody sends anything: the match ends (no contest) and the room is back
    host.ready(); friend.ready();
    expect(r.engine.inspect().meta?.matches).toBe(2);
  });

  it('a free game in the same kind of room starts as always, with nobody holding a token', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice'); const b = r.join('bob');
    a.ready(); b.ready();
    expect(started(r)?.gameId).toBe('squat-flap');
  });
});

describe('picking a game in the lobby', () => {
  it('a free host who picks a Pro game is told pro_required, and the room stays as it was (the ready flags too)', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice'); const b = r.join('bob');
    b.ready();
    const before = a.msgs.length;
    a.send({ t: 'config', gameId: 'limbo-bend' });
    expect(a.last('error')?.code).toBe('pro_required');
    expect(r.engine.inspect().meta?.config.gameId).toBe('squat-flap');
    expect(r.engine.inspect().members.find((m) => m.seat === 's2')?.ready).toBe(true);
    expect(a.msgs.slice(before).filter((m) => m.t === 'room')).toHaveLength(0);
    expect(b.msgs.filter((m) => m.t === 'error')).toHaveLength(0);
  });

  it('a Pro host who picks a Pro game gets it: everyone hears, readiness is cleared, and it starts when all are ready', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice', x(T0 + DAY)); const b = r.join('bob');
    b.ready();
    a.send({ t: 'config', gameId: 'pad-work' });
    expect(a.all('error')).toHaveLength(0);
    expect(lastRoom(b)).toMatchObject({ config: { gameId: 'pad-work' }, pro: { ok: true } });
    expect(r.engine.inspect().members.every((m) => !m.ready)).toBe(true);
    a.ready(); b.ready();
    expect(started(r)?.gameId).toBe('pad-work');
  });

  it('a free host picks free games in a Pro room: the game changes and the room info drops the Pro note', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    const a = r.join('alice', x(T0 + DAY)); r.join('bob');
    a.send({ t: 'config', gameId: 'knee-sprint' });
    expect(lastRoom(a)?.config.gameId).toBe('knee-sprint');
    expect(lastRoom(a)?.pro).toBeUndefined();
    a.send({ t: 'config', gameId: 'reaction-tag' });                   // back to Pro: the host's own token is still good
    expect(lastRoom(a)).toMatchObject({ config: { gameId: 'reaction-tag' }, pro: { ok: true } });
  });

  it('a host whose token ran out is refused like a free one, and a token that ends within the second does not count', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice', x(T0 - 1000)); r.join('bob');
    a.send({ t: 'config', gameId: 'limbo-bend' });
    expect(a.last('error')?.code).toBe('pro_required');
    const r2 = await Room.make({ config: FREE });
    const c = r2.join('carol', x(r2.host.t + 500)); r2.join('dave');
    c.send({ t: 'config', gameId: 'limbo-bend' });                       // x is whole seconds: it ended before now
    expect(c.last('error')?.code).toBe('pro_required');
  });

  it('only the host picks (as before), and a pick of the same Pro game by the host changes nothing', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    const a = r.join('alice', x(T0 + DAY)); const b = r.join('bob', x(T0 + DAY));
    b.send({ t: 'config', gameId: 'pad-work' });
    expect(b.last('error')?.code).toBe('not_host');
    const rooms = a.all('room').length;
    a.send({ t: 'config', gameId: 'limbo-bend' });
    expect(a.all('room')).toHaveLength(rooms);
    expect(a.all('error')).toHaveLength(0);
  });

  it('a message cannot claim Pro: extra fields in hello and config are not read', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.connect('alice').hello({ pro: true, x: 4_000_000_000, until: 4e12, auth: { game: 'limbo-bend', until: 4e12 } } as never);
    r.join('bob');
    a.send({ t: 'config', gameId: 'limbo-bend', pro: true, x: 4_000_000_000 } as never);
    expect(a.last('error')?.code).toBe('pro_required');
    expect(r.engine.inspect().meta?.auth).toBeNull();
    expect(r.engine.inspect().members[0]?.proUntil ?? 0).toBe(0);
    a.send({ t: 'hello', v: NET_PROTOCOL, tab: 'again', sess: 's', video: false, reasons: [], blocks: [], x: 4_000_000_000 });
    expect(r.engine.inspect().members[0]?.proUntil ?? 0).toBe(0);
  });
});

describe('when the Pro authorisation runs out', () => {
  async function waiting(): Promise<{ r: Room; a: TestPlayer; b: TestPlayer }> {
    const r = await Room.make({ config: PRO, proUntil: T0 + HOUR });
    const a = r.join('alice', x(T0 + HOUR)); const b = r.join('bob');
    r.advance(HOUR + 60_000);
    return { r, a, b };
  }

  it('the room does not start a Pro game after the token ended: it says so once (pro.ok false) and waits', async () => {
    const { r, a, b } = await waiting();
    const notes = (p: TestPlayer): number => p.all('room').filter((m) => m.room.pro?.ok === false).length;
    expect(notes(a)).toBe(0);                                            // nothing is said while nobody is ready
    a.ready(); b.ready();
    expect(started(r)).toBeNull();
    expect(lastRoom(a)?.pro).toEqual({ ok: false });
    expect(lastRoom(b)?.pro).toEqual({ ok: false });
    expect(notes(a)).toBe(1);
    expect(notes(b)).toBe(1);
    b.ready(false); b.ready(true);                                       // toggling does not repeat the note
    expect(notes(a)).toBe(1);
    expect(r.host.logs.filter((l) => l.evt === 'pro_blocked')).toHaveLength(1);
  });

  it('a host who comes back with a fresh token re-opens it, and the match starts because everybody had pressed ready', async () => {
    const { r, a, b } = await waiting();
    a.ready(); b.ready();
    expect(started(r)).toBeNull();
    const again = r.join('alice', x(r.host.t + DAY), {}, 'tab-new');     // the page renewed its ticket and reconnected
    expect(again.last('welcome')?.room.pro).toEqual({ ok: true });
    expect(lastRoom(b)?.pro).toEqual({ ok: true });
    expect(started(r)?.gameId).toBe('limbo-bend');
  });

  it('a host who has no token left can pick a free game instead and play on', async () => {
    const { r, a, b } = await waiting();
    a.ready(); b.ready();
    a.send({ t: 'config', gameId: 'squat-flap' });
    expect(a.all('error')).toHaveLength(0);
    a.ready(); b.ready();
    expect(started(r)?.gameId).toBe('squat-flap');
  });

  it('a Pro host who picks the same Pro game again with a fresh token re-authorises it (the pick starts a waiting room)', async () => {
    const { r, a, b } = await waiting();
    a.ready(); b.ready();
    const again = r.connect('alice', x(r.host.t + DAY), 'tab-2');        // a second tab with a fresh ticket takes the seat over
    again.hello();
    expect(lastRoom(again)?.pro).toEqual({ ok: true });
    expect(started(r)?.gameId).toBe('limbo-bend');
  });

  it('a match that is already running is not stopped when the authorisation ends (it was started in good standing)', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + 30_000 }, { });
    const a = r.join('alice', x(T0 + 30_000)); const b = r.join('bob');
    a.ready(); b.ready();
    expect(started(r)?.phase).toBe('running');
    r.advance(40_000);                                                   // past the end of the authorisation, inside the match
    expect(started(r)?.phase).not.toBe('over');
    expect(a.all('forfeit')).toHaveLength(0);
  });
});

describe('a new host', () => {
  it('a free friend who becomes host plays on with the Pro game the Pro host picked, but cannot pick another Pro game', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    const a = r.join('alice', x(T0 + DAY)); const b = r.join('bob');
    a.send({ t: 'bye' });                                                // the Pro host leaves
    expect(lastRoom(b)).toMatchObject({ host: 's2', config: { gameId: 'limbo-bend' }, pro: { ok: true } });
    b.send({ t: 'config', gameId: 'pad-work' });                         // not covered: the picker has no token
    expect(b.last('error')?.code).toBe('pro_required');
    expect(lastRoom(b)?.config.gameId).toBe('limbo-bend');
    b.send({ t: 'config', gameId: 'star-catch' });                       // free games are the host's to pick
    expect(lastRoom(b)?.config.gameId).toBe('star-catch');
  });

  it('a Pro friend who becomes host re-opens a Pro game whose authorisation had run out', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + HOUR, size: 3 });
    const a = r.join('alice', x(T0 + HOUR)); const b = r.join('bob', x(T0 + 5 * DAY)); const c = r.join('carol');
    r.advance(2 * HOUR);
    expect(lastRoom(c)?.pro).toBeDefined();
    a.send({ t: 'bye' });                                                // alice, whose proof ended, leaves; bob (Pro) is host now
    expect(lastRoom(c)).toMatchObject({ host: 's2', pro: { ok: true } });
    b.ready(); c.ready();
    expect(started(r)?.gameId).toBe('limbo-bend');
  });

  it('a Pro proof only grows: a later ticket without one, or with an earlier end, does not take it back', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice', x(T0 + 5 * DAY)); r.join('bob');
    expect(r.engine.inspect().members[0]?.proUntil).toBe(Math.floor((T0 + 5 * DAY) / 1000) * 1000);
    r.join('alice', {}, {}, 'tab-b');                                    // renewed ticket with no token
    r.join('alice', x(T0 + DAY), {}, 'tab-c');                           // renewed ticket with an older token
    expect(r.engine.inspect().members[0]?.proUntil).toBe(Math.floor((T0 + 5 * DAY) / 1000) * 1000);
    a.send({ t: 'config', gameId: 'limbo-bend' });
    void a;
    const host = [...r.players.values()].find((p) => p.pid === 'alice' && p.conn.open) as TestPlayer;
    host.send({ t: 'config', gameId: 'limbo-bend' });
    expect(host.all('error').filter((e) => e.code === 'pro_required')).toHaveLength(0);
    expect(lastRoom(host)?.config.gameId).toBe('limbo-bend');
  });
});

describe('what survives', () => {
  it('the authorisation is kept when the Room is woken from storage', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    const a = r.join('alice', x(T0 + DAY)); const b = r.join('bob');
    await r.reload();
    expect(r.engine.inspect().meta?.auth).toEqual({ game: 'limbo-bend', until: T0 + DAY });
    expect(r.engine.inspect().members[0]?.proUntil).toBe(Math.floor((T0 + DAY) / 1000) * 1000);
    a.ready(); b.ready();
    expect(started(r)?.gameId).toBe('limbo-bend');
  });

  it('a room written by an older Room (no auth, no proUntil in its records) still works: free games as always', async () => {
    const r = await Room.make({ config: FREE });
    const a = r.join('alice'); const b = r.join('bob');
    const meta = r.host.store.get('meta') as Record<string, unknown>;
    delete meta.auth;
    const members = r.host.store.get('members') as Record<string, Record<string, unknown>>;
    for (const m of Object.values(members)) delete m.proUntil;
    await r.reload();
    a.ready(); b.ready();
    expect(started(r)?.gameId).toBe('squat-flap');
    expect(lastRoom(a)?.pro).toBeUndefined();
  });

  it('the join pre-check never asks for Pro: a player with no token can be seated in a Pro room', async () => {
    const r = await Room.make({ config: PRO, proUntil: T0 + DAY });
    expect(r.engine.check({ p: 'bob', a: 'adult', k: 'bk_bob_0123456789abcdef' })).toMatchObject({ ok: true, preview: { gameId: 'limbo-bend' } });
  });
});
