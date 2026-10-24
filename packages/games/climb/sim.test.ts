// Summit Climb's rules, one at a time, on the pure simulation: the wall and its parts, the pull and the reference pull, the
// ledge, the breather, the hard part, the rocks, the summit and the medals, the rest between climbs, the hints, and the bots
// (perfect, good, sloppy, short, idle) on every level and in every variant.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rngStream } from '../../core/loop/rng.ts';
import {
  BREATH_SEC, clockOf, createClimb, CRUX_SLIP, DIFFICULTIES, HOLD_SEC, IDLE, LEVELS, levelOf, makeCourse, nextSection, pendingRock, POINTS, progressOf, QUIT, READY_SEC,
  REF, rocksOf, sectionsOf, SLIP, stepClimb, totals, WARMUP, WARN_SEC, type ClimbEvent, type ClimbIn, type ClimbState, type Section,
} from './sim.ts';
import { climbBot, reachOf, type BotKind } from './testing/bot.ts';

const DT = 1 / 60;

const mk = (o: Partial<Parameters<typeof createClimb>[0]> = {}): ClimbState => createClimb({ difficulty: 'normal', seated: false, quiet: false, rng: rngStream(1, 'course'), ...o });

function run(s: ClimbState, sec: number, inp: ClimbIn | ((s: ClimbState) => ClimbIn) = IDLE): ClimbEvent[] {
  const out: ClimbEvent[] = [];
  for (let i = 0; i < Math.round(sec / DT); i++) out.push(...stepClimb(s, DT, typeof inp === 'function' ? inp(s) : inp));
  return out;
}

const pull = (side: 'L' | 'R' | '' = 'L', amp = 0.8, shrug = false): ClimbIn => ({ ...IDLE, pulls: [{ side, amp, shrug }] });
const step1 = (k = 0.8): ClimbIn => ({ ...IDLE, steps: [{ k, side: 'L' }] });
const of = <T extends ClimbEvent['type']>(ev: ClimbEvent[], type: T): Extract<ClimbEvent, { type: T }>[] => ev.filter((e): e is Extract<ClimbEvent, { type: T }> => e.type === type);

/** Pulls in turn, one every `gap` seconds. */
function climb(s: ClimbState, n: number, amp = 0.8, gap = 0.5): ClimbEvent[] {
  const out: ClimbEvent[] = [];
  let side: 'L' | 'R' = s.c.lastSide === 'L' ? 'R' : 'L';
  for (let i = 0; i < n; i++) {
    out.push(...run(s, DT, pull(side, amp)));
    out.push(...run(s, gap - DT));
    side = side === 'L' ? 'R' : 'L';
  }
  return out;
}

/** Warm-up with three pulls of the given length, then the three-two-one: ready on the wall with an empty course (sections and rocks set by the test). */
function toClimb(s: ClimbState, amp = 0.8, o: { sections?: Section[]; rocks?: ClimbState['rocks'] } = {}): void {
  for (let i = 0; i < WARMUP.pulls; i++) { run(s, DT, pull(i % 2 ? 'R' : 'L', amp)); run(s, 0.4); }
  run(s, READY_SEC + 0.1);
  expect(s.phase).toBe('climb');
  s.sections = o.sections ?? [];
  s.rocks = o.rocks ?? [];
}

describe('the levels', () => {
  it('get harder in every way that matters: a higher wall, more rocks, more ledges and hard parts', () => {
    const ls = DIFFICULTIES.map((d) => LEVELS[d]);
    for (let i = 1; i < ls.length; i++) {
      expect(ls[i]!.summit).toBeGreaterThan(ls[i - 1]!.summit);
      expect(ls[i]!.rockEvery).toBeLessThan(ls[i - 1]!.rockEvery);
      expect(ls[i]!.rockTwo).toBeGreaterThanOrEqual(ls[i - 1]!.rockTwo);
      expect(ls[i]!.pull).toBeLessThanOrEqual(ls[i - 1]!.pull);
      expect(ls[i]!.ledges).toBeGreaterThanOrEqual(ls[i - 1]!.ledges);
      expect(ls[i]!.cruxes).toBeGreaterThanOrEqual(ls[i - 1]!.cruxes);
    }
    for (const l of ls) {
      expect(l.sets).toBe(3);
      expect(l.setSec).toBeGreaterThanOrEqual(60);
      expect(l.setSec).toBeLessThanOrEqual(90);
    }
    expect(levelOf('nonsense')).toBe(LEVELS.normal);
  });
});

