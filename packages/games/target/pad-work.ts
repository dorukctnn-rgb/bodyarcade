// Pad Work (game-design.md card 7): numbered pads appear around your head, the trainer's combination is "1-2-3", and
// each punch lands on the beat. A pad is hit by the right hand, going fast (at least 1.5 arm lengths a second) and
// reaching it within 0.2 of an arm. Pads hang on the shoulders (arm lengths from the shoulder midpoint, `padAt`), so they
// follow a player who bobs and weaves. From the normal level a swinging bag now and then asks for a slip (lean away) or,
// standing, a duck.
//
// Safety, from the card: pads sit across and to the sides (a straight punch at the camera hardly moves in 2D), never
// further than 0.95 of an arm so the elbow is never locked out, and a seated player gets the same game without ducks.
// Timing is the rhythm kit's (core/moves/rhythm.ts): within 120 ms of the beat is Perfect, within 220 ms Good, and a punch
// that is off the beat but still lands counts for a little.
import type { Rng, Side } from '../../core/types/index.ts';
import { padAt, type HitJudgement } from '../../core/moves/handHit.ts';
import type { Miss } from '../../core/moves/kit.ts';
import { gradeOffset, BEAT_WINDOWS } from '../../core/moves/rhythm.ts';
import { fit, SEATED_SCALE, spot } from './envelope.ts';
import { intensityAt } from './timeline.ts';
import type { BaseSpec, LaneApi, Live, Out, PlanInput, Prompt, Rules } from './types.ts';
import { clamp, lerp, missCode, ms, slowFactor } from './util.ts';

export type MoveId = 'jab' | 'cross' | 'hookL' | 'hookR' | 'upperL' | 'upperR';

/** The six punches: the hand, and where the pad hangs in arm lengths from the shoulder midpoint (x right, y up). */
export const MOVES: Record<MoveId, { hand: Side; ax: number; ay: number }> = {
  jab: { hand: 'L', ax: -0.55, ay: 0.12 },
  cross: { hand: 'R', ax: 0.55, ay: 0.12 },
  hookL: { hand: 'L', ax: -0.95, ay: 0.34 },
  hookR: { hand: 'R', ax: 0.95, ay: 0.34 },
  upperL: { hand: 'L', ax: -0.22, ay: 0.58 },
  upperR: { hand: 'R', ax: 0.22, ay: 0.58 },
};

const MIRROR: Record<MoveId, MoveId> = { jab: 'cross', cross: 'jab', hookL: 'hookR', hookR: 'hookL', upperL: 'upperR', upperR: 'upperL' };

export type BagNeed = 'slipL' | 'slipR' | 'duck';

export interface PadSpec extends BaseSpec {
  kind: 'pad' | 'bag';
  /** The moment of the beat the punch (or the bag's swing) belongs to, ms from the first step, and the window that is judged. */
  beat: number;
  from: number;
  until: number;
  /** The combination this pad belongs to, its place in it (0-based) and its length. */
  combo: number;
  k: number;
  size: number;
  /** Pad: hit radius in arm lengths. */
  rA: number;
  move?: MoveId;
  hand?: Side;
  ax: number;
  ay: number;
  /** Bag: what to do, and the side it swings in from. */
  need?: BagNeed;
  swing?: Side;
}

interface LevelCfg {
  bpm: [number, number];
  /** Pads in a combination: from the start to the end of the run. */
  size: [number, number];
  /** Beats of rest between combinations. */
  gap: number;
  /** Chance that what comes next is a bag, not a combination. */
  bag: number;
  /** Hit radius in arm lengths and the speed a punch needs (arm lengths a second). */
  radius: number;
  minSpeed: number;
  library: MoveId[][];
}

const L1: MoveId[][] = [['jab'], ['cross'], ['jab', 'cross'], ['cross', 'jab']];
const L2: MoveId[][] = [...L1, ['jab', 'jab', 'cross'], ['jab', 'cross', 'hookL'], ['cross', 'hookL', 'cross'], ['jab', 'cross', 'jab']];
const L3: MoveId[][] = [...L2, ['jab', 'cross', 'hookL', 'cross'], ['jab', 'cross', 'upperL', 'hookR'], ['hookL', 'cross', 'hookL', 'cross']];
const L4: MoveId[][] = [...L3, ['jab', 'cross', 'hookL', 'cross', 'upperL', 'hookR'], ['jab', 'jab', 'cross', 'hookL', 'upperR'], ['jab', 'cross', 'hookL', 'hookR', 'upperL', 'cross']];

