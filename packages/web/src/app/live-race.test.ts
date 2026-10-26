// The race of a room as the stage plays it (live-race.ts), on the real Room engine and the real LiveClient in one process with a
// manual clock (server/src/live/loopkit.ts): the Session's bridge says ready, the Room starts one race for both pages (the same
// course), each page sees the other's points and skeleton, the game wrapped by duel.ts plays by the Room's time, and both pages
// end with every player's result; then a rematch, a player who walks away from the stage, one who leaves the room in the middle,
// one whose page reloads, and a hold that the other stage names.
import { describe, expect, it } from 'vitest';
import { LiveClient } from '../../../core/net/client.ts';
import { GhostBook } from '../../../core/net/ghost-book.ts';
import { runScore } from '../../../core/net/ghost.ts';
import type { KeyValueStore } from '../../../core/net/identity.ts';
import { bridgeSession } from '../../../core/net/session-bridge.ts';
import type { Obstacle } from '../../../core/net/schedule.ts';
import { FIXED_DT, type Game, type GameContext, type GameEvent, type GameManifest, type Landmark, type SessionEvents, type SessionState, type StartOptions } from '../../../core/types/index.ts';
import type { MatchResult, MemberInfo } from '../../../core/types/net.ts';
import { createI18n } from '../../../core/ui/i18n/index.ts';
import { Net, seeded } from '../../../server/src/live/loopkit.ts';
import { duelGame } from './duel.ts';
import { countOf, liveOutcome, liveSeats, liveSource, stagePhase, type LiveSource } from './live-race.ts';
import { statusOf } from './live-stage.ts';
import type { LiveView } from './live-race.ts';

const memory = (): KeyValueStore => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };

/** A game that keeps the duel promises (duel.ts): it settles each obstacle of the course when its time comes, and completes at the end. */
function courseGame(pass: (ob: number) => boolean): Game {
  let course: readonly Obstacle[] = [];
  let t = 0;
  let dur = 0;
  const done = new Set<number>();
  return {
    manifest: { id: 'squat-flap', modes: ['solo', 'duel'] } as unknown as GameManifest,
    async init() { /* nothing to load */ },
    start(o: StartOptions) { course = o.duel?.schedule ?? []; dur = o.duel?.durationMs ?? 0; t = 0; done.clear(); },
    step(dt: number) {
      t += dt * 1000;
      const events: GameEvent[] = [];
      for (const ob of course) if (ob.t <= t && !done.has(ob.id)) { done.add(ob.id); events.push({ type: 'duel', t, ob: ob.id, k: pass(ob.id) ? 'pass' : 'hit' }); }
      return { events, phase: t >= dur ? 'complete' : 'running' };
    },
    render() { /* nothing to draw */ },
    snapshot: () => null,
    restore() { /* nothing kept */ },
    summary: () => ({ score: 0, seconds: 0, metSeconds: 0, log: [] }),
    dispose() { /* nothing held */ },
  };
}

/** Just enough of a Session for the bridge: its state and its events. */
function fakeSession() {
  const ls = new Map<string, Set<(d: never) => void>>();
  const s = {
    state: 'idle' as SessionState,
    on<K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void) { const set = ls.get(k) ?? new Set(); ls.set(k, set); set.add(cb as (d: never) => void); return () => { set.delete(cb as (d: never) => void); }; },
    go(st: SessionState) { s.state = st; for (const cb of [...(ls.get('state') ?? [])]) cb(st as never); },
  };
  return s;
}

const body = (ms: number): Landmark[] => Array.from({ length: 33 }, (_, i) => ({ x: 0.5 + 0.2 * Math.sin(ms / 300 + i * 0.4), y: 0.08 + 0.84 * (i / 33), z: 0, visibility: 1 }));

interface Page { client: LiveClient; src: LiveSource; game: Game; session: ReturnType<typeof fakeSession>; off: () => void; book: GhostBook; pid: string }