describe('the wall', () => {
  it('is the same for the same seed and another for another', () => {
    const a = makeCourse(rngStream(3, 'course')), b = makeCourse(rngStream(3, 'course')), c = makeCourse(rngStream(4, 'course'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(3);
    const lv = LEVELS.hard;
    expect(sectionsOf(lv, a[0]!, lv.summit, true)).toEqual(sectionsOf(lv, b[0]!, lv.summit, true));
    expect(rocksOf(lv, a[1]!, lv.setSec)).toEqual(rocksOf(lv, b[1]!, lv.setSec));
    expect(rocksOf(lv, a[1]!, lv.setSec)).not.toEqual(rocksOf(lv, c[1]!, lv.setSec));
  });

  it('has its parts in order inside the wall, never overlapping, with one breather in the middle', () => {
    for (const d of DIFFICULTIES) {
      const lv = LEVELS[d];
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const c of makeCourse(rngStream(seed, 'course'))) {
          const secs = sectionsOf(lv, c, lv.summit, true);
          expect(secs.filter((x) => x.kind === 'ledge')).toHaveLength(lv.ledges);
          expect(secs.filter((x) => x.kind === 'crux')).toHaveLength(lv.cruxes);
          expect(secs.filter((x) => x.kind === 'rest')).toHaveLength(1);
          expect(secs[Math.ceil((secs.length - 1) / 2)]!.kind).toBe('rest');
          expect(secs[0]!.y0).toBeGreaterThanOrEqual(lv.summit * 0.1 - 1e-9);
          for (let i = 0; i < secs.length; i++) {
            const x = secs[i]!;
            expect(x.y0 + x.len).toBeLessThanOrEqual(lv.summit * 0.9 + 1e-6);
            if (i > 0) expect(x.y0).toBeGreaterThan(secs[i - 1]!.y0 + secs[i - 1]!.len + 0.2);
            if (x.kind === 'ledge') expect(x.steps).toBe(lv.ledgeSteps);
            if (x.kind === 'crux') expect(x.sec).toBe(lv.cruxSec);
          }
        }
      }
    }
  });

  it('has no ledge for the seated and the quiet climber: the arms climb everything', () => {
    for (const d of DIFFICULTIES) {
      const lv = LEVELS[d];
      for (const c of makeCourse(rngStream(2, 'course'))) {
        const secs = sectionsOf(lv, c, lv.summit, false);
        expect(secs.some((x) => x.kind === 'ledge')).toBe(false);
        expect(secs.filter((x) => x.kind === 'crux')).toHaveLength(lv.cruxes);
      }
    }
    expect(mk({ seated: true }).sections.some((x) => x.kind === 'ledge')).toBe(false);
    expect(mk({ quiet: true }).sections.some((x) => x.kind === 'ledge')).toBe(false);
    expect(mk().sections.filter((x) => x.kind === 'ledge')).toHaveLength(LEVELS.normal.ledges);
  });

  it('lets rocks fall in order, spaced out, always leaving a column open and never the same pattern twice', () => {
    for (const d of DIFFICULTIES) {
      const lv = LEVELS[d];
      let two = 0, all = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        for (const c of makeCourse(rngStream(seed, 'course'))) {
          const rocks = rocksOf(lv, c, lv.setSec);
          expect(rocks.length).toBeGreaterThanOrEqual(Math.floor(lv.setSec / (lv.rockEvery * 1.4)));
          expect(rocks.length).toBeLessThanOrEqual(Math.ceil(lv.setSec / (lv.rockEvery * 0.75)));
          rocks.forEach((r, i) => {
            expect(r.closed.some((x) => !x), 'a column is open').toBe(true);
            expect(r.closed.some((x) => x)).toBe(true);
            expect(r.t).toBeLessThan(lv.setSec - 2.4);
            expect(r.t).toBeGreaterThan(WARN_SEC);
            if (i > 0) {
              expect(r.t - rocks[i - 1]!.t).toBeGreaterThanOrEqual(lv.rockEvery * 0.7);
              expect(r.closed.join()).not.toBe(rocks[i - 1]!.closed.join());
            }
            if (r.closed.filter((x) => x).length === 2) two++;
            all++;
          });
        }
      }
      if (d === 'easy') expect(two).toBe(0);
      if (d === 'expert') expect(two / all).toBeGreaterThan(0.25);
    }
  });
});

