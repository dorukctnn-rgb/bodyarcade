// Reaction Tag (game-design.md card 27): lights come on around you and fade fast; tap each green one before it goes,
// with either hand, and never touch a red one. Harder levels bring lights further out (a side step), lights on the floor
// (a foot tap, standing and not in quiet mode) and more of them at once. Every tap measures your reaction in
// milliseconds: the time from the light coming on to the hand touching it, less the system's own delay.
//
// Rules, from the card: contact at once (the first frame inside counts), 0.15 T for hands and 0.35 W for feet with the
// ankle on the floor line, light life from 1.5 s down to 0.6 s, and hands only for a seated player. Colour is never the
// only signal: a red light is also a different shape (a square with a cross), so it reads for colour blind players.
import type { Rng } from '../../core/types/index.ts';
import type { HitJudgement } from '../../core/moves/handHit.ts';
import type { Miss } from '../../core/moves/kit.ts';
import { floorSpot, spot } from './envelope.ts';
import { intensityAt } from './timeline.ts';
import type { BaseSpec, LaneApi, Live, Out, PlanInput, Prompt, Rules } from './types.ts';
import { between, clamp, lerp, missCode, ms, range, slowFactor } from './util.ts';

export type Zone = 'hand' | 'wide' | 'floor';

export interface LightSpec extends BaseSpec {
  zone: Zone;
  /** A red light: leave it alone. */
  trap: boolean;
  limb: 'hand' | 'foot';
  /** Hand and wide lights: arm lengths from the shoulder midpoint. Floor lights: ax is shoulder widths from the hip centre. */
  ax: number;
  ay: number;
  /** Hit radius of a hand light in T. (A foot light is 0.35 W.) */
  r: number;
  /** The lights that came on together. */
  burst: number;
}

interface LevelCfg {
  /** Time between one burst and the next (ms), at the start and at the end of the run. */
  gap: [number, number];
  /** How long a light stays (ms), at the start and at the end. */
  life: [number, number];
  /** Lights at once, at most, at the start and at the end. */
  burst: [number, number];
  trap: number;
  wide: number;
  floor: number;
  radius: number;
}

export const LIGHT_LEVELS: Record<'easy' | 'normal' | 'hard' | 'expert', LevelCfg> = {
  easy: { gap: [1500, 1100], life: [2300, 1900], burst: [1, 1], trap: 0, wide: 0, floor: 0, radius: 0.2 },
  normal: { gap: [1250, 850], life: [1900, 1400], burst: [1, 2], trap: 0.12, wide: 0.1, floor: 0.1, radius: 0.18 },
  hard: { gap: [1050, 700], life: [1500, 1000], burst: [1, 2], trap: 0.2, wide: 0.15, floor: 0.15, radius: 0.16 },
  expert: { gap: [900, 550], life: [1200, 650], burst: [1, 3], trap: 0.25, wide: 0.2, floor: 0.2, radius: 0.15 },
};

/** Lights of one burst come on this far apart (ms). */
export const STAGGER_MS = 190;
/** A wide or a floor light needs a step: it stays this much longer (ms). */
export const STEP_EXTRA_MS = 380;

/** How far the camera's clock may run ahead of the game's own clock before the game's own reading is used (ms). */
export const REACT_SLACK_MS = 60;

export const LIGHT_POINTS = { tap: 60, speed: 40, trap: -40, avoid: 5 } as const;
export const LIGHT_STREAK_STEP = 5;

export function planLights(rng: Rng, p: PlanInput): LightSpec[] {
  const cfg = LIGHT_LEVELS[p.level];
  const tl = p.timeline;
  const slow = slowFactor(p.hz) * (p.seated ? 1.2 : 1);
  // Foot lights need the floor in view, a standing player who may stamp, and a body to step with.
  const feet = p.feet && !p.seated && !p.quiet && !p.keyboard;
  const specs: LightSpec[] = [];
  const recent: { until: number; ax: number; ay: number }[] = [];
  let burst = 0;
  for (const seg of tl.segments) {
    if (seg.kind !== 'play') continue;
    let t = seg.start + 1800;
    for (;;) {
      const inten = intensityAt(tl, t);
      const gap = lerp(cfg.gap[0], cfg.gap[1], inten);
      const life = lerp(cfg.life[0], cfg.life[1], inten) * slow;
      const cap = Math.max(1, Math.round(lerp(cfg.burst[0], cfg.burst[1], inten)));
      const n = between(rng, 1, cap);
      if (t + (n - 1) * STAGGER_MS + life + STEP_EXTRA_MS > seg.end - 250) break;
      for (let i = 0; i < n; i++) {
        const at = t + i * STAGGER_MS;
        const rZone = rng(), rTrap = rng(), rSide = rng();
        let zone: Zone = 'hand';
        if (!p.seated && !p.keyboard && rZone < cfg.wide) zone = 'wide';
        else if (feet && rZone >= cfg.wide && rZone < cfg.wide + cfg.floor) zone = 'floor';
        const trap = zone === 'hand' && rTrap < cfg.trap;
        let ax = 0, ay = 0;
        if (zone === 'floor') {
          ax = (rSide < 0.5 ? -1 : 1) * range(rng, 0.7, 1.4);
          ay = 0;
        } else if (zone === 'wide') {
          ax = (rSide < 0.5 ? -1 : 1) * range(rng, 1.55, 1.9);
          ay = range(rng, -0.35, 0.55);
        } else {
          // anywhere around the upper body, but not on top of the head or at the very edge; a few tries to stay clear of what is on the screen
          for (let tries = 0; tries < 8; tries++) {
            ax = range(rng, -0.95, 0.95) * (p.seated ? 0.9 : 1);
            ay = range(rng, -0.55, 0.8) * (p.seated ? 0.9 : 1);
            const onHead = Math.abs(ax) < 0.22 && ay > 0.15 && ay < 0.65;
            const crowded = recent.some((o) => o.until > at && Math.hypot(o.ax - ax, o.ay - ay) < 0.5);
            if (!onHead && !crowded) break;
          }
        }
        const lifeMs = ms(life + (zone === 'hand' ? 0 : STEP_EXTRA_MS));
        recent.push({ until: at + lifeMs, ax, ay });
        if (recent.length > 12) recent.shift();
        specs.push({
          id: specs.length, at: ms(at), life: lifeMs, zone, trap, limb: zone === 'floor' ? 'foot' : 'hand',
          ax: Math.round(ax * 1000) / 1000, ay: Math.round(ay * 1000) / 1000, r: cfg.radius + (p.seated ? 0.02 : 0), burst,
        });
      }
      burst++;
      t += gap;
    }
  }
  return specs;
}

