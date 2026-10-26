// M15 side view line (game-design.md 0.5; cards 16 Push Gate and 23 Plank Pilot): the body line and the elbow angle seen from
// the side, for push-ups (wall, incline, knees, floor) and planks.
//
// Both sides of the body are averaged: from the side they overlap, and the camera does not say which side faces it
// (Features carry no per-landmark visibility), so the "visible side" of the card is the mean of the two. Features come only
// for frames in which the extractor sees both shoulders and both hips (`ok`); a strict side view may need that gate relaxed
// by the body module, and the Plank Pilot test gate (card 23: shoulder, hip and ankle seen in 90 percent of the frames of
// 20 people) is a recording-day job, not code.
//
//   line    the angle at the hip between shoulder and ankle, degrees, signed so that 180 is straight: more than 180 is a
//           sagging hip (hip below the shoulder-ankle line), less is a piked one (hip up). Card 23 calls 165 to 195 straight.
//   dev     line - 180 (+ = sag)
//   elbow   the mean elbow angle (shoulder-elbow-hand), 180 = arm straight
//
//   push-ups (default). rep: the elbow goes from `upDeg` (160) or more down to `downDeg` (100; use 110 for the wall and the
//           incline) or less and back to `upDeg`; counted on the way back. value = 1 when the body line stayed within `pushDev`
//           (20) degrees of straight during the rep, 0 when it did not ("only reps with good form count", card 16); q.depth =
//           the smallest elbow angle, q.range = 180 - that; warn 'hip_sag' when the hip sagged. With `bottomHoldMs` > 0 the
//           bottom position held that long is holdStart / holdEnd (the giant pushes back).
//   plank (`plank: 1`). holdStart after `holdMs` (1000) in form: the line within `plankDev` (15) of straight and the elbows
//           under the shoulders (at most `elbowUnder` T, 0.25, away in x); holdEnd when the form has been lost for `graceMs`;
//           value = the time in form, ms.
//   channels  line, dev, elbow, elbowShift (|elbow x - shoulder x|, T), form (1 while the body is in the form of the mode),
//             held (ms in the current hold), reps
// Misses (`explain`): move_more (the elbow did not get down: got = the smallest angle, need = downDeg), hips_not_up (sagging),
// hips_not_low (piked), limb_off with limb 'elbow' (not under the shoulder), hands_out_of_view / elbows_out_of_view.
import type { DetectorFactory, Features, MovementEvent, Vec2 } from '../types/index.ts';
import { PersonGate, Series, Visibility, ev, flag, jointAngle, mid, sub, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const SIDE_LINE_DEFAULTS = {
  plank: 0,
  upDeg: 160,          // card 16
  downDeg: 100,        // card 16 (110 for the wall and the incline)
  pushDev: 20,         // degrees from straight allowed in a push-up: line at least 160 (card 16)
  plankDev: 15,        // 165 to 195 (card 23)
  elbowUnder: 0.25,    // T (card 23)
  holdMs: 1000,        // plank form this long is a hold (unmeasured)
  bottomHoldMs: 0,     // > 0: hold events at the bottom of a push-up
  minRepMs: 400,
  facing: 1,           // +1 the player faces screen right, -1 left: tells sag from pike on a near vertical body (the wall)
  graceMs: 400,
  lostMs: 600,
} as const;

/** The signed body line at the hip: `interior` 0..180 (180 straight) and `dev` (+ sag, - pike), degrees. */
export function bodyLine(shoulder: Vec2, hip: Vec2, ankle: Vec2, facing = 1): { interior: number; dev: number; line: number } {
  const interior = jointAngle(shoulder, hip, ankle);
  const mag = 180 - interior;
  const A = sub(ankle, shoulder), H = sub(hip, shoulder);
  const cross = A.x * H.y - A.y * H.x;
  const horizontal = Math.abs(A.x) >= Math.abs(A.y);
  const sag = horizontal ? !(cross * (A.x < 0 ? -1 : 1) > 0) : facing * cross > 0;
  const dev = sag ? mag : -mag;
  return { interior, dev, line: 180 + dev };
}

export const createSideLineDetector: DetectorFactory = (_p, opts): ExplainingDetector => {
  const o = withDefaults(SIDE_LINE_DEFAULTS, opts);
  const plank = flag(opts, 'plank', o.plank !== 0);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const devSeries = new Series(3000);
  let ch: Record<string, number> = {};
  let line = 180, nowT = 0, any = false, reps = 0, lastRepT = -Infinity;
  // push-up cycle
  let armed = false, minElbow = 180, depthOk = false, sagMax = 0, pikeMin = 0;
  // holds
  let formSince: number | null = null, formLostSince: number | null = null, holding = false, holdStart = 0, holdLast = 0;
  let bottomSince: number | null = null;
  let miss: (Miss & { t: number }) | null = null;
  const note = (m: Miss, t: number): void => { miss = { ...m, t }; };

  function endHold(t: number, out: MovementEvent[]): void {
    if (holding) out.push(ev('sideLine', 'holdEnd', t, { value: holdLast - holdStart }));
    holding = false; formSince = null; formLostSince = null; bottomSince = null;
  }

  return {
    id: 'sideLine',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { endHold(f.t, out); armed = false; ch = {}; return out; }
      if (g !== 'ok') return out;
      if (!vis.seen('elbows', f.t, o.graceMs) || !vis.seen('hands', f.t, o.graceMs)) { endHold(f.t, out); armed = false; return out; }

      const shoulder = mid(f.shoulders[0], f.shoulders[1]), hip = mid(f.hips[0], f.hips[1]), ankle = mid(f.ankle[0], f.ankle[1]);
      const b = bodyLine(shoulder, hip, ankle, o.facing);
      line = b.line;
      devSeries.push(f.t, b.dev);
      const elbow = (jointAngle(f.shoulders[0], f.elbow[0], f.hand[0]) + jointAngle(f.shoulders[1], f.elbow[1], f.hand[1])) / 2;
      const elbowShift = (Math.abs(f.elbow[0].x - f.shoulders[0].x) + Math.abs(f.elbow[1].x - f.shoulders[1].x)) / 2;

      if (plank) {
        const straight = Math.abs(b.dev) <= o.plankDev, under = elbowShift <= o.elbowUnder;
        const inForm = straight && under;
        if (inForm) {
          formLostSince = null;
          formSince ??= f.t;
          holdLast = f.t;
          if (!holding && f.t - formSince >= o.holdMs) { holding = true; holdStart = formSince; out.push(ev('sideLine', 'holdStart', f.t, { value: b.line })); }
        } else {
          formLostSince ??= f.t;
          if (!holding) formSince = null;
          if (!straight) note({ code: b.dev > 0 ? 'hips_not_up' : 'hips_not_low', got: b.line, need: b.dev > 0 ? 180 + o.plankDev : 180 - o.plankDev }, f.t);
          else note({ code: 'limb_off', limb: 'elbow', got: elbowShift, need: o.elbowUnder }, f.t);
          if (holding && f.t - formLostSince > o.graceMs) endHold(f.t, out);
        }
        ch = { line: b.line, dev: b.dev, elbow, elbowShift, form: inForm ? 1 : 0, held: holding ? holdLast - holdStart : 0, reps };
        return out;
      }

      // push-ups
      if (elbow >= o.upDeg) {
        if (armed && f.t - lastRepT >= o.minRepMs) {
          if (depthOk) {
            lastRepT = f.t; reps++;
            const good = sagMax <= o.pushDev && pikeMin >= -o.pushDev;
            const e = ev('sideLine', 'rep', f.t, { q: { depth: minElbow, range: 180 - minElbow }, value: good ? 1 : 0 });
            if (sagMax > o.pushDev) { e.warn = ['hip_sag']; note({ code: 'hips_not_up', got: 180 + sagMax, need: 180 + o.pushDev }, f.t); }
            else if (pikeMin < -o.pushDev) note({ code: 'hips_not_low', got: 180 + pikeMin, need: 180 - o.pushDev }, f.t);
            out.push(e);
          } else if (minElbow < o.upDeg - 20) note({ code: 'move_more', got: minElbow, need: o.downDeg }, f.t);
        }
        armed = true; minElbow = 180; depthOk = false; sagMax = 0; pikeMin = 0;
      } else if (armed) {
        minElbow = Math.min(minElbow, elbow);
        if (elbow <= o.downDeg) depthOk = true;
        sagMax = Math.max(sagMax, b.dev); pikeMin = Math.min(pikeMin, b.dev);
      }
      if (o.bottomHoldMs > 0) {
        if (elbow <= o.downDeg + 5) {
          bottomSince ??= f.t;
          holdLast = f.t;
          if (!holding && f.t - bottomSince >= o.bottomHoldMs) { holding = true; holdStart = bottomSince; out.push(ev('sideLine', 'holdStart', f.t, { value: elbow })); }
        } else endHold(f.t, out);
      }
      const form = Math.abs(b.dev) <= o.pushDev;
      ch = { line: b.line, dev: b.dev, elbow, elbowShift, form: form ? 1 : 0, held: holding ? holdLast - holdStart : 0, reps };
      return out;
    },
    value: () => (any && Object.keys(ch).length ? line : undefined),
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
      gate.reset(); vis.reset(); devSeries.clear(); ch = {}; line = 180; nowT = 0; any = false; reps = 0; lastRepT = -Infinity;
      armed = false; minElbow = 180; depthOk = false; sagMax = 0; pikeMin = 0; formSince = null; formLostSince = null; holding = false; holdStart = 0; holdLast = 0; bottomSince = null; miss = null;
    },
  } satisfies ExplainingDetector;
};
