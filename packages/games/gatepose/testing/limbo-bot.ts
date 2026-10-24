// A scripted bending player for Limbo Bend tests. It knows the gates of its lane (the plan) and produces what the side bend
// detector would give a body that leans to each tilt: the angle (bend) with the time of the pose frame (bend.t), the hips (hipShift),
// the length of the trunk (torso) and the hands against the nose (armsUp). 'perfect' is at each gate's angle 0.6 s before it
// arrives and stays until it has gone by; 'sloppy' spoils some gates in a named way (it does not bend far enough, bends to the
// wrong side, slides the hips, keeps the hands down on a tall gate, folds forward, gets there late); 'idle' stands upright.
// With `keyed` the bot gives what the keys and the swipes give instead: a lever that the keys turn (leanKey, center) and `up`.
import type { PlayerIn } from '../../_shared/frame.ts';
import { clamp, msOf, smooth } from '../../_shared/util.ts';
import type { LbGate, LbPlan } from '../limbo.ts';

export type BendBotMode = 'perfect' | 'sloppy' | 'idle';
export type Spoil = 'short' | 'wrong' | 'hips' | 'arms' | 'forward' | 'late';
export const SPOILS: readonly Spoil[] = ['short', 'wrong', 'hips', 'arms', 'forward', 'late'];

export interface LimboBotOptions {
  mode: BendBotMode;
  lane?: 0 | 1;
  /** Pose frames a second: the channels keep their last values in between (the camera is slower than the 60 steps a second). */
  poseHz?: number;
  /** Keys and swipes instead of a camera. */
  keyed?: boolean;
  /** How a gate is spoiled (sloppy mode); the default spoils every third one, in the order of SPOILS. `null` leaves it alone. */
  spoil?: (g: LbGate, n: number) => Spoil | null;
  /** The tolerance the plan was made with (the 'short' spoil falls out of it by this much more). */
  margin?: number;
  /** The player is not seen at these steps. */
  hidden?: (k: number) => boolean;
}

export interface LimboBot {
  at(k: number): PlayerIn;
  /** The gates the bot spoiled and how. */
  spoiled: ReadonlyMap<number, Spoil>;
}

interface Key { k: number; v: number }

const REACH_BEFORE = 36;       // steps before the arrival at which the body is at the angle (0.6 s)
const HOLD_AFTER = 6;          // steps after the arrival it keeps the angle

