// Star Catch (game-design.md card 8): stars drift into the picture around you; catch each with the hand of its colour
// before it fades. Stars come in constellations: catch all of one and the pattern lights up for a bonus. The left hand
// is gold and the right hand sky blue (the same colours as the HUD and the Mover's wrist bands); on the easiest level
// some stars are pearl and either hand takes them. Low stars (hard and expert, standing) ask for a squat.
//
// Rules, from the card: reach is the edge of the measured envelope on the harder levels, contact is 0.15 to 0.2 T for at
// least 60 ms, a low star needs the hips 0.3 T down (otherwise half the points and a note), and a seated player never
// gets a low star or a stretch to the very edge.
import type { Rng, Side } from '../../core/types/index.ts';
import type { HitJudgement } from '../../core/moves/handHit.ts';
import type { Miss } from '../../core/moves/kit.ts';
import { spot } from './envelope.ts';
import { intensityAt } from './timeline.ts';
import type { BaseSpec, LaneApi, Live, Out, PlanInput, Prompt, Rules } from './types.ts';
import { between, chance, clamp, lerp, missCode, ms, pick, range, slowFactor } from './util.ts';

export interface StarSpec extends BaseSpec {
  /** The constellation this star belongs to, its place in it (0-based) and the number of stars in it. */
  group: number;
  k: number;
  size: number;
  /** The hand that catches it; undefined: either (a pearl star). */
  side?: Side;
  /** Where it is, in arm lengths from the shoulder midpoint (x right, y up). */
  ax: number;
  ay: number;
  /** A low star: the hips must go 0.3 T down. */
  low: boolean;
  /** Hit radius in T and the contact time in ms. */
  r: number;
  dwell: number;
}

interface LevelCfg {
  /** Time between the stars of a constellation at the start and at the end of the run (ms). */
  gap: [number, number];
  /** How long a star stays (ms), at the start and at the end. */
  life: [number, number];
  radius: number;
  /** Share of the arm the stars reach at most (1 is the edge of the envelope). */
  reach: number;
  /** Share of stars either hand can take. */
  neutral: number;
  /** Share of stars that need the other hand than the side they are on (reach across the body). */
  cross: number;
  /** Share of stars that are low (standing only). */
  low: number;
  dwell: number;
  size: [number, number];
}

export const STAR_LEVELS: Record<'easy' | 'normal' | 'hard' | 'expert', LevelCfg> = {
  easy: { gap: [1500, 1000], life: [4600, 3800], radius: 0.24, reach: 0.78, neutral: 0.7, cross: 0, low: 0, dwell: 40, size: [3, 4] },
  normal: { gap: [1200, 800], life: [3800, 3000], radius: 0.21, reach: 0.88, neutral: 0, cross: 0, low: 0, dwell: 60, size: [4, 5] },
  hard: { gap: [1000, 620], life: [3000, 2300], radius: 0.19, reach: 0.95, neutral: 0, cross: 0.15, low: 0.08, dwell: 60, size: [5, 6] },
  expert: { gap: [800, 480], life: [2400, 1800], radius: 0.17, reach: 1, neutral: 0, cross: 0.25, low: 0.16, dwell: 60, size: [5, 7] },
};

/** Points: a star, the quick-catch bonus, the share a half-caught low star keeps, and the bonus for a whole constellation. */
export const STAR_POINTS = { star: 10, quick: 5, partial: 5, constellation: 20, perStar: 10 } as const;
/** The streak multiplier grows by one every this many catches, up to 5. */
export const STREAK_STEP = 5;

type Pt = { u: number; v: number };

/** Patterns for n stars in a unit square: u left to right, v from chest height (0) to over the head (1). */
const SHAPES: Record<string, (n: number) => Pt[]> = {
  arc: (n) => Array.from({ length: n }, (_, i) => { const a = Math.PI * (0.9 - 0.8 * (i / Math.max(1, n - 1))); return { u: Math.cos(a), v: 0.15 + 0.8 * Math.sin(a) }; }),
  zigzag: (n) => Array.from({ length: n }, (_, i) => ({ u: -0.9 + 1.8 * (i / Math.max(1, n - 1)), v: 0.3 + 0.5 * (i % 2) })),
  vee: (n) => Array.from({ length: n }, (_, i) => { const u = -0.9 + 1.8 * (i / Math.max(1, n - 1)); return { u, v: 0.2 + 0.7 * Math.abs(u) }; }),
  diagonal: (n) => Array.from({ length: n }, (_, i) => { const f = i / Math.max(1, n - 1); return { u: -0.85 + 1.7 * f, v: 0.2 + 0.7 * f }; }),
  crown: (n) => Array.from({ length: n }, (_, i) => { const f = i / Math.max(1, n - 1); return { u: -0.9 + 1.8 * f, v: i % 2 ? 0.45 : 0.9 - 0.25 * Math.abs(f - 0.5) }; }),
};
const SHAPE_NAMES = Object.keys(SHAPES);

/** Arm-length offsets (from the shoulder midpoint) for u, v of the pattern at the level's reach. */
const toArm = (p: Pt, reach: number): { ax: number; ay: number } => ({ ax: p.u * 0.95 * reach, ay: (-0.5 + p.v * 1.4) * reach });

