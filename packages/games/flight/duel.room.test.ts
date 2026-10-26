// Squat Flap raced through the whole chain, in one process and on a manual clock: the real Room engine (server), the real
// LiveClient with its clock sync (core/net), the shell's race feed and game wrapper (web app), and the real Squat Flap simulation
// played by bots through Game.step. What the Room says at the end must be what each device added up for itself.
import { describe, expect, it } from 'vitest';
import type { Game, GameEvent } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { LiveClient } from '../../core/net/client.ts';
import { makeSchedule, scoreOf, specFor } from '../../core/net/schedule.ts';
import type { MatchResult, ObstacleResult } from '../../core/types/net.ts';
import { Net, seeded } from '../../server/src/live/loopkit.ts';
import { duelGame } from '../../web/src/app/duel.ts';
import { liveFeed, type LiveFeed } from '../../web/src/app/live-feed.ts';
import { evt, frame, testContext } from '../kit-g1/testing/context.ts';
import { manifest } from '../squat-flap/index.ts';
import { createFlightGame, type FlightGame } from './game.ts';
import type { LaneIn } from './sim.ts';
import { squatBot, type BotKind, type SquatBot } from './testing/bot.ts';

const NOBODY: LaneIn = { flaps: [], drop: 0, glide: false, armed: false };

function inputOf(k: number, b: LaneIn): { channels: Record<string, number>; events: ReturnType<typeof evt>[] } {
  return {
    channels: { drop: b.drop, glide: b.glide ? 1 : 0, armed: b.armed ? 1 : 0 },
    events: b.flaps.map((f) => evt('squat', 'rep', k, { value: f.power, ...(f.depth !== undefined ? { q: { depth: f.depth } } : {}) })),
  };
}

interface Racer {
  pid: string;
  client: LiveClient;
  feed: LiveFeed;
  inner: FlightGame;
  game: Game;
  bot: SquatBot;
  /** The input the bot decided on while the game was not advancing (kept, so a flap is never lost to a held frame). */
  pending: LaneIn | null;
  k: number;
  events: GameEvent[];
  results: MatchResult[];
}

async function racer(net: Net, pid: string, kind: BotKind, botSeed: number, tab?: string): Promise<Racer> {
  const client = new LiveClient({ grant: net.grant(pid), origin: 'http://loop', peers: 'none', sched: net.sched, socket: net.factory, random: seeded(pid + (tab ?? '')), ...(tab ? { tab } : {}) });
  const results: MatchResult[] = [];
  client.on('result', (r) => { results.push(r); });
  void client.start();
  const feed = liveFeed(client);
  const inner = createFlightGame(manifest, { view: false });
  const game = duelGame(inner, feed);
  const t = testContext({ seed: 1 });
  await game.init(t.ctx);
  // What the shell asks for before any match: the player's own level and body, which a race ignores.
  game.start({ seed: 1, difficulty: 'hard', seated: false, mode: 'duel', profile: null });
  return { pid, client, feed, inner, game, bot: squatBot(kind, botSeed), pending: null, k: 0, events: [], results };
}

/** One frame of the page: time moves by one step, then the game is stepped with what the body is doing. */
function frameOf(net: Net, rs: readonly Racer[]): void {
  net.run(1000 * FIXED_DT);
  for (const r of rs) {
    const s = r.inner.state;
    const body = r.pending ?? (s ? r.bot.next(s, 0, FIXED_DT) : NOBODY);
    const before = s ? s.t : -1;
    const i = inputOf(++r.k, body);
    r.events.push(...r.game.step(FIXED_DT, frame(r.k, i.channels, i.events)).events);
    const after = r.inner.state ? r.inner.state.t : -1;
    r.pending = after > before ? null : s ? body : null;
  }
}

async function pair(kinds: [BotKind, BotKind], durationMs = 20_000, seeds: [number, number] = [1, 2]): Promise<{ net: Net; a: Racer; b: Racer }> {
  const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs, band: null } });
  const a = await racer(net, 'alice-device-01', kinds[0], seeds[0]);
  const b = await racer(net, 'bob-device-0002', kinds[1], seeds[1]);
  net.run(3000);
  a.client.setReady(true);
  b.client.setReady(true);
  net.run(300);
  return { net, a, b };
}

const reported = (r: Racer): ObstacleResult[] => r.events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));

