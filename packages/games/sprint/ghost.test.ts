// Knee Sprint raced against a recording, through the shell's race wrapper and the real simulation (see flight/ghost.test.ts).
import { describe, expect, it } from 'vitest';
import type { Game, GameEvent, InputEvent } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { botRun, courseOf, runScore, type GhostRun } from '../../core/net/ghost.ts';
import { GHOST, GhostRace, YOU } from '../../core/net/ghost-race.ts';
import { GhostBook } from '../../core/net/ghost-book.ts';
import { scoreOf } from '../../core/net/schedule.ts';
import { ManualScheduler } from '../../core/net/testkit.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { duelGame } from '../../web/src/app/duel.ts';
import { evt, frame, testContext } from '../kit-g1/testing/context.ts';
import { manifest } from '../knee-sprint/index.ts';
import { createSprintGame, type SprintGame } from './game.ts';
import type { LaneIn } from './sim.ts';
import { sprintBot, type BotKind } from './testing/bot.ts';

const NOBODY: LaneIn = { steps: [], jumps: 0, effort: 0, knees: [0, 0], torso: 1 };
const FORTY = { gameId: 'knee-sprint', seed: 5150, durationMs: 40_000, at: Date.UTC(2026, 9, 24, 12, 0) };

function inputOf(k: number, b: LaneIn): { channels: Record<string, number>; events: InputEvent[] } {
  const events: InputEvent[] = b.steps.map((s) => evt('kneeLift', 'rep', k, { side: s.side || 'L', q: { range: s.k }, value: 110 }));
  for (let i = 0; i < b.jumps; i++) events.push(evt('jump', 'rep', k));
  return { channels: { 'knee.L': b.knees[0], 'knee.R': b.knees[1], 'energy.avg': b.effort, torso: b.torso }, events };
}

async function setup(run: GhostRun, kind: BotKind, o: { book?: GhostBook } = {}) {
  const clock = new ManualScheduler();
  const ghost = new GhostRace(run, { now: () => clock.now(), ...(o.book ? { book: o.book } : {}), name: 'Me' });
  const inner: SprintGame = createSprintGame(manifest, { view: false });
  const game: Game = duelGame(inner, ghost);
  const t = testContext({ seed: 1 });
  await game.init(t.ctx);
  game.start({ seed: 1, difficulty: 'hard', seated: false, mode: 'duel', profile: null });
  const bot = sprintBot(kind, 3);
  const events: GameEvent[] = [];
  let k = 0;
  let pending: LaneIn | null = null;
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

const ran = (events: readonly GameEvent[]): ObstacleResult[] => events.filter((e) => e.type === 'duel').map((e) => ({ ob: e['ob'] as number, k: e['k'] as 'pass' | 'hit' }));

describe('Knee Sprint against a recording', () => {
  it('runs the recording\'s hurdles, ends with the match, and the result is the Room\'s arithmetic on your list and the recording\'s', async () => {
    const run = botRun({ ...FORTY, level: 'medium' });
    const s = await setup(run, 'perfect');
    s.ghost.start();
    let phase = 'running';
    for (let i = 0; i < 60 * 70 && phase === 'running'; i++) phase = s.step();
    expect(phase).toBe('complete');
    const mine = ran(s.events);
    expect(mine.map((e) => e.ob)).toEqual(courseOf(run).map((o) => o.id));
    const res = s.ghost.result()!;
    expect(res.scores[YOU]).toEqual(scoreOf(courseOf(run), mine));
    expect(res.scores[GHOST]).toEqual(runScore(run));
    expect(s.inner.summary().score).toBe(res.scores[YOU]?.score);
    expect(s.inner.summary().cleared).toBe(res.scores[YOU]?.passes);
    expect(s.ghost.outcome()).toMatchObject({ won: true });
    expect(s.inner.state!.t * 1000).toBeGreaterThan(39_000);
    expect(s.inner.state!.t * 1000).toBeLessThan(40_300);
  });

  it('is lost standing still to a practice partner, with no early end', async () => {
    const run = botRun({ ...FORTY, level: 'easy' });
    const s = await setup(run, 'idle');
    s.ghost.start();
    let phase = 'running';
    for (let i = 0; i < 60 * 70 && phase === 'running'; i++) phase = s.step();
    expect(phase).toBe('complete');
    expect(ran(s.events).every((e) => e.k === 'hit')).toBe(true);
    expect(s.ghost.result()?.winner).toBe(GHOST);
    expect(s.events.some((e) => e.type === 'dnf' || e.type === 'over' || e.type === 'out')).toBe(false);
  });

  it('is held with the player (the track stands still) and goes on after the 3-2-1', async () => {
    const run = botRun({ ...FORTY, level: 'medium' });
    const s = await setup(run, 'good');
    s.ghost.start();
    for (let i = 0; i < 60 * 12; i++) s.step();
    const t = s.inner.state!.t, dist = s.inner.state!.lanes[0]!.dist;
    s.ghost.hold(true);
    for (let i = 0; i < 60 * 15; i++) s.step();
    expect(s.inner.state!.t).toBe(t);
    expect(s.inner.state!.lanes[0]!.dist).toBe(dist);
    s.ghost.hold(false);
    let phase = 'running';
    for (let i = 0; i < 60 * 80 && phase === 'running'; i++) phase = s.step();
    expect(phase).toBe('complete');
    expect(ran(s.events)).toHaveLength(courseOf(run).length);
  });

  it('keeps your best and races it next time', async () => {
    const book = new GhostBook({ get: () => null, set: () => undefined });
    const first = await setup(botRun({ ...FORTY, level: 'easy' }), 'perfect', { book });
    first.ghost.start();
    let phase = 'running';
    for (let i = 0; i < 60 * 70 && phase === 'running'; i++) phase = first.step();
    expect(first.ghost.outcome()?.best).toBe('best');
    const mine = book.best('knee-sprint', 40_000)!;
    const second = await setup(mine, 'idle');
    second.ghost.start();
    phase = 'running';
    for (let i = 0; i < 60 * 70 && phase === 'running'; i++) phase = second.step();
    expect(second.ghost.outcome()).toMatchObject({ lost: true });
    expect(second.ghost.outcome()?.ghost).toEqual(first.ghost.outcome()?.you);
  });
});
