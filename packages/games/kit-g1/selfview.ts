// What the small self view needs to show: the newest skeleton of each player and, when the shell has one, the camera
// picture. The skeleton comes from the pose service's frames (a view concern; the simulation never reads pose), so the
// self view works without access to the video element, and shows a silhouette-style picture (nothing but lines)
// when the shell gives no picture. Two players: the person on the left of the mirror is Player 1, as the platform's
// first assignment does (the stable assignment itself lives in the pose feed and is not shown to games).
import type { Landmark, PlayerSlot, PoseFrame, PoseService, Unsubscribe } from '../../core/types/index.ts';
import { LM } from '../../core/types/index.ts';

export interface SelfImage {
  /** A video element or canvas showing the camera, un-mirrored (the self view mirrors it). */
  source: CanvasImageSource;
  /** Pixel size of the source. */
  w: number;
  h: number;
}

export interface SelfView {
  /** Newest landmarks (raw image fractions) of a player, or null while they are not found. */
  landmarks(p: PlayerSlot): readonly Landmark[] | null;
  /** Width / height of the camera frame (4:3 until a frame arrives). */
  aspect(): number;
  /** The camera picture, when the shell provides one. */
  image(): SelfImage | null;
  /** Frames seen so far. */
  frames(): number;
  dispose(): void;
}

export interface SelfViewOptions {
  players: 1 | 2;
  image?: () => SelfImage | null;
}

/** Where a pose sits across the mirrored image: smaller is further left on the screen. */
function viewX(lm: readonly Landmark[]): number {
  const a = lm[LM.leftShoulder], b = lm[LM.rightShoulder], c = lm[LM.leftHip], d = lm[LM.rightHip];
  const xs = [a, b, c, d].filter((p): p is Landmark => !!p && p.visibility >= 0.3).map((p) => p.x);
  const x = xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : (lm[LM.nose]?.x ?? 0.5);
  return 1 - x;
}

export function createSelfView(pose: Pick<PoseService, 'onFrame'> | undefined, o: SelfViewOptions): SelfView {
  const latest: Record<PlayerSlot, readonly Landmark[] | null> = { 1: null, 2: null };
  let aspect = 4 / 3;
  let frames = 0;
  const off: Unsubscribe | undefined = pose?.onFrame((f: PoseFrame) => {
    frames++;
    if (f.aspect > 0 && Number.isFinite(f.aspect)) aspect = f.aspect;
    if (o.players === 2) {
      const poses = f.poses && f.poses.length ? f.poses : f.landmarks ? [f.landmarks] : [];
      const ordered = poses.slice().sort((p, q) => viewX(p) - viewX(q));
      latest[1] = ordered[0] ?? null;
      latest[2] = ordered[1] ?? null;
      // One person only: they are Player 1 if they stand on the left half, else Player 2.
      if (ordered.length === 1 && ordered[0] && viewX(ordered[0]) > 0.5) { latest[1] = null; latest[2] = ordered[0]; }
    } else {
      latest[1] = f.landmarks;
      latest[2] = null;
    }
  });
  return {
    landmarks: (p) => latest[p],
    aspect: () => aspect,
    image: () => o.image?.() ?? null,
    frames: () => frames,
    dispose() { off?.(); latest[1] = null; latest[2] = null; },
  };
}
