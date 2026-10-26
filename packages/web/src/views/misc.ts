// Small pages and windows: not found, and the yes/no confirmation.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import type { ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';

export function notFoundPage(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const main = html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('notfound.title')}</h1></header>
    <p class="ba-lead">${t.t('notfound.body')}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('home')}">${t.t('notfound.cta')}</a></div>`;
  return chrome(ctx, { tab: null, main, mainClass: 'ba-page--notfound' });
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  /** The confirming action destroys something: it is drawn plainly and the safe choice gets the focus. */
  danger?: boolean;
}

/** Content for openDialog(): a question and two buttons. Closes with 'yes' or 'no'. */
export function confirmHtml(o: ConfirmOptions): SafeHtml {
  return html`<div class="ba-confirm">
    <h2 class="ba-h3" id="confirm-title">${o.title}</h2>
    <p id="confirm-body">${o.body}</p>
    <div class="ba-actions ba-actions--end">
      <button type="button" class="ba-btn ba-btn--secondary" data-dialog-close="no" autofocus>${o.cancel}</button>
      <button type="button" class="ba-btn ${o.danger ? 'ba-btn--danger' : 'ba-btn--primary'}" data-dialog-close="yes">${o.confirm}</button>
    </div>
  </div>`;
}
