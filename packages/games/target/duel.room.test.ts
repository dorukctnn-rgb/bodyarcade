// Reaction Tag raced through the whole chain, in one process and on a manual clock: the real Room engine (server) with a Pro host (Reaction
// Tag is a Pro game; the players who join have no Pro of their own), the real LiveClient with its clock sync (core/net), the shell's race
// feed and game wrapper (web app), and the real Reaction Tag game played by bots through Game.step (their hands go through the real
// handHit detector). What the Room says at the end must be what each device added up for itself.
import { describe, expect, it } from 'vitest';
import type { Game, GameEvent } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { LiveClient } from '../../core/net/client.ts';
import { makeSchedule, scoreOf, specFor } from '../../core/net/schedule.ts';
import type { MatchResult, ObstacleResult } from '../../core/types/net.ts';
import { Net, seeded } from '../../server/src/live/loopkit.ts';
import { Room as RoomKit } from '../../server/src/live/testkit.ts';
import { duelGame } from '../../web/src/app/duel.ts';
import { liveFeed, type LiveFeed } from '../../web/src/app/live-feed.ts';
import { testContext } from '../kit-g1/testing/context.ts';
import { reactionTagModule } from '../reaction-tag/index.ts';
import type { TargetEngine } from './engine.ts';
import type { TargetGame } from './game.ts';
import type { LightSpec } from './reaction-tag.ts';
import { frameOf, VirtualBody } from './testing/body.ts';
import { Chaser, type BotMode } from './testing/bots.ts';
import { seenOf } from './testing/play.ts';
import type { BaseSpec } from './types.ts';

type Inner = TargetGame<LightSpec & BaseSpec>;

/** A Pro room: the host's Pro is verified for far longer than any test lasts. */
const PRO_UNTIL = 4_000_000_000_000;

interface Racer {
  pid: string;
  client: LiveClient;
  feed: LiveFeed;
  inner: Inner;
  game: Game;
  body: VirtualBody;
  chaser: Chaser;
  k: number;
  events: GameEvent[];
  results: MatchResult[];
}

async function racer(net: Net, pid: string, mode: BotMode, botSeed: number, tab?: string): Promise<Racer> {
  const client = new LiveClient({ grant: net.grant(pid), origin: 'http://loop', peers: 'none', sched: net.sched, socket: net.factory, random: seeded(pid + (tab ?? '')), ...(tab ? { tab } : {}) });
  const results: MatchResult[] = [];
  client.on('result', (r) => { results.push(r); });
  void client.start();
  const feed = liveFeed(client);
  const inner = reactionTagModule().create() as unknown as Inner;
  const game = duelGame(inner, feed);
  const t = testContext({ seed: 1 });
  await game.init(t.ctx);
  const body = new VirtualBody({ clockOffset: 5000 + botSeed * 331 });
  // What the shell asks for before any match: the player's own level and body, which a race ignores.
  game.start({ seed: 1, difficulty: 'hard', seated: false, mode: 'duel', profile: body.profile });
  return { pid, client, feed, inner, game, body, chaser: new Chaser(mode, botSeed), k: 0, events: [], results };
}

/** One frame of the page: time moves by one step, then the game is stepped with what the body is doing. */
function frameOfPage(net: Net, rs: readonly Racer[]): void {
  net.run(1000 * FIXED_DT);
  for (const r of rs) {
    const lane = (r.inner.engine as TargetEngine<LightSpec & BaseSpec> | null)?.view().lanes[0];
    if (lane) r.chaser.steer(r.body, seenOf(lane));
    r.k++;
    r.events.push(...r.game.step(FIXED_DT, frameOf(r.k, r.body.step(r.k))).events);
  }
}

async function pair(modes: [BotMode, BotMode], durationMs = 20_000, seeds: [number, number] = [1, 2]): Promise<{ net: Net; a: Racer; b: Racer }> {
  const net = await Net.make({ size: 2, proUntil: PRO_UNTIL, config: { gameId: 'reaction-tag', durationMs, band: null } });
  const a = await racer(net, 'alice-device-01', modes[0], seeds[0]);
  const b = await racer(net, 'bob-device-0002', modes[1], seeds[1]);
  net.run(3000);
  a.client.setReady(true);
  b.client.setReady(true);
  net.run(300);
  return { net, a, b };
}

