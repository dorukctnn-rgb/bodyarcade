// Squat Flap raced against a recording, through the shell's race wrapper and the real simulation: the course is the recording's, the
// clock is local, the game is held while the player is, and the result is the Room's own arithmetic on the two lists.
import { describe, expect, it } from 'vitest';
import type { Game, GameEvent } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { botRun, courseOf, runScore, type GhostRun } from '../../core/net/ghost.ts';
import { GHOST, GhostRace, YOU } from '../../core/net/ghost-race.ts';
import { GhostBook } from '../../core/net/ghost-book.ts';
import { scoreOf } from '../../core/net/schedule.ts';
import { ManualScheduler } from '../../core/net/testkit.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { duelGame } from '../../web/src/app/duel.ts';
import { evt, frame, testContext } from '../kit-g1/testing/context.ts';
import { manifest } from '../squat-flap/index.ts';
import { createFlightGame, type FlightGame } from './game.ts';
import type { LaneIn } from './sim.ts';
import { squatBot, type BotKind } from './testing/bot.ts';

const NOBODY: LaneIn = { flaps: [], drop: 0, glide: false, armed: false };
const THIRTY = { gameId: 'squat-flap', seed: 90210, durationMs: 30_000, at: Date.UTC(2026, 9, 24, 12, 0) };

function inputOf(k: number, b: LaneIn): { channels: Record<string, number>; events: ReturnType<typeof evt>[] } {
  return {
    channels: { drop: b.drop, glide: b.glide ? 1 : 0, armed: b.armed ? 1 : 0 },
    events: b.flaps.map((f) => evt('squat', 'rep', k, { value: f.power, ...(f.depth !== undefined ? { q: { depth: f.depth } } : {}) })),
  };
}

async function setup(run: GhostRun, kind: BotKind, o: { book?: GhostBook; seed?: number } = {}) {
  const clock = new ManualScheduler();
  const ghost = new GhostRace(run, { now: () => clock.now(), ...(o.book ? { book: o.book } : {}), name: 'Me' });
  const inner: FlightGame = createFlightGame(manifest, { view: false });
  const game: Game = duelGame(inner, ghost);
  const t = testContext({ seed: o.seed ?? 1 });
  await game.init(t.ctx);
  game.start({ seed: 1, difficulty: 'hard', seated: false, mode: 'duel', profile: null });
  const bot = squatBot(kind, 3);
  const events: GameEvent[] = [];
  let k = 0;
  let pending: LaneIn | null = null;
  /** One frame of the page: time moves by one step, then the game is stepped with what the body is doing. */
  const step = (): string => {
    clock.advance(1000 * FIXED_DT);
    const s = inner.state;
    const body = pending ?? (s ? bot.next(s, 0, FIXED_DT) : NOBODY);
    const before = s ? s.t : -1;
    const i = inputOf(++k, body);
    const r = game.step(FIXED_DT, frame(k, i.channels, i.events));
    events.push(...r.events);
    const after = inner.state ? inner.state.t : -1;
    pending = after > before ? null : s ? body : null;
    return r.phase;
  };
  return { clock, ghost, inner, game, events, step };
}

const flown = (events: readonly GameEvent[]): ObstacleResult[] => events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));

