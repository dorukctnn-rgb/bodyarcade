// M4 knee lift (game-design.md 0.5; cards 26 Knee Sprint and 13 Summit Climb step): marching and high knees.
//
// k per leg is the knee lift of game-design.md 0.2 against the calibrated standing pose: 0 = the knee stands where it
// stands at rest (thigh length U below the hip), 1 = the knee at hip height. In body space that is
// k = (knee.y + U) / U, so a squat gives a negative k and a jump with hanging legs only a small one.
//
// A step is counted when a leg has been above `enter` (0.5 march, 0.75 high knees) and its k turns down again
// (`fallBack` under the peak, or under `enter - hyst`): the step carries the peak k, and its time is the top of the
// lift, the natural beat of the movement.
// Three things are not a step:
// - a jump or a tuck: the other leg must be at least `otherGap` lower than the lifting leg at its peak (foot_not_down);
// - the same leg twice in a row while `alternate` is 1 (legs in turn, card 26; same_leg_twice). Summit Climb passes
//   `alternate: 0`: every lift is a step up;
// - a lift that stays under `enter` (knee_not_high, with the best k the player reached).
//   events    rep (side L or R): q.range = peak k, value = cadence in steps per minute at that moment
//   channels  knee.L / knee.R (k, negative when the knee is lower than at rest), kneeMax, lifted (1 while a knee is at
//             or above `enter`), cadence (steps per minute over the last `cadenceWindowMs`, 0 after `idleMs` without
//             a step), meanK (mean peak k of the steps in that window), torso (shoulder to hip in T; shorter than 1
//             when the body leans back or forward), steps
// Form note via `explain`: body_not_straight when the torso looks shorter than `leanBack` while stepping (leaning back
// is the warning of card 26; from the front it shows as a shorter torso, forward or back).
// Needs the knees in view (`knees`); a seated march needs the framing with knees too.
import type { DetectorFactory, Features, MovementEvent } from '../types/index.ts';
import { PersonGate, SIDES, Series, Visibility, ev, flag, scalesOf, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const KNEE_LIFT_DEFAULTS = {
  enter: 0.5,             // march; 0.75 for high knees (M4)
  hyst: 0.15,             // a lift ends under enter - hyst (unmeasured)
  fallBack: 0.08,         // a step is counted this far below its peak (unmeasured)
  otherGap: 0.2,          // the other leg is this far below the lifting leg at the peak (unmeasured)
  alternate: 1,           // 1: legs in turn (card 26); 0: every lift counts
  altWindowMs: 1500,      // after a pause this long either leg may start (unmeasured)
  refractoryMs: 150,      // per leg (unmeasured)
  cadenceWindowMs: 3000,
  idleMs: 1500,           // cadence reads 0 this long after the last step
  leanBack: 0.85,         // torso shorter than this share of T while stepping: body_not_straight (unmeasured)
  lostMs: 600,
} as const;

interface Leg { k: number; up: boolean; emitted: boolean; peak: number; peakOther: number; lastStepT: number }
const blankLeg = (): Leg => ({ k: 0, up: false, emitted: true, peak: 0, peakOther: 0, lastStepT: -Infinity });

export const createKneeLiftDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(KNEE_LIFT_DEFAULTS, opts);
  const alternate = flag(opts, 'alternate', o.alternate !== 0);
  const U = scalesOf(p).u;
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const legs: [Leg, Leg] = [blankLeg(), blankLeg()];
  const steps: { t: number; k: number }[] = [];
  const kSeries = new Series(3000);
  const torsoSeries = new Series(3000);
  let lastSide = -1;
  let lastStepT = -Infinity;
  let lastLiftT = -Infinity;
  let count = 0;
  let nowT = 0;
  let any = false;
  let torso = 1;
  let miss: (Miss & { t: number }) | null = null;

  const cadence = (t: number): number => {
    const n = steps.length;
    if (n < 2) return 0;
    const first = steps[0] as { t: number }, last = steps[n - 1] as { t: number };
    if (t - last.t > o.idleMs || last.t <= first.t) return 0;
    return ((n - 1) * 60000) / (last.t - first.t);
  };
  const meanK = (): number => (steps.length ? steps.reduce((s, x) => s + x.k, 0) / steps.length : 0);

  function judge(i: 0 | 1, f: Features, out: MovementEvent[]): void {
    const L = legs[i];
    if (f.t - L.lastStepT < o.refractoryMs) return;
    const sinceLift = f.t - lastLiftT;
    lastLiftT = f.t;
    if (L.peak - L.peakOther < o.otherGap) { miss = { code: 'foot_not_down', got: L.peak - L.peakOther, need: o.otherGap, side: SIDES[i === 0 ? 1 : 0], t: f.t }; return; }
    if (alternate && lastSide === i && sinceLift <= o.altWindowMs) { miss = { code: 'same_leg_twice', side: SIDES[i], t: f.t }; return; }
    L.lastStepT = f.t; lastStepT = f.t; lastSide = i; count++;
    steps.push({ t: f.t, k: L.peak });
    const cut = f.t - o.cadenceWindowMs;
    while (steps.length > 1 && (steps[0] as { t: number }).t < cut) steps.shift();
    out.push(ev('kneeLift', 'rep', f.t, { side: SIDES[i], q: { range: L.peak }, value: cadence(f.t) }));
  }

  function clearLegs(): void { legs[0] = blankLeg(); legs[1] = blankLeg(); }

  return {
    id: 'kneeLift',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { clearLegs(); steps.length = 0; lastSide = -1; return out; }
      if (g !== 'ok') return out;
      // Knees out of view: their positions are guesses; no lift starts and a running lift is dropped without a step.
      if (!vis.seen('knees', f.t, 300)) { clearLegs(); return out; }
      const ks: [number, number] = [(f.knee[0].y + U) / U, (f.knee[1].y + U) / U];
      kSeries.push(f.t, Math.max(ks[0], ks[1]));
      torso = f.shoulder.y - f.hip.y;
      torsoSeries.push(f.t, torso);
      for (const i of [0, 1] as const) {
        const L = legs[i];
        const other = ks[i === 0 ? 1 : 0];
        L.k = ks[i];
        if (!L.up) {
          if (L.k >= o.enter) { L.up = true; L.emitted = false; L.peak = L.k; L.peakOther = other; }
        } else {
          if (L.k > L.peak) { L.peak = L.k; L.peakOther = other; }
          const below = L.k < o.enter - o.hyst;
          if (!L.emitted && (below || L.k <= L.peak - o.fallBack)) { L.emitted = true; judge(i, f, out); }
          if (below) L.up = false;
        }
      }
      return out;
    },
    value: () => Math.max(legs[0].k, legs[1].k),
    channels() {
      return {
        'knee.L': legs[0].k, 'knee.R': legs[1].k, kneeMax: Math.max(legs[0].k, legs[1].k),
        lifted: legs[0].k >= o.enter || legs[1].k >= o.enter ? 1 : 0,
        cadence: cadence(nowT), meanK: meanK(), torso, steps: count,
      };
    },
    explain(windowMs = 2000): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('knees', nowT) > 500) return { code: 'knees_out_of_view' };
      if (miss && nowT - miss.t <= windowMs) { const { t: _t, ...rest } = miss; return rest; }
      const best = kSeries.max(windowMs) ?? 0;
      if (best < o.enter && best > 0.15) return { code: 'knee_not_high', got: best, need: o.enter };
      const shortest = torsoSeries.min(windowMs) ?? 1;
      if (shortest < o.leanBack && nowT - lastStepT <= windowMs) return { code: 'body_not_straight', got: shortest, need: o.leanBack };
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); clearLegs(); steps.length = 0; kSeries.clear(); torsoSeries.clear();
      lastSide = -1; lastStepT = -Infinity; lastLiftT = -Infinity; count = 0; nowT = 0; any = false; torso = 1; miss = null;
    },
  } satisfies ExplainingDetector;
};
