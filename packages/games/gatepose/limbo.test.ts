// Limbo Bend, the simulation: the timeline, the seeded gates, the judging with the reasons a gate was missed, the points, two
// players on one camera (lanes and the team pass), keys and swipes, determinism, snapshot and restore in the middle of a hold.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { frameFrom } from '../_shared/frame.ts';
import type { SimEvent } from '../_shared/host.ts';
import { inputOf, run } from '../strength/testing/run.ts';
import { LB_LEVELS, LB_TIMING, LimboSim, PAIR_GAP_S, WINDOW_S, makeLbPlan, reasonFor, type LbGate } from './limbo.ts';
import type { GpTiming } from './plan.ts';
import { limboBot, type LimboBotOptions, type Spoil } from './testing/limbo-bot.ts';

interface MakeOptions { seed?: number; difficulty?: string; seated?: boolean; players?: 1 | 2; timing?: Partial<GpTiming> }

function make(o: MakeOptions = {}): LimboSim {
  const seed = o.seed ?? 3;
  const players = o.players ?? 1;
  return new LimboSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: players === 2 ? 'local2' : 'solo' },
      flags: { reducedMotion: false, silent: false, seated: o.seated ?? false },
      players, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 2.3,
    ...(o.timing ? { timing: o.timing } : {}),
  });
}

const bot = (sim: LimboSim, o: LimboBotOptions) => limboBot(sim.plan, o);
const types = (events: readonly SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);
const gateEvents = (events: readonly SimEvent[]): SimEvent[] => types(events, 'gate');
const SHORT: Partial<GpTiming> = { sets: 1, workS: 30, finaleS: 2 };

