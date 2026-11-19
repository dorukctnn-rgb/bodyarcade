// The sports home page: the hero ("live skeleton": a real athlete on a loop, our body line and score pops over them, drawn by
// app/hero-live.ts), the area picker, how it works, the body areas, Pro, the questions and the last call. The other sections of
// the home page (the games, the modes, the coaches, privacy, what BodyArcade is) stay in views/home.ts and home-sections.ts.
//
// Two type faces only: the display face (Anton, styles/sport.css) for the big headings, the system fonts for everything else.
// Every number on the page is the catalogue's or the price list's own; the athlete is example footage and says nothing about us.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { describeOffer, type PlansConfig } from '../../../core/ui/plans.ts';
import { inRegion, proGames } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { ARENA, ARENA_TALL_QUERY, CAPTURED_GAMES, CAPTURE_WIDTHS, FINAL_STILLS, HOW_STILLS, HOW_STILL_SIZE, captureFile } from '../arena.ts';
import { durationLabel, hasPro, mainRegion, regionLabel, titleOf, type ViewContext } from '../context.ts';
import type { Preload } from '../document.ts';
import { REGION_ORDER } from '../routes.ts';
import { sitePageHref } from './chrome.ts';
import { freeLine } from './paywall.ts';

const gameHref = (ctx: ViewContext, g: ShellGame): string => ctx.href('game', { params: { slug: g.seo.slug } });

/** A frame of the game in play (4:3), or its catalogue tile where there is no frame. */
export function gamePicture(ctx: ViewContext, g: ShellGame, sizes: string, eager = false): SafeHtml {
  const load = eager ? html`decoding="async"` : html`loading="lazy" decoding="async"`;
  if (!CAPTURED_GAMES.includes(g.id)) {
    const stem = g.catalogue.tile;
    return html`<img src="${ctx.assets.tile(stem, 400)}" srcset="${ctx.assets.tile(stem, 400)} 400w, ${ctx.assets.tile(stem, 800)} 800w" sizes="${sizes}" width="400" height="300" alt="" ${load}>`;
  }
  const [small, big] = CAPTURE_WIDTHS;
  const a = (w: (typeof CAPTURE_WIDTHS)[number]): string => ctx.assets.hero(captureFile(g.id, w));
  return html`<img src="${a(small)}" srcset="${a(small)} ${small}w, ${a(big)} ${big}w" sizes="${sizes}" width="${small}" height="${(small * 3) / 4}" alt="" ${load}>`;
}

// ---- the hero ------------------------------------------------------------------------------------------------------------

/** The head links that fetch the poster of the screen's crop first (AVIF; a browser without AVIF takes the WebP of the picture). */
export function arenaPreloads(ctx: ViewContext): Preload[] {
  const a = (f: string): string => ctx.assets.hero(f);
  return [
    { srcset: a(`${ARENA.wide.stem}.avif`), sizes: '100vw', media: `not all and ${ARENA_TALL_QUERY}`, type: 'image/avif' },
    { srcset: a(`${ARENA.tall.stem}.avif`), sizes: '100vw', media: ARENA_TALL_QUERY, type: 'image/avif' },
  ];
}

/**
 * The top of the home page. The poster is the page's largest picture and the first thing drawn; the clip has no address until the app
 * gives it one after the page has loaded (app/hero-live.ts), and never for reduced motion, saving data or a crawler. The canvas carries the
 * body line and the pops; the media is decoration (aria-hidden), the words say what it shows. "Play free" is a link to the game page (what a
 * crawler, a script or a new tab follows); for a first-timer the app opens the welcome tour instead (app.ts heroPlay, data-action="hero-play").
 */
