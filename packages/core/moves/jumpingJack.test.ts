// M5 jumping jack, drawn by the articulated rig (testing/rig.ts): arms straight up and the feet 1.75 W apart are open,
// hanging arms and the feet 0.625 W apart are closed. Synthetic numbers show that the code does what the thresholds
// say, not that they suit real bodies.
import { describe, expect, it } from 'vitest';
import { canExplain } from './kit.ts';
import { createJumpingJackDetector, JUMPING_JACK_DEFAULTS } from './jumpingJack.ts';
import { chAt, chMax, drive, pick, replayMotion, times } from './testing/harness.ts';
import { judgeOnGrid, gridFromBpm } from './rhythm.ts';
import { keyframes, plus, still, absentBetween, type ArmSpec, type FigureSpec, type Motion } from './testing/rig.ts';

const UP: ArmSpec = { a: 165, f: 165 };
const OPEN: FigureSpec = { armL: UP, armR: UP, legL: { out: 0.45 }, legR: { out: 0.45 } };

/** One jack from t0: open over openMs, held holdMs, closed again over closeMs. */
const jack = (t0: number, openMs = 250, holdMs = 150, closeMs = 250, open: FigureSpec = OPEN): Motion =>
  keyframes([[t0, {}], [t0 + openMs, open], [t0 + openMs + holdMs, open], [t0 + openMs + holdMs + closeMs, {}]]);

const jacks = (t0: number, count: number, periodMs: number, openMs?: number, holdMs?: number, closeMs?: number): Motion =>
  plus(...Array.from({ length: count }, (_, i) => jack(t0 + i * periodMs, openMs, holdMs, closeMs)));

const why = (d: ReturnType<typeof drive>, ms?: number) => {
  if (!canExplain(d.detector)) throw new Error('jumping jack must explain');
  return d.detector.explain(ms);
};

describe('one jack', () => {
  const d = drive(createJumpingJackDetector, jack(1000), { durationMs: 2600 });
  const reps = pick(d.events, { kind: 'rep' });

  it('is one rep, counted at the moment the body is open', () => {
    expect(reps).toHaveLength(1);
    expect(reps[0]!.id).toBe('jumpingJack');
    expect(reps[0]!.t).toBeGreaterThan(1100);
    expect(reps[0]!.t).toBeLessThan(1260);
    expect(reps[0]!.q!.range!).toBeGreaterThan(1.5);     // the ankle gap in W at the opening
    expect(reps[0]!.value).toBe(0);                      // the first jack has no tempo yet
  });

  it('publishes openness, state, arm height, ankle gap and the count', () => {
    expect(chAt(d, 'state', 500)).toBe(0);
    expect(chAt(d, 'open', 500)).toBe(0);
    expect(chAt(d, 'gap', 500)).toBeCloseTo(0.625, 2);
    expect(chAt(d, 'armsUp', 500)).toBeLessThan(-1);
    expect(chAt(d, 'state', 1350)).toBe(1);
    expect(chAt(d, 'open', 1350)).toBe(1);
    expect(chAt(d, 'gap', 1350)).toBeCloseTo(1.75, 1);
    expect(chAt(d, 'armsUp', 1350)).toBeGreaterThan(0.2);
    expect(chMax(d, 'state', 1080, 1150)).toBe(0.5);      // on the way: neither open nor closed
    expect(chAt(d, 'state', 2500)).toBe(0);
    expect(chAt(d, 'jacks', 2500)).toBe(1);
    expect(d.detector.value()).toBe(0);
  });
});

