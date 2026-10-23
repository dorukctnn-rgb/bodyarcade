// Where pictures live. In development a Vite plugin serves them straight from design/; in a build the generator copies
// them under a name that carries a hash of the content and hands the views a resolver that knows the new names.
export type TileSize = 400 | 800;

export interface AssetResolver {
  tile(stem: string, size?: TileSize): string;
  logo(variant: 'light' | 'dark'): string;
  mark(): string;
  favicon(): string;
}

export const ASSET_BASE = '/assets';

export const devAssets: AssetResolver = {
  tile: (stem, size = 400) => `${ASSET_BASE}/tiles/${stem}${size === 400 ? '-400' : ''}.webp`,
  logo: (v) => `${ASSET_BASE}/brand/${v === 'dark' ? 'logo-dark' : 'logo'}.svg`,
  mark: () => `${ASSET_BASE}/brand/mark.svg`,
  favicon: () => `${ASSET_BASE}/brand/favicon.svg`,
};

/** A resolver for built files: `map` goes from a development URL to the built URL; anything missing keeps its development URL. */
export function mappedAssets(map: Readonly<Record<string, string>>): AssetResolver {
  const m = (url: string): string => map[url] ?? url;
  return {
    tile: (s, z) => m(devAssets.tile(s, z)),
    logo: (v) => m(devAssets.logo(v)),
    mark: () => m(devAssets.mark()),
    favicon: () => m(devAssets.favicon()),
  };
}