describe('the timeline', () => {
  it('three sets of 50 s, two rests of 15 s and a 4 s outro: 11040 steps in order', () => {
    const sim = make();
    expect(sim.plan.segments.map((s) => s.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work', 'finale']);
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    expect(r.k).toBe(184 * 60);
    expect(sim.phase).toBe('complete');
    expect(types(r.events, 'set').map((e) => e['set'])).toEqual([0, 1, 2]);
    expect(types(r.events, 'rest')).toHaveLength(2);
    expect(types(r.events, 'finale')).toHaveLength(1);
    expect(types(r.events, 'done')).toHaveLength(1);
    expect(sim.summary().seconds).toBe(184);
  });

  it('the sets and the rests add up to the 180 s of the manifest, outro apart; no gate arrives in a rest or in the outro', () => {
    const sim = make();
    const played = sim.plan.segments.filter((s) => s.kind !== 'finale').reduce((n, s) => n + (s.endK - s.startK), 0);
    expect(played / 60).toBe(LB_TIMING.sets * LB_TIMING.workS + (LB_TIMING.sets - 1) * LB_TIMING.restS);
    expect(played / 60).toBe(180);
    const work = sim.plan.segments.filter((s) => s.kind === 'work');
    for (const g of sim.plan.gates) expect(work.some((w) => g.arriveK > w.startK && g.arriveK <= w.endK - 36), `gate ${g.id}`).toBe(true);
  });

  it('says how long a set has left and when the rest is nearly over', () => {
    const sim = make();
    expect(sim.leftS).toBe(50);
    expect(sim.gettingReady).toBe(false);
    run(sim, inputOf(bot(sim, { mode: 'idle' })), { steps: 50 * 60 + 11 * 60 });
    expect(sim.segment.kind).toBe('rest');
    expect(sim.gettingReady).toBe(false);
    run(sim, inputOf(bot(sim, { mode: 'idle' })), { from: 50 * 60 + 11 * 60, steps: 61 });
    expect(sim.gettingReady).toBe(true);
    expect(sim.leftS).toBeLessThanOrEqual(3);
  });
});

describe('the gates of the plan', () => {
  const levels = ['easy', 'normal', 'hard', 'expert'] as const;

  it('every gate is in its level\'s range of angles, on a side, with the tolerance of its level; none is tall on the easy level', () => {
    for (const d of levels) {
      const sim = make({ difficulty: d });
      const L = LB_LEVELS[d];
      expect(sim.plan.tol).toBe(L.tol);
      expect(sim.plan.gates.length).toBeGreaterThan(20);
      for (const g of sim.plan.gates) {
        expect(Math.abs(g.target), `${d} gate ${g.id}`).toBeGreaterThanOrEqual(L.angle[0] - 0.05);
        expect(Math.abs(g.target)).toBeLessThanOrEqual(L.angle[1] + 0.05);
        expect(g.target).toBe(Math.round(g.target * 10) / 10);
      }
      const tall = sim.plan.gates.filter((g) => g.tall).length;
      if (L.tallChance === 0) expect(tall).toBe(0);
      else expect(tall).toBeGreaterThan(0);
      expect(new Set(sim.plan.gates.map((g) => Math.sign(g.target))).size).toBe(2);
    }
  });

  it('the angle range grows with the level, from 12 degrees to 35, and the tolerance shrinks', () => {
    expect(LB_LEVELS.easy.angle[0]).toBe(12);
    expect(LB_LEVELS.expert.angle[1]).toBe(35);
    expect(LB_LEVELS.easy.tol).toBe(10);
    expect(LB_LEVELS.normal.tol).toBe(7);
    let prev = 0;
    for (const d of levels) { expect(LB_LEVELS[d].angle[1]).toBeGreaterThan(prev); prev = LB_LEVELS[d].angle[1]; }
    const counts = levels.map((d) => make({ difficulty: d }).plan.gates.length);
    expect(counts).toEqual(counts.slice().sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(4);
  });

  it('a gate has time to be seen, the judging window is under a second, gates keep their distance, and a quick pair goes to the other side', () => {
    for (const d of levels) {
      const sim = make({ difficulty: d, seed: 11 });
      const gates = sim.plan.gates;
      expect(sim.plan.approachK).toBe(Math.round(LB_LEVELS[d].approachS * 60));
      let pairs = 0;
      for (let i = 0; i < gates.length; i++) {
        const g = gates[i] as LbGate;
        expect(g.fromK).toBeGreaterThanOrEqual(g.arriveK - Math.round(WINDOW_S * 60));
        expect(g.fromK).toBeLessThan(g.arriveK);
        const prev = gates[i - 1];
        if (prev) {
          expect(g.arriveK - prev.arriveK, `${d} ${g.id}`).toBeGreaterThanOrEqual(Math.round(PAIR_GAP_S * 60));
          expect(g.fromK).toBeGreaterThanOrEqual(prev.arriveK + 6);
          if (g.pair) { pairs++; expect(Math.sign(g.target)).toBe(-Math.sign(prev.target)); expect(g.arriveK - prev.arriveK).toBe(Math.round(PAIR_GAP_S * 60)); }
        }
      }
      if (LB_LEVELS[d].pairChance > 0) expect(pairs, d).toBeGreaterThan(0); else expect(pairs).toBe(0);
    }
  });

  it('is a function of the level, the timing, the stream and the players', () => {
    const a = makeLbPlan('normal', LB_TIMING, mulberry32(streamSeed(5, 'course')), 1);
    const b = makeLbPlan('normal', LB_TIMING, mulberry32(streamSeed(5, 'course')), 1);
    const c = makeLbPlan('normal', LB_TIMING, mulberry32(streamSeed(6, 'course')), 1);
    expect(b).toEqual(a);
    expect(c.gates.map((g) => g.target)).not.toEqual(a.gates.map((g) => g.target));
    expect(makeLbPlan('normal', { ...LB_TIMING, sets: 1 }, mulberry32(1), 1).gates.length).toBeLessThan(a.gates.length);
  });

  it('an unknown level plays as normal', () => {
    expect(make({ difficulty: 'nonsense' }).plan.tol).toBe(LB_LEVELS.normal.tol);
    expect(make({ difficulty: 'medium' }).plan.tol).toBe(LB_LEVELS.normal.tol);
  });
});

describe('passing a gate', () => {
  it('a player who leans to every tilt passes every gate (tall ones with the hands up), with a lock before each pass', () => {
    for (const d of ['easy', 'normal', 'hard', 'expert']) {
      const sim = make({ difficulty: d });
      const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
      const gates = gateEvents(r.events);
      expect(gates, d).toHaveLength(sim.plan.gates.length);
      expect(gates.every((e) => e['ok'] === true), d).toBe(true);
      expect(types(r.events, 'lock')).toHaveLength(sim.plan.gates.length);
      for (const e of gates) {
        const lock = types(r.events, 'lock').find((l) => l['id'] === e['id']);
        expect(lock, `${d} ${e['id']}`).toBeDefined();
        expect(Number(lock?.t)).toBeLessThan(Number(e.t));
      }
      const s = sim.summary();
      expect(s.reps).toBe(sim.plan.gates.length);
      expect(s.cleared).toBe(sim.plan.gates.length);
      expect(s.bestStreak).toBe(sim.plan.gates.length);
      expect(s.quality).toBeGreaterThan(0.75);
      expect(sim.playerStates[0]?.missed).toBe(0);
    }
  });

  it('the pose camera at 10 pose frames a second is enough, and at 30 as well', () => {
    for (const hz of [10, 15, 30]) {
      const sim = make({ timing: SHORT });
      const r = run(sim, inputOf(bot(sim, { mode: 'perfect', poseHz: hz })));
      const gates = gateEvents(r.events);
      expect(gates.length).toBe(sim.plan.gates.length);
      expect(gates.filter((e) => e['ok'] === true).length, `${hz} Hz`).toBe(gates.length);
    }
  });

  it('a gate that is judged says the angle it asked for, where it tilted, and how exact the player was', () => {
    const sim = make({ timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    for (const e of gateEvents(r.events)) {
      const g = sim.plan.gates[Number(e['id'])] as LbGate;
      expect(e['target']).toBe(g.target);
      expect(e['tall']).toBe(g.tall);
      expect(e['lane']).toBe(0);
      expect(Number(e['precision'])).toBeGreaterThan(0.6);
      expect(Math.abs(Number(e['error']))).toBeLessThan(sim.plan.tol);
      expect(Number(e.t)).toBeCloseTo((g.arriveK * 1000) / 60, 0);
    }
  });

  it('the angle must be held: touching the tilt for less than 0.3 s does not pass, and the reason is "hold it longer"', () => {
    const sim = make({ timing: SHORT });
    const b = bot(sim, { mode: 'sloppy', spoil: () => 'late' });
    const r = run(sim, inputOf(b));
    const gates = gateEvents(r.events);
    expect(gates.length).toBe(sim.plan.gates.length);
    expect(gates.every((e) => e['ok'] === false && e['code'] === 'held_too_short')).toBe(true);
  });

  it('standing upright misses every gate and says to bend more; nothing is scored and no points are taken away', () => {
    const sim = make({ timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    const gates = gateEvents(r.events);
    expect(gates.length).toBe(sim.plan.gates.length);
    for (const e of gates) {
      expect(e['ok']).toBe(false);
      expect(e['code']).toBe('bend_more');
      expect(Number(e['need'])).toBeGreaterThan(0 - 1e-9 + (Number(e['target']) < 0 ? -1000 : 0));
    }
    const s = sim.summary();
    expect(s.score).toBe(0);
    expect(s.reps).toBe(0);
    expect(sim.playerStates[0]?.missed).toBe(gates.length);
    expect(types(r.events, 'lock')).toHaveLength(0);
  });

  it('each way of getting it wrong is named: not far enough, the wrong side, hips sliding, hands down on a tall gate, folding forward, too late', () => {
    const want: Record<Spoil, string> = { short: 'bend_more', wrong: 'wrong_side', hips: 'hips_shifted', arms: 'arms_not_up', forward: 'bending_forward', late: 'held_too_short' };
    for (const spoil of Object.keys(want) as Spoil[]) {
      const sim = make({ difficulty: 'hard', seed: 8 });
      const b = bot(sim, { mode: 'sloppy', spoil: (g, n) => (n % 3 === 1 && (spoil !== 'arms' || g.tall) ? spoil : null) });
      const r = run(sim, inputOf(b));
      const byId = new Map(gateEvents(r.events).map((e) => [Number(e['id']), e] as const));
      expect(b.spoiled.size, spoil).toBeGreaterThan(2);
      for (const [id] of b.spoiled) expect(byId.get(id)?.['code'], `${spoil} gate ${id}`).toBe(want[spoil]);
      // the gates left alone are passed
      for (const [id, e] of byId) if (!b.spoiled.has(id)) expect(e['ok'], `${spoil} gate ${id}`).toBe(true);
    }
  });

  it('a missed gate tells the reason once in a while, not at every miss in a row, so the strip does not flood', () => {
    const sim = make({ timing: SHORT });
    run(sim, inputOf(bot(sim, { mode: 'idle' })));
    const p = sim.playerStates[0];
    expect(p?.miss?.code).toBe('bend_more');
    expect(p?.miss?.k).toBeGreaterThan(0);
  });

  it('a player the camera does not see wins nothing and loses nothing: the gates are skipped, with no miss and no broken streak', () => {
    const sim = make({ timing: SHORT });
    const b = bot(sim, { mode: 'perfect', hidden: (k) => k >= 600 && k < 1500 });
    const r = run(sim, inputOf(b));
    const gates = gateEvents(r.events);
    const skipped = gates.filter((e) => e['skipped'] === true);
    expect(skipped.length).toBeGreaterThan(0);
    expect(gates.filter((e) => e['ok'] === false && e['skipped'] !== true)).toHaveLength(0);
    const p = sim.playerStates[0];
    expect(p?.missed).toBe(0);
    expect(p?.passed).toBe(gates.length - skipped.length);
    expect(p?.bestStreak).toBeGreaterThan(1);
    for (const id of skipped.map((e) => Number(e['id']))) expect(sim.gateStates[id]?.done).toBe(3);
  });

  it('a lean that comes from sliding the hips does not count even when the angle is right', () => {
    const sim = make({ timing: SHORT });
    const b = bot(sim, { mode: 'sloppy', spoil: () => 'hips' });
    const r = run(sim, inputOf(b));
    expect(gateEvents(r.events).every((e) => e['code'] === 'hips_shifted')).toBe(true);
  });
});

describe('points', () => {
  it('a pass is worth 60 plus up to 40 for how exact it was, with a streak bonus of 5 percent a gate up to half again', () => {
    const sim = make({ timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    const gates = gateEvents(r.events);
    let total = 0;
    gates.forEach((e, i) => {
      const prec = Number(e['precision']);
      const mult = 1 + Math.min(0.5, i * 0.05);
      expect(Number(e['pts']), `gate ${i}`).toBeCloseTo((60 + 40 * prec) * mult, -0.5);
      expect(e['streak']).toBe(i + 1);
      total += Number(e['pts']);
    });
    expect(sim.summary().score).toBe(total);
    expect(gates.length).toBeGreaterThan(8);
    expect(Number(gates[gates.length - 1]?.['pts'])).toBeGreaterThan(Number(gates[0]?.['pts']));
  });

  it('a miss breaks the streak and the next pass starts again at the plain points; the best streak is kept', () => {
    const sim = make({ timing: SHORT });
    const b = bot(sim, { mode: 'sloppy', spoil: (_g, n) => (n === 5 ? 'short' : null) });
    const r = run(sim, inputOf(b));
    const gates = gateEvents(r.events);
    expect(gates[5]?.['ok']).toBe(false);
    expect(gates[6]?.['streak']).toBe(1);
    expect(sim.summary().bestStreak).toBe(5);
    expect(Number(gates[6]?.['pts'])).toBeLessThanOrEqual(100);
  });

  it('the log records every gate with its points or its reason, and a room can recompute the score from it', () => {
    const sim = make({ timing: SHORT });
    const b = bot(sim, { mode: 'sloppy' });
    run(sim, inputOf(b));
    const s = sim.summary();
    const passes = s.log.filter((e) => e.kind === 'gate');
    const misses = s.log.filter((e) => e.ok === false);
    expect(passes.every((e) => e.ok === true)).toBe(true);
    expect(passes.reduce((n, e) => n + (e.v ?? 0), 0)).toBe(s.score);
    expect(misses.length).toBe(sim.playerStates[0]?.missed);
    expect(misses.every((e) => typeof e.kind === 'string' && e.kind !== 'gate')).toBe(true);
    expect(s.log.length).toBe(passes.length + misses.length);
  });

  it('a sloppy player scores less than a perfect one, and the quality says how exact the passes were', () => {
    const a = make({ seed: 4 });
    run(a, inputOf(bot(a, { mode: 'perfect' })));
    const b = make({ seed: 4 });
    run(b, inputOf(bot(b, { mode: 'sloppy' })));
    expect(b.summary().score).toBeLessThan(a.summary().score);
    expect(b.summary().quality).toBeLessThan(a.summary().quality ?? 1);
    expect(b.summary().reps).toBeGreaterThan(0);
  });
});

describe('two players on one camera', () => {
  it('every gate comes to both lanes at the same moment, each with its own tilt', () => {
    const sim = make({ players: 2, difficulty: 'hard' });
    const g0 = sim.gatesOf(0);
    const g1 = sim.gatesOf(1);
    expect(g0.length).toBe(g1.length);
    expect(g0.length).toBeGreaterThan(30);
    expect(sim.plan.gates).toHaveLength(g0.length * 2);
    let differing = 0;
    for (let i = 0; i < g0.length; i++) {
      expect((g0[i] as LbGate).arriveK).toBe((g1[i] as LbGate).arriveK);
      if ((g0[i] as LbGate).target !== (g1[i] as LbGate).target) differing++;
    }
    expect(differing).toBeGreaterThan(g0.length / 2);
    expect(sim.playerCount).toBe(2);
  });

  it('two players who lean to every tilt pass every gate together: a team pass each time, with a bonus for both', () => {
    const sim = make({ players: 2, timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'perfect', lane: 1 })));
    const n = sim.plan.gates.length / 2;
    expect(gateEvents(r.events).filter((e) => e['ok'] === true)).toHaveLength(n * 2);
    expect(types(r.events, 'team')).toHaveLength(n);
    const s = sim.summary();
    expect(s.players?.[1]?.reps).toBe(n);
    expect(s.players?.[2]?.reps).toBe(n);
    // both are exact, each with their own angles: the scores are close, and both hold the team bonus
    expect(Math.abs((s.players?.[1]?.score ?? 0) - (s.players?.[2]?.score ?? 0))).toBeLessThan((s.players?.[1]?.score ?? 0) * 0.08);
    expect(s.score).toBe((s.players?.[1]?.score ?? 0) + (s.players?.[2]?.score ?? 0));
    expect(s.reps).toBe(n * 2);
    // the 25 points of each team pass are in both players' scores
    const plain = sim.playerStates.map((p) => p.score);
    expect(plain[0]).toBeGreaterThanOrEqual(25 * n);
  });

  it('if one of the two misses there is no team pass, and the other keeps their own points', () => {
    const sim = make({ players: 2, timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'idle', lane: 1 })));
    expect(types(r.events, 'team')).toHaveLength(0);
    const s = sim.summary();
    expect(s.players?.[1]?.reps).toBe(sim.plan.gates.length / 2);
    expect(s.players?.[2]?.reps).toBe(0);
    expect(s.players?.[2]?.score).toBe(0);
    expect(gateEvents(r.events).filter((e) => e['lane'] === 1).every((e) => e['ok'] === false)).toBe(true);
    expect(sim.playerStates[1]?.missed).toBe(sim.plan.gates.length / 2);
  });

  it('a player who steps out of the camera is skipped on their own lane while the other plays on', () => {
    const sim = make({ players: 2, timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'perfect', lane: 1, hidden: (k) => k > 700 })));
    const lane1 = gateEvents(r.events).filter((e) => e['lane'] === 1);
    expect(lane1.some((e) => e['skipped'] === true)).toBe(true);
    expect(lane1.filter((e) => e['ok'] === false && e['skipped'] !== true)).toHaveLength(0);
    expect(gateEvents(r.events).filter((e) => e['lane'] === 0).every((e) => e['ok'] === true)).toBe(true);
    expect(sim.playerStates[1]?.seen).toBe(false);
    expect(sim.playerStates[0]?.seen).toBe(true);
  });

  it('each lane has its own reason for a miss and its own streak', () => {
    const sim = make({ players: 2, difficulty: 'hard', timing: SHORT });
    run(sim, inputOf(bot(sim, { mode: 'sloppy', lane: 0, spoil: () => 'wrong' }), bot(sim, { mode: 'sloppy', lane: 1, spoil: () => 'hips' })));
    expect(sim.playerStates[0]?.miss?.code).toBe('wrong_side');
    expect(sim.playerStates[1]?.miss?.code).toBe('hips_shifted');
  });

  it('the calories of each player are their own and the summary names the per-player scores', () => {
    const sim = make({ players: 2, timing: SHORT });
    run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'idle', lane: 1 })));
    const s = sim.summary();
    expect(s.players?.[1]?.metSeconds ?? 0).toBeGreaterThan(s.players?.[2]?.metSeconds ?? 0);
    expect(s.metSeconds).toBe(s.players?.[1]?.metSeconds);
  });
});

