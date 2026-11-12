// Duel rooms (core/net/duel-link.ts) in the Room engine: two seats and no more, no video and no typed chat, no child, a hard close
// ten minutes after the room was made (a running match is scored first), no match that cannot end before that, and the score duel:
// the pages report their totals, the Room keeps them within the game's rate on its own clock and judges the match from what it kept.
import { describe, expect, it } from 'vitest';
import { CLOSE } from '../../../core/types/net.ts';
import { DUEL_LIFETIME_MS, SCORE_RATES } from '../../../core/net/duel-link.ts';
import { DEFAULT_TIMING } from './config.ts';
import { RoomEngine } from './room-engine.ts';
import { FakeHost, Room, age, type TestPlayer } from './testkit.ts';

const T = DEFAULT_TIMING;
const STAR = SCORE_RATES['star-catch'] as { perSec: number; burst: number };

const duelRoom = (gameId = 'star-catch', durationMs = 30_000): Promise<Room> =>
  Room.make({ duel: true, size: 2, config: { gameId, durationMs, band: null } });

/** Both press ready, and the clock goes to match time zero. */
function start(room: Room, a: TestPlayer, b: TestPlayer): void {
  a.ready(); b.ready();
  const m = room.match();
  room.advance(Math.max(0, m.startAt - room.host.t));
}

describe('a duel room', () => {
  it('is a private room of two: a room of any other size, or a public one, is refused', async () => {
    for (const [kind, size] of [['private', 3], ['private', 4], ['public', 2]] as const) {
      const e = await RoomEngine.create(new FakeHost());
      expect(e.init({ code: 'AAAAAA', kind, size, config: { gameId: 'star-catch', durationMs: 30_000, band: null }, audience: kind === 'public' ? 'adult' : null, creator: 'c', duel: true })).toEqual({ ok: false, error: 'bad_size' });
    }
  });

  it('says it is a duel room and when it closes, offers no video and only preset messages, and its preview says duel', async () => {
    const r = await duelRoom();
    const made = r.host.t;
    const a = r.join('alice');
    const info = a.last('welcome')?.room;
    expect(info).toMatchObject({ size: 2, video: false, chat: 'preset', duel: { closesAt: made + DUEL_LIFETIME_MS, mode: 'score' } });
    expect(r.engine.preview()).toMatchObject({ duel: true, size: 2 });
    // a camera switched on gives nobody a picture
    const b = r.join('bob', {}, { video: true });
    expect(a.last('presence')?.members.find((m) => m.seat === b.seat)?.video).toBe(false);
    a.send({ t: 'chat', text: 'hello there' });
    expect(a.last('chat_rejected')?.reason).toBe('not_allowed');
    a.send({ t: 'preset', id: 'hi' });
    expect(b.last('preset')?.id).toBe('hi');
  });

  it('a game with a course is raced in a duel room, as in any room', async () => {
    const r = await duelRoom('squat-flap');
    const a = r.join('alice');
    expect(a.last('welcome')?.room.duel?.mode).toBe('race');
    const b = r.join('bob');
    start(r, a, b);
    expect(r.match().mode).toBeUndefined();
  });

  it('turns away a child, takes a teen', async () => {
    const r = await duelRoom();
    r.join('alice');
    const kid = r.join('kid', age('child'));
    expect(kid.closeCode).toBe(CLOSE.NOT_ALLOWED);
    expect(r.engine.check({ p: 'kid2', a: 'child', k: 'bk_kid2_0123456789' })).toEqual({ ok: false, error: 'not_allowed' });
    const teen = r.join('teen', age('teen'));
    expect(teen.last('welcome')?.you).toBeTruthy();
  });

  it('a third player finds it full', async () => {
    const r = await duelRoom();
    r.join('alice'); r.join('bob');
    const c = r.join('carol');
    expect(c.closeCode).toBe(CLOSE.FULL);
  });

  it('closes ten minutes after it was made: every socket hears 4004 and the room is gone', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    const b = r.join('bob');
    r.advance(DUEL_LIFETIME_MS - 1000);
    expect(r.engine.exists).toBe(true);
    r.advance(1100);
    expect(r.engine.exists).toBe(false);
    expect(a.closeInfo).toEqual({ code: CLOSE.NO_ROOM, reason: 'expired' });
    expect(b.closeInfo?.code).toBe(CLOSE.NO_ROOM);
    expect(r.host.deleted).toBe(true);
    expect(r.host.logs.some((l) => l.evt === 'room_end' && l.why === 'expired')).toBe(true);
  });

  it('keeps activity from holding it open: messages every minute do not move the close', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    r.join('bob');
    for (let i = 0; i < 11; i++) { r.advance(60_000); if (r.engine.exists) a.send({ t: 'preset', id: 'hi' }); }
    expect(r.engine.exists).toBe(false);
  });

  it('starts no match that could not end before the room closes', async () => {
    const r = await duelRoom('star-catch', 90_000);
    const a = r.join('alice');
    const b = r.join('bob');
    r.advance(DUEL_LIFETIME_MS - 90_000 - T.startCountdownMs - T.settleMs + 1000);
    a.ready(); b.ready();
    expect(r.engine.inspect().match).toBeNull();
    expect(r.engine.inspect().members.every((m) => m.ready)).toBe(true);
  });

  it('scores a running match when the room closes in the middle of it (the pauses made it long), then closes', async () => {
    const r = await duelRoom('star-catch', 30_000);
    const a = r.join('alice');
    const b = r.join('bob');
    r.advance(DUEL_LIFETIME_MS - 30_000 - T.startCountdownMs - T.settleMs - 2000);
    start(r, a, b);
    const m = r.match();
    r.advance(5000);
    a.send({ t: 'sc', mid: m.id, v: 100 });
    // a pause long enough to carry the match past the close (the grace is shorter, so the paused seat forfeits first: keep it short)
    b.send({ t: 'pause', reason: 'user' });
    r.advance(30_000);
    b.send({ t: 'unpause' });
    r.advance(30_000);
    expect(r.engine.exists).toBe(false);
    const res = a.last('result')?.result;
    expect(res?.mid).toBe(m.id);
    expect(res?.scores[a.seat]?.score).toBe(100);
    expect(a.closeInfo?.reason).toBe('expired');
  });
});

