// The home page and the body region pages: one view, because a region page is the home page with a filter on.
// The home page is also the landing page of the site (bodyarcade.com): colour worlds in the style of peakappsstudio.com, each with
// real play on screen. A hero with Squat Flap played by a real person, a scroll stage that turns the camera picture into the game,
// every game with its body-region filter and the modes, real people playing three more games, two players on one camera and live
// races, the workout plans and the challenge of the day, what happens to the camera video, and what BodyArcade is and costs.
// A returning player (a week to show) gets the week and the games first. The moving parts (loops, the scroll stage, tilting
// tiles) are app/home-motion.ts; without scripts, with reduced motion or Save-Data the page is complete with its posters.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { filterGames, gameById, inRegion, orderForPlayer, proGames, supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { ACTIVE_DAY_SECONDS, CHART_TOP_MINUTES, type RecentBest, type WeekStats } from '../app/arcade.ts';
import type { ChallengeToday } from '../../../core/store/daily-challenge.ts';
import { listPricePlans } from '../../../core/entitlements/plans.ts';
import { FREE_PLAN_ID, WORKOUT_PLANS } from '../../../core/store/workout-plans.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { describeOffer, type PlansConfig } from '../../../core/ui/plans.ts';
import { MAX_SEATS, MIN_SEATS } from '../../../core/types/net.ts';
import { HOME_CLIPS, homeClipName, type HomeClip } from '../assets.ts';
import { hasPro, regionLabel, taglineOf, titleOf, type ViewContext } from '../context.ts';
import { canRace } from '../app/duel.ts';
import { chrome, siteGuideHref, sitePageHref } from './chrome.ts';
import { freeLine } from './paywall.ts';
import { NO_PLANS_DATA, planStrip, type PlansData } from './plans.ts';
import { defaultSetup, playHref } from './setup.ts';
import { gameGrid, regionChips } from './tiles.ts';
import { weekdayNames } from './parts.ts';

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

/** Where the Android test is joined (the tester page of Peak Apps Studio, the maker). Shown on the web only, never inside the Android app. */
export const ANDROID_TEST_URL = 'https://peakappsstudio.com/testers/';

/** The page that says what happens to the camera video (English only; the Turkish page links to it too). */
const CAMERA_POST = '/blog/what-happens-to-your-camera-video';

// ---- loops of real play -------------------------------------------------------------------------------------------------

interface ClipOptions {
  /** Words for the poster; '' makes the loop decorative (its words are next to it). */
  alt: string;
  /** The `sizes` of the poster's srcset. */
  sizes: string;
  /** The poster is what the first screen shows: loaded at once and first. */
  first?: boolean;
  className?: string;
}

/**
 * A loop of real play: the poster (a still of its first picture) is the picture of the page, and the motion script puts a video of the
 * width the box needs over it once the page has loaded and the loop is near the screen. `data-srcs` holds every width's WebM and MP4.
 */
function clip(ctx: ViewContext, id: HomeClip, o: ClipOptions): SafeHtml {
  const spec = HOME_CLIPS[id];
  const name = homeClipName(id, ctx.lang);
  const widths = [...spec.widths];
  const [w0, w1] = [widths[0] ?? 540, widths[widths.length - 1] ?? 720];
  const h1 = Math.round(w1 / spec.aspect);
  const srcs: Record<string, [string, string]> = {};
  for (const w of widths) srcs[String(w)] = [ctx.assets.home(`${name}-${w}.webm`), ctx.assets.home(`${name}-${w}.mp4`)];
  const srcset = widths.map((w) => `${ctx.assets.home(`${name}-${w}.webp`)} ${w}w`).join(', ');
  return html`<figure class="hm-clip${o.className ? ` ${o.className}` : ''}" data-clip="${id}" data-srcs="${JSON.stringify(srcs)}">
    <img src="${ctx.assets.home(`${name}-${w0}.webp`)}" srcset="${srcset}" sizes="${o.sizes}" width="${w1}" height="${h1}" alt="${o.alt}"${o.first ? html` fetchpriority="high"` : html` loading="lazy"`} decoding="async">
    <video muted playsinline loop preload="none" aria-hidden="true" tabindex="-1" disablepictureinpicture></video>
  </figure>`;
}

// ---- the hero ------------------------------------------------------------------------------------------------------------

