// Picking games from the catalogue: by body region, by the player's modes (seated, quiet), and the order the menu
// shows them in. Pure functions, used by the menu, the region pages and the generator.
import type { BodyRegion } from '../../core/types/index.ts';
import type { ShellGame } from './types.ts';

export interface GameFilter {
  /** Chosen body regions; empty means every region. */
  regions: readonly BodyRegion[];
  /** Seated mode is on: only games with a seated version. */
  seated: boolean;
  /** Quiet mode is on: only games that can be played without jumping or stamping. */
  quiet: boolean;
}

export interface FilterResult {
  shown: ShellGame[];
  /** Games that fit the chosen regions but are hidden by seated or quiet mode. */
  hiddenByModes: number;
}

export const NO_FILTER: GameFilter = { regions: [], seated: false, quiet: false };

/** A game belongs to a region when it lists it. The "seated" region also holds every game with a seated version. */
export function inRegion(g: ShellGame, region: BodyRegion): boolean {
  return g.regions.includes(region) || (region === 'seated' && g.seated);
}

export function filterGames(games: readonly ShellGame[], f: GameFilter): FilterResult {
  const inChosenRegions = f.regions.length === 0 ? [...games] : games.filter((g) => f.regions.some((r) => inRegion(g, r)));
  const shown = inChosenRegions.filter((g) => (!f.seated || g.seated) && (!f.quiet || g.silentSafe));
  return { shown, hiddenByModes: inChosenRegions.length - shown.length };
}

/** The menu order: games in the player's chosen regions first, otherwise the catalogue order. Stable. */
export function orderForPlayer(games: readonly ShellGame[], preferred: readonly BodyRegion[]): ShellGame[] {
  if (preferred.length === 0) return [...games];
  const mine = games.filter((g) => preferred.some((r) => inRegion(g, r)));
  const rest = games.filter((g) => !preferred.some((r) => inRegion(g, r)));
  return [...mine, ...rest];
}

/** How many games each region has, for the filter chips. Regions without games are left out. */
export function regionCounts(games: readonly ShellGame[], order: readonly BodyRegion[]): { region: BodyRegion; count: number }[] {
  return order.map((region) => ({ region, count: games.filter((g) => inRegion(g, region)).length })).filter((r) => r.count > 0);
}

/** "More like this": the games the manifest names, then games that share a region, never the game itself. */
export function relatedGames(game: ShellGame, all: readonly ShellGame[], max = 3): ShellGame[] {
  const byId = new Map(all.map((g) => [g.id, g]));
  const picked: ShellGame[] = [];
  const add = (g: ShellGame | undefined): void => {
    if (g && g.id !== game.id && !picked.some((p) => p.id === g.id) && picked.length < max) picked.push(g);
  };
  for (const id of game.catalogue.related ?? []) add(byId.get(id));
  for (const g of all) if (g.regions.some((r) => game.regions.includes(r))) add(g);
  for (const g of all) add(g);
  return picked;
}

export const gameBySlug = (games: readonly ShellGame[], slug: string): ShellGame | undefined => games.find((g) => g.seo.slug === slug);
export const gameById = (games: readonly ShellGame[], id: string): ShellGame | undefined => games.find((g) => g.id === id);

/** Does the game support two players on one camera (the manifest says so; the device decides whether it is offered)? */
export const supportsLocal2 = (g: ShellGame): boolean => g.modes.includes('local2');

/** The games not free: what Pro adds. */
export const proGames = (games: readonly ShellGame[]): ShellGame[] => games.filter((g) => !g.free);
