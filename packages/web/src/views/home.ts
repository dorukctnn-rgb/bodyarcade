// The home page and the body region pages: one view, because a region page is the home page with a filter on.
// Layout from the art director's home.html: a card for what to play now, the week against the daily line (once there
// is a week to show), every game with its body-region filter and the modes, and ways to play together.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { filterGames, inRegion, orderForPlayer, proGames, supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { ACTIVE_DAY_SECONDS, CHART_TOP_MINUTES, type RecentBest, type WeekStats } from '../app/arcade.ts';
import type { ChallengeToday } from '../../../core/store/daily-challenge.ts';
import { listPricePlans } from '../../../core/entitlements/plans.ts';
import { FREE_PLAN_ID, WORKOUT_PLANS } from '../../../core/store/workout-plans.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { describeOffer, type PlansConfig } from '../../../core/ui/plans.ts';
import { MAX_SEATS, MIN_SEATS } from '../../../core/types/net.ts';
import { hasPro, regionLabel, taglineOf, titleOf, type ViewContext } from '../context.ts';
import { canRace } from '../app/duel.ts';
import { chrome, sitePageHref } from './chrome.ts';
import { freeLine } from './paywall.ts';
import { NO_PLANS_DATA, planStrip, type PlansData } from './plans.ts';
import { modeStrip } from './modes.ts';
import { gameGrid, regionChips } from './tiles.ts';
import { weekdayNames } from './parts.ts';
import { REGION_ORDER } from '../routes.ts';
import { ROAD_RUN_WORLDS } from '../../../games/road-run/worlds.ts';
import { phoneHeight, SHOWCASE, SHOWCASE_PHONE_WEBP, SHOWCASE_SIZES_PHONE, SHOWCASE_SIZES_WIDE, SHOWCASE_WIDE_MIN, SHOWCASE_WIDE_WEBP, showcaseSrcset, wideHeight, type ShowcaseSlide } from '../showcase.ts';
import type { Preload } from '../document.ts';
import { HERO_CLIP_WIDE, heroClipHeight, heroClipSet } from '../clips.ts';
import { howHero } from './how.ts';
import { bandSection, coachSection, privacySection, todaySection } from './home-sections.ts';

/** What the home page knows about the player's weeks; empty on the server and for a new player. */
export interface HomeData {
  week: WeekStats | null;
  recent: RecentBest[];
  /** Mode chip "2 players" is on: only games that can be played by two. */
  duoOnly: boolean;
  /** The challenge of the day and where the player stands; null in a page drawn without a visitor. */
  challenge: ChallengeToday | null;
  /** The workout plans and the one that is going. */
  plans: PlansData;
}

export const NO_HOME_DATA: HomeData = { week: null, recent: [], duoOnly: false, challenge: null, plans: NO_PLANS_DATA };

/** The game shown large at the top of the home page: the first free game in menu order. */
export function featuredGame(ctx: ViewContext): ShellGame | undefined {
  return ctx.games.find((g) => g.free) ?? ctx.games[0];
}

/** The words on a frame: the game, and the Road Run world with its Pro mark when the world is part of Pro. */
function showcaseCaption(ctx: ViewContext, s: ShowcaseSlide): SafeHtml {
  const g = ctx.games.find((x) => x.id === s.game);
  if (!g) return html``;
  const w = s.world ? ROAD_RUN_WORLDS.find((x) => x.id === s.world) : undefined;
  return html`<span class="k-cap"><b>${titleOf(ctx, g)}</b>${w ? html`<span>${localized(w.name, ctx.lang)}</span>${w.free ? '' : html`<span class="ba-badge ba-badge--pro">${ctx.i18n.t('common.pro')}</span>`}` : ''}</span>`;
}

/**
 * The clip of a frame: a few seconds of the same game in play, over the frame's picture, with no address until the app plays it
 * (app/hero-reel.ts picks the file for the screen: AV1 in WebM or H.264 in MP4, the 21:9 or the 4:3 crop, the size). Out of the
 * layout (absolute, drawn only once it has an address), so the picture stays what the page's size is made of.
 */