describe('the warm-up and the reference pull', () => {
  it('measures the reference pull from the first three pulls: their median, a little under, within limits', () => {
    const s = mk();
    const ev = [...run(s, DT, pull('L', 0.6)), ...run(s, 0.4), ...run(s, DT, pull('R', 0.7)), ...run(s, 0.4), ...run(s, DT, pull('L', 0.8)), ...run(s, 0.1)];
    expect(of(ev, 'warmup').map((e) => e.pulls)).toEqual([1, 2, 3]);
    expect(of(ev, 'ready')).toHaveLength(1);
    expect(s.phase).toBe('ready');
    expect(s.ref).toBeCloseTo(0.7 * 0.95, 5);
    const tiny = mk();
    for (const a of [0.2, 0.25, 0.3]) { run(tiny, DT, pull('L', a)); run(tiny, 0.3); }
    expect(tiny.ref).toBe(REF.lo);
    const huge = mk();
    for (const a of [1.4, 1.5, 1.6]) { run(huge, DT, pull('R', a)); run(huge, 0.3); }
    expect(huge.ref).toBe(REF.hi);
  });

  it('keeps a standard reference for keys and taps (they have no length) and gives up waiting after the longest time', () => {
    const keys = mk();
    for (let i = 0; i < 3; i++) { run(keys, DT, pull('', 0)); run(keys, 0.5); }
    expect(keys.phase).toBe('ready');
    expect(keys.ref).toBeCloseTo(REF.dflt * 0.95, 5);
    const idle = mk();
    const ev = run(idle, WARMUP.maxSec + 1);
    expect(idle.phase).toBe('ready');
    expect(of(ev, 'ready')).toHaveLength(1);
    expect(idle.ref).toBe(REF.dflt);
  });

  it('counts down three, two, one, then the climb begins and the clock shows the seconds left', () => {
    const s = mk();
    const ev: ClimbEvent[] = [];
    for (let i = 0; i < 3; i++) { ev.push(...run(s, DT, pull('L'))); ev.push(...run(s, 0.1)); }
    ev.push(...run(s, READY_SEC + 0.2));
    expect(of(ev, 'tick').map((e) => e.n)).toEqual([3, 2, 1]);
    expect(of(ev, 'go')).toEqual([{ type: 'go', set: 1 }]);
    expect(s.phase).toBe('climb');
    expect(clockOf(s)).toBeCloseTo(LEVELS.normal.setSec - 0.2, 0);
    run(s, 10);
    expect(clockOf(s)).toBeCloseTo(LEVELS.normal.setSec - 10.2, 0);
  });
});

describe('pulling', () => {
  it('climbs the length of a pull of the reference length, less for a shorter one and at most a quarter more for a longer one', () => {
    const lv = LEVELS.normal;
    const s = mk();
    toClimb(s, 0.8);
    const ref = s.ref;
    const gain = (amp: number): number => { const before = s.c.h; run(s, DT, pull(s.c.lastSide === 'L' ? 'R' : 'L', amp)); run(s, 0.2); return s.c.h - before; };
    expect(gain(ref)).toBeCloseTo(lv.pull, 5);
    expect(gain(ref * 0.5)).toBeCloseTo(lv.pull * 0.5, 5);
    expect(gain(ref * 3)).toBeCloseTo(lv.pull * 1.25, 5);
    expect(s.c.pulls).toBe(3);
  });

  it('alternates the hands for keys and taps (they have no side) and counts two in a flash as one and a half', () => {
    const s = mk();
    toClimb(s, 0.8);
    const sides: string[] = [];
    for (let i = 0; i < 4; i++) { const ev = run(s, DT, pull('', 0)); sides.push(...of(ev, 'pull').map((e) => e.side)); run(s, 0.5); }
    expect(sides).toEqual(['L', 'R', 'L', 'R']);
    const h0 = s.c.h;
    run(s, DT, pull('', 0));
    run(s, 0.1, IDLE);
    run(s, DT, pull('', 0));
    expect(s.c.h - h0).toBeCloseTo(LEVELS.normal.pull * 1.5, 5);
  });

  it('the same hand twice climbs on what the detector gave (half), ends the run of pulls in turn and says so', () => {
    const s = mk();
    toClimb(s, 0.8);
    climb(s, 6, s.ref);
    expect(s.c.streak).toBe(6);
    const ev = run(s, DT, pull(s.c.lastSide as 'L' | 'R', s.ref * 0.5));
    expect(s.c.streak).toBe(0);
    expect(of(ev, 'hint').map((e) => e.code)).toEqual(['same_hand_twice']);
    expect(of(ev, 'pull')[0]!.gain).toBeCloseTo(LEVELS.normal.pull * 0.5, 5);
  });

  it('a shrug halves the climb and asks for the shoulders down', () => {
    const s = mk();
    toClimb(s, 0.8);
    const ev = run(s, DT, pull('L', s.ref, true));
    expect(of(ev, 'pull')[0]!.gain).toBeCloseTo(LEVELS.normal.pull * 0.5, 5);
    expect(of(ev, 'hint').map((e) => e.code)).toEqual(['shoulders_down']);
  });

  it('raises the points multiplier every ten pulls in turn, up to three, and the points follow the height', () => {
    const s = mk({ summit: 200, setSec: 200 });
    toClimb(s, 0.8);
    const ev = climb(s, 32, s.ref, 0.3);
    const mults = of(ev, 'pull').map((e) => e.mult);
    expect(mults.slice(0, 9).every((m) => m === 1)).toBe(true);
    expect(mults[9]).toBe(2);
    expect(mults[19]).toBe(3);
    expect(Math.max(...mults)).toBe(3);
    const pts = of(ev, 'pull').reduce((n, e) => n + Math.round(e.gain * POINTS.metre * e.mult), 0);
    expect(s.c.score).toBe(pts);
  });
});

