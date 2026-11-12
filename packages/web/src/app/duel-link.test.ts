// Duel links on the page (sprint arm E): the room port makes duel rooms and lets the guest of the device in where a guest may go, a duel
// room that closes by itself says so, the LiveClient reports a score duel's totals and reads the Room's, the score duel's wrapper plays
// the game on the Room's clock and reports what the game shows, the duel events reach their listeners, and the rival's 3D figure is
// placed from the pose alone.
import { describe, expect, it } from 'vitest';
import { LiveClient, type LiveClientOptions } from '../../../core/net/client.ts';
import { ManualScheduler } from '../../../core/net/testkit.ts';
import type { SocketLike } from '../../../core/net/runtime.ts';
import { NET_PROTOCOL, CLOSE, type JoinGrant, type MatchInfo, type MatchResult, type MemberInfo, type RoomInfo, type RoomMessage } from '../../../core/types/net.ts';
import type { Game, GameContext, Hud, InputFrame, RunSummary, StartOptions, StepResult } from '../../../core/types/index.ts';
import { createLiveRoomPort, type Identity } from './live-room.ts';
import { liveFeed } from './live-feed.ts';
import { duelModule, type DuelFeed } from './duel.ts';
import { SCORE_EVERY_MS, scoreDuelGame, STEP_MS } from './score-duel.ts';
import { emitDuel, onDuel, verdictOf, watchDuels, type DuelEvent } from './duel-events.ts';
import { FIGURE_HEIGHT, figurePoints } from './rival-figure.ts';
import { guestPid, guests, parseGuest, type GuestRecord } from '../social/guest.ts';
import type { RoomState } from '../social/port.ts';

const ORIGIN = 'http://127.0.0.1:9';
const ADA: Identity = { pid: 'profile-of-ada-0001', name: 'Ada', age: 'adult' };
const GUEST: Identity = { pid: 'g_guestguestguest0001', name: 'Swift Otter 12', age: 'teen' };

const info = (over: Partial<RoomInfo> = {}): RoomInfo => ({
  code: 'K7P2QX', kind: 'private', size: 2, host: 's1', config: { gameId: 'star-catch', durationMs: 60_000, band: null }, chat: 'preset', video: false, phase: 'lobby',
  duel: { closesAt: Date.now() + 600_000, mode: 'score' }, ...over,
});
const member = (seat: string, name: string, over: Partial<MemberInfo> = {}): MemberInfo => ({ seat, name, host: seat === 's1', online: true, ready: false, sess: `sess-${seat}`, video: false, ...over });
const grantFor = (code: string): JoinGrant => ({ code, link: `${ORIGIN}/r/${code}`, ticket: 'ticket', exp: Math.floor(Date.now() / 1000) + 600, room: { code, kind: 'private', gameId: 'star-catch', size: 2, players: 1, phase: 'lobby', duel: true } });

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  send(data: string): void { if (data !== 'ping') this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.onopen?.({}); }
  say(m: RoomMessage): void { this.onmessage?.({ data: JSON.stringify(m) }); }
  closeFromServer(code: number, reason = ''): void { this.readyState = 3; this.onclose?.({ code, reason }); }
  messages(t: string): Record<string, unknown>[] { return this.sent.filter((m) => m['t'] === t); }
}

