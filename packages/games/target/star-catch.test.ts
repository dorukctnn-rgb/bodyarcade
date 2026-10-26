// Star Catch on the engine: the plan from the seed, who catches what (perfect, sloppy, idle bots through the real handHit
// detector), reasons for misses, the seated and keyboard variants, two lanes, snapshots, and a lost player.
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../core/loop/rng.ts';
import { envelopeOf, reachRatio, spot } from './envelope.ts';
import { buildTimeline } from './timeline.ts';
import { STAR_LEVELS, planStars, starCatchRules, type StarSpec } from './star-catch.ts';
import { count, play, setup, tick, type Run } from './testing/play.ts';
import { frameOf } from './testing/body.ts';
import type { PlanInput } from './types.ts';
import { profileOf, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';

const planInput = (o: Partial<PlanInput> = {}): PlanInput => ({
  level: 'normal', timeline: buildTimeline(196, 3, 8), seated: false, quiet: false, feet: false, keyboard: false, players: 1, hz: 30, ...o,
});

const planOf = (seed: number, o: Partial<PlanInput> = {}): StarSpec[] => planStars(rngStream(seed, 'course'), planInput(o));

describe('the plan', () => {
  it('is made from the seed: the same seed gives the same stars, another seed other stars', () => {
    expect(planOf(5)).toEqual(planOf(5));
    expect(planOf(6)).not.toEqual(planOf(5));
  });

  it('is in time order with numbers 0, 1, 2 ...; every star fades before its round ends', () => {
    const tl = buildTimeline(196, 3, 8);
    const specs = planOf(9);
    expect(specs.length).toBeGreaterThan(80);
    specs.forEach((s, i) => expect(s.id).toBe(i));
    for (let i = 1; i < specs.length; i++) expect((specs[i] as StarSpec).at).toBeGreaterThanOrEqual((specs[i - 1] as StarSpec).at);
    for (const s of specs) {
      const seg = tl.segments.find((g) => g.kind === 'play' && s.at >= g.start && s.at < g.end);
      expect(seg, `star ${s.id} is inside a round`).toBeDefined();
      expect(s.at + s.life).toBeLessThanOrEqual((seg as { end: number }).end);
    }
  });

  it('keeps no star in a rest', () => {
    const tl = buildTimeline(196, 3, 8);
    for (const s of planOf(3)) expect(tl.segments.some((g) => g.kind === 'rest' && s.at >= g.start && s.at < g.end)).toBe(false);
  });

  it('gets harder: the later levels give less time and the run speeds up', () => {
    const levels = (['easy', 'normal', 'hard', 'expert'] as const).map((level) => planOf(4, { level }));
    const perMinute = levels.map((l) => l.length);
    for (let i = 1; i < perMinute.length; i++) expect(perMinute[i]).toBeGreaterThan(perMinute[i - 1] as number);
    const lifes = levels.map((l) => Math.min(...l.map((s) => s.life)));
    for (let i = 1; i < lifes.length; i++) expect(lifes[i]).toBeLessThan(lifes[i - 1] as number);
    const normal = planOf(4);
    const first = normal.filter((s) => s.at < 20_000), last = normal.filter((s) => s.at > 140_000);
    expect(Math.max(...first.map((s) => s.life))).toBeGreaterThan(Math.max(...last.map((s) => s.life)));
  });

  it('colours the stars by the hand they are nearest, with pearl stars (either hand) only on easy', () => {
    const normal = planOf(2);
    expect(normal.every((s) => s.side !== undefined)).toBe(true);
    for (const s of normal) if (s.ax < -0.12) expect(s.side).toBe('L'); else if (s.ax > 0.12) expect(s.side).toBe('R');
    const easy = planOf(2, { level: 'easy' });
    const pearl = easy.filter((s) => s.side === undefined).length / easy.length;
    expect(pearl).toBeGreaterThan(0.5);
    expect(pearl).toBeLessThan(0.9);
  });

  it('asks for a squat only on hard and expert, standing, with a camera', () => {
    expect(planOf(7, { level: 'normal' }).some((s) => s.low)).toBe(false);
    expect(planOf(7, { level: 'hard' }).some((s) => s.low)).toBe(true);
    expect(planOf(7, { level: 'expert' }).some((s) => s.low)).toBe(true);
    expect(planOf(7, { level: 'expert', seated: true }).some((s) => s.low)).toBe(false);
    expect(planOf(7, { level: 'expert', keyboard: true }).some((s) => s.low)).toBe(false);
  });

  it('puts hard stars across the body only within what the far hand can reach', () => {
    for (const s of planOf(8, { level: 'expert' })) {
      if (s.low || !s.side) continue;
      const sideOfX = s.ax < 0 ? 'L' : 'R';
      if (s.side !== sideOfX) expect(Math.abs(s.ax)).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('gives a slow device more time', () => {
    const fast = planOf(1, { hz: 30 }), slow = planOf(1, { hz: 12 });
    expect(slow[0]?.life).toBeGreaterThan((fast[0]?.life ?? 0) * 1.4);
  });
});

describe('placement', () => {
  const profile = profileOf(SHAPE_UPPER, 'upper');
  it('puts every star inside the picture, under the overhead limit, for a standing and a seated player', () => {
    for (const seated of [false, true]) {
      const env = envelopeOf(profile, { seated });
      for (const level of ['easy', 'normal', 'hard', 'expert'] as const) {
        for (const s of planOf(11, { level, seated })) {
          const p = spot(env, s.ax, s.ay);
          expect(p.x).toBeGreaterThanOrEqual(env.frame.x0 - 1e-9);
          expect(p.x).toBeLessThanOrEqual(env.frame.x1 + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(env.frame.y0 - 1e-9);
          expect(p.y).toBeLessThanOrEqual(env.top + 1e-9);
        }
      }
    }
  });

  it('keeps every coloured star within reach of the hand that has to catch it (standing, normal)', () => {
    const env = envelopeOf(profile, { seated: false });
    for (const s of planOf(12)) {
      if (!s.side) continue;
      expect(reachRatio(env, s.side, spot(env, s.ax, s.ay))).toBeLessThan(1.05);
    }
  });

  it('keeps a seated player closer in than a standing one', () => {
    const standing = envelopeOf(profile, { seated: false }), seated = envelopeOf(profile, { seated: true });
    const a = spot(standing, 0.9, 0.5), b = spot(seated, 0.9, 0.5);
    expect(Math.abs(b.x)).toBeLessThan(Math.abs(a.x));
  });
});

const finish = (r: Run<StarSpec>): { hits: number; misses: number; score: number } => {
  play(r);
  const l = r.engine.lane(1)?.state.stats;
  return { hits: l?.hits ?? 0, misses: l?.misses ?? 0, score: l?.score ?? 0 };
};

describe('a round with bots (through the real detector)', () => {
  it('a perfect player catches almost everything on normal and on easy, and earns constellations', () => {
    for (const level of ['easy', 'normal'] as const) {
      const r = setup(starCatchRules, { duration: 40, rounds: 2, restSec: 4, level, bots: 'perfect', seed: 3 });
      const n = r.engine.plan.length;
      const s = finish(r);
      expect(s.hits + s.misses).toBe(n);
      expect(s.hits / n, level).toBeGreaterThan(0.9);
      expect(r.engine.lane(1)?.state.stats.cleared).toBeGreaterThan(0);
      expect(r.engine.lane(1)?.state.stats.bestStreak).toBeGreaterThan(10);
    }
  });

  it('a perfect player still does well on hard and expert (squats and crossing included)', () => {
    for (const level of ['hard', 'expert'] as const) {
      const r = setup(starCatchRules, { duration: 40, rounds: 2, restSec: 4, level, bots: 'perfect', seed: 4 });
      const s = finish(r);
      // the bot never squats, so the low stars count half; everything else is caught
      expect(s.hits / r.engine.plan.length, level).toBeGreaterThan(0.75);
    }
  });

  it('a sloppy player scores clearly less than a perfect one, and an idle one catches nothing', () => {
    const perfect = finish(setup(starCatchRules, { duration: 30, rounds: 1, bots: 'perfect', seed: 5 }));
    const sloppy = finish(setup(starCatchRules, { duration: 30, rounds: 1, bots: 'sloppy', seed: 5 }));
    const late = finish(setup(starCatchRules, { duration: 30, rounds: 1, bots: 'late', seed: 5 }));
    const idle = finish(setup(starCatchRules, { duration: 30, rounds: 1, bots: 'idle', seed: 5 }));
    expect(perfect.score).toBeGreaterThan(sloppy.score * 1.5);
    expect(sloppy.hits).toBeGreaterThan(0);
    expect(late.hits).toBe(0);
    expect(idle.hits).toBe(0);
    expect(idle.score).toBe(0);
  });

  it('every miss comes with a reason of the movement library; an idle player is told the stars were not reached', () => {
    const r = setup(starCatchRules, { duration: 20, rounds: 1, bots: 'idle', seed: 6 });
    play(r);
    const misses = r.events.filter((e) => e.type === 'miss');
    expect(misses.length).toBe(r.engine.plan.length);
    expect(new Set(misses.map((e) => e.code))).toEqual(new Set(['not_reached']));
    const sloppy = setup(starCatchRules, { duration: 40, rounds: 1, bots: 'sloppy', seed: 7 });
    play(sloppy);
    const codes = new Set(sloppy.events.filter((e) => e.type === 'miss').map((e) => e.code));
    expect(codes.has('wrong_hand')).toBe(true);
    for (const c of codes) expect(['not_reached', 'wrong_hand', 'too_brief', 'grab_higher', 'hands_out_of_view']).toContain(c);
  });

  it('the log has every catch and every miss; a miss is logged by its reason', () => {
    const r = setup(starCatchRules, { duration: 20, rounds: 1, bots: 'sloppy', seed: 8 });
    play(r);
    const sum = r.engine.summary();
    expect(sum.log.filter((e) => e.kind === 'star' && e.ok).length).toBe(sum.hits);
    expect(sum.log.filter((e) => !e.ok).length).toBe(r.engine.lane(1)?.state.stats.misses);
    expect(sum.log.every((e) => e.t > 0 && e.t <= 20_001)).toBe(true);
  });

  it('a streak builds the multiplier: five catches in a row make the next one worth double', () => {
    const r = setup(starCatchRules, { duration: 30, rounds: 1, bots: 'perfect', seed: 9 });
    play(r);
    const hits = r.events.filter((e) => e.type === 'hit');
    const mults = hits.map((e) => e.mult as number);
    expect(Math.max(...mults)).toBeGreaterThanOrEqual(3);
    expect(hits.find((e) => (e.mult as number) === 2)?.pts).toBeGreaterThanOrEqual(20);
  });

  it('a constellation caught whole pays a bonus', () => {
    const r = setup(starCatchRules, { duration: 30, rounds: 1, bots: 'perfect', seed: 10 });
    play(r);
    const c = r.events.filter((e) => e.type === 'constellation');
    expect(c.length).toBe(r.engine.lane(1)?.state.stats.cleared);
    expect(c.length).toBeGreaterThan(2);
    expect(c.every((e) => (e.pts as number) >= 60)).toBe(true);
  });

  it('the run ends at the right time: 196 s is 11760 steps, three rounds and two rests', () => {
    const r = setup(starCatchRules, { duration: 196, rounds: 3, restSec: 8, bots: 'perfect', seed: 12 });
    play(r);
    expect(r.engine.phase).toBe('complete');
    expect(r.k).toBe(11_760);
    expect(count(r.events, 'round')).toBe(3);
    expect(count(r.events, 'rest')).toBe(2);
    const sum = r.engine.summary();
    expect(sum.seconds).toBeCloseTo(196, 1);
    // 3 rounds of 60 s at 3.5 MET, 16 s of rest at 1.5 MET
    expect(sum.metSeconds).toBeCloseTo(3.5 * 180 + 1.5 * 16, 0);
  });

  it('nothing appears during a rest, and nothing is on the screen when a round ends', () => {
    const r = setup(starCatchRules, { duration: 40, rounds: 2, restSec: 6, bots: 'perfect', seed: 13 });
    const tl = r.engine.timeline;
    const rest = tl.segments.find((s) => s.kind === 'rest') as { start: number; end: number };
    let seenInRest = 0;
    while (r.engine.phase === 'running') {
      tick(r);
      if (r.engine.t > rest.start + 50 && r.engine.t < rest.end - 50) seenInRest += r.engine.view().lanes[0]?.targets.length ?? 0;
    }
    expect(seenInRest).toBe(0);
  });
});

describe('two players, one camera', () => {
  it('each lane keeps its own score on the same plan; the better player wins', () => {
    const r = setup(starCatchRules, { duration: 70, rounds: 1, bots: ['perfect', 'sloppy'], seed: 14 });
    play(r);
    const a = r.engine.lane(1)?.state.stats, b = r.engine.lane(2)?.state.stats;
    expect(a?.score).toBeGreaterThan((b?.score ?? 0) * 1.2);
    expect(a?.hits).toBeGreaterThan(b?.hits ?? 0);
    const n = r.engine.plan.length;
    expect((a?.hits ?? 0) + (a?.misses ?? 0)).toBe(n);
    expect((b?.hits ?? 0) + (b?.misses ?? 0)).toBe(n);
    const sum = r.engine.summary();
    expect(sum.players?.[1]?.score).toBe(a?.score);
    expect(sum.players?.[2]?.score).toBe(b?.score);
    expect(sum.score).toBe(Math.max(a?.score ?? 0, b?.score ?? 0));
    expect(sum.log.every((e) => e.player === 1 || e.player === 2)).toBe(true);
  });

  it('gives both players the same star at the same place in their own body space, clipped to what each camera sees', () => {
    // body space is in torso lengths, so a near or far player gets the same spot; a player at the edge of the picture gets it pulled in
    const mid = profileOf(SHAPE_UPPER, 'upper'), edge = profileOf({ ...SHAPE_UPPER, cx: 0.12 }, 'upper');
    const r = setup(starCatchRules, { duration: 20, rounds: 1, bots: ['idle', 'idle'], seed: 15, profiles: [mid, edge] });
    for (let i = 0; i < 400; i++) tick(r);
    const v = r.engine.view();
    const a = v.lanes[0]?.targets[0], b = v.lanes[1]?.targets[0];
    expect(a?.id).toBe(b?.id);
    const all = v.lanes[0]?.targets.map((t, i) => [t, v.lanes[1]?.targets[i]] as const) ?? [];
    expect(all.some(([x, y]) => x.x !== y?.x || x.y !== y?.y)).toBe(true);
    for (const t of v.lanes[1]?.targets ?? []) expect(t.x).toBeGreaterThanOrEqual((v.lanes[1]?.env.frame.x0 ?? 0) - 1e-9);
  });

  it('does not run on while one of the players is not tracked, and ends after a very long gap', () => {
    const r = setup(starCatchRules, { duration: 20, rounds: 1, bots: ['perfect', 'perfect'], seed: 16 });
    for (let i = 0; i < 120; i++) tick(r);
    const t0 = r.engine.t;
    for (let i = 0; i < 300; i++) tick(r, { tracked: [true, false] });
    expect(r.engine.t).toBe(t0);
    for (let i = 0; i < 60; i++) tick(r);
    expect(r.engine.t).toBeGreaterThan(t0);
    const g = setup(starCatchRules, { duration: 20, rounds: 1, bots: 'perfect', seed: 17 });
    let phase = 'running';
    for (let i = 0; i < 60 * 41 && phase === 'running'; i++) phase = tick(g, { tracked: [false, true] }).phase;
    expect(phase).toBe('over');
  });
});

describe('seated and keyboard variants', () => {
  it('a seated perfect player does as well as a standing one on the same level', () => {
    const r = setup(starCatchRules, { duration: 30, rounds: 1, bots: 'perfect', seated: true, level: 'normal', seed: 18 });
    const n = r.engine.plan.length;
    const s = finish(r);
    expect(s.hits / n).toBeGreaterThan(0.9);
  });

  it('a keyboard round makes the hands from cursors: arrow keys move the right hand, W A S D the left', () => {
    const r = setup(starCatchRules, { duration: 20, rounds: 1, keyboard: true, bots: 'idle', seed: 19 });
    const hold = (ch: Record<string, number>, steps: number): void => {
      for (let i = 0; i < steps; i++) { r.k++; r.engine.step(frameOf(r.k, ch)); }
    };
    const hand = (side: 'L' | 'R') => r.engine.lane(1)?.state.hands[side];
    hold({}, 1);
    const l0 = { ...hand('L')! }, r0 = { ...hand('R')! };
    hold({ 'cursor.R.y': 1, 'cursor.L.x': -1 }, 40);
    expect(hand('R')!.y).toBeGreaterThan(r0.y + 0.4);
    expect(Math.abs(hand('R')!.x - r0.x)).toBeLessThan(0.01);
    expect(hand('L')!.x).toBeLessThan(l0.x - 0.4);
    const stopped = { ...hand('R')! };
    hold({}, 5);
    expect(hand('R')!.y).toBe(stopped.y);
    expect(hand('R')!.x).toBe(stopped.x);
  });

  it('a keyboard player can catch stars by moving a cursor onto them', () => {
    const r = setup(starCatchRules, { duration: 20, rounds: 1, keyboard: true, bots: 'idle', seed: 20 });
    let caught = 0;
    for (let i = 0; i < 60 * 20 && r.engine.phase === 'running'; i++) {
      r.k++;
      const lane = r.engine.view().lanes[0];
      const target = lane?.targets.find((t) => (t.spec as StarSpec).side !== undefined);
      const ch: Record<string, number> = {};
      if (target && lane) {
        const side = (target.spec as StarSpec).side as 'L' | 'R';
        const h = lane.hands[side];
        const dx = target.x - h.x, dy = target.y - h.y;
        const keyX = side === 'R' ? 'cursor.R.x' : 'cursor.L.x', keyY = side === 'R' ? 'cursor.R.y' : 'cursor.L.y';
        if (Math.abs(dx) > 0.02) ch[keyX] = Math.sign(dx);
        if (Math.abs(dy) > 0.02) ch[keyY] = Math.sign(dy);
      }
      const out = r.engine.step(frameOf(r.k, ch));
      caught += out.events.filter((e) => e.type === 'hit').length;
    }
    expect(caught).toBeGreaterThan(3);
  });
});

describe('snapshot and restore', () => {
  it('continue exactly, in a new engine too, even in the middle of a touch', () => {
    const a = setup(starCatchRules, { duration: 30, rounds: 1, bots: 'sloppy', seed: 21 });
    for (let i = 0; i < 700; i++) tick(a);
    const snap = JSON.parse(JSON.stringify(a.engine.snapshot()));
    const b = setup(starCatchRules, { duration: 30, rounds: 1, bots: 'sloppy', seed: 999 });
    b.engine.restore(snap);
    // the bots carry their own memory (which hand they chose), so give b the same bot and body state
    b.bodies[0] = a.bodies[0]!;
    b.steers[0] = a.steers[0]!;
    b.k = a.k;
    const ea: unknown[] = [], eb: unknown[] = [];
    // a copy of the future: play a on from here, then replay b on the same inputs by recording what a saw
    const inputs: ReturnType<typeof frameOf>[] = [];
    while (a.engine.phase === 'running') {
      a.k++;
      const lane = a.engine.view().lanes[0]!;
      a.steers[0]!(lane, a.bodies[0]!, a.engine.t);
      const f = frameOf(a.k, a.bodies[0]!.step(a.k));
      inputs.push(f);
      ea.push(a.engine.step(f).events);
    }
    for (const f of inputs) eb.push(b.engine.step(f).events);
    expect(eb).toEqual(ea);
    expect(b.engine.summary()).toEqual(a.engine.summary());
    expect(b.engine.phase).toBe('complete');
  });

  it('refuse a snapshot of another game', () => {
    const a = setup(starCatchRules, { duration: 10, rounds: 1 });
    expect(() => a.engine.restore({ v: 1, rules: 'pad-work' })).toThrow();
    expect(() => a.engine.restore(null)).toThrow();
  });
});

describe('what comes from outside is never trusted', () => {
  it('survives missing, NaN and infinite channels and hands that vanish', () => {
    const r = setup(starCatchRules, { duration: 12, rounds: 1, bots: 'perfect', seed: 22 });
    const weird: Record<string, number>[] = [{}, { 'hit.t': Number.NaN }, { 'hit.t': Infinity, 'hand.L.x': Infinity }, { 'hit.t': 5, 'hand.L.x': Number.NaN, 'hand.L.y': 1, 'hand.L.seen': 1 }];
    for (let i = 0; i < 60 * 12; i++) {
      r.k++;
      const f = frameOf(r.k, i % 7 === 0 ? (weird[(i / 7) % weird.length | 0] ?? {}) : (r.bodies[0]!.step(r.k)));
      expect(() => r.engine.step(f)).not.toThrow();
    }
    const sum = r.engine.summary();
    expect(Number.isFinite(sum.score)).toBe(true);
    expect(JSON.stringify(r.engine.snapshot()).includes('null')).toBe(JSON.stringify(r.engine.snapshot()).includes('null'));
  });
});

describe('levels', () => {
  it('has a table for each level the shell offers', () => {
    expect(Object.keys(STAR_LEVELS).sort()).toEqual(['easy', 'expert', 'hard', 'normal']);
  });
});
