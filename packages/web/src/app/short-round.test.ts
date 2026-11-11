// A short round: the game is played for its first seconds and ends there, with the short round's own timer on the HUD and a summary cut
// to the time played. A stand-in game holds the rules; the real Twist Turbine through the real session holds the chain.
import { describe, expect, it } from 'vitest';
import { FIXED_DT, type Game, type GameContext, type GameManifest, type Hud, type RunSummary, type StepResult } from '../../../core/types/index.ts';
import { createChain } from '../../../games/kit-g1/testing/chain.ts';
import { twistPerson } from '../../../games/strength/testing/people.ts';
import { manifest as ttManifest, twistTurbineModule } from '../../../games/twist-turbine/index.ts';
import { SHORT_MAX_SEC, SHORT_MIN_SEC, shortGame, shortModule, shortSeconds } from './short-round.ts';

const MANIFEST = { id: 'stand-in', durationSec: 180, met: 3, detectors: [] } as unknown as GameManifest;

/** A game that runs for `ownSec` and scores a point a second; `overAt` ends it early as a loss. */
function standIn(o: { ownSec?: number; overAt?: number } = {}): Game & { timerWrites: unknown[]; steps: number } {
  let ms = 0;
  let ctx: GameContext | null = null;
  const own = (o.ownSec ?? 180) * 1000;
  const g = {
    manifest: MANIFEST,
    timerWrites: [] as unknown[],
    steps: 0,
    async init(c: GameContext) { ctx = c; },
    start() { ms = 0; ctx?.hud.set('timer', 180); ctx?.hud.set('score', 0); },
    step(dt: number): StepResult {
      g.steps++;
      ms += dt * 1000;
      ctx?.hud.set('timer', Math.ceil((own - ms) / 1000));
      if (o.overAt !== undefined && ms >= o.overAt * 1000) return { events: [], phase: 'over' };
      return { events: [], phase: ms >= own ? 'complete' : 'running' };
    },
    render() {},
    snapshot: () => ({ ms }),
    restore: (s: unknown) => { ms = (s as { ms: number }).ms; },
    summary: (): RunSummary => ({ score: Math.round(ms / 1000), seconds: Math.round(own / 1000), metSeconds: 3 * Math.round(own / 1000), log: [] }),
    dispose() {},
  };
  return g;
}

function hud(): Hud & { writes: [string, unknown][] } {
  const writes: [string, unknown][] = [];
  return { writes, set: (slot, v) => { writes.push([slot, v]); }, announce() {}, toast() {} };
}

const ctxWith = (h: Hud): GameContext => ({ hud: h } as unknown as GameContext);

async function play(game: Game, h: Hud, maxSteps = 20_000): Promise<{ phase: string; steps: number }> {
  await game.init(ctxWith(h));
  game.start({ seed: 1, difficulty: 'easy', seated: true, mode: 'solo', profile: null });
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const r = game.step(FIXED_DT, { source: 'pose', players: [] } as never);
    if (r.phase !== 'running') return { phase: r.phase, steps: steps + 1 };
  }
  return { phase: 'running', steps };
}

describe('the length of a short round', () => {
  it('is a whole number of seconds between the bounds, or none', () => {
    expect(shortSeconds(45)).toBe(45);
    expect(shortSeconds(44.6)).toBe(45);
    expect(shortSeconds(SHORT_MIN_SEC - 1)).toBeNull();
    expect(shortSeconds(SHORT_MAX_SEC + 1)).toBeNull();
    for (const x of [undefined, null, '45', Number.NaN, Number.POSITIVE_INFINITY]) expect(shortSeconds(x)).toBeNull();
  });
});