describe('a series of jacks', () => {
  it('60 per minute: every jack counts, and the tempo reads about 60', () => {
    const d = drive(createJumpingJackDetector, jacks(1000, 5, 1000), { durationMs: 8600 });
    const t = times(d.events, { kind: 'rep' });
    expect(t).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(t[i]! - t[i - 1]!).toBeGreaterThan(900), expect(t[i]! - t[i - 1]!).toBeLessThan(1100);
    const tempo = pick(d.events, { kind: 'rep' }).at(-1)!.value!;
    expect(tempo).toBeGreaterThan(55);
    expect(tempo).toBeLessThan(65);
    expect(chAt(d, 'tempo', 5300)).toBeGreaterThan(55);
    expect(chAt(d, 'tempo', 6400)).toBeGreaterThan(55);     // still within the 3 s of the last jack
    expect(chAt(d, 'tempo', 8500)).toBe(0);                // nobody jacking for more than 3 s: no tempo
  });

  it('120 per minute (a jack every 500 ms) is still every jack', () => {
    const d = drive(createJumpingJackDetector, jacks(1000, 6, 500, 150, 50, 150), { durationMs: 4500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(6);
    const tempo = pick(d.events, { kind: 'rep' }).at(-1)!.value!;
    expect(tempo).toBeGreaterThan(110);
    expect(tempo).toBeLessThan(130);
  });

  it('two openings closer than 0.4 s are one jack', () => {
    const d = drive(createJumpingJackDetector, plus(jack(1000, 100, 30, 100), jack(1300, 100, 30, 100)), { durationMs: 2500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
  });

  it('the rep time is the beat the rhythm judgement uses', () => {
    // a player jacking on a 60 per minute beat that starts at 1100 ms: every jack is within the Perfect window
    const d = drive(createJumpingJackDetector, jacks(1000, 4, 1000), { durationMs: 5000 });
    const grid = gridFromBpm(60, 1150);
    for (const e of pick(d.events, { kind: 'rep' })) expect(judgeOnGrid(e.t, grid).grade).not.toBe('miss');
  });
});

describe('what is not a jack, and why', () => {
  it('arms up with the feet together: no jack, "feet not wide" with the gap reached', () => {
    const armsOnly = keyframes([[1000, {}], [1300, { armL: UP, armR: UP }], [1700, { armL: UP, armR: UP }], [2000, {}]]);
    const d = drive(createJumpingJackDetector, armsOnly, { durationMs: 2500 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d)!;
    expect(miss.code).toBe('feet_not_wide');
    expect(miss.got!).toBeCloseTo(0.625, 1);
    expect(miss.need).toBe(JUMPING_JACK_DEFAULTS.openGap);
  });

  it('feet apart with the arms down: no jack, "arms not up"', () => {
    const feetOnly = keyframes([[1000, {}], [1300, { legL: { out: 0.45 }, legR: { out: 0.45 } }], [1800, { legL: { out: 0.45 }, legR: { out: 0.45 } }], [2100, {}]]);
    const d = drive(createJumpingJackDetector, feetOnly, { durationMs: 2600 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d)!;
    expect(miss.code).toBe('arms_not_up');
    expect(miss.got!).toBeLessThan(0);
    expect(miss.need).toBe(0);
  });

  it('one arm up and one down: no jack, and the arm that stayed down is named', () => {
    const lone = keyframes([[1000, {}], [1300, { armL: UP, legL: { out: 0.45 }, legR: { out: 0.45 } }], [3000, { armL: UP, legL: { out: 0.45 }, legR: { out: 0.45 } }]]);
    const d = drive(createJumpingJackDetector, lone, { durationMs: 3200 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    const miss = why(d)!;
    expect(miss.code).toBe('use_both_arms');
    expect(miss.side).toBe('R');
  });

  it('a jack that opens again before the body closed does not count, and the miss says what stayed open', () => {
    const HALF: FigureSpec = { armL: { a: 90, f: 90 }, armR: { a: 90, f: 90 }, legL: { out: 0.45 }, legR: { out: 0.45 } };
    const m = keyframes([[1000, {}], [1250, OPEN], [1500, OPEN], [1800, HALF], [2200, HALF], [2500, OPEN], [2900, OPEN]]);
    const d = drive(createJumpingJackDetector, m, { durationMs: 3300 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
    const miss = why(d)!;
    expect(miss.code).toBe('arms_not_down');
    expect(miss.need).toBe(JUMPING_JACK_DEFAULTS.closedDrop);
    expect(miss.got!).toBeLessThan(JUMPING_JACK_DEFAULTS.closedDrop);
  });

  it('arms back down but the feet stay wide: "feet not together"', () => {
    const WIDE: FigureSpec = { legL: { out: 0.45 }, legR: { out: 0.45 } };
    const m = keyframes([[1000, {}], [1250, OPEN], [1500, OPEN], [1800, WIDE], [2300, WIDE], [2600, OPEN], [3000, OPEN]]);
    const d = drive(createJumpingJackDetector, m, { durationMs: 3400 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(1);
    const miss = why(d)!;
    expect(miss.code).toBe('feet_not_together');
    expect(miss.got!).toBeGreaterThan(JUMPING_JACK_DEFAULTS.closedGap);
  });

  it('standing wide and waving the arms is not a series of jacks', () => {
    const wave: Motion = (t) => {
      const up = Math.floor(t / 400) % 2 === 1;
      return { legL: { out: 0.45 }, legR: { out: 0.45 }, ...(up ? { armL: UP, armR: UP } : {}) };
    };
    const d = drive(createJumpingJackDetector, wave, { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
  });

  it('a person standing still has nothing to explain', () => {
    const d = drive(createJumpingJackDetector, still(), { durationMs: 3000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)).toBeNull();
  });
});

describe('the step jack and the seated arm jack', () => {
  const STEP: FigureSpec = { armL: UP, armR: UP, legL: { out: 0.31 }, legR: { out: 0.31 } };    // the feet 1.4 W apart

  it('a foot gap of 1.4 W is not a jump jack but is a step jack', () => {
    const m = jacks(1000, 3, 1000, 250, 150, 250);
    const stepMotion: Motion = plus(...[0, 1, 2].map((i) => jack(1000 + i * 1000, 250, 150, 250, STEP)));
    const plain = drive(createJumpingJackDetector, stepMotion, { durationMs: 4500 });
    expect(pick(plain.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(plain)!.code).toBe('feet_not_wide');
    const step = drive(createJumpingJackDetector, stepMotion, { durationMs: 4500, opts: { step: 1 } });
    expect(pick(step.events, { kind: 'rep' })).toHaveLength(3);
    void m;
  });

  it('seated: with armsOnly the legs are ignored and need not be in view', () => {
    const armJack = (t0: number): Motion => keyframes([[t0, {}], [t0 + 250, { armL: UP, armR: UP }], [t0 + 400, { armL: UP, armR: UP }], [t0 + 650, {}]]);
    const m: Motion = (t) => ({ ...plus(armJack(1000), armJack(2000), armJack(3000))(t), hide: ['ankles', 'feet', 'knees'] as const });
    const seated = drive(createJumpingJackDetector, m, { durationMs: 4500, opts: { armsOnly: 1 } });
    expect(pick(seated.events, { kind: 'rep' })).toHaveLength(3);
    expect(pick(seated.events, { kind: 'rep' })[0]!.q!.range).toBe(0);
    const standing = drive(createJumpingJackDetector, m, { durationMs: 4500 });
    expect(pick(standing.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(standing)!.code).toBe('feet_out_of_view');
  });

  it('hands out of view: no jack, and the miss says so', () => {
    const m: Motion = (t) => ({ ...jacks(1000, 3, 1000)(t), hide: ['hands'] as const });
    const d = drive(createJumpingJackDetector, m, { durationMs: 4000 });
    expect(pick(d.events, { kind: 'rep' })).toHaveLength(0);
    expect(why(d)!.code).toBe('hands_out_of_view');
  });
});

describe('losing the person and starting over', () => {
  it('a jack interrupted by the person leaving is not counted, and the next one needs a closed body first', () => {
    const m = plus(jack(1000), absentBetween(1200, 2400), jack(3000));
    const d = drive(createJumpingJackDetector, m, { durationMs: 4500 });
    const t = times(d.events, { kind: 'rep' });
    expect(t.length).toBeLessThanOrEqual(2);
    expect(t.at(-1)!).toBeGreaterThan(3000);
  });

  it('reset forgets the count, the tempo and the miss', () => {
    const d = drive(createJumpingJackDetector, jacks(1000, 3, 1000), { durationMs: 4500 });
    expect(d.detector.channels!().jacks).toBe(3);
    d.detector.reset();
    expect(d.detector.channels!().jacks).toBe(0);
    expect(d.detector.channels!().tempo).toBe(0);
    expect(d.detector.value()).toBeUndefined();
    expect(why(d)).toBeNull();
  });
});

describe('through the real calibration and One Euro filter', () => {
  it.each([30, 15, 10])('five jacks at 60 per minute at %i Hz are five jacks', (hz) => {
    const r = replayMotion(jacks(500, 5, 1000), { detectors: [{ id: 'jumpingJack' }], durationMs: 6000, hz });
    expect(r.calibratedAt).not.toBeNull();
    expect(r.events.filter((e) => e.kind === 'rep')).toHaveLength(5);
  });

  it('a person standing still gives no events', () => {
    const r = replayMotion(still(), { detectors: [{ id: 'jumpingJack' }], durationMs: 5000 });
    expect(r.events).toEqual([]);
  });
});
