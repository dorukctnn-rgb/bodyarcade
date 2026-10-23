// M7 swipe trace (game-design.md 0.5; card 9 Slice Storm) and the joined-hands sword (card 10 Saber Guard).
//
// 1. `createSwipeDetector` (id 'swipe') publishes, for each hand, the last `windowMs` (150 ms) of its path as a line
//    segment and says whether it is fast enough to be a swipe (`minSpeed`, 2.0 arm lengths per second). Positions are
//    body space (types/body.ts: T, +y up); speeds are in A per second.
//      swipe.L.x0, swipe.L.y0, swipe.L.x1, swipe.L.y1   the segment, from where the hand was to where it is, T
//      swipe.L.dir                                       its direction, degrees (0 = screen right, 90 = up)
//      swipe.L.speed, swipe.L.on                         A per second, and 1 when it is at least `minSpeed`
//      swipe.L.id                                        counts the strokes of that hand (a stroke is one run of "on")
//      swipe.L.seen                                      1 while the hand is in view (also R); swipe.t = frame time
//    A stroke that starts is a 'hit' event (side, value = direction in degrees, q.speed = A per second).
//    With `saber: 1` the hands joined (at most `handsTogether` W apart) are a sword: saber.on, saber.angle (blade
//    direction, from the elbows through the hands), saber.x / saber.y (the tip, `bladeLen` A beyond the hands),
//    saber.cx / saber.cy (the hands' middle), saber.travel (how far the middle moved in the last `cutMs`, A). A cut
//    ('hit' event without a side, value = direction) is the middle moving at least `cutTravel` (0.9) A within `cutMs`
//    (350 ms) with the hands joined.
// 2. `SwipeTester` for the game's step: objects (a circle, optionally an arrow direction) are cut by a swipe segment
//    that crosses the circle at the required speed; a stroke that cuts several objects counts them as a combo.
//    `bladeBlocks` judges a Saber Guard block from the channels.
// Misses: too_slow (the hand crossed the object but not fast enough), wrong_direction (against the arrow), not_reached,
// hands_apart (the sword needs the hands joined), hands_out_of_view.
import type { DetectorFactory, Features, MovementEvent, Side } from '../types/index.ts';
import { PersonGate, SIDES, Track, Visibility, angleDiff, angleOf, dist, ev, flag, len, mid, scalesOf, sub, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const SWIPE_DEFAULTS = {
  windowMs: 150,        // M7
  minSpeed: 2.0,        // A per second (M7)
  saber: 0,
  handsTogether: 0.35,  // W (card 10)
  cutTravel: 0.9,       // A (card 10)
  cutMs: 350,           // (card 10)
  bladeLen: 1.0,        // A (card 10)
  cutRefractoryMs: 400,
  graceMs: 250,
  lostMs: 600,
} as const;

export const createSwipeDetector: DetectorFactory = (p, opts): ExplainingDetector => {
  const o = withDefaults(SWIPE_DEFAULTS, opts);
  const saber = flag(opts, 'saber', o.saber !== 0);
  const { a, w } = scalesOf(p);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const hands = [new Track(600), new Track(600)] as const;
  const middle = new Track(600);
  const was: [boolean, boolean] = [false, false];
  const strokes: [number, number] = [0, 0];
  let ch: Record<string, number> = {};
  let fastest = 0, lastCutT = -Infinity, wasCut = false, nowT = 0, any = false;
  let miss: (Miss & { t: number }) | null = null;

  return {
    id: 'swipe',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { hands[0].clear(); hands[1].clear(); middle.clear(); was[0] = was[1] = false; wasCut = false; ch = {}; fastest = 0; return out; }
      if (g !== 'ok') return out;
      const seen = vis.seen('hands', f.t, o.graceMs);
      const c: Record<string, number> = { 'swipe.t': f.t, 'body.a': a };
      fastest = 0;
      for (const i of [0, 1] as const) {
        const s = SIDES[i], h = f.hand[i];
        hands[i].push(f.t, h);
        const seg = seen ? hands[i].segment(o.windowMs) : null;
        let speed = 0, dir = 0, on = false;
        if (seg && seg.ms > 0) {
          const v = sub(seg.to, seg.from);
          speed = len(v) / (seg.ms / 1000) / a;
          dir = len(v) > 1e-9 ? angleOf(v) : 0;
          on = speed >= o.minSpeed;
          c[`swipe.${s}.x0`] = seg.from.x; c[`swipe.${s}.y0`] = seg.from.y; c[`swipe.${s}.x1`] = seg.to.x; c[`swipe.${s}.y1`] = seg.to.y;
        } else { c[`swipe.${s}.x0`] = h.x; c[`swipe.${s}.y0`] = h.y; c[`swipe.${s}.x1`] = h.x; c[`swipe.${s}.y1`] = h.y; }
        if (on && !was[i]) { strokes[i]++; out.push(ev('swipe', 'hit', f.t, { side: s, value: dir, q: { speed } })); }
        was[i] = on;
        fastest = Math.max(fastest, speed);
        c[`swipe.${s}.dir`] = dir; c[`swipe.${s}.speed`] = speed; c[`swipe.${s}.on`] = on ? 1 : 0; c[`swipe.${s}.id`] = strokes[i]; c[`swipe.${s}.seen`] = seen ? 1 : 0;
      }
      if (saber) {
        const mid2 = mid(f.hand[0], f.hand[1]);
        middle.push(f.t, mid2);
        const together = seen && dist(f.hand[0], f.hand[1]) / w <= o.handsTogether;
        const elbows = mid(f.elbow[0], f.elbow[1]);
        const blade = sub(mid2, elbows);
        const bladeOk = together && len(blade) > 0.2 && vis.seen('elbows', f.t, o.graceMs);
        const unit = len(blade) > 1e-9 ? { x: blade.x / len(blade), y: blade.y / len(blade) } : { x: 0, y: 1 };
        const seg = middle.segment(o.cutMs);
        const travel = seg ? len(sub(seg.to, seg.from)) / a : 0;
        c['saber.on'] = bladeOk ? 1 : 0; c['saber.angle'] = angleOf(unit);
        c['saber.cx'] = mid2.x; c['saber.cy'] = mid2.y;
        c['saber.x'] = mid2.x + unit.x * o.bladeLen * a; c['saber.y'] = mid2.y + unit.y * o.bladeLen * a;
        c['saber.travel'] = bladeOk ? travel : 0;
        const cutting = bladeOk && travel >= o.cutTravel;
        if (cutting && !wasCut && f.t - lastCutT >= o.cutRefractoryMs && seg) {
          lastCutT = f.t;
          out.push(ev('swipe', 'hit', f.t, { value: angleOf(sub(seg.to, seg.from)), q: { range: travel, speed: travel / (Math.max(seg.ms, 1) / 1000) } }));
        } else if (seen && !together && travel >= o.cutTravel) {
          miss = { code: 'hands_apart', got: dist(f.hand[0], f.hand[1]) / w, need: o.handsTogether, t: f.t };
        }
        wasCut = cutting;
      }
      ch = c;
      return out;
    },
    value: () => (any && Object.keys(ch).length ? fastest : undefined),
    channels: () => ch,
    explain(windowMs = 2000): Miss | null {
      if (!any || !Object.keys(ch).length) return null;
      if (vis.unseenFor('hands', nowT) > 500) return { code: 'hands_out_of_view' };
      const m = miss as (Miss & { t: number }) | null;
      if (m && nowT - m.t <= windowMs) { const { t: _t, ...rest } = m; return rest; }
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); hands[0].clear(); hands[1].clear(); middle.clear(); was[0] = was[1] = false; strokes[0] = strokes[1] = 0;
      ch = {}; fastest = 0; lastCutT = -Infinity; wasCut = false; nowT = 0; any = false; miss = null;
    },
  } satisfies ExplainingDetector;
};

