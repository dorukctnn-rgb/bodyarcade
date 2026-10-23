// M11 overhead press (game-design.md 0.5; card 11 Rocket Press): both hands from the shoulders to over the head.
//
// Heights are the hand centre against the shoulder line in arm lengths A (+ = above), taken for the lower of the two hands
// so that both must do it:
// - rack: both hands within `rackBand` (0.25) A of the shoulder line. Being there arms the next press; hands that swept
//   through it between two frames count;
// - lockout: the lower hand at least `top` (0.85) A above the shoulder line and both elbows at least `elbow` (150) degrees.
//   events    rep when the body reaches lockout while armed (one press = rack, lockout, back down through the rack);
//             q.range = the lower hand's height in A, q.speed = its fastest upward speed in A per second, value = 1
//             holdStart / holdEnd: at lockout for `holdMs` (2000 ms, the afterburner of card 11); value = ms held
//   channels  press (0..1: the lower hand's height over `top`), armsUp (lower hand height, A), elbow (the smaller elbow
//             angle, degrees), top (1 at lockout), rack (1 in the rack), held (ms at lockout), reps, torso (hip-shoulder
//             length in T: shorter when the back arches or the body folds)
// Why a press did not count (`explain`): arms_not_up (got = the height reached, A), elbows_bent (got = the angle),
// use_both_arms (the arm that stayed low), arms_not_down (the second press began before the hands came back to the
// rack), body_not_straight (the torso looks shorter than `archMin` at lockout: the lower back arches), hands_out_of_view,
// elbows_out_of_view. Seated presses work as is.
import type { DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, Track, Visibility, clamp, ev, jointAngle, len, scalesOf, sub, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const OVERHEAD_PRESS_DEFAULTS = {
  rackBand: 0.25,    // hands within this of the shoulder line, A (card 11)
  top: 0.85,         // lockout height above the shoulder line, A (M11)
  elbow: 150,        // degrees (M11)
  holdMs: 2000,      // the afterburner (card 11); 0 turns holds off
  archMin: 0.88,     // torso shorter than this share of T at lockout is noted (unmeasured)
  refractoryMs: 300,
  speedWindowMs: 120,
  graceMs: 250,
  lostMs: 600,
} as const;

export const createOverheadPressDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(OVERHEAD_PRESS_DEFAULTS, opts);
  const A = scalesOf(p).a;
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const lowTrack = new Track(500);
  let armed = false, atTop = false, holding = false;
  let topSince = 0, topLastT = 0, lastRepT = -Infinity;
  let prevHi = NaN, prevLo = NaN;
  let peakArch = 1;
  // the best of the press in progress: the lower hand's height, the higher hand's height then, which arm was lower, its elbow
  let pressPeak = -Infinity, pressHiPeak = -Infinity, peakSide: Side = 'L';
  let lockedThisPress = false, judged = false;
  let ch: Record<string, number> = {};
  let reps = 0, nowT = 0, any = false;
  let miss: (Miss & { t: number }) | null = null;
  const note = (m: Miss, t: number): void => { miss = { ...m, t }; };

  function endHold(t: number, out: MovementEvent[]): void {
    if (holding) out.push(ev('overheadPress', 'holdEnd', t, { value: topLastT - topSince }));
    holding = false;
  }

  function unknown(t: number, out: MovementEvent[]): void { endHold(t, out); armed = false; atTop = false; prevHi = prevLo = NaN; lowTrack.clear(); }

  return {
    id: 'overheadPress',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { unknown(f.t, out); ch = {}; return out; }
      if (g !== 'ok') return out;
      if (!vis.seen('hands', f.t, o.graceMs) || !vis.seen('elbows', f.t, o.graceMs)) { unknown(f.t, out); return out; }

      const rel: [number, number] = [(f.hand[0].y - f.shoulders[0].y) / A, (f.hand[1].y - f.shoulders[1].y) / A];
      const lo = Math.min(rel[0], rel[1]), hi = Math.max(rel[0], rel[1]);
      const elbows: [number, number] = [jointAngle(f.shoulders[0], f.elbow[0], f.hand[0]), jointAngle(f.shoulders[1], f.elbow[1], f.hand[1])];
      const elbow = Math.min(elbows[0], elbows[1]);
      const torso = len(sub(f.shoulder, f.hip));
      lowTrack.push(f.t, { x: 0, y: lo });
      const inRack = hi <= o.rackBand && lo >= -o.rackBand;
      // hands that went through the rack between two frames: above its band before and below it now, or the other way round
      const crossed = !Number.isNaN(prevHi) && ((prevLo > o.rackBand && hi < -o.rackBand) || (prevHi < -o.rackBand && lo > o.rackBand));
      if (inRack || crossed || hi < -o.rackBand) {
        if (inRack || crossed) armed = true;
        pressPeak = -Infinity; pressHiPeak = -Infinity; lockedThisPress = false; judged = false;
      }
      prevHi = hi; prevLo = lo;
      pressPeak = Math.max(pressPeak, lo);
      if (hi > pressHiPeak) { pressHiPeak = hi; peakSide = rel[0] < rel[1] ? 'L' : 'R'; }

      const locked = lo >= o.top && elbow >= o.elbow;
      if (locked) {
        lockedThisPress = true;
        if (!atTop) {
          atTop = true; topSince = f.t; peakArch = torso;
          if (armed && f.t - lastRepT >= o.refractoryMs) {
            armed = false; lastRepT = f.t; reps++; miss = null;
            out.push(ev('overheadPress', 'rep', f.t, { q: { range: lo, speed: Math.max(0, lowTrack.velocity(o.speedWindowMs).y) }, value: 1 }));
          } else if (!armed) note({ code: 'arms_not_down', got: hi, need: o.rackBand }, f.t);
        }
        peakArch = Math.min(peakArch, torso);
        topLastT = f.t;
        if (o.holdMs > 0 && !holding && f.t - topSince >= o.holdMs) { holding = true; out.push(ev('overheadPress', 'holdStart', f.t, { value: f.t - topSince })); }
      } else {
        endHold(f.t, out);
        if (atTop) { atTop = false; if (peakArch < o.archMin) note({ code: 'body_not_straight', got: peakArch, need: o.archMin }, f.t); }
        // The hands turned around on the way up without locking out: say what was missing.
        if (!lockedThisPress && !judged && pressHiPeak >= 0.45 && hi < pressHiPeak - 0.15) {
          judged = true;
          if (pressHiPeak - pressPeak > 0.35) note({ code: 'use_both_arms', side: peakSide }, f.t);
          else if (pressPeak >= o.top) note({ code: 'elbows_bent', got: elbow, need: o.elbow }, f.t);
          else note({ code: 'arms_not_up', got: pressPeak, need: o.top }, f.t);
        }
      }
      ch = { press: clamp(lo / o.top, 0, 1), armsUp: lo, elbow, top: locked ? 1 : 0, rack: inRack ? 1 : 0, held: holding ? topLastT - topSince : 0, reps, torso };
      return out;
    },
    value: () => (any && Object.keys(ch).length ? ch.press : undefined),
    channels: () => ch,
    explain(windowMs = 2000): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      if (vis.unseenFor('elbows', nowT) > 500) return { code: 'elbows_out_of_view' };
      if (!Object.keys(ch).length) return null;
      const m = miss as (Miss & { t: number }) | null;
      if (m && nowT - m.t <= windowMs) { const { t: _t, ...rest } = m; return rest; }
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); lowTrack.clear(); armed = false; atTop = false; holding = false; topSince = 0; topLastT = 0; lastRepT = -Infinity;
      prevHi = NaN; prevLo = NaN; peakArch = 1; pressPeak = -Infinity; pressHiPeak = -Infinity; lockedThisPress = false; judged = false;
      ch = {}; reps = 0; nowT = 0; any = false; miss = null;
    },
  } satisfies ExplainingDetector;
};
