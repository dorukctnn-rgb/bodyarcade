// Reaction Tag on the engine: the plan (lights, traps, wide and floor lights), taps with bots through the real detector,
// reaction times, traps, foot taps and side steps, seated, quiet and keyboard variants, two lanes, snapshots.
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../core/loop/rng.ts';
import { profileOf, SHAPE_FULL, SHAPE_UPPER } from '../../core/moves/testing/rig.ts';
import { envelopeOf, reachRatio, spot } from './envelope.ts';
import { LIGHT_LEVELS, planLights, reactionOf, reactionTagRules, type LightSpec } from './reaction-tag.ts';
import { buildTimeline } from './timeline.ts';
import { frameOf } from './testing/body.ts';
import { Chaser, BOTS } from './testing/bots.ts';
import { play, seenOf, setup, tick, type SetupOptions, type Steer } from './testing/play.ts';
import type { PlanInput } from './types.ts';

const planInput = (o: Partial<PlanInput> = {}): PlanInput => ({
  level: 'normal', timeline: buildTimeline(155, 3, 10), seated: false, quiet: false, feet: false, keyboard: false, players: 1, hz: 30, ...o,
});
const planOf = (seed: number, o: Partial<PlanInput> = {}): LightSpec[] => planLights(rngStream(seed, 'course'), planInput(o));

const feetPlan = (seed: number, o: Partial<PlanInput> = {}): LightSpec[] => planOf(seed, { feet: true, ...o });

