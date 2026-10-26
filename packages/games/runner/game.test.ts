// Runner template A on the Game contract: same results as the simulation, pure fixed steps, snapshot and restore,
// input mapping, the seated variant, HUD, summary, the manifest, and a whole run through the Session.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AudioApi, GameContext, GameEvent, InputEvent, InputFrame, Rng, StartOptions } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { stepTime } from '../../core/loop/clock.ts';
import { createSession } from '../../core/loop/session.ts';
import roadRun, { manifest } from '../road-run/index.ts';
import { buildCourse, Run, type RunInput } from './sim.ts';
import { createRunnerGame, type RunnerGame } from './game.ts';
import { botAction, type BotMode } from './testing/bot.ts';

function context(seed: number, hudLog: [string, unknown][] = [], t: GameContext['t'] = (k) => k): GameContext {
  const streams = new Map<string, Rng>();
  return {
    pose: {} as GameContext['pose'],
    input: {} as GameContext['input'],
    hud: { set: (slot, v) => { hudLog.push([slot, v]); }, announce() {}, toast() {} },
    audio: {} as AudioApi,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
    rng: (name) => { let s = streams.get(name); if (!s) { s = rngStream(seed, name); streams.set(name, s); } return s; },
    flags: { reducedMotion: false, silent: false, seated: false },
    t,
  };
}

const START = (o: Partial<StartOptions> = {}): StartOptions => ({ seed: 1, difficulty: 'medium', seated: false, mode: 'solo', profile: null, ...o });

function frame(k: number, channels: Record<string, number>, events: InputEvent[] = []): InputFrame {
  return { t: stepTime(k), source: 'test', tracking: { ok: true }, channels, events };
}

/** Plays a run with the bot through Game.step; returns the summary and every game event. */
async function playGame(seed: number, diff: string, mode: BotMode, o: { seated?: boolean; steps?: number; game?: RunnerGame; from?: number } = {}) {
  const game = o.game ?? createRunnerGame(manifest);
  if (!o.game) { await game.init(context(seed)); game.start(START({ seed, difficulty: diff, seated: o.seated ?? false })); }
  const events: GameEvent[] = [];
  let k = o.from ?? 0;
  let phase = 'running';
  while (phase === 'running' && k < (o.steps ?? 100_000)) {
    const a = botAction(game.run as Run, mode);
    const ev: InputEvent[] = a.jump ? [{ id: 'jump', kind: 'rep', t: stepTime(k + 1), source: 'test' }] : [];
    const r = game.step(FIXED_DT, frame(++k, { lane: a.lane, crouch: a.crouch }, ev));
    events.push(...r.events);
    phase = r.phase;
  }
  return { game, events, summary: game.summary(), k, phase };
}

/** The same run on the bare simulation (course from the same stream). */
function playSim(seed: number, diff: string, mode: BotMode) {
  const run = new Run({ diff, duration: manifest.durationSec, seed: 0, course: buildCourse(rngStream(seed, 'course'), diff, manifest.durationSec) });
  let jump = false;
  const input: RunInput = { lane: 0, crouch: 0, consumeJump: () => { const j = jump; jump = false; return j; } };
  while (run.phase === 'running') {
    const a = botAction(run, mode);
    input.lane = a.lane; input.crouch = a.crouch; if (a.jump) jump = true;
    run.update(FIXED_DT, input);
  }
  return run.summary();
}

