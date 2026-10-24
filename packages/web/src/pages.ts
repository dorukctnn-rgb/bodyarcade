// One function from a route to a page: the body markup, the title and description, whether search engines may index
// it, and the structured data. The browser app and the page generator both call it, so what a crawler reads and what
// a player sees come from the same code.
import { html, type SafeHtml } from '../../core/ui/html.ts';
import { localized } from '../../core/ui/i18n/localized.ts';
import type { Matched } from '../../core/ui/router.ts';
import { gameBySlug } from '../catalogue/filter.ts';
import { aboutOf, regionLabel, titleOf, type ViewContext } from './context.ts';
import { INDEXABLE, isRegion, type RouteId } from './routes.ts';
import { homePage, NO_HOME_DATA, type HomeData } from './views/home.ts';
import { gamePage, NO_GAME_DATA, type GameData } from './views/game.ts';
import type { SocialPageState } from './app/social.ts';
import { notFoundPage } from './views/misc.ts';
import { friendLinkPage, friendsPage, lobbiesPage, NO_FRIENDS_VIEW, roomPage, safetyPage } from './views/social.ts';
import { NO_ROOM_STATE } from './social/port.ts';
import { defaultPaywallState, paywallPage, type PaywallState } from './views/paywall.ts';
import { NO_PLANS_DATA, plansPage, type PlansData } from './views/plans.ts';
import { playPage } from './views/play.ts';
import { resultsPage, type RoundResult } from './views/results.ts';
import { settingsPage } from './views/settings.ts';

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
}

export const EMPTY_STATE: PageState = { paywall: null, result: null, reducedMotion: false, home: NO_HOME_DATA, game: NO_GAME_DATA, plans: NO_PLANS_DATA, social: null };

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
        body: homePage(ctx, { region: null, data: state.home }), title: t.t('home.title'), description: t.t('home.description'), noindex: false, status: 200,
        jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: brand, url: `${SITE_ORIGIN}${home}`, inLanguage: t.tag }],
        ...(ctx.games[0] ? { image: ctx.assets.tile(ctx.games[0].catalogue.tile, 800) } : {}),
      };
    }
    case 'region': {
      const region = route.params['region'];
      if (!isRegion(region) || !ctx.games.some((g) => g.regions.includes(region) || (region === 'seated' && g.seated))) return notFound();
      const label = regionLabel(ctx, region);
      return {
        body: homePage(ctx, { region, data: state.home }), title: t.t('workouts.title', { region: label }), description: t.t('workouts.description', { region: label }), noindex: false, status: 200,
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
      return { body: settingsPage(ctx, { reducedMotion: state.reducedMotion || ctx.settings.motion === 'reduce' }), title: named(t.t('settings.title')), description: t.t('settings.title'), noindex, status: 200, jsonLd: [] };
    case 'friends':
    case 'lobbies':
    case 'room':
    case 'friendlink':
    case 'safety': {
      if (!ctx.flags.social) return notFound();
      const s = state.social;
      const room = { room: NO_ROOM_STATE, game: null, profile: null, games: [], draft: '', chatNote: '' };
      const body = route.id === 'friends' ? friendsPage(ctx, s?.friends ?? NO_FRIENDS_VIEW)
        : route.id === 'lobbies' ? lobbiesPage(ctx, s?.lobbies ?? { state: NO_FRIENDS_VIEW.state, games: [], game: null, band: 'medium', region: 'eu', list: null, failed: false, search: 'idle' })
        : route.id === 'room' ? roomPage(ctx, s?.room ?? room)
        : route.id === 'friendlink' ? friendLinkPage(ctx, s?.friendLink ?? { code: null, profile: false, busy: false, note: null })
        : safetyPage(ctx, s?.friends.state.blocks ?? []);
      const title = route.id === 'lobbies' ? t.t('lobby.title') : route.id === 'room' ? t.t('room.title') : route.id === 'safety' ? t.t('safety.title') : t.t('social.title');
      return { body, title: named(title), description: t.t('social.intro.body'), noindex: true, status: 200, jsonLd: [] };
    }
    case 'welcome':
      // The tour is drawn by the browser app only (it owns a 3D stage); this is what a crawler or a script-less visit gets.
      return { body: html`<main id="main"><h1>${t.t('onboarding.h1')}</h1><p>${t.t('onboarding.text1', { n: ctx.games.length })}</p><p><a href="${ctx.href('home')}">${t.t('notfound.cta')}</a></p></main>`, title: named(t.t('onboarding.h1')), description: t.t('home.description'), noindex: true, status: 200, jsonLd: [] };
  }
}
