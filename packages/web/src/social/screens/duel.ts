// The screens of duel links (sprint arm E, core/net/duel-link.ts): the duel card at the top of a duel room's page (the link to send,
// how long it stays open, how the duel is played, what the friend sees of the player), the line that takes the place of the camera
// switch (a duel has no camera picture at all), the name step of the guest window, and the duel's result card.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { icon } from '../../../../core/ui/icons.ts';
import { secondsLeft } from '../../../../core/net/duel-link.ts';
import type { ShellGame } from '../../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../../context.ts';
import type { RaceOutcome } from '../../app/race.ts';
import { lrText } from '../../app/live-strings.ts';
import { clockOf, duelText } from '../duel-strings.ts';
import type { RoomState } from '../port.ts';
import type { ProfileSheet } from './sheets.ts';
import { termsLine } from './sheets.ts';

/** The least time a duel room must have left for another round: the match, the start count and the wait for the result. */
export const roundNeedsMs = (durationMs: number): number => durationMs + 3500 + 8000;

/** Is there time for another round in this duel room at `now` (server time)? */
export function roundFits(info: { duel?: { closesAt: number }; config: { durationMs: number } }, now: number): boolean {
  return !info.duel || now + roundNeedsMs(info.config.durationMs) <= info.duel.closesAt;
}

/**
 * The duel card of the room page: the link (sent through the system share sheet where there is one, else copied), the time left
 * before the link closes (the page ticks it: [data-duel-left]), the way the game is played, and what the friend sees.
 */
export function duelCard(ctx: ViewContext, r: RoomState, game: ShellGame | null, now: number): SafeHtml {
  const info = r.info;
  if (!info?.duel) return html``;
  const d = duelText(ctx.i18n);
  const me = r.members.find((m) => m.seat === r.me);
  const both = r.members.length >= 2;
  const left = secondsLeft(info.duel.closesAt, now);
  const fits = roundFits(info, now);
  return html`<section class="k-card k-duelcard k-mt" aria-labelledby="duel-h" data-duel-card data-mode="${info.duel.mode}">
    <div class="k-duelcard__head">${icon('trophy')}<h2 class="k-h3" id="duel-h">${d('card.title')}${game ? html`<span class="k-duelcard__game">${titleOf(ctx, game)}</span>` : ''}</h2></div>
    <p class="k-flat">${both ? d('card.leadJoined') : d('card.lead')}</p>
    ${both ? '' : html`<div class="k-rowbtns k-rowbtns--wrap k-mt"><button class="ba-btn ba-btn--primary" type="button" data-action="duel.share">${icon('share')}${d('card.share')}</button></div>`}
    <p class="k-duelcard__left" role="timer" aria-live="off" data-duel-left data-closes="${String(info.duel.closesAt)}"${attr('data-low', !fits)}>${icon('clock')}<span>${d('card.left', { time: clockOf(left) })}</span></p>
    ${fits ? '' : html`<p class="k-fine" role="status" data-duel-closing>${d('card.closing')}</p>${game ? html`<button class="ba-btn ba-btn--secondary k-mt" type="button" data-action="race.new" data-game="${game.id}">${icon('plus')}${d('card.new')}</button>` : ''}`}
    <ul class="k-duelcard__facts">
      <li>${icon('users')}<span>${d(info.duel.mode === 'race' ? 'card.race' : 'card.score')}</span></li>
      <li>${icon('shield')}<span>${d('card.privacy')}</span></li>
      ${r.guest && me ? html`<li data-duel-guest>${icon('user')}<span>${d('card.guest', { name: me.name })}</span></li>` : ''}
    </ul>
  </section>`;
}

