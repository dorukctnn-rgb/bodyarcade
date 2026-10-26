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
}

export const ASSET_BASE = '/assets';

export const devAssets: AssetResolver = {
  tile: (stem, size = 400) => `${ASSET_BASE}/tiles/${stem}${size === 400 ? '-400' : ''}.webp`,
  logo: (v) => `${ASSET_BASE}/brand/${v === 'dark' ? 'logo-dark' : 'logo'}.svg`,
  mark: () => `${ASSET_BASE}/brand/mark.svg`,
  favicon: () => `${ASSET_BASE}/brand/favicon.svg`,
  onboarding: (file) => `${ASSET_BASE}/onboarding/${file}`,
};

/** The files of design/onboarding/fallback, by name: the opening picture and loop of each theme, and a still for each page of the tour. */
export const ONBOARDING_FILES: readonly string[] = [
  'hero-light.avif', 'hero-dark.avif', 'hero-loop-light.webm', 'hero-loop-light.mp4', 'hero-loop-dark.webm', 'hero-loop-dark.mp4',
  ...[1, 2, 3, 4, 5].flatMap((n) => [`step-${n}-light.webp`, `step-${n}-dark.webp`]),
];

/** A resolver for built files: `map` goes from a development URL to the built URL; anything missing keeps its development URL. */
export function mappedAssets(map: Readonly<Record<string, string>>): AssetResolver {
  const m = (url: string): string => map[url] ?? url;
  return {
    tile: (s, z) => m(devAssets.tile(s, z)),
    logo: (v) => m(devAssets.logo(v)),
    mark: () => m(devAssets.mark()),
    favicon: () => m(devAssets.favicon()),
    onboarding: (file) => m(devAssets.onboarding(file)),
  };
}