function setup(o: { identity?: Identity | null; guest?: Identity | null } = {}) {
  const sched = new ManualScheduler();
  const sockets: FakeSocket[] = [];
  const signed: { url: string; body: Record<string, unknown> }[] = [];
  const plain: { url: string; body: Record<string, unknown> }[] = [];
  const answer = (url: string): Response => {
    const code = /\/api\/rooms\/([A-Z0-9]{6})\/join/.exec(url)?.[1] ?? 'K7P2QX';
    return new Response(JSON.stringify(grantFor(code)), { status: 200 });
  };
  const fetcher = (async (url: string, init?: RequestInit) => { signed.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) }); return answer(String(url)); }) as unknown as typeof fetch;
  const plainFetch = (async (url: string, init?: RequestInit) => { plain.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) }); return answer(String(url)); }) as unknown as typeof fetch;
  const port = createLiveRoomPort({
    origin: ORIGIN,
    identity: () => (o.identity === undefined ? ADA : o.identity),
    guest: () => (o.guest === undefined ? null : o.guest),
    fetcher, plainFetch,
    makeClient: (opts: LiveClientOptions) => new LiveClient({ ...opts, peers: 'none', sched, socket: () => { const s = new FakeSocket(); sockets.push(s); return s; } }),
  });
  const welcome = (s: FakeSocket, room: RoomInfo = info(), match: MatchInfo | null = null, you = 's1'): void => {
    s.open();
    s.say({ t: 'welcome', v: NET_PROTOCOL, you, now: Date.now(), room, members: [member('s1', 'Ada'), member('s2', 'Bo')], match, mine: [], blocked: [] });
  };
  return { port, sched, sockets, signed, plain, welcome };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('the room port and duel links', () => {
  it('makes a duel room: private, two seats, duel: true, signed as the profile', async () => {
    const t = setup();
    const r = await t.port.create({ game: 'star-catch', kind: 'public', size: 4, band: 'easy', duel: true });
    expect(r).toEqual({ ok: true, value: 'K7P2QX' });
    expect(t.signed[0]?.body).toMatchObject({ kind: 'private', size: 2, duel: true, gameId: 'star-catch', band: null, pid: ADA.pid });
    expect(t.plain).toHaveLength(0);
    expect(t.port.state().guest).toBe(false);
  });

  it('a player without a profile makes and joins a duel as the guest of the device, unsigned', async () => {
    const t = setup({ identity: null, guest: GUEST });
    expect((await t.port.create({ game: 'star-catch', kind: 'private', size: 2, band: null, duel: true })).ok).toBe(true);
    expect(t.plain[0]?.body).toMatchObject({ duel: true, pid: GUEST.pid, name: GUEST.name, age: 'teen' });
    expect(t.signed).toHaveLength(0);
    expect(t.port.state().guest).toBe(true);
    t.port.leave();
    expect((await t.port.join('ABCDEF')).ok).toBe(true);
    expect(t.plain[1]?.url).toBe(`${ORIGIN}/api/rooms/ABCDEF/join`);
  });

  it('a guest makes no ordinary room, and without a guest nothing is asked', async () => {
    const t = setup({ identity: null, guest: GUEST });
    expect(await t.port.create({ game: 'star-catch', kind: 'private', size: 4, band: null })).toEqual({ ok: false, code: 'not_allowed' });
    const n = setup({ identity: null, guest: null });
    expect(await n.port.create({ game: 'star-catch', kind: 'private', size: 2, band: null, duel: true })).toEqual({ ok: false, code: 'not_allowed' });
    expect(n.plain.length + n.signed.length).toBe(0);
  });

  it('a duel room that closes at its time ends with the problem "expired"; one that is gone before it is "no_room"', async () => {
    const t = setup();
    await t.port.create({ game: 'star-catch', kind: 'private', size: 2, band: null, duel: true });
    await flush();
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, info({ duel: { closesAt: Date.now() + 5000, mode: 'score' } }));
    s.closeFromServer(CLOSE.NO_ROOM, 'expired');
    expect(t.port.state()).toMatchObject({ phase: 'closed', problem: 'expired' });

    const u = setup();
    await u.port.create({ game: 'star-catch', kind: 'private', size: 2, band: null, duel: true });
    await flush();
    const s2 = u.sockets[0] as FakeSocket;
    u.welcome(s2, info({ duel: { closesAt: Date.now() + 500_000, mode: 'score' } }));
    s2.closeFromServer(CLOSE.NO_ROOM, 'empty');
    expect(u.port.state().problem).toBe('no_room');
  });
});

