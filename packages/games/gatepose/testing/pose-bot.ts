// A scripted posing player for Pose Wall tests. It knows the walls of its lane (the plan) and produces what the poseMatch detector would
// give a body that goes to each shape: the ten limb directions (limb.*), the time of the pose frame on the camera's own clock (pose.t,
// which does not start at the game's zero), whether the arms and the legs are in view, and the hip drop.
// 'perfect' reaches each wall's shape 0.7 s before it arrives and holds it until it has gone by, with a small wobble inside the tolerance;
// 'sloppy' spoils some walls in a named way (one limb off the shape, the shape reached too late, the hands out of view, the knees out of
// view, hips not low enough for a squat shape, a wrong shape); 'idle' stands with the arms down.
// With `keyed` the bot gives what the keys and the swipes give instead: pulses of 'next shape' and 'previous shape' that step to the
// wanted shape by the shortest way, so that the game's own picker ends on it before the wall arrives.
import { angleDiff } from '../../../core/moves/kit.ts';
import { LIMBS, type LimbAngles } from '../../../core/moves/poseMatch.ts';
import type { PlayerIn } from '../../_shared/frame.ts';
import { STAND, mixLimbs } from '../../_shared/mover.ts';
import { msOf, smooth } from '../../_shared/util.ts';
import { pickShapes } from '../posewall.ts';
import type { PwPlan, PwWall } from '../posewall.ts';
import { shapeOf } from '../pw-poses.ts';

export type PoseBotMode = 'perfect' | 'sloppy' | 'idle';
export type PoseSpoil = 'limb' | 'late' | 'hands' | 'knees' | 'low' | 'wrong';
export const POSE_SPOILS: readonly PoseSpoil[] = ['limb', 'late', 'hands', 'knees', 'low', 'wrong'];

export interface PoseBotOptions {
  mode: PoseBotMode;
  lane?: 0 | 1;
  /** Pose frames a second: the channels keep their last values in between (the camera is slower than the 60 steps a second). Default 30. */
  poseHz?: number;
  /** The camera's clock is the game's plus this many ms. */
  clockOffset?: number;
  /** Keys and swipes instead of a camera. */
  keyed?: boolean;
  /** How a wall is spoiled (sloppy mode); the default spoils every third one, in the order of POSE_SPOILS. `null` leaves it alone. */
  spoil?: (w: PwWall, n: number) => PoseSpoil | null;
  /** Degrees of wobble on every limb (a smooth function of the step); it must stay well inside the tolerance. Default 3. */
  wobble?: number;
  /** The player is not seen at these steps. */
  hidden?: (k: number) => boolean;
}

export interface SpoiledWall { kind: PoseSpoil; limb?: string }

export interface PoseBot {
  at(k: number): PlayerIn;
  /** The walls the bot spoiled and how (the kind that really happened: a spoil that cannot be done to a shape becomes 'limb'). */
  spoiled: ReadonlyMap<number, SpoiledWall>;
}

interface Key { k: number; limbs: LimbAngles; drop: number }

const REACH_BEFORE = 42;       // steps before the arrival at which the body is in the shape (0.7 s)
const HOLD_AFTER = 8;          // steps after the arrival it keeps the shape
const OFF = 14;                // degrees beyond the tolerance that a spoiled limb is off

const stand = (): LimbAngles => ({ ...STAND }) as LimbAngles;

