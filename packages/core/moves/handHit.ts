// M6 hand and foot target contact (game-design.md 0.5; cards 7 Pad Work, 8 Star Catch, 27 Reaction Tag).
//
// Targets are game state (stars, pads, lights appear and expire), and a detector is built from numbers only, so M6 is
// split in two:
//
// 1. `createHandHitDetector` (id 'handHit') publishes the kinematics of the hands, and with `feet: 1` of the feet, as
//    channels. It never emits events. Positions are body space (types/body.ts: origin at the rest hip midpoint, unit
//    T, +x = the player's right as seen in the mirror, +y = up); speeds are in A per second (arm lengths, the unit of
//    the cards), measured over `speedWindowMs`.
//      hand.L.x, hand.L.y        hand centre, T
//      hand.L.vx, hand.L.vy      velocity, A per second
//      hand.L.speed              |velocity|, A per second
//      hand.L.rx, hand.L.ry      hand relative to the shoulder midpoint, in A (Pad Work pads live in this frame)
//      hand.L.seen               1 while the hand has been seen within the grace period
//      foot.L.x, foot.L.y, foot.L.vx, foot.L.vy, foot.L.speed, foot.L.seen   the same for the foot (mean of ankle and toe)
//      foot.L.floor              ankle height above the standing floor line, T (0 on the floor, about 0.3 or more in a tap)
//      (the same with R), plus body.sx, body.sy (shoulder midpoint, T), body.a (arm length A in T), body.w (W in T),
//      drop (hip drop D, T), hit.t (time of the pose frame these values belong to)
//    `value()` is the faster hand's speed.
//
// 2. `HitTester`, a small pure class a game's step uses: it reads those channels (an InputFrame's `channels`), judges
//    the game's targets and says why a target was missed. It keeps no clock of its own: time is `hit.t`, so a fixed
//    game step that sees the same pose frame twice changes nothing, and a trace replays to the same hits.
//      Star Catch   dwellMs 60, radius 0.15 to 0.2 T, side = the star colour's hand; low stars needDrop 0.3
//      Pad Work     minSpeed 1.5 (A/s) with the radius 0.2 A (use `padAt`), side = the pad's hand
//      Reaction Tag radius 0.15 T for hands, 0.35 W for feet with floorOnly; reactMs from shownAt
//    Misses (`explain(id)`): wrong_hand, too_slow, too_brief, foot_not_down, grab_higher, not_reached, hands_out_of_view.
import type { BodyProfile, DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, SIDES, Series, Track, Visibility, len, scalesOf, withDefaults, flag, type ExplainingDetector, type Miss } from './kit.ts';

export const HAND_HIT_DEFAULTS = {
  feet: 0,            // 1: publish the feet as well
  speedWindowMs: 120, // Pad Work (card 7)
  graceMs: 250,       // a hand blurred for one frame is still seen
  floorWindowMs: 5000,
  lostMs: 600,
} as const;

/** A foot with its ankle this close to the floor line (T) is on the floor (card 27: 0.15 T). */
export const FLOOR_TOUCH = 0.15;

