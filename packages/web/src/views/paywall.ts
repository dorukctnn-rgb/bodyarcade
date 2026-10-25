// The Pro offer (design/ui-kit/paywall.html): a full screen of its own with a close button. Honest by construction: the
// benefit list holds only things that exist, "7 days free" appears only when the trial really applies to this player,
// the yearly saving is computed from the real prices, and every button does something: a plan with no real checkout
// address is not on the page, and where nothing can be bought the page says so and offers the licence key and the way back.
import { ROAD_RUN_WORLDS } from '../../../core/entitlements/features.ts';
import type { TrialView } from '../../../core/entitlements/trial.ts';
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { describeOffer, yearlySavingsPercent, type PlanId, type PlanOffer } from '../../../core/ui/plans.ts';
import { proGames } from '../../catalogue/filter.ts';
import { canRace } from '../app/duel.ts';
import { hasPro, titleOf, type ViewContext } from '../context.ts';

export type KeyStatus = 'idle' | 'busy' | 'ok' | 'not_found' | 'refunded' | 'ended' | 'limit' | 'network' | 'server';

/** What the box for the reminder e-mail last said. */
export type EmailNote = null | { kind: 'saved' } | { kind: 'cleared' } | { kind: 'error'; code: string };

export interface PaywallState {
  selected: PlanId;
  /** The locked game that sent the player here. */
  gameId?: string;
  keyOpen: boolean;
  keyStatus: KeyStatus;
  /** The free trial of an active membership: the notice and the state of the reminder e-mail. Null until it is asked for. */
  trial: TrialView | null;
  emailBusy: boolean;
  emailNote: EmailNote;
}

export const defaultPaywallState = (ctx: ViewContext, gameId?: string): PaywallState => ({
  selected: ctx.plans.offers.find((o) => o.featured)?.id ?? ctx.plans.offers[0]?.id ?? 'pro-yearly',
  ...(gameId ? { gameId } : {}),
  keyOpen: false,
  keyStatus: 'idle',
  trial: null,
  emailBusy: false,
  emailNote: null,
});

export const selectedOffer = (ctx: ViewContext, id: PlanId): PlanOffer | undefined => ctx.plans.offers.find((o) => o.id === id) ?? ctx.plans.offers[0];

const hasRoadRun = (ctx: ViewContext): boolean => ctx.games.some((g) => g.id === 'road-run');

/** What stays free, in one line: the games, the seated and quiet versions, no ads, and (while Road Run is in the catalogue) how many of its worlds. */
export function freeLine(ctx: ViewContext, freeGames: number): string {
  const t = ctx.i18n;
  const base = t.t('paywall.free', { n: freeGames });
  return hasRoadRun(ctx) ? `${base} ${t.t('paywall.free.worlds', { free: ROAD_RUN_WORLDS.free, total: ROAD_RUN_WORLDS.total })}` : base;
}

