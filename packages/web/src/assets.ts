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
  squat: { widths: [540, 720], aspect: 9 / 16 },
  'squat-cam': { widths: [540, 720], aspect: 9 / 16 },
  knee: { widths: [432, 576], aspect: 9 / 16 },
  jacks: { widths: [432, 576], aspect: 9 / 16 },
  pad: { widths: [432, 576], aspect: 9 / 16 },
  duo: { widths: [960, 1280], aspect: 16 / 9 },
} as const;
export type HomeClip = keyof typeof HOME_CLIPS;

/** The files of design/home, by name: for each loop and width, the poster and the two videos. */
export const HOME_FILES: readonly string[] = (Object.keys(HOME_CLIPS) as HomeClip[]).flatMap((id) =>
  HOME_CLIPS[id].widths.flatMap((w) => [`${id}-${w}.webp`, `${id}-${w}.webm`, `${id}-${w}.mp4`]));

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