describe('the LiveClient in a score duel', () => {
  const scoreMatch = (): MatchInfo => ({
    id: 'm1', seed: 7, gameId: 'star-catch', startAt: Date.now() - 1000, duration: 60_000, phase: 'running', pausedAt: null, resumeAt: null, pauseTotal: 0,
    reasons: {}, seats: ['s1', 's2'], forfeited: [], result: null, mode: 'score',
  });

  it('reports the running total and the last one with the final; the rivals\' points are the Room\'s, not the frames\'', async () => {
    const t = setup();
    await t.port.create({ game: 'star-catch', kind: 'private', size: 2, band: null, duel: true });
    await flush();
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, info(), scoreMatch());
    const c = t.port.client() as LiveClient;
    const feed = liveFeed(c);
    expect(feed.duelMode?.()).toBe('score');
    feed.score?.(120.4);
    expect(s.messages('sc')).toEqual([{ t: 'sc', mid: 'm1', v: 120 }]);
    // a frame of the rival that claims a big score changes nothing; the Room's total does
    s.say({ t: 'relay', from: 's2', d: { q: 1, s: 'tab', ts: Date.now(), d: { mt: 1000, sc: 99_999 } } });
    expect(feed.rivals()[0]?.score).toBe(0);
    s.say({ t: 'scores', mid: 'm1', s: { s1: 120, s2: 340 } });
    expect(feed.rivals()).toEqual([{ seat: 's2', name: 'Bo', score: 340 }]);
    feed.finish([], 400);
    expect(s.messages('final')).toEqual([{ t: 'final', mid: 'm1', evs: [], sc: 400 }]);
    // after the final, no more running totals
    feed.score?.(500);
    expect(s.messages('sc')).toHaveLength(1);
    feed.dispose();
  });

  it('sends no running total in a race', async () => {
    const t = setup();
    await t.port.create({ game: 'squat-flap', kind: 'private', size: 2, band: null, duel: true });
    await flush();
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, info({ config: { gameId: 'squat-flap', durationMs: 60_000, band: null }, duel: { closesAt: Date.now() + 600_000, mode: 'race' } }), { ...scoreMatch(), gameId: 'squat-flap', mode: undefined });
    const c = t.port.client() as LiveClient;
    c.reportScore(50);
    expect(s.messages('sc')).toHaveLength(0);
    expect(liveFeed(c).duelMode?.()).toBe('race');
  });
});

// ---- the score duel's wrapper ----

/** A game that scores 10 points a second and ends after `lastsMs` of play (or never). */
function fakeGame(lastsMs = Infinity): Game & { started: StartOptions | null; steps: number } {
  let hud: Hud | null = null;
  let ms = 0;
  let score = 0;
  const g = {
    manifest: { id: 'star-catch', modes: ['solo'] } as unknown as Game['manifest'],
    started: null as StartOptions | null,
    steps: 0,
    async init(ctx: GameContext) { hud = ctx.hud; },
    start(o: StartOptions) { g.started = o; ms = 0; score = 0; },
    step(): StepResult {
      g.steps++;
      ms += STEP_MS;
      const next = Math.floor(ms / 100);
      if (next !== score) { score = next; hud?.set('score', score); }
      return { events: [], phase: ms >= lastsMs ? 'over' : 'running' };
    },
    render() { /* nothing */ },
    snapshot: () => ({ ms, score }),
    restore() { /* nothing */ },
    summary: (): RunSummary => ({ score, seconds: ms / 1000, metSeconds: 0, log: [] }),
    dispose() { /* nothing */ },
  };
  return g;
}

function fakeFeed(durationMs = 10_000) {
  const st = { phase: 'wait' as ReturnType<DuelFeed['phase']>, t: -1000, match: null as ReturnType<DuelFeed['match']> };
  const scores: number[] = [];
  const finals: { results: unknown[]; sc?: number }[] = [];
  const feed: DuelFeed = {
    match: () => st.match,
    time: () => st.t,
    phase: () => st.phase,
    report: () => { throw new Error('a score duel reports no obstacles'); },
    finish: (results, sc) => { finals.push({ results: [...results], ...(sc !== undefined ? { sc } : {}) }); },
    state: () => undefined,
    duelMode: () => 'score',
    score: (v) => { scores.push(v); },
  };
  const go = (): void => { st.match = { id: 'm1', seed: 42, durationMs, gameId: 'star-catch', results: [] }; st.phase = 'run'; st.t = 0; };
  return { st, feed, scores, finals, go };
}