describe('the ledge', () => {
  const ledge: Section = { kind: 'ledge', y0: 2, len: 2, steps: 4, sec: 0 };

  it('stops the climb at its foot: the arms rest and the knees climb the steps', () => {
    const s = mk();
    toClimb(s, 0.8, { sections: [ledge] });
    const ev = climb(s, 6, s.ref);
    expect(s.c.h).toBe(2);
    expect(s.c.on).toBe('ledge');
    expect(of(ev, 'ledge').map((e) => e.phase)).toEqual(['reach']);
    // More pulls do nothing, and the climber is told to use the legs.
    expect(of(ev, 'hint').map((e) => e.code)).toEqual(['ledge_use_legs']);
    run(s, DT, pull('L', s.ref));
    expect(s.c.h).toBe(2);
    const steps: ClimbEvent[] = [];
    for (let i = 0; i < 4; i++) { steps.push(...run(s, DT, step1())); run(s, 0.3); }
    expect(of(steps, 'step').map((e) => e.h)).toEqual([2.5, 3, 3.5, 4]);
    expect(of(steps, 'ledge').map((e) => e.phase)).toEqual(['done']);
    expect(s.c.on).toBeNull();
    expect(s.c.base).toBe(4);
    expect(s.c.ledges).toBe(1);
    expect(s.c.steps).toBe(4);
    // And the arms take over again.
    run(s, DT, pull('R', s.ref));
    expect(s.c.h).toBeGreaterThan(4);
  });

  it('a knee on the wall does nothing', () => {
    const s = mk();
    toClimb(s, 0.8);
    run(s, DT, step1());
    expect(s.c.h).toBe(0);
    expect(s.c.steps).toBe(0);
  });

  it('is climbed by the seated climber with the arms, because there is none', () => {
    const s = mk({ seated: true });
    expect(s.sections.some((x) => x.kind === 'ledge')).toBe(false);
  });
});

describe('the breather', () => {
  it('stops the clock and the rocks for a few seconds at the ledge of rest, and the climb goes on after it', () => {
    const s = mk();
    toClimb(s, 0.8, { sections: [{ kind: 'rest', y0: 1, len: 0, steps: 0, sec: 0 }], rocks: [{ t: 3, closed: [false, true, false] }] });
    climb(s, 3, s.ref);
    expect(s.c.on).toBe('rest');
    expect(s.c.h).toBe(1);
    const t0 = s.setT;
    const ev = run(s, BREATH_SEC / 2, pull('L', s.ref));
    expect(s.setT).toBe(t0);
    expect(s.c.h).toBe(1);
    expect(of(ev, 'rock')).toEqual([]);
    const end = run(s, BREATH_SEC);
    expect(of(end, 'breath').map((e) => e.phase)).toEqual(['end']);
    expect(s.c.on).toBeNull();
    expect(s.setT).toBeGreaterThan(t0);
    expect(s.c.sec).toBe(1);
    run(s, DT, pull('R', s.ref));
    expect(s.c.h).toBeGreaterThan(1);
  });

  it('is not an idle climber: resting never calls the climb off', () => {
    const s = mk();
    toClimb(s, 0.8, { sections: [{ kind: 'rest', y0: 0.5, len: 0, steps: 0, sec: 0 }] });
    climb(s, 2, s.ref);
    expect(s.c.on).toBe('rest');
    run(s, 1);
    expect(s.c.on).toBe('rest');
    expect(s.c.idleFor).toBe(0);
    run(s, 2.2);
    expect(s.c.on).toBeNull();
    expect(s.c.idleFor).toBeLessThan(0.6);
    expect(s.phase).toBe('climb');
  });
});