export const PAD_LEVELS: Record<'easy' | 'normal' | 'hard' | 'expert', LevelCfg> = {
  easy: { bpm: [80, 92], size: [1, 2], gap: 4, bag: 0, radius: 0.24, minSpeed: 1.2, library: L1 },
  normal: { bpm: [92, 108], size: [2, 3], gap: 3, bag: 0.12, radius: 0.2, minSpeed: 1.5, library: L2 },
  hard: { bpm: [108, 128], size: [3, 4], gap: 2, bag: 0.22, radius: 0.19, minSpeed: 1.5, library: L3 },
  expert: { bpm: [124, 148], size: [4, 6], gap: 2, bag: 0.3, radius: 0.18, minSpeed: 1.5, library: L4 },
};

/** Window around the beat in which a pad is judged (ms before, ms after). After the beat a late punch still lands. */
export const PAD_WINDOW = { pre: 260, post: 420 } as const;
/** A bag's judging window around its swing. */
export const BAG_WINDOW = { pre: 250, post: 380 } as const;
/** Pads appear this many beats before the first beat of their combination. */
export const LEAD_BEATS = 1.7;
/** The lean (shoulder widths) and the hip drop (T) that count as slipping and ducking. */
export const SLIP_LEAN = 0.3;
export const DUCK_DROP = 0.35;

export const PAD_POINTS = { perfect: 100, good: 60, off: 25, power: 20, combo: 50, bag: 80 } as const;
/** The multiplier grows by one every this many pads on the beat, up to 4. */
export const PAD_STREAK_STEP = 6;

export function planPads(rng: Rng, p: PlanInput): PadSpec[] {
  const cfg = PAD_LEVELS[p.level];
  const tl = p.timeline;
  const f = slowFactor(p.hz) * (p.seated ? 1.1 : 1);
  const specs: PadSpec[] = [];
  let combo = 0;
  for (const seg of tl.segments) {
    if (seg.kind !== 'play') continue;
    const bpm = lerp(cfg.bpm[0], cfg.bpm[1], tl.rounds > 1 ? seg.round / (tl.rounds - 1) : 0.5) / (p.seated ? 1.08 : 1);
    const per = 60000 / bpm;
    let beat = seg.start + 2600;
    let lastBag = true;
    for (;;) {
      const rBag = rng(), rMirror = rng(), rPick = rng(), rSide = rng();
      const inten = intensityAt(tl, beat);
      if (cfg.bag > 0 && !p.keyboard && !lastBag && rBag < cfg.bag) {
        if (beat + BAG_WINDOW.post * f > seg.end - 300) break;
        const duck = !p.seated && rPick < 0.4;
        const swing: Side = rSide < 0.5 ? 'L' : 'R';
        const need: BagNeed = duck ? 'duck' : swing === 'L' ? 'slipR' : 'slipL';
        const from = ms(beat - BAG_WINDOW.pre * f), until = ms(beat + BAG_WINDOW.post * f);
        const at = ms(beat - 2 * per);
        specs.push({ id: specs.length, at, life: until - at, kind: 'bag', beat: ms(beat), from, until, combo, k: 0, size: 1, rA: 0, ax: swing === 'L' ? -0.9 : 0.9, ay: 0.35, need, swing });
        combo++;
        beat += 3 * per;
        lastBag = true;
        continue;
      }
      const cap = Math.round(lerp(cfg.size[0], cfg.size[1], inten));
      const near = cfg.library.filter((c) => c.length <= cap && c.length >= Math.max(1, cap - 1));
      const pool = near.length ? near : cfg.library.filter((c) => c.length <= cap);
      const base = pool.length ? pool : cfg.library;
      const moves = base[Math.min(base.length - 1, Math.floor(rPick * base.length))] as MoveId[];
      const mirror = rMirror < 0.5;
      const size = moves.length;
      const last = beat + (size - 1) * per;
      if (last + PAD_WINDOW.post * f > seg.end - 300) break;
      const at = ms(beat - LEAD_BEATS * per);
      moves.forEach((m0, k) => {
        const m = mirror ? MIRROR[m0] : m0;
        const d = MOVES[m];
        const b = beat + k * per;
        const from = ms(b - PAD_WINDOW.pre * f), until = ms(b + PAD_WINDOW.post * f);
        specs.push({ id: specs.length, at, life: until - at, kind: 'pad', beat: ms(b), from, until, combo, k, size, rA: cfg.radius, move: m, hand: d.hand, ax: d.ax, ay: d.ay });
      });
      combo++;
      beat = last + (cfg.gap + 1) * per;
      lastBag = false;
    }
  }
  return specs;
}