const hudStub = (): Hud & { shown: number[] } => {
  const shown: number[] = [];
  return { shown, set: (slot, v) => { if (slot === 'score' && typeof v === 'number') shown.push(v); }, announce: () => undefined, toast: () => undefined };
};
const input = {} as InputFrame;

describe('the score duel wrapper', () => {
  it('plays nothing before the Room starts the match, then plays the round of the match\'s seed in solo mode', async () => {
    const g = fakeGame();
    const f = fakeFeed();
    const w = scoreDuelGame(g, f.feed);
    const hud = hudStub();
    await w.init({ hud } as unknown as GameContext);
    w.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
    expect(w.step(STEP_MS / 1000, input).phase).toBe('running');
    expect(g.started).toBeNull();
    f.go();
    w.step(STEP_MS / 1000, input);
    expect(g.started).toMatchObject({ seed: 42, mode: 'solo' });
  });

  it('keeps step with the Room\'s time, reports the total at most every 250 ms and the last one at the end of the match', async () => {
    const g = fakeGame();
    const f = fakeFeed(10_000);
    const w = scoreDuelGame(g, f.feed);
    const hud = hudStub();
    await w.init({ hud } as unknown as GameContext);
    w.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
    f.go();
    let phase = 'running';
    for (let ms = 0; ms < 12_000 && phase === 'running'; ms += STEP_MS) {
      f.st.t = ms;
      phase = w.step(STEP_MS / 1000, input).phase;
    }
    expect(phase).toBe('complete');
    // the game's own HUD still shows its points
    expect(hud.shown.length).toBeGreaterThan(50);
    // about four reports a second over ten seconds, never two within 250 ms of play
    expect(f.scores.length).toBeGreaterThan(30);
    expect(f.scores.length).toBeLessThanOrEqual(Math.ceil(10_000 / SCORE_EVERY_MS) + 1);
    expect(f.finals).toEqual([{ results: [], sc: 100 }]);
    expect(w.summary().score).toBe(100);
    expect(w.summary().seconds).toBeLessThanOrEqual(10);
  });

  it('waits while the match is held and ends when the game\'s own round ends first', async () => {
    const g = fakeGame(3000);
    const f = fakeFeed(10_000);
    const w = scoreDuelGame(g, f.feed);
    await w.init({ hud: hudStub() } as unknown as GameContext);
    w.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
    f.go();
    f.st.t = 1000;
    w.step(STEP_MS / 1000, input);
    const before = g.steps;
    f.st.phase = 'hold';
    w.step(STEP_MS / 1000, input);
    expect(g.steps).toBe(before);
    f.st.phase = 'run';
    let phase = 'running';
    for (let ms = 1000; ms < 5000 && phase === 'running'; ms += STEP_MS) { f.st.t = ms; phase = w.step(STEP_MS / 1000, input).phase; }
    expect(phase).toBe('complete');
    expect(f.finals[0]?.sc).toBe(30);
  });

  it('a match the Room ended (the rival left) ends the game with what it has', async () => {
    const g = fakeGame();
    const f = fakeFeed(60_000);
    const w = scoreDuelGame(g, f.feed);
    await w.init({ hud: hudStub() } as unknown as GameContext);
    w.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
    f.go();
    for (let ms = 0; ms < 2000; ms += STEP_MS) { f.st.t = ms; w.step(STEP_MS / 1000, input); }
    f.st.phase = 'over';
    expect(w.step(STEP_MS / 1000, input).phase).toBe('complete');
    expect(f.finals).toHaveLength(1);
    expect(f.finals[0]?.sc).toBeGreaterThan(15);
  });

  it('duelModule picks the score duel\'s wrapper for a score duel and the race\'s for a race', async () => {
    const f = fakeFeed();
    const inner = { manifest: { id: 'x', modes: ['solo'] } as unknown as Game['manifest'], create: () => fakeGame() };
    const scoreGame = duelModule(inner, f.feed).create();
    expect(scoreGame.snapshot()).toBeNull();
    await scoreGame.init({ hud: hudStub() } as unknown as GameContext);
    scoreGame.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
    f.go();
    scoreGame.step(STEP_MS / 1000, input);
    expect((scoreGame.snapshot() as { scoreDuel?: number }).scoreDuel).toBe(1);
    const race = duelModule(inner, { ...f.feed, duelMode: () => 'race' }).create();
    await race.init({ hud: hudStub() } as unknown as GameContext);
    race.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
    race.step(STEP_MS / 1000, input);
    expect((race.snapshot() as { duel?: number }).duel).toBe(1);
  });
});