export const createHandHitDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(HAND_HIT_DEFAULTS, opts);
  const withFeet = flag(opts, 'feet', o.feet !== 0);
  const { a, w } = scalesOf(p);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const hands = [new Track(500), new Track(500)] as const;
  const feet = [new Track(500), new Track(500)] as const;
  const lowAnkle = new Series(o.floorWindowMs);
  let ch: Record<string, number> = {};
  let fastest = 0;
  let nowT = 0;
  let any = false;

  function limb(name: 'hand' | 'foot', i: 0 | 1, tr: Track, pos: { x: number; y: number }, seen: boolean, t: number, rel: { x: number; y: number } | null, out: Record<string, number>): number {
    const s = SIDES[i];
    tr.push(t, pos);
    const v = tr.velocity(o.speedWindowMs);
    const speed = len(v) / a;
    out[`${name}.${s}.x`] = pos.x; out[`${name}.${s}.y`] = pos.y;
    out[`${name}.${s}.vx`] = v.x / a; out[`${name}.${s}.vy`] = v.y / a;
    out[`${name}.${s}.speed`] = speed;
    out[`${name}.${s}.seen`] = seen ? 1 : 0;
    if (rel) { out[`${name}.${s}.rx`] = rel.x / a; out[`${name}.${s}.ry`] = rel.y / a; }
    return seen ? speed : 0;
  }

  return {
    id: 'handHit',
    push(f: Features): MovementEvent[] {
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { hands[0].clear(); hands[1].clear(); feet[0].clear(); feet[1].clear(); lowAnkle.clear(); fastest = 0; ch = {}; return []; }
      if (g !== 'ok') return [];
      const out: Record<string, number> = { 'hit.t': f.t, drop: f.drop, 'body.sx': f.shoulder.x, 'body.sy': f.shoulder.y, 'body.a': a, 'body.w': w };
      const handsSeen = vis.seen('hands', f.t, o.graceMs);
      fastest = 0;
      for (const i of [0, 1] as const) {
        const h = f.hand[i];
        fastest = Math.max(fastest, limb('hand', i, hands[i], h, handsSeen, f.t, { x: h.x - f.shoulder.x, y: h.y - f.shoulder.y }, out));
      }
      if (withFeet) {
        const feetSeen = vis.seen('ankles', f.t, o.graceMs);
        // The floor line is the lowest ankle in the last seconds: the standing foot. A jump or a tap does not move it.
        if (feetSeen) lowAnkle.push(f.t, Math.min(f.ankle[0].y, f.ankle[1].y));
        const floor = lowAnkle.min() ?? 0;
        for (const i of [0, 1] as const) {
          limb('foot', i, feet[i], f.foot[i], feetSeen, f.t, null, out);
          out[`foot.${SIDES[i]}.floor`] = Math.max(0, f.ankle[i].y - floor);
        }
      }
      ch = out;
      return [];
    },
    value: () => (any ? fastest : undefined),
    channels: () => ch,
    explain(): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      if (withFeet && vis.unseenFor('ankles', nowT) > 500) return { code: 'feet_out_of_view' };
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); for (const t of [...hands, ...feet]) t.clear(); lowAnkle.clear();
      ch = {}; fastest = 0; nowT = 0; any = false;
    },
  } satisfies ExplainingDetector;
};

// ───────── the game's side: judging targets ─────────

export interface HitTarget {
  id: number;
  /** Centre in body space (T). Pads given in A relative to the shoulders: `padAt`. */
  x: number;
  y: number;
  /** Radius in T (0.35 W for feet: `0.35 * channels['body.w']`). */
  r: number;
  /** Default 'hand'. */
  limb?: 'hand' | 'foot';
  /** The hand or foot that must do it; omitted: either. */
  side?: Side;
  /** Contact time needed, ms (Star Catch 60). Default 0: the first frame inside counts (Reaction Tag). */
  dwellMs?: number;
  /** Speed needed while inside, A per second (Pad Work 1.5). Default 0. */
  minSpeed?: number;
  /** Hip drop D the player must reach for a full hit (low stars 0.3); under it the hit is `partial`. */
  needDrop?: number;
  /** Feet only: the ankle must be on the floor line (Reaction Tag floor taps). */
  floorOnly?: boolean;
  /** Pose-frame time the target appeared (the `hit.t` of that frame), for the reaction time. */
  shownAt?: number;
}

export interface HitJudgement {
  kind: 'hit';
  id: number;
  side: Side;
  limb: 'hand' | 'foot';
  /** Pose-frame time at which the hit was decided. */
  t: number;
  /** Distance from the target centre, T. */
  dist: number;
  /** Speed of the limb at that moment, A per second. */
  speed: number;
  /** First contact time minus appearance minus the system latency, ms (only with `shownAt`). */
  reactMs?: number;
  /** The player did not reach the depth the target asked for: half points and a form note (card 8). */
  partial: boolean;
}

/** A pad given in arm lengths from the shoulder midpoint (card 7), as a body space point. */
export function padAt(channels: Readonly<Record<string, number>>, ax: number, ay: number): { x: number; y: number } {
  return { x: (channels['body.sx'] ?? 0) + ax * (channels['body.a'] ?? 1.15), y: (channels['body.sy'] ?? 1) + ay * (channels['body.a'] ?? 1.15) };
}

/** Where a player can reach (body space, T), from the profile: overhead from the calibrated hands-up height. */
export function reachEnvelope(p: BodyProfile): { up: number; side: number; shoulderY: number; arm: number } {
  const { a, w } = scalesOf(p);
  const up = p.reachY !== undefined ? (p.rest.hipY - p.reachY) / Math.max(p.T, 1e-6) : 1 + a;
  return { up, side: w / 2 + a, shoulderY: 1, arm: a };
}

interface Seen {
  best: number; bestDx: number; bestDy: number;
  wrong: Side | null;
  since: Map<string, number>;
  longest: number;
  slowest: number;
  floorMin: number;
  frames: number;
  done: boolean;
}

export class HitTester {
  private readonly latencyMs: number;
  private seen = new Map<number, Seen>();
  private lastT = -Infinity;

