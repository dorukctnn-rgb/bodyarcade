// Form coach, Faz 3 (standing moves): one-sided counting, held positions and the jumping jack, on geometric test bodies
// (testing/body.ts). These prove the logic; accuracy on real people is form.real.test.ts.
import { describe, expect, it } from 'vitest';
import { createFormCoach } from './coach.ts';
import { FORM_MOVES, FORM_MOVE_IDS, REAL_VIDEO_CHECKED } from './moves/index.ts';
import { FAR_RIGHT, blend, frame, frontJack, frontKick, frontKnees, frontPress, frontSideLunge, frontSquat, hold, landmarks, lifted, reps, sideHinge, sideLunge, sidePushUp, sideWallSit } from './testing/body.ts';
import type { CoachState, FormMoveId } from './types.ts';
import type { PoseFrame } from '../types/index.ts';

function run(move: FormMoveId, frames: PoseFrame[]) {
  const c = createFormCoach(move);
  const states: CoachState[] = frames.map((f) => c.push(f));
  return { states, last: states.at(-1)!, summary: c.summary(), reps: states.flatMap((s) => (s.repDone ? [s.repDone] : [])) };
}

/** Repetitions that alternate the working side: i even = L, odd = R. */
const alternating = (n: number, pose: (u: number, side: 'L' | 'R') => ReturnType<typeof sideLunge>, o: Parameters<typeof reps>[2] = {}) =>
  reps(n, (u, i) => pose(u, i % 2 === 0 ? 'L' : 'R'), o);

describe('the catalogue', () => {
  it('every move has a label, a group, views and a way to measure its progress', () => {
    for (const id of FORM_MOVE_IDS) {
      const m = FORM_MOVES[id];
      expect(m.id, id).toBe(id);
      expect(['F', 'H', 'S', 'T'], id).toContain(m.label);
      expect(m.views.length, id).toBeGreaterThan(0);
      expect(!!(m.progress || m.makeProgress || m.sideProgress), id).toBe(true);
      expect(id in REAL_VIDEO_CHECKED, id).toBe(true);
      // count-only and time-only moves offer no form rule: nothing is coloured red or amber that we could not measure
      if (m.label === 'S' || m.label === 'T') expect(m.rules.filter((r) => r.kind === 'live'), id).toHaveLength(0);
      if (m.label === 'H' || m.label === 'T') expect(m.hold, id).toBeTruthy();
    }
  });
});

describe('lunges: one repetition machine per leg', () => {
  it('counts alternating reverse lunges from the side, each on its own leg, all clean', () => {
    const r = run('reverseLunge', alternating(4, (u, s) => sideLunge(u, s)));
    expect(r.reps).toHaveLength(4);
    expect(r.reps.map((x) => x.side)).toEqual(['L', 'R', 'L', 'R']);
    expect(r.reps.every((x) => x.clean)).toBe(true);
    expect(r.summary.sides).toEqual({ L: 2, R: 2 });
  });

  it('flags a lunge that stops short (depth) on the front leg, does not count a quarter lunge, and a forward lean is a tip', () => {
    const half = run('reverseLunge', alternating(2, (u, s) => sideLunge(u * 0.75, s)));
    expect(half.reps).toHaveLength(2);
    expect(half.reps.every((x) => x.errors.includes('lunge.depth'))).toBe(true);
    expect(half.states.some((s) => s.segments.thighL === 'bad' || s.segments.thighR === 'bad')).toBe(true);
    const quarter = run('reverseLunge', alternating(2, (u, s) => sideLunge(u * 0.45, s)));
    expect(quarter.reps).toHaveLength(0);
    const lean = run('reverseLunge', alternating(2, (u, s) => sideLunge(u, s, { lean: 40 * u })));
    expect(lean.reps.every((x) => x.clean && x.tips.includes('lunge.upright'))).toBe(true);
  });

  it('counts walking lunges that flow from one leg into the other without standing up in between', () => {
    // each lunge comes back only to a quarter (u 0.35), then the other leg goes forward
    const frames: PoseFrame[] = [];
    let t = 0, k = 0;
    const push = (u: number, s: 'L' | 'R') => { frames.push(frame(t, landmarks(sideLunge(u, s)), k++)); t += 1000 / 30; };
    for (let i = 0; i < 30; i++) push(0, 'L');
    for (let n = 0; n < 4; n++) {
      const s = n % 2 === 0 ? 'L' : 'R';
      for (let i = 0; i <= 30; i++) push(n === 0 ? i / 30 : 0.35 + (0.65 * i) / 30, s);
      for (let i = 0; i <= 20; i++) push(1 - (0.65 * i) / 20, s);
    }
    for (let i = 0; i <= 20; i++) push(0.35 * (1 - i / 20), 'R');
    for (let i = 0; i < 30; i++) push(0, 'R');
    const r = run('forwardLunge', frames);
    expect(r.reps.map((x) => x.side)).toEqual(['L', 'R', 'L', 'R']);
  });

  it('a squat is not a lunge, and lunges are not counted from the front', () => {
    expect(run('reverseLunge', reps(3, (u) => frontSquat(u))).reps).toHaveLength(0);
    const front = run('reverseLunge', reps(2, (u) => frontSquat(u)));
    expect(front.last.guide.checks.find((c) => c.id === 'view')?.ok).toBe(false);
  });
});

