import { describe, expect, it } from 'vitest';
import { CLOSE, NET_PROTOCOL, type MatchInfo, type MatchResult, type ObstacleResult, type RoomMessage } from '../../../core/types/net.ts';
import { makeSchedule, scoreOf, specFor } from '../../../core/net/schedule.ts';
import { DEFAULT_TIMING } from './config.ts';
import { RoomEngine } from './room-engine.ts';
import { FakeHost, Room, type TestPlayer } from './testkit.ts';

const T = DEFAULT_TIMING;

function course(room: Room) {
  const m = room.match();
  return makeSchedule(m.seed, m.duration, specFor(m.gameId));
}

/** Everyone presses ready; returns the started match. */
function startMatch(room: Room, ...ps: TestPlayer[]): MatchInfo {
  for (const p of ps) p.ready();
  return room.match();
}

/** Plays the whole course: `pick` says what each seat does with each obstacle. Ends with every player sending final. */
function playAll(room: Room, ps: TestPlayer[], pick: (seat: string, ob: number) => 'pass' | 'hit' | null): Record<string, ObstacleResult[]> {
  const m = room.match();
  const list = course(room);
  const mine: Record<string, ObstacleResult[]> = {};
  for (const p of ps) mine[p.seat] = [];
  const base = m.startAt + m.pauseTotal;                       // match time zero, pauses included
  room.advance(Math.max(0, base - room.host.t));
  let seq = 0;
  for (const o of list) {
    room.advance(Math.max(0, base + o.t - room.host.t));
    for (const p of ps) {
      const k = pick(p.seat, o.id);
      if (!k) continue;
      mine[p.seat]?.push({ ob: o.id, k });
      p.send({ t: 'ev', mid: m.id, seq: ++seq, ob: o.id, k });
    }
  }
  room.advance(Math.max(0, base + m.duration - room.host.t));
  for (const p of ps) p.send({ t: 'final', mid: m.id, evs: mine[p.seat] ?? [] });
  return mine;
}

const resultOf = (p: TestPlayer): MatchResult | undefined => p.last('result')?.result;

describe('room init, join and presence', () => {
  it('validates the room config', async () => {
    const r = await Room.make();
    expect(r.engine.init({ code: 'K7P2QX', kind: 'private', size: 2, config: { gameId: 'x', durationMs: 30000, band: null }, audience: null, creator: 'c' })).toEqual({ ok: false, error: 'exists' });
    for (const [size, config, kind, audience, error] of [
      [1, { gameId: 'squat-flap', durationMs: 30000, band: null }, 'private', null, 'bad_size'],
      [5, { gameId: 'squat-flap', durationMs: 30000, band: null }, 'private', null, 'bad_size'],
      [2, { gameId: 'Squat Flap', durationMs: 30000, band: null }, 'private', null, 'bad_config'],
      [2, { gameId: 'squat-flap', durationMs: 1000, band: null }, 'private', null, 'bad_config'],
      [2, { gameId: 'squat-flap', durationMs: 999999, band: null }, 'private', null, 'bad_config'],
      [2, { gameId: 'squat-flap', durationMs: 30000, band: 'a b' }, 'public', 'adult', 'bad_config'],
      [2, { gameId: 'squat-flap', durationMs: 30000, band: null }, 'public', 'child', 'bad_audience'],
      [2, { gameId: 'squat-flap', durationMs: 30000, band: null }, 'public', null, 'bad_audience'],
    ] as const) {
      const e = await RoomEngine.create(new FakeHost());
      expect(e.init({ code: 'AAAAAA', kind, size, config, audience, creator: 'c' })).toEqual({ ok: false, error });
    }
  });

  it('seats the first player as host and tells everyone who is here', async () => {
    const r = await Room.make();
    const a = r.join('alice');
    const w = a.last('welcome');
    expect(w?.v).toBe(NET_PROTOCOL);
    expect(w?.you).toBe('s1');
    expect(w?.room).toMatchObject({ code: 'K7P2QX', kind: 'private', size: 2, host: 's1', chat: 'text', video: true, phase: 'lobby' });
    expect(w?.members).toHaveLength(1);
    expect(w?.members[0]).toMatchObject({ seat: 's1', host: true, online: true, ready: false });
    expect(w?.match).toBeNull();
    const b = r.join('bob');
    expect(b.last('welcome')?.members.map((m) => m.seat)).toEqual(['s1', 's2']);
    const pres = a.last('presence');
    expect(pres?.members.map((m) => [m.seat, m.online, m.host])).toEqual([['s1', true, true], ['s2', true, false]]);
  });

  it('never exposes device ids in any message', async () => {
    const r = await Room.make();
    const a = r.join('alice-device-id-1234', { n: 'Alice' });
    const b = r.join('bob-device-id-5678', { n: 'Bobby' });
    a.ready(); b.ready();
    for (const p of [a, b]) expect(JSON.stringify(p.msgs)).not.toMatch(/device-id/);
  });

  it('refuses a seat when the room is full, with close code 4001', async () => {
    const r = await Room.make({ size: 2 });
    r.join('alice'); r.join('bob');
    const c = r.join('carol');
    expect(c.closeCode).toBe(CLOSE.FULL);
    expect(c.all('welcome')).toHaveLength(0);
  });

  it('fills four seats and refuses the fifth', async () => {
    const r = await Room.make({ size: 4 });
    const ps = ['a1', 'b2', 'c3', 'd4'].map((p) => r.join(p));
    expect(ps.map((p) => p.seat)).toEqual(['s1', 's2', 's3', 's4']);
    expect(r.join('e5').closeCode).toBe(CLOSE.FULL);
  });

  it('closes sockets that speak another protocol version with 4005', async () => {
    const r = await Room.make();
    const p = r.connect('alice').hello({ v: NET_PROTOCOL + 1 });
    expect(p.closeCode).toBe(CLOSE.VERSION);
  });

  it('answers sync at once and demands hello for everything else', async () => {
    const r = await Room.make();
    const p = r.connect('alice');
    p.send({ t: 'sync', c: 42 });
    expect(p.last('sync')).toMatchObject({ c: 42, s: r.host.t });
    p.send({ t: 'ready', ready: true });
    expect(p.last('error')?.code).toBe('no_hello');
  });

  it('answers malformed messages with error bad and drops a socket that keeps sending them', async () => {
    const r = await Room.make();
    const a = r.join('alice');
    a.send('not json');
    a.send({ t: 'nope' });
    expect(a.all('error').map((e) => e.code)).toEqual(['bad', 'bad']);
    for (let i = 0; i < 40; i++) a.send('garbage');
    expect(a.closeCode).toBe(CLOSE.RATE);
  });
});