function showcaseClip(ctx: ViewContext, s: ShowcaseSlide): SafeHtml {
  const url = (file: string): string => ctx.assets.clip(file);
  const w = HERO_CLIP_WIDE[HERO_CLIP_WIDE.length - 1] ?? 1920;
  return html`<video class="k-vid" data-webm-wide="${heroClipSet(s.id, 'wide', 'webm', url)}" data-mp4-wide="${heroClipSet(s.id, 'wide', 'mp4', url)}" data-webm-phone="${heroClipSet(s.id, 'phone', 'webm', url)}" data-mp4-phone="${heroClipSet(s.id, 'phone', 'mp4', url)}" width="${w}" height="${heroClipHeight('wide', w)}" muted loop playsinline disablepictureinpicture disableremoteplayback preload="none" aria-hidden="true" tabindex="-1" data-qa-layer></video>`;
}

/**
 * One frame of the showcase: the 21:9 crop from SHOWCASE_WIDE_MIN up, the 4:3 crop below it, AVIF first and one WebP size for the
 * rest. The first frame is the page's largest picture, so it is fetched first (and preloaded by the document head, showcasePreloads);
 * the others wait their turn. Frames 2 to 4 are drawn over the first one by design (they fade in over it): they carry data-qa-layer,
 * so the layout check does not take the first caption under them for two captions on top of each other.
 */
function showcaseFrame(ctx: ViewContext, s: ShowcaseSlide, first: boolean): SafeHtml {
  const a = (file: string): string => ctx.assets.hero(file);
  const media = `(min-width: ${SHOWCASE_WIDE_MIN}px)`;
  const ww = SHOWCASE_WIDE_WEBP;
  const pw = SHOWCASE_PHONE_WEBP;
  const load = first ? html`fetchpriority="high"` : html`loading="lazy" fetchpriority="low"`;
  return html`<div class="k-frame" data-frame="${s.id}"${first ? '' : html` data-qa-layer`}><picture>
      <source media="${media}" type="image/avif" srcset="${showcaseSrcset(s, 'wide', a)}" sizes="${SHOWCASE_SIZES_WIDE}" width="${ww}" height="${wideHeight(ww)}">
      <source media="${media}" type="image/webp" srcset="${a(`${s.id}-${ww}.webp`)} ${ww}w" sizes="${SHOWCASE_SIZES_WIDE}" width="${ww}" height="${wideHeight(ww)}">
      <source type="image/avif" srcset="${showcaseSrcset(s, 'phone', a)}" sizes="${SHOWCASE_SIZES_PHONE}" width="${pw}" height="${phoneHeight(pw)}">
      <img src="${a(`${s.id}-m-${pw}.webp`)}" alt="" width="${pw}" height="${phoneHeight(pw)}" ${load} decoding="async">
    </picture>${showcaseClip(ctx, s)}${showcaseCaption(ctx, s)}</div>`;
}

/** The frames of the real games at the top of the home page (src/showcase.ts); one after the other unless motion is reduced. */
export function showcase(ctx: ViewContext): SafeHtml {
  return html`<div class="k-reel" aria-hidden="true">${SHOWCASE.map((s, i) => showcaseFrame(ctx, s, i === 0))}<span class="k-ticks">${SHOWCASE.map(() => html`<i></i>`)}</span></div>`;
}

/** The head links that fetch the first frame of the showcase before the styles are in: one per crop, AVIF (a browser without AVIF skips them). */
export function showcasePreloads(ctx: ViewContext): Preload[] {
  const s = SHOWCASE[0];
  if (!s) return [];
  const a = (file: string): string => ctx.assets.hero(file);
  return [
    { srcset: showcaseSrcset(s, 'wide', a), sizes: SHOWCASE_SIZES_WIDE, media: `(min-width: ${SHOWCASE_WIDE_MIN}px)`, type: 'image/avif' },
    { srcset: showcaseSrcset(s, 'phone', a), sizes: SHOWCASE_SIZES_PHONE, media: `(max-width: ${SHOWCASE_WIDE_MIN - 0.02}px)`, type: 'image/avif' },
  ];
}

