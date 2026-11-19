// Real people in motion: the short clips of the home page (the game tiles, the body areas, the area picker, "how it works", the form
// coach, the challenge of the day) and of the welcome tour, each with our body line drawn over the person, as the hero does
// (views/arena.ts). Sources and licences: ASSETS-LICENSES.md (Mixkit Stock Video Free License, Pexels License; real footage, no
// generated people). The people are example footage, not BodyArcade players, and nothing here says they are.
//
// - A clip is 3 to 5 seconds of one move that loops without a jump, cropped, turned grey and darkened like the hero, silent, in two
//   shapes: 'tile' (4:3, 640x480: the tiles and cards) and 'tall' (4:5, 720x900: "how it works" and the tour's stage). H.264 in MP4 and
//   VP9 in WebM: design/art/clips/mo-<id>-<shape>.mp4|webm.
// - Its poster is the clip's first frame with the body line of that frame drawn on it (design/art/hero/mo-<id>-<shape>.avif|webp): the
//   still a visitor sees first, the one kept when motion is reduced, data is saved or the device is weak, and what a crawler reads.
// - The body line comes from MediaPipe's pose landmarker run offline over the very file the page plays, one frame at a time
//   (tools/hero-pose/extract-still.ts, compact.ts --per-frame): design/art/clips/mo-<id>-<shape>.json, the hero-pose.ts format.
// - A game is 3D: its tile shows a person doing the game's move, with a small frame of the game itself in the corner (src/arena.ts
//   captureFile), so the tile still shows what the game looks like.
import type { BodyRegion } from '../../core/types/index.ts';
import { clipsAllowed, type ClipConnection } from './clips.ts';

export type MotionShape = 'tile' | 'tall';
export const MOTION_SIZE: Readonly<Record<MotionShape, { w: number; h: number }>> = { tile: { w: 640, h: 480 }, tall: { w: 720, h: 900 } };

/** Every clip and the shapes it is made in. */
export const MOTION_CLIPS = {
  squat: ['tile', 'tall'],
  knees: ['tile'],
  reach: ['tile', 'tall'],
  punch: ['tile', 'tall'],
  dodge: ['tile'],
  jacks: ['tile', 'tall'],
  twist: ['tile'],
  climb: ['tile'],
  lean: ['tile'],
  pose: ['tile', 'tall'],
  run: ['tile'],
  lunge: ['tile', 'tall'],
  press: ['tile', 'tall'],
  pushup: ['tile', 'tall'],
  halo: ['tile', 'tall'],
  ropes: ['tile', 'tall'],
  stretch: ['tile', 'tall'],
  seated: ['tile'],
  coach: ['tile'],
  warmup: ['tall'],
} as const satisfies Record<string, readonly MotionShape[]>;
export type MotionId = keyof typeof MOTION_CLIPS;

export const hasShape = (id: MotionId, shape: MotionShape): boolean => (MOTION_CLIPS[id] as readonly MotionShape[]).includes(shape);

/** The move of each game, by game id: a person doing what the game asks for. */
export const GAME_MOTION: Readonly<Record<string, MotionId>> = {
  'squat-flap': 'squat',
  'knee-sprint': 'knees',
  'star-catch': 'reach',
  'pad-work': 'punch',
  'reaction-tag': 'dodge',
  'firework-jacks': 'jacks',
  'twist-turbine': 'twist',
  'summit-climb': 'climb',
  'limbo-bend': 'lean',
  'pose-wall': 'pose',
  'road-run': 'run',
};

/** A move for each body area (the area tiles and the tour's third page): what working that area looks like. */
export const REGION_MOTION: Readonly<Record<BodyRegion, MotionId>> = {
  legs: 'lunge',
  arms: 'press',
  'chest-back': 'pushup',
  core: 'halo',
  cardio: 'ropes',
  mobility: 'stretch',
  seated: 'seated',
};

