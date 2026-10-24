// The games as the content pages state them: the catalogue read from the manifests (packages/games/<id>/manifest.json), so a page
// never names a game that is not there, never calls a game free that is Pro, and counts are the catalogue's own. The pages are
// build products: a change to a manifest makes `build.ts --check` (and content.test.ts) say that they are out of date.
import { loadCatalogue } from '../../catalogue/load.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { Lang } from '../facts.ts';

export interface GameInfo {
  id: string;
  slug: string;
  title: string;
  free: boolean;
  seated: boolean;
  lowImpact: boolean;
  quiet: boolean;
  seconds: number;
  /** Two people side by side at one camera. */
  local2: boolean;
  /** A live race against a friend in a room. */
  live: boolean;
  tagline: string;
  about: string;
}

let cache: ShellGame[] | null = null;

function shellGames(): ShellGame[] {
  if (cache) return cache;
  const { catalogue, problems } = loadCatalogue({ fixtures: 'none', requiredLangs: ['en', 'tr'] });
  if (problems.length > 0) throw new Error(`the game catalogue has problems: ${problems.map((p) => `${p.where}: ${p.message}`).join('; ')}`);
  cache = [...catalogue.games].sort((a, b) => a.catalogue.order - b.catalogue.order);
  return cache;
}

export function gameList(lang: Lang): GameInfo[] {
  return shellGames().map((g) => ({
    id: g.id,
    slug: g.seo.slug,
    title: localized(g.title, lang),
    free: g.free,
    seated: g.seated,
    lowImpact: g.lowImpact,
    quiet: g.silentSafe,
    seconds: g.durationSec,
    local2: g.modes.includes('local2'),
    live: g.modes.includes('duel'),
    tagline: localized(g.catalogue.tagline, lang),
    about: localized(g.catalogue.about, lang),
  }));
}

export interface GameCounts {
  total: number;
  free: number;
  pro: number;
  seated: number;
  quiet: number;
  local2: number;
  live: number;
  shortest: number;
  longest: number;
}

export function gameCounts(): GameCounts {
  const g = gameList('en');
  return {
    total: g.length,
    free: g.filter((x) => x.free).length,
    pro: g.filter((x) => !x.free).length,
    seated: g.filter((x) => x.seated).length,
    quiet: g.filter((x) => x.quiet).length,
    local2: g.filter((x) => x.local2).length,
    live: g.filter((x) => x.live).length,
    shortest: Math.min(...g.map((x) => x.seconds)),
    longest: Math.max(...g.map((x) => x.seconds)),
  };
}

/** "A", "A and B", "A, B and C" (Turkish: "A ve B", "A, B ve C"). */
export function listWords(items: readonly string[], lang: Lang): string {
  const and = lang === 'tr' ? 've' : 'and';
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

/** The titles of the games that match, as a sentence list. */
export function titlesOf(filter: (g: GameInfo) => boolean, lang: Lang): string {
  return listWords(gameList(lang).filter(filter).map((g) => g.title), lang);
}

/** Seconds as the pages say a round: "90 seconds", "7 minutes" (Turkish: "90 saniye", "7 dakika"). */
export function roundLength(seconds: number, lang: Lang): string {
  if (seconds < 120) return lang === 'tr' ? `${seconds} saniye` : `${seconds} seconds`;
  const m = Math.round(seconds / 60);
  return lang === 'tr' ? `${m} dakika` : `${m} minutes`;
}