describe('a short round of a game', () => {
  it('ends at its length with "complete", whatever the game would have played', async () => {
    const inner = standIn();
    const { phase, steps } = await play(shortGame(inner, 45), hud());
    expect(phase).toBe('complete');
    expect(steps * FIXED_DT).toBeCloseTo(45, 1);
    // nothing more is played once it is over
    const g = shortGame(standIn(), 20);
    await play(g, hud());
    expect(g.step(FIXED_DT, { source: 'pose', players: [] } as never).phase).toBe('complete');
  });

  it('shows its own time left on the HUD and none of the game\'s, and lets everything else through', async () => {
    const h = hud();
    await play(shortGame(standIn(), 30), h);
    const timers = h.writes.filter(([k]) => k === 'timer').map(([, v]) => v as number);
    expect(timers[0]).toBe(30);
    expect(timers.at(-1)).toBe(0);
    expect(Math.max(...timers)).toBe(30);
    // counted down one second at a time, each second once
    expect(timers).toEqual([...timers].sort((a, b) => b - a));
    expect(new Set(timers).size).toBe(timers.length);
    expect(h.writes.some(([k]) => k === 'score')).toBe(true);
  });

  it('a game that ends first ends the round as it says (a loss stays a loss)', async () => {
    expect((await play(shortGame(standIn({ overAt: 10 }), 45), hud())).phase).toBe('over');
    expect((await play(shortGame(standIn({ ownSec: 20 }), 45), hud())).phase).toBe('complete');
  });

  it('the summary is the game\'s, with the seconds and the time moving cut to what was played', async () => {
    const g = shortGame(standIn(), 45);
    await play(g, hud());
    const s = g.summary();
    expect(s.score).toBe(45);
    expect(s.seconds).toBe(45);
    expect(s.metSeconds).toBe(3 * 45);
  });

  it('a snapshot taken in the round gives the same rest of the round', async () => {
    const a = shortGame(standIn(), 30);
    await a.init(ctxWith(hud()));
    a.start({ seed: 1, difficulty: 'easy', seated: true, mode: 'solo', profile: null });
    for (let i = 0; i < 600; i++) a.step(FIXED_DT, { source: 'pose', players: [] } as never);
    const snap = a.snapshot();
    const b = shortGame(standIn(), 30);
    await b.init(ctxWith(hud()));
    b.start({ seed: 1, difficulty: 'easy', seated: true, mode: 'solo', profile: null });
    b.restore(snap);
    let steps = 0;
    while (b.step(FIXED_DT, { source: 'pose', players: [] } as never).phase === 'running') steps++;
    expect((steps + 1 + 600) * FIXED_DT).toBeCloseTo(30, 1);
  });

  it('the module says the short length in its manifest and leaves the game\'s own manifest alone', () => {
    const m = shortModule(twistTurbineModule(), 45);
    expect(m.manifest.durationSec).toBe(45);
    expect(m.manifest.id).toBe('twist-turbine');
    expect(ttManifest.durationSec).toBe(180);
  });
});

describe('a short round of the real Twist Turbine, seated, through the real session', () => {
  it('ends after its 20 seconds with the twists of those seconds', async () => {
    const chain = createChain({ module: shortModule(twistTurbineModule(structuredClone(ttManifest)), 20), mode: 'solo', difficulty: 'easy', seated: true, people: [twistPerson({ kind: 'perfect', seated: true })], seed: 4 });
    await chain.start();
    const done = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', 90_000);
    expect(chain.seen.errors).toEqual([]);
    expect(done).toBe(true);
    const sum = chain.seen.over[0];
    expect(sum).toBeDefined();
    expect(sum?.seconds).toBeLessThanOrEqual(20);
    expect(sum?.reps ?? 0).toBeGreaterThan(3);
    // the timer the player saw was the short round's: never more than its length
    const timers = chain.hudLog.filter(([k]) => k === 'timer').map(([, v]) => v).filter((v): v is number => typeof v === 'number');
    expect(timers.length).toBeGreaterThan(0);
    expect(Math.max(...timers)).toBeLessThanOrEqual(20);
  }, 120_000);
});