describe('Squat Flap through the Room', () => {
  it('two players, one match: the Room starts it for both, each device plays the same columns, and the Room scores what the devices flew', async () => {
    const { net, a, b } = await pair(['perfect', 'sloppy']);
    for (let i = 0; i < 60 * 40 && a.results.length + b.results.length < 2; i++) frameOf(net, [a, b]);
    expect(a.results).toHaveLength(1);
    expect(b.results).toHaveLength(1);
    const ra = a.results[0] as MatchResult;
    expect(b.results[0]).toEqual(ra);
    expect(ra.reason).toBe('complete');

    const match = a.client.match!;
    const sch = makeSchedule(match.seed, match.duration, specFor('squat-flap'));
    expect(sch.length).toBeGreaterThan(5);
    // The Room's score of each seat is the one its own device added up from the same outcomes.
    for (const [r, seat] of [[a, 's1'], [b, 's2']] as const) {
      const flown = reported(r);
      expect(flown.map((e) => e.ob)).toEqual([...new Set(flown.map((e) => e.ob))]);
      expect(scoreOf(sch, flown)).toEqual(ra.scores[seat]);
      expect(r.inner.summary().score).toBe(ra.scores[seat]?.score);
      expect(r.inner.summary().cleared).toBe(ra.scores[seat]?.passes);
    }
    // The better player wins, the other has a lower score.
    expect(ra.winner).toBe('s1');
    expect((ra.scores['s1']?.score ?? 0)).toBeGreaterThan(ra.scores['s2']?.score ?? 0);
    expect(ra.places).toEqual({ s1: 1, s2: 2 });
  });

  it('both players clear everything: the same score and a draw, not a winner picked by who finished first', async () => {
    const { net, a, b } = await pair(['perfect', 'perfect'], 20_000, [1, 1]);
    for (let i = 0; i < 60 * 40 && a.results.length + b.results.length < 2; i++) frameOf(net, [a, b]);
    const r = a.results[0] as MatchResult;
    expect(r.reason).toBe('complete');
    expect(r.scores['s1']).toEqual(r.scores['s2']);
    expect(r.winner).toBeNull();
    expect(r.places).toEqual({ s1: 1, s2: 1 });
  });

  it('standing still is a lost race, not a stuck one: every column hit, no early end, the other player wins', async () => {
    const { net, a, b } = await pair(['idle', 'perfect']);
    for (let i = 0; i < 60 * 40 && a.results.length + b.results.length < 2; i++) frameOf(net, [a, b]);
    const r = a.results[0] as MatchResult;
    expect(r.reason).toBe('complete');
    expect(r.winner).toBe('s2');
    expect(r.scores['s1']).toMatchObject({ score: 0, passes: 0 });
    expect(a.events.some((e) => e.type === 'out' || e.type === 'over')).toBe(false);
  });

  it('the clock is the Room\'s: both devices stand at the same column at the same match time', async () => {
    const { net, a, b } = await pair(['good', 'good'], 30_000, [3, 4]);
    // Run to the middle of the match and compare where the two simulations are.
    for (let i = 0; i < 60 * 20; i++) frameOf(net, [a, b]);
    const ta = a.inner.state!.active, tb = b.inner.state!.active;
    expect(a.feed.time()).toBeGreaterThan(8000);
    expect(Math.abs(ta - tb)).toBeLessThan(0.1);
    expect(Math.abs(ta * 1000 - a.feed.time())).toBeLessThan(120);
    // The same course on both: the columns do not depend on the player.
    expect(a.inner.state!.pipes).toEqual(b.inner.state!.pipes);
  });
});

describe('a page that goes away in the middle of a match', () => {
  it('a reload picks the match up where the Room has it: nothing is played twice, nobody is paused for long, the result is whole', async () => {
    const { net, a, b } = await pair(['good', 'good'], 40_000, [5, 6]);
    for (let i = 0; i < 60 * 14; i++) frameOf(net, [a, b]);
    const before = reported(b);
    expect(before.length).toBeGreaterThan(2);
    // B's page is reloaded: the old page is gone, a new one starts from nothing and joins the running match.
    b.client.stop();
    const b2 = await racer(net, 'bob-device-0002', 'good', 6, 'tab-two');
    for (let i = 0; i < 60 * 60 && a.results.length + b2.results.length < 2; i++) frameOf(net, [a, b2]);
    expect(a.results).toHaveLength(1);
    expect(b2.results).toHaveLength(1);
    const r = a.results[0] as MatchResult;
    expect(b2.results[0]).toEqual(r);
    expect(r.reason).toBe('complete');
    const match = a.client.match!;
    const sch = makeSchedule(match.seed, match.duration, specFor('squat-flap'));
    const room = net.room.engine.inspect().events['s2'] ?? [];
    // What the old page reported is what the Room still has (the first outcome counts), and the Room has one per column.
    for (const e of before) expect(room.find((x) => x.ob === e.ob)).toEqual(e);
    expect(new Set(room.map((e) => e.ob))).toEqual(new Set(sch.map((o) => o.id)));
    expect(scoreOf(sch, room)).toEqual(r.scores['s2']);
    // The player who stayed was never held up by it for more than the Room's own grace.
    expect(r.forfeited).toEqual([]);
  });
});

describe('rooms of three and four', () => {
  it('three players on the same columns: three results on every device, places by score', async () => {
    const net = await Net.make({ size: 3, config: { gameId: 'squat-flap', durationMs: 30_000, band: null } });
    const kinds: BotKind[] = ['perfect', 'good', 'idle'];
    const rs: Racer[] = [];
    for (const [i, kind] of kinds.entries()) rs.push(await racer(net, `player-device-0${i}`, kind, i + 1));
    net.run(3000);
    for (const r of rs) r.client.setReady(true);
    net.run(300);
    for (let i = 0; i < 60 * 50 && rs.some((r) => r.results.length === 0); i++) frameOf(net, rs);
    const res = rs.map((r) => r.results[0] as MatchResult);
    for (const x of res) expect(x).toEqual(res[0]);
    const r0 = res[0] as MatchResult;
    expect(r0.reason).toBe('complete');
    expect(Object.keys(r0.scores).sort()).toEqual(['s1', 's2', 's3']);
    expect(r0.places['s1']).toBe(1);
    expect(r0.places['s3']).toBe(3);
    expect(r0.scores['s3']?.passes).toBe(0);
    const match = rs[0]!.client.match!;
    const sch = makeSchedule(match.seed, match.duration, specFor('squat-flap'));
    rs.forEach((r, i) => expect(scoreOf(sch, reported(r))).toEqual(r0.scores[`s${i + 1}`]));
  });
});