describe('high knees', () => {
  it('counts each knee of fast alternating high knees, and flags knees that stay low', () => {
    const fast = { repMs: 450, restMs: 60 };
    const r = run('highKnees', reps(8, (u, i) => (i % 2 === 0 ? frontKnees(u, 0) : frontKnees(0, u)), fast));
    expect(r.reps).toHaveLength(8);
    expect(r.summary.sides).toEqual({ L: 4, R: 4 });
    expect(r.reps.every((x) => x.clean)).toBe(true);
    const low = run('highKnees', reps(4, (u, i) => (i % 2 === 0 ? frontKnees(u * 0.75, 0) : frontKnees(0, u * 0.75)), fast));
    expect(low.reps.length).toBe(4);
    expect(low.reps.every((x) => x.errors.includes('highKnees.height'))).toBe(true);
  });
});

describe('jumping jack', () => {
  it('counts full jacks as clean, flags arms that stop at the shoulders and feet that stay narrow', () => {
    const full = run('jumpingJack', reps(4, (u) => frontJack(u), { repMs: 900, restMs: 200 }));
    expect(full.reps).toHaveLength(4);
    expect(full.reps.every((x) => x.clean)).toBe(true);
    const arms = run('jumpingJack', reps(3, (u) => frontJack(u * 0.55, u), { repMs: 900, restMs: 200 }));
    expect(arms.reps).toHaveLength(3);
    expect(arms.reps.every((x) => x.errors.includes('jack.arms'))).toBe(true);
    const feet = run('jumpingJack', reps(3, (u) => frontJack(u, u * 0.4), { repMs: 900, restMs: 200 }));
    expect(feet.reps.every((x) => x.clean && x.tips.includes('jack.feet'))).toBe(true);
  });
});

describe('held positions', () => {
  it('a wall sit at 90 degrees runs the clock; leaning away from the wall stops it and is the top error', () => {
    const good = run('wallSit', [...hold(1500, () => sideWallSit(175), { far: FAR_RIGHT }), ...hold(5000, () => sideWallSit(92), { far: FAR_RIGHT, t0: 1534 })]);
    expect(good.last.holdMs).toBeGreaterThan(4300);
    expect(good.last.holdMs).toBeLessThan(5100);
    expect(good.reps).toHaveLength(0);
    expect(good.states.some((s) => s.holding && s.segments.thighL === 'ok')).toBe(true);
    const lean = run('wallSit', [
      ...hold(1500, () => sideWallSit(175), { far: FAR_RIGHT }),
      ...hold(2000, () => sideWallSit(92), { far: FAR_RIGHT, t0: 1534 }),
      ...hold(2000, () => sideWallSit(92, 30), { far: FAR_RIGHT, t0: 3567 }),
    ]);
    expect(lean.last.holdMs).toBeLessThan(2100);
    expect(lean.states.some((s) => s.cue === 'wallSit.backToWall' && s.segments.torso === 'bad')).toBe(true);
    expect(lean.summary.top?.id).toBe('wallSit.back');
    expect(lean.summary.bestHoldMs).toBeLessThan(2100);
  });

  it('standing still is not a hold', () => {
    const r = run('wallSit', hold(4000, () => sideWallSit(176), { far: FAR_RIGHT }));
    expect(r.last.holdMs).toBe(0);
  });
});