function timers(net: Net) {
  return {
    now: () => net.sched.now(),
    setInterval: (fn: () => void, ms: number) => {
      const h = { id: null as unknown, stopped: false };
      const tick = (): void => { if (h.stopped) return; fn(); h.id = net.sched.setTimeout(tick, ms); };
      h.id = net.sched.setTimeout(tick, ms);
      return h;
    },
    clearInterval: (h: unknown) => { const x = h as { id: unknown; stopped: boolean }; x.stopped = true; net.sched.clearTimeout(x.id); },
    setTimeout: (fn: () => void, ms: number) => net.sched.setTimeout(fn, ms),
    clearTimeout: (h: unknown) => net.sched.clearTimeout(h),
  };
}

function client(net: Net, pid: string, tab?: string): LiveClient {
  const c = new LiveClient({ grant: net.grant(pid), origin: 'http://loop', peers: 'none', sched: net.sched, socket: net.factory, random: seeded(pid + (tab ?? '')), ...(tab ? { tab } : {}) });
  void c.start();
  return c;
}

/** A stage on a page: the source, the wrapped game and the Session's bridge (calibrated: ready at once, like the end of calibration). */
async function stage(net: Net, c: LiveClient, pid: string, o: { pass?: (ob: number) => boolean; standIn?: boolean; book?: GhostBook; ready?: boolean } = {}): Promise<Page> {
  const book = o.book ?? new GhostBook(memory());
  const src = liveSource(c, { room: net.room.code, name: pid.slice(0, 5), book, standIn: o.standIn ?? false, ...timers(net), settleMs: 15_000 });
  const game = duelGame(courseGame(o.pass ?? ((ob) => ob % 3 !== 0)), src.feed);
  await game.init({ hud: { set() { /* the HUD */ }, announce() { /* said */ }, toast() { /* shown */ } } } as unknown as GameContext);
  game.start({ seed: 1, difficulty: 'normal', seated: false, mode: 'duel', profile: null });
  const session = fakeSession();
  const off = bridgeSession(session, src.side);
  session.go('calibrating');
  if (o.ready !== false) session.go('countdown');
  return { client: c, src, game, session, off, book, pid };
}

/** One frame of every page: the clock moves a step, each game steps, the pages with a camera send a body. */
function frame(net: Net, pages: readonly Page[], camera: readonly Page[] = []): void {
  net.run(1000 * FIXED_DT);
  for (const p of pages) p.game.step(FIXED_DT, { t: 0, k: 0, channels: {}, events: [] } as never);
  for (const p of camera) p.src.sendPose?.(body(net.sched.now()));
}

function until(net: Net, pages: readonly Page[], what: () => boolean, maxMs = 60_000, camera: readonly Page[] = []): void {
  for (let t = 0; t < maxMs && !what(); t += 1000 * FIXED_DT) frame(net, pages, camera);
  expect(what()).toBe(true);
}

const results = (c: LiveClient): MatchResult[] => {
  const out: MatchResult[] = [];
  c.on('result', (r) => out.push(r));
  return out;
};

async function room(durationMs = 20_000): Promise<{ net: Net; a: LiveClient; b: LiveClient }> {
  const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs, band: null } });
  const a = client(net, 'alice-device-01');
  const b = client(net, 'bobby-device-02');
  net.run(3000);
  return { net, a, b };
}