export function arenaHero(ctx: ViewContext, featured: ShellGame | undefined): SafeHtml {
  const t = ctx.i18n;
  const a = (f: string): string => ctx.assets.hero(f);
  const c = (f: string): string => ctx.assets.clip(f);
  const { wide, tall } = ARENA;
  return html`<section class="k-arena" aria-labelledby="home-h1" data-hero>
    <div class="k-arena-media" aria-hidden="true" data-keep="arena:${ctx.lang}:${a(`${wide.stem}.webp`)}">
      <picture class="k-arena-poster">
        <source media="${ARENA_TALL_QUERY}" type="image/avif" srcset="${a(`${tall.stem}.avif`)}" width="${tall.w}" height="${tall.h}">
        <source media="${ARENA_TALL_QUERY}" type="image/webp" srcset="${a(`${tall.stem}.webp`)}" width="${tall.w}" height="${tall.h}">
        <source type="image/avif" srcset="${a(`${wide.stem}.avif`)}" width="${wide.w}" height="${wide.h}">
        <img src="${a(`${wide.stem}.webp`)}" alt="" width="${wide.w}" height="${wide.h}" fetchpriority="high" decoding="async">
      </picture>
      <video class="k-arena-video" data-wide-webm="${c(`${wide.stem}.webm`)}" data-wide-mp4="${c(`${wide.stem}.mp4`)}" data-tall-webm="${c(`${tall.stem}.webm`)}" data-tall-mp4="${c(`${tall.stem}.mp4`)}" width="${wide.w}" height="${wide.h}" muted loop playsinline disablepictureinpicture disableremoteplayback preload="none" tabindex="-1" data-qa-layer></video>
      <canvas class="k-arena-skel" data-combo="${t.t('home.hero.combo', { n: '{n}' })}" data-perfect="${t.t('home.hero.perfect')}" data-qa-layer></canvas>
    </div>
    <span class="k-arena-mark" aria-hidden="true">${t.t('brand.name')}</span>
    <div class="k-arena-copy">
      <p class="k-eyebrow">${t.t('home.hero.eyebrow')}</p>
      <h1 id="home-h1" class="k-display" data-main-heading>${t.t('home.how.h1')}</h1>
      <p class="k-lede">${t.t('home.how.lead')}</p>
      <div class="k-actions">
        ${featured ? html`<a class="ba-btn ba-btn--primary" href="${gameHref(ctx, featured)}" data-action="hero-play">${icon('play')}<span>${t.t('home.cta.free')}</span></a>` : ''}
        <a class="ba-btn ba-btn--secondary" href="#how">${t.t('home.cta.how')}</a>
      </div>
      <p class="k-arena-assure">${icon('shield')}<span>${t.t('home.how.assure')}</span></p>
    </div>
    <p class="k-arena-tag">${t.t('home.hero.example')}</p>
    <button class="k-arena-pause" type="button" aria-pressed="false" data-label-pause="${t.t('home.hero.pause')}" data-label-play="${t.t('home.hero.resume')}" aria-label="${t.t('home.hero.pause')}" hidden>${icon('pause')}${icon('play')}</button>
    <p class="ba-visually-hidden">${t.t('home.hero.caption')}</p>
  </section>`;
}

// ---- the area picker -----------------------------------------------------------------------------------------------------

type PickId = 'legs' | 'core' | 'arms' | 'full';
const PICK_REGIONS: Readonly<Record<Exclude<PickId, 'full'>, BodyRegion>> = { legs: 'legs', core: 'core', arms: 'arms' };

/**
 * The game the picker recommends for an area: the first free game of the area in menu order; for the whole body the free game that
 * works the most areas (menu order breaks a tie).
 */
export function pickGame(games: readonly ShellGame[], id: PickId): ShellGame | undefined {
  const free = games.filter((g) => g.free);
  if (id === 'full') {
    const areas = (g: ShellGame): number => g.regions.filter((r) => r !== 'seated').length;
    return free.reduce<ShellGame | undefined>((best, g) => (!best || areas(g) > areas(best) ? g : best), undefined);
  }
  return free.find((g) => inRegion(g, PICK_REGIONS[id]));
}

/**
 * "Which area do you want to work?": four choices and, for the one that is chosen, the game to play now. Radio buttons and the
 * stylesheet (the panel after a checked input shows), so it works without scripts and is read in full by a crawler.
 */
