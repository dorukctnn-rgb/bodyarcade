// The office break (/office): the free desk break (core/store/workout-plans.ts, FREE_PLAN_ID) as a mode of its own. Four short seated
// games in a chair, with how to set up a laptop or a phone at a desk so the camera sees head, shoulders and hands, and how to sit
// safely. Everything about the set (the games, their length, the rests, the minutes) is the plan's own data, resolved against the
// catalogue; the start button is the plans page's (data-action="plan-start"), so a run of the office break is a run of the plan.
import { FREE_PLAN_ID, planById, type PlanCard } from '../../../core/store/workout-plans.ts';
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { pageHead } from './parts.ts';
import { activePlanCard, staticPlanCards, stepHref, type PlansData } from './plans.ts';

/** The desk break as the page knows it: the player's card (what is done, what is locked), or the catalogue's for a page without a visitor. */
export function officeCard(ctx: ViewContext, data: PlansData): PlanCard | null {
  return data.cards.find((c) => c.plan.id === FREE_PLAN_ID) ?? staticPlanCards(ctx.games).find((c) => c.plan.id === FREE_PLAN_ID) ?? null;
}

const SETUP = ['eye', 'frame', 'light', 'chair'] as const;

function moves(ctx: ViewContext, c: PlanCard): SafeHtml {
  const t = ctx.i18n;
  return html`<ol class="k-steps k-officemoves" aria-labelledby="office-moves-h">${c.steps.map((s) => {
    const g = ctx.games.find((x) => x.id === s.game);
    if (!g) return '';
    const how = g.catalogue.seatedNote ? localized(g.catalogue.seatedNote, ctx.lang) : '';
    return html`<li data-office-step="${g.id}"><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="56" height="42"><div><b>${titleOf(ctx, g)}</b>${how ? html`<small>${how}</small>` : ''}</div><span class="k-officelen">${t.t('office.round', { n: s.durationSec })}</span></li>`;
  })}</ol>`;
}

function action(ctx: ViewContext, c: PlanCard, data: PlansData): SafeHtml {
  const t = ctx.i18n;
  const first = c.steps[0] ? ctx.games.find((g) => g.id === c.steps[0]?.game) : undefined;
  // a page without a visitor cannot start a run: it opens the first game's page
  if (ctx.server) return first ? html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('game', { params: { slug: first.seo.slug } })}">${t.t('plans.open', { game: titleOf(ctx, first) })}</a>` : html``;
  if (!c.playable) return html`<p class="ba-small">${t.t('plans.noGames')}</p>`;
  if (data.active && data.active.plan.id === c.plan.id && data.active.current) {
    const href = stepHref(ctx, data.active.current);
    return href ? html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${href}" data-action="plan-go">${icon('play')}<span>${t.t('plans.continue', { plan: localized(c.plan.title, ctx.lang) })}</span></a>` : html``;
  }
  return html`<button type="button" class="ba-btn ba-btn--primary ba-btn--lg" data-action="plan-start" data-plan="${c.plan.id}">${icon('play')}<span>${t.t('office.start')}</span></button>`;
}

export function officePage(ctx: ViewContext, data: PlansData): SafeHtml {
  const t = ctx.i18n;
  const plan = planById(FREE_PLAN_ID);
  const c = officeCard(ctx, data);
  if (!plan || !c) return chrome(ctx, { tab: 'games', main: html`${pageHead(ctx, t.t('office.kicker'), { back: ctx.href('home') })}<p class="k-sub">${t.t('plans.noGames')}</p>`, mainClass: 'ba-page--office', pushed: true });
  const other = data.active && data.active.plan.id !== c.plan.id ? activePlanCard(ctx, data.active) : '';
  const main = html`${pageHead(ctx, localized(plan.title, ctx.lang), { back: ctx.href('home') })}
    <p class="k-kicker" data-office>${icon('chair')}<span>${t.t('office.kicker')}</span></p>
    <p class="k-sub">${t.t('office.lead', { n: c.steps.length, min: c.minutes })}</p>
    ${other}
    <div class="k-cols k-officecols">
      <section class="k-card k-officeset" aria-labelledby="office-moves-h">
        <header class="k-officehead"><h2 class="k-h3" id="office-moves-h">${t.t('office.moves')}</h2><span class="ba-badge">${t.t('plans.free')}</span></header>
        ${moves(ctx, c)}
        <p class="ba-small">${t.t('office.rests', { n: c.steps.find((s) => s.restSec > 0)?.restSec ?? 0 })}</p>
        <div class="ba-actions">${action(ctx, c, data)}</div>
      </section>
      <section class="k-card k-officesetup" aria-labelledby="office-setup-h">
        <h2 class="k-h3" id="office-setup-h">${t.t('office.setup.title')}</h2>
        <ul class="k-officetips">${SETUP.map((k) => html`<li data-office-tip="${k}">${icon(k === 'chair' ? 'chair' : k === 'light' ? 'sun' : 'camera')}<span>${t.t(`office.setup.${k}`)}</span></li>`)}</ul>
        <p class="ba-callout" role="note">${icon('info')}<span>${t.t('office.safe')}</span></p>
        <p class="ba-small k-officeprivate">${icon('shield')}<span>${t.t('office.private')}</span></p>
      </section>
    </div>
    <p><a class="ba-link" href="${ctx.href('plans')}">${t.t('office.plans')}</a></p>`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--office', pushed: true });
}
