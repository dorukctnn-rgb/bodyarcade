// The workout plans (S's data: core/store/workout-plans.ts): ready sequences of games with a rest between them. The page that
// lists them, the strip on the home page, the card for the plan that is running, and the panel on the results screen that goes
// from one game of a plan to the next. Everything the words say is worked out from the data: the length from the games'
// own durations, the seated version from the manifests, what is free from the entitlements.
import { FREE_PLAN_ID, WORKOUT_PLANS, resolvePlan, type PlanCard, type PlanRunView, type ResolvedStep, type WorkoutPlan } from '../../../core/store/workout-plans.ts';
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { pageHead } from './parts.ts';
import { defaultSetup, playHref, sanitizeSetup, type SetupState } from './setup.ts';

/** What the page of plans knows about the player: each plan as a card, and the plan that is going, if there is one. */
export interface PlansData {
  cards: readonly PlanCard[];
  active: PlanRunView | null;
}

export const NO_PLANS_DATA: PlansData = { cards: [], active: null };

/** The plans of a page drawn without a visitor: every plan against the catalogue, nothing done, only the free one open. */
export function staticPlanCards(games: readonly ShellGame[]): PlanCard[] {
  return WORKOUT_PLANS.map((plan) => ({
    ...resolvePlan(plan, games, {}), plan, free: plan.id === FREE_PLAN_ID, locked: plan.id !== FREE_PLAN_ID, doneThisWeek: 0, doneDays: 0, lastDone: null,
  }));
}

const planName = (ctx: Pick<ViewContext, 'lang'>, plan: WorkoutPlan): string => localized(plan.title, ctx.lang);

const gameOf = (ctx: ViewContext, id: string): ShellGame | undefined => ctx.games.find((g) => g.id === id);

/** The address of a game of a plan: the level and the seating the plan asks for, and a marker that this round is the plan's. */
export function stepHref(ctx: ViewContext, step: Pick<ResolvedStep, 'game' | 'difficulty' | 'seated'>): string | null {
  const g = gameOf(ctx, step.game);
  if (!g) return null;
  const base = defaultSetup(ctx, g);
  const setup: SetupState = sanitizeSetup(ctx, g, { ...base, players: 1, difficulty: step.difficulty, seated: step.seated, quiet: ctx.settings.quiet });
  const href = playHref(ctx, g, setup);
  return `${href}${href.includes('?') ? '&' : '?'}plan=1`;
}

const levelName = (ctx: ViewContext, level: string): string => ctx.i18n.tx(`setup.difficulty.${level}`);

function badges(ctx: ViewContext, c: PlanCard): SafeHtml {
  const t = ctx.i18n;
  return html`<span class="k-planmeta"><span>${t.t('plans.games', { n: c.steps.length })}</span><span>${t.t('plans.minutes', { n: c.minutes })}</span>${c.seated ? html`<span>${t.t('plans.seated')}</span>` : ''}${c.lowImpact ? html`<span>${t.t('plans.lowImpact')}</span>` : ''}</span>`;
}

function stepsList(ctx: ViewContext, c: PlanCard, headingId: string): SafeHtml {
  const t = ctx.i18n;
  const items = c.steps.map((s, i) => {
    const g = gameOf(ctx, s.game);
    if (!g) return html``;
    const last = i === c.steps.length - 1;
    const original = c.plan.steps[i]?.game;
    const line = last || s.restSec === 0 ? t.t('plans.stepLast', { level: levelName(ctx, s.difficulty) }) : t.t('plans.stepLine', { level: levelName(ctx, s.difficulty), rest: s.restSec });
    return html`<li><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="56" height="42"><div><b><a href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${titleOf(ctx, g)}</a></b><small>${line}</small>${s.swapped && original ? html`<small>${t.t('plans.swapped', { game: titleOf(ctx, g) })}</small>` : ''}</div></li>`;
  });
  const left = c.skipped.map((x) => {
    const g = gameOf(ctx, x.game);
    return g && x.reason === 'no-seated-version' ? html`<li class="skipped"><div><small>${t.t('plans.skipped', { game: titleOf(ctx, g) })}</small></div></li>` : '';
  });
  return html`<ol class="k-steps" aria-labelledby="${headingId}">${items}${left}</ol>`;
}

