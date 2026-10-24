// Pose Wall, the simulation: the timeline, the seeded walls and the shapes of each level, the judging on the camera's own clock, the
// reasons a wall was missed, series, two players on one camera (the same wall for both, the team pass), keys and swipes, the results,
// determinism, snapshot and restore in the middle of a hold.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { fitPose, LIMBS, type LimbAngles } from '../../core/moves/poseMatch.ts';
import { frameFrom, type FrameIn } from '../_shared/frame.ts';
import type { SimEvent } from '../_shared/host.ts';
import { STAND } from '../_shared/mover.ts';
import { msOf } from '../_shared/util.ts';
import { DIFFICULTIES, type Difficulty } from '../strength/kit.ts';
import { inputOf, run } from '../strength/testing/run.ts';
import { LAG_K, PW_LEVELS, PW_TIMING, PW_VARIANT_MET, PoseWallSim, SERIES_GAP_S, liveFit, makePwPlan, pickShapes, reasonFor, type PwWall } from './posewall.ts';
import type { GpTiming } from './plan.ts';
import { PW_LIBRARY, needsSupport, poolFor, shapeOf } from './pw-poses.ts';
import { POSE_SPOILS, poseBot, type PoseBotOptions } from './testing/pose-bot.ts';

interface MakeOptions { seed?: number; difficulty?: string; seated?: boolean; players?: 1 | 2; timing?: Partial<GpTiming> }

function make(o: MakeOptions = {}): PoseWallSim {
  const seed = o.seed ?? 3;
  const players = o.players ?? 1;
  return new PoseWallSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: players === 2 ? 'local2' : 'solo' },
      flags: { reducedMotion: false, silent: false, seated: o.seated ?? false },
      players, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 4,
    ...(o.timing ? { timing: o.timing } : {}),
  });
}

const bot = (sim: PoseWallSim, o: PoseBotOptions) => poseBot(sim.plan, o);
const types = (events: readonly SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);
const walls = (events: readonly SimEvent[]): SimEvent[] => types(events, 'wall');
const SHORT: Partial<GpTiming> = { sets: 1, workS: 30, finaleS: 2 };

/** What a body gives at one step: limbs (over standing), what is in view, the hip drop; on the camera's clock with its own pace and delay. */
interface Body { limbs?: Partial<LimbAngles>; arms?: boolean; legs?: boolean; drop?: number }
function chOf(k: number, b: Body, o: { offset?: number; lagK?: number; hz?: number } = {}): Record<string, number> {
  const step = Math.max(1, Math.round(60 / (o.hz ?? 30)));
  const kp = Math.floor(k / step) * step;
  const ch: Record<string, number> = {
    'pose.t': (o.offset ?? 5000) + msOf(kp - (o.lagK ?? 0)), 'pose.arms': b.arms === false ? 0 : 1, 'pose.legs': b.legs === false ? 0 : 1, drop: b.drop ?? 0,
  };
  const limbs = { ...STAND, ...b.limbs };
  for (const l of LIMBS) ch[`limb.${l}`] = limbs[l];
  return ch;
}

const shapeLimbs = (sim: PoseWallSim, w: PwWall): LimbAngles => ({ ...STAND, ...sim.shape(w.pose).limbs }) as LimbAngles;

/**
 * Plays the whole run with the body standing, except for one wall: `body(k)` is the body from 1.5 s before it arrives to the verdict.
 * Returns the wall's event (and every event).
 */
function playWall(sim: PoseWallSim, id: number, body: (k: number, w: PwWall) => Body, o: { offset?: number; lagK?: number; hz?: number } = {}): { event: SimEvent; events: SimEvent[] } {
  const w = sim.plan.walls[id] as PwWall;
  const input = (k: number): FrameIn => frameFrom([{ ok: true, ch: chOf(k, k >= w.arriveK - 90 && k <= w.arriveK + LAG_K + 2 ? body(k, w) : {}, o) }]);
  const r = run(sim, input, { steps: w.arriveK + LAG_K + 12 });
  const event = walls(r.events).find((e) => e['id'] === id) as SimEvent;
  return { event, events: r.events };
}