const reported = (r: Racer): ObstacleResult[] => r.events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));
const bothDone = (rs: readonly Racer[]): boolean => rs.every((r) => r.results.length > 0);

describe('a Pro room', () => {
  it('is made only by a host with Pro; the room starts the Pro game for players who have none', async () => {
    await expect(RoomKit.make({ config: { gameId: 'reaction-tag', durationMs: 20_000, band: null } })).rejects.toThrow(/pro_required/);
    const { net, a, b } = await pair(['perfect', 'perfect']);
    for (let i = 0; i < 60 * 12 && !(a.client.match && b.client.match); i++) frameOfPage(net, [a, b]);
    expect(a.client.match?.gameId).toBe('reaction-tag');
    expect(b.client.match?.gameId).toBe('reaction-tag');
    expect(a.client.room?.pro).toEqual({ ok: true });
    expect(b.client.room?.pro).toEqual({ ok: true });
  });
});

describe('Reaction Tag through the Room', () => {
  it('two players, one match: the Room starts it for both, each device lights the same lights, and the Room scores what the devices tapped', async () => {
    const { net, a, b } = await pair(['perfect', 'sloppy']);
    for (let i = 0; i < 60 * 40 && !bothDone([a, b]); i++) frameOfPage(net, [a, b]);
    expect(a.results).toHaveLength(1);
    expect(b.results).toHaveLength(1);
    const ra = a.results[0] as MatchResult;
    expect(b.results[0]).toEqual(ra);
    expect(ra.reason).toBe('complete');

    const match = a.client.match!;
    const sch = makeSchedule(match.seed, match.duration, specFor('reaction-tag'));
    expect(sch.length).toBeGreaterThan(5);
    // The Room's score of each seat is the one its own device added up from the same outcomes.
    for (const [r, seat] of [[a, 's1'], [b, 's2']] as const) {
      const flown = reported(r);
      expect(flown.map((e) => e.ob)).toEqual([...new Set(flown.map((e) => e.ob))]);
      expect(scoreOf(sch, flown)).toEqual(ra.scores[seat]);
      expect(r.inner.summary().score).toBe(ra.scores[seat]?.score);
    }
    // The same lights on both devices: the plan is the match's, not the player's.
    const planA = (a.inner.engine as TargetEngine<LightSpec>).plan;
    const planB = (b.inner.engine as TargetEngine<LightSpec>).plan;
    expect(planB).toEqual(planA);
    expect(planA.map((l) => l.ob)).toEqual(sch.map((o) => o.id));
    // The better player wins, the other has a lower score.
    expect(ra.winner).toBe('s1');
    expect(ra.scores['s1']?.score ?? 0).toBeGreaterThan(ra.scores['s2']?.score ?? 0);
    expect(ra.places).toEqual({ s1: 1, s2: 2 });
  });

  it('both players leave every light alone: the same nothing and a draw, not a winner picked by who finished first', async () => {
    const { net, a, b } = await pair(['idle', 'idle'], 20_000, [1, 1]);
    for (let i = 0; i < 60 * 40 && !bothDone([a, b]); i++) frameOfPage(net, [a, b]);
    const r = a.results[0] as MatchResult;
    expect(r.reason).toBe('complete');
    expect(r.scores['s1']).toEqual(r.scores['s2']);
    expect(r.scores['s1']).toMatchObject({ score: 0, passes: 0 });
    expect(r.winner).toBeNull();
    expect(r.places).toEqual({ s1: 1, s2: 1 });
  });

  it('standing still is a lost race, not a stuck one: every green light missed, no early end, the other player wins', async () => {
    const { net, a, b } = await pair(['idle', 'perfect']);
    for (let i = 0; i < 60 * 40 && !bothDone([a, b]); i++) frameOfPage(net, [a, b]);
    const r = a.results[0] as MatchResult;
    expect(r.reason).toBe('complete');
    expect(r.winner).toBe('s2');
    expect(r.scores['s1']).toMatchObject({ score: 0, passes: 0 });
    expect(r.scores['s1']?.hits).toBeGreaterThan(3);
    expect(a.events.some((e) => e.type === 'over')).toBe(false);
  });

  it('the clock is the Room\'s: both devices have the same light on at the same match time', async () => {
    const { net, a, b } = await pair(['perfect', 'perfect'], 30_000, [3, 4]);
    for (let i = 0; i < 60 * 20; i++) frameOfPage(net, [a, b]);
    const ea = a.inner.engine as TargetEngine<LightSpec>;
    const eb = b.inner.engine as TargetEngine<LightSpec>;
    expect(a.feed.time()).toBeGreaterThan(8000);
    expect(Math.abs(ea.t - eb.t)).toBeLessThan(120);
    expect(Math.abs(ea.t - a.feed.time())).toBeLessThan(120);
    // The same lights on both: they do not depend on the player.
    expect(ea.plan).toEqual(eb.plan);
    const on = (e: TargetEngine<LightSpec>): number[] => e.view().lanes[0]!.targets.map((t) => (t.spec as LightSpec).ob as number).sort((x, y) => x - y);
    expect(on(ea)).toEqual(on(eb));
  });
});

