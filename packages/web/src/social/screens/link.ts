// The page a friend link opens (/f/BA-XXXXXX), and the safety page. The link holds only a friend code: the app cannot look up
// whose it is, so the page shows the code and never a name. Sending the request asks the age question first when the player
// has no profile, then sends it and says "Request sent" whatever the other side will do with it.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { glyph, type PoseName } from '../../../../core/ui/glyphs.ts';
import { REPORT_REASONS } from '../../../../core/types/net.ts';
import type { BlockEntry } from '../../../../core/social/types.ts';
import type { ViewContext } from '../../context.ts';
import { chrome } from '../../views/chrome.ts';
import { pageHead } from '../../views/parts.ts';
import type { NoOnline } from '../port.ts';
import { ux } from '../strings.ts';
import { avatar } from '../ui.ts';
import { kidPanel, panel, under13Panel } from './friends.ts';

export interface FriendLinkView {
  /** The friend code in the link, or null when the link holds none that is valid. */
  code: string | null;
  profile: boolean;
  /** The code in the link is this player's own. */
  own: boolean;
  busy: boolean;
  /** The request went out (the answer is always the same) or the two are friends already. */
  done: 'sent' | 'friends' | null;
  note: { ok: boolean; text: string } | null;
  noOnline: NoOnline | null;
  /** The service did not answer when the page opened. */
  offline: boolean;
}

export const NO_LINK_VIEW: FriendLinkView = { code: null, profile: false, own: false, busy: false, done: null, note: null, noOnline: null, offline: false };