describe('duel events', () => {
  it('reach every listener, a listener that throws breaks nothing, and the window hears them too', () => {
    const got: DuelEvent[] = [];
    const off1 = onDuel(() => { throw new Error('a broken listener'); });
    const off2 = onDuel((e) => got.push(e));
    const win = new EventTarget() as EventTarget & { CustomEvent?: typeof CustomEvent };
    const heard: unknown[] = [];
    win.addEventListener('bodyarcade:duel', (e) => heard.push((e as CustomEvent).detail));
    const e: DuelEvent = { type: 'duel.created', room: 'K7P2QX', gameId: 'star-catch', mode: 'score', guest: true, at: 1 };
    const err = console.error;
    console.error = () => undefined;
    try { emitDuel(e, win); } finally { console.error = err; }
    expect(got).toEqual([e]);
    expect(heard).toEqual([e]);
    off1(); off2();
  });

  it('say who won from the seat that asks', () => {
    const r: MatchResult = { mid: 'm', reason: 'complete', winner: 's1', places: { s1: 1, s2: 2 }, scores: {}, forfeited: [] };
    expect(verdictOf(r, 's1')).toBe(true);
    expect(verdictOf(r, 's2')).toBe(false);
    expect(verdictOf({ ...r, winner: null }, 's1')).toBeNull();
    expect(verdictOf({ ...r, reason: 'no_contest' }, 's1')).toBeNull();
  });

  it('a duel room joined, a round started and a round finished are told once each', async () => {
    const t = setup();
    const got: DuelEvent[] = [];
    const off = onDuel((e) => got.push(e));
    const stop = watchDuels(t.port);
    await t.port.create({ game: 'star-catch', kind: 'private', size: 2, band: null, duel: true });
    await flush();
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s);
    const m: MatchInfo = { id: 'm1', seed: 7, gameId: 'star-catch', startAt: Date.now() + 3000, duration: 60_000, phase: 'running', pausedAt: null, resumeAt: null, pauseTotal: 0, reasons: {}, seats: ['s1', 's2'], forfeited: [], result: null, mode: 'score' };
    s.say({ t: 'start', match: m });
    s.say({ t: 'start', match: m });
    const result: MatchResult = { mid: 'm1', reason: 'complete', winner: 's2', places: { s2: 1, s1: 2 }, scores: { s1: { score: 300, hits: 0, passes: 0, bestCombo: 0 }, s2: { score: 450, hits: 0, passes: 0, bestCombo: 0 } }, forfeited: [] };
    s.say({ t: 'result', result });
    s.say({ t: 'result', result });
    expect(got.map((e) => e.type)).toEqual(['duel.joined', 'duel.started', 'duel.finished']);
    expect(got[0]).toMatchObject({ room: 'K7P2QX', host: true, mode: 'score', guest: false });
    expect(got[1]).toMatchObject({ match: 'm1', round: 1 });
    expect(got[2]).toMatchObject({ won: false, you: 300, rival: 450, rivalName: 'Bo', reason: 'complete' });
    stop(); off();
  });

  it('an ordinary room tells nothing', async () => {
    const t = setup();
    const got: DuelEvent[] = [];
    const off = onDuel((e) => got.push(e));
    const stop = watchDuels(t.port);
    await t.port.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    await flush();
    const room = info({ size: 4, video: true, chat: 'text' });
    delete room.duel;
    t.welcome(t.sockets[0] as FakeSocket, room);
    expect(got).toEqual([]);
    stop(); off();
  });
});