describe('the timeline', () => {
  it('three sets of 60 s, two rests of 15 s and a 4 s outro: 12840 steps in order', () => {
    const sim = make();
    expect(sim.plan.segments.map((s) => s.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work', 'finale']);
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    expect(r.k).toBe(214 * 60);
    expect(sim.phase).toBe('complete');
    expect(types(r.events, 'set').map((e) => e['set'])).toEqual([0, 1, 2]);
    expect(types(r.events, 'rest')).toHaveLength(2);
    expect(types(r.events, 'finale')).toHaveLength(1);
    expect(types(r.events, 'done')).toHaveLength(1);
    expect(sim.summary().seconds).toBe(214);
  });

  it('the sets and the rests add up to the 210 s of the manifest, outro apart; no wall arrives, and none is judged, in a rest or in the outro', () => {
    const sim = make();
    const played = sim.plan.segments.filter((s) => s.kind !== 'finale').reduce((n, s) => n + (s.endK - s.startK), 0);
    expect(played / 60).toBe(PW_TIMING.sets * PW_TIMING.workS + (PW_TIMING.sets - 1) * PW_TIMING.restS);
    expect(played / 60).toBe(210);
    const work = sim.plan.segments.filter((s) => s.kind === 'work');
    for (const w of sim.plan.walls) expect(work.some((s) => w.arriveK > s.startK && w.arriveK + LAG_K < s.endK - 40), `wall ${w.id}`).toBe(true);
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    for (const e of walls(r.events)) {
      const k = Math.round(Number(e.t) * 0.06);
      expect(work.some((s) => k > s.startK && k <= s.endK), `verdict at ${k}`).toBe(true);
    }
  });

  it('says how long a set has left and when the rest is nearly over', () => {
    const sim = make();
    expect(sim.leftS).toBe(60);
    expect(sim.gettingReady).toBe(false);
    const idle = bot(sim, { mode: 'idle' });
    run(sim, inputOf(idle), { steps: 60 * 60 + 11 * 60 });
    expect(sim.segment.kind).toBe('rest');
    expect(sim.gettingReady).toBe(false);
    run(sim, inputOf(idle), { from: 60 * 60 + 11 * 60, steps: 61 });
    expect(sim.gettingReady).toBe(true);
    expect(sim.leftS).toBeLessThanOrEqual(3);
  });
});

describe('the shapes of each level', () => {
  it('the pools grow with the level, standing and seated, and every shape is in the library', () => {
    const count = (l: Difficulty, seated: boolean): number => poolFor(l, seated).length;
    expect(DIFFICULTIES.map((l) => count(l, false))).toEqual([5, 9, 13, 16]);
    expect(DIFFICULTIES.map((l) => count(l, true))).toEqual([5, 9, 11, 11]);
    const names = new Set(PW_LIBRARY.map((p) => p.name));
    for (const l of DIFFICULTIES) for (const seated of [false, true]) for (const n of poolFor(l, seated)) expect(names.has(n), n).toBe(true);
    // the harder levels keep the shapes of the easier ones
    for (let i = 1; i < DIFFICULTIES.length; i++) for (const n of poolFor(DIFFICULTIES[i - 1] as Difficulty, false)) expect(poolFor(DIFFICULTIES[i] as Difficulty, false)).toContain(n);
  });

  it('seated shapes have no leg limbs and need no squat; standing shapes keep their legs; the balance shapes say "hold on to something"', () => {
    for (const l of DIFFICULTIES) {
      for (const n of poolFor(l, true)) {
        const p = shapeOf(n, true);
        expect(Object.keys(p.limbs).filter((k) => k.startsWith('thigh') || k.startsWith('shin')), `${l} ${n}`).toEqual([]);
        expect(p.minDrop, n).toBeUndefined();
        expect(Object.keys(p.limbs).length, n).toBeGreaterThanOrEqual(4);
      }
    }
    expect(Object.keys(shapeOf('tPose', false).limbs)).toContain('thighL');
    expect(shapeOf('squatT', false).minDrop).toBeGreaterThan(0);
    expect(poolFor('expert', false).filter(needsSupport).sort()).toEqual(['treeLeft', 'treeRight']);
    expect(poolFor('hard', false).some(needsSupport)).toBe(false);
    expect(() => shapeOf('nothing', false)).toThrow();
  });

  it('no two shapes of a level are within its tolerance of each other, so a body in one shape never passes another wall of that level', () => {
    const body = (n: string): LimbAngles => ({ ...STAND, ...(PW_LIBRARY.find((p) => p.name === n) as { limbs: object }).limbs }) as LimbAngles;
    for (const l of DIFFICULTIES) {
      const tol = PW_LEVELS[l].tol;
      const names = poolFor(l, false);
      const ambiguous: string[] = [];
      for (const a of names) for (const b of names) {
        if (a !== b && fitPose(body(a), shapeOf(b, false), tol).matched) ambiguous.push(`${a}>${b}`);
      }
      // the squat shape asks for the arms of the T and a deep hip: the hip drop tells it apart, the limbs alone cannot
      expect(ambiguous.filter((x) => !x.includes('squatT')), l).toEqual([]);
    }
  });

  it('the levels ask for the tolerances of the card: 30, 22 and 15 degrees', () => {
    expect(DIFFICULTIES.map((l) => PW_LEVELS[l].tol)).toEqual([30, 22, 15, 15]);
    for (const l of DIFFICULTIES) expect(make({ difficulty: l }).plan.tol).toBe(PW_LEVELS[l].tol);
  });
});

describe('the walls of the plan', () => {
  it('are the same for the same seed and different for another', () => {
    const a = make({ seed: 5 }).plan.walls;
    const b = make({ seed: 5 }).plan.walls;
    const c = make({ seed: 6 }).plan.walls;
    expect(b).toEqual(a);
    expect(c.map((w) => w.pose)).not.toEqual(a.map((w) => w.pose));
  });

  it('draw only from the level\'s own shapes, the same shape never twice in a row, and every shape comes before any comes again', () => {
    for (const l of DIFFICULTIES) {
      for (const seated of [false, true]) {
        const plan = make({ difficulty: l, seated, seed: 11 }).plan;
        const pool = poolFor(l, seated);
        for (const w of plan.walls) expect(pool, `${l} ${w.pose}`).toContain(w.pose);
        for (let i = 1; i < plan.walls.length; i++) expect(plan.walls[i]?.pose, `${l} wall ${i}`).not.toBe(plan.walls[i - 1]?.pose);
        const first = plan.walls.slice(0, pool.length).map((w) => w.pose);
        expect(new Set(first).size, `${l} the first round has no repeat`).toBe(pool.length);
      }
    }
  });

  it('the number of walls fits the level: about one in five seconds on easy to one in three on expert', () => {
    const counts = DIFFICULTIES.map((l) => make({ difficulty: l }).plan.walls.length);
    expect(counts[0]).toBeGreaterThanOrEqual(28);
    expect(counts[0]).toBeLessThanOrEqual(40);
    for (let i = 1; i < counts.length; i++) expect(counts[i] as number).toBeGreaterThan(counts[i - 1] as number);
    expect(counts[3]).toBeLessThanOrEqual(70);
  });

  it('series: none on easy; on the others two or three walls, 2.4 s apart, numbered, every wall alone or in a series', () => {
    expect(make({ difficulty: 'easy' }).plan.walls.every((w) => w.series === 0)).toBe(true);
    for (const l of ['normal', 'hard', 'expert'] as const) {
      const ws = make({ difficulty: l, seed: 4 }).plan.walls;
      expect(ws.some((w) => w.series > 0), l).toBe(true);
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i] as PwWall;
        if (w.series === 0) { expect(w.of).toBe(1); continue; }
        expect(w.of === 2 || w.of === 3).toBe(true);
        expect(w.series).toBeLessThanOrEqual(w.of);
        if (w.series > 1) expect(w.arriveK - (ws[i - 1] as PwWall).arriveK).toBe(Math.round(SERIES_GAP_S * 60));
      }
    }
  });

  it('a wall is judged only after the verdict of the one before it, and from before its own window', () => {
    for (const l of DIFFICULTIES) {
      const ws = make({ difficulty: l, seed: 8 }).plan.walls;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i] as PwWall;
        expect(w.fromK).toBeLessThanOrEqual(w.arriveK - 48);
        if (i > 0) expect(w.fromK).toBeGreaterThan((ws[i - 1] as PwWall).arriveK + LAG_K);
      }
    }
  });

  it('two players: both lanes get the same wall at the same step with the same shape', () => {
    const plan = make({ players: 2, seed: 2 }).plan;
    const one = make({ players: 1, seed: 2 }).plan;
    expect(plan.walls).toHaveLength(one.walls.length * 2);
    for (let i = 0; i < plan.walls.length; i += 2) {
      const a = plan.walls[i] as PwWall, b = plan.walls[i + 1] as PwWall;
      expect([a.lane, b.lane]).toEqual([0, 1]);
      expect(b.arriveK).toBe(a.arriveK);
      expect(b.pose).toBe(a.pose);
      expect(a.pose).toBe((one.walls[i / 2] as PwWall).pose);
    }
  });
});

