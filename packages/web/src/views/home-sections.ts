// The home page's story under the games (Kol G, Apple Fitness+ line): the before/after band of the progress coach, the form coach,
// Today and the progress coach, and the privacy promise. Large type, one idea per section, real words from the product. The pictures:
// the progress coach's own 3D twin (the band: the feature's real output, so it stays a 3D picture), a person doing squats with our body
// line and the coach's counters (src/motion.ts, example footage), and the shape of a day's plan. No result promised, nothing medical.
import { html, raw, type SafeHtml } from '../../../core/ui/html.ts';
import { icon, type IconName } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';
import { COACH_MOTION } from '../motion.ts';
import { motionMedia } from './motion.ts';
import { sitePageHref } from './chrome.ts';
import { BAND_STILLS, bandMarkup } from '../growth/before-after-band.ts';

/**
 * How many moves the form coach knows (core/form/moves FORM_MOVE_IDS; a test keeps the two equal). A number here, so the home page
 * does not carry the whole catalogue of moves.
 */
export const FORM_MOVE_COUNT = 113;

/** The example day of the Today section: the same split the Today panel makes for 18 minutes (FIKIRLER-ALINAN.md 2). */
export const TODAY_EXAMPLE = { warm: 3, games: 12, stretch: 3 } as const;

/** 2. The before/after band: the progress coach's 3D twin between two tapes, "illustration" on both views (growth/before-after-band.ts). */
export function bandSection(ctx: ViewContext): SafeHtml {
  const stills = { morph: ctx.assets.hero(BAND_STILLS.morph.file), compare: ctx.assets.hero(BAND_STILLS.compare.file) };
  return html`<div class="k-band" data-home-band>${raw(bandMarkup(ctx.lang, { href: ctx.href('progress'), stills }))}</div>`;
}

/**
 * The form coach's picture: a person doing squats with our body line, and the coach's counters over them (the reps go up at each rep of
 * the clip while it plays; the poster says 8 and 7).
 */
function coachFigure(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const hud = html`<span class="k-coachfig-hud" aria-hidden="true" data-qa-layer><span><b data-mo-count>8</b>${t.t('home.coach.reps')}</span><span><b data-mo-clean>7</b>${t.t('home.coach.clean')}</span></span>`;
  return html`<figure class="k-coachfig">
    <div class="k-coachfig-pic">${motionMedia(ctx, COACH_MOTION, 'tile', { over: hud })}</div>
    <p class="k-coachfig-cue" aria-hidden="true">${t.t('home.coach.cue')}</p>
    <figcaption class="ba-visually-hidden">${t.t('home.coach.caption')}</figcaption>
  </figure>`;
}

/** The look of the three states, as the coach draws them (colour and line style, never colour alone). */
function coachLegend(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<ul class="k-coachkey" aria-hidden="true">
    <li><i class="ok"></i>${t.t('home.coach.good')}</li><li><i class="tip"></i>${t.t('home.coach.tip')}</li><li><i class="fix"></i>${t.t('home.coach.fix')}</li>
  </ul>`;
}

const point = (ic: IconName, text: string): SafeHtml => html`<li><span class="k-featpt-ico" aria-hidden="true">${icon(ic)}</span><span>${text}</span></li>`;

/** 4. The form coach: what it does, the picture, three facts and the way in. */
export function coachSection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<section class="ba-section k-feature k-feature--coach" aria-labelledby="coach-h" data-home-coach>
    <div class="k-feature-text">
      <p class="k-eyebrow">${icon('coach')}<span>${t.t('home.coach.kicker')}</span></p>
      <h2 id="coach-h" class="k-feature-h">${t.t('home.coach.title')}</h2>
      <p class="k-feature-lead">${t.t('home.coach.body', { n: FORM_MOVE_COUNT })}</p>
      <ul class="k-featpts">
        ${point('check', t.t('home.coach.point.colors'))}
        ${point('camera', t.t('home.coach.point.guide'))}
        ${point('programs', t.t('home.coach.point.summary'))}
      </ul>
      <div class="k-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('formcoach')}" data-native>${icon('coach')}<span>${t.t('home.coach.cta')}</span></a></div>
    </div>
    <div class="k-feature-media">${coachFigure(ctx)}${coachLegend(ctx)}</div>
  </section>`;
}

