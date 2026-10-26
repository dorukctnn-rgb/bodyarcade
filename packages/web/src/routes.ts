// The pages of the site. The same table drives the browser app, the page generator and the sitemap.
import { createRouter, type RouteSpec } from '../../core/ui/router.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import type { BodyRegion } from '../../core/types/index.ts';
import { REGION_IDS } from '../../core/ui/settings.ts';

export type RouteId = 'home' | 'region' | 'game' | 'play' | 'results' | 'plans' | 'pro' | 'settings' | 'friends' | 'lobbies' | 'room' | 'friendlink' | 'safety' | 'welcome' | 'profiles';

export const ROUTES: readonly RouteSpec<RouteId>[] = [
  { id: 'home', pattern: '/' },
  { id: 'region', pattern: '/workouts/:region' },
  { id: 'game', pattern: '/games/:slug' },
  { id: 'play', pattern: '/play/:slug' },
  { id: 'results', pattern: '/results' },
  { id: 'plans', pattern: '/plans' },
  { id: 'pro', pattern: '/pro' },
  { id: 'settings', pattern: '/settings' },
  { id: 'friends', pattern: '/friends' },
  { id: 'lobbies', pattern: '/lobbies' },
  { id: 'room', pattern: '/r/:code' },
  { id: 'friendlink', pattern: '/f/:code' },
  { id: 'safety', pattern: '/safety' },
  { id: 'welcome', pattern: '/welcome' },
  { id: 'profiles', pattern: '/profiles' },
];

/** Languages that appear as a path prefix. English is the unprefixed default. */
export const PREFIXED_LANGS: readonly Lang[] = ['tr', 'de', 'es', 'fr'];

/** Languages whose pages are generated for search engines. German, Spanish and French are drafts: the picker offers them, the sitemap does not. */
export const INDEXED_LANGS: readonly Lang[] = ['en', 'tr'];

export const router = createRouter<RouteId>(ROUTES, { prefixed: PREFIXED_LANGS });

/** Pages that search engines may index. Everything else is for the player and says noindex. */
export const INDEXABLE: ReadonlySet<RouteId> = new Set<RouteId>(['home', 'region', 'game', 'plans']);

export const REGION_ORDER: readonly BodyRegion[] = REGION_IDS;
export const isRegion = (v: unknown): v is BodyRegion => typeof v === 'string' && (REGION_ORDER as readonly string[]).includes(v);

/** The tab that is lit for a route. */
export type NavTab = 'games' | 'friends' | 'pro' | 'settings';
export const TAB_OF: Readonly<Record<RouteId, NavTab | null>> = {
  home: 'games', region: 'games', game: 'games', play: null, results: 'games', plans: 'games', pro: 'pro', settings: 'settings', friends: 'friends', lobbies: 'friends', room: 'friends', friendlink: 'friends', safety: 'friends', welcome: null, profiles: 'settings',
};