export function pickSection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const ids: PickId[] = ['legs', 'core', 'arms', 'full'];
  const rows = ids.map((id) => ({ id, game: pickGame(ctx.games, id), label: id === 'full' ? t.t('home.pick.full') : regionLabel(ctx, PICK_REGIONS[id]) })).filter((r) => r.game);
  if (rows.length === 0) return html``;
  return html`<section class="k-zone" aria-labelledby="pick-h" data-home-pick>
    <div class="k-zone-card">
      <h2 id="pick-h" class="k-zone-h">${t.t('home.pick.title')}</h2>
      ${rows.map((r, i) => html`<input class="k-zone-in" type="radio" name="k-zone" id="k-zone-${r.id}" value="${r.id}"${i === 0 ? html` checked` : ''}>`)}
      <div class="k-zone-opts" role="group" aria-label="${t.t('home.pick.label')}">
        ${rows.map((r) => html`<label class="k-zone-opt" for="k-zone-${r.id}">${r.label}</label>`)}
      </div>
      <div class="k-zone-panels">
        ${rows.map((r) => {
          const g = r.game as ShellGame;
          return html`<div class="k-zone-panel" data-pick="${r.id}">
            <div class="k-zone-pic">${gamePicture(ctx, g, '(min-width: 900px) 280px, 40vw')}</div>
            <div class="k-zone-body">
              <p class="k-eyebrow">${t.t('home.pick.result')}</p>
              <p class="k-zone-game">${titleOf(ctx, g)}</p>
              <p class="k-meta">${regionLabel(ctx, mainRegion(g))} · ${durationLabel(ctx, g.durationSec)}</p>
              <a class="ba-btn ba-btn--primary" href="${gameHref(ctx, g)}">${icon('play')}<span>${t.t('home.cta.free')}</span></a>
            </div>
          </div>`;
        })}
      </div>
    </div>
  </section>`;
}

// ---- how it works --------------------------------------------------------------------------------------------------------

/** Camera, move, score: three real pictures (the athlete in the camera's frame, our body line over them, a game in play). */
export function howSection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const { w, h } = HOW_STILL_SIZE;
  const steps = [
    ['camera', HOW_STILLS.camera, t.t('home.how2.camera.title'), t.t('home.how2.camera.body'), t.t('home.how2.alt.camera')],
    ['move', HOW_STILLS.move, t.t('home.how2.move.title'), t.t('home.how2.move.body'), t.t('home.how2.alt.move')],
    ['score', HOW_STILLS.score, t.t('home.how2.score.title'), t.t('home.how2.score.body'), t.t('home.how2.alt.score')],
  ] as const;
  return html`<section class="k-sec k-flow" id="how" aria-labelledby="how-h" data-home-how>
    <header class="k-sec-head"><p class="k-eyebrow">${t.t('home.cta.how')}</p><h2 id="how-h" class="k-h2">${t.t('home.how2.title')}</h2></header>
    <ol class="k-flow-steps">
      ${steps.map(([id, file, title, body, alt], i) => html`<li class="k-flow-step" data-step="${id}">
        <figure class="k-flow-pic k-flow-pic--${id}"><img src="${ctx.assets.hero(file)}" alt="${alt}" width="${w}" height="${h}" loading="lazy" decoding="async"></figure>
        <p class="k-flow-n" aria-hidden="true">0${i + 1}</p>
        <h3 class="k-h3">${title}</h3>
        <p class="k-body">${body}</p>
      </li>`)}
    </ol>
  </section>`;
}

// ---- body areas ----------------------------------------------------------------------------------------------------------

/** Every body area with games, as a card with a game of the area in play and the count; each leads to the area's page. */
export function areasSection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const areas = REGION_ORDER.map((r) => ({ r, games: ctx.games.filter((g) => inRegion(g, r)) })).filter((x) => x.games.length > 0);
  if (areas.length === 0) return html``;
  return html`<section class="k-sec k-areas" aria-labelledby="areas-h" data-home-areas>
    <header class="k-sec-head"><p class="k-eyebrow">${t.t('home.areas.kicker')}</p><h2 id="areas-h" class="k-h2">${t.t('home.areas.title')}</h2></header>
    <ul class="k-areas-grid">
      ${areas.map(({ r, games }) => {
        const g = games.find((x) => x.free) ?? (games[0] as ShellGame);
        return html`<li><a class="k-area" href="${ctx.href('region', { params: { region: r } })}">
          <span class="k-area-pic">${gamePicture(ctx, g, '(min-width: 1200px) 25vw, (min-width: 700px) 33vw, 50vw')}</span>
          <span class="k-area-t">${regionLabel(ctx, r)}</span>
          <span class="k-meta">${t.t('home.areas.count', { n: games.length })}</span>
        </a></li>`;
      })}
    </ul>
  </section>`;
}