function hero(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const g = featuredGame(ctx);
  // The page's heading and its two buttons are the scene above (views/how.ts); this card shows the games themselves.
  return html`<article class="k-today k-show" aria-labelledby="home-show-h">
    ${showcase(ctx)}
    <div class="body">
      <h2 class="k-showh" id="home-show-h">${t.t('home.h1')}</h2>
      <p class="lead">${t.t('home.lead', { n: ctx.games.length })}</p>
      ${g ? html`<div class="k-actions"><a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${icon('play')}<span>${t.t('home.cta.play', { game: titleOf(ctx, g) })}</span></a></div>` : ''}
    </div>
  </article>`;
}

/** The week card: minutes per day against the line of an active day, the week and day streaks, and the recent bests. */
function weekCard(ctx: ViewContext, w: WeekStats, recent: RecentBest[]): SafeHtml {
  const t = ctx.i18n;
  const names = weekdayNames(t.tag);
  const long = new Intl.DateTimeFormat(t.tag, { weekday: 'long', timeZone: 'UTC' });
  const level = (m: number | null): number => (m === null ? 1 : Math.max(1, Math.min(20, Math.round((Math.min(m, CHART_TOP_MINUTES) / CHART_TOP_MINUTES) * 20))));
  const lineMinutes = Math.round(ACTIVE_DAY_SECONDS / 60);
  const aria = t.t('home.week.chart', {
    days: w.days.filter((d) => d.minutes !== null).map((d) => `${long.format(new Date(`${d.day}T00:00:00Z`))} ${d.minutes}`).join(', '),
    goal: lineMinutes,
  });
  const goalLevel = Math.round((lineMinutes / CHART_TOP_MINUTES) * 20);
  const goalLine = w.met ? t.t('home.week.goal.met', { days: w.activeDays }) : t.t('home.week.goal', { days: w.activeDays, goal: w.goal });
  const streaks = [w.weekStreak > 0 ? t.t('home.week.weekStreak', { n: w.weekStreak }) : '', w.dayStreak >= 2 ? t.t('home.week.dayStreak', { n: w.dayStreak }) : ''].filter(Boolean).join(' ');
  const dayName = (day: string): string => {
    const d = w.days.find((x) => x.day === day);
    return d?.today ? t.t('home.today') : d ? (names[d.index] ?? '') : t.date(new Date(`${day}T00:00:00Z`), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return html`<aside class="k-card k-week" aria-labelledby="week-h">
    <div class="top"><h2 class="k-h3" id="week-h">${t.t('home.week.title')}</h2></div>
    <div class="big">${t.number(w.totalMinutes)}<small>${t.t('home.week.minutes')}</small></div>
    <div class="k-bars" role="img" aria-label="${aria}">
      ${w.days.map((d) => html`<i class="h${level(d.minutes)} ${d.minutes === null ? 'later' : d.today ? 'now' : d.hit ? 'hit' : ''}"></i>`)}
      <span class="goal g${goalLevel}"><span>${t.t('home.week.line', { n: lineMinutes })}</span></span>
    </div>
    <div class="k-days" aria-hidden="true">${w.days.map((d) => html`<span>${names[d.index] ?? ''}</span>`)}</div>
    <p class="ba-small" data-week-goal>${goalLine}${streaks ? ` ${streaks}` : ''}</p>
    ${w.weekStreak === 0 && !w.met ? html`<p class="ba-small">${t.t('home.week.start', { goal: w.goal, n: lineMinutes })}</p>` : ''}
    ${recent.length ? html`<div class="bests"><span class="k-label">${t.t('home.bests')}</span>
      <ul class="k-mix">${recent.map((b) => {
        const g = ctx.games.find((x) => x.id === b.game);
        return g ? html`<li><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="56" height="42"><div><b>${t.number(b.score)}</b><small>${titleOf(ctx, g)}</small></div><span class="min">${dayName(b.day)}</span></li>` : '';
      })}</ul></div>` : ''}
  </aside>`;
}

/** The challenge of the day: one free game, the same for everybody on the same date, done by a minute of play. */
function challengeCard(ctx: ViewContext, c: ChallengeToday | null): SafeHtml {
  const ch = c?.challenge;
  if (!c || !ch) return html``;
  const g = ctx.games.find((x) => x.id === ch.game);
  if (!g) return html``;
  const t = ctx.i18n;
  const href = ctx.href('game', { params: { slug: g.seo.slug } });
  return html`<section class="k-card k-challenge" aria-labelledby="challenge-h" data-challenge="${g.id}">
    <img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="160" height="120">
    <div class="body">
      <h2 class="k-h3" id="challenge-h">${t.t('challenge.title')}</h2>
      <p>${t.t('challenge.body', { game: titleOf(ctx, g), n: Math.max(1, Math.round(ch.minSeconds / 60)) })}</p>
      ${c.done ? html`<p class="ok" role="status">${icon('check')}<span>${t.t('challenge.done')}</span></p>` : ''}
      ${c.bonus ? html`<p class="ok">${icon('star')}<span>${t.t('challenge.bonus')}</span></p>` : ''}
      <p class="ba-small">${t.t('challenge.week', { n: c.doneThisWeek })}</p>
      <div class="ba-actions"><a class="ba-btn ${c.done ? 'ba-btn--secondary' : 'ba-btn--primary'}" href="${href}">${icon('play')}<span>${t.t('home.cta.play', { game: titleOf(ctx, g) })}</span></a></div>
    </div>
  </section>`;
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
      <p>${freeLine(ctx, ctx.games.length - pro.length)}</p>
    </div>
    <a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}">${t.t('settings.pro.see')}</a>
  </section>`;
}

/** The games of a body region page and how many of them are free, whatever the player's modes (its title and description say these). */
export function regionGames(games: readonly ShellGame[], region: BodyRegion): { n: number; free: number } {
  const list = games.filter((g) => inRegion(g, region));
  return { n: list.length, free: list.filter((g) => g.free).length };
}

/**
 * The plans and prices the home page states. A page drawn without a visitor (what a crawler and a browser without scripts read) has
 * the web list prices of core/entitlements/plans.ts; the app draws the plans of where it runs (Google Play's own in the Android app),
 * and none while that is not known yet.
 */
function homeOffers(ctx: ViewContext): PlansConfig | null {
  if (ctx.server) return listPricePlans();
  if ((ctx.paywall.mode === 'web' || ctx.paywall.mode === 'play') && ctx.plans.offers.length > 0) return ctx.plans;
  return null;
}

/**
 * What BodyArcade is, in words that stand without scripts: the games and how many are free, the live races, where it plays, the
 * workout plans and what Pro costs. Every number is the catalogue's, the plans' or the price list's own.
 */
function aboutSection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const n = ctx.games.length;
  const free = ctx.games.filter((g) => g.free).length;
  const live = ctx.server || ctx.flags.social ? ctx.games.filter((g) => canRace(g)) : [];
  const freePlan = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
  const offers = hasPro(ctx) ? null : homeOffers(ctx);
  const web = ctx.server || ctx.paywall.mode === 'web';
  const prices = offers
    ? html`<div class="k-card k-about-prices"${web ? html` data-web-pay` : ''}>
        <h3 class="k-h3">${t.t('home.about.prices')}</h3>
        <ul>${offers.offers.map((o) => { const d = describeOffer(o, t, offers); return html`<li><b>${d.name}</b><span>${d.trialLine ?? d.priceLine}</span></li>`; })}</ul>
        ${web ? html`<p><a class="ba-link" href="${sitePageHref(ctx.lang, 'pricing')}" data-native>${t.t('home.about.pricing')}</a></p>` : ''}
      </div>`
    : '';
  return html`<section class="ba-section k-about" aria-labelledby="about-h"><header><h2 id="about-h">${t.t('home.about.title')}</h2></header>
    <div class="k-about-grid">
      <div class="k-about-text">
        <p class="k-about-lead">${t.t('home.about.body', { n })}</p>
        <ul class="k-about-facts">
          <li>${icon('arcade')}<span>${t.t('home.about.free', { n, free })}</span></li>
          ${live.length ? html`<li>${icon('friends')}<span>${t.t('home.about.live', { names: t.list(live.map((g) => (g.free ? titleOf(ctx, g) : `${titleOf(ctx, g)} (${t.t('common.pro')})`))), min: MIN_SEATS, max: MAX_SEATS })}</span></li>` : ''}
          <li>${icon('globe')}<span>${t.t('home.about.where')}</span></li>
          <li>${icon('programs')}<span>${t.t('home.about.plans', { n: WORKOUT_PLANS.length, free: freePlan ? localized(freePlan.title, ctx.lang) : '' })} <a class="ba-link" href="${ctx.href('plans')}">${t.t('home.about.plansLink')}</a></span></li>
        </ul>
        <p class="k-about-pages">${t.t('home.about.games')} ${ctx.games.map((g, i) => html`${i ? ', ' : ''}<a href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${titleOf(ctx, g)}</a>`)}. ${t.t('home.about.regions')} ${REGION_ORDER.map((r, i) => html`${i ? ', ' : ''}<a href="${ctx.href('region', { params: { region: r } })}">${regionLabel(ctx, r)}</a>`)}.</p>
      </div>
      ${prices}
    </div>
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
  // The count line says how many of the games on the page are free ("5 games, 4 free" on a region page), never the free games of the
  // whole catalogue next to the games of one region.
  const free = shown.filter((g) => g.free).length;

  const empty = html`<div class="k-card ba-empty" role="status">
    <h3 class="k-h3">${t.t('home.empty.title')}</h3>
    <p>${t.t('home.empty.body')}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('home')}">${t.t('home.empty.clear')}</a></div>
  </div>`;

  const hidden = hiddenByModes > 0
    ? html`<p class="ba-small ba-hiddennote">${t.t('home.hidden', { n: hiddenByModes })}</p>`
    : '';

  // The home page in the order of Kol G (Apple Fitness+ line): 1 what BodyArcade is (the scene), 2 the before/after band, 3 the games,
  // 4 the form coach, 5 Today and the progress coach, 6 duels, the office break and family mode, 7 privacy; then the rest.
  const top = region
    ? html`<div class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('workouts.title', { region: regionLabel(ctx, region) })}</h1></div>
       <p class="k-sub">${t.t('workouts.description', { region: regionLabel(ctx, region), ...regionGames(ctx.games, region) })}</p>`
    : html`${howHero(ctx, featuredGame(ctx))}${bandSection(ctx)}<section class="k-hero${data.week ? '' : ' k-hero--solo'}" aria-label="${t.t('brand.name')}">${hero(ctx)}${data.week ? weekCard(ctx, data.week, data.recent) : ''}</section>`;

  const main = html`
    ${top}
    ${region ? '' : challengeCard(ctx, data.challenge)}
    <section class="ba-section k-allsec" aria-labelledby="games-h">
      <header class="k-allhead">
        <h2 id="games-h">${t.t('home.all')}</h2>
        <span class="ba-small" data-count>${t.t('home.countFree', { n: shown.length, free })}</span>
      </header>
      ${regionChips(ctx, region, modeChips(ctx, data.duoOnly))}
      <div>${shown.length ? gameGrid(ctx, shown, t.t('home.all')) : empty}</div>
      ${hidden}
    </section>
    ${region ? '' : planStrip(ctx, data.plans)}
    ${region ? '' : coachSection(ctx)}
    ${region ? '' : todaySection(ctx)}
    ${region ? '' : modeStrip(ctx)}
    ${region ? '' : privacySection(ctx)}
    ${together(ctx)}
    ${proTeaser(ctx)}
    ${region ? '' : aboutSection(ctx)}`;

  return chrome(ctx, { tab: 'games', main, mainClass: region ? 'ba-page--region' : 'ba-page--home' });
}

export const regionHeading = (ctx: Pick<ViewContext, 'i18n'>, region: BodyRegion): string => ctx.i18n.t('workouts.title', { region: ctx.i18n.tx(`region.${region}`) });