// ───────── the game's side ─────────

export interface SwipeObject {
  id: number;
  /** Centre in body space, T. */
  x: number;
  y: number;
  /** Radius, T. */
  r: number;
  /** An arrow: the swipe must go this way (degrees, 0 = screen right, 90 = up) within `dirTol`. */
  dir?: number;
}

export interface SwipeCut {
  kind: 'cut';
  id: number;
  side: Side;
  t: number;
  /** Direction and speed of the segment that cut it. */
  dir: number;
  speed: number;
  /** The stroke it belongs to (per hand), and how many objects that stroke has cut so far, this one included. */
  stroke: number;
  combo: number;
}

/** Shortest distance from a point to the segment (T). */
export function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
}

interface ObjectState { closest: number; slowest: number; fastSeen: boolean; dirErr: number; frames: number; done: boolean }

export class SwipeTester {
  private objects = new Map<number, ObjectState>();
  private combos = new Map<string, number>();
  private lastT = -Infinity;
  private readonly minSpeed: number;
  private readonly dirTol: number;

  constructor(o: { minSpeed?: number; dirTol?: number } = {}) {
    this.minSpeed = o.minSpeed ?? SWIPE_DEFAULTS.minSpeed;
    this.dirTol = o.dirTol ?? 35;
  }

  private state(id: number): ObjectState {
    let s = this.objects.get(id);
    if (!s) {
      if (this.objects.size >= 256) this.objects.delete(this.objects.keys().next().value as number);
      s = { closest: Infinity, slowest: 0, fastSeen: false, dirErr: Infinity, frames: 0, done: false };
      this.objects.set(id, s);
    }
    return s;
  }