describe('a page that goes away in the middle of a match', () => {
  it('a reload picks the match up where the Room has it: nothing is played twice, the result is whole', async () => {
    const { net, a, b } = await pair(['perfect', 'perfect'], 40_000, [5, 6]);
    for (let i = 0; i < 60 * 14; i++) frameOfPage(net, [a, b]);
    const before = reported(b);
    expect(before.length).toBeGreaterThan(2);
    // B's page is reloaded: the old page is gone, a new one starts from nothing and joins the running match.
    b.client.stop();
    const b2 = await racer(net, 'bob-device-0002', 'perfect', 6, 'tab-two');
    for (let i = 0; i < 60 * 60 && !bothDone([a, b2]); i++) frameOfPage(net, [a, b2]);
    expect(a.results).toHaveLength(1);
    expect(b2.results).toHaveLength(1);
    const r = a.results[0] as MatchResult;
    expect(b2.results[0]).toEqual(r);
    expect(r.reason).toBe('complete');
    const match = a.client.match!;
    const sch = makeSchedule(match.seed, match.duration, specFor('reaction-tag'));
    const room = net.room.engine.inspect().events['s2'] ?? [];
    // What the old page reported is what the Room still has (the first outcome counts).
    for (const e of before) expect(room.find((x) => x.ob === e.ob)).toEqual(e);
    expect(scoreOf(sch, room)).toEqual(r.scores['s2']);
    expect(r.forfeited).toEqual([]);
  });
});

describe('rooms of three and four', () => {
  it('three players on the same lights: three results on every device, places by score', async () => {
    const net = await Net.make({ size: 3, proUntil: PRO_UNTIL, config: { gameId: 'reaction-tag', durationMs: 30_000, band: null } });
    const modes: BotMode[] = ['perfect', 'sloppy', 'idle'];
    const rs: Racer[] = [];
    for (const [i, mode] of modes.entries()) rs.push(await racer(net, `player-device-0${i}`, mode, i + 1));
    net.run(3000);
    for (const r of rs) r.client.setReady(true);
    net.run(300);
    for (let i = 0; i < 60 * 50 && rs.some((r) => r.results.length === 0); i++) frameOfPage(net, rs);
    const res = rs.map((r) => r.results[0] as MatchResult);
    for (const x of res) expect(x).toEqual(res[0]);
    const r0 = res[0] as MatchResult;
    expect(r0.reason).toBe('complete');
    expect(Object.keys(r0.scores).sort()).toEqual(['s1', 's2', 's3']);
    expect(r0.places['s1']).toBe(1);
    expect(r0.places['s3']).toBe(3);
    expect(r0.scores['s3']?.passes).toBe(0);
    const match = rs[0]!.client.match!;
    const sch = makeSchedule(match.seed, match.duration, specFor('reaction-tag'));
    rs.forEach((r, i) => expect(scoreOf(sch, reported(r))).toEqual(r0.scores[`s${i + 1}`]));
  });
});