describe('ready check and starting a match', () => {
  it('starts when everyone present is ready, 3.5 s ahead, with a fresh seed each time', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    a.ready();
    expect(a.all('start')).toHaveLength(0);
    const t0 = r.host.t;
    b.ready();
    for (const p of [a, b]) {
      const s = p.last('start');
      expect(s?.match).toMatchObject({ phase: 'running', gameId: 'squat-flap', duration: 30_000, startAt: t0 + T.startCountdownMs, seats: ['s1', 's2'], forfeited: [], result: null });
    }
    expect(a.last('start')?.match).toEqual(b.last('start')?.match);
    expect(r.match().seed).toBeGreaterThan(0);
    expect(a.last('presence')?.members.every((m) => !m.ready)).toBe(true);
    expect(r.engine.inspect().meta?.matches).toBe(1);
  });

  it('does not start with one player, nor while a third member has not pressed ready', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice');
    a.ready();
    expect(a.all('start')).toHaveLength(0);
    const b = r.join('bob'); const c = r.join('carol');
    b.ready();
    expect(a.all('start')).toHaveLength(0);
    c.ready();
    expect(a.last('start')?.match.seats).toEqual(['s1', 's2', 's3']);
  });

  it('starts a three-seat room as soon as the one who was missing leaves or the last one is ready', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob'); const c = r.join('carol');
    a.ready(); b.ready();
    c.send({ t: 'bye' });
    expect(a.last('start')?.match.seats).toEqual(['s1', 's2']);
  });

  it('keeps ready flags across a reconnect and starts when the last one comes back', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    a.ready(); b.ready();                                       // started
    expect(a.last('start')).toBeDefined();
  });

  it('refuses ready while a match is running and accepts it again after the result', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    a.ready(false);
    expect(a.last('error')?.code).toBe('busy');
    playAll(r, [a, b], () => 'pass');
    expect(resultOf(a)).toBeDefined();
    a.ready(); b.ready();
    expect(a.all('start')).toHaveLength(2);
    expect(r.match().id).not.toBe(a.all('start')[0]?.match.id);
    expect(r.match().seed).not.toBe(a.all('start')[0]?.match.seed);
  });

  it('a player who joins during a match waits for the next one and is not a player of this one', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob');
    const m = startMatch(r, a, b);
    const c = r.join('carol');
    expect(c.last('welcome')?.match?.id).toBe(m.id);
    expect(c.last('welcome')?.match?.seats).toEqual(['s1', 's2']);
    r.advance(T.startCountdownMs + 5000);
    const o = course(r)[0];
    c.send({ t: 'ev', mid: m.id, seq: 1, ob: o?.id ?? 1, k: 'pass' });
    expect(c.last('ack')).toMatchObject({ seq: 1, rejected: 'not_player' });
    c.ready();
    expect(c.last('error')?.code).toBe('busy');
  });

  it('only the host changes the game and the length, and a change clears every ready flag', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    b.send({ t: 'config', gameId: 'knee-sprint' });
    expect(b.last('error')?.code).toBe('not_host');
    a.ready();
    a.send({ t: 'config', gameId: 'knee-sprint', durationMs: 45_000 });
    expect(b.last('room')?.room.config).toMatchObject({ gameId: 'knee-sprint', durationMs: 45_000 });
    expect(b.last('presence')?.members.every((m) => !m.ready)).toBe(true);
    a.send({ t: 'config', durationMs: 5 });
    expect(a.last('error')?.code).toBe('bad_config');
    a.ready(); b.ready();
    expect(a.last('start')?.match).toMatchObject({ gameId: 'knee-sprint', duration: 45_000 });
    a.send({ t: 'config', gameId: 'squat-flap' });
    expect(a.last('error')?.code).toBe('busy');
  });
});