/** The Play button of the hero: straight into a round of the featured game (the camera is explained and asked for there, never here). */
function playNow(ctx: ViewContext, g: ShellGame, cls: string): SafeHtml {
  return html`<a class="${cls}" href="${playHref(ctx, g, defaultSetup(ctx, g))}" data-action="play-now">${icon('play')}<span>${ctx.i18n.t('home.cta.play', { game: titleOf(ctx, g) })}</span></a>`;
}

function hero(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const g = featuredGame(ctx);
  const n = ctx.games.length;
  const free = ctx.games.filter((x) => x.free).length;
  const words = t.t('home.band').split(',').map((w) => w.trim()).filter(Boolean);
  const band = html`${words.map((w, i) => html`<span class="${i % 2 ? 'o' : ''}">${w}</span>`)}`;
  return html`<section class="hm hm-hero" aria-labelledby="home-h1">
    <div class="hm-wrap hm-hero-grid">
      <div class="hm-hero-copy">
        <h1 id="home-h1" class="hm-h1" data-main-heading>${t.t('home.h1')}</h1>
        <p class="hm-lead">${t.t('home.lead', { n })}</p>
        <div class="hm-actions">
          ${g ? playNow(ctx, g, 'hm-btn hm-btn--light') : ''}
          <a class="hm-btn hm-btn--ghost" href="${ctx.href('welcome')}">${t.t('home.cta.how')}</a>
        </div>
        <p class="hm-assure">${icon('shield')}<span>${t.t('footer.camera')}</span></p>
      </div>
      <div class="hm-hero-stage">
        <span class="hm-burst hm-burst--a" aria-hidden="true"><span>${t.t('home.sticker.games', { n })}</span></span>
        <span class="hm-burst hm-burst--b" aria-hidden="true"><span>${t.t('home.sticker.free', { free })}</span></span>
        <div class="hm-phone hm-phone--hero"><div class="hm-screen">${clip(ctx, 'squat', { alt: t.t('home.hero.clip'), sizes: '(min-width: 1100px) 360px, (min-width: 761px) 30vw, 62vw', first: true })}</div></div>
      </div>
    </div>
    <div class="hm-band" aria-hidden="true"><div class="hm-band-track"><div class="hm-band-run">${band}</div><div class="hm-band-run">${band}</div></div></div>
  </section>`;
}

// ---- the scroll stage: the camera picture becomes the game ---------------------------------------------------------------

function cameraStage(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const steps = [1, 2, 3] as const;
  return html`<section class="hm hm-cam" id="how-it-works" aria-labelledby="cam-h">
    <div class="hm-cam-track">
      <div class="hm-cam-stick">
        <div class="hm-cam-words" aria-hidden="true"><span data-w="1">${t.t('home.cam.word1')}</span><span data-w="2">${t.t('home.cam.word2')}</span><span data-w="3">${t.t('home.cam.word3')}</span></div>
        <div class="hm-wrap hm-cam-grid">
          <div class="hm-cam-copy">
            <h2 id="cam-h" class="hm-h2">${t.t('home.cam.title')}</h2>
            <ol class="hm-steps">${steps.map((s) => html`<li data-step="${s}"${attr('class', s === 1 && 'on')}><b>${t.tx(`home.cam.step${s}.title`)}</b><span>${t.tx(`home.cam.step${s}.body`)}</span></li>`)}</ol>
          </div>
          <div class="hm-cam-device">
            <div class="hm-phone hm-phone--stage">
              <div class="hm-screen">
                ${clip(ctx, 'squat', { alt: t.t('home.cam.alt'), sizes: '(min-width: 761px) 380px, 60vw', className: 'hm-clip--game' })}
                <div class="hm-camlayer">${clip(ctx, 'squat-cam', { alt: '', sizes: '(min-width: 761px) 380px, 60vw', className: 'hm-clip--cam' })}<span class="hm-camtag"><i></i>${t.t('home.cam.camera')}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

// ---- the games ----------------------------------------------------------------------------------------------------------

function modeChips(ctx: ViewContext, duoOnly: boolean): SafeHtml {
  const t = ctx.i18n;
  const s = ctx.settings;
  return html`<span class="k-modes">
    <button class="ba-chip ba-chip--text" type="button" data-action="mode" data-mode="seated" aria-pressed="${s.seated ? 'true' : 'false'}">${icon('chair')}${t.t('home.chip.seated')}</button>
    <button class="ba-chip ba-chip--text" type="button" data-action="mode" data-mode="quiet" aria-pressed="${s.quiet ? 'true' : 'false'}">${icon('quiet')}${t.t('home.chip.quiet')}</button>
    ${ctx.caps.local2 ? html`<button class="ba-chip ba-chip--text" type="button" data-action="mode" data-mode="duo" aria-pressed="${duoOnly ? 'true' : 'false'}">${icon('tv')}${t.t('home.chip.two')}</button>` : ''}
  </span>`;
}

interface Shown { shown: ShellGame[]; hiddenByModes: number }

function shownGames(ctx: ViewContext, region: BodyRegion | null, data: HomeData): Shown {
  const filtered = filterGames(ctx.games, { regions: region ? [region] : [], seated: ctx.settings.seated, quiet: ctx.settings.quiet });
  const shownAll = region ? filtered.shown : orderForPlayer(filtered.shown, ctx.settings.regions);
  const shown = data.duoOnly ? shownAll.filter((g) => supportsLocal2(g)) : shownAll;
  return { shown, hiddenByModes: filtered.hiddenByModes };
}

function emptyGames(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-card ba-empty" role="status">
    <h3 class="k-h3">${t.t('home.empty.title')}</h3>
    <p>${t.t('home.empty.body')}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('home')}">${t.t('home.empty.clear')}</a></div>
  </div>`;
}

