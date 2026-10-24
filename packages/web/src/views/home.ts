// The home page and the body region pages: one view, because a region page is the home page with a filter on.
// Layout from the art director's home.html: a card for what to play now, the week against the daily line (once there
// is a week to show), every game with its body-region filter and the modes, and ways to play together.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { filterGames, orderForPlayer, proGames, supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { CHART_TOP_MINUTES, DAILY_GOAL_MINUTES, type RecentBest, type WeekStats } from '../app/history.ts';
import { hasPro, regionLabel, taglineOf, titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { gameGrid, regionChips } from './tiles.ts';
import { weekdayNames } from './parts.ts';

/** What the home page knows about the player's weeks; empty on the server and for a new player. */
export interface HomeData {
  week: WeekStats | null;
  recent: RecentBest[];
  /** Mode chip "2 players" is on: only games that can be played by two. */
  duoOnly: boolean;
}

export const NO_HOME_DATA: HomeData = { week: null, recent: [], duoOnly: false };

/** The game shown large at the top of the home page: the first free game in menu order. */
export function featuredGame(ctx: ViewContext): ShellGame | undefined {
  return ctx.games.find((g) => g.free) ?? ctx.games[0];
}

function hero(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const g = featuredGame(ctx);
  return html`<article class="k-today" aria-labelledby="home-h1">
    <div class="art">${g ? html`<a href="${ctx.href('game', { params: { slug: g.seo.slug } })}"><img src="${ctx.assets.tile(g.catalogue.tile, 800)}" srcset="${ctx.assets.tile(g.catalogue.tile, 400)} 400w, ${ctx.assets.tile(g.catalogue.tile, 800)} 800w" sizes="(min-width: 1200px) 34vw, (min-width: 640px) 46vw, 92vw" width="800" height="600" alt="" fetchpriority="high" decoding="async"><span class="cap"><b>${titleOf(ctx, g)}</b><span>${taglineOf(ctx, g)}</span></span></a>` : ''}</div>
    <div class="body">
      <h1 id="home-h1" data-main-heading>${t.t('home.h1')}</h1>
      <p class="lead">${t.t('home.lead', { n: ctx.games.length })}</p>
      <div class="k-actions">
        ${g ? html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${icon('play')}<span>${t.t('home.cta.play', { game: titleOf(ctx, g) })}</span></a>` : ''}
        <a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('welcome')}">${t.t('home.cta.how')}</a>
      </div>
      <p class="ba-assure">${icon('shield')}<span>${t.t('footer.camera')}</span></p>
    </div>
  </article>`;
}

/** The week card: minutes per day against the daily line, the streak, and the recent bests. */
function weekCard(ctx: ViewContext, w: WeekStats, recent: RecentBest[]): SafeHtml {
  const t = ctx.i18n;
  const names = weekdayNames(t.tag);
  const long = new Intl.DateTimeFormat(t.tag, { weekday: 'long', timeZone: 'UTC' });
  const level = (m: number | null): number => (m === null ? 1 : Math.max(1, Math.min(20, Math.round((Math.min(m, CHART_TOP_MINUTES) / CHART_TOP_MINUTES) * 20))));
  const aria = t.t('home.week.chart', {
    days: w.days.filter((d) => d.minutes !== null).map((d) => `${long.format(new Date(`${d.day}T00:00:00Z`))} ${d.minutes}`).join(', '),
    goal: DAILY_GOAL_MINUTES,
  });
  const goalLevel = Math.round((DAILY_GOAL_MINUTES / CHART_TOP_MINUTES) * 20);
  const dayName = (day: string): string => {
    const d = w.days.find((x) => x.day === day);
    return d?.today ? t.t('home.today') : d ? (names[d.index] ?? '') : t.date(new Date(`${day}T00:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return html`<aside class="k-card k-week" aria-labelledby="week-h">
    <div class="top"><h2 class="k-h3" id="week-h">${t.t('home.week.title')}</h2></div>
    <div class="big">${t.number(w.totalMinutes)}<small>${t.t('home.week.minutes')}</small></div>
    <div class="k-bars" role="img" aria-label="${aria}">
      ${w.days.map((d) => html`<i class="h${level(d.minutes)} ${d.minutes === null ? 'later' : d.today ? 'now' : d.hit ? 'hit' : ''}"></i>`)}
      <span class="goal g${goalLevel}"><span>${t.t('home.week.line', { n: DAILY_GOAL_MINUTES })}</span></span>
    </div>
    <div class="k-days" aria-hidden="true">${w.days.map((d) => html`<span>${names[d.index] ?? ''}</span>`)}</div>
    <p class="ba-small">${t.t('home.week.streak', { n: w.streak, m: w.hits })}</p>
    ${recent.length ? html`<div class="bests"><span class="k-label">${t.t('home.bests')}</span>
      <ul class="k-mix">${recent.map((b) => {
        const g = ctx.games.find((x) => x.id === b.game);
        return g ? html`<li><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="56" height="42"><div><b>${t.number(b.score)}</b><small>${titleOf(ctx, g)}</small></div><span class="min">${dayName(b.day)}</span></li>` : '';
      })}</ul></div>` : ''}
  </aside>`;
}

