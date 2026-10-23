// The Pro offer (design/ui-kit/paywall.html): a full screen of its own with a close button. Honest by construction: the
// benefit list holds only things that exist, "7 days free" appears only when the trial really applies to this player,
// and the yearly saving is computed from the real prices.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { describeOffer, yearlySavingsPercent, type PlanId, type PlanOffer } from '../../../core/ui/plans.ts';
import { proGames } from '../../catalogue/filter.ts';
import { hasPro, titleOf, type ViewContext } from '../context.ts';

export type KeyStatus = 'idle' | 'busy' | 'ok' | 'not_found' | 'refunded' | 'ended' | 'limit' | 'network' | 'server';

export interface PaywallState {
  selected: PlanId;
  /** The locked game that sent the player here. */
  gameId?: string;
  keyOpen: boolean;
  keyStatus: KeyStatus;
}

export const defaultPaywallState = (ctx: ViewContext, gameId?: string): PaywallState => ({
  selected: ctx.plans.offers.find((o) => o.featured)?.id ?? ctx.plans.offers[0]?.id ?? 'pro-yearly',
  ...(gameId ? { gameId } : {}),
  keyOpen: false,
  keyStatus: 'idle',
});

export const selectedOffer = (ctx: ViewContext, id: PlanId): PlanOffer | undefined => ctx.plans.offers.find((o) => o.id === id) ?? ctx.plans.offers[0];

function benefits(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const pro = proGames(ctx.games);
  const items: SafeHtml[] = [];
  if (pro.length > 0) items.push(html`<li>${icon('arcade')}<span>${t.t('paywall.benefit.gamesList', { n: pro.length, names: t.list(pro.map((g) => titleOf(ctx, g))) })}</span></li>`);
  items.push(html`<li>${icon('trophy')}<span>${t.t('paywall.benefit.levels')}</span></li>`);
  if (ctx.flags.social) items.push(html`<li>${icon('friends')}<span>${t.t('paywall.benefit.rooms')}</span></li>`);
  return html`<ul class="k-benefits">${items}</ul>`;
}

function planRow(ctx: ViewContext, offer: PlanOffer, selected: boolean): SafeHtml {
  const t = ctx.i18n;
  const d = describeOffer(offer, t, ctx.plans);
  const saves = offer.id === 'pro-yearly' ? yearlySavingsPercent(ctx.plans) : null;
  const detail = offer.period === 'once' ? t.t('paywall.onceDetail') : d.detail;
  return html`<label class="k-plan">
    <input type="radio" name="plan" value="${offer.id}" data-key="plan-${offer.id}"${attr('checked', selected)}>
    ${saves !== null ? html`<span class="save">${t.t('paywall.savesShort', { pct: saves })}</span>` : ''}
    <span class="radio" aria-hidden="true"></span><b>${d.name}</b><span class="price">${d.priceLine}</span>
    ${detail ? html`<small>${detail}</small>` : ''}
    ${d.trialLine ? html`<small class="trial">${d.trialLine}</small>` : ''}
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

/** The page. It carries its own close button, so it is drawn without the site frame. */
export function paywallPage(ctx: ViewContext, st: PaywallState): SafeHtml {
  const t = ctx.i18n;
  // The plan that is recommended comes first, the rest keep the order of the configuration.
  const shown = [...ctx.plans.offers].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  const sel = selectedOffer(ctx, st.selected);
  const d = sel ? describeOffer(sel, t, ctx.plans) : null;
  const game = st.gameId ? ctx.games.find((g) => g.id === st.gameId) : undefined;
  const pro = proGames(ctx.games);
  const freeCount = ctx.games.length - pro.length;
  const onAndroid = ctx.caps.platform === 'android-app';
  const status = keyStatusText(ctx, st.keyStatus);
  const close = html`<a class="ba-icon-btn k-close" href="${ctx.href('home')}" data-action="close-paywall" aria-label="${t.t('paywall.closeLabel')}">${icon('close')}</a>`;

  if (hasPro(ctx)) {
    return html`<div class="ba-app ba-app--bare"><a class="ba-skip" href="#main">${t.t('common.skipToContent')}</a>${close}
      <main id="main" class="ba-page ba-page--pro" tabindex="-1"><div class="k-stack"><h1 data-main-heading>${t.t('settings.section.pro')}</h1><p class="ba-callout">${icon('check')}<span>${t.t('paywall.active')}</span></p>
      <div class="k-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('home')}">${t.t('notfound.cta')}</a></div></div></main></div>`;
  }

  return html`<div class="ba-app ba-app--bare"><a class="ba-skip" href="#main">${t.t('common.skipToContent')}</a>${close}
    <main id="main" class="ba-page ba-page--pro" tabindex="-1">
      <div class="k-pw" data-form="paywall">
        <div class="k-stack">
          <div class="k-pw-art" aria-hidden="true">${pro.slice(0, 3).map((g) => html`<img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="400" height="300">`)}</div>
          <h1 data-main-heading>${t.t('paywall.title')}</h1>
          <p class="lead">${game ? t.t('paywall.locked', { game: titleOf(ctx, game) }) : t.t('paywall.lead')}</p>
          ${benefits(ctx)}
          <p class="free">${icon('check')}<span>${t.t('paywall.free', { n: freeCount })}</span></p>
        </div>
        <div class="k-plans" role="radiogroup" aria-label="${t.t('paywall.plans')}">${shown.map((o) => planRow(ctx, o, o.id === (sel?.id ?? st.selected)))}</div>
        <div class="k-actionbar"><div class="k-actions">
          <button type="button" class="ba-btn ba-btn--primary ba-btn--lg" data-action="buy" data-plan="${sel?.id ?? ''}">${d?.cta ?? t.t('paywall.cta.buy')}</button>
          <a class="ba-btn ba-btn--quiet" href="${ctx.href('home')}" data-action="close-paywall">${t.t('paywall.continueFree')}</a>
        </div><p class="k-note">${d?.trialLine ? `${d.trialLine}. ` : ''}${onAndroid ? t.t('paywall.cancel.play') : t.t('paywall.cancel.web')}${ctx.plans.trialReminder && d?.trialLine ? ` ${t.t('paywall.reminder')}` : ''}</p></div>
        ${onAndroid
          ? html`<div class="k-links"><button class="ba-link" type="button" data-action="restore">${t.t('paywall.restore')}</button></div>`
          : html`<details class="k-keybox"${attr('open', st.keyOpen)}><summary>${icon('key')}<span>${t.t('paywall.key.title')}</span></summary>
              <div class="k-keyform">
                <div class="ba-field"><label for="pw-key">${t.t('paywall.key.label')}</label><input class="ba-input" id="pw-key" name="licenseKey" data-key="licenseKey" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="pw-key-status"></div>
                <button type="button" class="ba-btn ba-btn--secondary" data-action="activate-key"${attr('disabled', st.keyStatus === 'busy')}>${t.t('paywall.key.activate')}</button>
              </div>
              <p class="ba-small k-keystatus" id="pw-key-status" role="status">${status}</p>
            </details>`}
      </div>
    </main></div>`;
}
