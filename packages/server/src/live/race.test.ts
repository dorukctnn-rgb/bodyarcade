// LiveRace (the facade a page uses) against the real RoomEngine on the loopback network: the whole flow a player sees,
// from the invite to the rematch, and the things that go wrong on a phone (reload, outage, a second tab, leaving).
import { describe, expect, it } from 'vitest';
import { LiveApiError } from '../../../core/net/api.ts';
import { LiveRace, isRetryable, type RaceEvents, type RaceOptions } from '../../../core/net/race.ts';
import { loadBlocks, loadIdentity, newDeviceId, saveBlocks, saveIdentity, type KeyValueStore } from '../../../core/net/identity.ts';
import { scoreOf } from '../../../core/net/schedule.ts';
import type { Outcome } from '../../../core/types/net.ts';
import { Net, seeded } from './loopkit.ts';

const ORIGIN = 'http://loop';

interface Seen { type: string; detail: unknown }
interface Racer { race: LiveRace; seen: Seen[]; all<K extends keyof RaceEvents>(type: K): RaceEvents[K][]; states(): string[] }

const EVENTS: (keyof RaceEvents)[] = ['state', 'lobby', 'start', 'pause', 'forfeit', 'ghost', 'finished', 'result', 'connection', 'closed', 'chat', 'preset', 'react', 'chatRejected', 'blocked', 'reported', 'removed', 'track', 'roomError'];

function memoryBlocks(): { load(): string[]; save(k: string[]): void; saved: string[][] } {
  const saved: string[][] = [];
  return { load: () => saved.at(-1) ?? [], save: (k) => { saved.push(k.slice()); }, saved };
}

function record(race: LiveRace): Racer {
  const seen: Seen[] = [];
  for (const t of EVENTS) race.on(t, (detail) => { seen.push({ type: t, detail }); });
  return {
    race, seen,
    all: (type) => seen.filter((x) => x.type === type).map((x) => x.detail) as never,
    states: () => seen.filter((x) => x.type === 'state').map((x) => (x.detail as RaceEvents['state']).state),
  };
}

function who(pid: string, name = pid.slice(0, 5)): { pid: string; name: string; age: 'adult' } {
  return { pid, name, age: 'adult' };
}

async function racer(net: Net, pid: string, over: Partial<RaceOptions> = {}): Promise<Racer> {
  const race = await LiveRace.attach(net.grant(pid), {
    who: who(pid), origin: ORIGIN, peers: 'none', pauseWhenHidden: false, blocks: memoryBlocks(),
    client: { sched: net.sched, socket: net.factory, random: seeded(pid) }, ...over,
  });
  return record(race);
}

/** Both players ready; returns once the countdown is running. */
async function readyPair(net: Net): Promise<{ a: Racer; b: Racer }> {
  const a = await racer(net, 'alice-device-01'); const b = await racer(net, 'bob-device-0002');
  net.run(1500);
  a.race.ready(); b.race.ready();
  net.run(400);
  return { a, b };
}

/** Plays the whole course: `pick` says what each player does with each obstacle. Ends after the final lists went in. */
function play(net: Net, rs: Racer[], pick: (seat: string, ob: number) => Outcome): void {
  const first = rs[0] as Racer;
  const m = first.race.match as NonNullable<typeof first.race.match>;
  net.run(m.startAt - net.room.host.now());
  for (const o of first.race.course) {
    net.run(Math.max(0, m.startAt + o.t - net.room.host.now()));
    for (const r of rs) r.race.report(o.id, pick(r.race.you as string, o.id));
  }
  net.run(Math.max(0, m.startAt + m.duration - net.room.host.now()) + 3000);
}

