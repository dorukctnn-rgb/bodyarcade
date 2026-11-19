// The files of the sports home page (views/arena.ts): the hero clip of a real athlete in two crops, its posters, the stills of
// "how it works" and a frame of every game in play. Sources and licences: ASSETS-LICENSES.md at the root of the repository.
//
// - The hero clip: Mixkit 52316, jumping lunges (wide, for screens wider than tall) and Mixkit 52106, squats (tall, for screens taller
//   than wide: phones and tablets held upright), both under the Mixkit Stock Video Free License, cut, darkened and re-encoded by us
//   (design/art/clips/). The people in them are example footage and are not BodyArcade players.
//   The body line over the athlete comes from our own pose model run over these files (src/hero-pose/*.json, tools/hero-pose).
// - The game frames: tools/gfx-shots with --clean (the game alone, no HUD), cut to 4:3 (design/art/hero/cap-*).

/** One crop of the hero clip: its picture size, the file stem, and where its picture sits in a box that cuts it (object-position). */
export interface ArenaCrop {
  id: 'wide' | 'tall';
  w: number;
  h: number;
  /** Stem of the clip (design/art/clips/<stem>.mp4|.webm) and of its poster (design/art/hero/<stem>.avif|.webp). */
  stem: string;
  /** object-position of the clip and the poster: the athlete stays on the screen whatever the box's shape. */
  position: string;
}

export const ARENA: Readonly<Record<'wide' | 'tall', ArenaCrop>> = {
  wide: { id: 'wide', w: 1280, h: 720, stem: 'arena-wide-1280', position: '62% 50%' },
  tall: { id: 'tall', w: 720, h: 900, stem: 'arena-tall-720', position: '50% 30%' },
};

/**
 * Which crop a screen gets: the tall one on a phone held upright (taller than wide and under 600 px wide). A tablet held upright has the
 * same stacked layout (the stylesheet's (max-aspect-ratio: 1/1)), but its picture box is wider than tall, so the wide crop fits it.
 */
export const ARENA_TALL_QUERY = '(max-aspect-ratio: 1/1) and (max-width: 599.98px)';

/** The poster files (the page's largest picture until the clip plays, and what reduced motion keeps). */
export const arenaPosterFiles = (): string[] => Object.values(ARENA).flatMap((c) => [`${c.stem}.avif`, `${c.stem}.webp`]);
/** The clip files, H.264 in MP4 and VP9 in WebM. */
export const arenaClipFiles = (): string[] => Object.values(ARENA).flatMap((c) => [`${c.stem}.mp4`, `${c.stem}.webm`]);

/** The three stills of "how it works", 4:5. */
export const HOW_STILLS = { camera: 'how-camera-640.webp', move: 'how-move-640.webp', score: 'how-score-640.webp' } as const;
/** The still behind the last call (a later moment of the same clips). */
export const FINAL_STILLS = { wide: 'final-wide-1280.webp', tall: 'final-tall-720.webp' } as const;
export const HOW_STILL_SIZE = { w: 640, h: 800 } as const;

/** Widths of the game frames (4:3). */
export const CAPTURE_WIDTHS = [480, 960] as const;
/** Games with a frame of play, by game id (the file is cap-<id>-<width>.webp). */
export const CAPTURED_GAMES: readonly string[] = [
  'squat-flap', 'knee-sprint', 'star-catch', 'pad-work', 'reaction-tag', 'firework-jacks', 'twist-turbine', 'summit-climb', 'limbo-bend', 'pose-wall', 'road-run',
];
export const captureFile = (game: string, w: (typeof CAPTURE_WIDTHS)[number]): string => `cap-${game}-${w}.webp`;
export const captureFiles = (): string[] => CAPTURED_GAMES.flatMap((g) => CAPTURE_WIDTHS.map((w) => captureFile(g, w)));
export const arenaStillFiles = (): string[] => [...arenaPosterFiles(), ...Object.values(HOW_STILLS), ...Object.values(FINAL_STILLS), ...captureFiles()];