describe('the rival\'s figure', () => {
  const lm = (pts: Record<number, [number, number]>) => Array.from({ length: 33 }, (_, i) => (pts[i] ? { x: pts[i][0], y: pts[i][1], z: 0, visibility: 1 } : { x: 0, y: 0, z: 0, visibility: 0 }));
  const body = lm({ 0: [0.5, 0.15], 11: [0.42, 0.3], 12: [0.58, 0.3], 13: [0.38, 0.45], 14: [0.62, 0.45], 15: [0.36, 0.58], 16: [0.64, 0.58], 23: [0.45, 0.6], 24: [0.55, 0.6], 25: [0.45, 0.78], 26: [0.55, 0.78], 27: [0.45, 0.95], 28: [0.55, 0.95] });

  it('stands on the floor, is as tall as the figure whatever the distance to the camera, and is mirrored like a self view', () => {
    const near = figurePoints(body) as NonNullable<ReturnType<typeof figurePoints>>;
    const far = figurePoints(lm({ 0: [0.5, 0.4], 11: [0.48, 0.45], 12: [0.52, 0.45], 23: [0.49, 0.55], 24: [0.51, 0.55], 27: [0.49, 0.65], 28: [0.51, 0.65] })) as NonNullable<ReturnType<typeof figurePoints>>;
    for (const f of [near, far]) {
      const ys = [...f.at.values()].map((p) => p[1]);
      expect(Math.min(...ys)).toBeCloseTo(0, 5);
      expect(Math.max(...ys)).toBeCloseTo(FIGURE_HEIGHT * 0.9, 5);
    }
    // the picture's left shoulder (x 0.42) is on the right of the figure, as in a mirror
    expect(near.at.get(11)?.[0] ?? 0).toBeGreaterThan(near.at.get(12)?.[0] ?? 0);
    expect(near.neck).not.toBeNull();
    expect(near.pelvis).not.toBeNull();
    expect(near.span).toBeGreaterThan(0);
  });

  it('is nothing for no pose or too little of one', () => {
    expect(figurePoints(null)).toBeNull();
    expect(figurePoints(lm({ 0: [0.5, 0.2], 11: [0.4, 0.3], 12: [0.6, 0.3] }))).toBeNull();
  });
});

describe('the guest of the device', () => {
  it('keeps one device id for every link, and a stored guest is checked', () => {
    let kept: GuestRecord | null = null;
    const g = guests({ load: () => kept, save: (r) => { kept = r; } }, () => 'g_AAAAAAAAAAAAAAAAAAAAAA');
    expect(g.identity()).toBeNull();
    const a = g.become('teen', 'Swift Otter 12');
    const b = g.become('adult', 'Calm Heron 40');
    expect(a.pid).toBe(b.pid);
    expect(g.identity()).toEqual({ pid: 'g_AAAAAAAAAAAAAAAAAAAAAA', name: 'Calm Heron 40', age: 'adult' });
    expect(parseGuest({ pid: 'g_AAAAAAAAAAAAAAAAAAAAAA', name: 'Calm Heron 40', age: 'child' })).toBeNull();
    expect(parseGuest({ pid: 'x', name: 'Calm Heron 40', age: 'adult' })).toBeNull();
    expect(parseGuest({ pid: 'g_AAAAAAAAAAAAAAAAAAAAAA', name: 'http://spam', age: 'adult' })).toBeNull();
    expect(parseGuest('junk')).toBeNull();
    expect(guestPid()).toMatch(/^g_[A-Za-z0-9_-]{22}$/);
  });
});

void (null as unknown as RoomState);
