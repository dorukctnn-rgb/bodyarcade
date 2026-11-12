// The other ways to play on the home page: a duel with a friend over a link (Kol E), the office break (the free desk break, played in a
// chair) and family mode (two players, one camera). A strip of three cards; what each says is worked out from the data (the duel link's
// lifetime, the plan's minutes and games, the way this device plays two players). The duel card is the navigation's "Duel" (/#duel).
import { FREE_PLAN_ID, WORKOUT_PLANS, resolvePlan } from '../../../core/store/workout-plans.ts';
import { DUEL_LIFETIME_MS } from '../../../core/net/duel-link.ts';
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { titleOf, type ViewContext } from '../context.ts';
import { canRace } from '../app/duel.ts';

/** The duel card: the game it starts in (a free one, raced over its course where it has one) and the way in. */
function duelCard(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const g = ctx.games.find((x) => x.free && canRace(x)) ?? ctx.games.find((x) => x.free);
  if (!g) return html``;
  const label = t.t('modes.duel.start', { game: titleOf(ctx, g) });
  // Where the friends side runs, the button makes the link at once; a page drawn without it (a crawler, the first paint) leads to the game's page, which has its duel link.
  const go = ctx.flags.social
    ? html`<button type="button" class="ba-btn ba-btn--primary" data-action="race.new" data-game="${g.id}">${icon('trophy')}<span>${label}</span></button>`
    : html`<a class="ba-btn ba-btn--primary" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${icon('trophy')}<span>${label}</span></a>`;
  return html`<li id="duel" class="k-modeitem k-modeitem--duel"><div class="k-card k-modecard k-modecard--duel" data-mode-card="duel"><span class="pic" aria-hidden="true">${icon('trophy')}</span><div><b>${t.t('modes.duel.title')}</b><p>${t.t('modes.duel.body', { min: Math.round(DUEL_LIFETIME_MS / 60_000) })}</p><div class="k-modecard-go">${go}</div><p class="ba-small">${t.t('modes.duel.more')}</p></div><span class="ba-badge">${t.t('plans.free')}</span></div></li>`;
}

export function modeStrip(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const plan = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
  const desk = plan ? resolvePlan(plan, ctx.games, { seated: true }) : null;
  return html`<section class="ba-section k-modestrip" aria-labelledby="modes-h" data-modes><header class="k-allhead"><h2 id="modes-h">${t.t('modes.title')}</h2></header>
    <ul class="k-modelist">
      ${duelCard(ctx)}
      ${desk && desk.playable ? html`<li class="k-modeitem"><a class="k-card k-modecard" href="${ctx.href('office')}" data-mode-card="office"><span class="pic" aria-hidden="true">${icon('chair')}</span><div><b>${t.t('modes.office.title')}</b><p>${t.t('modes.office.body', { n: desk.steps.length, min: desk.minutes })}</p></div><span class="ba-badge">${t.t('plans.free')}</span></a></li>` : ''}
      <li class="k-modeitem"><a class="k-card k-modecard" href="${ctx.href('family')}" data-mode-card="family"><span class="pic" aria-hidden="true">${icon('users')}</span><div><b>${t.t('modes.family.title')}</b><p>${ctx.caps.local2 ? t.t('modes.family.together') : t.t('modes.family.turns')}</p></div><span class="ba-badge">${t.t('plans.free')}</span></a></li>
    </ul>
  </section>`;
}