export function friendLinkMain(ctx: ViewContext, v: FriendLinkView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const head = pageHead(ctx, u('link.title'), { back: ctx.href('friends') });
  if (v.code === null) return html`${head}<p class="ba-lead k-mt" role="alert">${t.t('friendlink.bad')}</p><div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('friends')}">${t.t('room.problem.back')}</a></div>`;
  if (v.noOnline === 'under13') return html`${head}${under13Panel(ctx)}`;
  if (v.noOnline === 'kid') return html`${head}${kidPanel(ctx)}`;
  if (v.offline && !v.profile) {
    return html`${head}${panel({ icon: 'wifi', title: t.t('social.offline.title'), body: u('link.offline'), actions: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.retry">${t.t('social.retry')}</button>` })}`;
  }
  const note = v.note ? html`<p class="ba-small k-note-line${v.note.ok ? '' : ' is-error'}" role="${v.note.ok ? 'status' : 'alert'}">${v.note.text}</p>` : html`<p class="ba-small k-note-line" role="status"></p>`;
  const actions = v.done !== null
    ? html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('friends')}">${u('link.open')}</a>`
    : v.own
      ? html`<a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('friends')}">${u('link.open')}</a>`
      : html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="friendlink.send"${attr('disabled', v.busy)}>${u('link.cta')}</button>${v.profile ? '' : html`<button class="ba-btn ba-btn--quiet" type="button" data-action="social.recover">${u('link.have')}</button>`}`;
  return html`${head}<section class="k-card k-mt k-linkcard" aria-labelledby="link-h"><h2 class="k-h3" id="link-h">${u('recover.code')}</h2>
    <p class="k-linkcode">${v.code}</p>
    <p>${v.own ? u('link.own') : u('link.body', { code: v.code })}</p>
    <div class="ba-actions k-mt">${actions}</div>${note}</section>`;
}

export function friendLinkPage(ctx: ViewContext, v: FriendLinkView): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: friendLinkMain(ctx, v), mainClass: 'ba-page--friendlink', pushed: true });
}

// ---- safety -----------------------------------------------------------------------------------------------------------

function ageCards(ctx: ViewContext): SafeHtml {
  const u = ux(ctx);
  return html`<div class="k-agecards">${(['child', 'teen', 'adult'] as const).map((b) => html`<div class="k-age k-age--static"><b>${u(`age.${b}`)}</b><ul>${[1, 2, 3].map((n) => html`<li>${u(`age.${b}.${n}` as 'age.child.1')}</li>`)}</ul></div>`)}</div>`;
}

export function safetyMain(ctx: ViewContext, blocks: readonly BlockEntry[]): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const sees = (id: 'strangers' | 'friends' | 'video', art: SafeHtml, cls = ''): SafeHtml =>
    html`<div class="k-card"><div class="pic ${cls}">${art}</div><h3>${t.tx(`safety.sees.${id}`)}</h3><ul>${[1, 2, 3].map((n) => html`<li>${t.tx(`safety.sees.${id}.${n}`)}</li>`)}</ul></div>`;
  const dark = (p: PoseName, accent: string): SafeHtml => glyph(p, { ink: '#F4F2F8', accent, ball: accent, floor: false, size: 100, decorative: true });
  return html`${pageHead(ctx, t.t('safety.title'), { back: ctx.href('friends') })}
    <p class="k-sub">${t.t('safety.sub')}</p>
    <div class="k-flows">
      <div><span class="k-flow-label">${t.t('safety.flow.age')}</span><section class="k-sheet" aria-labelledby="age-h"><h2 id="age-h">${u('age.title')}</h2><p class="ba-small k-flat">${u('age.body')}</p>${ageCards(ctx)}</section></div>
      <div><span class="k-flow-label">${t.t('safety.flow.report')}</span><section class="k-sheet" aria-labelledby="rep-h"><h2 id="rep-h">${u('safety.reportTitle')}</h2><ul class="k-plainlist">${REPORT_REASONS.map((r) => html`<li>${t.tx(`safety.report.reason.${r}`)}</li>`)}</ul><p class="k-fine">${u('safety.reportFine')}</p></section></div>
      <div><span class="k-flow-label">${t.t('safety.flow.block')}</span><section class="k-sheet" aria-labelledby="blk-h"><h2 id="blk-h">${u('safety.blockTitle')}</h2><p class="ba-small k-flat">${u('safety.blockBody')}</p></section></div>
    </div>
    <section class="ba-section" aria-labelledby="sees"><header><h2 id="sees">${t.t('safety.sees.title')}</h2></header>
      <div class="k-sees">${sees('strangers', dark('jackOpen', '#46B4FF'))}${sees('friends', avatar('friends'), 'friend')}${sees('video', html`${dark('squat', '#FF4F6E')}`)}</div>
    </section>
    <section class="ba-section k-facts-grid" aria-labelledby="keep">
      <header><h2 id="keep">${u('safety.keepTitle')}</h2></header>
      <p class="k-prose">${u('safety.keepBody')}</p>
      <div class="k-factcards">
        <div class="k-card"><h3>${u('safety.searchTitle')}</h3><p>${u('safety.searchBody')}</p></div>
        <div class="k-card"><h3>${u('safety.sentTitle')}</h3><p>${u('safety.sentBody')}</p></div>
        <div class="k-card"><h3>${u('safety.under13Title')}</h3><p>${u('safety.under13Body')}</p></div>
      </div>
    </section>
    <section class="ba-section" aria-labelledby="blocked"><header><h2 id="blocked">${t.t('safety.blocked.title')}</h2></header>
      ${blocks.length === 0 ? html`<p class="ba-lead">${t.t('safety.blocked.empty')}</p>` : html`<ul class="ba-list" data-list="blocks">${blocks.map((b) => html`<li>${avatar(b.fid)}<div class="grow"><b>${b.name}</b></div><div class="k-rowbtns"><button class="ba-btn ba-btn--secondary" type="button" data-action="social.unblock" data-fid="${b.fid}">${t.t('safety.blocked.unblock')}</button></div></li>`)}</ul>`}
    </section>`;
}

export function safetyPage(ctx: ViewContext, blocks: readonly BlockEntry[]): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: safetyMain(ctx, blocks), mainClass: 'ba-page--safety', pushed: true });
}

