// Where pictures live. In development a Vite plugin serves them straight from design/; in a build the generator copies
// them under a name that carries a hash of the content and hands the views a resolver that knows the new names.
export type TileSize = 400 | 800;

export interface AssetResolver {
  tile(stem: string, size?: TileSize): string;
  logo(variant: 'light' | 'dark'): string;
  mark(): string;
  favicon(): string;
  /** A pre-rendered picture or loop of the welcome tour (a device that cannot draw its 3D stage shows these). */
  onboarding(file: string): string;
  /** A loop of real play on the home page or its poster (design/home: HOME_CLIPS). */
  home(file: string): string;
}

export const ASSET_BASE = '/assets';

export const devAssets: AssetResolver = {
  tile: (stem, size = 400) => `${ASSET_BASE}/tiles/${stem}${size === 400 ? '-400' : ''}.webp`,
  logo: (v) => `${ASSET_BASE}/brand/${v === 'dark' ? 'logo-dark' : 'logo'}.svg`,
  mark: () => `${ASSET_BASE}/brand/mark.svg`,
  favicon: () => `${ASSET_BASE}/brand/favicon.svg`,
  onboarding: (file) => `${ASSET_BASE}/onboarding/${file}`,
  home: (file) => `${ASSET_BASE}/home/${file}`,
};

/** The files of design/onboarding/fallback, by name: the opening picture and loop of each theme, and a still for each page of the tour. */
export const ONBOARDING_FILES: readonly string[] = [
  'hero-light.avif', 'hero-dark.avif', 'hero-loop-light.webm', 'hero-loop-light.mp4', 'hero-loop-dark.webm', 'hero-loop-dark.mp4',
  ...[1, 2, 3, 4, 5].flatMap((n) => [`step-${n}-light.webp`, `step-${n}-dark.webp`]),
];

/**
 * The loops of the home page (design/home): real rounds of the games, played by people from free stock footage (Pexels License, listed in
 * design/home/CREDITS.md) who stand in front of the camera while the game reads them. Each loop exists in two widths as WebM (VP9) and MP4
 * (H.264), with a still of its first picture in each width as the poster. `aspect` is width / height.
 */
export const HOME_CLIPS = {
  squat: { widths: [540, 720], aspect: 9 / 16, tr: true },
  'squat-cam': { widths: [540, 720], aspect: 9 / 16, tr: false },
  duo: { widths: [960, 1280], aspect: 16 / 9, tr: true },
  // The scenes of "every move is a game": in one picture, the camera picture the game got (left, mirrored as the game shows it) and
  // the round the game played at that moment (right), so the two can never drift apart. 1418 by 1080: the person 810, the game 608.
  'bx-squat': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-knee': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-jacks': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-pad': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-star': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-climb': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-limbo': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-pose': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-react': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
  'bx-road': { widths: [944, 1418], aspect: 1418 / 1080, tr: true },
} as const;
export type HomeClip = keyof typeof HOME_CLIPS;

/**
 * The name of a loop's files in a language: a loop whose game shows words on screen (the commands, "You") was recorded again with the
 * game in Turkish (`<id>-tr`), so the Turkish page shows the game as a Turkish player sees it. The camera picture has no words.
 */
export const homeClipName = (id: HomeClip, lang: string): string => (HOME_CLIPS[id].tr && lang === 'tr' ? `${id}-tr` : id);

/** The files of design/home, by name: for each loop (and its Turkish recording) and width, the poster and the two videos. */
export const HOME_FILES: readonly string[] = (Object.keys(HOME_CLIPS) as HomeClip[]).flatMap((id) =>
  (HOME_CLIPS[id].tr ? [id, `${id}-tr`] : [id]).flatMap((name) =>
    HOME_CLIPS[id].widths.flatMap((w) => [`${name}-${w}.webp`, `${name}-${w}.webm`, `${name}-${w}.mp4`])));

/** A resolver for built files: `map` goes from a development URL to the built URL; anything missing keeps its development URL. */
export function mappedAssets(map: Readonly<Record<string, string>>): AssetResolver {
  const m = (url: string): string => map[url] ?? url;
  return {
    tile: (s, z) => m(devAssets.tile(s, z)),
    logo: (v) => m(devAssets.logo(v)),
    mark: () => m(devAssets.mark()),
    favicon: () => m(devAssets.favicon()),
    onboarding: (file) => m(devAssets.onboarding(file)),
    home: (file) => m(devAssets.home(file)),
  };
}
