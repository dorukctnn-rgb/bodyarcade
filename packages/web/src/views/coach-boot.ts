// The first paint of the coach pages (/form-coach, /today, /progress): the form coach and the progress coach are apps of their
// own (src/form/page.ts, src/growth/page.ts) that main.ts starts in place of the shell. Until they are in, the page shows their
// name, one line about them and that the page is opening, on their own dark ground, so nothing jumps when they take over.
// A visit without scripts reads the same and the note that the page needs JavaScript.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';
import type { RouteId } from '../routes.ts';
import { bare } from './chrome.ts';

export type CoachRoute = Extract<RouteId, 'formcoach' | 'today' | 'progress'>;

/** The name, the line and the icon of each coach page. */
export function coachPageText(ctx: ViewContext, id: CoachRoute): { name: string; lead: string } {
  const t = ctx.i18n;
  if (id === 'formcoach') return { name: t.t('nav.coach'), lead: t.t('home.coach.title') };
  if (id === 'today') return { name: t.t('nav.today'), lead: t.t('home.today.title') };
  return { name: t.t('home.growth.kicker'), lead: t.t('home.growth.title') };
}

export function coachBootPage(ctx: ViewContext, id: CoachRoute): SafeHtml {
  const { name, lead } = coachPageText(ctx, id);
  const ic = id === 'formcoach' ? 'coach' : id === 'today' ? 'today' : 'chart';
  return bare(ctx, html`<section class="ba-coachboot" data-coach-boot="${id}" aria-labelledby="coach-boot-h">
    <a class="ba-coachboot-brand" href="${ctx.href('home')}">${ctx.i18n.t('brand.name')}</a>
    <span class="ba-coachboot-ico" aria-hidden="true">${icon(ic)}</span>
    <h1 id="coach-boot-h" data-main-heading>${name}</h1>
    <p>${lead}</p>
    <p class="ba-coachboot-wait" role="status">${ctx.i18n.t('coachpage.loading')}</p>
    <noscript><p>${ctx.i18n.t('common.noscript')}</p></noscript>
  </section>`, 'ba-app--coach');
}
