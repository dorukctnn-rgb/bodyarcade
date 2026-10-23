// The Pro offer. One body, used on the /pro page and inside the window that opens from a locked game or the results.
// Honest by construction: the benefit list holds only things that exist, "7 days free" appears only when the trial
// really applies to this player, and the yearly saving is computed from the real prices.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { describeOffer, yearlySavingsPercent, type PlanId, type PlanOffer } from '../../../core/ui/plans.ts';
import { proGames } from '../../catalogue/filter.ts';
import { titleOf, hasPro, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';

export type PaywallReason = 'menu' | 'game' | 'results';
export type KeyStatus = 'idle' | 'busy' | 'ok' | 'not_found' | 'refunded' | 'ended' | 'limit' | 'network' | 'server';

export interface PaywallState {
  selected: PlanId;
  reason: PaywallReason;
  /** The locked game that sent the player here. */
  gameId?: string;
  keyOpen: boolean;
  keyStatus: KeyStatus;
}

export const defaultPaywallState = (ctx: ViewContext, reason: PaywallReason = 'menu', gameId?: string): PaywallState => ({
  selected: ctx.plans.offers.find((o) => o.featured)?.id ?? ctx.plans.offers[0]?.id ?? 'pro-yearly',
  reason,
  ...(gameId ? { gameId } : {}),
  keyOpen: false,
  keyStatus: 'idle',
});

export const selectedOffer = (ctx: ViewContext, id: PlanId): PlanOffer | undefined => ctx.plans.offers.find((o) => o.id === id) ?? ctx.plans.offers[0];

function benefits(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const items: string[] = [];
  const pro = proGames(ctx.games).length;
  if (pro > 0) items.push(t.t('paywall.benefit.games', { n: pro }));
  items.push(t.t('paywall.benefit.levels'));
  if (ctx.flags.social) items.push(t.t('paywall.benefit.rooms'));
  return html`<ul class="ba-checklist">${items.map((x) => html`<li>${icon('check')}<span>${x}</span></li>`)}</ul>`;
}

function planCard(ctx: ViewContext, offer: PlanOffer, selected: boolean): SafeHtml {
  const t = ctx.i18n;
  const d = describeOffer(offer, ctx.i18n, ctx.plans);
  const saves = offer.id === 'pro-yearly' ? yearlySavingsPercent(ctx.plans) : null;
  return html`<label class="ba-plan${selected ? ' is-selected' : ''}${offer.featured ? ' is-featured' : ''}">
    <input type="radio" name="plan" value="${offer.id}" data-key="plan-${offer.id}"${attr('checked', selected)}>
    <span class="ba-plan-body">
      <span class="ba-plan-name">${d.name}${saves !== null ? html`<span class="ba-badge ba-badge--free">${t.t('paywall.saves', { pct: saves })}</span>` : ''}</span>
      <span class="ba-plan-price">${d.priceLine}</span>
      ${d.trialLine ? html`<span class="ba-plan-trial">${d.trialLine}</span>` : ''}
      ${d.detail ? html`<span class="ba-small">${d.detail}</span>` : ''}
    </span>
  </label>`;
}

function keyStatusText(ctx: ViewContext, s: KeyStatus): string {
  const t = ctx.i18n;
  switch (s) {
    case 'ok': return t.t('paywall.key.ok');
    case 'not_found': return t.t('paywall.key.err.not_found');
    case 'refunded': return t.t('paywall.key.err.refunded');
    case 'ended': return t.t('paywall.key.err.ended');
    case 'limit': return t.t('paywall.key.err.limit');
    case 'network': return t.t('paywall.key.err.network');
    case 'server': return t.t('paywall.key.err.server');
    case 'busy': return t.t('common.loading');
    default: return '';
  }
}

export function paywallHtml(ctx: ViewContext, st: PaywallState, o: { dialog: boolean }): SafeHtml {
  const t = ctx.i18n;
  const offers = ctx.plans.offers;
  const sel = selectedOffer(ctx, st.selected);
  const d = sel ? describeOffer(sel, ctx.i18n, ctx.plans) : null;
  const game = st.gameId ? ctx.games.find((g) => g.id === st.gameId) : undefined;
  const onAndroid = ctx.caps.platform === 'android-app';
  const freeCount = ctx.games.filter((g) => g.free).length;
  const status = keyStatusText(ctx, st.keyStatus);

  if (hasPro(ctx)) {
    return html`<div class="ba-paywall" data-form="paywall">
      ${o.dialog ? html`<header class="ba-dialog-head"><h2 class="ba-h3" id="paywall-title">${t.t('settings.section.pro')}</h2><button type="button" class="ba-icon-btn" data-dialog-close="dismissed" aria-label="${t.t('common.close')}">${icon('close')}</button></header>` : html`<h1 class="ba-h1" id="paywall-title" data-main-heading>${t.t('settings.section.pro')}</h1>`}
      <p class="ba-callout">${icon('check')}<span>${t.t('paywall.active')}</span></p>
    </div>`;
  }

  const head = o.dialog
    ? html`<header class="ba-dialog-head"><h2 class="ba-h3" id="paywall-title">${t.t('paywall.title')}</h2><button type="button" class="ba-icon-btn" data-dialog-close="dismissed" aria-label="${t.t('paywall.closeLabel')}">${icon('close')}</button></header>`
    : html`<h1 class="ba-h1" id="paywall-title" data-main-heading>${t.t('paywall.title')}</h1>`;

  return html`<div class="ba-paywall" data-form="paywall">
    ${head}
    <p class="ba-lead">${game && st.reason === 'game' ? t.t('paywall.locked', { game: titleOf(ctx, game) }) : t.t('paywall.lead')}</p>
    ${benefits(ctx)}
    <p class="ba-small">${t.t('paywall.free', { n: freeCount })}</p>
    <fieldset class="ba-fieldset"><legend class="ba-visually-hidden">${t.t('nav.pro')}</legend>
      <div class="ba-plans">${offers.map((offer) => planCard(ctx, offer, offer.id === (sel?.id ?? st.selected)))}</div>
    </fieldset>
    <div class="ba-actions ba-actions--stack">
      <button type="button" class="ba-btn ba-btn--primary ba-btn--lg ba-btn--block" data-action="buy" data-plan="${sel?.id ?? ''}">${d?.cta ?? t.t('paywall.cta.buy')}</button>
      <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('home')}" data-action="close-paywall">${t.t('paywall.continueFree')}</a>
    </div>
    <p class="ba-small ba-fineprint">${d?.trialLine ? `${d.trialLine}. ` : ''}${onAndroid ? t.t('paywall.cancel.play') : t.t('paywall.cancel.web')}${ctx.plans.trialReminder && d?.trialLine ? ` ${t.t('paywall.reminder')}` : ''}</p>
    ${onAndroid
      ? html`<div class="ba-actions"><button type="button" class="ba-btn ba-btn--quiet" data-action="restore">${t.t('paywall.restore')}</button></div>`
      : html`<details class="ba-keybox"${attr('open', st.keyOpen)}><summary>${icon('key')}<span>${t.t('paywall.key.title')}</span></summary>
          <div class="ba-keyform">
            <div class="ba-field"><label for="pw-key">${t.t('paywall.key.label')}</label><input class="ba-input" id="pw-key" name="licenseKey" data-key="licenseKey" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="pw-key-status"></div>
            <button type="button" class="ba-btn ba-btn--secondary" data-action="activate-key"${attr('disabled', st.keyStatus === 'busy')}>${t.t('paywall.key.activate')}</button>
          </div>
          <p class="ba-small ba-keystatus" id="pw-key-status" role="status">${status}</p>
        </details>`}
  </div>`;
}

export function paywallPage(ctx: ViewContext, st: PaywallState): SafeHtml {
  return chrome(ctx, { tab: 'pro', main: html`<div class="ba-paywallpage">${paywallHtml(ctx, st, { dialog: false })}</div>`, mainClass: 'ba-page--pro' });
}