describe('judging', () => {
  it.each(DIFFICULTIES)('a perfect player passes every wall on %s, standing and seated, at 10, 15, 30 and 60 pose frames a second, whatever the camera\'s clock', (level) => {
    for (const seated of [false, true]) {
      for (const hz of [10, 15, 30, 60]) {
        const sim = make({ difficulty: level, seated, seed: 7 + hz });
        const offset = [0, 123_456, 9_999_999][hz % 3] as number;
        const r = run(sim, inputOf(bot(sim, { mode: 'perfect', poseHz: hz, clockOffset: offset })));
        const ev = walls(r.events);
        expect(ev.length, `${level} ${seated} ${hz}`).toBe(sim.plan.walls.length);
        expect(ev.filter((e) => e['ok'] === true).length, `${level} seated ${seated} ${hz} Hz`).toBe(sim.plan.walls.length);
        expect(sim.playerStates[0]?.missed).toBe(0);
      }
    }
  });

  it('scores a pass by how well the shape fit and the streak, caps the streak bonus, and calls a fit of 85 percent or more perfect', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    const ev = walls(r.events);
    const p = sim.playerStates[0]!;
    expect(p.passed).toBe(ev.length);
    expect(p.streak).toBe(ev.length);
    expect(p.bestStreak).toBe(ev.length);
    let total = 0;
    for (const e of ev) {
      const fit = Number(e['fit']);
      expect(fit).toBeGreaterThanOrEqual(0.5);
      expect(fit).toBeLessThanOrEqual(1);
      const mult = 1 + Math.min(0.5, (Number(e['streak']) - 1) * 0.05);
      expect(Number(e['pts'])).toBe(Math.round((60 + 60 * fit) * mult));
      expect(e['perfect'] === true).toBe(fit >= 0.85);
      total += Number(e['pts']);
    }
    expect(Number(ev[ev.length - 1]?.['streak'])).toBe(ev.length);
    expect(p.score).toBeGreaterThanOrEqual(total);
    expect(p.perfect).toBe(ev.filter((e) => e['perfect'] === true).length);
    expect(p.perfect).toBeGreaterThan(ev.length / 2);
  });

  it('the first wall locks (the shape was held) before it arrives, and is passed at the verdict 0.1 s after the arrival', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })), { steps: 600 });
    const w = sim.plan.walls[0] as PwWall;
    const lock = types(r.events, 'lock').find((e) => e['id'] === 0) as SimEvent;
    const pass = walls(r.events).find((e) => e['id'] === 0) as SimEvent;
    expect(lock).toBeDefined();
    expect(Number(lock.t)).toBeLessThanOrEqual(msOf(w.arriveK));
    expect(Number(lock.t)).toBeGreaterThanOrEqual(msOf(w.arriveK - 48));
    expect(Number(pass.t)).toBe(Math.round(msOf(w.arriveK + LAG_K) * 10) / 10);
    expect(sim.wallStates[0]).toMatchObject({ done: 1, locked: true });
  });

  it('a limb a little inside the tolerance passes and a little outside misses, on every level', () => {
    for (const l of DIFFICULTIES) {
      const tol = PW_LEVELS[l].tol;
      for (const [delta, ok] of [[tol - 5, true], [tol + 5, false]] as const) {
        const sim = make({ difficulty: l });
        const want = shapeLimbs(sim, sim.plan.walls[0] as PwWall);
        const limb = Object.keys(sim.shape((sim.plan.walls[0] as PwWall).pose).limbs)[0] as keyof LimbAngles;
        const { event } = playWall(sim, 0, (_k, w) => ({ limbs: { ...shapeLimbs(sim, w), [limb]: want[limb] + delta }, drop: sim.shape(w.pose).minDrop ?? 0 }));
        expect(event['ok'], `${l} ${delta}`).toBe(ok);
        if (!ok) {
          expect(event['code']).toBe('limb_off');
          expect(event['limb']).toBe(limb);
          expect(Number(event['got'])).toBeGreaterThan(Number(event['need']));
        }
      }
    }
  });

  it('only the last 0.8 s before the wall count: a shape made early and given up does not pass, one made in the window does', () => {
    const sim = make();
    const early = playWall(sim, 0, (k, w) => ({ limbs: k < w.arriveK - 60 ? shapeLimbs(sim, w) : {} }));
    expect(early.event['ok']).toBe(false);
    const late = playWall(make(), 0, (k, w) => ({ limbs: k >= w.arriveK - 40 ? shapeLimbs(make(), w) : {} }));
    expect(late.event['ok']).toBe(true);
  });

  it('the shape has to be held for 0.3 s: 0.2 s is "hold it longer", 0.35 s passes', () => {
    const short = make();
    const a = playWall(short, 0, (k, w) => ({ limbs: k >= w.arriveK - 12 && k <= w.arriveK + 2 ? shapeLimbs(short, w) : {} }), { hz: 60 });
    expect(a.event['ok']).toBe(false);
    expect(a.event['code']).toBe('held_too_short');
    const long = make();
    const b = playWall(long, 0, (k, w) => ({ limbs: k >= w.arriveK - 26 && k <= w.arriveK + 2 ? shapeLimbs(long, w) : {} }), { hz: 60 });
    expect(b.event['ok']).toBe(true);
  });

  it('the camera\'s picture is about 0.1 s old: a shape that was complete at the arrival counts, one made only after it does not', () => {
    const sim = make();
    // frames stamped 5 steps behind the game's clock; the shape is held from 0.4 s before the arrival (on the camera's clock) to the arrival
    const onTime = playWall(sim, 0, (k, w) => ({ limbs: k - 5 >= w.arriveK - 24 && k - 5 <= w.arriveK ? shapeLimbs(sim, w) : {} }), { lagK: 5, hz: 60 });
    expect(onTime.event['ok']).toBe(true);
    const sim2 = make();
    const tooLate = playWall(sim2, 0, (k, w) => ({ limbs: k - 5 > w.arriveK ? shapeLimbs(sim2, w) : {} }), { lagK: 5, hz: 60 });
    expect(tooLate.event['ok']).toBe(false);
  });

  it('the camera\'s clock may jump (a new session): the walls are put on it again at every new picture', () => {
    const sim = make();
    const w = sim.plan.walls[0] as PwWall;
    const input = (k: number): FrameIn => frameFrom([{ ok: true, ch: chOf(k, k >= w.arriveK - 50 ? { limbs: shapeLimbs(sim, w) } : {}, { offset: k < w.arriveK - 70 ? 900_000 : 40 }) }]);
    const r = run(sim, input, { steps: w.arriveK + LAG_K + 4 });
    expect(walls(r.events).find((e) => e['id'] === 0)?.['ok']).toBe(true);
  });

  it('a squat shape needs the hips low: the right arms with the hips high say so', () => {
    const sim = make({ difficulty: 'expert', seed: 3 });
    const id = sim.plan.walls.find((x) => x.pose === 'squatT')?.id as number;
    expect(id).toBeGreaterThan(0);
    const high = playWall(sim, id, (_k, w) => ({ limbs: shapeLimbs(sim, w), drop: 0.05 }));
    expect(high.event['code']).toBe('hips_not_low');
    const low = playWall(make({ difficulty: 'expert', seed: 3 }), id, (_k, w) => ({ limbs: shapeLimbs(sim, w), drop: 0.5 }));
    expect(low.event['ok']).toBe(true);
  });

  it('the standing legs are judged only when the shape has legs, and a seated player is never asked for them', () => {
    const sim = make({ seated: true, difficulty: 'hard' });
    const w = sim.plan.walls[0] as PwWall;
    // the camera sees no legs at all and the thighs lie flat: nothing to say about it
    const { event } = playWall(sim, 0, () => ({ limbs: { ...shapeLimbs(sim, w), thighL: 0, thighR: 180, shinL: 90, shinR: 90 }, legs: false }));
    expect(event['ok']).toBe(true);
    expect(sim.playerStates[0]?.limbs.thighL).toBe(STAND.thighL);
  });
});