describe('the flow of a race', () => {
  it('hosts, joins by link, readies up, races and ends with the same result on both sides', async () => {
    const net = await Net.make();
    const asked: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      asked.push({ url, body });
      return new Response(JSON.stringify(net.grant(String(body.pid))), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const common = { origin: ORIGIN, peers: 'none' as const, pauseWhenHidden: false, fetcher, client: { sched: net.sched, socket: net.factory } };
    const a = record(await LiveRace.host({ ...common, who: who('alice-device-01'), gameId: 'squat-flap', durationMs: 30_000, client: { ...common.client, random: seeded('a') } }));
    expect(asked[0]).toMatchObject({ url: `${ORIGIN}/api/rooms`, body: { kind: 'private', gameId: 'squat-flap', size: 2, durationMs: 30_000, pid: 'alice-device-01' } });
    expect(a.race.state).toBe('connecting');
    net.run(500);
    expect(a.race.state).toBe('lobby');
    expect(a.race.invite.link).toBe(`${ORIGIN}/r/${net.room.code}`);
    expect(a.race.invite.qrSvg({ label: 'invite' }).startsWith('<svg')).toBe(true);
    expect(a.race.isHost).toBe(true);
    const b = record(await LiveRace.join({ ...common, who: who('bob-device-0002'), invite: ` ${a.race.invite.link}?utm=x `, client: { ...common.client, random: seeded('b') } }));
    expect(asked[1]?.url).toBe(`${ORIGIN}/api/rooms/${net.room.code}/join`);
    net.run(500);
    const view = b.all('lobby').at(-1);
    expect(view).toMatchObject({ you: 's2', isHost: false, allReady: false, openSeats: 0, watching: false });
    expect(view?.members.map((m) => m.name)).toEqual(['alice-device-01', 'bob-device-0002']);          // names come from the signed ticket
    expect(a.all('lobby').at(-1)?.members).toHaveLength(2);

    a.race.ready();
    net.run(300);
    expect(a.all('lobby').at(-1)?.allReady).toBe(false);
    b.race.ready();
    net.run(300);
    expect(a.race.state).toBe('countdown');
    expect(a.race.countdownMs()).toBeGreaterThan(2000);
    expect(a.race.time()).toBe(0);
    const started = a.all('start')[0];
    expect(started?.resumed).toBe(false);
    expect(started?.course.length).toBeGreaterThan(5);
    expect(b.all('start')[0]?.course).toEqual(started?.course);

    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now() + 500);
    expect(a.race.state).toBe('racing');
    expect(a.race.countdownMs()).toBe(0);
    expect(a.race.time()).toBeGreaterThan(300);

    play(net, [a, b], (seat, ob) => (seat === 's1' ? (ob % 4 === 0 ? 'hit' : 'pass') : 'pass'));
    for (const r of [a, b]) {
      expect(r.all('finished')).toHaveLength(1);
      expect(r.race.state).toBe('result');
      expect(r.all('result')).toHaveLength(1);
    }
    const ra = a.all('result')[0] as RaceEvents['result']; const rb = b.all('result')[0] as RaceEvents['result'];
    expect(ra.result).toEqual(rb.result);
    expect(ra.result.reason).toBe('complete');
    expect(ra).toMatchObject({ you: 's1', won: false, draw: false, forfeited: false, place: 2 });
    expect(rb).toMatchObject({ you: 's2', won: true, draw: false, place: 1 });
    expect(a.race.score()).toEqual(ra.score);                    // the page's own count is the Room's count
    expect(scoreOf(a.race.course, [...a.race.reported].map(([ob, k]) => ({ ob, k }))).score).toBe(ra.score?.score);
    expect(a.states()).toEqual(['lobby', 'countdown', 'racing', 'settling', 'result']);          // (it began as 'connecting', which is not a change)
  });

  it('rematch: ready again after the result starts a new match with a new seed and a clean slate', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const seed1 = (a.race.match as NonNullable<typeof a.race.match>).seed;
    play(net, [a, b], () => 'pass');
    expect(a.race.state).toBe('result');
    expect(a.race.reported.size).toBeGreaterThan(5);
    a.race.rematch();
    expect(a.race.state).toBe('lobby');                          // the result screen is dismissed by the player's own press
    net.run(300);
    b.race.rematch();
    net.run(400);
    expect(a.race.state).toBe('countdown');
    expect((a.race.match as NonNullable<typeof a.race.match>).seed).not.toBe(seed1);
    expect(a.race.reported.size).toBe(0);
    expect(a.race.time()).toBe(0);
    play(net, [a, b], (seat) => (seat === 's1' ? 'pass' : 'hit'));
    expect(a.all('result')).toHaveLength(2);
    expect(a.all('result')[1]).toMatchObject({ won: true, place: 1 });
    expect(b.all('result')[1]).toMatchObject({ won: false, place: 2 });
  });

  it('keeps the first outcome per obstacle, refuses unknown obstacles and reports after the end', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now() + 4000);
    const o = a.race.course[0] as NonNullable<(typeof a.race.course)[number]>;
    expect(a.race.report(o.id, 'pass')).toBe(true);
    expect(a.race.report(o.id, 'hit')).toBe(false);
    expect(a.race.reported.get(o.id)).toBe('pass');
    expect(a.race.report(9999, 'pass')).toBe(false);
    play(net, [a, b], () => 'pass');
    expect(a.race.report(o.id, 'pass')).toBe(false);
    expect(a.race.score().score).toBe(b.race.score().score);
  });
});