describe('every Faz 3 move counts its own movement on a test body', () => {
  const side = { far: FAR_RIGHT } as const;
  const cases: [FormMoveId, PoseFrame[], number][] = [
    ['sumoSquat', reps(3, (u) => frontSquat(u)), 3],
    ['prisonerSquat', reps(3, (u) => frontSquat(u)), 3],
    ['jumpSquat', reps(3, (u) => frontSquat(u * 0.9), { repMs: 900 }), 3],
    ['chairSquat', reps(3, (u) => sideWallSit(176 - 80 * u), side), 3],
    ['splitSquat', reps(3, (u) => sideLunge(u, 'L')), 3],
    ['bulgarianSplitSquat', reps(3, (u) => sideLunge(u, 'R')), 3],
    ['jumpingLunge', alternating(4, (u, s) => sideLunge(u, s), { repMs: 700, restMs: 100 }), 4],
    ['lateralLunge', reps(4, (u, i) => frontSideLunge(u, i % 2 ? 'R' : 'L', 105)), 4],
    ['cossackSquat', reps(4, (u, i) => frontSideLunge(u, i % 2 ? 'R' : 'L', 88)), 4],
    ['stepJack', reps(3, (u) => frontJack(u, u * 0.7)), 3],
    ['starJump', reps(3, (u) => frontJack(u), { repMs: 800 }), 3],
    ['marching', reps(6, (u, i) => (i % 2 ? frontKnees(0, u * 0.7) : frontKnees(u * 0.7, 0)), { repMs: 700, restMs: 50 }), 6],
    ['buttKicks', reps(6, (u, i) => (i % 2 ? frontKick(0, u) : frontKick(u, 0)), { repMs: 500, restMs: 50 }), 6],
    ['burpee', reps(3, (u) => blend(sideWallSit(176), sidePushUp(0), u), { ...side, repMs: 2000 }), 3],
    ['squatThrust', reps(3, (u) => blend(sideWallSit(176), sidePushUp(0), u), { ...side, repMs: 2000 }), 3],
    ['inchworm', reps(2, (u) => blend(sideWallSit(176), sidePushUp(0), u), { ...side, repMs: 4000 }), 2],
    ['jumpRope', reps(8, (u) => lifted(frontSquat(0), 0.025 * u), { repMs: 300, restMs: 250 }), 8],
    ['calfRaise', reps(4, (u) => lifted(frontSquat(0), 0.025 * u), { repMs: 1200 }), 4],
    ['singleCalfRaise', reps(4, (u) => lifted(frontSquat(0), 0.025 * u), { repMs: 1200 }), 4],
    ['stepUp', reps(3, (u) => lifted(frontSquat(0), 0.1 * u), { repMs: 1600 }), 3],
    ['wallAngel', reps(3, (u) => frontPress(u)), 3],
    ['goodMorning', reps(3, (u) => sideHinge(u), side), 3],
  ];
  for (const [move, frames, n] of cases) {
    it(`${move}: ${n} repetitions`, () => {
      const r = run(move, frames);
      expect(r.reps, move).toHaveLength(n);
    });
  }

  it('a deep squat is not a Cossack squat or a lateral lunge (both knees bent alike)', () => {
    expect(run('cossackSquat', reps(3, (u) => frontSquat(u))).reps).toHaveLength(0);
    expect(run('lateralLunge', reps(3, (u) => frontSquat(u))).reps).toHaveLength(0);
  });

  it('the good morning: a bent-knee hinge is a tip, a short hinge is a tip, neither makes the repetition unclean', () => {
    const knees = run('goodMorning', reps(2, (u) => sideHinge(u, 175 - 50 * u), { far: FAR_RIGHT }));
    expect(knees.reps.every((x) => x.clean && x.tips.includes('hinge.knees'))).toBe(true);
    const short = run('goodMorning', reps(2, (u) => sideHinge(u * 0.7), { far: FAR_RIGHT }));
    expect(short.reps.every((x) => x.clean && x.tips.includes('hinge.depth'))).toBe(true);
  });

  it('arm circles: time with both arms out; a squat hold: time at depth', () => {
    const arms = run('armCircles', [...hold(1000, () => frontSquat(0)), ...hold(3000, () => frontJack(0.5, 0), { t0: 1033 })]);
    expect(arms.last.holdMs).toBeGreaterThan(2400);
    const sq = run('squatHold', [...hold(1000, () => frontSquat(0)), ...hold(3000, () => frontSquat(1), { t0: 1033 })]);
    expect(sq.last.holdMs).toBeGreaterThan(2400);
    expect(sq.summary.holdMs).toBe(sq.last.holdMs);
  });
});