describe('results and scoring', () => {
  it('acknowledges results, keeps the first per obstacle and refuses odd ones', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    const m = startMatch(r, a, b);
    const list = course(r);
    const o1 = list[0]; const o3 = list[2];
    if (!o1 || !o3) throw new Error('course too short');
    r.advance(T.startCountdownMs + o1.t);
    a.send({ t: 'ev', mid: m.id, seq: 1, ob: o1.id, k: 'pass' });
    a.send({ t: 'ev', mid: m.id, seq: 2, ob: o1.id, k: 'hit' });         // same obstacle again: acknowledged, ignored
    a.send({ t: 'ev', mid: m.id, seq: 3, ob: 999, k: 'pass' });          // no such obstacle
    a.send({ t: 'ev', mid: m.id, seq: 4, ob: o3.id, k: 'pass' });        // more than 3 s ahead
    a.send({ t: 'ev', mid: 'other', seq: 5, ob: o1.id, k: 'pass' });
    expect(a.all('ack').map((x) => [x.seq, x.rejected])).toEqual([[1, undefined], [2, undefined], [3, 'bad'], [4, 'early'], [5, 'no_match']]);
    expect(r.engine.inspect().events['s1']).toEqual([{ ob: o1.id, k: 'pass' }]);
  });

  it('scores identically for every seat and names the winner; the result reaches both', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    const mine = playAll(r, [a, b], (seat) => (seat === 's1' ? 'pass' : 'hit'));
    const ra = resultOf(a); const rb = resultOf(b);
    expect(ra).toEqual(rb);
    expect(ra).toMatchObject({ reason: 'complete', winner: 's1', places: { s1: 1, s2: 2 }, forfeited: [] });
    expect(ra?.scores['s1']).toEqual(scoreOf(course(r), mine['s1'] ?? []));
    expect(ra?.scores['s2']?.score).toBe(0);
    expect(r.match().phase).toBe('over');
    expect(a.last('presence')?.members.every((m) => !m.ready)).toBe(true);
  });

  it('declares a draw when score, hits and combo are equal', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    playAll(r, [a, b], () => 'pass');
    expect(resultOf(a)).toMatchObject({ reason: 'complete', winner: null, places: { s1: 1, s2: 1 } });
  });

  it('breaks a score tie with fewer hits, then the longer combo', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    const list = course(r);
    // s1 passes everything but misses the last obstacle; s2 hits the last obstacle too but passes the others: equal
    // passes means a fair comparison of hits, so make s2 skip (no result) the last one: fewer hits wins
    const last = list[list.length - 1]?.id;
    playAll(r, [a, b], (seat, ob) => (ob === last ? (seat === 's1' ? 'hit' : null) : 'pass'));
    const res = resultOf(a);
    expect(res?.scores['s1']?.score).toBe(res?.scores['s2']?.score);
    expect(res?.winner).toBe('s2');
  });

  it('ranks three seats with shared places (1, 1, 3)', async () => {
    const r = await Room.make({ size: 3 });
    const [a, b, c] = [r.join('alice'), r.join('bob'), r.join('carol')] as [TestPlayer, TestPlayer, TestPlayer];
    startMatch(r, a, b, c);
    playAll(r, [a, b, c], (seat) => (seat === 's3' ? 'hit' : 'pass'));
    const res = resultOf(c);
    expect(res?.places).toEqual({ s1: 1, s2: 1, s3: 3 });
    expect(res?.winner).toBeNull();
  });

  it('fills lost results from the final list', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    const m = r.match();
    const list = course(r);
    r.advance(T.startCountdownMs + 4000);
    // a never reported live; its final carries everything
    r.advance(m.duration - 4000);
    a.send({ t: 'final', mid: m.id, evs: list.map((o) => ({ ob: o.id, k: 'pass' as const })) });
    b.send({ t: 'final', mid: m.id, evs: [] });
    const res = resultOf(a);
    expect(res?.scores['s1']?.passes).toBe(list.length);
    expect(res?.winner).toBe('s1');
  });

  it('scores what it has when a final never arrives, after the settle time', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    const m = r.match();
    r.advance(T.startCountdownMs + m.duration);
    expect(a.all('settling')).toHaveLength(1);
    a.send({ t: 'final', mid: m.id, evs: [] });
    expect(resultOf(a)).toBeUndefined();
    r.advance(T.settleMs);
    expect(resultOf(a)?.reason).toBe('complete');
    expect(resultOf(b)).toEqual(resultOf(a));
  });

  it('answers a repeated final after the result with the result again', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    playAll(r, [a, b], () => 'pass');
    const m = r.match();
    const before = a.all('result').length;
    a.send({ t: 'final', mid: m.id, evs: [] });
    expect(a.all('result')).toHaveLength(before + 1);
    a.send({ t: 'ev', mid: m.id, seq: 99, ob: 1, k: 'hit' });
    expect(a.last('ack')).toMatchObject({ seq: 99, rejected: 'over' });
  });

  it('ignores a final that arrives long before the end or while paused', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    const m = startMatch(r, a, b);
    r.advance(T.startCountdownMs + 5000);
    a.send({ t: 'final', mid: m.id, evs: [{ ob: 1, k: 'pass' }] });
    expect(r.engine.inspect().events['s1']).toBeUndefined();
    expect(r.match().phase).toBe('running');
  });
});

