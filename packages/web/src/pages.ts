// One function from a route to a page: the body markup, the title and description, whether search engines may index
// it, and the structured data. The browser app and the page generator both call it, so what a crawler reads and what
// a player sees come from the same code.
import { html, type SafeHtml } from '../../core/ui/html.ts';
import { localized } from '../../core/ui/i18n/localized.ts';
import type { Matched } from '../../core/ui/router.ts';
import { gameBySlug } from '../catalogue/filter.ts';
import { aboutOf, regionLabel, titleOf, type ViewContext } from './context.ts';
import { INDEXABLE, isRegion, type RouteId } from './routes.ts';
import { homePage, NO_HOME_DATA, regionGames, type HomeData } from './views/home.ts';
import { gamePage, NO_GAME_DATA, type GameData } from './views/game.ts';
import { notFoundPage } from './views/misc.ts';
import { socialPage, type SocialPageState } from './views/social.ts';
import { childSocialPage, profilesPage } from './views/profiles.ts';
import { NO_PROFILES_STATE, type ProfilesPageState } from './app/profiles-model.ts';
import { defaultPaywallState, paywallPage, type PaywallState } from './views/paywall.ts';
import { NO_PLANS_DATA, plansPage, type PlansData } from './views/plans.ts';
import { playPage } from './views/play.ts';
import { resultsPage, type RoundResult } from './views/results.ts';
import { settingsPage, type AppRows } from './views/settings.ts';
import type { TourState } from './app/welcome-model.ts';
import { FIRST_TOUR, welcomePage } from './views/welcome.ts';

export const SITE_ORIGIN = 'https://bodyarcade.com';

/** What the browser app knows beyond the catalogue; the generator uses the defaults. */
export interface PageState {
  paywall: PaywallState | null;
  result: RoundResult | null;
  reducedMotion: boolean;
  home: HomeData;
  game: GameData;
  /** The workout plans and the one that is going. */
  plans: PlansData;
  /** What the Friends screens draw; null in the page generator, which never draws them. */
  social: SocialPageState | null;
  /** Where the welcome tour stands; null draws its first step (the generator, a visitor without scripts). */
  welcome: TourState | null;
  /** What the players screen draws; null in the page generator, which never draws it. */
  profiles: ProfilesPageState | null;
  /** The Android app's own rows of the settings page (offline play, the daily reminder); null on the web and in the page generator. */
  app: AppRows | null;
}

export const EMPTY_STATE: PageState = { paywall: null, result: null, reducedMotion: false, home: NO_HOME_DATA, game: NO_GAME_DATA, plans: NO_PLANS_DATA, social: null, welcome: null, profiles: null, app: null };

export interface Rendered {
  body: SafeHtml;
  title: string;
  description: string;
  noindex: boolean;
  status: 200 | 404;
  /** schema.org blocks (BreadcrumbList, WebSite). */
  jsonLd: object[];
  /** The page's picture for link previews, as a path the asset resolver produced. */
  image?: string;
}

/** A meta description from running text: whole sentences up to the limit, else cut at a word. */
export function snippet(text: string, limit = 158): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > limit) break;
    out += s;
  }
  if (out.trim().length >= 60) return out.trim();
  const cut = clean.slice(0, limit - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:]$/, '')}.`;
}

const crumbs = (ctx: ViewContext, items: { name: string; path: string }[]): object => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE_ORIGIN}${it.path}` })),
});