describe('why a wall was missed', () => {
  it('each way of spoiling a wall is named: the limb that was off, a hold that was too short, hands or knees out of view, hips not low', () => {
    const sim = make({ difficulty: 'expert', seed: 12 });
    const b = bot(sim, { mode: 'sloppy', spoil: (w, n) => (w.pose === 'squatT' ? 'low' : n % 2 === 1 ? (POSE_SPOILS[Math.floor(n / 2) % POSE_SPOILS.length] as (typeof POSE_SPOILS)[number]) : null) });
    const r = run(sim, inputOf(b));
    const ev = walls(r.events);
    expect(b.spoiled.size).toBeGreaterThan(15);
    const kinds = new Set<string>();
    for (const [id, how] of b.spoiled) {
      const e = ev.find((x) => x['id'] === id) as SimEvent;
      expect(e['ok'], `wall ${id} ${how.kind}`).toBe(false);
      kinds.add(how.kind);
      switch (how.kind) {
        case 'limb': expect(e['code']).toBe('limb_off'); expect(e['limb']).toBe(how.limb); break;
        case 'late': expect(e['code']).toBe('held_too_short'); break;
        case 'hands': expect(e['code']).toBe('hands_out_of_view'); break;
        case 'knees': expect(e['code']).toBe('knees_out_of_view'); break;
        case 'low': expect(e['code']).toBe('hips_not_low'); break;
        case 'wrong': expect(e['code']).toBe('limb_off'); break;
      }
    }
    expect([...kinds].sort()).toEqual([...POSE_SPOILS].sort());
    // the walls that were left alone were passed
    for (const e of ev) if (!b.spoiled.has(Number(e['id']))) expect(e['ok'], `wall ${String(e['id'])}`).toBe(true);
  });

  it('a miss ends the streak and costs nothing else; the best streak is kept and the reason is kept for the strip', () => {
    const sim = make({ difficulty: 'hard', seed: 5 });
    const b = bot(sim, { mode: 'sloppy', spoil: (_w, n) => (n === 3 || n === 4 ? 'limb' : null) });
    const upto = (sim.plan.walls[4] as PwWall).arriveK + LAG_K + 2;
    const r = run(sim, inputOf(b), { steps: upto });
    const ev = walls(r.events);
    const p = sim.playerStates[0]!;
    expect(ev.map((e) => e['ok'])).toEqual([true, true, true, false, false]);
    expect(p).toMatchObject({ passed: 3, missed: 2, bestStreak: 3, streak: 0 });
    expect(p.miss?.code).toBe('limb_off');
    expect(p.miss?.limb).toBe(b.spoiled.get(4)?.limb);
    expect(p.score).toBe(ev.reduce((n, e) => n + Number(e['pts'] ?? 0), 0) + 30 * types(r.events, 'series').length);
    // the streak starts again from one
    const more = run(sim, inputOf(b), { from: r.k, steps: 900 });
    expect(Number(walls(more.events)[0]?.['streak'])).toBe(1);
  });

  it('a player who does not move misses every wall with "limb off", and earns no calories beyond the misses', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'idle' })));
    const ev = walls(r.events);
    expect(ev.length).toBe(sim.plan.walls.length);
    expect(ev.every((e) => e['ok'] === false && e['code'] === 'limb_off')).toBe(true);
    const s = sim.summary();
    expect(s.score).toBe(0);
    expect(s.reps).toBe(0);
    expect(s.metSeconds).toBeLessThan(5);
  });

  it('nobody in view: the walls are skipped, nothing is won or lost', () => {
    const sim = make();
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', hidden: () => true })));
    const ev = walls(r.events);
    expect(ev.length).toBe(sim.plan.walls.length);
    expect(ev.every((e) => e['skipped'] === true)).toBe(true);
    expect(sim.playerStates[0]).toMatchObject({ missed: 0, passed: 0, score: 0, streak: 0 });
    expect(sim.summary().quality).toBe(0);
  });

  it('a camera frame without a body is "not seen", not a body standing with its arms down', () => {
    const sim = make();
    const frame = (k: number): FrameIn => ({ source: 'pose', players: [{ ok: true, ch: k % 2 ? {} : {}, events: [] }] });
    const r = run(sim, frame, { steps: 3000 });
    expect(walls(r.events).every((e) => e['skipped'] === true)).toBe(true);
    expect(sim.playerStates[0]?.missed).toBe(0);
  });

  it('a shape that was reached for a single picture is "hold it longer", not "an arm was off" (reasonFor)', () => {
    expect(reasonFor({ code: 'limb_off', limb: 'armUpperL', got: 10, need: 22 })).toEqual({ code: 'held_too_short', got: 0, need: 300 });
    expect(reasonFor({ code: 'limb_off', limb: 'armUpperL', got: 40, need: 22 })).toEqual({ code: 'limb_off', limb: 'armUpperL', got: 40, need: 22 });
    expect(reasonFor({ code: 'hips_not_low', got: 0.1, need: 0.35 })).toEqual({ code: 'hips_not_low', got: 0.1, need: 0.35 });
  });
});