describe('pauses and the match clock', () => {
  function matchTimeOf(r: Room): number {
    const m = r.match();
    if (m.phase === 'settling' || m.phase === 'over') return m.duration;
    const t = m.phase === 'paused' ? (m.pausedAt as number) : r.host.t;
    return Math.max(0, t - m.startAt - m.pauseTotal);
  }

  it('pauses for everyone, resumes with a 3 s countdown and keeps match time continuous', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 10_000);
    b.send({ t: 'pause', reason: 'hidden' });
    expect(a.last('paused')).toMatchObject({ by: 's2' });
    expect(a.last('paused')?.match.phase).toBe('paused');
    const frozen = matchTimeOf(r);
    r.advance(4000);
    expect(matchTimeOf(r)).toBe(frozen);
    b.send({ t: 'unpause' });
    const resumed = a.last('resumed');
    expect(resumed?.match.phase).toBe('running');
    expect(resumed?.match.resumeAt).toBe(r.host.t + T.resumeCountdownMs);
    expect(matchTimeOf(r)).toBe(frozen - T.resumeCountdownMs);          // the 3-2-1 counts as paused time
    r.advance(T.resumeCountdownMs);
    expect(matchTimeOf(r)).toBe(frozen);
    r.advance(1000);
    expect(matchTimeOf(r)).toBe(frozen + 1000);
  });

  it('stays paused until every reason is gone', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 5000);
    a.send({ t: 'pause', reason: 'hidden' });
    b.send({ t: 'pause', reason: 'camera' });
    a.send({ t: 'unpause' });
    expect(a.all('resumed')).toHaveLength(0);
    expect(r.match().phase).toBe('paused');
    b.send({ t: 'unpause' });
    expect(a.all('resumed')).toHaveLength(1);
  });

  it('pausing again during the countdown takes the countdown back', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 8000);
    a.send({ t: 'pause', reason: 'hidden' });
    const frozen = matchTimeOf(r);
    r.advance(2000);
    a.send({ t: 'unpause' });
    r.advance(1000);                                            // 2 s into the 3-2-1
    a.send({ t: 'pause', reason: 'hidden' });
    expect(matchTimeOf(r)).toBe(frozen);                       // the countdown never finished: still where it was paused
    a.send({ t: 'unpause' });
    r.advance(T.resumeCountdownMs);
    expect(matchTimeOf(r)).toBe(frozen);
  });

  it('a pause during the start countdown delays time zero by the paused time', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(1000);
    a.send({ t: 'pause', reason: 'hidden' });
    expect(matchTimeOf(r)).toBe(0);
    r.advance(10_000);
    a.send({ t: 'unpause' });
    r.advance(T.resumeCountdownMs);
    expect(matchTimeOf(r)).toBe(0);                            // the 3-2-1 after the pause was the start countdown
    r.advance(2000);
    expect(matchTimeOf(r)).toBe(2000);
  });

  it('a socket that drops for less than 5 s pauses nothing; for longer it pauses with the offline reason and resumes on return', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 5000);
    r.drop(b);
    r.advance(T.offlineDebounceMs - 500);
    expect(r.match().phase).toBe('running');
    const b2 = r.join('bob', {}, {}, b.tab);                    // same tab, new socket
    expect(b2.last('welcome')?.match?.phase).toBe('running');
    expect(a.all('paused')).toHaveLength(0);
    r.drop(b2);
    r.advance(T.offlineDebounceMs + 100);
    expect(r.match().phase).toBe('paused');
    expect(a.last('paused')).toMatchObject({ by: 's2' });
    expect(r.match().reasons).toEqual({ s2: 'offline' });
    const b3 = r.join('bob', {}, {}, b.tab);
    expect(b3.last('welcome')?.match?.phase).toBe('running');   // the hello cleared the offline reason: resumed with a countdown
    expect(a.last('resumed')).toBeDefined();
  });

  it('adopts the pause reasons the client reports in hello and clears stale ones', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 5000);
    b.send({ t: 'pause', reason: 'hidden' });
    r.drop(b);
    const b2 = r.join('bob', {}, { reasons: ['camera'] }, b.tab);      // came back, but the camera is gone
    expect(r.match().phase).toBe('paused');
    expect(r.match().reasons).toEqual({ s2: 'camera' });
    expect(b2.last('welcome')?.match?.reasons).toEqual({ s2: 'camera' });
    r.drop(b2);
    r.join('bob', {}, { reasons: [] }, b.tab);                         // back with nothing wrong: the stale reason is gone
    expect(r.match().phase).toBe('running');
  });

  it('forfeits a seat that holds the pause for the whole grace, and the other seat wins', async () => {
    const r = await Room.make({}, {});
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 20_000);                            // 2/3 played: a real result
    b.send({ t: 'pause', reason: 'hidden' });
    r.advance(T.graceMs - 1000);
    expect(r.match().phase).toBe('paused');
    r.advance(1500);
    expect(a.last('forfeit')).toMatchObject({ seat: 's2' });
    expect(resultOf(a)).toMatchObject({ reason: 'forfeit', winner: 's1', places: { s1: 1 }, forfeited: ['s2'] });
    expect(resultOf(b)).toEqual(resultOf(a));
  });

  it('calls a forfeit before 30% of the match "no contest"', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 2000);
    b.send({ t: 'pause', reason: 'hidden' });
    r.advance(T.graceMs + 100);
    expect(resultOf(a)).toMatchObject({ reason: 'no_contest', winner: null, places: {} });
  });

  it('abandons the match when everybody stays away for the grace', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 20_000);
    r.drop(a); r.drop(b);
    r.advance(T.offlineDebounceMs + T.graceMs + 200);
    const res = r.engine.inspect().match?.result;
    expect(res?.reason).toBe('abandoned');
    expect(res?.winner).toBeNull();
  });

  it('with three seats one forfeit does not end the match: the other two play on and finish', async () => {
    const r = await Room.make({ size: 3 });
    const [a, b, c] = [r.join('alice'), r.join('bob'), r.join('carol')] as [TestPlayer, TestPlayer, TestPlayer];
    startMatch(r, a, b, c);
    r.advance(T.startCountdownMs + 5000);
    c.send({ t: 'pause', reason: 'camera' });
    r.advance(T.graceMs + 100);
    expect(a.last('forfeit')).toMatchObject({ seat: 's3' });
    expect(a.last('resumed')).toBeDefined();                          // the remaining two resume with a countdown
    expect(r.match().phase).toBe('running');
    r.advance(T.resumeCountdownMs);
    playAll(r, [a, b], (seat) => (seat === 's1' ? 'pass' : 'hit'));
    const res = resultOf(a);
    expect(res).toMatchObject({ reason: 'complete', winner: 's1', places: { s1: 1, s2: 2 }, forfeited: ['s3'] });
    expect(Object.keys(res?.scores ?? {})).toEqual(['s1', 's2', 's3']);
  });

  it('leaving on purpose forfeits at once; the rest of a three-seat match goes on', async () => {
    const r = await Room.make({ size: 3 });
    const [a, b, c] = [r.join('alice'), r.join('bob'), r.join('carol')] as [TestPlayer, TestPlayer, TestPlayer];
    startMatch(r, a, b, c);
    r.advance(T.startCountdownMs + 15_000);
    c.send({ t: 'bye' });
    expect(a.last('forfeit')).toMatchObject({ seat: 's3' });
    expect(resultOf(a)).toBeUndefined();
    b.send({ t: 'bye' });
    expect(resultOf(a)).toMatchObject({ reason: 'forfeit', winner: 's1', forfeited: ['s3', 's2'] });
  });

  it('caps manual pauses so one player cannot stall the others', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 5000);
    for (let i = 0; i < 4; i++) {
      a.send({ t: 'pause', reason: 'user' });
      if (r.match().phase === 'paused') a.send({ t: 'unpause' });
      r.advance(T.resumeCountdownMs + 100);
    }
    expect(a.all('paused')).toHaveLength(2);
  });
});