  constructor(o: { latencyMs?: number } = {}) { this.latencyMs = o.latencyMs ?? 0; }

  private state(id: number): Seen {
    let s = this.seen.get(id);
    if (!s) {
      if (this.seen.size >= 256) this.seen.delete(this.seen.keys().next().value as number);
      s = { best: Infinity, bestDx: 0, bestDy: 0, wrong: null, since: new Map(), longest: 0, slowest: 0, floorMin: Infinity, frames: 0, done: false };
      this.seen.set(id, s);
    }
    return s;
  }

  /** One pose frame (an InputFrame's channels) against the targets in play; returns the hits decided by this frame. */
  update(ch: Readonly<Record<string, number>>, targets: readonly HitTarget[]): HitJudgement[] {
    const t = ch['hit.t'];
    if (t === undefined || t === this.lastT) return [];
    this.lastT = t;
    const out: HitJudgement[] = [];
    const drop = ch.drop ?? 0;
    for (const tg of targets) {
      const s = this.state(tg.id);
      if (s.done) continue;
      const kind = tg.limb ?? 'hand';
      for (const side of SIDES) {
        const key = `${kind}.${side}`;
        if (ch[`${key}.seen`] !== 1) { s.since.delete(key); continue; }
        s.frames++;
        const x = ch[`${key}.x`] ?? 0, y = ch[`${key}.y`] ?? 0, speed = ch[`${key}.speed`] ?? 0;
        const floor = kind === 'foot' ? ch[`${key}.floor`] ?? 0 : 0;
        const d = Math.hypot(x - tg.x, y - tg.y);
        const sideOk = tg.side === undefined || tg.side === side;
        if (sideOk && d < s.best) { s.best = d; s.bestDx = tg.x - x; s.bestDy = tg.y - y; }
        if (d > tg.r) { s.since.delete(key); continue; }
        if (!sideOk) { s.wrong = side; s.since.delete(key); continue; }
        if (tg.floorOnly && floor > FLOOR_TOUCH) { s.floorMin = Math.min(s.floorMin, floor); s.since.delete(key); continue; }
        const first = s.since.get(key) ?? t;
        s.since.set(key, first);
        s.longest = Math.max(s.longest, t - first);
        s.slowest = Math.max(s.slowest, speed);
        if ((tg.minSpeed ?? 0) > 0 && speed < (tg.minSpeed as number)) continue;
        if (t - first < (tg.dwellMs ?? 0)) continue;
        s.done = true;
        out.push({
          kind: 'hit', id: tg.id, side, limb: kind, t, dist: d, speed,
          ...(tg.shownAt !== undefined ? { reactMs: Math.max(0, first - tg.shownAt - this.latencyMs) } : {}),
          partial: (tg.needDrop ?? 0) > 0 && drop < (tg.needDrop as number),
        });
        break;
      }
    }
    return out;
  }

  /** Why target `tg` has not been hit so far (call it when the target expires); null when it was hit or nothing is known. */
  explain(tg: HitTarget): Miss | null {
    const s = this.seen.get(tg.id);
    if (!s || s.done) return null;
    const kind = tg.limb ?? 'hand';
    if (s.frames === 0) return { code: kind === 'foot' ? 'feet_out_of_view' : 'hands_out_of_view' };
    if (s.wrong !== null && s.longest === 0) return { code: 'wrong_hand', ...(tg.side ? { side: tg.side } : {}), target: tg.id };
    if ((tg.minSpeed ?? 0) > 0 && s.longest > 0 && s.slowest < (tg.minSpeed as number)) return { code: 'too_slow', got: s.slowest, need: tg.minSpeed as number, target: tg.id };
    if ((tg.dwellMs ?? 0) > 0 && s.longest > 0) return { code: 'too_brief', got: s.longest, need: tg.dwellMs as number, target: tg.id };
    if (tg.floorOnly && s.floorMin < Infinity && s.longest === 0) return { code: 'foot_not_down', got: s.floorMin, need: FLOOR_TOUCH, target: tg.id };
    if (s.best <= tg.r * 3) {
      // Close but outside: too low for a high target, or just short.
      if (tg.y >= 1.2 && s.bestDy > Math.abs(s.bestDx)) return { code: 'grab_higher', got: s.best, need: tg.r, target: tg.id };
    }
    return { code: 'not_reached', ...(Number.isFinite(s.best) ? { got: s.best } : {}), need: tg.r, target: tg.id };
  }

  /** Drops what is known about a target that has left the game. */
  forget(id: number): void { this.seen.delete(id); }

  reset(): void { this.seen.clear(); this.lastT = -Infinity; }
}
