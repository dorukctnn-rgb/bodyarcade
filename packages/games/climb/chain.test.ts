// Summit Climb with nothing between the body and the game except the camera and the pose model: a synthetic body goes through
// the real calibration, the feature extractor, the movement detectors (pull, knee lift, lean) and the input hub
// (kit-g1/testing/chain.ts). The climber bots look at the game to decide when to climb a ledge and when to lean out of a
// rock's way, so a late detection shows up as a knocked rock or a failed hard part.
import { describe, expect, it } from 'vitest';
import { SHAPE_FULL, SHAPE_UPPER, type RigShape } from '../../core/moves/testing/rig.ts';
import { createChain, type ChainPerson } from '../kit-g1/testing/chain.ts';
import summitClimb from '../summit-climb/index.ts';
import type { ClimbGame } from './game.ts';
import { climberPerson } from './testing/body.ts';

const WIDE: RigShape = { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 };
const UPPER: RigShape = { ...SHAPE_UPPER, aspect: 16 / 9, T: 0.24 };

async function run(o: { people: ChainPerson[]; difficulty?: string; seated?: boolean; quiet?: boolean; maxSec?: number }) {
  const chain = createChain({
    module: summitClimb, mode: 'solo', difficulty: o.difficulty ?? 'easy', ...(o.seated !== undefined ? { seated: o.seated } : {}),
    ...(o.quiet !== undefined ? { quiet: o.quiet } : {}), people: o.people, seed: 3,
  });
  await chain.start();
  const finished = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', (o.maxSec ?? 420) * 1000);
  return { chain, finished, game: chain.game() as ClimbGame };
}

const medals = (g: ClimbGame): string[] => g.state!.c.results.map((r) => r.medal);
const hints = (c: { hudLog: [string, unknown][] }): string[] => c.hudLog.filter(([slot, v]) => slot === 'hint' && v !== '').map(([, v]) => String(v));

describe('Summit Climb, body to game', () => {
  it('a perfect climber in front of the camera: calibrates, counts down, climbs three walls with ledges and gets to the results', async () => {
    const r = await run({ people: [climberPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.chain.seen.states).toEqual(['setup', 'calibrating', 'countdown', 'running', 'results']);
    expect(medals(r.game)).toEqual(['gold', 'gold', 'gold']);
    const sum = r.chain.seen.over[0]!;
    expect(sum.reps).toBeGreaterThan(80);
    expect(sum.score).toBeGreaterThan(500);
    expect(r.game.state!.c.results.every((x) => x.ledges === 1)).toBe(true);
    expect(r.game.state!.c.results.every((x) => x.steps === 4)).toBe(true);
  }, 120_000);

  it('on normal the knees climb the ledges, the lean gets out of the way of the rocks and the hard part is passed in time', async () => {
    const r = await run({ difficulty: 'normal', people: [climberPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(medals(r.game)).toEqual(['gold', 'gold', 'gold']);
    const res = r.game.state!.c.results;
    expect(res.map((x) => x.hits)).toEqual([0, 0, 0]);
    expect(res.reduce((n, x) => n + x.dodged, 0)).toBeGreaterThan(2);
    expect(res.map((x) => x.ledges)).toEqual([2, 2, 2]);
    expect(res.reduce((n, x) => n + x.crux, 0)).toBeGreaterThanOrEqual(2);
    expect(r.chain.seen.over[0]!.hits).toBe(0);
  }, 120_000);

  it('seated, with only the upper body in the picture: the arms climb everything and nothing is stepped', async () => {
    const r = await run({ difficulty: 'normal', seated: true, people: [climberPerson({ kind: 'perfect', seated: true, shape: UPPER })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.game.state!.seated).toBe(true);
    expect(r.game.state!.sections.some((x) => x.kind === 'ledge')).toBe(false);
    expect(medals(r.game)).toEqual(['gold', 'gold', 'gold']);
    expect(r.chain.seen.over[0]!.hits).toBe(0);
    expect(r.game.state!.c.results.every((x) => x.steps === 0)).toBe(true);
  }, 120_000);

  it('the quiet variant climbs with the arms too, and leans out of the way of the rocks', async () => {
    const r = await run({ difficulty: 'normal', quiet: true, people: [climberPerson({ kind: 'perfect', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.game.state!.quiet).toBe(true);
    expect(medals(r.game)).toEqual(['gold', 'gold', 'gold']);
    expect(r.chain.seen.over[0]!.hits).toBe(0);
  }, 120_000);

  it('a good climber who is slower and later out of the way still gets to the top of an easy wall, with a lower score than a perfect one', async () => {
    const perfect = await run({ people: [climberPerson({ kind: 'perfect', shape: WIDE })] });
    const good = await run({ people: [climberPerson({ kind: 'good', shape: WIDE })] });
    expect(good.chain.seen.errors).toEqual([]);
    expect(medals(good.game).every((m) => m === 'gold' || m === 'silver')).toBe(true);
    expect(good.chain.seen.over[0]!.score).toBeLessThan(perfect.chain.seen.over[0]!.score);
  }, 120_000);

  it('a climber who hangs there is called off twice and the run ends with nothing', async () => {
    const r = await run({ people: [climberPerson({ kind: 'idle', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    const sum = r.chain.seen.over[0]!;
    expect(sum.score).toBeLessThan(30);
    expect(sum.reps).toBe(0);
    expect(sum.log.filter((e) => e.kind === 'dnf').length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('a climber whose hand goes up but never high enough gets nowhere and is told to reach higher', async () => {
    const r = await run({ people: [climberPerson({ kind: 'short', shape: WIDE })] });
    expect(r.chain.seen.errors).toEqual([]);
    expect(r.finished).toBe(true);
    // (A lean toward a raised arm can lift the hand into the grip once in a while: a stray pull, not a climb.)
    expect(r.chain.seen.over[0]!.reps).toBeLessThan(4);
    expect(r.chain.seen.over[0]!.score).toBeLessThan(40);
    expect(hints(r.chain)).toContain('Reach higher before you pull');
  }, 120_000);
});