export function renderPage(ctx: ViewContext, route: Matched<RouteId> | null, state: PageState = EMPTY_STATE): Rendered {
  const t = ctx.i18n;
  const brand = t.t('brand.name');
  const named = (name: string): string => `${name} | ${brand}`;
  const notFound = (): Rendered => ({ body: notFoundPage(ctx), title: named(t.t('notfound.title')), description: t.t('notfound.body'), noindex: true, status: 404, jsonLd: [] });

  if (!route) return notFound();
  const noindex = !INDEXABLE.has(route.id);

  switch (route.id) {
    case 'home': {
      const home = ctx.href('home');
      return {
        body: homePage(ctx, { region: null, data: state.home }), title: t.t('home.title'), description: t.t('home.description', { n: ctx.games.length, free: ctx.games.filter((g) => g.free).length }), noindex: false, status: 200,
        jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: brand, url: `${SITE_ORIGIN}${home}`, inLanguage: t.tag }],
        ...(ctx.games[0] ? { image: ctx.assets.tile(ctx.games[0].catalogue.tile, 800) } : {}),
      };
    }
    case 'region': {
      const region = route.params['region'];
      if (!isRegion(region) || !ctx.games.some((g) => g.regions.includes(region) || (region === 'seated' && g.seated))) return notFound();
      const label = regionLabel(ctx, region);
      return {
        body: homePage(ctx, { region, data: state.home }), title: t.t('workouts.title', { region: label }), description: t.t('workouts.description', { region: label, ...regionGames(ctx.games, region) }), noindex: false, status: 200,
        jsonLd: [crumbs(ctx, [{ name: brand, path: ctx.href('home') }, { name: label, path: ctx.href('region', { params: { region } }) }])],
      };
    }
    case 'game': {
      const g = gameBySlug(ctx.games, route.params['slug'] ?? '');
      if (!g) return notFound();
      return {
        body: gamePage(ctx, g, state.game), title: t.t('game.title', { game: titleOf(ctx, g) }), description: snippet(aboutOf(ctx, g)), noindex: false, status: 200,
        jsonLd: [crumbs(ctx, [{ name: brand, path: ctx.href('home') }, { name: titleOf(ctx, g), path: ctx.href('game', { params: { slug: g.seo.slug } }) }])],
        image: ctx.assets.tile(g.catalogue.tile, 800),
      };
    }
    case 'play': {
      const g = gameBySlug(ctx.games, route.params['slug'] ?? '');
      if (!g) return notFound();
      return { body: playPage(ctx, g), title: named(titleOf(ctx, g)), description: t.t('play.loading'), noindex: true, status: 200, jsonLd: [] };
    }
    case 'results':
      return { body: resultsPage(ctx, state.result), title: named(t.t('results.title')), description: t.t('results.title'), noindex, status: 200, jsonLd: [] };
    case 'plans':
      return {
        body: plansPage(ctx, state.plans), title: named(t.t('plans.title')), description: t.t('plans.description'), noindex: false, status: 200,
        jsonLd: [crumbs(ctx, [{ name: brand, path: ctx.href('home') }, { name: t.t('plans.title'), path: ctx.href('plans') }])],
      };
    case 'pro':
      return { body: paywallPage(ctx, state.paywall ?? defaultPaywallState(ctx, route.query.get('game') ?? undefined)), title: named(t.t('paywall.title')), description: t.t('paywall.lead'), noindex, status: 200, jsonLd: [] };
    case 'settings':
      return { body: settingsPage(ctx, { reducedMotion: state.reducedMotion || ctx.settings.motion === 'reduce', app: state.app }), title: named(t.t('settings.title')), description: t.t('settings.title'), noindex, status: 200, jsonLd: [] };
    case 'friends':
    case 'lobbies':
    case 'room':
    case 'friendlink':
    case 'safety': {
      // A child has no online identity: the friends pages say so and lead to the main player instead of looking missing.
      if (!ctx.flags.social && ctx.flags.socialChild) return { body: childSocialPage(ctx), title: named(t.t('social.title')), description: t.t('profile.child.social'), noindex: true, status: 200, jsonLd: [] };
      if (!ctx.flags.social) return notFound();
      const p = socialPage(ctx, route, state.social);
      return { body: p.body, title: named(p.title), description: t.t('social.intro.body'), noindex: true, status: 200, jsonLd: [] };
    }
    case 'profiles':
      // Who is playing: drawn by the browser app only, from the players of this device.
      if (!ctx.player) return notFound();
      return { body: profilesPage(ctx, state.profiles ?? NO_PROFILES_STATE), title: named(t.t('profile.title')), description: t.t('profile.lead'), noindex: true, status: 200, jsonLd: [] };
    case 'welcome':
      // The tour is drawn in full by the browser app (it owns the 3D stage); a crawler or a visit without scripts gets its first step, and no index.
      return { body: welcomePage(ctx, state.welcome ?? FIRST_TOUR), title: named(t.t('onboarding.h1')), description: t.t('home.description', { n: ctx.games.length, free: ctx.games.filter((g) => g.free).length }), noindex: true, status: 200, jsonLd: [] };
  }
}
