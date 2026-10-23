// The course made in advance (WP10): same rules and numbers as today's random spawning, fixed distances.
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../core/loop/rng.ts';
import { buildCourse, DIFFS, Run, type Course, type RunInput, type SimEvent } from './sim.ts';
import { botAction, type BotMode } from './testing/bot.ts';

const SEEDS = [1, 2, 3, 4, 5].map((s) => s * 7919);
const EXPECTED: Record<string, number> = { easy: 7468, medium: 9767, hard: 12588, insane: 16385 };

function play(diff: string, mode: BotMode, seed: number, course?: Course) {
  const run = new Run(course ? { diff, seed, course } : { diff, seed });
  let jump = false;
  const input: RunInput = { lane: 0, crouch: 0, consumeJump: () => { const j = jump; jump = false; return j; } };
  const spawns: string[] = [];
  let guard = 0;
  while (run.phase === 'running' && guard++ < 100_000) {
    const a = botAction(run, mode);
    input.lane = a.lane; input.crouch = a.crouch; if (a.jump) jump = true;
    for (const e of run.update(1 / 60, input) as SimEvent[]) if (e.type === 'spawn') spawns.push(`${e.ob.type}${e.ob.side}`);
  }
  return { summary: run.summary(), spawns };
}

/** The course from the same numbers a fresh random-mode run with this seed would use. */
const sameNumbers = (diff: string, seed: number): Course => buildCourse(new Run({ diff, seed }).rand, diff);

describe('runner course', () => {
  it('is a pure function of the random numbers', () => {
    const a = buildCourse(rngStream(7, 'course'), 'medium');
    expect(buildCourse(rngStream(7, 'course'), 'medium')).toEqual(a);
    expect(buildCourse(rngStream(8, 'course'), 'medium')).not.toEqual(a);
    expect(a.obstacles.length).toBeGreaterThan(30);
    expect(a.obstacles.every((o, i) => i === 0 || o.at > (a.obstacles[i - 1] as { at: number }).at)).toBe(true);
  });

  it('a run without hits meets exactly what random spawning gives with the same numbers', () => {
    let clean = 0;
    for (const diff of Object.keys(DIFFS)) {
      for (const seed of [...SEEDS, 42]) {
        const random = play(diff, 'perfect', seed);
        const course = play(diff, 'perfect', seed, sameNumbers(diff, seed));
        if (random.summary.hits === 0) { clean++; expect(course).toEqual(random); }
      }
    }
    expect(clean).toBeGreaterThanOrEqual(8);
  });

  it('with hits the obstacles keep their order and kind; only the timing differs', () => {
    for (const diff of Object.keys(DIFFS)) {
      for (const seed of SEEDS) {
        const random = play(diff, 'idle', seed);
        const course = play(diff, 'idle', seed, sameNumbers(diff, seed));
        const n = Math.min(random.spawns.length, course.spawns.length);
        expect(n).toBeGreaterThanOrEqual(4);   // the idle player loses all three hearts within the first obstacles
        expect(course.spawns.slice(0, n)).toEqual(random.spawns.slice(0, n));
      }
    }
  });

  it.each(Object.keys(EXPECTED))("perfect bot on %s: the platform course stream scores like today's random spawning (10 seeds, within 5 %%)", (diff) => {
    const seeds = Array.from({ length: 10 }, (_, i) => (i + 1) * 7919);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const today = mean(seeds.map((seed) => play(diff, 'perfect', seed).summary.score));
    const platform = mean(seeds.map((seed) => play(diff, 'perfect', seed, buildCourse(rngStream(seed, 'course'), diff)).summary.score));
    expect(Math.abs(platform / today - 1)).toBeLessThan(0.05);
    expect(Math.abs(today / (EXPECTED[diff] as number) - 1)).toBeLessThan(0.05);
  });
});
