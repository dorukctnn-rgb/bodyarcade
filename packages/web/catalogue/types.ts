// The catalogue: what the menu, the game pages, the paywall and the sitemap know about each game. One manifest.json per
// game (packages/games/<id>/manifest.json) is the GameManifest of the contract plus a `catalogue` block that carries
// the words and the picture. Relative imports only: the page generator runs these files in Node without an alias.
import type { GameManifest, LocalizedString } from '../../core/types/index.ts';
import type { PoseName } from '../../core/ui/glyphs.ts';

/** What only the shell needs to present a game. All text is per language; English is required. */
export interface CatalogueBlock {
  /** One line under the title: what you do. */
  tagline: LocalizedString;
  /** Two or three sentences for the game page and the search snippet. Says only what the game really does. */
  about: LocalizedString;
  /**
   * What the game is, with its article, in the words people search with ("a boxing workout game"): the game page's title says it
   * ("Pad Work: a boxing workout game for your webcam"). Per language, English required; a language without text keeps the
   * general title ("{game}: a webcam fitness game in your browser"). Optional.
   */
  kind?: LocalizedString;
  /** Three to five steps. */
  how: LocalizedString[];
  /** What the camera reads, in plain words. One to four lines. Never heart rate or anything medical. */
  measures: LocalizedString[];
  /** What the score counts, in the plural: "squats", "stars". Shown under the big number of the results and as the HUD label. */
  unit?: LocalizedString;
  /** The move pictogram shown next to the region on tiles. */
  move: PoseName;
  /** File stem of the 3D tile art (design/art/tiles/<tile>.webp). */
  tile: string;
  /** Position in the menu, 1 first. Unique. */
  order: number;
  /** Games to show under "More like this". */
  related?: string[];
  /** Only when the manifest says `seated`: how the seated version plays. */
  seatedNote?: LocalizedString;
  /** Only when the manifest says `silentSafe`: how the quiet version plays. */
  quietNote?: LocalizedString;
}

export interface GameEntry extends GameManifest {
  catalogue: CatalogueBlock;
}

/** What the browser needs: the entry without the detector wiring. */
export type ShellGame = Omit<GameEntry, 'detectors' | 'minPoseHz'>;

export interface Catalogue {
  version: 1;
  /** 'fixtures' marks a catalogue made from the development fixtures: never published. */
  source: 'games' | 'fixtures' | 'mixed';
  games: ShellGame[];
}

export interface CatalogueProblem {
  /** The file or game id the problem belongs to. */
  where: string;
  message: string;
}

export function toShellGame(e: GameEntry): ShellGame {
  const { detectors: _d, minPoseHz: _m, ...rest } = e;
  return rest;
}