describe('a score duel', () => {
  it('is the match of a duel room whose game has no course: no obstacle results, the totals the Room kept, the winner from them', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    expect(m.mode).toBe('score');
    expect(a.last('start')?.match.mode).toBe('score');
    a.send({ t: 'ev', mid: m.id, seq: 1, ob: 1, k: 'pass' });
    expect(a.last('ack')).toEqual({ t: 'ack', seq: 1, rejected: 'bad' });
    r.advance(10_000);
    a.send({ t: 'sc', mid: m.id, v: 300 });
    b.send({ t: 'sc', mid: m.id, v: 200 });
    expect(b.last('scores')).toEqual({ t: 'scores', mid: m.id, s: { [a.seat]: 300, [b.seat]: 200 } });
    r.advance(20_000);
    a.send({ t: 'final', mid: m.id, evs: [], sc: 420 });
    expect(a.last('result')).toBeUndefined();
    b.send({ t: 'final', mid: m.id, evs: [], sc: 510 });
    const res = a.last('result')?.result;
    expect(res).toMatchObject({ reason: 'complete', winner: b.seat, places: { [b.seat]: 1, [a.seat]: 2 } });
    expect(res?.scores[a.seat]).toEqual({ score: 420, hits: 0, passes: 0, bestCombo: 0 });
    expect(res?.scores[b.seat]?.score).toBe(510);
    expect(res?.runs).toBeUndefined();
  });

  it('holds a total that grows faster than the game allows to the game\'s rate, on the Room\'s clock', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    // at match time zero the reserve is all there is
    a.send({ t: 'sc', mid: m.id, v: 1_000_000 });
    expect(a.last('scores')?.s[a.seat]).toBe(STAR.burst);
    // a second later: a second's worth, no more
    r.advance(1000);
    a.send({ t: 'sc', mid: m.id, v: 1_000_000 });
    expect(a.last('scores')?.s[a.seat]).toBe(STAR.burst + STAR.perSec);
    // a long quiet time fills the reserve only up to its size
    r.advance(10_000);
    a.send({ t: 'sc', mid: m.id, v: 1_000_000 });
    expect(a.last('scores')?.s[a.seat]).toBe(2 * STAR.burst + STAR.perSec);
    // a final cannot jump over it either
    r.advance(1000);
    a.send({ t: 'final', mid: m.id, evs: [], sc: 4_000_000 });
    b.send({ t: 'final', mid: m.id, evs: [], sc: 10 });
    expect(a.last('result')?.result.scores[a.seat]?.score).toBe(2 * STAR.burst + 2 * STAR.perSec);
    expect(r.host.logs.some((l) => l.evt === 'score_capped')).toBe(true);
  });

  it('a page that reports as fast as a real game scores keeps every point', async () => {
    const r = await duelRoom('star-catch', 60_000);
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    let total = 0;
    for (let s = 0; s < 58; s++) {
      r.advance(1000);
      total += s % 7 === 6 ? 300 : 200;                                // a good player: 200 a second, a bonus now and then
      a.send({ t: 'sc', mid: m.id, v: total });
    }
    expect(a.last('scores')?.s[a.seat]).toBe(total);
  });

  it('ignores totals of a match that is not running here, of a seat that finished, and of a spectator', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    r.advance(5000);
    a.send({ t: 'sc', mid: 'other', v: 50 });
    expect(a.last('scores')).toBeUndefined();
    a.send({ t: 'final', mid: m.id, evs: [], sc: 80 });
    a.send({ t: 'sc', mid: m.id, v: 500 });
    expect(r.engine.inspect().match?.sc?.[a.seat]?.v).toBe(80);
    expect(b.last('scores')?.s[a.seat]).toBe(80);
  });

  it('a total that goes down is believed', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    r.advance(3000);
    a.send({ t: 'sc', mid: m.id, v: 120 });
    a.send({ t: 'sc', mid: m.id, v: 90 });
    expect(b.last('scores')?.s[a.seat]).toBe(90);
  });

  it('ends at the match time with what the Room holds when a page never sends its final', async () => {
    const r = await duelRoom('star-catch', 30_000);
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    r.advance(10_000);
    a.send({ t: 'sc', mid: m.id, v: 150 });
    b.send({ t: 'sc', mid: m.id, v: 100 });
    r.advance(20_000 + T.settleMs + 100);
    const res = a.last('result')?.result;
    expect(res).toMatchObject({ reason: 'complete', winner: a.seat });
  });

  it('a player who leaves forfeits, and the one who stays wins', async () => {
    const r = await duelRoom('star-catch', 30_000);
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    r.advance(15_000);
    a.send({ t: 'sc', mid: m.id, v: 40 });
    b.send({ t: 'sc', mid: m.id, v: 900 });
    b.send({ t: 'bye' });
    expect(a.last('result')?.result).toMatchObject({ reason: 'forfeit', winner: a.seat });
  });

  it('survives a hibernation wake in the middle of a match: the buckets are in storage', async () => {
    const r = await duelRoom();
    const a = r.join('alice');
    const b = r.join('bob');
    start(r, a, b);
    const m = r.match();
    r.advance(4000);
    a.send({ t: 'sc', mid: m.id, v: 700 });
    await r.reload();
    a.send({ t: 'sc', mid: m.id, v: 2_000_000 });
    // 700 accepted at 4 s took that much of the reserve: the woken Room gives only what is left of it, and nothing for no time
    expect(r.engine.inspect().match?.sc?.[a.seat]?.v).toBe(STAR.burst);
    r.advance(1000);
    a.send({ t: 'sc', mid: m.id, v: 2_000_000 });
    expect(r.engine.inspect().match?.sc?.[a.seat]?.v).toBe(STAR.burst + STAR.perSec);
    expect(b.last('scores')?.s[a.seat]).toBe(STAR.burst + STAR.perSec);
  });
});

describe('ordinary rooms stay as they were', () => {
  it('a private room without the duel flag has video, typed chat and no closing time', async () => {
    const r = await Room.make({ config: { gameId: 'star-catch', durationMs: 30_000, band: null } });
    const a = r.join('alice');
    const info = a.last('welcome')?.room;
    expect(info).toMatchObject({ video: true, chat: 'text' });
    expect(info?.duel).toBeUndefined();
    expect(r.engine.preview()?.duel).toBeUndefined();
    const b = r.join('bob');
    start(r, a, b);
    expect(r.match().mode).toBeUndefined();
    r.advance(DUEL_LIFETIME_MS + 60_000);
    expect(r.engine.exists).toBe(true);
  });
});
