// M10 grab and pull (game-design.md 0.5; card 13 Summit Climb): reach up, take hold, pull the hand down to the shoulder.
//
// Per hand, from the hand centre against the nose and the shoulder line (body space, T; A = arm length):
// - grab: the hand is at least `grabAbove` (0.25) T above the nose. The hand can stay there as long as it likes;
// - pull: the hand leaves the grab zone (`grabHyst` below it) and comes down to the shoulder line (at most `pullTo`,
//   0.1 T, above it) within `pullMs` (1.2 s) of leaving. That is one rep, on that hand's side;
// - the stroke is given up when the hand rises `letGo` (0.25) T from its lowest point without reaching the shoulder.
//   events    rep: side = the hand, q.range = how far the hand travelled from its highest point to the shoulder line, in
//             A; q.speed = the hand's fastest downward speed in A per second; value = 1, or 0.5 when the same hand pulled
//             twice in a row ("aynı el iki kez yarım sayılır": the climb is amplitude x value); warn 'shrug' when the
//             shoulders rose more than `shrug` T above their lowest point of the last 1.5 s
//   channels  pull.L / pull.R (0..1 progress of the stroke from the grab to the shoulder line, 0 when not pulling),
//             grab.L / grab.R (1 while holding on above the nose), reach.L / reach.R (hand height above the nose, T),
//             climb (sum of range x value, in A), reps
// Why a pull did not count (`explain`): grab_higher (the hand went up but not above the nose by enough: got = how far
// above, T), pull_more (the stroke was given up: got and need = distance travelled and needed, A), pull_faster
// (the pull took longer than 1.2 s: got ms), hands_out_of_view. Needs only the upper body; seated play works.
import type { DetectorFactory, Features, MovementEvent, MovementWarning, Side } from '../types/index.ts';
import { PersonGate, SIDES, Series, Track, Visibility, clamp, ev, scalesOf, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const PULL_DEFAULTS = {
  grabAbove: 0.25,   // hand above the nose, T (M10)
  grabHyst: 0.05,
  pullTo: 0.1,       // hand at most this far above the shoulder line, T (M10: "omuz hizasına")
  pullMs: 1200,      // (M10)
  tryAbove: 0.3,     // above the shoulder line by this: the player is reaching for a hold (unmeasured)
  letGo: 0.25,       // the hand rises this far from its lowest point: the pull is given up (unmeasured)
  shrug: 0.12,       // shoulders up this far, T (unmeasured; the reaching arm lifts its shoulder a little)
  speedWindowMs: 120,
  graceMs: 250,
  lostMs: 600,
} as const;

type Phase = 'idle' | 'try' | 'grab' | 'pull';
interface HandState { phase: Phase; peak: number; tryPeak: number; leftAt: number; lowest: number; maxDown: number; progress: number; above: number }
const blank = (): HandState => ({ phase: 'idle', peak: 0, tryPeak: 0, leftAt: 0, lowest: 0, maxDown: 0, progress: 0, above: -1 });

export const createPullDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(PULL_DEFAULTS, opts);
  const A = scalesOf(p).a;
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const hands: [HandState, HandState] = [blank(), blank()];
  const tracks = [new Track(500), new Track(500)] as const;
  const shoulderY = new Series(1500);
  let lastSide: Side | null = null;
  let climb = 0, reps = 0, nowT = 0, any = false;
  let miss: (Miss & { t: number }) | null = null;

  const note = (m: Miss, t: number): void => { miss = { ...m, t }; };

  function stroke(i: 0 | 1, f: Features, out: MovementEvent[]): void {
    const h = hands[i], hand = f.hand[i];
    const rel = hand.y - f.shoulder.y;                // above the shoulder line
    const above = hand.y - f.head.y;                  // above the nose
    h.above = above;
    tracks[i].push(f.t, hand);
    const inGrab = above >= o.grabAbove;
    h.progress = 0;
    switch (h.phase) {
      case 'idle':
        if (inGrab) { h.phase = 'grab'; h.peak = rel; } else if (rel >= o.tryAbove) { h.phase = 'try'; h.tryPeak = above; }
        break;
      case 'try':
        h.tryPeak = Math.max(h.tryPeak, above);
        if (inGrab) { h.phase = 'grab'; h.peak = rel; } else if (rel <= o.pullTo) {
          note({ code: 'grab_higher', got: h.tryPeak, need: o.grabAbove, side: SIDES[i] }, f.t);
          h.phase = 'idle';
        }
        break;
      case 'grab':
        h.peak = Math.max(h.peak, rel);
        if (above < o.grabAbove - o.grabHyst) { h.phase = 'pull'; h.leftAt = f.t; h.lowest = rel; h.maxDown = 0; }
        break;
      case 'pull': {
        h.lowest = Math.min(h.lowest, rel);
        h.maxDown = Math.max(h.maxDown, -tracks[i].velocity(o.speedWindowMs).y / A);
        h.progress = clamp((h.peak - rel) / Math.max(h.peak - o.pullTo, 1e-6), 0, 1);
        const took = f.t - h.leftAt;
        if (inGrab) {
          // Back up into the grab zone: the last stroke was given up half way; this is a new grab.
          note({ code: 'pull_more', got: (h.peak - h.lowest) / A, need: (h.peak - o.pullTo) / A, side: SIDES[i] }, f.t);
          h.phase = 'grab'; h.peak = rel; h.progress = 0;
        } else if (rel <= o.pullTo) {
          if (took <= o.pullMs) {
            const range = (h.peak - o.pullTo) / A;
            const value = lastSide === SIDES[i] ? 0.5 : 1;
            lastSide = SIDES[i]; reps++; climb += range * value;
            const e = ev('pull', 'rep', f.t, { side: SIDES[i], q: { range, speed: h.maxDown }, value });
            const lift = f.shoulder.y - (shoulderY.min() ?? f.shoulder.y);
            if (lift > o.shrug) e.warn = ['shrug' satisfies MovementWarning];
            out.push(e);
          } else note({ code: 'pull_faster', got: took, need: o.pullMs, side: SIDES[i] }, f.t);
          h.phase = 'idle'; h.progress = 0;
        } else if (took > o.pullMs) {
          note({ code: 'pull_faster', got: took, need: o.pullMs, side: SIDES[i] }, f.t);
          h.phase = 'idle'; h.progress = 0;
        } else if (rel - h.lowest >= o.letGo) {
          note({ code: 'pull_more', got: (h.peak - h.lowest) / A, need: (h.peak - o.pullTo) / A, side: SIDES[i] }, f.t);
          h.phase = 'idle'; h.progress = 0;
        }
        break;
      }
    }
  }

  return {
    id: 'pull',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { hands[0] = blank(); hands[1] = blank(); tracks[0].clear(); tracks[1].clear(); shoulderY.clear(); return out; }
      if (g !== 'ok') return out;
      shoulderY.push(f.t, f.shoulder.y);
      if (!vis.seen('hands', f.t, o.graceMs)) { hands[0] = blank(); hands[1] = blank(); return out; }
      stroke(0, f, out);
      stroke(1, f, out);
      return out;
    },
    value: () => (any ? Math.max(hands[0].progress, hands[1].progress) : undefined),
    channels() {
      const [l, r] = hands;
      return {
        'pull.L': l.progress, 'pull.R': r.progress,
        'grab.L': l.phase === 'grab' ? 1 : 0, 'grab.R': r.phase === 'grab' ? 1 : 0,
        'reach.L': l.above, 'reach.R': r.above, climb, reps,
      };
    },
    explain(windowMs = 2000): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      const m = miss as (Miss & { t: number }) | null;
      if (m && nowT - m.t <= windowMs) { const { t: _t, ...rest } = m; return rest; }
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); hands[0] = blank(); hands[1] = blank(); tracks[0].clear(); tracks[1].clear(); shoulderY.clear();
      lastSide = null; climb = 0; reps = 0; nowT = 0; any = false; miss = null;
    },
  } satisfies ExplainingDetector;
};

