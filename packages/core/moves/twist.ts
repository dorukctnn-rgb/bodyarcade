// M8 trunk twist (game-design.md 0.5; card 18 Twist Turbine): hands together in front, the body turns left and right.
//
// tau = (hand midpoint x - hip midpoint x) / W, positive toward the player's right (as seen in the mirror). A frame is
// "twisted" to a side when the hands are together (at most `handsApart` W apart, 0.5), |tau| >= `turn` (0.6) and the
// shoulders look narrower than `maxSpan` (0.9 of W: the shoulders turned, not only the arms swung).
//   rep       the body gets twisted to one side after having been twisted to the other, within `minMs`..`maxMs`
//             (400 to 2500 ms) of the last frame on the other side; `side` is the side reached, q.range = the farthest
//             |tau| of the side just left, q.speed = |tau| change in W per second over the crossing, value = crossings
//             per minute over the last four seconds. The first side reached is no rep. Too fast a crossing (a jerk,
//             "kalçayı kilitleyip sarsma") and too slow a one are not reps; the miss says so.
//   holdStart / holdEnd   with `holdMs` > 0: twisted to one side for that long (value = ms held; holdEnd after a
//             `graceMs` gap or a change of side)
//   channels  tau, span (shoulder width over W), gap (hands apart in W), side (-1 twisted left, +1 right, 0 not),
//             rate (crossings per minute, 0 after `idleMs` of none), reps, held (ms of the current hold)
// Seated play works as is: hands, shoulders and hips are all it reads.
// Misses (`explain`): turn_more (tau got), turn_shoulders (arms swung, shoulders did not turn), hands_apart, too_fast,
// too_slow, hands_out_of_view.
import type { DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, Series, Visibility, dist, ev, mid, scalesOf, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const TWIST_DEFAULTS = {
  turn: 0.6,          // |tau| (M8)
  maxSpan: 0.9,       // shoulder width over W (M8)
  handsApart: 0.5,    // W (card 18)
  minMs: 400,         // a crossing takes this long at least (card 18)
  maxMs: 2500,        // and this long at most
  holdMs: 0,          // > 0: report holds
  graceMs: 200,       // a hold survives this long without the pose
  cadenceMs: 4000,
  idleMs: 3000,
  lostMs: 600,
} as const;

export const createTwistDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(TWIST_DEFAULTS, opts);
  const { w } = scalesOf(p);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const tauSeries = new Series(3000);
  const spanSeries = new Series(3000);
  const gapSeries = new Series(3000);
  const crossings: number[] = [];
  // per side (0 = left, 1 = right): when it was last twisted, and the farthest |tau| of the current stay
  const lastAt: [number, number] = [-Infinity, -Infinity];
  const farthest: [number, number] = [0, 0];
  let side = 0;
  let reps = 0, lastRepT = -Infinity;
  let tau = 0, span = 1, gap = 0, nowT = 0, any = false;
  let holdSide = 0, holdSince = 0, holdLastT = 0, holding = false;
  let miss: (Miss & { t: number }) | null = null;

  const rate = (t: number): number => {
    const n = crossings.length;
    if (n < 2 || t - (crossings[n - 1] as number) > o.idleMs) return 0;
    const span4 = (crossings[n - 1] as number) - (crossings[0] as number);
    return span4 > 0 ? ((n - 1) * 60000) / span4 : 0;
  };

  function endHold(t: number, out: MovementEvent[]): void {
    if (holding) out.push(ev('twist', 'holdEnd', t, { side: holdSide > 0 ? 'R' : 'L', value: holdLastT - holdSince }));
    holding = false; holdSide = 0;
  }

  function reset(): void {
    gate.reset(); vis.reset(); tauSeries.clear(); spanSeries.clear(); gapSeries.clear(); crossings.length = 0;
    lastAt[0] = -Infinity; lastAt[1] = -Infinity; farthest[0] = 0; farthest[1] = 0; side = 0; reps = 0; lastRepT = -Infinity;
    tau = 0; span = 1; gap = 0; nowT = 0; any = false; holdSide = 0; holdSince = 0; holdLastT = 0; holding = false; miss = null;
  }

  return {
    id: 'twist',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { endHold(f.t, out); side = 0; lastAt[0] = lastAt[1] = -Infinity; farthest[0] = farthest[1] = 0; crossings.length = 0; return out; }
      if (g !== 'ok') return out;
      if (!vis.seen('hands', f.t, 300)) { endHold(f.t, out); side = 0; return out; }

      const centre = mid(f.hand[0], f.hand[1]);
      tau = (centre.x - f.hip.x) / w;
      span = f.shoulderSpan;
      gap = dist(f.hand[0], f.hand[1]) / w;
      tauSeries.push(f.t, tau);
      spanSeries.push(f.t, span);
      gapSeries.push(f.t, gap);

      const together = gap <= o.handsApart;
      const turned = Math.abs(tau) >= o.turn && span <= o.maxSpan;
      side = together && turned ? (tau > 0 ? 1 : -1) : 0;

      if (side !== 0) {
        const s: 0 | 1 = side > 0 ? 1 : 0, other: 0 | 1 = s === 1 ? 0 : 1;
        const arrived = f.t - lastAt[s] > o.graceMs;        // a new stay on this side, not the same one flickering
        if (arrived && lastAt[other] > -Infinity) {
          const dt = f.t - lastAt[other];
          if (dt < o.minMs) miss = { code: 'too_fast', got: dt, need: o.minMs, t: f.t };
          else if (dt > o.maxMs) miss = { code: 'too_slow', got: dt, need: o.maxMs, t: f.t };
          else {
            reps++; lastRepT = f.t;
            crossings.push(f.t);
            while (crossings.length > 1 && f.t - (crossings[0] as number) > o.cadenceMs) crossings.shift();
            const range = farthest[other];
            const speed = (Math.abs(tau) + range) / (dt / 1000);
            out.push(ev('twist', 'rep', f.t, { side: (side > 0 ? 'R' : 'L') as Side, q: { range, speed }, value: rate(f.t) }));
          }
          // the stay on the other side is over either way
          lastAt[other] = -Infinity; farthest[other] = 0;
        }
        if (arrived) farthest[s] = 0;
        lastAt[s] = f.t;
        farthest[s] = Math.max(farthest[s], Math.abs(tau));
      }

      if (o.holdMs > 0) {
        if (side !== 0 && side === holdSide) {
          holdLastT = f.t;
          if (!holding && f.t - holdSince >= o.holdMs) { holding = true; out.push(ev('twist', 'holdStart', f.t, { side: side > 0 ? 'R' : 'L', value: f.t - holdSince })); }
        } else if (side !== 0) {
          endHold(f.t, out);
          holdSide = side; holdSince = f.t; holdLastT = f.t;
        } else if (holdSide !== 0 && f.t - holdLastT > o.graceMs) endHold(f.t, out);
      }
      return out;
    },
    value: () => (any ? tau : undefined),
    channels() {
      return { tau, span, gap, side, rate: rate(nowT), reps, held: holding ? holdLastT - holdSince : 0 };
    },
    explain(windowMs = 2000): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      if (nowT - lastRepT <= windowMs) return null;
      if (miss && nowT - miss.t <= windowMs) { const { t: _t, ...rest } = miss; return rest; }
      const tauMax = Math.max(Math.abs(tauSeries.max(windowMs) ?? 0), Math.abs(tauSeries.min(windowMs) ?? 0));
      const spanMin = spanSeries.min(windowMs) ?? 1;
      const gapMid = gapSeries.median(windowMs) ?? 0;     // the median: a glitched frame must not hide hands held apart
      if (tauMax < 0.25) return null;                         // not trying
      if (gapMid > o.handsApart) return { code: 'hands_apart', got: gapMid, need: o.handsApart };
      if (tauMax >= o.turn && spanMin > o.maxSpan) return { code: 'turn_shoulders', got: spanMin, need: o.maxSpan };
      if (tauMax < o.turn) return { code: 'turn_more', got: tauMax, need: o.turn };
      return null;
    },
    reset,
  } satisfies ExplainingDetector;
};
