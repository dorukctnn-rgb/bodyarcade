// M14 steadiness and the one-leg stance (game-design.md 0.5; cards 35 Flamingo, 2 Hot Seat, 36 Tree Garden): how still the
// body holds, and whether a foot is off the floor.
//
// Sway is the standard deviation over the last `windowMs` (2 s) of:
//   - the hip midpoint x and the shoulder midpoint x, in shoulder widths W (Flamingo, Tree Garden): `sway.hip`,
//     `sway.shoulder`, and `sway`, their mean;
//   - the hip midpoint y, in torso lengths T (Hot Seat): `sway.y`.
// `steady` is 1 for no sway and falls to 0 at `swayRef` W (the sway of `sway`). Nothing here is a threshold on people yet
// (unmeasured, see STEADINESS_DEFAULTS); the games set their own bands.
//
// With `stance: 1` it also reads the one-leg stance of card 35: a foot is lifted when its ankle is at least `liftT` (0.15)
// T above the other ankle, or its knee lift k reaches `liftK` (0.3). The stance holds from `liftMs` (300 ms) of a lifted foot:
//   events    holdStart (side = the lifted foot) and holdEnd (value = the time held, ms), when the foot has been down for
//             `touchMs` (300 ms; raise it for the supported mode that allows a light toe touch) or the other foot is lifted
//   channels  stance (-1 left foot lifted, +1 right, 0 both down), lift (the ankle height difference, T), k.L / k.R (knee lift),
//             held (ms of the current hold), floor (1 while both ankles are within `floorT` = 0.06 T of the floor line:
//             the lowest ankle of the last five seconds)
// Why (`explain`): hold_still (sway over `swayMax` W, got and need), knee_not_high (the foot rose less than `liftT`),
// knees_out_of_view / feet_out_of_view, hips_out_of_view.
import type { DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, Series, Visibility, clamp, ev, flag, scalesOf, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const STEADINESS_DEFAULTS = {
  windowMs: 2000,   // M14
  swayRef: 0.3,     // W where `steady` reaches 0 (unmeasured)
  swayMax: 0.25,    // W: more than this is "hold still" in explain (unmeasured)
  stance: 0,        // 1: read the one-leg stance
  liftT: 0.15,      // ankle height difference, T (card 35)
  liftK: 0.3,       // or knee lift k (card 35)
  floorT: 0.06,     // both ankles this near the floor line: down (card 35)
  liftMs: 300,
  touchMs: 300,     // (card 35: "> 0,3 sn")
  floorWindowMs: 5000,
  graceMs: 250,
  lostMs: 600,
} as const;

export const createSteadinessDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(STEADINESS_DEFAULTS, opts);
  const stance = flag(opts, 'stance', o.stance !== 0);
  const { w, u } = scalesOf(p);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const hipX = new Series(o.windowMs + 200), shX = new Series(o.windowMs + 200), hipY = new Series(o.windowMs + 200);
  const swaySeries = new Series(4000), liftSeries = new Series(4000);
  const lowAnkle = new Series(o.floorWindowMs);
  let ch: Record<string, number> = {};
  let sway = 0, nowT = 0, any = false;
  let liftedSince: number | null = null, downSince: number | null = null;
  let holding = false, holdSide: Side = 'L', holdStart = 0, holdLast = 0, holdDir: -1 | 1 = -1;

  function endHold(t: number, out: MovementEvent[]): void {
    if (holding) out.push(ev('steadiness', 'holdEnd', t, { side: holdSide, value: holdLast - holdStart }));
    holding = false; liftedSince = null; downSince = null;
  }

  return {
    id: 'steadiness',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { endHold(f.t, out); hipX.clear(); shX.clear(); hipY.clear(); lowAnkle.clear(); ch = {}; sway = 0; return out; }
      if (g !== 'ok') return out;

      hipX.push(f.t, f.hip.x); shX.push(f.t, f.shoulder.x); hipY.push(f.t, f.hip.y);
      const sh = (hipX.std(o.windowMs) ?? 0) / w, ss = (shX.std(o.windowMs) ?? 0) / w, sy = hipY.std(o.windowMs) ?? 0;
      sway = (sh + ss) / 2;
      swaySeries.push(f.t, sway);
      const c: Record<string, number> = { 'steady.t': f.t, sway, 'sway.hip': sh, 'sway.shoulder': ss, 'sway.y': sy, steady: clamp(1 - sway / o.swayRef, 0, 1) };

      if (stance) {
        const legsSeen = vis.seen('ankles', f.t, o.graceMs) && vis.seen('knees', f.t, o.graceMs);
        const k: [number, number] = [(f.knee[0].y + u) / u, (f.knee[1].y + u) / u];
        const diff = f.ankle[1].y - f.ankle[0].y;                       // > 0: the right ankle is higher
        const lift = Math.abs(diff);
        liftSeries.push(f.t, lift);
        let now: -1 | 0 | 1 = 0;
        if (legsSeen) {
          const byAnkle = lift >= o.liftT;
          const byKnee = Math.max(k[0], k[1]) >= o.liftK && Math.abs(k[0] - k[1]) >= o.liftK * 0.5;
          if (byAnkle) now = diff > 0 ? 1 : -1;
          else if (byKnee) now = k[1] > k[0] ? 1 : -1;
        }
        if (legsSeen) lowAnkle.push(f.t, Math.min(f.ankle[0].y, f.ankle[1].y));
        const floorY = lowAnkle.min() ?? 0;
        const near = legsSeen && f.ankle[0].y - floorY <= o.floorT && f.ankle[1].y - floorY <= o.floorT;

        if (now !== 0) {
          downSince = null;
          if (holding && now !== holdDir) endHold(f.t, out);            // the other foot is up: a new stance
          if (!holding) {
            liftedSince ??= f.t;
            if (f.t - liftedSince >= o.liftMs) { holding = true; holdDir = now; holdSide = now < 0 ? 'L' : 'R'; holdStart = liftedSince; holdLast = f.t; out.push(ev('steadiness', 'holdStart', f.t, { side: holdSide, value: sway })); }
          } else holdLast = f.t;
        } else {
          liftedSince = null;
          if (holding) { downSince ??= f.t; if (f.t - downSince >= o.touchMs) endHold(f.t, out); }
          else downSince = null;
        }
        c.stance = now; c.lift = lift; c['k.L'] = k[0]; c['k.R'] = k[1]; c.held = holding ? holdLast - holdStart : 0; c.floor = near ? 1 : 0;
      }
      ch = c;
      return out;
    },
    value: () => (any && Object.keys(ch).length ? sway : undefined),
    channels: () => ch,
    explain(windowMs = 2000): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('hips', nowT) > 500) return { code: 'hips_out_of_view' };
      if (stance && vis.unseenFor('knees', nowT) > 500) return { code: 'knees_out_of_view' };
      if (stance && vis.unseenFor('ankles', nowT) > 500) return { code: 'feet_out_of_view' };
      if (!Object.keys(ch).length) return null;
      const s = swaySeries.max(windowMs) ?? 0;
      if (s > o.swayMax) return { code: 'hold_still', got: s, need: o.swayMax };
      if (stance && !holding) {
        const best = liftSeries.max(windowMs) ?? 0;
        if (best > 0.05 && best < o.liftT && ch.stance === 0) return { code: 'knee_not_high', got: best, need: o.liftT };
      }
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); hipX.clear(); shX.clear(); hipY.clear(); swaySeries.clear(); liftSeries.clear(); lowAnkle.clear();
      ch = {}; sway = 0; nowT = 0; any = false; liftedSince = null; downSince = null; holding = false; holdStart = 0; holdLast = 0;
    },
  } satisfies ExplainingDetector;
};