/** What a duel room says where another room has the camera switch: there is no camera picture to share at all. */
export function duelCamNote(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<b id="cam">${t.t('room.share.title')}</b><p class="k-fine" data-duel-nocam>${duelText(t)('card.privacy')}</p>`;
}

/**
 * The name step of the guest window: the generated name (another one on request), the agreement to the rules, and the way in. The age
 * step before it is the profile window's own; under 16 ends there, as it does for a profile.
 */
export function guestNameStep(ctx: ViewContext, s: ProfileSheet): SafeHtml {
  const t = ctx.i18n;
  const d = duelText(t);
  const fresh = s.guest === 'new';
  return html`<div class="k-sheet k-sheet--bare" data-guest-sheet><h2 id="sheet-h">${d(fresh ? 'guest.titleNew' : 'guest.title')}</h2>
    <p class="ba-small k-flat" id="sheet-d">${d('guest.body')}</p>
    <div class="k-namepick"><span class="k-namepick__name" data-generated-name>${s.name}</span><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.name.shuffle">${t.t('safety.name.another')}</button></div>
    <label class="k-check k-check--agree"><input type="checkbox" id="profile-terms" name="terms" value="1" data-key="profile-terms" aria-required="true" aria-describedby="profile-terms-links profile-note"${attr('checked', s.terms)}${attr('aria-invalid', s.termsError ? 'true' : false)}><span>${termsLine(ctx)}</span></label>
    <span class="ba-visually-hidden" id="profile-terms-links">${t.t('safety.terms.newTab')}</span>
    <p class="ba-small k-note-line is-error" id="profile-note" role="alert">${s.error ?? ''}</p>
    <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.guest.go"${attr('disabled', s.busy)}>${d(fresh ? 'guest.goNew' : 'guest.go')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.guest.profile">${d('guest.profile')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.name.back">${t.t('common.back')}</button></div></div>`;
}

/**
 * The result card of a duel: who won, the two scores side by side, the room's line about the rematch ([data-rematch], kept up to date
 * by the app), and, when the room has no time left for another round, the way to a new link.
 */
export function duelResultBlock(ctx: ViewContext, r: RaceOutcome, now: number): SafeHtml {
  const live = r.live;
  const duel = live?.duel;
  if (!live || !duel) return html``;
  const t = ctx.i18n;
  const d = duelText(t);
  const lr = lrText(t);
  const rival = live.seats.find((s) => !s.you);
  const left = live.seats.filter((s) => !s.you && s.forfeited);
  const verdict = live.reason === 'abandoned' ? lr('result.abandoned')
    : live.reason === 'no_contest' ? (left.length === 1 ? lr('result.early', { name: left[0]?.name ?? '' }) : lr('result.noContest'))
      : live.reason === 'forfeit' && r.won && rival?.forfeited ? lr('result.left.one', { name: rival.name })
        : r.won ? d('result.won') : r.draw ? d('result.draw') : d('result.lost', { name: rival?.name ?? '' });
  const fits = now + roundNeedsMs(duel.durationMs) <= duel.closesAt;
  const counted = live.reason !== 'abandoned' && live.reason !== 'no_contest';
  // the two of them side by side, best first (the same rows and order on both pages: a race's places list, drawn as two columns)
  const col = (s: (typeof live.seats)[number]): SafeHtml => html`<li data-seat="${s.seat}"${attr('data-you', s.you)}${attr('data-left', s.forfeited)}${attr('data-win', counted && !r.draw && s.place === 1 && !s.forfeited)}>
      ${s.place !== null && !s.forfeited ? html`<span class="lr-place" aria-hidden="true">${String(s.place)}</span><span class="ba-visually-hidden">${lr('result.place', { n: s.place })}</span>` : html`<span class="lr-place lr-place--out" aria-hidden="true"></span>`}
      <span class="lr-pname">${s.you ? lr('result.you', { name: s.name || d('result.you') }) : s.name}${s.forfeited ? html` <small>${lr('result.forfeit')}</small>` : ''}</span>
      <b class="lr-ppoints">${t.t('race.points', { n: s.score })}</b></li>`;
  return html`<section class="k-card rc-result lr-result k-duelresult" aria-labelledby="race-result-h" data-race data-live-result data-duel-result data-room="${live.room}">
    <h2 class="k-h3" id="race-result-h">${d('result.title')}</h2>
    <p class="rc-verdict" role="status" data-race-verdict>${verdict}</p>
    <ol class="lr-places k-duelresult__scores" aria-label="${lr('result.list')}">${live.seats.map(col)}</ol>
    <p class="ba-small lr-rematch" role="status" data-rematch></p>
    ${fits ? '' : html`<p class="ba-small" data-duel-closed>${d('result.closed')}</p><div class="ba-actions rc-actions"><button type="button" class="ba-btn ba-btn--secondary" data-action="race.new" data-game="${duel.game}">${icon('plus')}<span>${d('card.new')}</span></button></div>`}
    <div class="ba-actions rc-actions"><button type="button" class="ba-btn ba-btn--quiet" data-action="room.leave">${lr('result.leave')}</button></div>
  </section>`;
}