describe('a race in a room, from Ready to the result', () => {
  it('starts one race for both pages when both are ready: the same course, the Room\'s 3-2-1, each page sees the other\'s points and skeleton, and both end with every player\'s result', async () => {
    const { net, a, b } = await room();
    const A = await stage(net, a, 'alice-device-01', { pass: (ob) => ob % 4 !== 0 });
    const B = await stage(net, b, 'bobby-device-02', { pass: (ob) => ob % 2 === 0, standIn: true });
    const both = [A, B];
    until(net, both, () => A.src.view().phase === 'count' && B.src.view().phase === 'count', 5000);
    const va = A.src.view();
    const vb = B.src.view();
    expect(va.match).not.toBeNull();
    expect(va.match).toBe(vb.match);
    expect(va.seed).toBe(vb.seed);
    expect(va.count).toBeGreaterThanOrEqual(1);
    expect(va.count).toBeLessThanOrEqual(3);                     // the Room's start count is 3.5 s; the screen says 3, 2, 1
    expect(statusOf(va, createI18n('en'))).toBe(`The race starts in ${va.count}`);
    // the match the game plays is the one both stages show
    expect(A.src.feed.match()?.id).toBe(va.match);
    until(net, both, () => A.src.view().phase === 'run', 5000, [A]);
    // ten seconds in: each sees the other's points move and their skeleton (A's camera, B's stand-in figure)
    for (let i = 0; i < 600; i++) frame(net, both, [A]);
    const ta = A.src.view().tiles;
    const tb = B.src.view().tiles;
    expect(ta).toHaveLength(1);
    expect(tb).toHaveLength(1);
    expect(ta[0]?.pose).not.toBeNull();
    expect(tb[0]?.pose).not.toBeNull();
    expect(ta[0]?.score).toBeGreaterThan(0);
    expect(tb[0]?.score).toBeGreaterThan(0);
    expect(A.src.rivals()[0]?.score).toBe(ta[0]?.score);
    expect(statusOf(A.src.view(), createI18n('en'))).toBe('');
    // the end: both games complete by the Room's time, and both pages get the same result for every player
    const ra = results(a);
    until(net, both, () => ra.length > 0, 30_000, [A]);
    const [oa, ob] = await Promise.all([A.src.settle(), B.src.settle()]);
    const r = ra[0] as MatchResult;
    expect(r.reason).toBe('complete');
    expect(oa?.live?.seats.map((s) => s.score).sort()).toEqual(Object.values(r.scores).map((s) => s.score).sort());
    expect(ob?.live?.seats.map((s) => [s.seat, s.score, s.place])).toEqual(oa?.live?.seats.map((s) => [s.seat, s.score, s.place]));
    const aliceWon = (r.scores[a.you as string]?.score ?? 0) > (r.scores[b.you as string]?.score ?? 0);
    expect(oa?.won).toBe(aliceWon);
    expect(ob?.won).toBe(!aliceWon);
    expect(oa?.you).toBe(r.scores[a.you as string]?.score);
    // a private room sends every run: each one scores what the Room said, and the player's own one went into their book
    for (const s of oa?.live?.seats ?? []) expect(s.run && runScore(s.run).score).toBe(s.score);
    expect(oa?.best).toBe('best');
    expect(A.book.best('squat-flap', 20_000)).not.toBeNull();
    expect(A.src.view().phase).toBe('over');
    expect(statusOf(A.src.view(), createI18n('en'))).toBe('Waiting for the result of the race');
    A.off(); B.off(); A.src.dispose(); B.src.dispose();

    // the rematch: a new stage on each page, ready again, a new race (another match, another course)
    const A2 = await stage(net, a, 'alice-device-01');
    const B2 = await stage(net, b, 'bobby-device-02');
    until(net, [A2, B2], () => A2.src.view().phase === 'run' && B2.src.view().phase === 'run', 8000);
    expect(A2.src.view().match).not.toBe(r.mid);
    expect(A2.src.view().match).toBe(B2.src.view().match);
    until(net, [A2, B2], () => ra.length > 1, 40_000);
    const o2 = await A2.src.settle();
    expect(o2?.live?.seats).toHaveLength(2);
    expect(ra[1]?.mid).toBe(A2.src.view().match);
  });

  it('names who the start waits for, and a player who walks away from the stage before the race began is not ready any more', async () => {
    const { net, a, b } = await room();
    const A = await stage(net, a, 'alice-device-01');
    until(net, [A], () => b.members.find((m: MemberInfo) => m.seat === a.you)?.ready === true, 3000);
    const v = A.src.view();
    expect(v.phase).toBe('wait');
    expect(v.waiting).toEqual([b.members.find((m) => m.seat === b.you)?.name]);
    expect(statusOf(v, createI18n('en'))).toBe(`Waiting for ${v.waiting[0]} to get ready`);
    expect(statusOf(v, createI18n('tr'))).toBe(`${v.waiting[0]} hazırlanıyor, bekleniyor`);
    A.off();
    A.src.dispose();
    net.run(500);
    expect(b.members.find((m) => m.seat === a.you)?.ready).toBe(false);
    // B gets ready alone: nothing starts
    const B = await stage(net, b, 'bobby-device-02');
    until(net, [B], () => a.members.find((m) => m.seat === b.you)?.ready === true, 3000);
    net.run(4000);
    expect(b.match).toBeNull();
    expect(B.src.view().phase).toBe('wait');
  });

  it('a player who leaves the room in the middle forfeits: the race ends at once for the other, who wins', async () => {
    const { net, a, b } = await room(30_000);
    const A = await stage(net, a, 'alice-device-01');
    const B = await stage(net, b, 'bobby-device-02');
    until(net, [A, B], () => A.src.view().phase === 'run', 6000);
    // past the first 30 % of the race (before it, a race that loses a player does not count: no_contest)
    for (let i = 0; i < 720; i++) frame(net, [A, B]);
    B.off(); B.src.dispose();
    b.leave();
    const o = await (async () => { until(net, [A], () => A.src.outcome() !== null, 10_000); return A.src.settle(); })();
    expect(o?.live?.reason).toBe('forfeit');
    expect(o?.won).toBe(true);
    const gone = o?.live?.seats.find((s) => !s.you);
    expect(gone?.forfeited).toBe(true);
    expect(o?.live?.seats[0]?.you).toBe(true);
    // the game on the stage is over too (the Room ended the match for this page)
    expect(A.game.step(FIXED_DT, { t: 0, k: 0, channels: {}, events: [] } as never).phase).toBe('complete');
  });

  it('a page that reloads in the middle joins the same race again and both end with the same result', async () => {
    const { net, a, b } = await room(24_000);
    const A = await stage(net, a, 'alice-device-01');
    const B = await stage(net, b, 'bobby-device-02');
    const ra = results(a);
    until(net, [A, B], () => A.src.view().phase === 'run', 6000);
    for (let i = 0; i < 300; i++) frame(net, [A, B]);
    const mid = A.src.view().match;
    // B's page goes away without leaving (a reload is never a leave) and comes back with a new tab of the same device
    B.off(); B.src.dispose(); b.stop();
    const b2 = client(net, 'bobby-device-02', 'tab-after-reload');
    const rb = results(b2);
    const B2 = await stage(net, b2, 'bobby-device-02', { ready: false });
    until(net, [A, B2], () => b2.match?.id === mid, 5000);
    expect(B2.src.feed.match()?.id).toBe(mid);
    B2.session.go('countdown');
    until(net, [A, B2], () => ra.length > 0 && rb.length > 0, 40_000);
    expect(rb[0]?.mid).toBe(mid);
    expect(rb[0]?.scores).toEqual(ra[0]?.scores);
    const o = await B2.src.settle();
    expect(o?.live?.seats.map((s) => s.score).sort()).toEqual(Object.values(ra[0]?.scores ?? {}).map((s) => s.score).sort());
  });

  it('while another player holds the race the stage says who and why, then the Room counts down again', async () => {
    const { net, a, b } = await room(30_000);
    const A = await stage(net, a, 'alice-device-01');
    const B = await stage(net, b, 'bobby-device-02');
    until(net, [A, B], () => A.src.view().phase === 'run', 6000);
    B.src.side.pause('camera');
    until(net, [A, B], () => A.src.view().phase === 'hold', 3000);
    const v = A.src.view();
    const name = b.members.find((m) => m.seat === b.you)?.name ?? '';
    expect(v.held).toEqual([{ name, reason: 'camera' }]);
    expect(statusOf(v, createI18n('en'))).toBe(`Waiting for the camera of ${name}`);
    B.src.side.unpause('camera');
    until(net, [A, B], () => A.src.view().phase === 'count', 3000);
    until(net, [A, B], () => A.src.view().phase === 'run', 5000);
  });
});