export function limboBot(plan: LbPlan, o: LimboBotOptions): LimboBot {
  const lane = o.lane ?? 0;
  const gates = plan.gates.filter((g) => g.lane === lane);
  const spoiled = new Map<number, Spoil>();
  const spoilOf = o.spoil ?? ((_g: LbGate, n: number): Spoil | null => (n % 3 === 2 ? (SPOILS[Math.floor(n / 3) % SPOILS.length] as Spoil) : null));
  const tol = plan.tol;

  /** What each gate has the body do. */
  interface Plan { g: LbGate; angle: number; reach: number; arms: boolean; hips: number; torso: number; late: boolean }
  const things: Plan[] = gates.map((g, n) => {
    const spoil = o.mode === 'sloppy' ? spoilOf(g, n) : null;
    const eff = spoil === 'arms' && !g.tall ? 'short' : spoil;
    if (eff) spoiled.set(g.id, eff);
    const sign = g.target >= 0 ? 1 : -1;
    let angle = g.target;
    let reach = g.arriveK - REACH_BEFORE;
    let arms = g.tall;
    let hips = 0;
    let torso = 1;
    switch (eff) {
      case 'short': angle = sign * Math.max(1, Math.abs(g.target) - tol - (o.margin ?? 5)); break;
      case 'wrong': angle = -g.target; break;
      case 'hips': hips = 0.55; break;
      case 'arms': arms = false; break;
      case 'forward': angle = 0; torso = 0.7; break;
      case 'late': reach = g.arriveK - 5; break;
      default: break;
    }
    return { g, angle: o.mode === 'idle' ? 0 : angle, reach, arms: arms && o.mode !== 'idle', hips, torso, late: eff === 'late' };
  });

  // the angle of the body over time: where it stays, and when it moves to the next gate (a smooth step between the keys)
  const keys: Key[] = [{ k: 0, v: 0 }];
  if (o.mode !== 'idle') {
    for (let i = 0; i < things.length; i++) {
      const t = things[i] as Plan;
      const prev = things[i - 1];
      const last = keys[keys.length - 1] as Key;
      // a long wait (a rest): go back to upright first
      if (prev && t.reach - last.k > 300) {
        keys.push({ k: last.k + 50, v: 0 });
        keys.push({ k: t.reach - 70, v: 0 });
      }
      if (t.late) {
        // upright until the last moment, then a quick lean that reaches the angle 5 steps before the gate arrives
        keys.push({ k: Math.min(last.k + 40, t.g.arriveK - 20), v: 0 });
        keys.push({ k: t.g.arriveK - 14, v: 0 });
        keys.push({ k: t.g.arriveK - 4, v: t.angle });
        keys.push({ k: t.g.arriveK + HOLD_AFTER, v: t.angle });
        continue;
      }
      keys.push({ k: Math.max(t.reach, (keys[keys.length - 1] as Key).k + 1), v: t.angle });
      keys.push({ k: t.g.arriveK + HOLD_AFTER, v: t.angle });
    }
    const tail = keys[keys.length - 1] as Key;
    keys.push({ k: tail.k + 50, v: 0 });
  }

  const thetaAt = (k: number): number => {
    if (k <= 0) return 0;
    // binary search for the key at or before k
    let a = 0, b = keys.length - 1;
    while (a < b) { const m = (a + b + 1) >> 1; if ((keys[m] as Key).k <= k) a = m; else b = m - 1; }
    const cur = keys[a] as Key;
    const next = keys[a + 1];
    if (!next) return cur.v;
    return cur.v + (next.v - cur.v) * smooth((k - cur.k) / (next.k - cur.k));
  };

  /** The thing the body is doing at k: the gate whose window k is in, or the next one coming. */
  const current = (k: number): Plan | null => {
    for (const t of things) if (k <= t.g.arriveK + HOLD_AFTER) return t;
    return null;
  };

  // the keys' lever, as the game integrates it: the bot is asked once per step, in order, and keeps the lever as the game has it
  let lever = 0;
  let leverK = 0;
  let leverKey = 0;
  const KEY_STEP = 1.1;
  const keyAt = (k: number): number => {
    while (leverK < k) {
      leverK++;
      const tt = o.mode === 'idle' ? null : current(leverK);
      const want = tt && leverK >= tt.g.arriveK - 150 ? tt.angle : 0;
      const d = want - lever;
      leverKey = Math.abs(d) > 0.6 ? Math.sign(d) : 0;
      lever = clamp(lever + leverKey * KEY_STEP, -42, 42);
    }
    return leverKey;
  };

  const poseStep = o.poseHz ? Math.max(1, Math.round(60 / o.poseHz)) : 1;

  return {
    spoiled,
    at(k: number): PlayerIn {
      if (o.hidden?.(k)) return { ok: false, ch: {}, events: [] };
      const kp = Math.floor(k / poseStep) * poseStep;
      const t = o.mode === 'idle' ? null : current(kp);
      const near = t !== null && kp >= t.g.arriveK - 150;
      if (o.keyed) {
        const ch: Record<string, number> = { leanKey: keyAt(k) };
        if (t && t.arms && near) ch['up'] = 1;
        return { ok: true, ch, events: [] };
      }
      const theta = o.mode === 'idle' ? 0 : thetaAt(kp);
      const armsRaised = !!t && t.arms && kp >= t.reach - 12 && kp <= t.g.arriveK + HOLD_AFTER;
      return {
        ok: true,
        ch: {
          bend: theta, 'bend.t': msOf(kp), rate: 0, torso: t && near ? t.torso : 1, hipShift: t && near ? t.hips : 0,
          armsUp: armsRaised ? 0.6 : -1, held: 0,
        },
        events: [],
      };
    },
  };
}