describe('series', () => {
  const firstSeries = (sim: PoseWallSim): PwWall[] => {
    const ws = sim.plan.walls;
    const i = ws.findIndex((w) => w.series === 1);
    return ws.slice(i, i + (ws[i] as PwWall).of);
  };

  it('a series that was passed to the end earns its bonus once, at its last wall', () => {
    const sim = make({ difficulty: 'normal', seed: 4 });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    const series = types(r.events, 'series');
    const starts = sim.plan.walls.filter((w) => w.series === 1).length;
    expect(starts).toBeGreaterThan(0);
    expect(series).toHaveLength(starts);
    for (const e of series) expect(e['bonus']).toBe(30);
    const ev = walls(r.events);
    expect(sim.playerStates[0]?.score).toBe(ev.reduce((n, e) => n + Number(e['pts']), 0) + 30 * starts);
  });

  it('a wall missed inside a series cancels its bonus; the next series is fresh', () => {
    const sim = make({ difficulty: 'normal', seed: 4 });
    const s = firstSeries(sim);
    const b = bot(sim, { mode: 'sloppy', spoil: (w) => (w.id === (s[0] as PwWall).id ? 'limb' : null) });
    const r = run(sim, inputOf(b));
    const starts = sim.plan.walls.filter((w) => w.series === 1).length;
    expect(types(r.events, 'series')).toHaveLength(starts - 1);
    expect(types(r.events, 'series').every((e) => e['bonus'] === 30)).toBe(true);
  });

  it('a wall nobody was there to judge also takes the bonus away', () => {
    const sim = make({ difficulty: 'normal', seed: 4 });
    const s = firstSeries(sim);
    const hide = (s[1] as PwWall).arriveK;
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', hidden: (k) => k >= hide - 70 && k <= hide + 12 })));
    const starts = sim.plan.walls.filter((w) => w.series === 1).length;
    expect(types(r.events, 'series')).toHaveLength(starts - 1);
  });
});