describe('pauses, the 3-2-1 and a clock that never goes back', () => {
  it('a pause held by the rival shows as paused here, the resume shows the 3-2-1 and the race clock never steps back', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now() + 8000);
    const before = a.race.time();
    expect(before).toBeGreaterThan(7000);
    b.race.pause('user');
    net.run(400);
    expect(a.race.state).toBe('paused');
    expect(a.all('pause').at(-1)).toMatchObject({ paused: true, reasons: { s2: 'user' } });
    const frozen = a.race.time();
    net.run(2000);
    expect(a.race.time()).toBe(frozen);
    b.race.unpause('user');
    net.run(300);
    expect(a.race.state).toBe('countdown');                       // the 3-2-1
    expect(a.race.countdownMs()).toBeGreaterThan(1500);
    let last = a.race.time();
    for (let i = 0; i < 50; i++) { net.run(100); const t = a.race.time(); expect(t).toBeGreaterThanOrEqual(last); last = t; }
    expect(a.race.state).toBe('racing');
    expect(a.race.time()).toBeGreaterThan(frozen);
    expect(a.all('pause').at(-1)).toMatchObject({ paused: false });
    expect(a.race.rawMatchTime()).toBeLessThanOrEqual(a.race.time());
  });
});

describe('a page that comes back', () => {
  it('a reload mid-match rejoins the same match with what the Room already holds, and finishes it', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now());
    const course = a.race.course;
    for (const o of course.slice(0, 3)) { net.run(Math.max(0, m.startAt + o.t - net.room.host.now())); a.race.report(o.id, 'pass'); b.race.report(o.id, 'pass'); }
    net.run(500);
    a.race.dispose();                                             // the page is gone: no bye, no close frame
    expect(a.race.state).toBe('closed');
    const a2 = await racer(net, 'alice-device-01');
    net.run(600);
    expect(a2.all('start')[0]).toMatchObject({ resumed: true });
    expect(a2.race.reported.size).toBe(3);                        // the Room's copy
    expect(a2.race.state === 'racing' || a2.race.state === 'countdown').toBe(true);
    expect(a2.race.course).toEqual(course);
    for (const o of course.slice(3)) { net.run(Math.max(0, m.startAt + o.t - net.room.host.now())); a2.race.report(o.id, 'pass'); b.race.report(o.id, 'pass'); }
    net.run(Math.max(0, m.startAt + m.duration - net.room.host.now()) + 3000);
    expect(a2.all('result')).toHaveLength(1);
    expect(a2.all('result')[0]?.result).toEqual(b.all('result')[0]?.result);
    expect(a2.all('result')[0]?.result.reason).toBe('complete');
  });

  it('a page that opens after the match ended is in the lobby, not on a result screen it never played', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    play(net, [a, b], () => 'pass');
    const c = await racer(net, 'carol-device-03');                // a third device with no seat: the room has 2 seats
    net.run(500);
    expect(c.race.state === 'closed' || c.race.state === 'lobby').toBe(true);
    // a player whose page reloaded after the match still sees its result
    a.race.dispose();
    const a2 = await racer(net, 'alice-device-01');
    net.run(600);
    expect(a2.race.state).toBe('result');
    expect(a2.all('result')[0]?.result).toEqual(b.all('result')[0]?.result);
    a2.race.rematch();
    expect(a2.race.state).toBe('lobby');
  });
});

