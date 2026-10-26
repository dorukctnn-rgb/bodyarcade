// The fast state frame of a race, as the pages send and read it (builder N). About 15 times a second a page sends the friends
//
//     { mt, sc, p }     mt: the match time it was made at (ms), sc: the score so far, p: the pose as 26 whole numbers (optional)
//
// through the peer channel when it works and through the Room relay when it does not (tech.md 2.5): the same frame either way,
// never more than about 200 characters. The pose is how a friend is drawn whenever their camera picture is not on the screen: a
// friend whose camera did not connect, a stranger in a public lobby (strangers are never video), a recording.
//
// The pose is 13 joints (nose, shoulders, elbows, wrists, hips, knees, ankles) as x and y of the camera picture, 0 to 254 each, 255
// for "not seen". It is the raw picture position, not mirrored: the page that draws it mirrors it the way it mirrors its own self view.
//
// Frames come from other people's pages, so nothing here trusts them: readGhostFrame checks every field and every number, and
// the RivalBoard that keeps the latest frame of each friend lets a skeleton go when its frames stop instead of freezing on the screen.
import { LANDMARK_COUNT, LM, type Landmark } from '../types/index.ts';
import type { SeatId } from '../types/net.ts';

export const POSE_JOINTS: readonly number[] = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];
export const POSE_NUMBERS = POSE_JOINTS.length * 2;
const MISSING = 255;
const SCALE = 254;
/** A pose with fewer joints than this seen is not a body worth drawing. */
const MIN_SEEN = 4;
const MIN_VISIBILITY = 0.5;

/** The pose of a frame of landmarks as 26 whole numbers, or null when no body is seen well enough. */
export function packPose(lm: readonly Landmark[] | null | undefined): number[] | null {
  if (!lm || lm.length < LANDMARK_COUNT) return null;
  const out: number[] = [];
  let seen = 0;
  for (const i of POSE_JOINTS) {
    const p = lm[i];
    if (p && p.visibility >= MIN_VISIBILITY && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) { out.push(Math.round(p.x * SCALE), Math.round(p.y * SCALE)); seen++; }
    else out.push(MISSING, MISSING);
  }
  return seen >= MIN_SEEN ? out : null;
}

/** The 33 landmarks of a packed pose (the joints it carries are visible, the rest are not), or null for anything that is not one. */
export function unpackPose(p: unknown): Landmark[] | null {
  if (!Array.isArray(p) || p.length !== POSE_NUMBERS) return null;
  const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  let seen = 0;
  for (let k = 0; k < POSE_JOINTS.length; k++) {
    const x: unknown = p[2 * k];
    const y: unknown = p[2 * k + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > MISSING || y > MISSING) return null;
    if (x === MISSING || y === MISSING) continue;
    lm[POSE_JOINTS[k] as number] = { x: x / SCALE, y: y / SCALE, z: 0, visibility: 1 };
    seen++;
  }
  return seen >= MIN_SEEN ? lm : null;
}

export interface GhostFrame { mt: number; sc: number; p?: number[] }

/** The frame to hand to `race.sendGhost` / `client.sendState`: the match time, the score and (when a body is seen) the pose. */
export function ghostFrame(mt: number, sc: number, lm?: readonly Landmark[] | null): GhostFrame {
  const p = lm ? packPose(lm) : null;
  const f: GhostFrame = { mt: Math.round(mt), sc: Math.max(0, Math.round(sc)) };
  if (p) f.p = p;
  return f;
}

/** A friend's frame, checked. */
export interface RivalFrame { mt: number; sc: number; pose: Landmark[] | null }

/** The frame a friend's page sent, or null when it is not one (wrong shape, a number out of range, junk). A bad pose alone costs only the pose. */
export function readGhostFrame(d: unknown): RivalFrame | null {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const mt = o['mt'];
  const sc = o['sc'];
  if (typeof mt !== 'number' || !Number.isFinite(mt) || mt < -60_000 || mt > 600_000) return null;
  if (typeof sc !== 'number' || !Number.isInteger(sc) || sc < 0 || sc > 5_000_000) return null;
  return { mt, sc, pose: o['p'] === undefined ? null : unpackPose(o['p']) };
}

/** A skeleton is shown for this long after the last frame that had a pose, then it goes (a frozen figure would read as a live one). */
export const POSE_STALE_MS = 1200;

/** The latest frame of every friend: their skeleton (for the tile), their score, the match time of their page. */
export class RivalBoard {
  private readonly now: () => number;
  private readonly staleMs: number;
  private readonly by = new Map<SeatId, { frame: RivalFrame; at: number; pose: Landmark[] | null; poseAt: number }>();

  constructor(now: () => number, staleMs = POSE_STALE_MS) {
    this.now = now;
    this.staleMs = staleMs;
  }

  /** Takes the state a friend's page sent (the `d` of a `ghost` / `state` event). False when it was not a frame. */
  accept(seat: SeatId, d: unknown): boolean {
    const f = readGhostFrame(d);
    if (!f) return false;
    const at = this.now();
    const prev = this.by.get(seat);
    this.by.set(seat, f.pose
      ? { frame: f, at, pose: f.pose, poseAt: at }
      : { frame: f, at, pose: prev?.pose ?? null, poseAt: prev?.poseAt ?? 0 });
    return true;
  }

  /** The friend's skeleton as the 33 landmarks the renderer draws, or null when none came lately. */
  pose(seat: SeatId): Landmark[] | null {
    const r = this.by.get(seat);
    return r && r.pose && this.now() - r.poseAt <= this.staleMs ? r.pose : null;
  }

  score(seat: SeatId): number | null { return this.by.get(seat)?.frame.sc ?? null; }
  matchTime(seat: SeatId): number | null { return this.by.get(seat)?.frame.mt ?? null; }
  seats(): SeatId[] { return [...this.by.keys()]; }
  forget(seat: SeatId): void { this.by.delete(seat); }
  clear(): void { this.by.clear(); }
}