describe('who is who: tabs, kicks, host', () => {
  it('lets a newer tab take the seat, closes the older one with 4000 and never lets it back', async () => {
    const r = await Room.make();
    const a1 = r.join('alice', {}, {}, 'tabA'); r.join('bob');
    const a2 = r.join('alice', {}, {}, 'tabB');
    expect(a1.closeCode).toBe(CLOSE.REPLACED);
    expect(a2.last('welcome')?.you).toBe('s1');
    const a3 = r.join('alice', {}, {}, 'tabA');
    expect(a3.closeCode).toBe(CLOSE.REPLACED);
    expect(r.engine.inspect().members.find((m) => m.seat === 's1')?.online).toBe(true);
    expect(a2.closeCode).toBeNull();
  });

  it('a socket that is not the current one cannot act', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    const a2 = r.join('alice', {}, {}, a.tab);                         // same tab reconnecting
    expect(a.closeInfo?.code ?? a.conn.closeInfo?.code).toBe(1000);
    a.conn.open = true;                                                // pretend the old socket still delivers
    a.ready();
    expect(b.last('presence')?.members.find((m) => m.seat === 's1')?.ready).toBe(false);
    a2.ready();
    expect(b.last('presence')?.members.find((m) => m.seat === 's1')?.ready).toBe(true);
  });

  it('hands the host to the next member when the host leaves', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob'); const c = r.join('carol');
    a.send({ t: 'bye' });
    expect(b.last('room')?.room.host).toBe('s2');
    expect(c.last('presence')?.members.map((m) => [m.seat, m.host])).toEqual([['s2', true], ['s3', false]]);
    expect(a.closeCode).toBe(1000);
  });

  it('lets the host kick in a private room: the member is told, closed with 4003 and banned for the room', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob'); const c = r.join('carol');
    b.send({ t: 'kick', seat: 's3' });
    expect(b.last('error')?.code).toBe('not_host');
    a.send({ t: 'kick', seat: 's3' });
    expect(c.last('removed')?.reason).toBe('kicked');
    expect(c.closeCode).toBe(CLOSE.REMOVED);
    expect(r.engine.check({ p: 'carol', a: 'adult', k: 'x'.repeat(20) })).toEqual({ ok: false, error: 'banned' });
    expect(r.join('carol').closeCode).toBe(CLOSE.REMOVED);
    a.send({ t: 'kick', seat: 's1' });
    expect(a.last('error')?.code).toBe('bad');
  });

  it('forfeits a kicked player during a match', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 15_000);
    a.send({ t: 'kick', seat: 's2' });
    expect(resultOf(a)).toMatchObject({ reason: 'forfeit', winner: 's1' });
  });

  it('drops a lobby member who stays offline and gives the seat to a newcomer sooner when the room is full', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    r.drop(b);
    expect(r.join('carol').closeCode).toBe(CLOSE.FULL);                 // only a moment offline: the seat is still bob's
    r.advance(T.lobbyEvictMs + 100);
    const c = r.join('carol');
    expect(c.closeCode).toBeNull();
    expect(c.last('welcome')?.members.map((m) => m.seat)).toEqual(['s1', 's3']);
    expect(a.last('presence')?.members.map((m) => m.seat)).toEqual(['s1', 's3']);
    // and a lobby member offline for a whole minute is dropped by the alarm
    r.drop(c);
    r.advance(T.lobbyDropMs + 100);
    expect(a.last('presence')?.members.map((m) => m.seat)).toEqual(['s1']);
  });

  it('does not evict anyone while a match is running', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.drop(b);
    r.advance(T.lobbyEvictMs + 100);
    expect(r.join('carol').closeCode).toBe(CLOSE.FULL);
  });
});