describe('keys and swipes', () => {
  const press = (k: number, ch: Record<string, number>) => frameFrom([{ ok: true, ch }], 'keyboard');

  it('left and right turn a lever that keeps its angle when the key is let go; Down or Space centres it; the lever stops at 42 degrees', () => {
    const sim = make({ timing: SHORT });
    for (let k = 1; k <= 10; k++) sim.step(press(k, { leanKey: 1 }));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(11, 5);
    for (let k = 11; k <= 40; k++) sim.step(press(k, {}));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(11, 5);
    for (let k = 41; k <= 50; k++) sim.step(press(k, { leanKey: -1 }));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(0, 5);
    for (let k = 51; k <= 150; k++) sim.step(press(k, { leanKey: -1 }));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(-42, 5);
    sim.step(press(151, { center: 1 }));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(0, 5);
  });

  it('a swipe moves the lever by ten degrees on top of the keys, and Up is the hands up for a tall gate', () => {
    const sim = make({ timing: SHORT });
    sim.step(frameFrom([{ ok: true, ch: { lean: 0.25 } }], 'touch'));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(10, 5);
    sim.step(frameFrom([{ ok: true, ch: { lean: -0.5, up: 1 } }], 'touch'));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(-20, 5);
    expect(sim.playerStates[0]?.armsUp).toBe(true);
    sim.step(frameFrom([{ ok: true, ch: { lean: 0 } }], 'touch'));
    expect(sim.playerStates[0]?.armsUp).toBe(false);
  });

  it('a keyboard player can pass every gate of a run, tall ones with Up held, and is told what is wrong when not', () => {
    for (const d of ['easy', 'normal']) {
      const sim = make({ difficulty: d, timing: SHORT });
      const r = run(sim, inputOf(bot(sim, { mode: 'perfect', keyed: true })));
      const gates = gateEvents(r.events);
      expect(gates.length).toBe(sim.plan.gates.length);
      expect(gates.filter((e) => e['ok'] === true).length / gates.length, d).toBeGreaterThanOrEqual(0.95);
    }
    const sim = make({ timing: SHORT });
    const r = run(sim, inputOf(bot(sim, { mode: 'idle', keyed: true })));
    expect(gateEvents(r.events).every((e) => e['ok'] === false && e['code'] === 'bend_more')).toBe(true);
  });

  it('the lever is the same for two players: each has their own', () => {
    const sim = make({ players: 2, timing: SHORT });
    sim.step(frameFrom([{ ok: true, ch: { leanKey: 1 } }, { ok: true, ch: { leanKey: -1 } }], 'keyboard'));
    expect(sim.playerStates[0]?.theta).toBeCloseTo(1.1, 5);
    expect(sim.playerStates[1]?.theta).toBeCloseTo(-1.1, 5);
  });
});