/** Every game, the body-region chips and the modes: the menu of the app, in its own colour on the home page. */
function gamesWall(ctx: ViewContext, data: HomeData): SafeHtml {
  const t = ctx.i18n;
  const { shown, hiddenByModes } = shownGames(ctx, null, data);
  // The count line says how many of the games shown are free; the title says the catalogue's own numbers.
  const free = shown.filter((g) => g.free).length;
  const n = ctx.games.length;
  const allFree = ctx.games.filter((g) => g.free).length;
  return html`<section class="hm hm-games ba-section k-allsec" id="games" aria-labelledby="games-h">
    <div class="hm-wrap">
      <header class="hm-games-head k-allhead">
        <h2 id="games-h" class="hm-h2">${t.t('home.games.title', { n, free: allFree })}</h2>
        <p class="hm-games-lead">${t.t('home.games.lead')} <span class="hm-count" data-count>${t.t('home.countFree', { n: shown.length, free })}</span></p>
      </header>
      ${regionChips(ctx, null, modeChips(ctx, data.duoOnly))}
      <div>${shown.length ? gameGrid(ctx, shown, t.t('home.all')) : emptyGames(ctx)}</div>
      ${hiddenByModes > 0 ? html`<p class="ba-small ba-hiddennote">${t.t('home.hidden', { n: hiddenByModes })}</p>` : ''}
    </div>
  </section>`;
}

// ---- real people, three more games ---------------------------------------------------------------------------------------

const REEL: readonly { game: string; clip: HomeClip; move: 'knee' | 'jacks' | 'pad'; colour: string }[] = [
  { game: 'knee-sprint', clip: 'knee', move: 'knee', colour: '#FFC53A' },
  { game: 'firework-jacks', clip: 'jacks', move: 'jacks', colour: '#46B4FF' },
  { game: 'pad-work', clip: 'pad', move: 'pad', colour: '#F4F2F8' },
];

function reel(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const cards = REEL.flatMap((r, i) => {
    const g = gameById(ctx.games, r.game);
    if (!g) return [];
    const pro = !g.free && !hasPro(ctx) ? html`<span class="ba-badge ba-badge--pro">${t.t('common.pro')}</span>` : '';
    return [html`<li class="hm-rcard" style="--c:${r.colour};--i:${i}">
      <a href="${ctx.href('game', { params: { slug: g.seo.slug } })}">
        <span class="hm-phone hm-phone--card"><span class="hm-screen">${clip(ctx, r.clip, { alt: t.tx(`home.reel.alt.${r.move}`), sizes: '(min-width: 1100px) 300px, (min-width: 761px) 28vw, 64vw' })}</span></span>
        <span class="hm-rcard-text"><b>${titleOf(ctx, g)}</b>${pro}<span class="hm-move">${t.tx(`home.reel.move.${r.move}`)}</span><span class="hm-tag">${taglineOf(ctx, g)}</span></span>
      </a>
    </li>`];
  });
  if (!cards.length) return html``;
  return html`<section class="hm hm-reel" aria-labelledby="reel-h">
    <div class="hm-wrap">
      <header class="hm-reel-head"><h2 id="reel-h" class="hm-h2">${t.t('home.reel.title')}</h2><p class="hm-lead">${t.t('home.reel.lead')}</p></header>
    </div>
    <ul class="hm-reel-row" role="list">${cards}</ul>
    <div class="hm-wrap"><p class="hm-credit">${t.t('home.reel.credit')}</p></div>
  </section>`;
}