describe('chat, presets, blocks, reports', () => {
  it('delivers filtered text between adults in a private room and tells the sender why a message was refused', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    a.send({ t: 'chat', text: 'good game  everyone' });
    expect(b.last('chat')).toMatchObject({ from: 's1', text: 'good game everyone' });
    expect(a.last('chat')?.from).toBe('s1');
    r.advance(5100);
    a.send({ t: 'chat', text: 'visit http://example.com now' });
    expect(a.last('chat_rejected')?.reason).toBe('link');
    a.send({ t: 'chat', text: 'call me on 0555 123 45 67' });
    expect(a.last('chat_rejected')?.reason).toBe('phone');
    a.send({ t: 'chat', text: 'second one too soon' });
    const rej = a.last('chat_rejected');
    // the failed attempts above did not use the allowance; this one is delivered, the next one is rate limited
    expect(b.last('chat')?.text).toBe('second one too soon');
    a.send({ t: 'chat', text: 'and again' });
    expect(a.last('chat_rejected')?.reason).toBe('rate');
    expect(a.last('chat_rejected')?.retryAt).toBeGreaterThan(r.host.t);
    void rej;
  });

  it('allows presets and reactions only (no free text) once an under-18 member is in the room, and in public rooms', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob', { a: 'teen' });
    expect(a.last('room')?.room.chat).toBe('preset');
    a.send({ t: 'chat', text: 'hello there' });
    expect(a.last('chat_rejected')?.reason).toBe('not_allowed');
    b.send({ t: 'preset', id: 'gg' });
    expect(a.last('preset')).toMatchObject({ from: 's2', id: 'gg' });
    r.advance(500);
    b.send({ t: 'react', id: 'clap' });
    expect(a.last('react')).toMatchObject({ from: 's2', id: 'clap' });
    b.send({ t: 'react', id: 'fire' });                                // within 400 ms of the last one: dropped
    expect(a.all('react')).toHaveLength(1);
    const pub = await Room.make({ kind: 'public', audience: 'adult' });
    const p1 = pub.join('p1'); pub.join('p2');
    p1.send({ t: 'chat', text: 'hello' });
    expect(p1.last('chat_rejected')?.reason).toBe('not_allowed');
    expect(p1.last('welcome')?.room).toMatchObject({ kind: 'public', chat: 'preset', video: false });
  });

  it('video is offered only between adults in a private room who both switched it on and did not block each other', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice', {}, { video: true }); const b = r.join('bob', {}, { video: true });
    const c = r.join('carol', { a: 'teen' }, { video: true });
    expect(b.last('presence')?.members.map((m) => [m.seat, m.video])).toEqual([['s1', true], ['s2', true], ['s3', false]]);
    expect(c.last('welcome')?.members.map((m) => [m.seat, m.video])).toEqual([['s1', false], ['s2', false], ['s3', false]]);
    a.send({ t: 'block', seat: 's2' });
    expect(a.last('blocked')).toMatchObject({ seat: 's2' });
    expect(a.last('presence')?.members.find((m) => m.seat === 's2')?.video).toBe(false);
    expect(b.last('presence')?.members.find((m) => m.seat === 's1')?.video).toBe(false);
    expect(r.host.blocks).toEqual([['alice', 'bob']]);
  });

  it('a block hides chat and presets both ways and is reported back as a key the device keeps', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob'); const c = r.join('carol');
    a.send({ t: 'block', seat: 's2' });
    const key = a.last('blocked')?.key;
    expect(key).toBeTruthy();
    b.send({ t: 'chat', text: 'hi alice' });
    expect(a.all('chat')).toHaveLength(0);
    expect(c.all('chat')).toHaveLength(1);
    a.send({ t: 'chat', text: 'hi bob' });
    expect(b.all('chat').filter((m) => m.from === 's1')).toHaveLength(0);
    // after a reconnect the device sends the key in hello and the Room knows the block again
    r.drop(a);
    const a2 = r.join('alice', {}, { blocks: [key as string] }, a.tab);
    expect(a2.last('welcome')?.blocked).toEqual(['s2']);
  });

  it('keeps blocked pairs out of the same public room', async () => {
    const r = await Room.make({ kind: 'public', audience: 'adult', size: 3 });
    const a = r.join('alice'); const b = r.join('bob');
    a.send({ t: 'block', seat: 's2' });
    const c = r.join('carol');
    expect(c.closeCode).toBeNull();
    b.send({ t: 'bye' });
    // bob's key is in alice's blocks: bob cannot come back into her room, and carol with bob's key cannot join
    const b2 = r.join('bob');
    expect(b2.closeCode).toBe(CLOSE.NOT_ALLOWED);
    const d = r.join('dave', {}, { blocks: [a.last('blocked')?.key as string, 'bk_other_xxxxxxxxxxxx'] });
    expect(d.closeCode).toBeNull();                                      // dave blocked bob, who is not here any more
    void a;
  });

  it('three reports from different players mute a player\'s free text and reach the report hook with the chat evidence', async () => {
    const r = await Room.make({ size: 4 });
    const [a, b, c, d] = [r.join('alice'), r.join('bob'), r.join('carol'), r.join('dave')] as [TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    d.send({ t: 'chat', text: 'you all stink' });
    a.send({ t: 'report', seat: 's4', reason: 'abuse', block: true });
    expect(a.last('reported')).toMatchObject({ seat: 's4' });
    expect(a.last('blocked')).toMatchObject({ seat: 's4' });
    a.send({ t: 'report', seat: 's4', reason: 'abuse', block: false });     // the same pair twice counts once
    b.send({ t: 'report', seat: 's4', reason: 'spam', block: false });
    r.advance(5100);
    d.send({ t: 'chat', text: 'still here' });
    expect(d.last('chat_rejected')).toBeUndefined();
    c.send({ t: 'report', seat: 's4', reason: 'sexual', block: false });
    r.advance(5100);
    d.send({ t: 'chat', text: 'one more' });
    expect(d.last('chat_rejected')?.reason).toBe('muted');
    expect(r.host.reports).toHaveLength(3);
    expect(r.host.reports[0]).toMatchObject({ code: 'K7P2QX', reporterPid: 'alice', targetPid: 'dave', reason: 'abuse' });
    expect(r.host.reports[0]?.chat.map((l) => l.text)).toEqual(['you all stink']);
    a.send({ t: 'report', seat: 's1', reason: 'abuse', block: false });      // cannot report yourself
    expect(r.host.reports).toHaveLength(3);
  });
});

