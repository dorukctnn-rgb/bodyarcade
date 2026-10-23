// Small pieces several pages share: the header of a pushed screen, and the weekday names.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';

/** The header of a screen reached from another: a round back button, the title, and what goes on the right. */
export function pageHead(ctx: Pick<ViewContext, 'i18n'>, title: string, o: { back?: string; actions?: SafeHtml; titleId?: string } = {}): SafeHtml {
  return html`<div class="k-head">${o.back ? html`<a class="ba-icon-btn" href="${o.back}" aria-label="${ctx.i18n.t('common.back')}">${icon('back')}</a>` : ''}<div class="grow">${title ? html`<h1${o.titleId ? html` id="${o.titleId}"` : ''} data-main-heading>${title}</h1>` : ''}</div>${o.actions ?? ''}</div>`;
}

/** "Mon", "Tue" ...: short weekday names in the page language, for a Monday-first week. */
export function weekdayNames(tag: string): string[] {
  const fmt = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}
