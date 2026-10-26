// Twist Turbine, the simulation: the timeline, the repetitions and the pace band, the storms (blackout and overload), the
// turbine and the city, the reasons a twist did not count, keyboard play, determinism, snapshot and restore.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { frameFrom } from '../_shared/frame.ts';
import type { SimEvent } from '../_shared/host.ts';
import { TT_LEVELS, TT_TIMING, TurbineSim, makeTtPlan, type TtTiming } from './turbine.ts';
import { twistBot, type TwistBotOptions } from './testing/twist-bot.ts';
import { inputOf, run } from './testing/run.ts';

interface MakeOptions { seed?: number; difficulty?: string; seated?: boolean; timing?: Partial<TtTiming> }

function make(o: MakeOptions = {}): TurbineSim {
  const seed = o.seed ?? 3;
  return new TurbineSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: 'solo' },
      flags: { reducedMotion: false, silent: false, seated: o.seated ?? false },
      players: 1, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 3,
    ...(o.timing ? { timing: o.timing } : {}),
  });
}

const bot = (sim: TurbineSim, o: TwistBotOptions) => twistBot(sim.plan, o);
const types = (events: readonly SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);

describe('the timeline', () => {
  it('three sets of 50 s, two rests of 15 s and a 4 s outro: 11040 steps in order', () => {
    const sim = make();
    expect(sim.plan.segments.map((s) => s.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work', 'finale']);
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    expect(r.k).toBe(184 * 60);
    expect(sim.phase).toBe('complete');
    expect(types(r.events, 'set')).toHaveLength(3);
    expect(types(r.events, 'rest')).toHaveLength(2);
    expect(types(r.events, 'finale')).toHaveLength(1);
    expect(types(r.events, 'done')).toHaveLength(1);
    expect(sim.summary().seconds).toBe(184);
  });

  it('the sets and the rests add up to the 180 s of the manifest, outro apart', () => {
    const sim = make();
    const played = sim.plan.segments.filter((s) => s.kind !== 'finale').reduce((n, s) => n + (s.endK - s.startK), 0);
    expect(played / 60).toBe(180);
  });

  it('the bands rise with the level, and each level has storms in every set, inside the set and apart from each other', () => {
    let prev = 0;
    for (const d of ['easy', 'normal', 'hard', 'expert'] as const) {
      const sim = make({ difficulty: d });
      expect(sim.plan.band[0]).toBeGreaterThan(prev);
      prev = sim.plan.band[0];
      const work = sim.plan.segments.filter((s) => s.kind === 'work');
      for (const w of work) {
        const inSet = sim.plan.storms.filter((x) => x.startK >= w.startK && x.startK < w.endK);
        expect(inSet.length, `${d} set ${w.set}`).toBeGreaterThanOrEqual(TT_LEVELS[d].storms[0]);
        expect(inSet.length).toBeLessThanOrEqual(TT_LEVELS[d].storms[1]);
        for (const st of inSet) { expect(st.startK).toBeGreaterThanOrEqual(w.startK + 600); expect(st.endK).toBeLessThan(w.endK); }
        for (let i = 1; i < inSet.length; i++) expect(inSet[i]!.startK - inSet[i - 1]!.startK).toBeGreaterThan(14 * 60);
      }
    }
  });

  it('an unknown level plays as normal', () => {
    expect(make({ difficulty: 'nonsense' }).plan.band).toEqual(TT_LEVELS.normal.band);
    expect(make({ difficulty: 'medium' }).plan.band).toEqual(TT_LEVELS.normal.band);
  });
});

describe('repetitions, pace and points', () => {
  it('a player at the middle of the band is in the band for nearly every repetition, answers every storm, and scores', () => {
    const sim = make();
    const b = bot(sim, { mode: 'perfect' });
    const r = run(sim, inputOf(b));
    const s = sim.summary();
    expect(types(r.events, 'rep').length).toBe(b.repSteps.length);
    expect(s.reps).toBeGreaterThan(80);
    expect(s.quality!).toBeGreaterThan(0.85);
    expect(s.cleared).toBe(sim.plan.storms.length);
    expect(types(r.events, 'stormEnd').every((e) => e['ok'] === true)).toBe(true);
    expect(s.score).toBeGreaterThan(sim.plan.storms.length * 150);
    expect(s.log.filter((e) => e.ok).reduce((n, e) => n + (e.v ?? 0), 0)).toBe(s.score);
  });

  it('below the band a repetition counts less, above it the extra is lost, inside it the points are full', () => {
    const score = (pace: number): { score: number; reps: number; quality: number } => {
      const sim = make({ timing: { sets: 1, workS: 40, finaleS: 2 } });
      // no storms in the way: the same pace all the set
      (sim.plan as { storms: unknown[] }).storms.length = 0;
      run(sim, inputOf(bot(sim, { mode: 'perfect', pace })));
      const s = sim.summary();
      return { score: s.score, reps: s.reps!, quality: s.quality! };
    };
    const slow = score(0.4), mid = score(1), fast = score(2.2);
    expect(mid.quality).toBeGreaterThan(0.9);
    expect(slow.quality).toBeLessThan(0.3);
    expect(fast.quality).toBeLessThan(0.3);
    expect(mid.score / mid.reps).toBeGreaterThan(slow.score / slow.reps);
    expect(mid.score / mid.reps).toBeGreaterThan(fast.score / fast.reps);
    // but more twists are still more points than few: the points a minute rise from slow to middle
    expect(mid.score).toBeGreaterThan(slow.score);
  });

  it('the first twist is judged on its own and never in the band; the pace and the streak start with the second', () => {
    const sim = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    (sim.plan as { storms: unknown[] }).storms.length = 0;
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    const reps = types(r.events, 'rep');
    expect(reps[0]!['inBand']).toBe(false);
    expect(reps[0]!['pts']).toBe(Math.round(10 * (0.6 + 0.4 * ((0.9 - 0.6) / 0.5)) * 0.8));
    expect(reps.slice(1).every((e) => e['inBand'] === true)).toBe(true);
    expect(reps.at(-1)!['streak']).toBeGreaterThan(10);
  });

  it('the range of a twist is worth something: a full twist is worth more than a barely counted one', () => {
    const play = (range: number): number => {
      const sim = make({ timing: { sets: 1, workS: 20, finaleS: 2 } });
      (sim.plan as { storms: unknown[] }).storms.length = 0;
      const b = bot(sim, { mode: 'perfect' });
      run(sim, (k) => {
        const f = b.at(k);
        return frameFrom([{ ...f, events: f.events.map((e) => ({ ...e, q: { range, speed: 2 } })) }]);
      });
      return sim.summary().score;
    };
    expect(play(1.1)).toBeGreaterThan(play(0.62));
  });

  it('the turbine speeds up with every twist, slows by itself, and the city is given the power that is kept up', () => {
    const sim = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    (sim.plan as { storms: unknown[] }).storms.length = 0;
    const b = bot(sim, { mode: 'perfect' });
    const speeds: number[] = [];
    run(sim, (k) => { if (k % 60 === 0) speeds.push(sim.playerState.omega); return inputOf(b)(k); });
    expect(Math.max(...speeds)).toBeGreaterThan(0.15);
    expect(sim.playerState.angle).toBeGreaterThan(5);
    expect(sim.playerState.power).toBeGreaterThan(0.6);
    // after the last twist the turbine coasts to a stop and the power fades with the outro's own target
    const idle = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    run(idle, inputOf(bot(idle, { mode: 'idle' })));
    expect(idle.playerState.omega).toBe(0);
    expect(idle.playerState.power).toBeLessThan(0.2);
  });
});

describe('storms', () => {
  const stormOf = (kind: 'blackout' | 'overload', seed = 1): TurbineSim => {
    for (let s = seed; s < seed + 80; s++) {
      const sim = make({ seed: s, timing: { sets: 1, workS: 50, finaleS: 2 } });
      if (sim.plan.storms.some((x) => x.kind === kind)) {
        // keep only that storm
        (sim.plan as { storms: unknown[] }).storms.splice(0, sim.plan.storms.length, ...sim.plan.storms.filter((x) => x.kind === kind).slice(0, 1));
        return sim;
      }
    }
    throw new Error('no seed gives that storm');
  };

  it('a blackout asks for its repetitions within eight seconds: enough ends it with a bonus, one short does not', () => {
    for (const short of [false, true]) {
      const sim = stormOf('blackout');
      const st = sim.plan.storms[0]!;
      const need = st.need - (short ? 1 : 0);
      // exactly `need` repetitions, spaced over the first 6 seconds of the storm, no others
      const steps = Array.from({ length: need }, (_, i) => st.startK + 20 + Math.round((i * 330) / Math.max(1, need - 1)));
      const r = run(sim, (k) => frameFrom([{ ok: true, ch: {}, events: steps.includes(k) ? [{ id: 'twist', kind: 'rep', t: 0, source: 'pose', side: steps.indexOf(k) % 2 ? 'R' : 'L', q: { range: 0.9 } }] : [] }]));
      const end = types(r.events, 'stormEnd')[0]!;
      expect(end['ok']).toBe(!short);
      expect(end['bonus']).toBe(short ? 0 : 150);
      expect(types(r.events, 'storm')[0]!['kind']).toBe('blackout');
      if (short) expect(sim.summary().log.some((e) => e.kind === 'too_slow' && !e.ok)).toBe(true);
    }
  });

  it('a blackout dims the city and it comes back lit when the lights return', () => {
    const sim = stormOf('blackout');
    const st = sim.plan.storms[0]!;
    const b = bot(sim, { mode: 'perfect' });
    let before = 0, during = 1, after = 0;
    run(sim, (k) => {
      if (k === st.startK - 5) before = sim.playerState.lit;
      if (k === st.startK + 200) during = sim.playerState.lit;
      if (k === st.endK + 400) after = sim.playerState.lit;
      return inputOf(b)(k);
    });
    expect(before).toBeGreaterThan(0.4);
    expect(during).toBeLessThan(before);
    expect(after).toBeGreaterThan(during);
  });

  it('an overload asks for the twist held on the side shown: held long enough ends it with a bonus, a short hold does not', () => {
    for (const hold of [true, false]) {
      const sim = stormOf('overload');
      const st = sim.plan.storms[0]!;
      const stop = hold ? st.startK + 30 + st.holdSteps + 10 : st.startK + 30 + Math.round(st.holdSteps / 2);
      const r = run(sim, (k) => frameFrom([{ ok: true, ch: { tau: st.side * 0.85, side: k >= st.startK + 30 && k <= stop ? st.side : 0, span: 0.8, gap: 0.2 }, events: [] }]));
      const end = types(r.events, 'stormEnd')[0]!;
      expect(end['ok']).toBe(hold);
      expect(end['bonus']).toBe(hold ? 200 : 0);
      if (!hold) expect(sim.summary().log.some((e) => e.kind === 'held_too_short' && !e.ok)).toBe(true);
    }
  });

  it('a hold survives a short flicker of the detector but not a real break', () => {
    const outcome = (gap: number): boolean => {
      const sim = stormOf('overload');
      const st = sim.plan.storms[0]!;
      const mid = st.startK + 30 + Math.round(st.holdSteps / 2);
      const r = run(sim, (k) => frameFrom([{ ok: true, ch: { side: k >= st.startK + 30 && k <= st.startK + 30 + st.holdSteps + 120 && !(k >= mid && k < mid + gap) ? st.side : 0 }, events: [] }]));
      return types(r.events, 'stormEnd')[0]!['ok'] === true;
    };
    expect(outcome(8)).toBe(true);
    expect(outcome(40)).toBe(false);
  });

  it('the holding side matters: the other side does not count', () => {
    const sim = stormOf('overload');
    const st = sim.plan.storms[0]!;
    const r = run(sim, () => frameFrom([{ ok: true, ch: { side: -st.side }, events: [] }]));
    expect(types(r.events, 'stormEnd')[0]!['ok']).toBe(false);
  });

  it('storms are seeded: the same seed gives the same storms, another seed other ones', () => {
    const a = make({ seed: 8 }).plan.storms, b = make({ seed: 8 }).plan.storms, c = make({ seed: 9 }).plan.storms;
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });
});

describe('sloppy and idle players', () => {
  it('sloppy scores less, is below the band, and is told why a twist did not count', () => {
    const a = make({ seed: 4 });
    run(a, inputOf(bot(a, { mode: 'perfect' })));
    const b = make({ seed: 4 });
    const r = run(b, inputOf(bot(b, { mode: 'sloppy', seed: 4 })));
    expect(b.summary().score).toBeLessThan(a.summary().score / 2);
    expect(b.summary().quality!).toBeLessThan(0.5);
    const codes = new Set(types(r.events, 'miss').map((e) => e['code']));
    expect(codes.has('turn_more')).toBe(true);
    expect(codes.has('hands_apart')).toBe(true);
    expect(codes.has('turn_shoulders')).toBe(true);
    // the results count them by code
    expect(new Set(b.summary().log.filter((e) => !e.ok).map((e) => e.kind))).toEqual(expect.objectContaining(new Set([...codes].filter((c) => c !== 'move_more'))));
  });

  it('idle gets nothing, fails every storm without a penalty, and is told to move now and then, not in a flood', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    const s = sim.summary();
    expect(s.score).toBe(0);
    expect(s.reps).toBe(0);
    expect(s.cleared).toBe(0);
    expect(s.metSeconds).toBe(0);
    expect(types(r.events, 'stormEnd').every((e) => e['ok'] === false)).toBe(true);
    expect(types(r.events, 'stormEnd')).toHaveLength(sim.plan.storms.length);
    const miss = types(r.events, 'miss');
    expect(new Set(miss.map((m) => m['code']))).toEqual(new Set(['move_more']));
    expect(miss.length).toBeLessThan(20);
  });

  it('a player who is not seen scores nothing', () => {
    const sim = make({ timing: { sets: 1, workS: 20, finaleS: 2 } });
    const b = bot(sim, { mode: 'perfect' });
    run(sim, (k) => frameFrom([{ ...b.at(k), ok: false }]));
    expect(sim.summary().reps).toBe(0);
  });
});

describe('keyboard and touch', () => {
  it('alternating presses are repetitions; the side comes from the key; the same side twice is not a twist', () => {
    const sim = make({ timing: { sets: 1, workS: 30, finaleS: 2 } });
    (sim.plan as { storms: unknown[] }).storms.length = 0;
    const press = (k: number, side: -1 | 1): ReturnType<typeof frameFrom> => frameFrom([{ ok: true, ch: { side }, events: [{ id: 'twist', kind: 'rep', t: 0, source: 'keyboard' }] }], 'keyboard');
    const seq: [number, -1 | 1][] = [[100, -1], [200, 1], [300, -1], [400, -1], [500, 1]];
    const r = run(sim, (k) => { const hit = seq.find(([x]) => x === k); return hit ? press(k, hit[1]) : frameFrom([{ ok: true }], 'keyboard'); });
    expect(types(r.events, 'rep').map((e) => e['side'])).toEqual([-1, 1, -1, 1]);
    expect(types(r.events, 'miss').map((e) => e['code'])).toContain('wrong_side');
  });

  it('a keyboard player can answer a storm too: the key held is the hold', () => {
    const sim = make({ seed: 2, timing: { sets: 1, workS: 50, finaleS: 2 } });
    const st = sim.plan.storms.find((x) => x.kind === 'overload');
    if (!st) return;
    (sim.plan as { storms: unknown[] }).storms.splice(0, sim.plan.storms.length, st);
    const r = run(sim, (k) => frameFrom([{ ok: true, ch: { side: k > st.startK + 10 && k < st.startK + 10 + st.holdSteps + 30 ? st.side : 0 } }], 'keyboard'));
    expect(types(r.events, 'stormEnd')[0]!['ok']).toBe(true);
  });
});

describe('seeded content, snapshot and restore', () => {
  it('the same seed and moves give the same events and summary; another seed another set of storms', () => {
    const play = (seed: number) => {
      const sim = make({ seed });
      const r = run(sim, inputOf(bot(sim, { mode: 'sloppy', seed })));
      return { events: r.events, summary: sim.summary() };
    };
    const a = play(5), b = play(5), c = play(6);
    expect(b.events).toEqual(a.events);
    expect(b.summary).toEqual(a.summary);
    expect(c.events).not.toEqual(a.events);
  });

  it('restore(snapshot()) continues exactly as the original, in a new instance too, mid-storm included', () => {
    const sim = make({ seed: 7 });
    const b = bot(sim, { mode: 'perfect' });
    const st = sim.plan.storms[0]!;
    const first = run(sim, inputOf(b), { steps: st.startK + 90 });
    expect(sim.storm).not.toBeNull();
    const snap = JSON.parse(JSON.stringify(sim.snapshot())) as unknown;
    const rest = run(sim, inputOf(b), { from: first.k });
    const other = make({ seed: 99 });
    other.restore(snap);
    const again = run(other, inputOf(b), { from: first.k });
    expect(again.events).toEqual(rest.events);
    expect(other.summary()).toEqual(sim.summary());
    expect(() => make().restore({ v: 3 })).toThrow();
  });
});

describe('the ways of playing', () => {
  it('seated counts less movement as calories, a bit less than standing', () => {
    const play = (seated: boolean): number => {
      const sim = make({ seated, timing: { sets: 1, workS: 30, finaleS: 2 } });
      run(sim, inputOf(bot(sim, { mode: 'perfect' })));
      return sim.summary().metSeconds;
    };
    expect(play(true)).toBeCloseTo(play(false) * 0.8, 0);
    expect(play(false)).toBeGreaterThan(3 * 20);
  });
});

describe('the plan and purity', () => {
  it('makeTtPlan is a function of the level, the timing and the stream', () => {
    expect(makeTtPlan('hard', TT_TIMING, mulberry32(4))).toEqual(makeTtPlan('hard', TT_TIMING, mulberry32(4)));
  });

  it('the simulation has no clock, no Math.random and no DOM', () => {
    const src = readFileSync(new URL('./turbine.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
  });
});