const key = (c: number, what: 'g' | 'r'): string => `${what}${c}`;

function padPoint(spec: PadSpec, lane: LaneApi): { x: number; y: number } {
  const k = lane.seated ? SEATED_SCALE : 1;
  if (lane.ch['body.sx'] !== undefined && lane.ch['body.sy'] !== undefined) return fit(lane.env, padAt(lane.ch, spec.ax * k, spec.ay * k));
  return spot(lane.env, spec.ax, spec.ay);
}

export const padWorkRules: Rules<PadSpec> = {
  id: 'pad-work',
  rounds: 3,
  restSec: 30,
  met: 5.5,
  clears: true,

  plan: planPads,

  open(spec: PadSpec, lane: LaneApi): Live {
    if (spec.kind === 'bag') {
      // A bag is not hit: it is judged by the player's lean and duck while it swings. The judge gets a target nobody can reach.
      return { id: spec.id, born: lane.t, x: 99, y: 99, r: 0.01, v: { good: 0, bad: 0, drop: 0 }, crit: { id: spec.id, x: 99, y: 99, r: 0.01, limb: 'hand', shownAt: lane.poseNow() } };
    }
    const p = padPoint(spec, lane);
    const r = spec.rA * lane.env.arm;
    return {
      id: spec.id, born: lane.t, x: p.x, y: p.y, r, v: {},
      crit: { id: spec.id, x: p.x, y: p.y, r, limb: 'hand', ...(spec.hand ? { side: spec.hand } : {}), minSpeed: PAD_LEVELS[lane.level].minSpeed, shownAt: lane.poseNow() },
    };
  },

  follow(spec: PadSpec, live: Live, lane: LaneApi): void {
    if (spec.kind === 'pad') {
      const p = padPoint(spec, lane);
      live.x = p.x; live.y = p.y; live.crit.x = p.x; live.crit.y = p.y;
      return;
    }
    if (lane.t < spec.from || lane.t >= spec.until) return;
    const lean = lane.ch['lean'] ?? 0, drop = lane.ch['drop'] ?? 0;
    // `lean` is positive toward the player's right. A bag swinging in from the left is slipped by leaning right.
    const away = spec.need === 'slipR' ? lean : spec.need === 'slipL' ? -lean : 0;
    live.v['good'] = Math.max(live.v['good'] ?? 0, away);
    live.v['bad'] = Math.max(live.v['bad'] ?? 0, -away);
    live.v['drop'] = Math.max(live.v['drop'] ?? 0, drop);
  },

  span: (spec) => ({ from: spec.from, until: spec.until }),

  hit(spec: PadSpec, live: Live, j: HitJudgement, lane: LaneApi, out: Out): void {
    const s = lane.stats;
    const off = lane.t - lane.latencyMs - spec.beat;
    const grade = gradeOffset(off, BEAT_WINDOWS);
    const onBeat = grade !== 'miss';
    const mult = 1 + Math.min(3, Math.floor(s.streak / PAD_STREAK_STEP));
    const base = grade === 'perfect' ? PAD_POINTS.perfect : grade === 'good' ? PAD_POINTS.good : PAD_POINTS.off;
    const power = clamp(Math.round((j.speed - PAD_LEVELS[lane.level].minSpeed) * 6), 0, PAD_POINTS.power);
    const pts = (base + power) * mult;
    s.score += pts;
    s.hits++;
    if (grade === 'perfect') s.perfect++; else if (grade === 'good') s.good++; else s.off++;
    if (onBeat) { s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); lane.x[key(spec.combo, 'g')] = (lane.x[key(spec.combo, 'g')] ?? 0) + 1; } else s.streak = 0;
    out.event({ type: 'hit', kind: 'pad', id: spec.id, combo: spec.combo, k: spec.k, x: live.x, y: live.y, pts, grade: onBeat ? grade : off < 0 ? 'early' : 'late', off: Math.round(off), mult, speed: Math.round(j.speed * 10) / 10, side: j.side });
    out.log('pad', true, pts);
    out.cue(grade === 'perfect' ? 'perfect' : grade === 'good' ? 'good' : 'late');
    out.cue('pad');
    if (!onBeat) out.hint(off < 0 ? 'early' : 'late', { n: Math.round(off), ms: 1600 });
    settled(spec, lane, out);
  },

  expire(spec: PadSpec, live: Live, miss: Miss | null, lane: LaneApi, out: Out): void {
    const s = lane.stats;
    if (spec.kind === 'bag') {
      const good = live.v['good'] ?? 0, bad = live.v['bad'] ?? 0, drop = live.v['drop'] ?? 0;
      const ok = spec.need === 'duck' ? drop >= DUCK_DROP : good >= SLIP_LEAN;
      if (ok) {
        const mult = 1 + Math.min(3, Math.floor(s.streak / PAD_STREAK_STEP));
        const pts = PAD_POINTS.bag * mult;
        s.score += pts; s.hits++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
        out.event({ type: 'hit', kind: 'bag', id: spec.id, need: spec.need, swing: spec.swing, x: 0, y: 0, pts, grade: 'good', mult });
        out.log('bag', true, pts);
        out.cue('good');
      } else {
        const code = spec.need === 'duck' ? 'hips_not_low' : bad >= SLIP_LEAN ? 'wrong_direction' : 'bend_more';
        s.misses++; s.streak = 0;
        out.event({ type: 'miss', kind: 'bag', id: spec.id, need: spec.need, swing: spec.swing, x: 0, y: 0, code });
        out.log(code, false);
        out.hint(code);
        out.cue('miss');
      }
      return;
    }
    const code = missCode(miss);
    s.misses++;
    s.streak = 0;
    out.event({ type: 'miss', kind: 'pad', id: spec.id, combo: spec.combo, k: spec.k, x: live.x, y: live.y, code });
    out.log(code, false);
    out.hint(code, { ...(spec.hand ? { side: spec.hand } : {}) });
    out.cue('miss');
    settled(spec, lane, out);
  },

  tick(lane: LaneApi, plan: readonly PadSpec[], out: Out): void {
    // The beat is ticked once, by the first player's lane, whether or not the pad was hit early: the plan is in order of beat.
    if (lane.slot !== 1) return;
    let i = lane.x['tick'] ?? 0;
    let last = lane.x['tickBeat'] ?? -1;
    while (i < plan.length && (plan[i] as PadSpec).beat <= lane.t + 8) {
      const spec = plan[i++] as PadSpec;
      if (spec.kind === 'pad' && spec.beat > last) { last = spec.beat; out.cue('tick'); }
    }
    lane.x['tick'] = i;
    lane.x['tickBeat'] = last;
  },

  prompt(lane: LaneApi, plan: readonly PadSpec[]): Prompt | null {
    let bag: PadSpec | null = null;
    let first: PadSpec | null = null;
    for (const live of lane.state.live) {
      const spec = plan[live.id] as PadSpec;
      if (spec.kind === 'bag') { if (lane.t >= spec.beat - 700 && (!bag || spec.beat < bag.beat)) bag = spec; }
      else if (!first || spec.combo < first.combo || (spec.combo === first.combo && spec.k < first.k)) first = spec;
    }
    if (bag) return { key: bag.need === 'duck' ? 'duck' : bag.need === 'slipL' ? 'slip_left' : 'slip_right', icon: bag.need === 'duck' ? 'squat' : 'leanLeft' };
    if (first) return { key: 'combo', vars: { seq: Array.from({ length: first.size }, (_, i) => String(i + 1)).join('-') }, icon: 'punch' };
    if (lane.t - lane.seg.start < 2400) return { key: 'round', vars: { n: lane.seg.round + 1 }, icon: 'punch' };
    return null;
  },
};

/** A pad has been hit or has gone by: when the whole combination is settled, one landed on the beat throughout pays a bonus. */
function settled(spec: PadSpec, lane: LaneApi, out: Out): void {
  const r = (lane.x[key(spec.combo, 'r')] ?? 0) + 1;
  lane.x[key(spec.combo, 'r')] = r;
  if (r < spec.size) return;
  const clean = lane.x[key(spec.combo, 'g')] ?? 0;
  delete lane.x[key(spec.combo, 'r')];
  delete lane.x[key(spec.combo, 'g')];
  if (clean < spec.size || spec.size < 2) return;
  lane.stats.score += PAD_POINTS.combo * spec.size;
  lane.stats.cleared++;
  out.event({ type: 'combo', combo: spec.combo, size: spec.size, pts: PAD_POINTS.combo * spec.size });
  out.log('combo', true, PAD_POINTS.combo * spec.size);
  out.cue('rep-best');
}