export function poseBot(plan: PwPlan, o: PoseBotOptions): PoseBot {
  const lane = o.lane ?? 0;
  const walls = plan.walls.filter((w) => w.lane === lane);
  const spoiled = new Map<number, SpoiledWall>();
  const spoilOf = o.spoil ?? ((_w: PwWall, n: number): PoseSpoil | null => (n % 3 === 2 ? (POSE_SPOILS[Math.floor(n / 3) % POSE_SPOILS.length] as PoseSpoil) : null));
  const tol = plan.tol;
  const wobble = o.wobble ?? 3;
  const offset = o.clockOffset ?? 123_456;

  interface Plan { w: PwWall; limbs: LimbAngles; drop: number; reach: number; arms: boolean; legs: boolean; late: boolean }
  const things: Plan[] = walls.map((w, n) => {
    const shape = shapeOf(w.pose, plan.seated);
    const limbs = { ...STAND, ...shape.limbs } as LimbAngles;
    let spoil = o.mode === 'sloppy' ? spoilOf(w, n) : null;
    const hasLegs = Object.keys(shape.limbs).some((l) => l.startsWith('thigh') || l.startsWith('shin'));
    if (spoil === 'knees' && !hasLegs) spoil = 'limb';
    if (spoil === 'low' && shape.minDrop === undefined) spoil = 'limb';
    let reach = w.arriveK - REACH_BEFORE;
    let drop = shape.minDrop !== undefined ? shape.minDrop + 0.1 : 0;
    let arms = true;
    let legs = true;
    let limb: string | undefined;
    switch (spoil) {
      case 'limb': {
        const defined = Object.keys(shape.limbs).filter((l) => l.startsWith('arm') || l.startsWith('thigh') || l.startsWith('shin'));
        limb = defined[w.id % defined.length] as string;
        const key = limb as keyof LimbAngles;
        limbs[key] = limbs[key] + (w.id % 2 ? 1 : -1) * (tol + OFF);
        break;
      }
      case 'late': reach = w.arriveK - 5; break;
      case 'hands': arms = false; break;
      case 'knees': legs = false; break;
      case 'low': drop = 0.08; break;
      case 'wrong': {
        // the arms of the shape raised the other way: every arm limb is off by far more than the tolerance
        for (const l of LIMBS) if (l.startsWith('arm')) limbs[l] = limbs[l] + 120;
        break;
      }
      default: break;
    }
    if (spoil) spoiled.set(w.id, { kind: spoil, ...(limb ? { limb } : {}) });
    return o.mode === 'idle' ? { w, limbs: stand(), drop: 0, reach, arms: true, legs: true, late: false } : { w, limbs, drop, reach, arms, legs, late: spoil === 'late' };
  });

  // the body over time: where it stays, and when it moves to the next shape (a smooth step between the keys)
  const keys: Key[] = [{ k: 0, limbs: stand(), drop: 0 }];
  if (o.mode !== 'idle') {
    for (let i = 0; i < things.length; i++) {
      const t = things[i] as Plan;
      const prev = things[i - 1];
      const last = keys[keys.length - 1] as Key;
      // a long wait (a rest): back to standing first
      if (prev && t.reach - last.k > 300) {
        keys.push({ k: last.k + 50, limbs: stand(), drop: 0 });
        keys.push({ k: t.reach - 80, limbs: stand(), drop: 0 });
      }
      if (t.late) {
        // standing until the last moment, then a quick move into the shape that gets there 4 steps before the wall
        keys.push({ k: Math.max((keys[keys.length - 1] as Key).k + 1, t.w.arriveK - 18), limbs: stand(), drop: 0 });
        keys.push({ k: t.w.arriveK - 4, limbs: t.limbs, drop: t.drop });
        keys.push({ k: t.w.arriveK + HOLD_AFTER, limbs: t.limbs, drop: t.drop });
        continue;
      }
      const from = Math.max(t.reach, (keys[keys.length - 1] as Key).k + 1);
      keys.push({ k: from, limbs: t.limbs, drop: t.drop });
      keys.push({ k: t.w.arriveK + HOLD_AFTER, limbs: t.limbs, drop: t.drop });
    }
    const tail = keys[keys.length - 1] as Key;
    keys.push({ k: tail.k + 50, limbs: stand(), drop: 0 });
  }

  const bodyAt = (k: number): { limbs: LimbAngles; drop: number } => {
    if (k <= 0) return { limbs: stand(), drop: 0 };
    let a = 0, b = keys.length - 1;
    while (a < b) { const m = (a + b + 1) >> 1; if ((keys[m] as Key).k <= k) a = m; else b = m - 1; }
    const cur = keys[a] as Key;
    const next = keys[a + 1];
    if (!next) return { limbs: cur.limbs, drop: cur.drop };
    const u = smooth((k - cur.k) / (next.k - cur.k));
    return { limbs: mixLimbs(cur.limbs, next.limbs, u) as LimbAngles, drop: cur.drop + (next.drop - cur.drop) * u };
  };

  /** The wall the body is working on at k: the first whose hold has not ended, or null. */
  const current = (k: number): Plan | null => {
    for (const t of things) if (k <= t.w.arriveK + HOLD_AFTER) return t;
    return null;
  };

  // keys and swipes: a schedule of presses, made once
  const presses = new Map<number, 'pickNext' | 'pickPrev' | 'pickRest'>();
  if (o.keyed && o.mode !== 'idle') {
    const names = pickShapes(plan.level, plan.seated);
    const n = names.length;
    let at = 0;
    let have = 0;
    for (const w of walls) {
      const want = names.indexOf(w.pose);
      const forward = (want - have + n) % n;
      const back = n - forward;
      const key = forward <= back ? 'pickNext' : 'pickPrev';
      const count = forward === 0 ? 0 : Math.min(forward, back);
      let k = Math.max(at + 10, w.arriveK - 40 - count * 8);
      for (let i = 0; i < count; i++) {
        for (let d = 0; d < 3; d++) presses.set(k + d, key);
        k += 8;
      }
      at = k;
      have = want;
    }
  }

  const poseStep = o.poseHz ? Math.max(1, Math.round(60 / o.poseHz)) : 1;

  return {
    spoiled,
    at(k: number): PlayerIn {
      if (o.hidden?.(k)) return { ok: false, ch: {}, events: [] };
      if (o.keyed) {
        const press = presses.get(k);
        return { ok: true, ch: press ? { [press]: 1 } : {}, events: [] };
      }
      const kp = Math.floor(k / poseStep) * poseStep;
      const body = bodyAt(kp);
      const t = o.mode === 'idle' ? null : current(kp);
      const inWindow = !!t && kp >= t.w.arriveK - 60 && kp <= t.w.arriveK + HOLD_AFTER;
      const ch: Record<string, number> = {
        'pose.t': offset + msOf(kp), 'pose.arms': inWindow && t && !t.arms ? 0 : 1, 'pose.legs': inWindow && t && !t.legs ? 0 : 1, drop: body.drop,
      };
      LIMBS.forEach((l, i) => {
        // a smooth wobble that never leaves the tolerance, and never stays still: a real body does not
        ch[`limb.${l}`] = body.limbs[l] + Math.sin(kp * 0.11 + i * 1.7) * wobble;
      });
      return { ok: true, ch, events: [] };
    },
  };
}

/** The largest angle between two limb sets, for tests that check what the bot did. */
export function worstLimb(a: Readonly<Record<string, number>>, b: Readonly<LimbAngles>): number {
  let worst = 0;
  for (const l of LIMBS) worst = Math.max(worst, angleDiff(a[`limb.${l}`] ?? 0, b[l]));
  return worst;
}
