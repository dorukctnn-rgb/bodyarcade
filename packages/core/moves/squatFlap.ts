// M1 for the flight template (Squat Flap, game-design.md 1.1 card 1): the squat as a wing. Down is a glide, the rise
// is the flap. Registered under the id 'squat' with `flap: 1` (the registry owner routes it: the runner's plain
// squat reps stay in squat.ts).
//
// Per frame, from the hip drop D (Features.drop, in T):
// - glide: D reached `down` (Easy 0.35, Normal 0.50, Deep 0.70, never more than 60 percent of the warm-up depth);
//   it ends below `down - 0.04`. holdStart and holdEnd mark it; the bird sinks at 35 percent while it lasts.
// - flap: after the glide began, D comes back under `flapBelow` (0.25) with an upward speed of at least 0.6 T/s.
//   One 'rep' per flap, q.speed = the peak upward speed (T/s), value = power = speed / 1.5, clipped to 0.6..1.2.
// - standing: D under 0.12 (the bird falls).
// - a rise that is too slow gives no flap (explain: too_slow); a head that drops without the hips does not count
//   (explain: bending_forward); a squat that stays above `down` is explained as hips_not_low.
// Chair mode needs no special case: sitting down is D >= down, standing up is the flap. Low impact: pass a smaller
// `down` (0.25). Channels: drop (D), glide, armed (a flap is possible), stand, up (current upward speed, T/s), deepest.
// Form notes on the flap event: knees_in (knees closer than 0.8 x the ankles) and chest_down (head drop more than hip
// drop + 0.3 T), both only said, never punished (game-design.md 0.5).
import type { BodyProfile, DetectorFactory, Features, MovementEvent } from '../types/index.ts';
import { PersonGate, Series, Track, Visibility, clamp, ev, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

/** Starting values from game-design.md card 1; none is measured on real people yet (tune with the recording day). */
export const SQUAT_FLAP_DEFAULTS = {
  down: 0.5,
  glideHyst: 0.04,
  flapBelow: -1,        // -1: derive min(0.25, down - 0.1)
  stand: 0.12,
  minUp: 0.6,           // T/s
  fullPower: 1.5,       // T/s at power 1
  powerMin: 0.6,
  powerMax: 1.2,
  speedWindowMs: 150,
  refractoryMs: 250,
  headExtra: 0.3,       // chest-up form note: head drop beyond hip drop
  kneesIn: 0.8,         // knee gap under this share of the ankle gap
  lostMs: 600,
} as const;

export const createSquatFlapDetector: DetectorFactory = (_p: BodyProfile, opts): ExplainingDetector => {
  const o = withDefaults(SQUAT_FLAP_DEFAULTS, opts);
  const flapBelow = o.flapBelow >= 0 ? o.flapBelow : Math.min(0.25, o.down - 0.1);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const dTrack = new Track(500);
  const dropSeries = new Series(3000);
  const headSeries = new Series(3000);
  const upSeries = new Series(3000);
  let armed = false;
  let glide = false;
  let deepest = 0;
  let deepestRep = 0;
  let peakUp = 0;
  let drop = 0;
  let up = 0;
  let lastFlapT = -Infinity;
  let slowRise: { t: number; got: number } | null = null;
  let flaps = 0;

  const state = (): Record<string, number> => ({ drop, glide: glide ? 1 : 0, armed: armed ? 1 : 0, stand: drop < o.stand ? 1 : 0, up, deepest, flaps });

  function endGlide(t: number, out: MovementEvent[]): void {
    if (!glide) return;
    glide = false;
    out.push(ev('squat', 'holdEnd', t, { q: { depth: deepestRep } }));
  }

  return {
    id: 'squat',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      if (g === 'lost') { endGlide(f.t, out); armed = false; deepestRep = 0; peakUp = 0; dTrack.clear(); drop = 0; up = 0; return out; }
      if (g !== 'ok') return out;

      drop = f.drop;
      dTrack.push(f.t, { x: drop, y: 0 });
      up = Math.max(0, -dTrack.velocity(o.speedWindowMs).x);
      dropSeries.push(f.t, drop);
      headSeries.push(f.t, f.headDrop);
      upSeries.push(f.t, up);
      deepest = Math.max(deepest, drop);

      // Glide: in the deep zone, with a little hysteresis on the way out.
      if (!glide && drop >= o.down) {
        glide = true; armed = true; deepestRep = drop; peakUp = 0;
        out.push(ev('squat', 'holdStart', f.t, { q: { depth: drop } }));
      } else if (glide && drop < o.down - o.glideHyst) {
        endGlide(f.t, out);
      }
      if (armed) {
        deepestRep = Math.max(deepestRep, drop);
        if (drop < deepestRep - 0.03) peakUp = Math.max(peakUp, up);
        if (drop < flapBelow) {
          armed = false;
          endGlide(f.t, out);
          if (peakUp >= o.minUp && f.t - lastFlapT >= o.refractoryMs) {
            lastFlapT = f.t;
            flaps++;
            const e = ev('squat', 'rep', f.t, { q: { depth: deepestRep, speed: peakUp }, value: clamp(peakUp / o.fullPower, o.powerMin, o.powerMax) });
            const warn: NonNullable<MovementEvent['warn']> = [];
            const kneeGap = Math.abs(f.knee[1].x - f.knee[0].x), ankleGap = Math.abs(f.ankle[1].x - f.ankle[0].x);
            // Measured at the bottom would be better; the rise has the knees close to their bottom positions already.
            if (f.seen.knees && f.seen.ankles && ankleGap > 0.2 && kneeGap < o.kneesIn * ankleGap) warn.push('knees_in');
            if (f.headDrop > deepestRep + o.headExtra) warn.push('chest_down');
            if (warn.length) e.warn = warn;
            out.push(e);
            slowRise = null;
          } else {
            slowRise = { t: f.t, got: peakUp };
          }
          deepestRep = 0; peakUp = 0;
        }
      }
      return out;
    },
    value: () => drop,
    channels: state,
    explain(windowMs = 2000): Miss | null {
      const t = dropSeries.lastT;
      if (t === undefined) return null;
      if (!vis.seen('hips', t, 400)) return { code: 'person_out' };
      const peakD = dropSeries.max(windowMs) ?? 0;
      const peakHead = headSeries.max(windowMs) ?? 0;
      if (slowRise && t - slowRise.t <= windowMs) return { code: 'too_slow', got: slowRise.got, need: o.minUp };
      if (peakD < o.down) {
        if (peakHead >= o.down && peakHead > peakD + o.headExtra) return { code: 'bending_forward', got: peakHead, need: o.down };
        if (peakD > 0.1) return { code: 'hips_not_low', got: peakD, need: o.down };
      }
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); dTrack.clear(); dropSeries.clear(); headSeries.clear(); upSeries.clear();
      armed = false; glide = false; deepest = 0; deepestRep = 0; peakUp = 0; drop = 0; up = 0; lastFlapT = -Infinity; slowRise = null; flaps = 0;
    },
  } satisfies ExplainingDetector;
};

/** The depth a level asks for, never more than 60 percent of the deepest squat of the warm-up (game-design.md card 1). */
export function flapDepthFor(level: 'easy' | 'normal' | 'deep', warmupDeepest?: number): number {
  const asked = level === 'easy' ? 0.35 : level === 'normal' ? 0.5 : 0.7;
  return warmupDeepest !== undefined && warmupDeepest > 0 ? Math.min(asked, 0.6 * warmupDeepest) : asked;
}