/** The button of a card: start, continue, unlock with Pro; a page without a visitor links to the first game instead. */
function action(ctx: ViewContext, c: PlanCard, active: PlanRunView | null): SafeHtml {
  const t = ctx.i18n;
  const name = planName(ctx, c.plan);
  if (ctx.server) {
    const first = c.steps[0] ? gameOf(ctx, c.steps[0].game) : undefined;
    return first ? html`<a class="ba-btn ba-btn--secondary" href="${ctx.href('game', { params: { slug: first.seo.slug } })}">${t.t('plans.open', { game: titleOf(ctx, first) })}</a>` : html``;
  }
  if (!c.playable) return html`<p class="ba-small">${t.t('plans.noGames')}</p>`;
  if (c.locked) return html`<a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}">${t.t('plans.proStart')}</a>`;
  if (active && active.plan.id === c.plan.id) {
    const href = active.current ? stepHref(ctx, active.current) : null;
    return href ? html`<a class="ba-btn ba-btn--primary" href="${href}" data-action="plan-go">${t.t('plans.continue', { plan: name })}</a>` : html``;
  }
  return html`<button type="button" class="ba-btn ba-btn--primary" data-action="plan-start" data-plan="${c.plan.id}">${t.t('plans.start', { plan: name })}</button>`;
}

function planCard(ctx: ViewContext, c: PlanCard, active: PlanRunView | null): SafeHtml {
  const t = ctx.i18n;
  const id = `plan-${c.plan.id}`;
  return html`<article class="k-card k-plancard" id="${c.plan.id}" aria-labelledby="${id}-h">
    <header><h2 class="k-h3" id="${id}-h">${planName(ctx, c.plan)}</h2><span class="ba-badge${c.free ? '' : ' ba-badge--pro'}">${c.free ? t.t('plans.free') : t.t('plans.pro')}</span></header>
    <p>${localized(c.plan.blurb, ctx.lang)}</p>
    ${badges(ctx, c)}
    ${stepsList(ctx, c, `${id}-h`)}
    ${c.doneThisWeek > 0 ? html`<p class="ba-small">${t.t('plans.doneWeek', { n: c.doneThisWeek })}</p>` : ''}
    <div class="ba-actions">${action(ctx, c, active)}</div>
  </article>`;
}

/** The plan that is going, as a card that leads back into it. */
export function activePlanCard(ctx: ViewContext, run: PlanRunView): SafeHtml {
  const t = ctx.i18n;
  const step = run.current;
  const g = step ? gameOf(ctx, step.game) : undefined;
  const href = step ? stepHref(ctx, step) : null;
  if (!step || !g || !href) return html``;
  return html`<section class="k-card k-planactive" aria-labelledby="planactive-h">
    <h2 class="k-h3" id="planactive-h">${t.t('plans.active.title')}</h2>
    <p>${t.t('plans.active.body', { plan: planName(ctx, run.plan), n: run.number, total: run.total, game: titleOf(ctx, g) })}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--primary" href="${href}" data-action="plan-go">${t.t('plans.continue', { plan: planName(ctx, run.plan) })}</a></div>
  </section>`;
}

/** The page of all the plans. */
export function plansPage(ctx: ViewContext, data: PlansData): SafeHtml {
  const t = ctx.i18n;
  const cards = data.cards.length > 0 ? data.cards : staticPlanCards(ctx.games);
  const main = html`${pageHead(ctx, t.t('plans.title'), { back: ctx.href('home') })}
    <p class="k-sub">${t.t('plans.lead')}</p>
    ${data.active ? activePlanCard(ctx, data.active) : ''}
    <div class="k-plans-grid">${cards.map((c) => planCard(ctx, c, data.active))}</div>`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--plans', pushed: true });
}