describe('the plan', () => {
  it('is made from the seed', () => {
    expect(planOf(5)).toEqual(planOf(5));
    expect(planOf(6)).not.toEqual(planOf(5));
  });

  it('is in time order, numbered 0, 1, 2 ..., every light gone before its round ends, none in a rest', () => {
    const tl = buildTimeline(155, 3, 10);
    const specs = planOf(9);
    expect(specs.length).toBeGreaterThan(100);
    specs.forEach((s, i) => expect(s.id).toBe(i));
    for (let i = 1; i < specs.length; i++) expect((specs[i] as LightSpec).at).toBeGreaterThanOrEqual((specs[i - 1] as LightSpec).at);
    for (const s of specs) {
      const seg = tl.segments.find((g) => g.kind === 'play' && s.at >= g.start && s.at < g.end);
      expect(seg, `light ${s.id}`).toBeDefined();
      expect(s.at + s.life).toBeLessThanOrEqual((seg as { end: number }).end);
    }
  });

  it('gives lights less time, more at once and more traps as the level goes up and the run goes on', () => {
    const levels = (['easy', 'normal', 'hard', 'expert'] as const).map((level) => feetPlan(4, { level }));
    const lifes = levels.map((l) => Math.min(...l.map((s) => s.life)));
    for (let i = 1; i < lifes.length; i++) expect(lifes[i]).toBeLessThan(lifes[i - 1] as number);
    const counts = levels.map((l) => l.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1] as number);
    expect(levels[0]!.some((s) => s.trap)).toBe(false);
    expect(levels[1]!.some((s) => s.trap)).toBe(true);
    const trapShare = (l: LightSpec[]): number => l.filter((s) => s.trap).length / l.length;
    expect(trapShare(levels[3]!)).toBeGreaterThan(trapShare(levels[1]!));
    const hard = feetPlan(4, { level: 'expert' });
    const bursts = new Map<number, number>();
    for (const s of hard) bursts.set(s.burst, (bursts.get(s.burst) ?? 0) + 1);
    expect(Math.max(...bursts.values())).toBe(3);
    const first = hard.filter((s) => s.at < 20_000), last = hard.filter((s) => s.at > 130_000);
    expect(Math.max(...first.map((s) => s.life))).toBeGreaterThan(Math.max(...last.map((s) => s.life)));
  });

  it('is from 1.5 s down to 0.6 s of life on the hardest level, as the card says', () => {
    const l = feetPlan(2, { level: 'expert' });
    expect(Math.max(...l.map((s) => s.life - (s.zone === 'hand' ? 0 : 380)))).toBeLessThanOrEqual(1500);
    expect(Math.min(...l.map((s) => s.life - (s.zone === 'hand' ? 0 : 380)))).toBeGreaterThanOrEqual(600);
  });

  it('has wide lights standing, floor lights only when the feet can be used, traps only among hand lights', () => {
    const stand = feetPlan(3, { level: 'hard' });
    expect(stand.some((s) => s.zone === 'wide')).toBe(true);
    expect(stand.some((s) => s.zone === 'floor')).toBe(true);
    expect(stand.filter((s) => s.zone === 'floor').every((s) => s.limb === 'foot' && !s.trap)).toBe(true);
    expect(stand.filter((s) => s.zone !== 'floor').every((s) => s.limb === 'hand')).toBe(true);
    expect(stand.filter((s) => s.zone === 'wide').every((s) => !s.trap)).toBe(true);
    expect(planOf(3, { level: 'hard', feet: false }).some((s) => s.zone === 'floor')).toBe(false);
    expect(feetPlan(3, { level: 'hard', seated: true }).some((s) => s.zone !== 'hand')).toBe(false);
    expect(planOf(3, { level: 'hard', keyboard: true }).some((s) => s.zone !== 'hand')).toBe(false);
    expect(planOf(3, { level: 'easy' }).some((s) => s.zone !== 'hand')).toBe(false);
  });

  it('keeps the hand lights within reach of a hand standing still and off the head; wide lights need a step', () => {
    const env = envelopeOf(profileOf(SHAPE_UPPER, 'upper'), { seated: false });
    for (const s of feetPlan(6, { level: 'expert' })) {
      if (s.zone === 'hand') {
        const p = spot(env, s.ax, s.ay);
        const near = Math.min(reachRatio(env, 'L', p), reachRatio(env, 'R', p));
        expect(near).toBeLessThan(1.06);
        expect(Math.abs(s.ax) < 0.22 && s.ay > 0.15 && s.ay < 0.65).toBe(false);
      }
    }
    const wide = feetPlan(6, { level: 'expert' }).filter((s) => s.zone === 'wide');
    expect(wide.length).toBeGreaterThan(3);
    // with the shoulders' spread added, a wide light is further than an arm from the nearer shoulder
    for (const s of wide) expect(Math.abs(s.ax) - 0.35).toBeGreaterThan(1.1);
  });

  it('keeps lights apart when they are on the screen together', () => {
    const specs = planOf(8, { level: 'expert' }).filter((s) => s.zone === 'hand');
    let close = 0, pairs = 0;
    for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) {
      const a = specs[i] as LightSpec, b = specs[j] as LightSpec;
      if (b.at >= a.at + a.life) break;
      pairs++;
      if (Math.hypot(a.ax - b.ax, a.ay - b.ay) < 0.3) close++;
    }
    expect(pairs).toBeGreaterThan(10);
    expect(close / pairs).toBeLessThan(0.1);
  });

  it('gives a slow device and a seated player more time', () => {
    expect(planOf(1, { hz: 12 })[0]!.life).toBeGreaterThan(planOf(1, { hz: 30 })[0]!.life * 1.4);
    expect(planOf(1, { seated: true })[0]!.life).toBeGreaterThan(planOf(1)[0]!.life * 1.15);
  });
});

const chase = (mode: keyof typeof BOTS, seed = 1, o: { step?: boolean } = {}) => (i: number): Steer => {
  const c = new Chaser(mode, seed + i);
  return (lane, body) => {
    c.steer(body, seenOf(lane));
    if (o.step === false) body.shiftGoal = 0;
  };
};
const run = (mode: keyof typeof BOTS, o: SetupOptions & { noStep?: boolean } = {}) =>
  setup(reactionTagRules, { duration: 40, rounds: 1, level: 'normal', seed: 3, ...o, steer: chase(mode, o.seed ?? 3, { step: !o.noStep }) });

