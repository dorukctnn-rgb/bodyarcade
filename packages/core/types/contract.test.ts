// Compile-time and runtime checks that the contract hangs together: a toy game implements Game and passes rule 1
// (same seed + same input log = same summary). Builders can copy the shape; the toy is not a real game.
import { describe, expect, it } from 'vitest';
import {
  FIXED_DT, LANDMARK_COUNT, LM, POSE_CONNECTIONS, TRACE_FORMAT,
  type Game, type GameContext, type GameManifest, type InputFrame, type RunSummary, type StartOptions, type StepResult,
} from './index.ts';
import { rngStream } from '../loop/rng.ts';

const manifest: GameManifest = {
  id: 'toy-hops', template: 'strength', version: 1, title: { en: 'Toy hops' }, regions: ['legs'], framing: 'full',
  seated: false, lowImpact: false, silentSafe: false, durationSec: 10, met: 5, detectors: [{ id: 'jump' }],
  free: true, modes: ['solo'], seo: { slug: 'toy-hops', keywords: [] },
};

class ToyHops implements Game {
  readonly manifest = manifest;
  // Everything the simulation needs to continue lives in `s`, including the random stream's position.
  private s = { t: 0, score: 0, hops: 0, target: 0, seed: 0, draws: 0 };
  private rng: () => number = () => 0;
  private log: RunSummary['log'] = [];
  private draw(): number { this.s.draws++; return this.rng(); }
  async init(_ctx: GameContext): Promise<void> { /* a real game creates its scene here */ }
  start(o: StartOptions): void {
    this.rng = rngStream(o.seed, 'course');
    this.s = { t: 0, score: 0, hops: 0, target: 0, seed: o.seed, draws: 0 };
    this.s.target = 0.5 + this.draw();
    this.log = [];
  }
  step(dt: number, input: InputFrame): StepResult {
    this.s.t += dt;
    for (const e of input.events) if (e.id === 'jump' && e.kind === 'rep') {
      const ok = this.s.t >= this.s.target;
      this.s.hops++;
      if (ok) { this.s.score += 100; this.s.target = this.s.t + 0.5 + this.draw(); }
      this.log.push({ t: Math.round(this.s.t * 1000), kind: 'hop', ok });
    }
    return { events: [], phase: this.s.t >= manifest.durationSec ? 'complete' : 'running' };
  }
  render(_alpha: number): void { /* drawing only */ }
  snapshot(): unknown { return { s: { ...this.s }, log: this.log.slice() }; }
  restore(x: unknown): void {
    const v = x as { s: ToyHops['s']; log: RunSummary['log'] };
    this.s = { ...v.s };
    this.log = v.log.slice();
    this.rng = rngStream(this.s.seed, 'course');
    for (let i = 0; i < this.s.draws; i++) this.rng();
  }
  summary(): RunSummary {
    return { score: this.s.score, seconds: Math.round(this.s.t), reps: this.s.hops, metSeconds: manifest.met * this.s.t, log: this.log.slice() };
  }
  dispose(): void { /* nothing to release */ }
}

function play(seed: number, hopEverySteps: number): RunSummary {
  const g = new ToyHops();
  g.start({ seed, difficulty: 'medium', seated: false, mode: 'solo', profile: null });
  for (let i = 1; ; i++) {
    const events = i % hopEverySteps === 0 ? [{ id: 'jump' as const, kind: 'rep' as const, t: i * FIXED_DT * 1000, source: 'test' as const }] : [];
    const frame: InputFrame = { t: i * FIXED_DT * 1000, source: 'test', tracking: { ok: true }, channels: {}, events };
    if (g.step(FIXED_DT, frame).phase !== 'running') break;
  }
  return g.summary();
}

describe('contract', () => {
  it('constants match MediaPipe and the fixed step', () => {
    expect(FIXED_DT).toBeCloseTo(1 / 60, 12);
    expect(LANDMARK_COUNT).toBe(33);
    expect(LM.leftShoulder).toBe(11);
    expect(LM.rightFootIndex).toBe(32);
    expect(POSE_CONNECTIONS.every(([a, b]) => a < LANDMARK_COUNT && b < LANDMARK_COUNT)).toBe(true);
    expect(TRACE_FORMAT).toBe('bodyarcade-trace');
  });

  it('rule 1: same seed and same input log give the same summary', () => {
    expect(play(42, 37)).toEqual(play(42, 37));
    expect(play(42, 37)).not.toEqual(play(43, 37));
  });

  it('restore(snapshot()) continues identically', () => {
    const a = new ToyHops();
    a.start({ seed: 5, difficulty: 'medium', seated: false, mode: 'solo', profile: null });
    const frame = (i: number): InputFrame => ({ t: i, source: 'test', tracking: { ok: true }, channels: {}, events: i % 40 === 0 ? [{ id: 'jump', kind: 'rep', t: i, source: 'test' }] : [] });
    for (let i = 1; i <= 200; i++) a.step(FIXED_DT, frame(i));
    const snap = a.snapshot();
    const b = new ToyHops();
    b.start({ seed: 999, difficulty: 'medium', seated: false, mode: 'solo', profile: null });
    b.restore(snap);
    expect(b.summary()).toEqual(a.summary());
    for (let i = 201; i <= 600; i++) { a.step(FIXED_DT, frame(i)); b.step(FIXED_DT, frame(i)); }
    expect(b.summary()).toEqual(a.summary());
    expect(a.summary().score).toBeGreaterThan(0);
  });
});