/** The strip on the home page: the plan that is going, or the first few plans, and the way to all of them. Nothing without a visitor. */
export function planStrip(ctx: ViewContext, data: PlansData): SafeHtml {
  if (ctx.server || data.cards.length === 0) return html``;
  const t = ctx.i18n;
  const shown = data.cards.filter((c) => c.playable).slice(0, 3);
  if (shown.length === 0 && !data.active) return html``;
  return html`<section class="ba-section k-planstrip" aria-labelledby="plans-h"><header class="k-allhead"><h2 id="plans-h">${t.t('plans.home')}</h2><a class="ba-link" href="${ctx.href('plans')}">${t.t('plans.all')}</a></header>
    ${data.active ? activePlanCard(ctx, data.active) : ''}
    <ul class="k-planlist">${shown.map((c) => html`<li><a class="k-card k-planmini" href="${ctx.href('plans', { hash: c.plan.id })}"><span class="ba-badge${c.free ? '' : ' ba-badge--pro'}">${c.free ? t.t('plans.free') : t.t('plans.pro')}</span><b>${planName(ctx, c.plan)}</b>${badges(ctx, c)}</a></li>`)}</ul>
  </section>`;
}

// ---- the panel on the results screen ----------------------------------------------------------------------------------------

/** Where a plan stands after a round of one of its games. */
export interface PlanPanel {
  plan: WorkoutPlan;
  over: boolean;
  done: boolean;
  played: number;
  skipped: number;
  total: number;
  minutes: number;
  /** The game to play next while the plan goes on: its address, its place, how long to rest first. */
  next: { game: string; href: string; number: number; restSec: number } | null;
}

export function planPanel(ctx: ViewContext, p: PlanPanel): SafeHtml {
  const t = ctx.i18n;
  const name = planName(ctx, p.plan);
  if (p.over) {
    return html`<section class="k-card k-planpanel" aria-labelledby="planpanel-h" data-plan-panel="over">
      <h2 class="k-h3" id="planpanel-h">${p.done ? t.t('plan.done.title', { plan: name }) : name}</h2>
      <p>${p.done ? t.t('plan.done.body', { played: p.played, total: p.total, minutes: t.t('plans.minutes', { n: p.minutes }) }) : t.t('plan.over.short', { played: p.played, total: p.total })}</p>
      ${p.done && p.skipped > 0 ? html`<p class="ba-small">${t.t('plan.done.partial', { played: p.played, total: p.total })}</p>` : ''}
    </section>`;
  }
  const next = p.next;
  const g = next ? gameOf(ctx, next.game) : undefined;
  if (!next || !g) return html``;
  return html`<section class="k-card k-planpanel" aria-labelledby="planpanel-h" data-plan-panel="next">
    <h2 class="k-h3" id="planpanel-h">${t.t('plan.panel.title', { plan: name, n: next.number - 1, total: p.total })}</h2>
    <p><b>${t.t('plan.next', { game: titleOf(ctx, g) })}</b></p>
    ${next.restSec > 0 ? html`<p class="ba-small k-rest" data-plan-rest="${next.restSec}"><span role="status" data-plan-rest-text>${t.t('plan.rest', { n: next.restSec })}</span> <b class="k-count" aria-hidden="true" data-plan-count>${next.restSec}</b></p>` : ''}
    <div class="ba-actions"><a class="ba-btn ba-btn--primary" href="${next.href}" data-action="plan-go" data-replace>${icon('play')}<span>${t.t('plan.go', { game: titleOf(ctx, g) })}</span></a>
      <button type="button" class="ba-btn ba-btn--quiet" data-action="plan-skip">${t.t('plan.skip')}</button>
      <button type="button" class="ba-btn ba-btn--quiet" data-action="plan-leave">${t.t('plan.leave')}</button></div>
  </section>`;
}
