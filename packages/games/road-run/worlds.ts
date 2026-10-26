// The ten worlds of Road Run as plain data for the shell's world picker: the id, the name, whether it is free, and the look
// (the validated theme, which the picker draws a small picture from). Nothing here draws or loads three.js, so the game's
// page and the page generator can import it. The worlds themselves are render3d/themes/classic-worlds.json, the same file
// the game plays in (index.ts); the words for Turkish live here, English comes from the file.
import type { LocalizedString, ThemeData } from '../../core/types/index.ts';
import { themeOrThrow, type Theme } from '../../core/render3d/theme.ts';
import worldsJson from '../../core/render3d/themes/classic-worlds.json' with { type: 'json' };

export interface WorldCard {
  /** The theme id, which is what StartOptions.world carries, and the id in the entitlement feature `world:<id>`. */
  id: string;
  /** Free for everyone (Alps, Desert, Forest); the others are part of Pro. */
  free: boolean;
  name: LocalizedString;
  tagline: LocalizedString;
  /** The whole validated theme: the picker draws its picture from the sky, ground, road, horizon and weather. */
  look: Theme;
}

/** Turkish names and one line each (the English ones are the theme file's own). */
const TR: Readonly<Record<string, { name: string; tagline: string }>> = {
  alps: { name: 'Alpler', tagline: 'Soğuk hava, çam gölgesi ve granit.' },
  desert: { name: 'Çöl', tagline: 'Sıcak buğusu, kumullar ve uzun kaktüsler.' },
  forest: { name: 'Orman', tagline: 'Koyu yeşil, uzun gövdeler, yumuşak ışık.' },
  storm: { name: 'Fırtına', tagline: 'Asfaltta yağmur, sırtta şimşek.' },
  sunset: { name: 'Gün batımı', tagline: 'Pembe ve altın gökyüzünde palmiyeler.' },
  arctic: { name: 'Kutup', tagline: 'Mavi buz, savrulan kar ve bir kutup ışığı.' },
  jungle: { name: 'Cangıl', tagline: 'Dev yapraklar, sarmaşıklar ve ılık sis.' },
  city: { name: 'Şehir', tagline: 'Kuleler, yanan pencereler ve ıslak bir gece yolu.' },
  volcano: { name: 'Yanardağ', tagline: 'Siyah kaya, turuncu çatlaklar ve savrulan kor.' },
  coast: { name: 'Kıyı', tagline: 'Sakin mavi suyun üzerinden geçen bir yol.' },
};

function card(raw: ThemeData): WorldCard {
  const look = themeOrThrow(raw);
  const tr = TR[look.id];
  if (!tr || !look.name || !look.tagline) throw new Error(`Road Run world "${look.id}" has no name or no Turkish words.`);
  return { id: look.id, free: look.free === true, name: { en: look.name, tr: tr.name }, tagline: { en: look.tagline, tr: tr.tagline }, look };
}

/** The worlds in the order of the theme file: the three free ones first. */
export const ROAD_RUN_WORLDS: readonly WorldCard[] = (worldsJson as unknown as ThemeData[]).map(card);

/** The world a round starts in when the player has chosen none and has none from before. */
export const DEFAULT_WORLD_ID: string = ROAD_RUN_WORLDS.find((w) => w.free)?.id ?? ROAD_RUN_WORLDS[0]?.id ?? '';