describe('the hard part', () => {
  const crux: Section = { kind: 'crux', y0: 2, len: 4, steps: 0, sec: 6 };

  it('is passed against the clock: reaching its top in time pays a bonus', () => {
    const s = mk();
    toClimb(s, 0.8, { sections: [crux] });
    const ev = climb(s, 14, s.ref, 0.45);
    expect(of(ev, 'crux').map((e) => e.phase)).toEqual(['start', 'pass']);
    expect(s.c.crux).toBe(1);
    expect(s.c.slips).toBe(0);
    expect(s.c.base).toBeGreaterThanOrEqual(6);
    expect(nextSection(s)).toBeNull();
    expect(of(ev, 'crux')[1]!.pts).toBe(POINTS.crux);
  });

  it('throws the climber back when the time runs out, once: the next try has no clock', () => {
    const s = mk();
    toClimb(s, 0.8, { sections: [crux] });
    climb(s, 3, s.ref, 0.45);
    const before = s.c.h;
    expect(before).toBeGreaterThan(2);
    const ev = run(s, 7);
    expect(of(ev, 'crux').map((e) => e.phase)).toEqual(['fail']);
    expect(s.c.h).toBeCloseTo(Math.max(0, before - CRUX_SLIP), 5);
    expect(s.c.slips).toBe(1);
    expect(of(ev, 'hint').map((e) => e.code)).toContain('crux_slow');
    expect(nextSection(s)).toBeNull();
    // Slowly through the same place now: nothing is timed.
    const more = climb(s, 12, s.ref, 1.2);
    expect(of(more, 'crux')).toEqual([]);
    expect(s.c.h).toBeGreaterThan(6);
  });
});

describe('the rocks', () => {
  const rock = (closed: [boolean, boolean, boolean], t = 5): ClimbState['rocks'] => [{ t, closed }];

  it('is warned of a moment before it lands, and says whether it was after the climber', () => {
    const s = mk();
    toClimb(s, 0.8, { rocks: rock([false, true, false]) });
    const ev = run(s, 5.5);
    const warn = of(ev, 'warn');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.threat).toBe(true);
    expect(warn[0]!.at).toBe(5);
    const pr = pendingRock(s);
    expect(pr).toBeNull();
    const s2 = mk();
    toClimb(s2, 0.8, { rocks: rock([false, true, false], 5) });
    run(s2, 5 - WARN_SEC - s2.setT - 0.1);
    expect(pendingRock(s2)!.warned).toBe(false);
    run(s2, 0.2);
    expect(pendingRock(s2)!.warned).toBe(true);
  });

  it('hits a climber who stays in the closed column: down a little, not clean, the multiplier gone, and told why', () => {
    const s = mk();
    toClimb(s, 0.8, { rocks: rock([false, true, false], 12) });
    climb(s, 14, s.ref, 0.45);
    const h = s.c.h;
    expect(s.c.streak).toBeGreaterThan(5);
    const ev = run(s, 12 - s.setT + 0.1);
    expect(of(ev, 'rock')).toEqual([{ type: 'rock', hit: true, closed: [false, true, false], pts: 0 }]);
    expect(s.c.h).toBeCloseTo(Math.max(0, h - SLIP), 5);
    expect(s.c.clean).toBe(false);
    expect(s.c.hits).toBe(1);
    expect(s.c.streak).toBe(0);
    expect(of(ev, 'hint').map((e) => e.code)).toContain('rock_hit');
  });

  it('pays for a dodge only when the rock was after the climber', () => {
    const s = mk();
    toClimb(s, 0.8, { rocks: rock([false, true, false]) });
    run(s, 5 - WARN_SEC + 0.2);
    expect(s.c.threat).toBe(true);
    const ev = run(s, 0.7, { ...IDLE, lane: -1 });
    const ev2 = run(s, 1, { ...IDLE, lane: -1 });
    const rocks = of([...ev, ...ev2], 'rock');
    expect(rocks).toEqual([{ type: 'rock', hit: false, closed: [false, true, false], pts: POINTS.dodge }]);
    expect(s.c.dodged).toBe(1);
    expect(s.c.score).toBe(POINTS.dodge);
    // A rock in a column the climber was never in is nothing to be paid for.
    const t = mk();
    toClimb(t, 0.8, { rocks: rock([true, false, false]) });
    const ev3 = run(t, 6);
    expect(of(ev3, 'warn')[0]!.threat).toBe(false);
    expect(of(ev3, 'rock')).toEqual([{ type: 'rock', hit: false, closed: [true, false, false], pts: 0 }]);
    expect(t.c.dodged).toBe(0);
    expect(t.c.score).toBe(0);
  });

  it('cannot throw the climber lower than the foot of the ledge he is on, or the last place he passed', () => {
    const s = mk();
    toClimb(s, 0.8, { sections: [{ kind: 'ledge', y0: 1, len: 2, steps: 4, sec: 0 }], rocks: rock([false, true, false], 4) });
    climb(s, 3, s.ref, 0.4);
    run(s, DT, step1());
    run(s, 0.2);
    expect(s.c.on).toBe('ledge');
    expect(s.c.h).toBeCloseTo(1.5, 5);
    run(s, 5);
    expect(s.c.h).toBe(1);
    const t = mk();
    toClimb(t, 0.8, { rocks: rock([false, true, false], 3) });
    run(t, DT, pull('L', t.ref));
    run(t, 4);
    expect(t.c.h).toBe(0);
  });
});