describe('runner template A', () => {
  it.each(['easy', 'medium', 'hard', 'insane'])('%s: the game gives exactly the simulation result for the same course and moves', async (diff) => {
    for (const seed of [3, 77]) {
      const g = await playGame(seed, diff, 'perfect');
      const sim = playSim(seed, diff, 'perfect');
      expect(g.summary.score).toBe(sim.score);
      expect([g.summary.cleared, g.summary.hits, g.summary.bestStreak]).toEqual([sim.cleared, sim.hits, sim.bestCombo]);
    }
  });

  it('a 90 s run lasts 90 s of fixed steps; metSeconds is MET x seconds; the log holds every pass, hit and coin', async () => {
    const g = await playGame(5, 'medium', 'perfect');
    expect(g.phase).toBe('complete');
    // The simulation adds 1/60 s per step in floating point (as today), so the 90th second ends on step 5400 or 5401.
    expect([5400, 5401]).toContain(g.k);
    expect(g.summary.seconds).toBeCloseTo(90, 1);
    expect(g.summary.metSeconds).toBeCloseTo(6 * g.summary.seconds, 0);
    expect(g.summary.log.some((e) => e.kind === 'coin')).toBe(true);
    expect(g.summary.log.filter((e) => e.kind !== 'coin' && e.ok).length).toBe(g.summary.cleared);
    expect(g.summary.log.filter((e) => !e.ok).length).toBe(g.summary.hits);
  });

  it('the same seed and moves give the same events; another seed another course', async () => {
    const a = await playGame(11, 'hard', 'late');
    const b = await playGame(11, 'hard', 'late');
    const c = await playGame(12, 'hard', 'late');
    expect(b.events).toEqual(a.events);
    expect(c.events).not.toEqual(a.events);
  });

  it('restore(snapshot()) continues identically, in a new game instance too', async () => {
    const first = await playGame(21, 'medium', 'perfect', { steps: 2000 });
    const snap = JSON.parse(JSON.stringify(first.game.snapshot()));
    const rest = await playGame(21, 'medium', 'perfect', { game: first.game, from: 2000 });
    const other = createRunnerGame(manifest);
    await other.init(context(999));
    other.restore(snap);
    const again = await playGame(21, 'medium', 'perfect', { game: other, from: 2000 });
    expect(rest.events.length).toBeGreaterThan(50);
    expect(again.events).toEqual(rest.events);
    expect(again.summary).toEqual(rest.summary);
  });

  it('input: the lane channel is rounded and clamped, crouch clamped, a jump needs a jump event', async () => {
    const game = createRunnerGame(manifest);
    await game.init(context(1));
    game.start(START());
    for (let k = 1; k < 60; k++) game.step(FIXED_DT, frame(k, { lane: k === 1 ? 0.6 : 7, crouch: 3 }));
    const r = game.run as Run;
    expect(r.x).toBeCloseTo(1.6, 1);
    expect(r.crouch).toBeCloseTo(1, 2);
    for (let k = 60; k < 90; k++) game.step(FIXED_DT, frame(k, {}));
    expect(game.step(FIXED_DT, frame(90, {})).events.map((e) => e.type)).not.toContain('jump');
    const jumped = game.step(FIXED_DT, frame(91, {}, [{ id: 'jump', kind: 'rep', t: 0, source: 'keyboard' }]));
    expect(jumped.events.map((e) => e.type)).toContain('jump');
  });

  it('seated: no hurdles or squats on the course, and jump events do nothing', async () => {
    const g = await playGame(8, 'medium', 'perfect', { seated: true });
    const moves = new Set(g.events.filter((e) => e.type === 'spawn').map((e) => e.move));
    expect(moves.has('hurdle') || moves.has('squat')).toBe(false);
    expect(moves.has('duck')).toBe(true);
    expect(g.events.some((e) => e.type === 'jump')).toBe(false);
  });

  it('render() sets the HUD only when a value changes; the move prompt falls back to English', async () => {
    const hud: [string, unknown][] = [];
    const game = createRunnerGame(manifest);
    await game.init(context(1, hud));
    game.start(START());
    game.render(0);
    game.render(0);
    expect(hud).toEqual([['score', 0], ['timer', 90], ['lives', 3], ['combo', 0], ['prompt', '']]);
    let k = 0;
    while (!game.run!.next() || game.run!.next()!.eta > 1.5) game.step(FIXED_DT, frame(++k, {}));
    game.render(0);
    const prompt = hud.filter(([s]) => s === 'prompt').at(-1)![1];
    expect(['Jump', 'Duck', 'Squat', 'Lean left', 'Lean right']).toContain(prompt);
  });

  it('is pure: no clock, no Math.random, no DOM in the template', () => {
    for (const f of ['game.ts', 'sim.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/Math\.random|performance\.now|document\.|window\./);
      if (f === 'game.ts') expect(src).not.toMatch(/Date\.now/);
    }
  });

  it('the Road Run manifest is valid against the catalogue schema and lists only what works', () => {
    const schema = JSON.parse(readFileSync(new URL('../../web/catalogue/manifest.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.modes).toEqual(['solo']);
    expect(manifest.detectors.map((d) => d.id)).toEqual(['jump', 'squat', 'lean']);
  });
});

describe('Road Run through the Session', () => {
  it('a keyboard run from countdown to results; the keys reach the game; the summary is the game summary', async () => {
    let t = 0;
    const raf = new Map<number, () => void>();
    let id = 0;
    const keys = new EventTarget();
    const session = createSession({
      games: () => roadRun,
      ui: () => ({ hud: { set() {}, announce() {}, toast() {} }, audio: {} as AudioApi, store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} }, t: (k) => k }),
      raf: (cb) => { raf.set(++id, () => cb(t)); return id; },
      cancelRaf: (i) => { raf.delete(i); },
      now: () => t,
      doc: Object.assign(new EventTarget(), { hidden: false }),
      seed: () => 4,
      keyTarget: keys,
    });
    let over: { seconds: number; score: number; log: { kind: string }[] } | null = null;
    session.on('over', (s) => { over = s; });
    await session.start('road-run', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false });
    const press = (type: 'keydown' | 'keyup', key: string) => keys.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false }));
    let jumps = 0;
    let frames = 0;
    while (session.state !== 'results' && t < 200_000) {
      t += 1000 / 60;
      if (session.state === 'running' && ++frames % 90 === 0) { press('keydown', ' '); press('keyup', ' '); jumps++; }
      const due = [...raf.values()];
      raf.clear();
      for (const cb of due) cb();
    }
    expect(session.state).toBe('results');
    const s = over as unknown as { seconds: number; score: number; log: { kind: string }[] };
    expect(s.score).toBeGreaterThan(0);
    expect(s.log.length).toBeGreaterThan(0);
    expect(jumps).toBeGreaterThan(3);
  });
});