function benefits(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const pro = proGames(ctx.games);
  const items: SafeHtml[] = [];
  if (pro.length > 0) items.push(html`<li>${icon('arcade')}<span>${t.t('paywall.benefit.gamesList', { n: pro.length, names: t.list(pro.map((g) => titleOf(ctx, g))) })}</span></li>`);
  items.push(html`<li>${icon('trophy')}<span>${t.t('paywall.benefit.levels')}</span></li>`);
  // Road Run has ten worlds and three are free: Pro is the other seven (the same numbers as the terms and the FAQ).
  if (hasRoadRun(ctx)) items.push(html`<li>${icon('sparkle')}<span>${t.t('paywall.benefit.worlds', { n: ROAD_RUN_WORLDS.total - ROAD_RUN_WORLDS.free })}</span></li>`);
  // Only a promise the Room keeps: the server verifies the host's Pro before a Pro game starts (ROOM_PRO_ON in app/boot.ts), and a room
  // holds only the games that have the duel mode, so some Pro game must have it. The line waits for the first one, by itself.
  if (ctx.flags.social && ctx.flags.roomsPro && ctx.games.some((g) => !g.free && canRace(g))) items.push(html`<li>${icon('friends')}<span>${t.t('paywall.benefit.rooms')}</span></li>`);
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

/** What to say instead of offers where nothing can be bought. */
function noOffersText(ctx: ViewContext): string {
  const t = ctx.i18n;
  switch (ctx.paywall.note) {
    case 'play-only': return t.t('paywall.note.playOnly');
    case 'checking': return t.t('paywall.note.checking');
    default: return t.t('paywall.note.unavailable');
  }
}

/** The sentence about the reminder the paywall promises: only where a trial is on offer, and true to how it is kept here. */
function reminderText(ctx: ViewContext): string {
  return ctx.paywall.mode === 'play' ? ctx.i18n.t('paywall.reminder.play') : ctx.i18n.t('paywall.reminder.web');
}

function emailNoteText(ctx: ViewContext, n: EmailNote): string {
  const t = ctx.i18n;
  if (!n) return '';
  if (n.kind === 'saved') return t.t('trial.email.saved');
  if (n.kind === 'cleared') return t.t('trial.email.cleared');
  const key = `trial.email.err.${n.code}`;
  return t.has(key) ? t.tx(key) : t.t('trial.email.err.unavailable');
}

/** The free trial of an active membership: when it ends, and (on the web) the box for the one reminder e-mail. */
export function trialBlock(ctx: ViewContext, st: Pick<PaywallState, 'trial' | 'emailBusy' | 'emailNote'>): SafeHtml {
  const v = st.trial;
  if (!v || v.trialEnds === null) return html``;
  const t = ctx.i18n;
  const note = emailNoteText(ctx, st.emailNote);
  const statusLine = html`<p class="ba-small k-keystatus" id="tr-email-note" role="status" data-trial-note>${note}</p>`;
  let box: SafeHtml = html``;
  if (v.email === 'offer') {
    box = html`<div class="k-emailbox" data-trial-email="offer"><h3 class="ba-h3">${t.t('trial.email.title')}</h3><p>${t.t('trial.email.body')}</p>
      <div class="k-keyform"><div class="ba-field"><label for="tr-email">${t.t('trial.email.label')}</label><input class="ba-input" id="tr-email" name="reminderEmail" data-key="reminderEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" aria-describedby="tr-email-note"></div>
      <button type="button" class="ba-btn ba-btn--secondary" data-action="trial-email"${attr('disabled', st.emailBusy)}>${t.t('trial.email.cta')}</button></div>${statusLine}</div>`;
  } else if (v.email === 'set') {
    box = html`<div class="k-emailbox" data-trial-email="set"><p>${t.t('trial.email.set', { email: v.masked ?? '', date: v.sendAt ? t.date(v.sendAt) : '' })}</p>
      <button type="button" class="ba-btn ba-btn--quiet" data-action="trial-clear"${attr('disabled', st.emailBusy)}>${t.t('trial.email.clear')}</button>${statusLine}</div>`;
  } else if (note) box = html`<div class="k-emailbox">${statusLine}</div>`;
  return html`<section class="k-trial" aria-labelledby="tr-title" data-trial><h2 class="ba-h3" id="tr-title">${t.t('trial.title')}</h2><p>${t.t('trial.ends', { date: t.date(v.trialEnds) })}</p>${box}</section>`;
}

/** The page. It carries its own close button, so it is drawn without the site frame. */
export function paywallPage(ctx: ViewContext, st: PaywallState): SafeHtml {
  const t = ctx.i18n;
  const info = ctx.paywall;
  // The plan that is recommended comes first, the rest keep the order of the configuration.
  const shown = [...ctx.plans.offers].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  const sel = selectedOffer(ctx, st.selected);
  const d = sel ? describeOffer(sel, t, ctx.plans) : null;
  const game = st.gameId ? ctx.games.find((g) => g.id === st.gameId) : undefined;
  const pro = proGames(ctx.games);
  const freeCount = ctx.games.length - pro.length;
  const inPlay = info.mode === 'play';
  const status = keyStatusText(ctx, st.keyStatus);
  const close = html`<a class="ba-icon-btn k-close" href="${ctx.href('home')}" data-action="close-paywall" aria-label="${t.t('paywall.closeLabel')}">${icon('close')}</a>`;

  if (hasPro(ctx)) {
    return html`<div class="ba-app ba-app--bare"><a class="ba-skip" href="#main">${t.t('common.skipToContent')}</a>
      <main id="main" class="ba-page ba-page--pro" tabindex="-1">${close}<div class="k-stack"><h1 data-main-heading>${t.t('settings.section.pro')}</h1><p class="ba-callout">${icon('check')}<span>${t.t('paywall.active')}</span></p>
      ${trialBlock(ctx, st)}
      ${info.manageUrl ? html`<p><a class="ba-link" href="${info.manageUrl}" target="_blank" rel="noopener noreferrer">${t.t('paywall.manage')}</a></p>` : ''}
      <div class="k-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('home')}">${t.t('notfound.cta')}</a></div></div></main></div>`;
  }

  const offers = shown.length > 0
    ? html`<div class="k-plans" role="radiogroup" aria-label="${t.t('paywall.plans')}">${shown.map((o) => planRow(ctx, o, o.id === (sel?.id ?? st.selected)))}</div>
        <div class="k-actionbar"><div class="k-actions">
          <button type="button" class="ba-btn ba-btn--primary ba-btn--lg" data-action="buy" data-plan="${sel?.id ?? ''}">${d?.cta ?? t.t('paywall.cta.buy')}</button>
          <a class="ba-btn ba-btn--quiet" href="${ctx.href('home')}" data-action="close-paywall">${t.t('paywall.continueFree')}</a>
        </div><p class="k-note">${d?.trialLine ? `${d.trialLine}. ` : ''}${inPlay ? t.t('paywall.cancel.play') : info.mode === 'web' ? t.t('paywall.cancel.web') : ''}${ctx.plans.trialReminder && d?.trialLine ? ` ${reminderText(ctx)}` : ''}</p>${info.preview ? html`<p class="k-note k-preview" data-paywall-preview>${t.t('paywall.preview')}</p>` : ''}</div>`
    // Nothing can be bought here: no plan, no buy button, and the way back stays.
    : html`<div class="k-actionbar"><p class="k-note k-soon" role="status" data-paywall-note>${noOffersText(ctx)}</p><div class="k-actions"><a class="ba-btn ba-btn--quiet" href="${ctx.href('home')}" data-action="close-paywall">${t.t('paywall.continueFree')}</a></div></div>`;

  const key = !info.keyEntry.visible ? ''
    : html`<details class="k-keybox"${attr('open', st.keyOpen)}><summary>${icon('key')}<span>${t.t('paywall.key.title')}</span></summary>
        <div class="k-keyform">
          <div class="ba-field"><label for="pw-key">${t.t('paywall.key.label')}</label><input class="ba-input" id="pw-key" name="licenseKey" data-key="licenseKey" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="pw-key-status"></div>
          <button type="button" class="ba-btn ba-btn--secondary" data-action="activate-key"${attr('disabled', st.keyStatus === 'busy')}>${t.t('paywall.key.activate')}</button>
        </div>
        <p class="ba-small k-keystatus" id="pw-key-status" role="status">${status}</p>
      </details>`;

  return html`<div class="ba-app ba-app--bare"><a class="ba-skip" href="#main">${t.t('common.skipToContent')}</a>
    <main id="main" class="ba-page ba-page--pro" tabindex="-1">${close}
      <div class="k-pw" data-form="paywall">
        <div class="k-stack">
          <div class="k-pw-art" aria-hidden="true">${pro.slice(0, 3).map((g) => html`<img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="400" height="300">`)}</div>
          <h1 data-main-heading>${t.t('paywall.title')}</h1>
          <p class="lead">${game ? t.t('paywall.locked', { game: titleOf(ctx, game) }) : t.t('paywall.lead')}</p>
          ${benefits(ctx)}
          <p class="free">${icon('check')}<span>${freeLine(ctx, freeCount)}</span></p>
        </div>
        ${offers}
        ${inPlay ? html`<div class="k-links"><button class="ba-link" type="button" data-action="restore">${t.t('paywall.restore')}</button>${info.manageUrl ? html` <a class="ba-link" href="${info.manageUrl}" target="_blank" rel="noopener noreferrer">${t.t('paywall.manage')}</a>` : ''}</div>` : ''}
        ${key}
      </div>
    </main></div>`;
}