describe('the top, the medals and the points of a climb', () => {
  it('ends the climb at the summit with a gold medal, the time left and a clean climb paid', () => {
    const s = mk({ summit: 4, setSec: 40 });
    toClimb(s, 0.8);
    const ev = climb(s, 7, s.ref, 0.5);
    expect(s.phase).toBe('finish');
    const top = of(ev, 'summit')[0]!;
    expect(top.left).toBeGreaterThan(30);
    expect(top.pts).toBe(POINTS.summit + Math.round(top.left * POINTS.left));
    const fin = of(ev, 'finish')[0]!;
    expect(fin.medal).toBe('gold');
    expect(fin.pts).toBe(top.pts + POINTS.clean);
    expect(s.c.results[0]).toMatchObject({ medal: 'gold', height: 4, clean: true, hits: 0 });
  });

  it('gives silver for three quarters of the wall, bronze for half, and nothing under that, when the time is up', () => {
    const medal = (h: number): string => {
      const s = mk({ summit: 20, setSec: 5 });
      toClimb(s, 0.8);
      s.c.h = h;
      run(s, 5.1);
      expect(s.phase).toBe('finish');
      return s.c.results[0]!.medal;
    };
    expect(medal(16)).toBe('silver');
    expect(medal(15)).toBe('silver');
    expect(medal(14.9)).toBe('bronze');
    expect(medal(10)).toBe('bronze');
    expect(medal(9.9)).toBe('none');
    expect(medal(0)).toBe('none');
  });

  it('pays the clean climb only to a climber who was not hit and got half way', () => {
    const run1 = (h: number, hit: boolean): number => {
      const s = mk({ summit: 20, setSec: 5 });
      toClimb(s, 0.8);
      s.c.h = h;
      s.c.clean = !hit;
      run(s, 5.1);
      return s.c.results[0]!.pts;
    };
    expect(run1(12, false)).toBe(POINTS.clean);
    expect(run1(12, true)).toBe(0);
    expect(run1(4, false)).toBe(0);
  });

  it('goes on after the hold: a rest, three-two-one, and the climber starts again at the foot with everything counted again; three climbs end the run', () => {
    const s = mk({ summit: 3, setSec: 30, restSec: 5 });
    toClimb(s, 0.8);
    const refBefore = s.ref;
    for (let k = 1; k <= 3; k++) {
      expect(s.set).toBe(k);
      expect(s.c.h).toBe(0);
      climb(s, 6, s.ref, 0.4);
      expect(s.phase).toBe('finish');
      expect(run(s, HOLD_SEC - s.hc + 0.1).some((e) => e.type === 'complete')).toBe(k === 3);
      if (k < 3) {
        expect(s.phase).toBe('rest');
        expect(clockOf(s)).toBeGreaterThan(4.5);
        run(s, 5.1);
        expect(s.phase).toBe('ready');
        run(s, READY_SEC + 0.1);
        expect(s.phase).toBe('climb');
        expect(s.ref).toBe(refBefore);
        s.sections = [];
        s.rocks = [];
      }
    }
    expect(s.phase).toBe('complete');
    expect(s.c.results.map((r) => r.medal)).toEqual(['gold', 'gold', 'gold']);
    expect(totals(s)).toMatchObject({ climbs: 3, hits: 0 });
    expect(stepClimb(s, DT, IDLE)).toEqual([]);
  });

  it('shows the share of the wall climbed', () => {
    const s = mk({ summit: 20 });
    expect(progressOf(s, 5)).toBe(0.25);
    expect(progressOf(s, 40)).toBe(1);
    expect(progressOf(s, -1)).toBe(0);
  });
});