describe('a round with bots (through the real detector)', () => {
  it('a perfect player taps nearly every green light, leaves every red one alone and is measured in milliseconds', () => {
    const r = run('perfect', { level: 'normal', duration: 60 });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    const greens = r.engine.plan.filter((p) => !p.trap).length;
    expect(s.hits / greens).toBeGreaterThan(0.9);
    expect(s.traps).toBe(0);
    expect(s.avoided).toBe(r.engine.plan.filter((p) => p.trap).length);
    const rt = reactionOf(s)!;
    expect(rt.avg).toBeGreaterThan(150);
    expect(rt.avg).toBeLessThan(700);
    expect(rt.best).toBeLessThanOrEqual(rt.avg);
  });

  it('the reaction time is the player\'s own: a bot that waits 500 ms reads about 500 ms plus the travel, less the system delay', () => {
    for (const wait of [300, 500, 800]) {
      BOTS.perfect.react; // the table is shared: copy it
      const slowBot = { ...BOTS.perfect, react: wait };
      const c = new Chaser('perfect', 1);
      (c as unknown as { kind: typeof slowBot }).kind = slowBot;
      const r = setup(reactionTagRules, { duration: 30, rounds: 1, level: 'easy', seed: 21, steer: () => (lane, body) => c.steer(body, seenOf(lane)) });
      play(r);
      const hits = r.events.filter((e) => e.type === 'hit');
      expect(hits.length).toBeGreaterThan(8);
      const mean = hits.reduce((a, e) => a + (e.react as number), 0) / hits.length;
      // zero pipeline delay in the test, 70 ms taken off by the game, hand travel up to ~250 ms at 9 T/s plus the 33 ms pose period
      expect(mean).toBeGreaterThan(wait - 70 - 60);
      expect(mean).toBeLessThan(wait - 70 + 330);
    }
  });

  it('a faster player scores more: the speed counts for up to 40 points a tap', () => {
    const fast = run('perfect', { level: 'normal', duration: 40, seed: 5 });
    play(fast);
    const sloppy = run('sloppy', { level: 'normal', duration: 40, seed: 5 });
    play(sloppy);
    const idle = run('idle', { level: 'normal', duration: 40, seed: 5 });
    play(idle);
    const a = fast.engine.lane(1)!.state.stats, b = sloppy.engine.lane(1)!.state.stats, c = idle.engine.lane(1)!.state.stats;
    expect(a.score).toBeGreaterThan(b.score * 1.3);
    expect(c.hits).toBe(0);
    expect(c.score).toBe(c.avoided * 5);
    expect(a.reactSum / a.reactN).toBeLessThan(b.reactSum / Math.max(1, b.reactN));
  });

  it('touching a red light costs points, ends the streak, and is named in the log', () => {
    const touchAll = (): Steer => {
      return (lane, body) => {
        body.rest();
        const t = lane.targets.find((x) => (x.spec as LightSpec).trap);
        if (t) body.aim('R', t.x, t.y, 9);
      };
    };
    const r = setup(reactionTagRules, { duration: 40, rounds: 1, level: 'hard', seed: 7, steer: touchAll });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    expect(s.traps).toBeGreaterThan(2);
    expect(s.hits).toBe(0);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(r.events.filter((e) => e.type === 'trap').every((e) => e.pts === -40)).toBe(true);
    expect(r.engine.summary().log.some((e) => e.kind === 'hold_still' && !e.ok)).toBe(true);
    // a trap that is touched is gone: it does not also count as avoided
    expect(s.avoided + s.traps).toBeLessThanOrEqual(r.engine.plan.filter((p) => p.trap).length);
  });

  it('a late player taps nothing and is told the lights were not reached; the score never goes below zero', () => {
    const r = run('late', { level: 'normal' });
    play(r);
    const s = r.engine.lane(1)!.state.stats;
    expect(s.hits).toBe(0);
    const codes = new Set(r.events.filter((e) => e.type === 'miss').map((e) => e.code));
    expect(codes).toEqual(new Set(['not_reached']));
    expect(s.score).toBeGreaterThanOrEqual(0);
  });

  it('taps a floor light with a foot, and a player who only has hands is told the foot did not come down', () => {
    const r = run('perfect', { level: 'hard', duration: 60, feet: true, seed: 8 });
    play(r);
    const feet = r.events.filter((e) => e.type === 'hit' && e.limb === 'foot');
    expect(feet.length).toBeGreaterThan(2);
    const hands = setup(reactionTagRules, { duration: 60, rounds: 1, level: 'hard', seed: 8, feet: true, steer: () => (lane, body) => {
      body.rest();
      for (const t of lane.targets) if ((t.spec as LightSpec).limb === 'hand' && !(t.spec as LightSpec).trap) body.aim('R', t.x, t.y, 9);
    } });
    play(hands);
    const missed = hands.events.filter((e) => e.type === 'miss' && e.limb === 'foot');
    expect(missed.length).toBeGreaterThan(2);
    for (const e of missed) expect(['not_reached', 'foot_not_down', 'feet_out_of_view']).toContain(e.code);
  });

  it('a wide light needs a step: without one it is out of reach, with one it is tapped', () => {
    const stepping = run('perfect', { level: 'hard', duration: 80, seed: 9 });
    play(stepping);
    const flat = run('perfect', { level: 'hard', duration: 80, seed: 9, noStep: true });
    play(flat);
    const wides = (r: typeof stepping): { hit: number; miss: number } => {
      const ids = new Set(r.engine.plan.filter((p) => p.zone === 'wide').map((p) => p.id));
      return { hit: r.events.filter((e) => e.type === 'hit' && ids.has(e.id as number)).length, miss: r.events.filter((e) => e.type === 'miss' && ids.has(e.id as number)).length };
    };
    const a = wides(stepping), b = wides(flat);
    expect(a.hit + a.miss).toBeGreaterThan(5);
    expect(a.hit).toBeGreaterThan(b.hit + 2);
    expect(b.miss).toBeGreaterThan(a.miss);
  });

  it('a lost hand is reported as hands out of view, not as a slow one', () => {
    const r = setup(reactionTagRules, { duration: 20, rounds: 1, level: 'easy', seed: 10, steer: () => (_lane, body) => { body.rest(); body.handsSeen = false; } });
    play(r);
    expect(new Set(r.events.filter((e) => e.type === 'miss').map((e) => e.code))).toEqual(new Set(['hands_out_of_view']));
  });

  it("a pause with a light on the screen is not counted as slow thinking: the time the game waited is nobody's reaction", () => {
    // The session stops stepping the game while it is paused, but the camera's clock goes on: the first frames after the pause
    // are minutes ahead of the last one the game saw. A tap just after the pause is a quick tap.
    let go = false;
    const r = setup(reactionTagRules, {
      duration: 30, rounds: 1, level: 'easy', seed: 21,
      steer: () => (lane, body) => {
        body.rest();
        const t = lane.targets[0];
        if (go && t) body.aim(t.x < 0 ? 'L' : 'R', t.x, t.y, 9);
      },
    });
    let guard = 0;
    while (r.engine.view().lanes[0]!.targets.length === 0 && guard++ < 2000) tick(r);
    for (let i = 0; i < 20; i++) tick(r);
    const shown = r.engine.view().lanes[0]!.targets[0];
    expect(shown, 'a light is on the screen').toBeDefined();
    r.k += 600; // ten seconds of the camera's clock with no step of the game
    go = true;
    let tapped: { react: number } | null = null;
    for (let i = 0; i < 90 && !tapped; i++) {
      const out = tick(r);
      const hit = out.events.find((e) => e.type === 'hit');
      if (hit) tapped = { react: hit.react as number };
    }
    expect(tapped, 'the light was tapped after the pause').not.toBeNull();
    expect(tapped!.react, 'a reaction of a second at most, not ten').toBeLessThan(1500);
    const sum = r.engine.summary();
    expect(sum.log.filter((e) => e.kind === 'tag').every((e) => (e.v as number) < 1500)).toBe(true);
  });

  it('the log holds a reaction time for every tap', () => {
    const r = run('perfect', { level: 'normal', duration: 30 });
    play(r);
    const sum = r.engine.summary();
    const taps = sum.log.filter((e) => e.kind === 'tag');
    expect(taps.length).toBe(sum.hits);
    expect(taps.every((e) => e.ok && typeof e.v === 'number' && e.v >= 0)).toBe(true);
  });

  it('uses 155 s for a full run: three rounds of 45 s with two breathers of 10 s', () => {
    const tl = buildTimeline(155, 3, 10);
    expect(tl.roundMs).toBe(45_000);
    expect(tl.restMs).toBe(10_000);
  });
});

