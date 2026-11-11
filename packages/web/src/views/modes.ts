// The two modes on the home page: the office break (the free desk break, played in a chair) and family mode (two players, one
// camera). A short strip of two cards; what each says is worked out from the data (the plan's minutes and games, the way this
// device plays two players).
import { FREE_PLAN_ID, WORKOUT_PLANS, resolvePlan } from '../../../core/store/workout-plans.ts';
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';

export function modeStrip(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const plan = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
  const desk = plan ? resolvePlan(plan, ctx.games, { seated: true }) : null;
  return html`<section class="ba-section k-modestrip" aria-labelledby="modes-h" data-modes><header class="k-allhead"><h2 id="modes-h">${t.t('modes.title')}</h2></header>
    <ul class="k-modelist">
      ${desk && desk.playable ? html`<li><a class="k-card k-modecard" href="${ctx.href('office')}" data-mode-card="office"><span class="pic" aria-hidden="true">${icon('chair')}</span><div><b>${t.t('modes.office.title')}</b><p>${t.t('modes.office.body', { n: desk.steps.length, min: desk.minutes })}</p></div><span class="ba-badge">${t.t('plans.free')}</span></a></li>` : ''}
      <li><a class="k-card k-modecard" href="${ctx.href('family')}" data-mode-card="family"><span class="pic" aria-hidden="true">${icon('users')}</span><div><b>${t.t('modes.family.title')}</b><p>${ctx.caps.local2 ? t.t('modes.family.together') : t.t('modes.family.turns')}</p></div><span class="ba-badge">${t.t('plans.free')}</span></a></li>
    </ul>
  </section>`;
}
