// M16 arm direction (8 directions) and the arm flap (the seated Squat Flap, Wingbeat). One detector for both because
// both read the same thing: where each hand is relative to its own shoulder, in arm lengths A.
//
// Direction (Semaphore, game-design.md card 17): the vector from the shoulder to the hand centre is rounded to one of
// eight directions, 0 = screen right (the player's right arm out), 1 = up-right, 2 = up, 3 = up-left, 4 = left,
// 5 = down-left, 6 = down, 7 = down-right. An arm "points" when its direction is within `tol` (20 degrees) of the
// rounded one, the elbow is at least `straight` (150 degrees) and the hand is at least `minReach` of an arm away.
//   channels  arm.L.dir / arm.R.dir (0..7, -1 while not pointing), arm.L.deg / arm.R.deg (direction in degrees,
//             0 = right, 90 = up), arm.L.reach / arm.R.reach (shoulder to hand in A), arm.L.straight / arm.R.straight
//   events    with `holds: 1`: holdStart / holdEnd per side when an arm points steadily for `holdMs` (value = direction)
//
// Flap (`flap: 1`; game-design.md card 1 "kol çırpma" and card 12): each hand goes from at least `flapUp` A above its
// shoulder to at least `flapDown` A below it within `flapWindowMs`, both hands within `pairMs` of each other, and at
// some point of the stroke both hands were at least `flapSide` A out to the side (a wing, not a clap).
//   events    rep (id 'armDirection'): q.speed = peak downward speed of the hands in A per second, q.range = height of
//             the stroke in A, value = power = speed / flapFullSpeed clipped to powerMin..powerMax
//   channels  wing (mean hand height over the shoulder line in A, + = up), spread (mean sideways reach in A),
//             roll (degrees of the line between the hands, + = right hand higher; Wingbeat dead zone ROLL_DEAD_ZONE),
//             glide (1 while both hands are level with the shoulders and spread out: Wingbeat's glide), flaps (count)
// Seated play needs only hands, elbows and shoulders; nothing here looks at hips or legs.
// Unmeasured values (all of them, see game-design.md "Dürüstlük notu") are named in ARM_DIRECTION_DEFAULTS.
import type { DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import {
  PersonGate, SIDES, Track, Visibility, angleDiff, angleOf, clamp, ev, flag, jointAngle, len, scalesOf, sub, withDefaults,
  type ExplainingDetector, type Miss,
} from './kit.ts';

export const ARM_DIRECTION_DEFAULTS = {
  tol: 20,                // degrees around a 45 degree direction (M16)
  straight: 150,          // elbow angle, degrees (M16)
  minReach: 0.6,          // shoulder to hand, in A: a hand closer than this is not pointing anywhere (unmeasured)
  holdMs: 600,            // Semaphore hold (card 17)
  holds: 0,               // 1: emit holdStart / holdEnd for pointing arms
  flap: 0,                // 1: detect flap strokes
  flapUp: 0.2,            // hand above the shoulder by this many A: the top of a stroke (card 12)
  flapDown: 0.3,          // hand below the shoulder by this many A: the bottom of a stroke (card 12)
  flapWindowMs: 700,      // top to bottom, per hand (card 12)
  flapSide: 0.4,          // sideways reach of both hands during the stroke, A (card 12)
  pairMs: 300,            // the two hands finish within this of each other (unmeasured)
  flapRefractoryMs: 250,  // (unmeasured)
  flapFullSpeed: 3,       // downward A per second that counts as full power (unmeasured)
  powerMin: 0.6,
  powerMax: 1.2,
  speedWindowMs: 120,
  glideLevel: 0.2,        // card 12
  glideSpread: 0.7,       // card 12
  lostMs: 600,
} as const;

/** Wingbeat: roll under this many degrees counts as flying level (card 12). */
export const ROLL_DEAD_ZONE = 10;

/** The eight directions as unit steps of 45 degrees; index = the `dir` channel. */
export const DIRECTION_NAMES = ['right', 'upRight', 'up', 'upLeft', 'left', 'downLeft', 'down', 'downRight'] as const;

/** The direction index (0..7) nearest to an angle in degrees, and how far off it is. */
export function nearestDirection(deg: number): { dir: number; off: number } {
  const step = Math.round(deg / 45);
  return { dir: ((step % 8) + 8) % 8, off: angleDiff(deg, step * 45) };
}

interface ArmState { dir: number; deg: number; reach: number; straight: boolean; elbow: number; pointing: boolean; since: number; held: boolean }
const blankArm = (): ArmState => ({ dir: -1, deg: -90, reach: 0, straight: false, elbow: 180, pointing: false, since: 0, held: false });

export const createArmDirectionDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(ARM_DIRECTION_DEFAULTS, opts);
  const holds = flag(opts, 'holds', o.holds !== 0), flapOn = flag(opts, 'flap', o.flap !== 0);
  const A = scalesOf(p).a;
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const wingTrack = new Track(600);
  const arms: [ArmState, ArmState] = [blankArm(), blankArm()];
  const lastUp: [number | undefined, number | undefined] = [undefined, undefined];
  const maxLat: [number, number] = [0, 0];
  const done: [{ t: number; lat: number } | undefined, { t: number; lat: number } | undefined] = [undefined, undefined];
  let peakDown = 0;
  let strokeTop = 0;
  let lastFlapT = -Infinity;
  let lastMiss: (Miss & { t: number }) | null = null;
  let wing = 0, spread = 0, roll = 0, glide = false, flaps = 0, nowT = 0;
  let bentElbow: (Miss & { t: number }) | null = null;

  const note = (m: Miss, t: number): void => { lastMiss = { ...m, t }; };

  function direction(f: Features, i: 0 | 1, out: MovementEvent[]): void {
    const s = f.shoulders[i], h = f.hand[i], e = f.elbow[i];
    const v = sub(h, s);
    const a = arms[i];
    a.reach = len(v) / A;
    a.deg = angleOf(v);
    a.elbow = jointAngle(s, e, h);
    a.straight = a.elbow >= o.straight;
    const near = nearestDirection(a.deg);
    const inLine = near.off <= o.tol && a.reach >= o.minReach;
    const was = a.dir;
    a.pointing = inLine && a.straight;
    a.dir = a.pointing ? near.dir : -1;
    if (inLine && !a.straight) bentElbow = { code: 'elbows_bent', got: a.elbow, need: o.straight, side: SIDES[i], t: f.t };
    if (a.dir !== was) { a.since = f.t; if (a.held) { a.held = false; if (holds) out.push(ev('armDirection', 'holdEnd', f.t, { side: SIDES[i], value: was })); } }
    if (holds && a.pointing && !a.held && f.t - a.since >= o.holdMs) { a.held = true; out.push(ev('armDirection', 'holdStart', f.t, { side: SIDES[i], value: a.dir })); }
  }

  function flap(f: Features, hy: [number, number], lat: [number, number], out: MovementEvent[]): void {
    const t = f.t;
    for (const i of [0, 1] as const) {
      if (hy[i] >= o.flapUp) { lastUp[i] = t; maxLat[i] = lat[i]; strokeTop = Math.max(strokeTop, hy[i]); } else if (lastUp[i] !== undefined) maxLat[i] = Math.max(maxLat[i], lat[i]);
      const top = lastUp[i];
      if (hy[i] <= -o.flapDown && top !== undefined) {
        lastUp[i] = undefined;
        if (t - top <= o.flapWindowMs) done[i] = { t, lat: maxLat[i] };
        else note({ code: 'too_slow', got: t - top, need: o.flapWindowMs, side: SIDES[i] }, t);
      }
    }
    const [dl, dr] = done;
    if (dl && dr) {
      done[0] = undefined; done[1] = undefined;
      if (Math.abs(dl.t - dr.t) <= o.pairMs) {
        const lateral = Math.min(dl.lat, dr.lat);
        if (lateral < o.flapSide) note({ code: 'arms_not_out', got: lateral, need: o.flapSide }, t);
        else if (t - lastFlapT >= o.flapRefractoryMs) {
          lastFlapT = t; flaps++;
          out.push(ev('armDirection', 'rep', t, { q: { speed: peakDown, range: strokeTop + o.flapDown }, value: clamp(peakDown / o.flapFullSpeed, o.powerMin, o.powerMax) }));
          peakDown = 0; strokeTop = 0;
        }
      } else note({ code: 'use_both_arms', side: dl.t < dr.t ? 'R' : 'L' }, t);
    } else {
      // One hand finished a stroke and the other did not follow in time: say which arm stayed behind.
      const one = dl ?? dr;
      if (one && t - one.t > o.pairMs) { const behind: Side = dl ? 'R' : 'L'; done[0] = undefined; done[1] = undefined; note({ code: 'use_both_arms', side: behind }, t); }
    }
  }

  return {
    id: 'armDirection',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      if (g === 'lost') {
        for (const i of [0, 1] as const) { const a = arms[i]; if (a.held) out.push(ev('armDirection', 'holdEnd', f.t, { side: SIDES[i], value: a.dir })); arms[i] = blankArm(); lastUp[i] = undefined; done[i] = undefined; }
        wingTrack.clear(); peakDown = 0; strokeTop = 0; glide = false;
        return out;
      }
      if (g !== 'ok') return out;
      // Hands or elbows out of view: their positions are guesses. Nothing points, nothing flaps, until they are back.
      if (!vis.seen('hands', f.t, 300) || !vis.seen('elbows', f.t, 300)) {
        for (const i of [0, 1] as const) {
          const a = arms[i];
          if (a.held) out.push(ev('armDirection', 'holdEnd', f.t, { side: SIDES[i], value: a.dir }));
          arms[i] = blankArm(); lastUp[i] = undefined; done[i] = undefined;
        }
        glide = false; peakDown = 0; strokeTop = 0;
        return out;
      }
      direction(f, 0, out);
      direction(f, 1, out);
      const hy: [number, number] = [(f.hand[0].y - f.shoulders[0].y) / A, (f.hand[1].y - f.shoulders[1].y) / A];
      const lat: [number, number] = [Math.abs(f.hand[0].x - f.shoulders[0].x) / A, Math.abs(f.hand[1].x - f.shoulders[1].x) / A];
      wing = clamp((hy[0] + hy[1]) / 2, -1.5, 1.5);
      spread = (lat[0] + lat[1]) / 2;
      roll = Math.atan2(f.hand[1].y - f.hand[0].y, f.hand[1].x - f.hand[0].x) * 180 / Math.PI;
      if (Math.abs(roll) > 90) roll = roll > 0 ? roll - 180 : roll + 180;   // hands crossed: keep the angle of the line
      glide = Math.abs(hy[0]) <= o.glideLevel && Math.abs(hy[1]) <= o.glideLevel && lat[0] >= o.glideSpread && lat[1] >= o.glideSpread;
      if (flapOn) {
        wingTrack.push(f.t, { x: 0, y: wing });
        if (lastUp[0] !== undefined || lastUp[1] !== undefined) peakDown = Math.max(peakDown, -wingTrack.velocity(o.speedWindowMs).y);
        flap(f, hy, lat, out);
      }
      return out;
    },
    value: () => wing,
    channels() {
      const [l, r] = arms;
      return {
        'arm.L.dir': l.dir, 'arm.R.dir': r.dir, 'arm.L.deg': l.deg, 'arm.R.deg': r.deg, 'arm.L.reach': l.reach, 'arm.R.reach': r.reach,
        'arm.L.straight': l.straight ? 1 : 0, 'arm.R.straight': r.straight ? 1 : 0,
        wing, spread, roll, glide: glide ? 1 : 0, flaps,
      };
    },
    explain(windowMs = 2000): Miss | null {
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      if (vis.unseenFor('elbows', nowT) > 500) return { code: 'elbows_out_of_view' };
      for (const m of [lastMiss as (Miss & { t: number }) | null, bentElbow as (Miss & { t: number }) | null]) {
        if (m && nowT - m.t <= windowMs) { const { t: _t, ...rest } = m; return rest; }
      }
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); wingTrack.clear();
      arms[0] = blankArm(); arms[1] = blankArm();
      lastUp[0] = undefined; lastUp[1] = undefined; maxLat[0] = 0; maxLat[1] = 0; done[0] = undefined; done[1] = undefined;
      peakDown = 0; strokeTop = 0; lastFlapT = -Infinity; lastMiss = null; bentElbow = null; wing = 0; spread = 0; roll = 0; glide = false; flaps = 0; nowT = 0;
    },
  } satisfies ExplainingDetector;
};