describe('two players on one camera', () => {
  it('each lane is judged on its own body: one perfect, one standing still', () => {
    const sim = make({ players: 2 });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'idle', lane: 1 })));
    const [a, b] = sim.playerStates as [typeof sim.playerStates[0], typeof sim.playerStates[0]];
    expect(a.passed).toBe(sim.plan.walls.length / 2);
    expect(a.score).toBeGreaterThan(1000);
    expect(b.passed).toBe(0);
    expect(b.missed).toBe(sim.plan.walls.length / 2);
    expect(b.score).toBe(0);
    expect(types(r.events, 'team')).toHaveLength(0);
    const s = sim.summary();
    expect(s.players?.[1]?.score).toBe(a.score);
    expect(s.players?.[2]?.score).toBe(0);
    expect(s.score).toBe(a.score);
  });

  it('two exact players make a team pass at every wall: 25 points each, and the log says so', () => {
    const sim = make({ players: 2, seed: 9 });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0, clockOffset: 0 }), bot(sim, { mode: 'perfect', lane: 1, clockOffset: 777_000 })));
    const per = sim.plan.walls.length / 2;
    expect(types(r.events, 'team')).toHaveLength(per);
    expect(sim.teamPasses).toBe(per);
    const log = sim.summary().log;
    expect(log.filter((e) => e.kind === 'team')).toHaveLength(per);
    expect(log.filter((e) => e.kind === 'wall' && e.player === 1)).toHaveLength(per);
    expect(log.filter((e) => e.kind === 'wall' && e.player === 2)).toHaveLength(per);
    const p = sim.playerStates;
    expect(p[0]?.score).toBeGreaterThan(per * 25);
  });

  it('one player out of view skips only their walls, and the other goes on alone', () => {
    const sim = make({ players: 2 });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'perfect', lane: 1, hidden: () => true })));
    const ev = walls(r.events);
    expect(ev.filter((e) => e['lane'] === 1).every((e) => e['skipped'] === true)).toBe(true);
    expect(ev.filter((e) => e['lane'] === 0).every((e) => e['ok'] === true)).toBe(true);
    expect(types(r.events, 'team')).toHaveLength(0);
  });

  it('a series bonus is each player\'s own', () => {
    const sim = make({ players: 2, seed: 4 });
    const first = sim.plan.walls.find((w) => w.series === 1 && w.lane === 1) as PwWall;
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', lane: 0 }), bot(sim, { mode: 'sloppy', lane: 1, spoil: (w) => (w.id === first.id ? 'limb' : null) })));
    const mine = types(r.events, 'series').filter((e) => e['lane'] === 0).length;
    const theirs = types(r.events, 'series').filter((e) => e['lane'] === 1).length;
    expect(mine).toBe(sim.plan.walls.filter((w) => w.series === 1 && w.lane === 0).length);
    expect(theirs).toBe(mine - 1);
  });
});