describe('seated, quiet, keyboard, two players', () => {
  it('a seated player never meets a wide or a floor light and does as well on the same level', () => {
    const r = run('perfect', { level: 'expert', duration: 50, seated: true, seed: 12 });
    play(r);
    expect(r.engine.plan.every((p) => p.zone === 'hand')).toBe(true);
    const greens = r.engine.plan.filter((p) => !p.trap).length;
    expect(r.engine.lane(1)!.state.stats.hits / greens).toBeGreaterThan(0.8);
  });

  it('quiet mode removes the foot lights only', () => {
    const r = run('perfect', { level: 'hard', duration: 80, quiet: true, feet: true, seed: 13 });
    expect(r.engine.plan.some((p) => p.zone === 'floor')).toBe(false);
    expect(r.engine.plan.some((p) => p.zone === 'wide')).toBe(true);
  });

  it('a keyboard player taps lights by steering the cursors onto them', () => {
    const r = setup(reactionTagRules, { duration: 30, rounds: 1, level: 'easy', keyboard: true, bots: 'idle', seed: 14 });
    let taps = 0;
    for (let i = 0; i < 60 * 30 && r.engine.phase === 'running'; i++) {
      r.k++;
      const lane = r.engine.view().lanes[0]!;
      const t = lane.targets[0];
      const ch: Record<string, number> = {};
      if (t) {
        const h = lane.hands.R;
        if (Math.abs(t.x - h.x) > 0.03) ch['cursor.R.x'] = Math.sign(t.x - h.x);
        if (Math.abs(t.y - h.y) > 0.03) ch['cursor.R.y'] = Math.sign(t.y - h.y);
      }
      taps += r.engine.step(frameOf(r.k, ch)).events.filter((e) => e.type === 'hit').length;
    }
    expect(taps).toBeGreaterThan(5);
  });

  it('two players tap the same lights on their own lanes; the faster wins', () => {
    const r = setup(reactionTagRules, { duration: 50, rounds: 1, level: 'normal', seed: 15, bots: ['perfect', 'sloppy'], steer: (i) => chase(i === 0 ? 'perfect' : 'sloppy', 15)(i) });
    play(r);
    const a = r.engine.lane(1)!.state.stats, b = r.engine.lane(2)!.state.stats;
    expect(a.score).toBeGreaterThan(b.score);
    const sum = r.engine.summary();
    expect(sum.players?.[1]?.score).toBe(a.score);
    expect(sum.players?.[2]?.score).toBe(b.score);
    expect(sum.log.every((e) => e.player === 1 || e.player === 2)).toBe(true);
  });

  it('snapshot and restore continue exactly, with feet, steps and traps on the screen', () => {
    const mk = (seed: number) => run('perfect', { level: 'expert', duration: 60, seed: 16, feet: true, ...(seed ? {} : {}) });
    const a = mk(1);
    for (let i = 0; i < 1500; i++) tick(a);
    const snap = JSON.parse(JSON.stringify(a.engine.snapshot()));
    const b = mk(2);
    b.engine.restore(snap);
    b.bodies[0] = a.bodies[0]!;
    b.steers[0] = a.steers[0]!;
    b.k = a.k;
    const frames: ReturnType<typeof frameOf>[] = [];
    const ea: unknown[] = [], eb: unknown[] = [];
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

describe('levels', () => {
  it('has a table for each level the shell offers', () => {
    expect(Object.keys(LIGHT_LEVELS).sort()).toEqual(['easy', 'expert', 'hard', 'normal']);
  });

  it('puts the full-body profile in the plan only when it can see the floor', () => {
    const env = envelopeOf(profileOf(SHAPE_FULL, 'full'), { seated: false });
    expect(env.floorY).not.toBeNull();
    expect(envelopeOf(profileOf(SHAPE_UPPER, 'upper'), { seated: false }).floorY).toBeNull();
  });
});