describe('the connection', () => {
  it('tells the page when the connection is lost and when it is back, and the match goes on', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now() + 2000);
    net.blackhole = true;
    for (const s of net.sockets.filter((x) => x.pid === 'bob-device-0002')) s.kill();
    net.run(1000);
    expect(b.all('connection')[0]).toMatchObject({ online: false });
    expect(b.race.offlineMs()).toBeGreaterThan(500);
    net.run(7000);
    expect(a.race.state).toBe('paused');                          // the Room paused for the missing player
    net.blackhole = false;
    net.run(9000);
    const back = b.all('connection').find((x) => x.online);
    expect(back).toBeDefined();
    expect(back?.offlineMs).toBeGreaterThan(7000);
    expect(b.race.offlineMs()).toBe(0);
    expect(a.race.state === 'countdown' || a.race.state === 'racing').toBe(true);
  });

  it('leaving on purpose closes this side and forfeits the seat; a second tab takes the seat from the first', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now() + 12_000);
    b.race.leave();
    expect(b.race.state).toBe('closed');
    expect(b.all('closed')[0]).toMatchObject({ reason: 'left' });
    net.run(600);
    expect(a.all('forfeit')[0]).toMatchObject({ seat: 's2', mine: false });
    expect(a.all('result')[0]).toMatchObject({ won: true, place: 1 });
    expect(a.all('result')[0]?.result.reason).toBe('forfeit');

    const net2 = await Net.make();
    const { a: a2 } = await readyPair(net2);
    const twin = await racer(net2, 'alice-device-01', { client: { sched: net2.sched, socket: net2.factory, random: seeded('twin'), tab: 'second-tab' } });
    net2.run(600);
    expect(a2.all('closed')[0]).toMatchObject({ reason: 'replaced' });
    expect(a2.race.state).toBe('closed');
    expect(twin.race.state).not.toBe('closed');
  });
});