export function planStars(rng: Rng, p: PlanInput): StarSpec[] {
  const cfg = STAR_LEVELS[p.level];
  const tl = p.timeline;
  const slow = slowFactor(p.hz) * (p.seated ? 1.15 : 1);
  const reach = p.seated ? cfg.reach * 0.92 : cfg.reach;
  const specs: StarSpec[] = [];
  let group = 0;
  for (const seg of tl.segments) {
    if (seg.kind !== 'play') continue;
    let t = seg.start + 1800;
    for (;;) {
      const inten = intensityAt(tl, t);
      const gap = lerp(cfg.gap[0], cfg.gap[1], inten);
      const life = lerp(cfg.life[0], cfg.life[1], inten) * slow;
      const size = between(rng, cfg.size[0], cfg.size[1]);
      const last = t + (size - 1) * gap;
      if (last + life > seg.end - 250) break;
      const shape = (SHAPES[pick(rng, SHAPE_NAMES)] as (n: number) => Pt[])(size);
      const flip = chance(rng, 0.5);
      for (let k = 0; k < size; k++) {
        const base = shape[k] as Pt;
        const jitter = { u: range(rng, -0.05, 0.05), v: range(rng, -0.05, 0.05) };
        const rNeutral = rng(), rCross = rng(), rLow = rng(), rSide = rng(), rX = rng();
        const pt = { u: clamp((flip ? -base.u : base.u) + jitter.u, -1, 1), v: clamp(base.v + jitter.v, 0, 1) };
        let { ax, ay } = toArm(pt, reach);
        let side: Side | undefined = ax < -0.12 ? 'L' : ax > 0.12 ? 'R' : rSide < 0.5 ? 'L' : 'R';
        if (rNeutral < cfg.neutral) side = undefined;
        else if (side && rCross < cfg.cross && Math.abs(ax) <= 0.6) side = side === 'L' ? 'R' : 'L';
        const low = !p.seated && !p.keyboard && rLow < cfg.low;
        if (low) {
          side = rSide < 0.5 ? 'L' : 'R';
          ax = (side === 'L' ? -1 : 1) * (0.3 + 0.4 * rX);
          ay = -1.25;
        }
        const at = ms(t + k * gap);
        specs.push({
          id: specs.length, at, life: ms(life), group, k, size, ...(side ? { side } : {}), ax: Math.round(ax * 1000) / 1000, ay: Math.round(ay * 1000) / 1000, low,
          r: cfg.radius + (p.seated ? 0.02 : 0), dwell: cfg.dwell,
        });
      }
      group++;
      t = last + gap * 1.7;
    }
  }
  return specs;
}

const key = (g: number, what: 'c' | 'r'): string => `${what}${g}`;

export const starCatchRules: Rules<StarSpec> = {
  id: 'star-catch',
  rounds: 3,
  restSec: 8,
  met: 3.5,
  clears: true,

  plan: planStars,

  open(spec: StarSpec, lane: LaneApi): Live {
    const p = spot(lane.env, spec.ax, spec.ay);
    return {
      id: spec.id, born: lane.t, x: p.x, y: p.y, r: spec.r, v: {},
      crit: {
        id: spec.id, x: p.x, y: p.y, r: spec.r, limb: 'hand', ...(spec.side ? { side: spec.side } : {}), dwellMs: spec.dwell,
        ...(spec.low ? { needDrop: 0.3 } : {}), shownAt: lane.poseNow(),
      },
    };
  },

  span: (spec, live) => ({ from: live.born, until: live.born + spec.life }),

  hit(spec: StarSpec, live: Live, j: HitJudgement, lane: LaneApi, out: Out): void {
    const s = lane.stats;
    const age = (lane.t - live.born) / spec.life;
    const mult = 1 + Math.min(4, Math.floor(s.streak / STREAK_STEP));
    const pts = (j.partial ? STAR_POINTS.partial : STAR_POINTS.star + (age < 0.35 ? STAR_POINTS.quick : 0)) * mult;
    s.score += pts;
    s.hits++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    lane.x[key(spec.group, 'c')] = (lane.x[key(spec.group, 'c')] ?? 0) + 1;
    out.event({ type: 'hit', kind: 'star', id: spec.id, group: spec.group, k: spec.k, x: live.x, y: live.y, pts, side: j.side, partial: j.partial, mult });
    out.log('star', true, pts);
    out.cue(j.partial ? 'good' : 'star');
    if (j.partial) out.hint('hips_not_low');
    resolved(spec, lane, out);
  },

  expire(spec: StarSpec, live: Live, miss: Miss | null, lane: LaneApi, out: Out): void {
    const code = missCode(miss);
    lane.stats.misses++;
    lane.stats.streak = 0;
    out.event({ type: 'miss', kind: 'star', id: spec.id, group: spec.group, k: spec.k, x: live.x, y: live.y, code });
    out.log(code, false);
    out.hint(code, { ...(miss?.side ? { side: miss.side } : spec.side ? { side: spec.side } : {}) });
    out.cue('miss');
    resolved(spec, lane, out);
  },

  prompt(lane: LaneApi): Prompt | null {
    if (lane.t - lane.seg.start < 2200) return { key: 'round', vars: { n: lane.seg.round + 1 }, icon: 'reach' };
    return null;
  },
};

/** A star has been caught or has faded: when the last of its constellation is settled, a whole one pays a bonus. */
function resolved(spec: StarSpec, lane: LaneApi, out: Out): void {
  const r = (lane.x[key(spec.group, 'r')] ?? 0) + 1;
  lane.x[key(spec.group, 'r')] = r;
  if (r < spec.size) return;
  const caught = lane.x[key(spec.group, 'c')] ?? 0;
  delete lane.x[key(spec.group, 'r')];
  delete lane.x[key(spec.group, 'c')];
  if (caught < spec.size) return;
  const bonus = STAR_POINTS.constellation + STAR_POINTS.perStar * spec.size;
  lane.stats.score += bonus;
  lane.stats.cleared++;
  out.event({ type: 'constellation', group: spec.group, size: spec.size, pts: bonus });
  out.log('constellation', true, bonus);
  out.cue('rep-best');
}