function modeChips(ctx: ViewContext, duoOnly: boolean): SafeHtml {
  const t = ctx.i18n;
  const s = ctx.settings;
  return html`<span class="k-modes">
    <button class="ba-chip ba-chip--text" type="button" data-action="mode" data-mode="seated" aria-pressed="${s.seated ? 'true' : 'false'}">${icon('chair')}${t.t('home.chip.seated')}</button>
    <button class="ba-chip ba-chip--text" type="button" data-action="mode" data-mode="quiet" aria-pressed="${s.quiet ? 'true' : 'false'}">${icon('quiet')}${t.t('home.chip.quiet')}</button>
    ${ctx.caps.local2 ? html`<button class="ba-chip ba-chip--text" type="button" data-action="mode" data-mode="duo" aria-pressed="${duoOnly ? 'true' : 'false'}">${icon('tv')}${t.t('home.chip.two')}</button>` : ''}
  </span>`;
}

function together(ctx: ViewContext): SafeHtml {
  if (!ctx.caps.local2) return html``;
  const t = ctx.i18n;
  const g = ctx.games.find((x) => supportsLocal2(x));
  if (!g) return html``;
  return html`<section class="ba-section" aria-labelledby="together"><header><h2 id="together">${t.t('home.together')}</h2></header>
    <div class="k-together"><a class="k-card" href="${ctx.href('game', { params: { slug: g.seo.slug } })}"><span class="pic">${icon('tv')}</span><div><h3>${t.t('home.together.two.title')}</h3><p>${t.t('home.together.two.body')}</p></div></a></div>
  </section>`;
}

function proTeaser(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const pro = proGames(ctx.games);
  if (hasPro(ctx) || pro.length === 0) return html``;
  return html`<section class="k-card ba-teaser" aria-labelledby="teaser-h">
    <div>
      <h2 class="k-h3" id="teaser-h">${t.t('paywall.title')}</h2>
      <p>${t.t('paywall.free', { n: ctx.games.length - pro.length })}</p>
    </div>
    <a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}">${t.t('settings.pro.see')}</a>
  </section>`;
}

export interface HomeOptions {
  /** A body region page; null is the home page. */
  region: BodyRegion | null;
  data?: HomeData;
}

export function homePage(ctx: ViewContext, o: HomeOptions): SafeHtml {
  const t = ctx.i18n;
  const { region } = o;
  const data = o.data ?? NO_HOME_DATA;
  const inRegions = region ? [region] : [];
  const filtered = filterGames(ctx.games, { regions: inRegions, seated: ctx.settings.seated, quiet: ctx.settings.quiet });
  const shownAll = region ? filtered.shown : orderForPlayer(filtered.shown, ctx.settings.regions);
  const shown = data.duoOnly ? shownAll.filter((g) => supportsLocal2(g)) : shownAll;
  const hiddenByModes = filtered.hiddenByModes;
  const free = ctx.games.filter((g) => g.free).length;

  const empty = html`<div class="k-card ba-empty" role="status">
    <h3 class="k-h3">${t.t('home.empty.title')}</h3>
    <p>${t.t('home.empty.body')}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('home')}">${t.t('home.empty.clear')}</a></div>
  </div>`;

  const hidden = hiddenByModes > 0
    ? html`<p class="ba-small ba-hiddennote">${t.t('home.hidden', { n: hiddenByModes })}</p>`
    : '';

  const top = region
    ? html`<div class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('workouts.title', { region: regionLabel(ctx, region) })}</h1></div>
       <p class="k-sub">${t.t('workouts.description', { region: regionLabel(ctx, region) })}</p>`
    : html`<section class="k-hero${data.week ? '' : ' k-hero--solo'}" aria-label="${t.t('brand.name')}">${hero(ctx)}${data.week ? weekCard(ctx, data.week, data.recent) : ''}</section>`;

  const main = html`
    ${top}
    <section class="ba-section k-allsec" aria-labelledby="games-h">
      <header class="k-allhead">
        <h2 id="games-h">${t.t('home.all')}</h2>
        <span class="ba-small" data-count>${t.t('home.countFree', { n: shown.length, free })}</span>
      </header>
      ${regionChips(ctx, region, modeChips(ctx, data.duoOnly))}
      <div>${shown.length ? gameGrid(ctx, shown, t.t('home.all')) : empty}</div>
      ${hidden}
    </section>
    ${together(ctx)}
    ${proTeaser(ctx)}`;

  return chrome(ctx, { tab: 'games', main, mainClass: region ? 'ba-page--region' : 'ba-page--home' });
}

export const regionHeading = (ctx: Pick<ViewContext, 'i18n'>, region: BodyRegion): string => ctx.i18n.t('workouts.title', { region: ctx.i18n.tx(`region.${region}`) });

