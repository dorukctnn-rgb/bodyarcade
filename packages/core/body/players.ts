// Stable players from unordered detections (mode 'local2'). MediaPipe returns up to two poses per frame in no fixed
// order; this keeps each body in its slot from frame to frame:
// - first assignment, and a return after both were gone: left of the mirror view = Player 1, right = Player 2;
// - afterwards identity follows each body: the pairing with the smaller distance to the predicted positions wins,
//   and when both pairings are about as good (two people close together) the previous left/right order is kept;
// - a crossing keeps identities (positions are predicted with each player's speed while one hides the other);
// - a slot without a body for `lostMs` is absent ("Player 2, step back in"); a returning body takes the free slot.
import {
  LM, type Landmark, type PlayerAssignment, type PlayerAssignmentOptions, type PlayerFrame, type PlayerPresence, type PlayerSlot,
  type PoseFrame,
} from '../types/index.ts';
import { isVisible, toView } from './geometry.ts';

export const ASSIGNMENT_DEFAULTS = { lostMs: 500, swapMarginT: 0.35 } as const;

interface Detection { lm: Landmark[]; x: number; y: number; size: number }
interface Track { x: number; y: number; vx: number; size: number; lastT: number; seen: boolean }

/**
 * Body anchor in view space (hip midpoint) and a body size for distances. Points count even when hidden or outside
 * the picture (MediaPipe places them where the body would be), so a player half out of view keeps their slot; a
 * pose with no torso point seen at all is ignored.
 */
function detect(lm: Landmark[], aspect: number): Detection | null {
  const torsoIdx = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
  if (!torsoIdx.some((i) => isVisible(lm, i, 0.2))) return null;
  const v = (i: number) => toView(lm[i] as Landmark, aspect);
  const hip = { x: (v(LM.leftHip).x + v(LM.rightHip).x) / 2, y: (v(LM.leftHip).y + v(LM.rightHip).y) / 2 };
  const sh = { x: (v(LM.leftShoulder).x + v(LM.rightShoulder).x) / 2, y: (v(LM.leftShoulder).y + v(LM.rightShoulder).y) / 2 };
  const size = Math.max(Math.abs(hip.y - sh.y), Math.abs(v(LM.leftShoulder).x - v(LM.rightShoulder).x), 0.03);
  return { lm, x: hip.x, y: hip.y, size };
}

export function createPlayerAssignment(o: PlayerAssignmentOptions = {}): PlayerAssignment {
  const lostMs = o.lostMs ?? ASSIGNMENT_DEFAULTS.lostMs;
  const swapMarginT = o.swapMarginT ?? ASSIGNMENT_DEFAULTS.swapMarginT;
  let tracks: Record<PlayerSlot, Track | null> = { 1: null, 2: null };
  let presence: Record<PlayerSlot, PlayerPresence> = { 1: { present: false, since: 0 }, 2: { present: false, since: 0 } };

  const predict = (tr: Track, t: number): number => tr.x + tr.vx * Math.min(0.4, Math.max(0, (t - tr.lastT) / 1000));
  const cost = (d: Detection, tr: Track | null, t: number): number => (tr ? Math.hypot(d.x - predict(tr, t), d.y - tr.y) / Math.max(tr.size, d.size) : 0);
  const live = (s: PlayerSlot, t: number): boolean => tracks[s] !== null && t - (tracks[s] as Track).lastT <= lostMs;

  function update(s: PlayerSlot, d: Detection, t: number): void {
    const tr = tracks[s];
    if (tr && t > tr.lastT) {
      const dt = (t - tr.lastT) / 1000;
      const v = dt > 0 && dt < 0.5 ? (d.x - tr.x) / dt : 0;
      tr.vx = tr.vx * 0.5 + v * 0.5;
      tr.x = d.x; tr.y = d.y; tr.size = tr.size * 0.8 + d.size * 0.2; tr.lastT = t;
    } else {
      tracks[s] = { x: d.x, y: d.y, vx: 0, size: d.size, lastT: t, seen: true };
    }
  }

  function assign(ds: Detection[], t: number, aspect: number): Partial<Record<PlayerSlot, Detection>> {
    const any = live(1, t) || live(2, t);
    if (ds.length === 0) return {};
    if (!any) {
      // Nobody tracked: left of the mirror view is Player 1, right is Player 2.
      if (ds.length === 1) { const d = ds[0] as Detection; return d.x < aspect / 2 ? { 1: d } : { 2: d }; }
      const [a, b] = [...ds].sort((p, q) => p.x - q.x) as [Detection, Detection];
      return { 1: a, 2: b };
    }
    if (ds.length === 1) {
      const d = ds[0] as Detection;
      const l1 = live(1, t), l2 = live(2, t);
      if (l1 && !l2) return cost(d, tracks[1], t) <= 1.5 ? { 1: d } : { 2: d };
      if (l2 && !l1) return cost(d, tracks[2], t) <= 1.5 ? { 2: d } : { 1: d };
      return cost(d, tracks[1], t) <= cost(d, tracks[2], t) ? { 1: d } : { 2: d };
    }
    const [d0, d1] = ds as [Detection, Detection];
    const t1 = live(1, t) ? tracks[1] : null, t2 = live(2, t) ? tracks[2] : null;
    if (t1 && !t2) return cost(d0, t1, t) <= cost(d1, t1, t) ? { 1: d0, 2: d1 } : { 1: d1, 2: d0 };
    if (t2 && !t1) return cost(d0, t2, t) <= cost(d1, t2, t) ? { 2: d0, 1: d1 } : { 2: d1, 1: d0 };
    const keepA = cost(d0, t1, t) + cost(d1, t2, t);
    const keepB = cost(d1, t1, t) + cost(d0, t2, t);
    if (Math.abs(keepA - keepB) >= swapMarginT) return keepA < keepB ? { 1: d0, 2: d1 } : { 1: d1, 2: d0 };
    // Too close to call: keep the order the two players had (Player 1 on the side it was).
    const oneWasLeft = predict(t1 as Track, t) <= predict(t2 as Track, t);
    const [l, r] = d0.x <= d1.x ? [d0, d1] : [d1, d0];
    return oneWasLeft ? { 1: l, 2: r } : { 1: r, 2: l };
  }

  return {
    push(f: PoseFrame): [PlayerFrame, PlayerFrame] {
      const raw = f.poses ?? (f.landmarks ? [f.landmarks] : []);
      const ds = raw.map((lm) => detect(lm, f.aspect)).filter((d): d is Detection => d !== null).sort((a, b) => b.size - a.size).slice(0, 2);
      const got = assign(ds, f.t, f.aspect);
      for (const s of [1, 2] as const) {
        const d = got[s];
        if (d) {
          update(s, d, f.t);
          if (!presence[s].present) presence[s] = { present: true, since: f.t, lastX: d.x };
          else presence[s].lastX = d.x;
        } else if (presence[s].present && f.t - (tracks[s]?.lastT ?? -Infinity) > lostMs) {
          presence[s] = { present: false, since: f.t, ...(tracks[s] ? { lastX: (tracks[s] as Track).x } : {}) };
        }
      }
      const frame = (s: PlayerSlot): PlayerFrame => {
        const { poses: _all, ...rest } = f;
        return { ...rest, player: s, landmarks: got[s]?.lm ?? null };
      };
      return [frame(1), frame(2)];
    },
    get presence() { return presence; },
    reset() {
      tracks = { 1: null, 2: null };
      presence = { 1: { present: false, since: 0 }, 2: { present: false, since: 0 } };
    },
  };
}