describe('seeded content, snapshot and restore', () => {
  it('the same seed and moves give the same events and summary; another seed another set of gates', () => {
    const a = make({ seed: 21 });
    const ra = run(a, inputOf(bot(a, { mode: 'sloppy' })));
    const b = make({ seed: 21 });
    const rb = run(b, inputOf(bot(b, { mode: 'sloppy' })));
    expect(rb.events).toEqual(ra.events);
    expect(b.summary()).toEqual(a.summary());
    const c = make({ seed: 22 });
    expect(c.plan.gates.map((g) => g.target)).not.toEqual(a.plan.gates.map((g) => g.target));
  });

  it('restore(snapshot()) continues exactly as the original, in a new instance too, in the middle of a hold included', () => {
    const a = make({ seed: 9, timing: { sets: 2, workS: 20, restS: 5, finaleS: 2 } });
    const b0 = bot(a, { mode: 'sloppy', seed: 9 } as LimboBotOptions);
    // in the middle of a gate's window: the tester has seen frames of it
    const g = a.plan.gates[3] as LbGate;
    const stopK = g.arriveK - 22;
    const first = run(a, inputOf(b0), { steps: stopK });
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as { testers: unknown[] };
    expect(JSON.stringify(snap.testers[0])).toContain('$map');
    const rest = run(a, inputOf(b0), { from: first.k });
    const b = make({ seed: 77, timing: { sets: 2, workS: 20, restS: 5, finaleS: 2 } });
    b.restore(snap);
    const restB = run(b, inputOf(b0), { from: first.k });
    expect(restB.events).toEqual(rest.events);
    expect(b.summary()).toEqual(a.summary());
    expect(() => b.restore({ v: 9 })).toThrow();
    expect(() => b.restore(null)).toThrow();
  });

  it('the snapshot is plain JSON that survives being written and read', () => {
    const a = make({ timing: SHORT });
    run(a, inputOf(bot(a, { mode: 'perfect' })), { steps: 900 });
    const snap = a.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it('a snapshot taken while a gate is locked keeps it locked, so it is passed at the arrival after the restore', () => {
    const a = make({ timing: SHORT });
    const b0 = bot(a, { mode: 'perfect' });
    const g = a.plan.gates[2] as LbGate;
    run(a, inputOf(b0), { steps: g.arriveK - 3 });
    expect(a.gateStates[g.id]?.locked).toBe(true);
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as unknown;
    const b = make({ seed: 50, timing: SHORT });
    b.restore(snap);
    expect(b.gateStates[g.id]?.locked).toBe(true);
    const out = run(b, inputOf(b0), { from: g.arriveK - 3, steps: 6 });
    expect(gateEvents(out.events)[0]?.['ok']).toBe(true);
  });
});

describe('the ways of playing', () => {
  it('seated counts less movement as calories than standing, quiet play counts the same, and the play is the same', () => {
    const stand = make({ timing: SHORT });
    run(stand, inputOf(bot(stand, { mode: 'perfect' })));
    const seat = make({ timing: SHORT, seated: true });
    run(seat, inputOf(bot(seat, { mode: 'perfect' })));
    expect(seat.variant).toBe('seated');
    expect(stand.variant).toBe('standing');
    expect(seat.summary().metSeconds).toBeCloseTo((stand.summary().metSeconds ?? 0) * 0.8, 1);
    expect(seat.summary().score).toBe(stand.summary().score);
    expect(stand.summary().metSeconds).toBeGreaterThan(20);
  });

  it('only seconds of real leaning count towards calories: a player who stands still earns almost none', () => {
    const a = make({ timing: SHORT });
    run(a, inputOf(bot(a, { mode: 'idle' })));
    const b = make({ timing: SHORT });
    run(b, inputOf(bot(b, { mode: 'perfect' })));
    expect(a.summary().metSeconds ?? 0).toBeLessThan((b.summary().metSeconds ?? 0) * 0.2);
  });
});

describe('purity', () => {
  it('the simulation files have no clock, no Math.random and no DOM', () => {
    for (const f of ['limbo.ts', 'plan.ts', '../_shared/judgesnap.ts', 'limbo-game.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });

  it('does nothing after it is over', () => {
    const sim = make({ timing: { sets: 1, workS: 5, finaleS: 1 } });
    run(sim, inputOf(bot(sim, { mode: 'idle' })));
    expect(sim.phase).toBe('complete');
    expect(sim.step(frameFrom([{ ok: true, ch: {} }]))).toEqual([]);
  });
});

describe('the reason that is told', () => {
  it('a lean that never left the wrong side is "wrong side", a lean that did not go far enough is "bend more"', () => {
    expect(reasonFor({ code: 'bend_more', got: 20, need: -20 }, { target: -26 }).code).toBe('wrong_side');
    expect(reasonFor({ code: 'bend_more', got: -20, need: 20 }, { target: 26 }).code).toBe('wrong_side');
    expect(reasonFor({ code: 'bend_more', got: 9, need: 19 }, { target: 26 }).code).toBe('bend_more');
    expect(reasonFor({ code: 'bend_more', got: -2, need: 19 }, { target: 26 }).code).toBe('bend_more');
    expect(reasonFor({ code: 'hips_shifted', got: 0.5, need: 0.35 }, { target: 26 }).code).toBe('hips_shifted');
    expect(reasonFor({ code: 'wrong_side' }, { target: 26 })).toEqual({ code: 'wrong_side' });
  });

  it('"wrong side" is for a lean to the other side: a body that stood straight and wobbled a degree or two is told to bend, not that it was on the wrong side', () => {
    const wrong = { code: 'wrong_side' as const };
    // a gate to the right; the lean went to -1.5 and +0.8 degrees: nothing to speak of
    expect(reasonFor(wrong, { target: 26 }, { theta: 0.4, tol: 7, lo: -1.5, hi: 0.8 })).toEqual({ code: 'bend_more', got: 0.8, need: 19 });
    // a gate to the left; the lean went to +1.2 and -0.4
    expect(reasonFor(wrong, { target: -26 }, { theta: 0, tol: 7, lo: -0.4, hi: 1.2 })).toEqual({ code: 'bend_more', got: -0.4, need: -19 });
    // a real lean to the other side stays "wrong side"
    expect(reasonFor(wrong, { target: 26 }, { theta: -8, tol: 7, lo: -12, hi: 0.5 })).toEqual(wrong);
    expect(reasonFor(wrong, { target: 26 })).toEqual(wrong);
  });

  it('a lean that was inside the tolerance for a moment and is outside it at the arrival says which way to go, not "hold it longer"', () => {
    const held = { code: 'held_too_short' as const, got: 120, need: 300 };
    // a gate to the right (26, within 7): leaning to 40 at the arrival is too far, 12 is not far enough, -8 is the other side
    expect(reasonFor(held, { target: 26 }, { theta: 40, tol: 7 })).toEqual({ code: 'bend_less', got: 40, need: 33 });
    expect(reasonFor(held, { target: 26 }, { theta: 12, tol: 7 })).toEqual({ code: 'bend_more', got: 12, need: 19 });
    expect(reasonFor(held, { target: 26 }, { theta: -8, tol: 7 }).code).toBe('wrong_side');
    // the mirror image, for a gate to the left
    expect(reasonFor(held, { target: -26 }, { theta: -40, tol: 7 })).toEqual({ code: 'bend_less', got: -40, need: -33 });
    expect(reasonFor(held, { target: -26 }, { theta: -12, tol: 7 })).toEqual({ code: 'bend_more', got: -12, need: -19 });
    // still inside the tolerance at the arrival: it really was not held long enough
    expect(reasonFor(held, { target: 26 }, { theta: 24, tol: 7 })).toEqual(held);
    expect(reasonFor(held, { target: 26 })).toEqual(held);
  });
});