describe('a climber who does nothing', () => {
  it('is nagged, then called off after a while, and two climbs called off in a row end the run', () => {
    const s = mk();
    toClimb(s, 0.8);
    const ev = run(s, QUIT + 0.5);
    expect(of(ev, 'hint').map((e) => e.code)).toContain('move_more');
    expect(of(ev, 'dnf')).toHaveLength(1);
    expect(s.phase).toBe('finish');
    expect(s.c.results[0]!.medal).toBe('dnf');
    const over = run(s, HOLD_SEC + 0.1);
    expect(of(over, 'rest')).toHaveLength(1);
    run(s, LEVELS.normal.restSec + READY_SEC + 0.2);
    expect(s.phase).toBe('climb');
    const ev2 = run(s, QUIT + 0.5);
    expect(of(ev2, 'dnf')).toHaveLength(1);
    const end = run(s, HOLD_SEC + 0.1);
    expect(of(end, 'over')).toHaveLength(1);
    expect(s.phase).toBe('over');
    expect(stepClimb(s, DT, IDLE)).toEqual([]);
  });

  it('a climb after a called off one that goes well resets the count', () => {
    const s = mk({ summit: 3, restSec: 2 });
    toClimb(s, 0.8);
    run(s, QUIT + 0.5);
    run(s, HOLD_SEC + 0.1);
    run(s, 2.1 + READY_SEC + 0.1);
    expect(s.phase).toBe('climb');
    s.sections = [];
    s.rocks = [];
    climb(s, 6, s.ref, 0.4);
    expect(s.c.results[1]!.medal).toBe('gold');
    expect(s.c.dnfStreak).toBe(0);
  });
});

describe('naming what the hands did', () => {
  const hand = (reach: number, grab = false) => ({ have: true, reach, prog: 0, grab });
  const hands = (l: ReturnType<typeof hand>, r: ReturnType<typeof hand>): ClimbIn => ({ ...IDLE, hands: [l, r] });

  it('says "reach higher" when a hand went up but never got a grip and came down again', () => {
    const s = mk();
    toClimb(s, 0.8);
    const ev = [...run(s, 0.4, hands(hand(0.05), hand(-0.8))), ...run(s, 0.4, hands(hand(-0.7), hand(-0.8))), ...run(s, 0.5)];
    expect(of(ev, 'hint').map((e) => e.code)).toEqual(['grab_higher']);
  });

  it('says "pull in one move" when a hand took hold and came down without the pull counting', () => {
    const s = mk();
    toClimb(s, 0.8);
    const ev = [...run(s, 0.4, hands(hand(0.5, true), hand(-0.8))), ...run(s, 0.4, hands(hand(-0.7), hand(-0.8))), ...run(s, 0.5)];
    expect(of(ev, 'hint').map((e) => e.code)).toEqual(['pull_through']);
  });

  it('says nothing when the pull did count, nor on a ledge, nor in the breather, nor when the hand just stays down', () => {
    const s = mk();
    toClimb(s, 0.8);
    const ev = [...run(s, 0.4, hands(hand(0.5, true), hand(-0.8))), ...run(s, DT, { ...hands(hand(-0.45), hand(-0.8)), pulls: [{ side: 'L', amp: s.ref, shrug: false }] }), ...run(s, 0.3, hands(hand(-0.7), hand(-0.8))), ...run(s, 0.5)];
    expect(of(ev, 'hint')).toEqual([]);
    const t = mk();
    toClimb(t, 0.8, { sections: [{ kind: 'ledge', y0: 0.3, len: 2, steps: 4, sec: 0 }] });
    run(t, DT, pull('L', t.ref));
    expect(t.c.on).toBe('ledge');
    const ev2 = [...run(t, 0.4, hands(hand(0.5, true), hand(-0.8))), ...run(t, 0.4, hands(hand(-0.7), hand(-0.8))), ...run(t, 0.5)];
    expect(of(ev2, 'hint')).toEqual([]);
    const u = mk();
    toClimb(u, 0.8);
    expect(of(run(u, 2, hands(hand(-0.8), hand(-0.8))), 'hint')).toEqual([]);
  });

  it('raises the arms of the picture with the real hands, and with a pull when there are none (keys)', () => {
    const s = mk();
    toClimb(s, 0.8);
    run(s, 0.5, hands(hand(0.7, true), hand(-0.8)));
    expect(s.c.arm[0]).toBeGreaterThan(0.9);
    expect(s.c.arm[1]).toBeLessThan(0.1);
    const k = mk();
    toClimb(k, 0.8);
    run(k, DT, pull('', 0));
    run(k, 0.05);
    expect(k.c.arm[0]).toBeGreaterThan(0.3);
    run(k, 1);
    expect(k.c.arm[0]).toBeLessThan(0.05);
  });
});