describe('Squat Flap against a recording', () => {
  it('flies the recording\'s course, ends with the match, and the result is the Room\'s arithmetic on your list and the recording\'s', async () => {
    const run = botRun({ ...THIRTY, level: 'medium' });
    const s = await setup(run, 'perfect');
    s.ghost.start();
    let phase = 'running';
    for (let i = 0; i < 60 * 60 && phase === 'running'; i++) phase = s.step();
    expect(phase).toBe('complete');
    const mine = flown(s.events);
    expect(mine.map((e) => e.ob)).toEqual(courseOf(run).map((o) => o.id));              // one column per obstacle of the recording's course
    const res = s.ghost.result()!;
    expect(res.scores[YOU]).toEqual(scoreOf(courseOf(run), mine));
    expect(res.scores[GHOST]).toEqual(runScore(run));
    expect(s.inner.summary().score).toBe(res.scores[YOU]?.score);
    expect(s.ghost.outcome()).toMatchObject({ won: true, lost: false });
    // the match took the match's time, not more: the game stepped for the length of the recording
    expect(s.inner.state!.t * 1000).toBeGreaterThan(29_000);
    expect(s.inner.state!.t * 1000).toBeLessThan(30_200);
  });

  it('is lost standing still, whatever the level of the partner, and every column counts as a hit', async () => {
    const run = botRun({ ...THIRTY, level: 'easy' });
    const s = await setup(run, 'idle');
    s.ghost.start();
    let phase = 'running';
    for (let i = 0; i < 60 * 60 && phase === 'running'; i++) phase = s.step();
    expect(phase).toBe('complete');
    expect(flown(s.events).every((e) => e.k === 'hit')).toBe(true);
    expect(s.ghost.outcome()).toMatchObject({ won: false, lost: true });
    expect(s.ghost.result()?.winner).toBe(GHOST);
    expect(s.ghost.outcome()?.you.score).toBe(0);
  });

  it('does not move while the player is held, goes on from where it stood after the 3-2-1, and the held time costs nothing', async () => {
    const run = botRun({ ...THIRTY, level: 'medium' });
    const s = await setup(run, 'good');
    s.ghost.start();
    for (let i = 0; i < 60 * 12; i++) s.step();                                          // 3 s of 3-2-1 and 9 s of play
    const before = s.inner.state!.t;
    expect(before).toBeGreaterThan(8);
    s.ghost.hold(true);
    for (let i = 0; i < 60 * 20; i++) s.step();                                          // twenty seconds held (the camera was lost)
    expect(s.inner.state!.t).toBe(before);
    s.ghost.hold(false);
    for (let i = 0; i < 60 * 3 + 5; i++) s.step();                                       // the 3-2-1
    expect(Math.abs(s.inner.state!.t - before)).toBeLessThan(0.2);
    let phase = 'running';
    for (let i = 0; i < 60 * 60 && phase === 'running'; i++) phase = s.step();
    expect(phase).toBe('complete');
    expect(s.inner.state!.t * 1000).toBeLessThan(30_300);
    expect(flown(s.events)).toHaveLength(courseOf(run).length);
  });

  it('keeps your run as your own best, and the next race against it is a race against that run', async () => {
    const book = new GhostBook({ get: () => null, set: () => undefined });
    const first = await setup(botRun({ ...THIRTY, level: 'easy' }), 'perfect', { book });
    first.ghost.start();
    let phase = 'running';
    for (let i = 0; i < 60 * 60 && phase === 'running'; i++) phase = first.step();
    expect(first.ghost.outcome()?.best).toBe('best');
    const mine = book.best('squat-flap', 30_000)!;
    expect(mine).toMatchObject({ source: 'own', name: 'Me', seed: THIRTY.seed });
    // the second race: the same course, the ghost is the first run, standing still loses to it
    const second = await setup(mine, 'idle');
    second.ghost.start();
    phase = 'running';
    for (let i = 0; i < 60 * 60 && phase === 'running'; i++) phase = second.step();
    expect(second.ghost.label.key).toBe('ghost.label.own');
    expect(second.ghost.outcome()).toMatchObject({ lost: true });
    expect(second.ghost.outcome()?.ghost).toEqual(first.ghost.outcome()?.you);
  });

  it('is the same race on any device: two devices with different session streams meet the same columns and the same ghost', async () => {
    const run = botRun({ ...THIRTY, level: 'hard' });
    const a = await setup(run, 'good', { seed: 1 });
    const b = await setup(run, 'good', { seed: 777 });
    a.ghost.start(); b.ghost.start();
    for (let i = 0; i < 60 * 40; i++) { a.step(); b.step(); }
    expect(flown(a.events)).toEqual(flown(b.events));
    expect(a.ghost.result()).toEqual(b.ghost.result());
  });
});