describe('keys and swipes', () => {
  it('step through the shapes of the level, with "rest" first; a key held down picks once; rest brings the arms down', () => {
    const sim = make({ difficulty: 'easy' });
    const names = sim.pickNames;
    expect(names).toEqual(pickShapes('easy', false));
    expect(names[0]).toBe('rest');
    expect(names).toHaveLength(6);
    const step = (ch: Record<string, number>, k: number): void => { sim.step({ source: 'keyboard', players: [{ ok: true, ch, events: [] }] }); void k; };
    step({}, 1);
    expect(sim.playerStates[0]?.pick).toBe(0);
    for (let i = 0; i < 20; i++) step({ pickNext: 1 }, 2 + i);
    expect(sim.playerStates[0]?.pick).toBe(1);
    step({}, 30);
    step({ pickNext: 1 }, 31);
    expect(sim.playerStates[0]?.pick).toBe(2);
    step({}, 32);
    step({ pickPrev: 1 }, 33);
    step({}, 34);
    step({ pickPrev: 1 }, 35);
    step({}, 36);
    step({ pickPrev: 1 }, 37);
    expect(sim.playerStates[0]?.pick).toBe(5);
    step({}, 38);
    step({ pickRest: 1 }, 39);
    expect(sim.playerStates[0]?.pick).toBe(0);
    expect(sim.playerStates[0]?.limbs.armUpperR).toBe(STAND.armUpperR);
  });

  it('the avatar makes the picked shape exactly, with its depth for a squat, and the judge reads it like a camera', () => {
    const sim = make({ difficulty: 'expert', seed: 1 });
    const squat = sim.pickNames.indexOf('squatT');
    for (let i = 0; i < squat; i++) {
      sim.step({ source: 'keyboard', players: [{ ok: true, ch: { pickNext: 1 }, events: [] }] });
      sim.step({ source: 'keyboard', players: [{ ok: true, ch: {}, events: [] }] });
    }
    const p = sim.playerStates[0]!;
    expect(p.pick).toBe(squat);
    const shape = sim.shape('squatT');
    expect(p.limbs.armUpperR).toBe(shape.limbs.armUpperR);
    expect(p.limbs.armUpperL).toBe(shape.limbs.armUpperL);
    expect(p.drop).toBe(shape.minDrop);
  });

  it.each([['easy', false], ['normal', false], ['normal', true], ['hard', false]] as const)('a player on the keys passes every wall of %s (seated %s) by picking the shape', (level, seated) => {
    const sim = make({ difficulty: level, seated });
    const r = run(sim, inputOf(bot(sim, { mode: 'perfect', keyed: true })));
    const ev = walls(r.events);
    expect(ev.length).toBe(sim.plan.walls.length);
    expect(ev.filter((e) => e['ok'] !== true).length).toBe(0);
    expect(sim.summary().metSeconds).toBeGreaterThan(30);
  });

  it('touch and keys are the same three inputs: a pulse of next, previous or rest', () => {
    const sim = make({ difficulty: 'easy' });
    const pulse = (name: string): void => {
      for (let i = 0; i < 6; i++) sim.step({ source: 'touch', players: [{ ok: true, ch: { [name]: 1 }, events: [] }] });
      for (let i = 0; i < 6; i++) sim.step({ source: 'touch', players: [{ ok: true, ch: {}, events: [] }] });
    };
    pulse('pickNext');
    pulse('pickNext');
    expect(sim.playerStates[0]?.pick).toBe(2);
    pulse('pickPrev');
    expect(sim.playerStates[0]?.pick).toBe(1);
    pulse('pickRest');
    expect(sim.playerStates[0]?.pick).toBe(0);
  });
});

describe('the avatar and the fit', () => {
  it('shows how well the body fits the next wall: low standing still, full in the shape, and zero in a rest', () => {
    const sim = make({ difficulty: 'easy' });
    const w = sim.plan.walls[0] as PwWall;
    const lives: number[] = [];
    const input = (k: number): FrameIn => frameFrom([{ ok: true, ch: chOf(k, k >= w.arriveK - 70 ? { limbs: shapeLimbs(sim, w) } : {}) }]);
    for (let k = 1; k <= w.arriveK - 30; k++) { sim.step(input(k)); if (k === w.arriveK - 100) lives.push(sim.playerStates[0]?.live ?? -1); }
    lives.push(sim.playerStates[0]?.live ?? -1);
    expect(lives[0]).toBeLessThan(0.3);
    expect(lives[1]).toBe(1);
    const restK = sim.plan.segments[1]!.startK + 30;
    run(sim, input, { from: w.arriveK - 30, steps: restK - (w.arriveK - 30) });
    expect(sim.segment.kind).toBe('rest');
    expect(sim.playerStates[0]?.live).toBe(0);
  });

  it('liveFit: 1 inside the tolerance, falling to 0 three tolerances out, counting only the limbs the shape asks for; a stray limb caps it', () => {
    const t = shapeOf('tPose', false);
    const full = { ...STAND, ...t.limbs } as LimbAngles;
    expect(liveFit(full, t, 22)).toBe(1);
    expect(liveFit({ ...full, armUpperR: 15 } as LimbAngles, t, 22)).toBe(1);
    const half = liveFit({ ...full, armUpperR: 22 + 22 } as LimbAngles, t, 22);
    expect(half).toBeGreaterThan(0.8);
    expect(half).toBeLessThan(1);
    expect(liveFit({ ...full, armUpperR: 90, armLowerR: 90, armUpperL: 90, armLowerL: 90 } as LimbAngles, t, 22)).toBeLessThan(0.1);
    expect(liveFit(STAND as LimbAngles, t, 22)).toBeLessThan(0.1);
    // arms right, a leg stepped out: not a full glow
    expect(liveFit({ ...full, thighL: -130 } as LimbAngles, t, 22)).toBe(0.85);
  });

  it('the avatar of a seated player keeps its standing legs whatever the camera says about them', () => {
    const sim = make({ seated: true });
    const w = sim.plan.walls[0] as PwWall;
    run(sim, (k) => frameFrom([{ ok: true, ch: chOf(k, { limbs: { thighL: 10, thighR: 170, shinL: 20, shinR: 160 } }) }]), { steps: w.arriveK - 20 });
    const l = sim.playerStates[0]!.limbs;
    expect([l.thighL, l.thighR, l.shinL, l.shinR]).toEqual([STAND.thighL, STAND.thighR, STAND.shinL, STAND.shinR]);
  });
});

