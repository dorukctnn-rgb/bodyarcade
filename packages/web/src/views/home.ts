// The home page and the body region pages: one view, because a region page is the home page with a filter on.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { filterGames, orderForPlayer, proGames } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { hasPro, regionLabel, taglineOf, titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { gameGrid, regionChips } from './tiles.ts';

/** The game shown large at the top of the home page: the first free game in menu order. */
export function featuredGame(ctx: ViewContext): ShellGame | undefined {
  return ctx.games.find((g) => g.free) ?? ctx.games[0];
}

function hero(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const g = featuredGame(ctx);
  const playHref = g ? ctx.href('play', { params: { slug: g.seo.slug } }) : ctx.href('home');
  return html`<section class="ba-hero" aria-labelledby="home-h1">
    <div class="ba-hero-copy">
      <h1 class="ba-display" id="home-h1" data-main-heading>${t.t('home.h1')}</h1>
      <p class="ba-lead">${t.t('home.lead', { n: ctx.games.length })}</p>
      <div class="ba-actions">
        ${g ? html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${playHref}" data-action="open-setup" data-game="${g.id}">${icon('play')}<span>${t.t('home.cta.play', { game: titleOf(ctx, g) })}</span></a>` : ''}
        <a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('welcome')}">${t.t('home.cta.how')}</a>
      </div>
      <p class="ba-assure">${icon('shield')}<span>${t.t('footer.camera')}</span></p>
    </div>
    ${g ? html`<a class="ba-hero-art" href="${ctx.href('game', { params: { slug: g.seo.slug } })}" aria-label="${titleOf(ctx, g)}">
      <span class="art"><img src="${ctx.assets.tile(g.catalogue.tile, 800)}" srcset="${ctx.assets.tile(g.catalogue.tile, 400)} 400w, ${ctx.assets.tile(g.catalogue.tile, 800)} 800w" sizes="(min-width: 900px) 46vw, 92vw" width="800" height="600" alt="" fetchpriority="high" decoding="async"></span>
      <span class="cap"><b>${titleOf(ctx, g)}</b><span>${taglineOf(ctx, g)}</span></span>
    </a>` : ''}
  </section>`;
}

function proTeaser(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const pro = proGames(ctx.games);
  if (hasPro(ctx) || pro.length === 0) return html``;
  return html`<section class="ba-panel ba-teaser" aria-labelledby="teaser-h">
    <div>
      <h2 class="ba-h3" id="teaser-h">${t.t('paywall.title')}</h2>
      <p class="ba-small">${t.t('paywall.free', { n: ctx.games.length - pro.length })}</p>
    </div>
    <a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}" data-action="open-pro">${t.t('settings.pro.see')}</a>
  </section>`;
}

export interface HomeOptions {
  /** A body region page; null is the home page. */
  region: BodyRegion | null;
}

export function homePage(ctx: ViewContext, o: HomeOptions): SafeHtml {
  const t = ctx.i18n;
  const { region } = o;
  const inRegions = region ? [region] : [];
  const { shown, hiddenByModes } = filterGames(ctx.games, { regions: inRegions, seated: ctx.settings.seated, quiet: ctx.settings.quiet });
  const ordered = region ? shown : orderForPlayer(shown, ctx.settings.regions);
  const modeNotes = [
    ctx.settings.seated ? t.t('home.mode.seated') : '',
    ctx.settings.quiet ? t.t('home.mode.quiet') : '',
  ].filter(Boolean);

  const heading = region
    ? html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('workouts.title', { region: regionLabel(ctx, region) })}</h1></header>
       <p class="ba-lead">${t.t('workouts.description', { region: regionLabel(ctx, region) })}</p>`
    : '';

  const empty = html`<div class="ba-panel ba-empty" role="status">
    <h2 class="ba-h3">${t.t('home.empty.title')}</h2>
    <p class="ba-small">${t.t('home.empty.body')}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('home')}">${t.t('home.empty.clear')}</a><a class="ba-btn ba-btn--quiet" href="${ctx.href('settings')}">${t.t('home.hidden.change')}</a></div>
  </div>`;

  const hidden = hiddenByModes > 0
    ? html`<p class="ba-small ba-hiddennote">${t.t('home.hidden', { n: hiddenByModes })} <a class="ba-link" href="${ctx.href('settings')}">${t.t('home.hidden.change')}</a></p>`
    : '';

  const main = html`
    ${region ? heading : hero(ctx)}
    <section class="ba-section" aria-labelledby="games-h">
      <header class="ba-section-head">
        <h2 id="games-h">${t.t('home.all')}</h2>
        <p class="ba-small" role="status" data-count>${t.t('home.count', { n: ordered.length })}${modeNotes.length ? html` <span class="ba-modes">${modeNotes.join(', ')}</span>` : ''}</p>
      </header>
      ${regionChips(ctx, region)}
      ${ordered.length ? gameGrid(ctx, ordered, t.t('home.all')) : empty}
      ${hidden}
    </section>
    ${proTeaser(ctx)}`;

  return chrome(ctx, { tab: 'games', main, mainClass: region ? 'ba-page--region' : 'ba-page--home' });
}

export const regionHeading = (ctx: Pick<ViewContext, 'i18n'>, region: BodyRegion): string => ctx.i18n.t('workouts.title', { region: ctx.i18n.tx(`region.${region}`) });