describe('the pure parts', () => {
  const m = { id: 'm1', seed: 5, gameId: 'squat-flap', startAt: 10_000, duration: 30_000, phase: 'running' as const, pausedAt: null, resumeAt: null, pauseTotal: 0, reasons: {}, seats: ['s1', 's2'], forfeited: [] as string[], result: null };

  it('the stage phase follows the match this stage plays', () => {
    expect(stagePhase({ match: null, playing: false, you: 's1' }, 0, null)).toBe('wait');
    expect(stagePhase({ match: m, playing: true, you: 's1' }, 8_000, null)).toBe('count');
    expect(stagePhase({ match: m, playing: true, you: 's1' }, 12_000, null)).toBe('run');
    expect(stagePhase({ match: m, playing: false, you: 's3' }, 12_000, null)).toBe('watch');
    expect(stagePhase({ match: { ...m, phase: 'over' }, playing: false, you: 's1' }, 1e6, 'm1')).toBe('over');
    // the result of an earlier race is not this stage's: it waits for the next one
    expect(stagePhase({ match: { ...m, phase: 'over' }, playing: false, you: 's1' }, 1e6, null)).toBe('wait');
  });

  it('the 3-2-1 is the Room\'s, at the start and after a pause', () => {
    expect(countOf(m, 7_000)).toBe(3);
    expect(countOf(m, 9_001)).toBe(1);
    expect(countOf(m, 10_000)).toBe(0);
    expect(countOf({ ...m, pauseTotal: 9_000, resumeAt: 30_000 }, 28_500)).toBe(2);
    expect(countOf(null, 0)).toBe(0);
  });

  it('every player of a result in order: best first, a draw shares the place, who left comes last; the verdict follows', () => {
    const r: MatchResult = {
      mid: 'm1', reason: 'forfeit', winner: 's1', places: { s1: 1, s2: 2 }, forfeited: ['s3'],
      scores: { s1: { score: 40, hits: 1, passes: 8, bestCombo: 4 }, s2: { score: 20, hits: 3, passes: 4, bestCombo: 2 }, s3: { score: 30, hits: 0, passes: 6, bestCombo: 6 } },
    };
    const seats = liveSeats({ result: r, match: { ...m, seats: ['s1', 's2', 's3'] }, you: 's2', names: new Map([['s1', 'Ada'], ['s3', 'Cem']]), ownName: 'Bo' });
    expect(seats.map((s) => [s.name, s.place, s.forfeited, s.you])).toEqual([['Ada', 1, false, false], ['Bo', 2, false, true], ['Cem', null, true, false]]);
    // no runs: an older Room, or a public room
    expect(seats.every((s) => s.run === null)).toBe(true);
    const o = liveOutcome(r, seats, 'K7P2QX', 'none');
    expect(o).toMatchObject({ kind: 'live', you: 20, won: false, lost: true, draw: false, margin: -20 });
    const draw = liveOutcome({ ...r, reason: 'complete', winner: null, forfeited: [] }, seats.map((s) => ({ ...s, forfeited: false })), 'K7P2QX', 'none');
    expect(draw.draw).toBe(true);
    // a race that lost a player in its first 30 % does not count: nobody won, nobody lost
    const early = liveOutcome({ ...r, reason: 'no_contest', winner: null, places: {} }, seats, 'K7P2QX', 'none');
    expect(early).toMatchObject({ won: false, lost: false, draw: false });
  });

  it('the line of the stage, in both languages', () => {
    const base: LiveView = { phase: 'wait', count: 0, waiting: [], alone: true, held: [], online: true, match: null, seed: null, tiles: [] };
    const en = createI18n('en');
    const tr = createI18n('tr');
    expect(statusOf(base, en)).toBe('Waiting for a second player. Share the link of the room.');
    expect(statusOf({ ...base, alone: false, waiting: ['Ada', 'Cem'] }, en)).toBe('Waiting for 2 players to get ready');
    expect(statusOf({ ...base, alone: false }, en)).toBe('Everyone is ready. The race starts in a moment.');
    expect(statusOf({ ...base, online: false }, en)).toBe('Connection lost. Reconnecting.');
    expect(statusOf({ ...base, phase: 'watch' }, tr)).toBe('Bu odada bir yarış sürüyor. Bir sonrakine katılırsın.');
    expect(statusOf({ ...base, phase: 'hold', held: [{ name: 'Ada', reason: 'framing' }, { name: 'Cem', reason: 'user' }] }, en)).toBe('The race waits for 2 players');
    expect(statusOf({ ...base, phase: 'hold', held: [{ name: 'Ada', reason: 'offline' }] }, tr)).toBe('Ada bağlantısını kaybetti. Yarış bekliyor.');
    expect(statusOf({ ...base, phase: 'run' }, en)).toBe('');
  });
});