// ---- together: two players on one camera, live races --------------------------------------------------------------------

function liveNames(ctx: ViewContext): ShellGame[] {
  return ctx.server || ctx.flags.social ? ctx.games.filter((g) => canRace(g)) : [];
}

function together(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const duoGame = gameById(ctx.games, 'firework-jacks') ?? ctx.games.find((g) => supportsLocal2(g));
  const live = liveNames(ctx);
  const names = t.list(live.map((g) => (g.free ? titleOf(ctx, g) : `${titleOf(ctx, g)} (${t.t('common.pro')})`)));
  return html`<section class="hm hm-duo" aria-labelledby="duo-h">
    <div class="hm-wrap hm-duo-grid">
      <div class="hm-tv"><div class="hm-tv-screen">${clip(ctx, 'duo', { alt: t.t('home.duo.alt'), sizes: '(min-width: 1100px) 640px, (min-width: 761px) 54vw, 92vw' })}</div><span class="hm-tv-foot" aria-hidden="true"></span></div>
      <div class="hm-duo-copy">
        <h2 id="duo-h" class="hm-h2">${t.t('home.together')}</h2>
        <div class="hm-duo-item">
          <h3>${icon('tv')}<span>${t.t('home.together.two.title')}</span></h3>
          <p>${t.t('home.duo.body')}</p>
          ${ctx.caps.local2 && duoGame ? html`<p><a class="hm-btn hm-btn--ink" href="${ctx.href('game', { params: { slug: duoGame.seo.slug } })}">${icon('users')}<span>${t.t('home.duo.cta', { game: titleOf(ctx, duoGame) })}</span></a></p>` : ''}
        </div>
        ${live.length ? html`<div class="hm-duo-item">
          <h3>${icon('friends')}<span>${t.t('home.duo.live')}</span></h3>
          <p>${t.t('home.about.live', { names, min: MIN_SEATS, max: MAX_SEATS })}</p>
        </div>` : ''}
        <p><a class="hm-link" href="${siteGuideHref(ctx.lang, 'friends')}" data-native>${t.t('home.duo.guide')}</a></p>
      </div>
    </div>
  </section>`;
}

// ---- today: the challenge of the day and the workout plans (drawn by the app for its player) ------------------------------

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

/** The player's own things: the week (once there is one), the challenge of the day, the workout plans. Nothing on the server. */
function today(ctx: ViewContext, data: HomeData, o: { week: boolean }): SafeHtml {
  const week = o.week && data.week ? weekCard(ctx, data.week, data.recent) : '';
  const challenge = challengeCard(ctx, data.challenge);
  const plans = planStrip(ctx, data.plans);
  if (!week && !challenge.value && !plans.value) return html``;
  return html`<section class="hm hm-today" aria-label="${ctx.i18n.t('home.today')}"><div class="hm-wrap hm-today-grid${week ? ' has-week' : ''}">${week}<div class="hm-today-main">${challenge}${plans}</div></div></section>`;
}

// ---- the camera video ----------------------------------------------------------------------------------------------------

