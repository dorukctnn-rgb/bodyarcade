// M5 jumping jack (game-design.md 0.5; card 25 Firework Jacks): arms and legs open and close.
//
// Per frame, from the hand centres, the nose, the shoulder midpoint and the ankles (body space, T; W = shoulder width):
// - open: both hands at or above the nose and the ankles at least `openGap` W apart (1.5; the step jack `step: 1` asks
//   1.3 W: one foot out, no hop);
// - closed: both hands at least `closedDrop` T (0.3) below the shoulders and the ankles at most `closedGap` W apart (1.1);
// - anything else is between.
// A jack is counted at the moment the body becomes open, if it was closed since the last jack (so waving the arms
// while standing wide does not count): the event is the beat for the rhythm judgement (`rhythm.ts`). A second opening
// within `minCycleMs` of the last one is not a jack (card 25: a cycle takes 0.5 to 3 seconds). Seated play: `armsOnly: 1`
// ignores the legs (arms up and down; the card's "kol jack"), and the ankles need not be in view.
//   events    rep: q.range = ankle gap at the opening in W, value = tempo in jacks per minute (0 for the first one)
//   channels  open (0 closed .. 1 fully open; the smaller of the arm and leg progress), state (0 closed, 0.5 between,
//             1 open), armsUp (lower hand minus nose, T; 0 and over is above the nose), gap (ankle gap, W), tempo (jacks
//             per minute over the last four cycles, 0 after `maxCycleMs` without a jack), jacks
// Why a jack did not count (`explain`): arms_not_up, feet_not_wide, use_both_arms (the side that stayed down),
// arms_not_down and feet_not_together (a jack opened again before the body was closed), feet_out_of_view,
// hands_out_of_view.
import type { DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, Series, Visibility, clamp, ev, flag, scalesOf, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const JUMPING_JACK_DEFAULTS = {
  openGap: 1.5,       // ankle gap in W (M5)
  stepGap: 1.3,       // the step jack (card 25)
  closedGap: 1.1,     // (M5)
  closedDrop: 0.3,    // hands below the shoulders, T (M5)
  step: 0,
  armsOnly: 0,
  minCycleMs: 400,    // card 25 says 0.5 s; a little slack for a fast 120 per minute (unmeasured)
  maxCycleMs: 3000,   // (card 25)
  loneMs: 250,        // one arm up and one down this long is "use both arms" (unmeasured)
  graceMs: 250,
  lostMs: 600,
} as const;

type Phase = 'closed' | 'open' | 'between';

export const createJumpingJackDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(JUMPING_JACK_DEFAULTS, opts);
  const step = flag(opts, 'step', o.step !== 0), armsOnly = flag(opts, 'armsOnly', o.armsOnly !== 0);
  const openGap = step ? o.stepGap : o.openGap;
  const { w } = scalesOf(p);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const upSeries = new Series(3000);
  const gapSeries = new Series(3000);
  const repTimes: number[] = [];
  let phase: Phase = 'between';
  let armed = false;
  let openness = 0, armsUp = -1, gap = 0, jacks = 0, nowT = 0, any = false;
  // How close the body came to closed since the last opening, to say what kept it from closing.
  let deepArms = -Infinity, narrowGap = Infinity;
  let lastRepT = -Infinity;
  let miss: (Miss & { t: number }) | null = null;
  let lone: { t: number; side: Side } | null = null;
  let loneSince: number | null = null;

  const tempo = (t: number): number => {
    const n = repTimes.length;
    if (n < 2 || t - (repTimes[n - 1] as number) > o.maxCycleMs) return 0;
    const from = Math.max(0, n - 5);
    const span = (repTimes[n - 1] as number) - (repTimes[from] as number);
    return span > 0 ? ((n - 1 - from) * 60000) / span : 0;
  };

  function unknown(): void { phase = 'between'; armed = false; openness = 0; loneSince = null; }

  return {
    id: 'jumpingJack',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { unknown(); repTimes.length = 0; return out; }
      if (g !== 'ok') return out;
      // Without the hands (or the feet) the pose of the body is a guess: nothing opens or closes, and the next jack
      // must start from a closed body again.
      if (!vis.seen('hands', f.t, o.graceMs) || (!armsOnly && !vis.seen('ankles', f.t, o.graceMs))) { unknown(); return out; }

      const [h0, h1] = f.hand;
      const ups: [number, number] = [h0.y - f.head.y, h1.y - f.head.y];
      armsUp = Math.min(ups[0], ups[1]);
      const lowLimit = f.shoulder.y - o.closedDrop;
      const handsLow = lowLimit - Math.max(h0.y, h1.y);        // >= 0: both hands at least closedDrop under the shoulders
      gap = armsOnly ? 0 : Math.abs(f.ankle[1].x - f.ankle[0].x) / w;
      upSeries.push(f.t, armsUp);
      gapSeries.push(f.t, gap);

      const armsOpen = armsUp >= 0, feetOpen = armsOnly || gap >= openGap;
      const armsClosed = handsLow >= 0, feetClosed = armsOnly || gap <= o.closedGap;
      const armsFrac = clamp((Math.min(h0.y, h1.y) - lowLimit) / Math.max(f.head.y - lowLimit, 1e-6), 0, 1);
      const feetFrac = armsOnly ? 1 : clamp((gap - o.closedGap) / (openGap - o.closedGap), 0, 1);
      openness = Math.min(armsFrac, feetFrac);

      // One arm up and the other down while the legs are open: after a moment, say which arm stayed down.
      if (feetOpen && (ups[0] >= 0) !== (ups[1] >= 0)) {
        loneSince ??= f.t;
        if (f.t - loneSince >= o.loneMs) lone = { t: f.t, side: ups[0] >= 0 ? 'R' : 'L' };
      } else loneSince = null;

      if (armsClosed && feetClosed) {
        phase = 'closed'; armed = true; lone = null;
        deepArms = -Infinity; narrowGap = Infinity;
        return out;
      }
      deepArms = Math.max(deepArms, handsLow);
      narrowGap = Math.min(narrowGap, gap);
      if (armsOpen && feetOpen) {
        if (phase !== 'open') {
          if (armed) {
            if (f.t - lastRepT >= o.minCycleMs) {
              const dt = f.t - lastRepT;
              lastRepT = f.t; jacks++;
              repTimes.push(f.t);
              if (repTimes.length > 8) repTimes.shift();
              out.push(ev('jumpingJack', 'rep', f.t, { q: { range: armsOnly ? 0 : gap }, value: dt <= o.maxCycleMs ? tempo(f.t) : 0 }));
            }
          } else if (Number.isFinite(deepArms)) {
            // Opened again without having been closed in between: what stayed open?
            if (deepArms < 0) miss = { code: 'arms_not_down', got: Math.max(0, o.closedDrop + deepArms), need: o.closedDrop, t: f.t };
            else if (!armsOnly && narrowGap > o.closedGap) miss = { code: 'feet_not_together', got: narrowGap, need: o.closedGap, t: f.t };
          }
          armed = false;
          deepArms = -Infinity; narrowGap = Infinity;
        }
        phase = 'open';
      } else {
        phase = 'between';
      }
      return out;
    },
    value: () => (any ? openness : undefined),
    channels() {
      return { open: openness, state: phase === 'closed' ? 0 : phase === 'open' ? 1 : 0.5, armsUp, gap, tempo: tempo(nowT), jacks };
    },
    explain(windowMs = 2000): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      if (!armsOnly && vis.unseenFor('ankles', nowT) > 500) return { code: 'feet_out_of_view' };
      if (nowT - lastRepT <= windowMs) return null;
      if (miss && nowT - miss.t <= windowMs) { const { t: _t, ...rest } = miss; return rest; }
      if (lone && nowT - lone.t <= windowMs) return { code: 'use_both_arms', side: lone.side };
      const up = upSeries.max(windowMs), wide = gapSeries.max(windowMs);
      if (up === undefined || wide === undefined) return null;
      const armsOk = up >= 0, feetOk = armsOnly || wide >= openGap;
      if (armsOk && !feetOk) return { code: 'feet_not_wide', got: wide, need: openGap };
      if (!armsOk && feetOk) return { code: 'arms_not_up', got: up, need: 0 };
      // Neither: the player tried the arms (hands around the shoulders or higher) or moved the feet clearly apart.
      if (!armsOk && up > -0.5) return { code: 'arms_not_up', got: up, need: 0 };
      if (!feetOk && wide > o.closedGap) return { code: 'feet_not_wide', got: wide, need: openGap };
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); upSeries.clear(); gapSeries.clear(); repTimes.length = 0;
      phase = 'between'; armed = false; openness = 0; armsUp = -1; gap = 0; jacks = 0; nowT = 0; any = false;
      deepArms = -Infinity; narrowGap = Infinity; lastRepT = -Infinity; miss = null; lone = null; loneSince = null;
    },
  } satisfies ExplainingDetector;
};