  update(ch: Readonly<Record<string, number>>, objects: readonly SwipeObject[]): SwipeCut[] {
    const t = ch['swipe.t'];
    if (t === undefined || t === this.lastT) return [];
    this.lastT = t;
    const out: SwipeCut[] = [];
    for (const ob of objects) {
      const st = this.state(ob.id);
      if (st.done) continue;
      for (const side of SIDES) {
        if (ch[`swipe.${side}.seen`] !== 1) continue;
        st.frames++;
        const d = distToSegment(ob.x, ob.y, ch[`swipe.${side}.x0`] ?? 0, ch[`swipe.${side}.y0`] ?? 0, ch[`swipe.${side}.x1`] ?? 0, ch[`swipe.${side}.y1`] ?? 0);
        st.closest = Math.min(st.closest, d);
        if (d > ob.r) continue;
        const speed = ch[`swipe.${side}.speed`] ?? 0, dir = ch[`swipe.${side}.dir`] ?? 0;
        if (speed < this.minSpeed) { st.slowest = Math.max(st.slowest, speed); continue; }
        st.fastSeen = true;
        if (ob.dir !== undefined) {
          const err = angleDiff(dir, ob.dir);
          st.dirErr = Math.min(st.dirErr, err);
          if (err > this.dirTol) continue;
        }
        st.done = true;
        const stroke = ch[`swipe.${side}.id`] ?? 0;
        const key = `${side}${stroke}`;
        const combo = (this.combos.get(key) ?? 0) + 1;
        this.combos.set(key, combo);
        if (this.combos.size > 64) this.combos.delete(this.combos.keys().next().value as string);
        out.push({ kind: 'cut', id: ob.id, side, t, dir, speed, stroke, combo });
        break;
      }
    }
    return out;
  }

  /** Why the object was not cut (call it when it leaves the game); null when it was cut or nothing is known. */
  explain(ob: SwipeObject): Miss | null {
    const st = this.objects.get(ob.id);
    if (!st || st.done) return null;
    if (st.frames === 0) return { code: 'hands_out_of_view', target: ob.id };
    if (st.fastSeen && ob.dir !== undefined && st.dirErr > this.dirTol) return { code: 'wrong_direction', got: st.dirErr, need: this.dirTol, target: ob.id };
    if (st.slowest > 0) return { code: 'too_slow', got: st.slowest, need: this.minSpeed, target: ob.id };
    return { code: 'not_reached', ...(Number.isFinite(st.closest) ? { got: st.closest } : {}), need: ob.r, target: ob.id };
  }

  forget(id: number): void { this.objects.delete(id); }
  reset(): void { this.objects.clear(); this.combos.clear(); this.lastT = -Infinity; }
}

// ───────── Saber Guard blocks ─────────

export interface BladeTarget {
  /** The blade line the block asks for, degrees (a line: 45 and 225 are the same block). */
  angle: number;
  /** The zone the hands' middle must be in: centre (T) and radius (T). */
  x: number;
  y: number;
  r: number;
  /** Default 25 degrees (card 10). */
  tol?: number;
}

export interface BlockFit { ok: boolean; angleError: number; zoneError: number; miss: Miss | null }

/** Is the sword where the block asks for it? Reads the `saber.*` channels of the swipe detector run with `saber: 1`. */
export function bladeBlocks(ch: Readonly<Record<string, number>>, target: BladeTarget): BlockFit {
  const tol = target.tol ?? 25;
  const angle = ch['saber.angle'] ?? 0;
  const off = angleDiff(angle, target.angle);
  const angleError = Math.min(off, 180 - off);          // a blade is a line: the tip may point either way along it
  const zoneError = Math.hypot((ch['saber.cx'] ?? 0) - target.x, (ch['saber.cy'] ?? 0) - target.y);
  if (ch['saber.on'] !== 1) return { ok: false, angleError, zoneError, miss: { code: 'hands_apart' } };
  if (zoneError > target.r) return { ok: false, angleError, zoneError, miss: { code: 'not_reached', got: zoneError, need: target.r } };
  if (angleError > tol) return { ok: false, angleError, zoneError, miss: { code: 'limb_off', limb: 'blade', got: angleError, need: tol } };
  return { ok: true, angleError, zoneError, miss: null };
}