function privacy(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<section class="hm hm-private" aria-labelledby="private-h">
    <div class="hm-wrap">
      <span class="hm-lock" aria-hidden="true">${icon('camera')}</span>
      <h2 id="private-h" class="hm-mega">${t.t('home.private.title')}</h2>
      <ul class="hm-facts">
        <li>${icon('shield')}<span>${t.t('home.private.read')}</span></li>
        <li>${icon('lock')}<span>${t.t('home.private.upload')}</span></li>
        <li>${icon('user')}<span>${t.t('home.private.account')}</span></li>
      </ul>
      <p class="hm-links"><a class="hm-link" href="${CAMERA_POST}" data-native>${t.t('home.private.blog')}</a><a class="hm-link" href="${sitePageHref(ctx.lang, 'privacy')}" data-native>${t.t('home.private.policy')}</a></p>
    </div>
  </section>`;
}

// ---- what BodyArcade is and costs ---------------------------------------------------------------------------------------

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
  const live = liveNames(ctx);
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
  // The Android test is the web's to offer: inside the Android app the player has it already.
  const android = ctx.caps.platform === 'android-app' ? '' : html`<li>${icon('download')}<span>${t.t('home.android')} <a class="ba-link" href="${ANDROID_TEST_URL}">${t.t('home.android.join')}</a></span></li>`;
  return html`<section class="hm hm-about ba-section k-about" aria-labelledby="about-h">
    <div class="hm-wrap">
      <header><h2 id="about-h" class="hm-h2">${t.t('home.about.title')}</h2></header>
      <div class="k-about-grid">
        <div class="k-about-text">
          <p class="k-about-lead">${t.t('home.about.body', { n })}</p>
          <ul class="k-about-facts">
            <li>${icon('arcade')}<span>${t.t('home.about.free', { n, free })}</span></li>
            ${live.length ? html`<li>${icon('friends')}<span>${t.t('home.about.live', { names: t.list(live.map((g) => (g.free ? titleOf(ctx, g) : `${titleOf(ctx, g)} (${t.t('common.pro')})`))), min: MIN_SEATS, max: MAX_SEATS })}</span></li>` : ''}
            <li>${icon('globe')}<span>${t.t('home.about.where')}</span></li>
            <li>${icon('programs')}<span>${t.t('home.about.plans', { n: WORKOUT_PLANS.length, free: freePlan ? localized(freePlan.title, ctx.lang) : '' })} <a class="ba-link" href="${ctx.href('plans')}">${t.t('home.about.plansLink')}</a></span></li>
            ${android}
          </ul>
        </div>
        ${prices}
      </div>
      ${proTeaser(ctx)}
    </div>
  </section>`;
}

// ---- the pages -----------------------------------------------------------------------------------------------------------

export interface HomeOptions {
  /** A body region page; null is the home page. */
  region: BodyRegion | null;
  data?: HomeData;
}

/** A body region page: its heading, the games of the region with the chips and the modes, playing together, Pro. */
function regionPage(ctx: ViewContext, region: BodyRegion, data: HomeData): SafeHtml {
  const t = ctx.i18n;
  const { shown, hiddenByModes } = shownGames(ctx, region, data);
  const free = shown.filter((g) => g.free).length;
  const g2 = ctx.caps.local2 ? ctx.games.find((x) => supportsLocal2(x)) : undefined;
  const main = html`
    <div class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('workouts.title', { region: regionLabel(ctx, region) })}</h1></div>
    <p class="k-sub">${t.t('workouts.description', { region: regionLabel(ctx, region), ...regionGames(ctx.games, region) })}</p>
    <section class="ba-section k-allsec" aria-labelledby="games-h">
      <header class="k-allhead">
        <h2 id="games-h">${t.t('home.all')}</h2>
        <span class="ba-small" data-count>${t.t('home.countFree', { n: shown.length, free })}</span>
      </header>
      ${regionChips(ctx, region, modeChips(ctx, data.duoOnly))}
      <div>${shown.length ? gameGrid(ctx, shown, t.t('home.all')) : emptyGames(ctx)}</div>
      ${hiddenByModes > 0 ? html`<p class="ba-small ba-hiddennote">${t.t('home.hidden', { n: hiddenByModes })}</p>` : ''}
    </section>
    ${g2 ? html`<section class="ba-section" aria-labelledby="together"><header><h2 id="together">${t.t('home.together')}</h2></header>
      <div class="k-together"><a class="k-card" href="${ctx.href('game', { params: { slug: g2.seo.slug } })}"><span class="pic">${icon('tv')}</span><div><h3>${t.t('home.together.two.title')}</h3><p>${t.t('home.together.two.body')}</p></div></a></div>
    </section>` : ''}
    ${proTeaser(ctx)}`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--region' });
}

export function homePage(ctx: ViewContext, o: HomeOptions): SafeHtml {
  const data = o.data ?? NO_HOME_DATA;
  if (o.region) return regionPage(ctx, o.region, data);
  // A player who has played gets the week and the games before the story; a new visitor (and a crawler) gets the story first.
  const back = data.week !== null;
  const main = back
    ? html`${hero(ctx)}${today(ctx, data, { week: true })}${gamesWall(ctx, data)}${cameraStage(ctx)}${reel(ctx)}${together(ctx)}${privacy(ctx)}${aboutSection(ctx)}`
    : html`${hero(ctx)}${cameraStage(ctx)}${gamesWall(ctx, data)}${reel(ctx)}${together(ctx)}${today(ctx, data, { week: false })}${privacy(ctx)}${aboutSection(ctx)}`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--home hm-root' });
}

export const regionHeading = (ctx: Pick<ViewContext, 'i18n'>, region: BodyRegion): string => ctx.i18n.t('workouts.title', { region: ctx.i18n.tx(`region.${region}`) });