describe('results', () => {
  it('count the walls passed, the perfect ones, the best streak and the mean fit', () => {
    const sim = make({ difficulty: 'hard', seed: 6 });
    const b = bot(sim, { mode: 'sloppy', spoil: (_w, n) => (n % 5 === 4 ? 'limb' : null) });
    const r = run(sim, inputOf(b));
    const ev = walls(r.events);
    const s = sim.summary();
    const passed = ev.filter((e) => e['ok'] === true);
    expect(s.reps).toBe(passed.length);
    expect(s.cleared).toBe(passed.length);
    expect(s.hits).toBe(passed.filter((e) => e['perfect'] === true).length);
    expect(s.bestStreak).toBe(4);
    const fits = passed.reduce((n, e) => n + Number(e['fit']), 0);
    expect(s.quality).toBeCloseTo(fits / ev.length, 2);
    expect(s.quality).toBeLessThan(0.85);
    expect(s.score).toBeGreaterThan(1000);
    expect(s.seconds).toBe(214);
    expect(s.players).toBeUndefined();
  });

  it('the calories are honest: MET times the seconds of real movement, a seated run counts three quarters', () => {
    for (const seated of [false, true]) {
      const sim = make({ seated });
      run(sim, inputOf(bot(sim, { mode: 'perfect' })));
      const p = sim.playerStates[0]!;
      const expected = Math.round(4 * PW_VARIANT_MET[seated ? 'seated' : 'standing'] * (p.activeSteps / 60) * 10) / 10;
      expect(sim.summary().metSeconds).toBe(expected);
      expect(p.activeSteps / 60).toBeGreaterThan(60);
      expect(p.activeSteps / 60).toBeLessThan(180);
    }
    expect(PW_VARIANT_MET.seated / PW_VARIANT_MET.standing).toBe(0.75);
  });

  it('the log has one entry for every wall judged, in time order, with the player only in two player runs', () => {
    const sim = make();
    run(sim, inputOf(bot(sim, { mode: 'sloppy' })));
    const log = sim.summary().log;
    const judged = sim.playerStates[0]!.passed + sim.playerStates[0]!.missed;
    expect(log.filter((e) => e.kind !== 'series')).toHaveLength(judged);
    for (let i = 1; i < log.length; i++) expect(log[i]!.t).toBeGreaterThanOrEqual(log[i - 1]!.t);
    expect(log.some((e) => e.player !== undefined)).toBe(false);
  });
});

describe('determinism, snapshot and restore', () => {
  it('the same seed and the same body give the same run, event for event', () => {
    const a = make({ seed: 21 });
    const b = make({ seed: 21 });
    const ra = run(a, inputOf(bot(a, { mode: 'sloppy' })));
    const rb = run(b, inputOf(bot(b, { mode: 'sloppy' })));
    expect(rb.events).toEqual(ra.events);
    expect(b.summary()).toEqual(a.summary());
  });

  it('restore(snapshot()) continues exactly, also in the middle of a hold and from a fresh simulation of another seed', () => {
    const a = make({ seed: 9, difficulty: 'hard' });
    const bt = bot(a, { mode: 'sloppy' });
    const w = a.plan.walls[5] as PwWall;
    // the middle of the window of the wall: the judge has seen frames and the hold is running
    const first = run(a, inputOf(bt), { steps: w.arriveK - 20 });
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as unknown;
    const rest = run(a, inputOf(bt), { from: first.k });
    const b = make({ seed: 77, difficulty: 'easy' });
    b.restore(snap);
    const rb = run(b, inputOf(bt), { from: first.k });
    expect(rb.events).toEqual(rest.events);
    expect(b.summary()).toEqual(a.summary());
    expect(() => b.restore({ v: 9 })).toThrow();
    expect(() => b.restore(null)).toThrow();
  });

  it('the snapshot is plain finite JSON, and the judge keeps no more than the walls in play', () => {
    const sim = make();
    run(sim, inputOf(bot(sim, { mode: 'perfect' })), { steps: 5000 });
    const snap = sim.snapshot() as { judges: { walls: { $map: unknown[] } }[]; [k: string]: unknown };
    const { judges, ...state } = snap;
    const nonFinite: string[] = [];
    JSON.stringify(state, (key, v) => { if (typeof v === 'number' && !Number.isFinite(v)) nonFinite.push(key); return v; });
    expect(nonFinite).toEqual([]);
    expect(judges).toHaveLength(1);
    expect(judges[0]?.walls.$map.length).toBeLessThanOrEqual(3);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it('a finished run takes no more steps, and never asks for a clock, a random number or the page', () => {
    const sim = make({ timing: SHORT });
    run(sim, inputOf(bot(sim, { mode: 'perfect' })));
    expect(sim.phase).toBe('complete');
    expect(sim.step(frameFrom([{ ok: true, ch: {} }]))).toEqual([]);
    for (const f of ['posewall.ts', 'plan.ts', 'pw-poses.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|requestAnimationFrame/);
    }
  });
});

describe('the plan on its own', () => {
  it('makePwPlan with a different tolerance table is still whole steps and sorted by arrival', () => {
    const plan = makePwPlan('expert', false, PW_TIMING, mulberry32(streamSeed(5, 'course')), 2);
    expect(plan.walls.every((w) => Number.isInteger(w.arriveK) && Number.isInteger(w.fromK))).toBe(true);
    for (let i = 2; i < plan.walls.length; i++) expect((plan.walls[i] as PwWall).arriveK).toBeGreaterThan((plan.walls[i - 2] as PwWall).arriveK);
    expect(plan.level).toBe('expert');
    expect(plan.seated).toBe(false);
  });
});