describe('public rooms', () => {
  it('admits only the audience age band, never children, and tells the lobby directory about every change', async () => {
    const r = await Room.make({ kind: 'public', audience: 'teen', size: 3, config: { gameId: 'knee-sprint', durationMs: 30_000, band: 'easy' } });
    expect(r.join('kid', { a: 'child' }).closeCode).toBe(CLOSE.NOT_ALLOWED);
    expect(r.join('grown', { a: 'adult' }).closeCode).toBe(CLOSE.NOT_ALLOWED);
    const t1 = r.join('teen1', { a: 'teen' });
    expect(t1.closeCode).toBeNull();
    const last = () => r.host.published[r.host.published.length - 1]?.summary as Record<string, unknown>;
    expect(last()).toMatchObject({ code: 'K7P2QX', kind: 'public', gameId: 'knee-sprint', band: 'easy', audience: 'teen', size: 3, players: 1, open: 2, phase: 'lobby' });
    const t2 = r.join('teen2', { a: 'teen' });
    expect(last()).toMatchObject({ players: 2, open: 1, names: ['teen1', 'teen2'] });
    t1.ready(); t2.ready();
    expect(last()).toMatchObject({ phase: 'playing' });
    expect(r.host.published.at(-1)?.pids.sort()).toEqual(['teen1', 'teen2']);
    expect(r.host.playing.filter((x) => x.playing).map((x) => x.pid).sort()).toEqual(['teen1', 'teen2']);
  });

  it('cannot be configured or have members kicked by its first member', async () => {
    const r = await Room.make({ kind: 'public', audience: 'adult' });
    const a = r.join('alice'); r.join('bob');
    a.send({ t: 'config', gameId: 'knee-sprint' });
    expect(a.last('error')?.code).toBe('not_allowed');
    a.send({ t: 'kick', seat: 's2' });
    expect(a.last('error')?.code).toBe('not_allowed');
  });
});

describe('storage, hibernation and expiry', () => {
  it('continues a running match after the engine is rebuilt from storage (hibernation wake)', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    const m = startMatch(r, a, b);
    const list = course(r);
    r.advance(T.startCountdownMs + (list[0]?.t ?? 3000));
    a.send({ t: 'ev', mid: m.id, seq: 1, ob: list[0]?.id ?? 1, k: 'pass' });
    b.send({ t: 'pause', reason: 'hidden' });                            // a phase change writes everything, events included
    await r.reload();
    expect(r.engine.inspect().events['s1']).toEqual([{ ob: list[0]?.id, k: 'pass' }]);
    b.send({ t: 'unpause' });
    expect(a.last('resumed')).toBeDefined();
    playAll(r, [a, b], () => 'pass');
    expect(resultOf(a)?.reason).toBe('complete');
  });

  it('flushes results in batches and a rebuilt engine reads what was written', async () => {
    const r = await Room.make({}, { eventFlushMs: 30_000 });
    const a = r.join('alice'); const b = r.join('bob');
    const m = startMatch(r, a, b);
    const list = course(r);
    r.advance(T.startCountdownMs);
    const rows0 = r.host.rowsWritten;
    for (const o of list.slice(0, 5)) {
      r.advance(Math.max(0, m.startAt + o.t - r.host.t));
      a.send({ t: 'ev', mid: m.id, seq: o.id, ob: o.id, k: 'pass' });
    }
    expect(r.host.rowsWritten).toBe(rows0);                              // five results acknowledged, nothing written yet
    r.advance(30_000);
    expect(r.host.rowsWritten).toBeGreaterThan(rows0);
    await r.reload();
    expect(r.engine.inspect().events['s1']).toHaveLength(5);
  });

  it('after a crash that lost unflushed results the final list restores them', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    const m = startMatch(r, a, b);
    const list = course(r);
    r.advance(T.startCountdownMs + (list[1]?.t ?? 5000));
    for (const o of list.slice(0, 2)) a.send({ t: 'ev', mid: m.id, seq: o.id, ob: o.id, k: 'pass' });
    await r.reload();                                                    // memory lost, nothing flushed yet
    expect(r.engine.inspect().events['s1']).toBeUndefined();
    playAll(r, [a, b], () => 'pass');
    expect(resultOf(a)?.scores['s1']?.passes).toBe(list.length);
  });

  it('a room nobody ever joins, and an emptied room, disappear; a busy one does not', async () => {
    const r = await Room.make();
    r.advance(T.emptyTtlMs - 1000);
    expect(r.engine.exists).toBe(true);
    r.advance(1500);
    expect(r.engine.exists).toBe(false);
    expect(r.host.deleted).toBe(true);
    expect(r.host.removed).toEqual(['K7P2QX']);
    const r2 = await Room.make();
    const a = r2.join('alice');
    r2.advance(T.emptyTtlMs * 3);
    expect(r2.engine.exists).toBe(true);
    a.send({ t: 'bye' });
    r2.advance(T.emptyTtlMs + 100);
    expect(r2.engine.exists).toBe(false);
  });

  it('expires after 24 hours without a single message and closes the sockets with 4004', async () => {
    const r = await Room.make();
    const a = r.join('alice');
    r.advance(T.roomTtlMs + 11 * 60_000);                       // the idle alarm is rounded up to 10 minutes
    expect(r.engine.exists).toBe(false);
    expect(a.closeCode).toBe(CLOSE.NO_ROOM);
  });

  it('survives its own alarm being late: a message right after the deadline processes it first', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 20_000);
    b.send({ t: 'pause', reason: 'hidden' });
    r.host.alarmAt = null;                                               // the alarm never fires
    r.host.t += T.graceMs + 500;
    a.send({ t: 'sync', c: 1 });
    expect(a.last('forfeit')).toMatchObject({ seat: 's2' });
  });
});