// ---- Pro -----------------------------------------------------------------------------------------------------------------

/**
 * Pro: what it adds and what it costs. The prices are the list prices a page drawn without a visitor states (homeOffers in views/home.ts
 * passes them in), the button leads to the Pro page, where the checkout is; nothing here buys anything.
 */
export function proSection(ctx: ViewContext, offers: PlansConfig | null, web: boolean): SafeHtml {
  const t = ctx.i18n;
  const pro = proGames(ctx.games);
  if (hasPro(ctx) || pro.length === 0) return html``;
  return html`<section class="k-sec k-pro" aria-labelledby="pro-h" data-home-pro>
    <div class="k-pro-text">
      <p class="k-eyebrow">${t.t('home.pro.kicker')}</p>
      <h2 id="pro-h" class="k-h2">${t.t('paywall.title')}</h2>
      <p class="k-lede">${freeLine(ctx, ctx.games.length - pro.length)}</p>
      <div class="k-actions"><a class="ba-btn ba-btn--primary" href="${ctx.href('pro')}">${icon('sparkle')}<span>${t.t('settings.pro.see')}</span></a></div>
    </div>
    ${offers ? html`<ul class="k-pro-prices"${web ? html` data-web-pay` : ''}>${offers.offers.map((o) => { const d = describeOffer(o, t, offers); return html`<li><b>${d.name}</b><span>${d.trialLine ?? d.priceLine}</span></li>`; })}</ul>` : ''}
  </section>`;
}

// ---- questions -----------------------------------------------------------------------------------------------------------

/** Five short answers, the facts of the questions page in its own words; the page with every question is one link away. */
export function faqSection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const n = ctx.games.length;
  const free = ctx.games.filter((g) => g.free).length;
  const items = [1, 2, 3, 4, 5].map((i) => [t.tx(`home.faq.q${i}`), t.tx(`home.faq.a${i}`, { n, free })] as const);
  return html`<section class="k-sec k-faq" aria-labelledby="faq-h" data-home-faq>
    <header class="k-sec-head"><p class="k-eyebrow">${t.t('footer.faq')}</p><h2 id="faq-h" class="k-h2">${t.t('home.faq.title')}</h2></header>
    <div class="k-faq-list">
      ${items.map(([q, a]) => html`<details class="k-faq-item"><summary><span>${q}</span>${icon('plus')}</summary><p class="k-body">${a}</p></details>`)}
      <p class="k-faq-all"><a class="ba-link" href="${sitePageHref(ctx.lang, 'faq')}" data-native>${t.t('home.faq.all')}</a></p>
    </div>
  </section>`;
}

// ---- the last call -------------------------------------------------------------------------------------------------------

export function finalSection(ctx: ViewContext, featured: ShellGame | undefined): SafeHtml {
  const t = ctx.i18n;
  if (!featured) return html``;
  const a = (f: string): string => ctx.assets.hero(f);
  return html`<section class="k-final" aria-labelledby="final-h" data-home-final>
    <picture class="k-final-pic" aria-hidden="true">
      <source media="${ARENA_TALL_QUERY}" srcset="${a(FINAL_STILLS.tall)}" width="${ARENA.tall.w}" height="${ARENA.tall.h}">
      <img src="${a(FINAL_STILLS.wide)}" alt="" width="${ARENA.wide.w}" height="${ARENA.wide.h}" loading="lazy" decoding="async">
    </picture>
    <h2 id="final-h" class="k-display k-final-h">${t.t('home.final.title')}</h2>
    <p class="k-lede">${t.t('home.final.body')}</p>
    <div class="k-actions"><a class="ba-btn ba-btn--primary" href="${gameHref(ctx, featured)}">${icon('play')}<span>${t.t('home.cta.free')}</span></a></div>
  </section>`;
}