/** The form coach's card: squats, the move the coach counts in its picture. */
export const COACH_MOTION: MotionId = 'coach';
/** "How it works", step 3 ("Match it"): a pose held, with the shape to match drawn over it. */
export const MATCH_MOTION: MotionId = 'pose';

/** The tour's stage on each page (the third page follows the areas the player picks: REGION_MOTION). */
export const TOUR_MOTION: Readonly<Record<1 | 2 | 4 | 5, readonly MotionId[]>> = {
  1: ['squat', 'jacks', 'punch'],
  2: ['reach'],
  4: ['warmup'],
  5: ['warmup'],
};

/**
 * The clips of the tour's stage on a page: the third page shows the area the player last turned on (else the first one chosen, else the
 * legs). Each is a 'tall' clip (MOTION_CLIPS).
 */
export function tourClips(step: 1 | 2 | 3 | 4 | 5, regions: readonly BodyRegion[], last?: BodyRegion | null): readonly MotionId[] {
  if (step !== 3) return TOUR_MOTION[step];
  const r = last && regions.includes(last) ? last : regions[0] ?? 'legs';
  return [REGION_MOTION[r] && hasShape(REGION_MOTION[r], 'tall') ? REGION_MOTION[r] : 'lunge'];
}

export const motionClipFile = (id: MotionId, shape: MotionShape, ext: 'mp4' | 'webm'): string => `mo-${id}-${shape}.${ext}`;
export const motionPoseFile = (id: MotionId, shape: MotionShape): string => `mo-${id}-${shape}.json`;
export const motionPosterFile = (id: MotionId, shape: MotionShape, ext: 'avif' | 'webp'): string => `mo-${id}-${shape}.${ext}`;

const each = <T>(f: (id: MotionId, shape: MotionShape) => T[]): T[] =>
  (Object.keys(MOTION_CLIPS) as MotionId[]).flatMap((id) => (MOTION_CLIPS[id] as readonly MotionShape[]).flatMap((shape) => f(id, shape)));

/** The files of design/art/clips: the clips and their body lines (fetched only when a clip plays; not stored by the service worker). */
export const motionClipFiles = (): string[] => each((id, shape) => [motionClipFile(id, shape, 'mp4'), motionClipFile(id, shape, 'webm'), motionPoseFile(id, shape)]);
/** The files of design/art/hero: the posters. */
export const motionPosterFiles = (): string[] => each((id, shape) => [motionPosterFile(id, shape, 'avif'), motionPosterFile(id, shape, 'webp')]);

// ---- when the clips play --------------------------------------------------------------------------------------------------

/** At most this many clips play at once: two on a narrow screen, four on a wide one (the rest show their posters). */
export const motionCap = (viewportWidth: number): number => (viewportWidth < 700 ? 2 : 4);

/** On the screen enough to play: a third of the card. */
export const MOTION_IN_VIEW = 0.33;

/**
 * Which of the cards play: those on the screen enough, the most visible first (the order of the page breaks a tie), at most `cap`.
 * Cards that failed or are not in view never play.
 */
export function pickPlaying(cards: readonly { ratio: number; failed?: boolean }[], cap: number, min = MOTION_IN_VIEW): Set<number> {
  const order = cards.map((c, i) => ({ c, i })).filter(({ c }) => !c.failed && c.ratio >= min).sort((a, b) => b.c.ratio - a.c.ratio || a.i - b.i);
  return new Set(order.slice(0, Math.max(0, cap)).map(({ i }) => i));
}

/**
 * Whether the clips may play at all on this visit: as the game tiles (clips.ts clipsAllowed: not for reduced motion, saving data, 2G, a
 * crawler or a script), and not on a device that says it is weak (welcome-model.ts startTier 0: four cores or fewer, 3 GB or less).
 */
export function motionAllowed(o: { reducedMotion: boolean; connection?: ClipConnection | undefined; automated: boolean; forced?: boolean; weak: boolean }): boolean {
  if (o.weak && o.forced !== true) return false;
  return clipsAllowed(o);
}