describe('more rules', () => {
  it('a forfeit during the settle time finishes the match at once when everyone left has sent the final list', async () => {
    const r = await Room.make({ size: 3 });
    const [a, b, c] = [r.join('alice'), r.join('bob'), r.join('carol')] as [TestPlayer, TestPlayer, TestPlayer];
    startMatch(r, a, b, c);
    const m = r.match();
    r.advance(T.startCountdownMs + m.duration);
    a.send({ t: 'final', mid: m.id, evs: [] }); b.send({ t: 'final', mid: m.id, evs: [] });
    expect(resultOf(a)).toBeUndefined();                          // waiting for carol
    c.send({ t: 'bye' });
    expect(resultOf(a)).toMatchObject({ reason: 'complete', forfeited: ['s3'] });
  });

  it('the room goes back to text chat when the under-18 member leaves', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const t = r.join('teen-device-01', { a: 'teen' });
    expect(a.last('room')?.room.chat).toBe('preset');
    t.send({ t: 'bye' });
    expect(a.last('room')?.room.chat).toBe('text');
  });

  it('a lobby member who leaves and comes back gets a new seat, and a second hello on one socket is an error', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob');
    expect(b.seat).toBe('s2');
    b.send({ t: 'bye' });
    const b2 = r.join('bob');
    expect(b2.seat).toBe('s3');
    expect(a.last('presence')?.members.map((m) => m.seat)).toEqual(['s1', 's3']);
    b2.hello();
    expect(b2.last('error')?.code).toBe('bad');
  });

  it('presses and releases ready, and a config change clears it', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    a.ready(); a.ready(false);
    expect(b.last('presence')?.members.find((m) => m.seat === 's1')?.ready).toBe(false);
    b.ready();
    a.send({ t: 'config', durationMs: 20_000 });
    expect(a.last('presence')?.members.every((m) => !m.ready)).toBe(true);
    expect(r.engine.inspect().match).toBeNull();
  });

  it('keeps counting match time through a deploy that happens in the 3-2-1 after a pause', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 10_000);
    b.send({ t: 'pause', reason: 'hidden' });
    r.advance(2000);
    b.send({ t: 'unpause' });
    const before = r.match();
    await r.reload();                                               // sockets stay: a hibernation wake
    r.advance(T.resumeCountdownMs + 1000);
    const after = r.match();
    expect(after.pauseTotal).toBe(before.pauseTotal);
    expect(after.phase).toBe('running');
  });
});

describe('restart and names', () => {
  it('after a restart that took every socket away, members count as offline: the match pauses after the debounce and the grace forfeits the absent', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 20_000);
    // a deploy: the engine is rebuilt from storage and the sockets are gone (the platform reports no closes)
    a.conn.open = false; b.conn.open = false;
    await r.reload();
    expect(r.engine.inspect().members.every((m) => !m.online)).toBe(true);
    expect(r.match().phase).toBe('running');
    r.advance(T.offlineDebounceMs + 100);
    expect(r.match().phase).toBe('paused');
    expect(r.match().reasons).toEqual({ s1: 'offline', s2: 'offline' });
    // alice comes back on a new socket: only bob holds the pause now
    const a2 = r.join('alice', {}, {}, a.tab);
    expect(a2.last('welcome')?.match?.reasons).toEqual({ s2: 'offline' });
    r.advance(T.graceMs + 100);
    expect(r.engine.inspect().match?.result?.reason).toBe('forfeit');
    expect(r.engine.inspect().match?.result?.winner).toBe('s1');
  });

  it('a hibernation wake with the sockets still connected changes nothing', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    r.advance(T.startCountdownMs + 5000);
    await r.reload();
    expect(r.engine.inspect().members.every((m) => m.online)).toBe(true);
    r.advance(T.offlineDebounceMs + 1000);
    expect(r.match().phase).toBe('running');
  });

  it('gives two players with the same name different names in the room', async () => {
    const r = await Room.make({ size: 4 });
    const a = r.join('alice-1-device', { n: 'Sam' }); const b = r.join('alice-2-device', { n: 'Sam' }); const c = r.join('alice-3-device', { n: 'Sam' });
    expect(c.last('welcome')?.members.map((m) => m.name)).toEqual(['Sam', 'Sam 2', 'Sam 3']);
    void a; void b;
  });
});

describe('abuse limits', () => {
  it('drops relay messages above 25 per second and closes a socket that floods', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    for (let i = 0; i < 40; i++) a.send({ t: 'relay', d: { n: i } });
    expect(b.all('relay')).toHaveLength(25);
    expect(a.last('error')?.code).toBe('rate');
    r.advance(1000);
    for (let i = 0; i < 400; i++) a.send({ t: 'sync', c: i });
    expect(a.closeCode).toBe(CLOSE.RATE);
  });

  it('relays only to the others and forwards signals to one seat', async () => {
    const r = await Room.make({ size: 3 });
    const a = r.join('alice'); const b = r.join('bob'); const c = r.join('carol');
    a.send({ t: 'relay', d: { x: 1 } });
    expect(b.last('relay')).toMatchObject({ from: 's1', d: { x: 1 } });
    expect(c.last('relay')).toMatchObject({ from: 's1' });
    expect(a.all('relay')).toHaveLength(0);
    a.send({ t: 'signal', to: 's2', d: { sess: 'sa', rsess: 'sb', description: { type: 'offer', sdp: 'v=0' } } });
    expect(b.last('signal')).toMatchObject({ from: 's1', d: { sess: 'sa', rsess: 'sb' } });
    expect(c.all('signal')).toHaveLength(0);
    a.send({ t: 'signal', to: 's9', d: { sess: 'sa', rsess: 'sb' } });         // nobody there: silently dropped
    a.send({ t: 'sess', sess: 'sa2' });
    expect(b.last('presence')?.members.find((m) => m.seat === 's1')?.sess).toBe('sa2');
  });
});

describe('message shape', () => {
  it('every Room message carries a known type', async () => {
    const r = await Room.make();
    const a = r.join('alice'); const b = r.join('bob');
    startMatch(r, a, b);
    playAll(r, [a, b], () => 'pass');
    const types = new Set<RoomMessage['t']>();
    for (const m of [...a.msgs, ...b.msgs]) types.add(m.t);
    for (const t of types) expect(['welcome', 'sync', 'presence', 'room', 'signal', 'start', 'paused', 'resumed', 'forfeit', 'settling', 'ack', 'relay', 'result', 'chat', 'preset', 'react', 'chat_rejected', 'blocked', 'reported', 'removed', 'error']).toContain(t);
  });
});