describe('the bots', () => {
  function play(d: string, kind: BotKind, o: { seated?: boolean; quiet?: boolean; seed?: number; botSeed?: number; steps?: number } = {}): { s: ClimbState; ev: ClimbEvent[] } {
    const s = mk({ difficulty: d, seated: !!o.seated, quiet: !!o.quiet, rng: rngStream(o.seed ?? 1, 'course') });
    const bot = climbBot(kind, o.botSeed ?? 1);
    const ev: ClimbEvent[] = [];
    for (let i = 0; i < (o.steps ?? 60 * 700) && s.phase !== 'over' && s.phase !== 'complete'; i++) ev.push(...stepClimb(s, DT, bot.next(s, DT)));
    return { s, ev };
  }
  const medals = (s: ClimbState): string[] => s.c.results.map((r) => r.medal);

  it('a perfect climber reaches the top in all three climbs on every level, in every variant, with time to spare', () => {
    for (const d of DIFFICULTIES) {
      for (const v of [{}, { seated: true }, { quiet: true }]) {
        const { s } = play(d, 'perfect', v);
        expect(s.phase, `${d} ${JSON.stringify(v)}`).toBe('complete');
        expect(medals(s), `${d} ${JSON.stringify(v)}`).toEqual(['gold', 'gold', 'gold']);
        for (const r of s.c.results) expect(r.left, `${d} ${JSON.stringify(v)} time left`).toBeGreaterThan(0.5);
        expect(s.c.results.every((r) => r.clean)).toBe(true);
      }
    }
  });

  it('a good climber tops easy and normal, and is a little short of the top on hard and expert', () => {
    for (const d of ['easy', 'normal'] as const) expect(medals(play(d, 'good').s)).toEqual(['gold', 'gold', 'gold']);
    for (const d of ['hard', 'expert'] as const) {
      const m = medals(play(d, 'good').s);
      expect(m.filter((x) => x === 'gold'), d).toEqual([]);
      expect(m.every((x) => x === 'silver' || x === 'bronze'), d).toBe(true);
    }
  });

  it('a sloppy climber gets part of the way and never to the top of a hard wall', () => {
    for (const d of DIFFICULTIES) {
      const { s } = play(d, 'sloppy');
      expect(s.phase).toBe('complete');
      if (d !== 'easy') expect(medals(s).includes('gold'), d).toBe(false);
      for (const r of s.c.results) expect(r.height).toBeGreaterThan(s.summit * 0.4);
    }
  });

  it('the better the climber the higher the score, on every level', () => {
    for (const d of DIFFICULTIES) {
      const p = play(d, 'perfect').s.c.score, g = play(d, 'good').s.c.score, sl = play(d, 'sloppy').s.c.score;
      expect(p, d).toBeGreaterThanOrEqual(g);
      expect(g, d).toBeGreaterThan(sl);
    }
  });

  it('a climber who hangs there ends the run, and one who reaches but never high enough is told how', () => {
    const idle = play('normal', 'idle');
    expect(idle.s.phase).toBe('over');
    expect(idle.s.c.score).toBeLessThan(40);
    const short = play('normal', 'short');
    expect(short.s.phase).toBe('over');
    expect(short.s.c.pulls).toBe(0);
    const codes = of(short.ev, 'hint').map((e) => e.code);
    expect(codes).toContain('grab_higher');
  });

  it('a climber who is late out of the way of the rocks is hit now and then, and one who is quick is not', () => {
    const quick = play('hard', 'perfect').s;
    expect(totals(quick).hits).toBe(0);
    expect(totals(quick).dodged).toBeGreaterThan(8);
    const late = play('hard', 'sloppy').s;
    expect(totals(late).hits).toBeGreaterThan(0);
  });

  it('is the same every time for the same seed, and the state is plain data that carries on identically after a round trip through JSON', () => {
    const a = play('normal', 'good', { steps: 60 * 40 });
    const b = play('normal', 'good', { steps: 60 * 40 });
    expect(JSON.stringify(a.ev)).toBe(JSON.stringify(b.ev));
    const copy = JSON.parse(JSON.stringify(a.s)) as ClimbState;
    const botA = climbBot('good', 9), botB = climbBot('good', 9);
    const ea: string[] = [], eb: string[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      ea.push(JSON.stringify(stepClimb(a.s, DT, botA.next(a.s, DT))));
      eb.push(JSON.stringify(stepClimb(copy, DT, botB.next(copy, DT))));
    }
    expect(eb).toEqual(ea);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(a.s));
  });

  it('the synthetic reach of the bots matches the figure of the movement library: grip height reached when the arm is more than half up', () => {
    expect(reachOf(0)).toBeLessThan(-0.6);
    expect(reachOf(0.53)).toBeGreaterThan(0.24);
    expect(reachOf(0.45)).toBeLessThan(0.25);
    expect(reachOf(1)).toBeCloseTo(0.7, 2);
  });
});

describe('purity', () => {
  it('has no clock, no random, no sine and no DOM in the simulation and the bots', () => {
    for (const f of ['sim.ts', 'testing/bot.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/Math\.random|performance\.now|Date\.now|document\.|window\.|Math\.sin|Math\.cos|setTimeout|requestAnimationFrame/);
    }
  });
});