describe('the ghost, blocks and the helpers around them', () => {
  it('sends the ghost at most about 15 times a second and delivers it to the rival', async () => {
    const net = await Net.make();
    const { a, b } = await readyPair(net);
    const m = a.race.match as NonNullable<typeof a.race.match>;
    net.run(m.startAt - net.room.host.now() + 1000);
    let sent = 0;
    for (let i = 0; i < 100; i++) { net.run(10); if (a.race.sendGhost({ n: i })) sent++; }      // 100 attempts in one second
    net.run(300);
    expect(sent).toBeGreaterThanOrEqual(14);
    expect(sent).toBeLessThanOrEqual(17);
    expect(b.all('ghost')).toHaveLength(sent);
    expect(b.all('ghost')[0]).toMatchObject({ from: 's1', path: 'relay' });
    expect(a.race.sendGhost({ n: 1 })).toBe(true);
    net.run(100);
    play(net, [a, b], () => 'pass');
    expect(a.race.sendGhost({ n: 2 })).toBe(false);                // not after the match
  });

  it('keeps block keys the device is given', async () => {
    const net = await Net.make();
    const store = memoryBlocks();
    const a = await racer(net, 'alice-device-01', { blocks: store });
    const b = await racer(net, 'bob-device-0002');
    net.run(800);
    a.race.block('s2');
    net.run(300);
    expect(a.all('blocked')).toEqual([{ seat: 's2' }]);
    expect(store.saved.at(-1)).toHaveLength(1);
    expect(b.race.state).toBe('lobby');
  });

  it('refuses a bad invite at once, previews through the same code reader and tells which failures are worth a retry', async () => {
    await expect(LiveRace.join({ who: who('alice-device-01'), invite: 'not a code', origin: ORIGIN })).rejects.toMatchObject({ status: 400, code: 'bad_code' });
    await expect(LiveRace.preview('https://x/r/0O1I23', { origin: ORIGIN })).rejects.toMatchObject({ code: 'bad_code' });
    const fetcher = (async (url: string) => new Response(JSON.stringify({ code: 'K7P2QX', kind: 'private', gameId: 'squat-flap', size: 2, players: 1, phase: 'lobby' }), { status: 200, headers: { 'Content-Type': 'application/json' }, ...(url ? {} : {}) })) as unknown as typeof fetch;
    await expect(LiveRace.preview('k7p 2qx', { origin: ORIGIN, fetcher })).resolves.toMatchObject({ gameId: 'squat-flap', players: 1 });
    expect(isRetryable(new LiveApiError(0, 'timeout'))).toBe(true);
    expect(isRetryable(new LiveApiError(503, 'room_unavailable'))).toBe(true);
    expect(isRetryable(new LiveApiError(429, 'rate_limited'))).toBe(true);
    expect(isRetryable(new LiveApiError(409, 'full'))).toBe(false);
    expect(isRetryable(new LiveApiError(404, 'no_room'))).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
  });

  it('a full room closes the second joiner with the reason full', async () => {
    const net = await Net.make({ size: 2 });
    const a = await racer(net, 'alice-device-01'); const b = await racer(net, 'bob-device-0002');
    net.run(800);
    const c = await racer(net, 'carol-device-03');
    net.run(800);
    expect(c.race.state).toBe('closed');
    expect(c.all('closed')[0]).toMatchObject({ reason: 'full' });
    expect(a.race.state).toBe('lobby'); expect(b.race.state).toBe('lobby');
  });
});

describe('the device identity', () => {
  function store(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
  }

  it('asks for a name and an age once, keeps the device id and filters the name like the Room does', () => {
    const st = store();
    expect(loadIdentity(st)).toBeNull();
    expect(saveIdentity({ name: '   ', age: 'adult' }, st)).toEqual({ ok: false, problem: 'name_empty' });
    expect(saveIdentity({ name: 'x'.repeat(40), age: 'adult' }, st)).toEqual({ ok: false, problem: 'name_too_long' });
    expect(saveIdentity({ name: 'call me 555 123 4567', age: 'adult' }, st)).toMatchObject({ ok: false, problem: 'name_not_allowed' });
    expect(saveIdentity({ name: 'Sam', age: null }, st)).toEqual({ ok: false, problem: 'age_missing' });
    const r1 = saveIdentity({ name: ' Sam ', age: 'teen' }, st);
    expect(r1.ok).toBe(true);
    const id1 = loadIdentity(st);
    expect(id1).toMatchObject({ name: 'Sam', age: 'teen' });
    expect(id1?.pid).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const r2 = saveIdentity({ name: 'Sammy', age: 'teen' }, st);
    expect(r2.ok && r2.identity.pid).toBe(id1?.pid);
    st.data.set('ba.live.identity.v1', '{broken');
    expect(loadIdentity(st)).toBeNull();
    expect(newDeviceId()).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(newDeviceId()).not.toBe(newDeviceId());
  });

  it('keeps block keys, tolerates damaged storage and caps the list', () => {
    const st = store();
    expect(loadBlocks(st)).toEqual([]);
    saveBlocks(['k1', 'k2'], st);
    expect(loadBlocks(st)).toEqual(['k1', 'k2']);
    st.data.set('ba.live.blocks.v1', 'nope');
    expect(loadBlocks(st)).toEqual([]);
    saveBlocks(Array.from({ length: 500 }, (_, i) => `k${i}`), st);
    expect(loadBlocks(st)).toHaveLength(200);
  });
});