export const reactionTagRules: Rules<LightSpec> = {
  id: 'reaction-tag',
  rounds: 3,
  restSec: 10,
  met: 4,

  plan: planLights,

  open(spec: LightSpec, lane: LaneApi): Live | null {
    if (spec.zone === 'floor') {
      const p = floorSpot(lane.env, spec.ax);
      if (!p) return null;
      const r = 0.35 * lane.env.halfW * 2;
      return { id: spec.id, born: lane.t, x: p.x, y: p.y, r, v: {}, crit: { id: spec.id, x: p.x, y: p.y, r, limb: 'foot', floorOnly: true, shownAt: lane.poseNow() } };
    }
    const p = spot(lane.env, spec.ax, spec.ay);
    return { id: spec.id, born: lane.t, x: p.x, y: p.y, r: spec.r, v: {}, crit: { id: spec.id, x: p.x, y: p.y, r: spec.r, limb: 'hand', shownAt: lane.poseNow() } };
  },

  span: (spec, live) => ({ from: live.born, until: live.born + spec.life }),

  hit(spec: LightSpec, live: Live, j: HitJudgement, lane: LaneApi, out: Out): void {
    const s = lane.stats;
    if (spec.trap) {
      s.score = Math.max(0, s.score + LIGHT_POINTS.trap);
      s.misses++;
      s.traps++;
      s.streak = 0;
      out.event({ type: 'trap', kind: 'light', id: spec.id, x: live.x, y: live.y, pts: LIGHT_POINTS.trap, side: j.side });
      out.log('hold_still', false);
      out.hint('hold_still');
      out.cue('warn');
      return;
    }
    // The detector measures on the camera's clock; this game's own clock stands still while the session is paused or somebody
    // is out of view. After such a wait the camera's clock is far ahead, and the light has only been there for the time the game
    // ran: the tap is judged on the shorter of the two (they agree to within a pose frame in an ordinary round).
    const own = Math.max(0, lane.t - live.born - lane.latencyMs);
    const react = Math.round(Math.min(Math.max(0, j.reactMs ?? own), own + REACT_SLACK_MS));
    const mult = 1 + Math.min(4, Math.floor(s.streak / LIGHT_STREAK_STEP));
    const quick = clamp(1 - react / (spec.life * 0.8), 0, 1);
    const pts = Math.round((LIGHT_POINTS.tap + LIGHT_POINTS.speed * quick) * mult);
    s.score += pts;
    s.hits++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.reactN++;
    s.reactSum += react;
    s.reactBest = s.reactBest === 0 ? react : Math.min(s.reactBest, react);
    out.event({ type: 'hit', kind: 'light', id: spec.id, burst: spec.burst, x: live.x, y: live.y, pts, react, mult, limb: j.limb, side: j.side });
    out.log('tag', true, react);
    out.cue('tag');
  },

  expire(spec: LightSpec, live: Live, miss: Miss | null, lane: LaneApi, out: Out): void {
    const s = lane.stats;
    if (spec.trap) {
      s.score += LIGHT_POINTS.avoid;
      s.avoided++;
      out.event({ type: 'avoid', kind: 'light', id: spec.id, x: live.x, y: live.y, pts: LIGHT_POINTS.avoid });
      out.log('avoid', true, LIGHT_POINTS.avoid);
      return;
    }
    const code = missCode(miss, spec.limb === 'foot' ? 'feet_out_of_view' : 'hands_out_of_view');
    s.misses++;
    s.streak = 0;
    out.event({ type: 'miss', kind: 'light', id: spec.id, burst: spec.burst, x: live.x, y: live.y, code, limb: spec.limb });
    out.log(code, false);
    out.hint(code);
    out.cue('miss');
  },

  prompt(lane: LaneApi): Prompt | null {
    if (lane.t - lane.seg.start < 2200) return { key: 'tap_green', icon: 'reach' };
    return null;
  },
};

/** The average and the best reaction of a lane in ms, or null before the first tap. */
export function reactionOf(s: { reactN: number; reactSum: number; reactBest: number }): { avg: number; best: number } | null {
  return s.reactN > 0 ? { avg: Math.round(s.reactSum / s.reactN), best: s.reactBest } : null;
}

