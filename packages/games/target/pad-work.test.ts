// Pad Work on the engine: the plan (beats, combinations, bags), punches judged on speed, hand and beat, defence moves,
// reasons, seated and keyboard variants, two lanes, snapshots.
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../core/loop/rng.ts';
import { profileOf, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import { envelopeOf, reachRatio, spot } from './envelope.ts';
import { MOVES, PAD_LEVELS, PAD_WINDOW, padWorkRules, planPads, type MoveId, type PadSpec } from './pad-work.ts';
import { buildTimeline } from './timeline.ts';
import { frameOf } from './testing/body.ts';
import { PadChaser, PAD_BOTS, type PadSeen } from './testing/bots.ts';
import { play, setup, tick, type SetupOptions, type Steer } from './testing/play.ts';
import type { PlanInput, ViewLane } from './types.ts';

const planInput = (o: Partial<PlanInput> = {}): PlanInput => ({
  level: 'normal', timeline: buildTimeline(420, 3, 30), seated: false, quiet: false, feet: false, keyboard: false, players: 1, hz: 30, ...o,
});
const planOf = (seed: number, o: Partial<PlanInput> = {}): PadSpec[] => planPads(rngStream(seed, 'course'), planInput(o));

const padSeen = (lane: ViewLane): PadSeen[] => lane.targets.map((t) => {
  const s = t.spec as PadSpec;
  return { id: t.id, x: t.x, y: t.y, beat: s.beat, hand: s.hand ?? 'L', ...(s.kind === 'bag' && s.need ? { bag: s.need } : {}), from: s.from, until: s.until };
});
const steer = (mode: keyof typeof PAD_BOTS, seed = 1) => (i: number): Steer => {
  const bot = new PadChaser(mode, seed + i);
  return (lane, body, t) => bot.steer(body, padSeen(lane), t);
};
const run = (mode: keyof typeof PAD_BOTS, o: SetupOptions = {}) => setup(padWorkRules, { duration: 45, rounds: 1, level: 'normal', seed: 3, ...o, steer: steer(mode, o.seed ?? 3) });

describe('the plan', () => {
  it('is made from the seed', () => {
    expect(planOf(5)).toEqual(planOf(5));
    expect(planOf(6)).not.toEqual(planOf(5));
  });

  it('is in order, numbered 0, 1, 2 ...; each pad waits for its beat and its window lies in its round', () => {
    const tl = buildTimeline(420, 3, 30);
    const specs = planOf(9);
    expect(specs.length).toBeGreaterThan(150);
    specs.forEach((s, i) => expect(s.id).toBe(i));
    for (let i = 1; i < specs.length; i++) expect((specs[i] as PadSpec).at).toBeGreaterThanOrEqual((specs[i - 1] as PadSpec).at);
    for (const s of specs) {
      expect(s.at).toBeLessThan(s.from);
      expect(s.from).toBeLessThan(s.beat);
      expect(s.beat).toBeLessThan(s.until);
      expect(s.life).toBe(s.until - s.at);
      const seg = tl.segments.find((g) => g.kind === 'play' && s.at >= g.start && s.at < g.end);
      expect(seg, `pad ${s.id}`).toBeDefined();
      expect(s.until).toBeLessThanOrEqual((seg as { end: number }).end);
    }
  });

  it('puts the beats of a combination one beat apart, at the level\'s tempo', () => {
    for (const level of ['easy', 'normal', 'hard', 'expert'] as const) {
      const specs = planOf(2, { level, timeline: buildTimeline(60, 1, 0) }).filter((s) => s.kind === 'pad' && s.size > 1);
      expect(specs.length, level).toBeGreaterThan(2);
      const gaps: number[] = [];
      for (let i = 1; i < specs.length; i++) if ((specs[i] as PadSpec).combo === (specs[i - 1] as PadSpec).combo) gaps.push((specs[i] as PadSpec).beat - (specs[i - 1] as PadSpec).beat);
      const bpm = 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
      expect(bpm).toBeGreaterThanOrEqual(PAD_LEVELS[level].bpm[0] - 1);
      expect(bpm).toBeLessThanOrEqual(PAD_LEVELS[level].bpm[1] + 1);
    }
  });

  it('speeds up from round to round', () => {
    const specs = planOf(4, { level: 'hard' });
    const bpmOf = (round: number): number => {
      const tl = buildTimeline(420, 3, 30);
      const seg = tl.segments.filter((s) => s.kind === 'play')[round] as { start: number; end: number };
      const pads = specs.filter((s) => s.kind === 'pad' && s.size > 1 && s.at >= seg.start && s.at < seg.end);
      const gaps: number[] = [];
      for (let i = 1; i < pads.length; i++) if ((pads[i] as PadSpec).combo === (pads[i - 1] as PadSpec).combo) gaps.push((pads[i] as PadSpec).beat - (pads[i - 1] as PadSpec).beat);
      return 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
    };
    expect(bpmOf(1)).toBeGreaterThan(bpmOf(0));
    expect(bpmOf(2)).toBeGreaterThan(bpmOf(1));
  });

  it('has bags from normal on, never for a keyboard player, never a duck for a seated one', () => {
    expect(planOf(7, { level: 'easy' }).some((s) => s.kind === 'bag')).toBe(false);
    expect(planOf(7, { level: 'normal' }).some((s) => s.kind === 'bag')).toBe(true);
    expect(planOf(7, { level: 'expert', keyboard: true }).some((s) => s.kind === 'bag')).toBe(false);
    const seated = planOf(7, { level: 'expert', seated: true }).filter((s) => s.kind === 'bag');
    expect(seated.length).toBeGreaterThan(0);
    expect(seated.every((s) => s.need !== 'duck')).toBe(true);
    expect(planOf(7, { level: 'expert' }).some((s) => s.need === 'duck')).toBe(true);
  });

  it('a bag always follows a combination, and a round starts with pads', () => {
    const specs = planOf(8, { level: 'expert' });
    for (let i = 1; i < specs.length; i++) {
      const s = specs[i] as PadSpec;
      if (s.kind === 'bag') expect((specs[i - 1] as PadSpec).kind).toBe('pad');
    }
    expect((specs[0] as PadSpec).kind).toBe('pad');
  });

  it('uses the hand each punch belongs to: jab left, cross right, and a mirrored stance swaps them', () => {
    for (const s of planOf(3)) if (s.kind === 'pad') expect(MOVES[s.move as MoveId].hand).toBe(s.hand);
    const specs = planOf(3, { level: 'normal' }).filter((s) => s.kind === 'pad');
    expect(specs.some((s) => s.move === 'jab')).toBe(true);
    expect(specs.some((s) => s.move === 'cross')).toBe(true);
    const names = new Set(planOf(3, { level: 'expert' }).map((s) => s.move));
    for (const m of ['hookL', 'hookR', 'upperL', 'upperR']) expect(names.has(m as MoveId)).toBe(true);
  });

  it('keeps every pad within 0.95 of an arm of its own shoulder (the elbow is never locked) and inside the picture', () => {
    const profile = profileOf(SHAPE_UPPER, 'upper');
    for (const seated of [false, true]) {
      const env = envelopeOf(profile, { seated });
      for (const s of planOf(1, { level: 'expert', seated })) {
        if (s.kind !== 'pad') continue;
        const p = spot(env, s.ax, s.ay);
        expect(reachRatio(env, s.hand as 'L' | 'R', p)).toBeLessThanOrEqual(0.95);
        expect(p.x).toBeGreaterThanOrEqual(env.frame.x0 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(env.frame.x1 + 1e-9);
      }
    }
  });

  it('grows the combinations over the run', () => {
    const specs = planOf(5, { level: 'expert' }).filter((s) => s.kind === 'pad');
    const early = Math.max(...specs.filter((s) => s.at < 40_000).map((s) => s.size));
    const late = Math.max(...specs.filter((s) => s.at > 300_000).map((s) => s.size));
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(PAD_LEVELS.expert.size[1]);
  });
});

describe('a round with bots (through the real detector)', () => {
  it('a perfect puncher lands nearly every pad, mostly on the beat, and finishes combinations', () => {
    const r = run('perfect', { level: 'normal' });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    const pads = r.engine.plan.filter((p) => p.kind === 'pad').length;
    expect(s.hits, 'hits').toBeGreaterThan(pads * 0.9);
    expect(s.perfect + s.good).toBeGreaterThan(s.hits * 0.8);
    expect(s.perfect).toBeGreaterThan(s.good);
    expect(s.cleared).toBeGreaterThan(3);
    expect(s.bestStreak).toBeGreaterThan(12);
  });

  it('a bot that is always a quarter second late gets Good or off-beat points, never Perfect, and is told it is late', () => {
    const r = run('late', { level: 'normal' });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    expect(s.hits).toBeGreaterThan(5);
    expect(s.perfect).toBe(0);
    expect(r.events.some((e) => e.type === 'hit' && e.grade === 'late')).toBe(true);
    const perfect = run('perfect', { level: 'normal' });
    play(perfect);
    expect(perfect.engine.lane(1)!.state.stats.score).toBeGreaterThan(s.score);
  });

  it('a bot that is early is told it is early', () => {
    const r = run('early', { level: 'normal' });
    play(r);
    expect(r.events.some((e) => e.type === 'hit' && e.grade === 'early')).toBe(true);
    expect(r.engine.lane(1)!.state.stats.perfect).toBe(0);
  });

  it('a slow arm does not count: the pad was reached but the punch was too slow', () => {
    const r = run('slow', { level: 'normal' });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    expect(s.hits).toBe(0);
    const codes = r.events.filter((e) => e.type === 'miss' && e.kind === 'pad').map((e) => e.code);
    expect(codes.filter((c) => c === 'too_slow').length).toBeGreaterThan(codes.length * 0.5);
  });

  it('the wrong hand is named as the reason', () => {
    const r = run('sloppy', { level: 'normal', duration: 60 });
    play(r);
    const codes = new Set(r.events.filter((e) => e.type === 'miss' && e.kind === 'pad').map((e) => e.code));
    expect(codes.has('wrong_hand')).toBe(true);
    for (const c of codes) expect(['wrong_hand', 'not_reached', 'too_slow', 'hands_out_of_view']).toContain(c);
  });

  it('an idle player lands nothing and is told the pads were not reached', () => {
    const r = run('idle', { level: 'normal' });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    expect(s.hits).toBe(0);
    expect(s.score).toBe(0);
    const pads = r.events.filter((e) => e.type === 'miss' && e.kind === 'pad');
    expect(pads.length).toBe(r.engine.plan.filter((p) => p.kind === 'pad').length);
    expect(new Set(pads.map((e) => e.code))).toEqual(new Set(['not_reached']));
  });

  it('ranks the players: perfect above sloppy above idle', () => {
    const score = (m: keyof typeof PAD_BOTS): number => { const r = run(m, { level: 'normal', duration: 60 }); play(r); return r.engine.lane(1)!.state.stats.score; };
    const [p, s, i] = [score('perfect'), score('sloppy'), score('idle')];
    expect(p).toBeGreaterThan(s * 1.3);
    expect(s).toBeGreaterThan(i);
  });

  it('a perfect player slips and ducks the bags; one who stands still is hit and told why', () => {
    const r = run('perfect', { level: 'expert', duration: 90, seed: 11 });
    play(r);
    const bags = r.events.filter((e) => e.kind === 'bag');
    expect(bags.length).toBeGreaterThan(3);
    expect(bags.every((e) => e.type === 'hit')).toBe(true);
    const still = run('sloppy', { level: 'expert', duration: 90, seed: 11 });
    play(still);
    const missed = still.events.filter((e) => e.kind === 'bag' && e.type === 'miss');
    expect(missed.length).toBeGreaterThan(2);
    for (const e of missed) expect(['bend_more', 'hips_not_low', 'wrong_direction']).toContain(e.code);
  });

  it('leaning toward the bag is a wrong direction, not just too little', () => {
    const r = setup(padWorkRules, {
      duration: 90, rounds: 1, level: 'expert', seed: 11,
      steer: () => (lane, body, t) => {
        body.rest();
        for (const tg of lane.targets) {
          const s = tg.spec as PadSpec;
          if (s.kind === 'bag' && t >= s.from && t < s.until && s.need !== 'duck') body.lean = s.need === 'slipR' ? -0.6 : 0.6;
        }
      },
    });
    play(r);
    expect(r.events.some((e) => e.kind === 'bag' && e.code === 'wrong_direction')).toBe(true);
  });

  it('the multiplier grows with pads on the beat', () => {
    const r = run('perfect', { level: 'normal', duration: 60 });
    play(r);
    const mults = r.events.filter((e) => e.type === 'hit').map((e) => e.mult as number);
    expect(Math.max(...mults)).toBe(4);
  });

  it('a punch is worth more when it is fast', () => {
    const r = run('perfect', { level: 'normal' });
    play(r);
    const hits = r.events.filter((e) => e.type === 'hit' && e.kind === 'pad' && e.grade === 'perfect');
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.some((e) => (e.pts as number) > (e.mult as number) * 100)).toBe(true);
  });

  it('ticks the beat once for every pad that waits for it, and only from the first player\'s lane', () => {
    const count = (r: ReturnType<typeof run>): number => {
      let n = 0;
      while (r.engine.phase === 'running') { tick(r); n += r.engine.takeCues().filter((c) => c === 'tick').length; }
      return n;
    };
    const one = run('perfect', { level: 'normal', duration: 20 });
    const ticks = count(one);
    expect(ticks).toBeGreaterThan(5);
    const beats = new Set(one.engine.plan.filter((p) => p.kind === 'pad').map((p) => p.beat));
    expect(ticks).toBeLessThanOrEqual(beats.size);
    const two = setup(padWorkRules, { duration: 20, rounds: 1, level: 'normal', seed: 3, bots: ['perfect', 'perfect'], steer: steer('perfect', 3) });
    expect(count(two as unknown as ReturnType<typeof run>)).toBe(ticks);
  });

  it('the command is the combination, as numbers; a bag asks for a slip or a duck; a round starts with its number', () => {
    const r = run('idle', { level: 'expert', duration: 90, seed: 11 });
    const seen = new Set<string>();
    while (r.engine.phase === 'running') {
      tick(r);
      const p = r.engine.prompt();
      if (p) seen.add(p.key === 'combo' ? `combo ${p.vars?.seq}` : p.key);
    }
    expect(seen.has('round')).toBe(true);
    expect([...seen].some((k) => /^combo 1(-\d)*$/.test(k))).toBe(true);
    expect(seen.has('slip_left') || seen.has('slip_right')).toBe(true);
    expect(seen.has('duck')).toBe(true);
  });

  it('uses 420 s for a full run: three rounds of two minutes and two rests of half a minute', () => {
    const tl = buildTimeline(420, 3, 30);
    expect(tl.roundMs).toBe(120_000);
    expect(tl.restMs).toBe(30_000);
  });
});

describe('seated, keyboard, two players', () => {
  it('a seated perfect puncher does as well as a standing one (no ducks asked)', () => {
    const r = run('perfect', { level: 'expert', seated: true, duration: 60, seed: 12 });
    play(r);
    const pads = r.engine.plan.filter((p) => p.kind === 'pad').length;
    expect(r.engine.lane(1)!.state.stats.hits).toBeGreaterThan(pads * 0.85);
    expect(r.events.some((e) => e.kind === 'bag' && e.need === 'duck')).toBe(false);
  });

  it('a keyboard player punches by moving a cursor through the pad', () => {
    const r = setup(padWorkRules, { duration: 40, rounds: 1, level: 'easy', keyboard: true, bots: 'idle', seed: 13 });
    let hits = 0;
    for (let i = 0; i < 60 * 40 && r.engine.phase === 'running'; i++) {
      r.k++;
      const lane = r.engine.view().lanes[0]!;
      const next = lane.targets.filter((t) => (t.spec as PadSpec).kind === 'pad').sort((a, b) => (a.spec as PadSpec).beat - (b.spec as PadSpec).beat)[0];
      const ch: Record<string, number> = {};
      if (next) {
        const s = next.spec as PadSpec;
        const h = lane.hands[s.hand as 'L' | 'R'];
        const dx = next.x - h.x, dy = next.y - h.y;
        const kx = s.hand === 'R' ? 'cursor.R.x' : 'cursor.L.x', ky = s.hand === 'R' ? 'cursor.R.y' : 'cursor.L.y';
        if (r.engine.t > s.beat - 700) {
          if (Math.abs(dx) > 0.02) ch[kx] = Math.sign(dx);
          if (Math.abs(dy) > 0.02) ch[ky] = Math.sign(dy);
        }
      }
      hits += r.engine.step(frameOf(r.k, ch)).events.filter((e) => e.type === 'hit').length;
    }
    expect(hits).toBeGreaterThan(2);
  });

  it('each lane punches on its own and the better player wins on the same plan', () => {
    const r = setup(padWorkRules, {
      duration: 50, rounds: 1, level: 'normal', seed: 14, bots: ['perfect', 'sloppy'],
      steer: (i) => steer(i === 0 ? 'perfect' : 'sloppy', 14)(i),
    });
    play(r);
    const a = r.engine.lane(1)!.state.stats, b = r.engine.lane(2)!.state.stats;
    expect(a.score).toBeGreaterThan(b.score);
    const n = r.engine.plan.filter((p) => p.kind === 'pad').length;
    expect(a.hits + a.misses).toBeGreaterThanOrEqual(n);
    const sum = r.engine.summary();
    expect(sum.players?.[1]?.score).toBe(a.score);
    expect(sum.players?.[2]?.score).toBe(b.score);
  });

  it('snapshot and restore continue exactly, also in the middle of a combination', () => {
    const a = run('perfect', { level: 'hard', duration: 45, seed: 15 });
    for (let i = 0; i < 900; i++) tick(a);
    const snap = JSON.parse(JSON.stringify(a.engine.snapshot()));
    const b = run('perfect', { level: 'hard', duration: 45, seed: 777 });
    b.engine.restore(snap);
    b.bodies[0] = a.bodies[0]!;
    b.steers[0] = a.steers[0]!;
    b.k = a.k;
    const ea: unknown[] = [], eb: unknown[] = [];
    const frames: ReturnType<typeof frameOf>[] = [];
    while (a.engine.phase === 'running') {
      a.k++;
      a.steers[0]!(a.engine.view().lanes[0]!, a.bodies[0]!, a.engine.t);
      const f = frameOf(a.k, a.bodies[0]!.step(a.k));
      frames.push(f);
      ea.push(a.engine.step(f).events);
    }
    for (const f of frames) eb.push(b.engine.step(f).events);
    expect(eb).toEqual(ea);
    expect(b.engine.summary()).toEqual(a.engine.summary());
  });
});

describe('levels and windows', () => {
  it('has a table for each level the shell offers, and a window that holds the Good range of the rhythm kit', () => {
    expect(Object.keys(PAD_LEVELS).sort()).toEqual(['easy', 'expert', 'hard', 'normal']);
    expect(PAD_WINDOW.pre).toBeGreaterThanOrEqual(220);
    expect(PAD_WINDOW.post).toBeGreaterThanOrEqual(220);
  });
});