/** 5. Today and the progress coach, side by side: the day's plan from a short check-in, and the weeks with their records. */
export function todaySection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const e = TODAY_EXAMPLE;
  const total = e.warm + e.games + e.stretch;
  const parts = [['warm', t.t('home.today.warm'), e.warm], ['games', t.t('home.today.games'), e.games], ['stretch', t.t('home.today.stretch'), e.stretch]] as const;
  return html`<section class="ba-section k-pair" aria-label="${t.t('home.today.kicker')}, ${t.t('home.growth.kicker')}" data-home-today>
    <article class="k-paircard k-paircard--today" aria-labelledby="today-h">
      <p class="k-eyebrow">${icon('today')}<span>${t.t('home.today.kicker')}</span></p>
      <h2 id="today-h" class="k-feature-h k-feature-h--sm">${t.t('home.today.title')}</h2>
      <p class="k-feature-lead">${t.t('home.today.body')}</p>
      <div class="k-dayplan">
        <p class="k-dayplan-h">${t.t('home.today.sample', { min: total })}</p>
        <div class="k-dayplan-bar" aria-hidden="true">${parts.map(([cls, , min]) => html`<i class="${cls}" style="flex-grow:${min}"></i>`)}</div>
        <ol class="k-dayplan-list">${parts.map(([cls, label, min]) => html`<li class="${cls}"><b>${label}</b><span>${t.t('duration.min', { n: min })}</span></li>`)}</ol>
      </div>
      <p class="ba-small k-paircard-note">${t.t('home.today.sore')}</p>
      <div class="k-actions"><a class="ba-btn ba-btn--primary" href="${ctx.href('today')}" data-native>${icon('today')}<span>${t.t('home.today.cta')}</span></a></div>
    </article>
    <article class="k-paircard k-paircard--growth" aria-labelledby="growth-h">
      <p class="k-eyebrow">${icon('chart')}<span>${t.t('home.growth.kicker')}</span></p>
      <h2 id="growth-h" class="k-feature-h k-feature-h--sm">${t.t('home.growth.title')}</h2>
      <p class="k-feature-lead">${t.t('home.growth.body')}</p>
      <ul class="k-featpts">
        ${point('programs', t.t('home.growth.point.program'))}
        ${point('star', t.t('home.growth.point.food'))}
        ${point('lock', t.t('home.growth.point.photos'))}
      </ul>
      <div class="k-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('progress')}" data-native>${icon('chart')}<span>${t.t('home.growth.cta')}</span></a></div>
    </article>
  </section>`;
}

/** 7. Privacy: the camera picture stays on the device; what a duel shows; where photos live; the policy. */
export function privacySection(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<section class="ba-section k-privacy" aria-labelledby="privacy-h" data-home-privacy>
    <div class="k-privacy-head">
      <span class="k-privacy-ico" aria-hidden="true">${icon('shield')}</span>
      <h2 id="privacy-h" class="k-feature-h k-feature-h--sm">${t.t('home.privacy.title')}</h2>
      <p class="k-feature-lead">${t.t('home.privacy.body')}</p>
    </div>
    <ul class="k-privacy-pts">
      ${point('camera', t.t('home.privacy.point.pose'))}
      ${point('trophy', t.t('home.privacy.point.duel'))}
      ${point('lock', t.t('home.privacy.point.photos'))}
      ${point('check', t.t('home.privacy.point.data'))}
    </ul>
    <p class="k-privacy-link"><a class="ba-link" href="${sitePageHref(ctx.lang, 'privacy')}" data-native>${t.t('home.privacy.link')}</a></p>
  </section>`;
}
