// Parity of the runner simulation (code-audit 11.7 phase-2 gate, 11.8 task 2):
// - the perfect bot's mean score over the audit's five seeds at dt = 1/60 equals out-simbot.txt
//   (easy 7,468, medium 9,767, hard 12,588, insane 16,385);
// - the TypeScript port and the live site/game/sim.js give identical summaries for every seed, mode and rate tried.
// The bot is a copy of audit-harness/simbot.mjs.
import { describe, expect, it } from 'vitest';
import { DIFFS, Run, type RunInput } from './sim.ts';

type Mode = 'perfect' | 'late' | 'idle';
type RunCtor = new (o: { diff?: string; seed?: number }) => {
  phase: string; t: number; next(): { move: string; eta: number } | null; update(dt: number, i: RunInput): unknown[]; summary(): Record<string, unknown>;
};

function play(Ctor: RunCtor, diff: string, mode: Mode, seed: number, hz = 60): Record<string, unknown> {
  const run = new Ctor({ diff, seed });
  const input = { lane: 0, crouch: 0, _jump: false, consumeJump() { const j = this._jump; this._jump = false; return j; } };
  let guard = 0;
  while (run.phase === 'running' && guard++ < 100000) {
    const dt = 1 / hz;
    if (mode === 'perfect' || mode === 'late') {
      const n = run.next();
      let lane = 0, crouch = 0;
      if (n) {
        const eta = n.eta;
        const L = mode === 'perfect' ? { hurdle: 0.4, duck: 0.8, squat: 0.8, wall: 0.9 } : { hurdle: 0.02, duck: 0.1, squat: 0.1, wall: 0.1 };
        if (n.move === 'hurdle') { if (eta < L.hurdle) input._jump = true; }
        else if (n.move === 'duck' || n.move === 'squat') crouch = eta < L.duck ? 1 : 0;
        else if (n.move === 'wallL') lane = eta < L.wall ? -1 : 0;
        else if (n.move === 'wallR') lane = eta < L.wall ? 1 : 0;
      }
      input.lane = lane; input.crouch = crouch;
    }
    run.update(dt, input);
  }
  return { ...run.summary(), phase: run.phase, t: run.t };
}

const SEEDS = [1, 2, 3, 4, 5].map((s) => s * 7919);
const EXPECTED: Record<string, number> = { easy: 7468, medium: 9767, hard: 12588, insane: 16385 };

describe('runner sim parity', () => {
  it.each(Object.keys(EXPECTED))('perfect bot on %s matches the audit (mean of 5 seeds, dt 1/60)', (diff) => {
    const scores = SEEDS.map((seed) => play(Run as unknown as RunCtor, diff, 'perfect', seed).score as number);
    const mean = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    expect(mean).toBe(EXPECTED[diff]);
  });

  it('the port equals the live site/game/sim.js for every difficulty, bot, seed and rate', async () => {
    const live = (await import(/* @vite-ignore */ new URL('../../../site/game/sim.js', import.meta.url).href)) as { Run: RunCtor };
    let compared = 0;
    for (const diff of Object.keys(DIFFS)) {
      for (const mode of ['perfect', 'late', 'idle'] as const) {
        for (const seed of [...SEEDS, 42, 0xdeadbeef]) {
          for (const hz of mode === 'perfect' ? [20, 30, 60, 144] : [60]) {
            expect(play(Run as unknown as RunCtor, diff, mode, seed, hz)).toEqual(play(live.Run, diff, mode, seed, hz));
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(4 * (7 * 4 + 7 + 7));
  }, 60_000);   // about 1.3 million simulation steps; slow when other test runs share the CPU

  it('same seed, same inputs: same run (determinism)', () => {
    expect(play(Run as unknown as RunCtor, 'medium', 'perfect', 42)).toEqual(play(Run as unknown as RunCtor, 'medium', 'perfect', 42));
  });
});
