// The windows that open over the friends screens: the sign-up (the age question, the name, the recovery code), bringing a
// profile back, the friend menu, report and block, the game choice and the QR code, and the tray of invitations. Each is a
// function of its own small state; the controller keeps the state and opens the dialog.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { icon } from '../../../../core/ui/icons.ts';
import { isProGame } from '../../../../core/net/live-games.ts';
import { REPORT_REASONS, type PresetId } from '../../../../core/types/net.ts';
import type { AgeBand, FriendEntry, ReportReason } from '../../../../core/social/types.ts';
import type { ShellGame } from '../../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../../context.ts';
import { COMMUNITY_RULES_ANCHOR, sitePageHref } from '../../views/chrome.ts';
import type { PendingInvite, ProNeeded } from '../port.ts';
import { qrSvg } from '../qr.ts';
import { ux } from '../strings.ts';
import { avatar } from '../ui.ts';

export type { PresetId };

// ---- the sign-up --------------------------------------------------------------------------------------------------------

export interface ProfileSheet {
  step: 'age' | 'name' | 'young' | 'recovery' | 'recover';
  band: AgeBand | null;
  /** Adults type the name; for under 18 this is the generated name shown. */
  name: string;
  /** A sentence: why the last step did not work. */
  error: string | null;
  busy: boolean;
  /** False when the profile will not survive closing the page (no IndexedDB). */
  persistent: boolean;
  /** The name step: the box that says the player agrees to the terms and the community rules is ticked. Nothing is made until it is. */
  terms: boolean;
  /** The player pressed Create with the box empty: the box is marked and the error line says why. */
  termsError: boolean;
  /** The recovery step: the friend code and the code to keep. */
  recovery: { friend: string; code: string } | null;
  /** The recover step. */
  recoverCode: string;
  recoverRecovery: string;
  recoverField: 'code' | 'recovery' | null;
}

export const NEW_PROFILE_SHEET: ProfileSheet = {
  step: 'age', band: null, name: '', error: null, busy: false, persistent: true, terms: false, termsError: false, recovery: null, recoverCode: '', recoverRecovery: '', recoverField: null,
};

function ageCard(ctx: ViewContext, band: AgeBand, checked: boolean): SafeHtml {
  const u = ux(ctx);
  const lines = [1, 2, 3] as const;
  return html`<label class="k-age"><input type="radio" name="age" value="${band}" data-key="age-${band}"${attr('checked', checked)}><b>${u(`age.${band}`)}</b><ul>${lines.map((n) => html`<li>${u(`age.${band}.${n}` as 'age.child.1')}</li>`)}</ul></label>`;
}

/** The recovery code in the groups it is written in, with what to do with it. Closes with 'saved' (the player keeps the code). */
export function recoveryBody(ctx: ViewContext, o: { friend: string; code: string; persistent?: boolean }, closeResult = 'saved'): SafeHtml {
  const u = ux(ctx);
  return html`<h2 id="sheet-h">${u('recovery.title')}</h2>
    <p class="ba-small k-flat" id="sheet-d">${u('recovery.body')}</p>
    ${o.persistent === false ? html`<p class="ba-callout">${icon('info')}<span>${u('name.persistent')}</span></p>` : ''}
    <dl class="k-recoverybox">
      <div><dt>${u('recovery.friend')}</dt><dd class="k-recoverycode k-recoverycode--friend" data-friend-code>${o.friend}</dd></div>
      <div><dt>${u('recovery.label')}</dt><dd class="k-recoverycode" data-recovery-code>${o.code}</dd></div>
    </dl>
    <div class="k-rowbtns k-rowbtns--wrap"><button class="ba-btn ba-btn--secondary" type="button" data-action="sheet.recovery.copy">${icon('copy')}${u('recovery.copy')}</button><button class="ba-btn ba-btn--secondary" type="button" data-action="sheet.recovery.download">${icon('download')}${u('recovery.download')}</button></div>
    <p class="k-fine">${icon('lock')} ${u('recovery.warn')}</p>
    <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-dialog-close="${closeResult}" data-action="sheet.recovery.saved" autofocus>${u('recovery.saved')}</button></div>`;
}

export function recoverySheet(ctx: ViewContext, o: { friend: string; code: string; persistent?: boolean }): SafeHtml {
  return html`<div class="k-sheet k-sheet--bare">${recoveryBody(ctx, o)}</div>`;
}

/**
 * "I agree to the terms of use and the community rules. See also the privacy policy." The sentence is the language's own, with the three
 * links where its grammar wants them (the Turkish ones carry their case endings), so the words come as one message with three marks that
 * are swapped for links. The pages open in a new tab, so the sheet and what was typed stay where they are.
 */
export function termsLine(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const lang = ctx.lang;
  const targets = {
    terms: sitePageHref(lang, 'terms'),
    rules: `${sitePageHref(lang, 'terms')}#${COMMUNITY_RULES_ANCHOR[lang === 'tr' ? 'tr' : 'en']}`,
    privacy: sitePageHref(lang, 'privacy'),
  } as const;
  const parts = t.t('safety.terms.agree', { terms: '[[terms]]', rules: '[[rules]]', privacy: '[[privacy]]' }).split(/\[\[(terms|rules|privacy)\]\]/);
  // split() with a group alternates text and the group: even places are words, odd ones name a link
  return html`${parts.map((p, i) => (i % 2 === 0
    ? html`${p}`
    : html`<a class="ba-link" href="${targets[p as keyof typeof targets]}" target="_blank" rel="noopener" data-native>${t.tx(`safety.terms.${p}`)}</a>`))}`;
}

export function profileSheet(ctx: ViewContext, s: ProfileSheet): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  if (s.step === 'age') {
    return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${u('age.title')}</h2>
      <p class="ba-small k-flat" id="sheet-d">${u('age.body')}</p>
      <fieldset class="ba-fieldset"><legend class="ba-visually-hidden">${u('age.title')}</legend><div class="k-agecards">${(['child', 'teen', 'adult'] as const).map((b) => ageCard(ctx, b, s.band === b))}</div></fieldset>
      <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.age.next"${attr('disabled', s.band === null)}>${u('age.continue')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.recover.open">${u('age.have')}</button><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
  }
  if (s.step === 'young') {
    return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${u('young.title')}</h2>
      <p class="k-flat" id="sheet-d">${u('young.body')}</p><p class="ba-small k-flat">${u('young.kept')}</p>
      <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-dialog-close="games" autofocus>${u('young.games')}</button></div></div>`;
  }
  if (s.step === 'recovery' && s.recovery) return html`<div class="k-sheet k-sheet--bare">${recoveryBody(ctx, { friend: s.recovery.friend, code: s.recovery.code, persistent: s.persistent }, 'created')}</div>`;
  if (s.step === 'recover') {
    return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${u('recover.title')}</h2>
      <p class="ba-small k-flat" id="sheet-d">${u('recover.body')}</p>
      <div class="ba-field"><label for="recover-code">${u('recover.code')}</label><input class="ba-input k-codeinput" id="recover-code" name="recoverCode" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="BA-7K2Q4X" data-key="recover-code" value="${s.recoverCode}"${attr('aria-invalid', s.recoverField === 'code' ? 'true' : false)} aria-describedby="recover-note"></div>
      <div class="ba-field"><label for="recover-recovery">${u('recover.recovery')}</label><input class="ba-input k-codeinput" id="recover-recovery" name="recoverRecovery" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="7K2Q-4XMV-ABCD-EFGH" data-key="recover-recovery" value="${s.recoverRecovery}"${attr('aria-invalid', s.recoverField === 'recovery' ? 'true' : false)} aria-describedby="recover-note"></div>
      <p class="ba-small k-note-line is-error" id="recover-note" role="alert">${s.error ?? ''}</p>
      <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.recover.go"${attr('disabled', s.busy)}>${u('recover.cta')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.recover.back">${t.t('common.back')}</button></div></div>`;
  }
  const adult = s.band === 'adult';
  return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('safety.name.title')}</h2>
    <p class="ba-small k-flat" id="sheet-d">${adult ? t.t('safety.name.adultBody') : t.t('safety.name.minorBody')}</p>
    ${adult
      ? html`<div class="ba-field"><label for="profile-name">${t.t('safety.name.label')}</label><input class="ba-input" id="profile-name" name="name" type="text" autocomplete="nickname" maxlength="20" spellcheck="false" data-key="profile-name" value="${s.name}" aria-describedby="profile-hint profile-note"><small class="ba-small" id="profile-hint">${u('name.hintAdult')}</small></div>`
      : html`<div class="k-namepick"><span class="k-namepick__name" data-generated-name>${s.name}</span><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.name.shuffle">${t.t('safety.name.another')}</button></div>`}
    ${s.persistent ? '' : html`<p class="ba-callout">${icon('info')}<span>${u('name.persistent')}</span></p>`}
    <label class="k-check k-check--agree"><input type="checkbox" id="profile-terms" name="terms" value="1" data-key="profile-terms" aria-required="true" aria-describedby="profile-terms-links profile-note"${attr('checked', s.terms)}${attr('aria-invalid', s.termsError ? 'true' : false)}><span>${termsLine(ctx)}</span></label>
    <span class="ba-visually-hidden" id="profile-terms-links">${t.t('safety.terms.newTab')}</span>
    <p class="ba-small k-note-line is-error" id="profile-note" role="alert">${s.error ?? ''}</p>
    <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.name.create"${attr('disabled', s.busy)}>${t.t('safety.name.create')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.name.back">${t.t('common.back')}</button></div></div>`;
}

// ---- friends, report, block, game, QR ----------------------------------------------------------------------------------

export function friendMenuSheet(ctx: ViewContext, f: Pick<FriendEntry, 'fid' | 'name'>): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${avatar(f.fid)}<h2 id="sheet-h">${f.name}</h2></div>
    <div class="btns"><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="remove">${t.t('social.friend.remove')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="report">${icon('flag')}${t.t('social.friend.report')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="block">${icon('block')}${t.t('social.friend.block')}</button><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
}

/** The menu of a player in a seat of a room: no friendship to remove, only a report or a block. */
export function seatMenuSheet(ctx: ViewContext, who: { seat: string; name: string }): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${avatar(who.seat)}<h2 id="sheet-h">${u('room.seatTitle', { name: who.name })}</h2></div>
    <div class="btns"><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="report">${icon('flag')}${t.t('social.friend.report')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="block">${icon('block')}${t.t('social.friend.block')}</button><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
}

export interface ReportSheet { reason: ReportReason; alsoBlock: boolean; details: string }

/** The words of a reason in the report sheet: the shell's own, except "seems too young", whose age is the rule's (ONLINE_MIN_AGE). */
const reasonLabel = (ctx: ViewContext, r: ReportReason): string => (r === 'underage' ? ux(ctx)('report.underage') : ctx.i18n.tx(`safety.report.reason.${r}`));

/** A report names a reason and may carry a typed note; only a grown-up's report does (a young player picks a reason and nothing else). */
export function reportSheet(ctx: ViewContext, who: { fid: string; name: string }, s: ReportSheet, canNote = true): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${avatar(who.fid)}<h2 id="sheet-h">${t.t('safety.report.title', { name: who.name })}</h2></div>
    <fieldset class="ba-fieldset"><legend class="ba-visually-hidden">${t.t('safety.report.reason')}</legend><div class="k-radios">${REPORT_REASONS.map((r) => html`<label class="k-radio"><input type="radio" name="reason" value="${r}" data-key="reason-${r}"${attr('checked', s.reason === r)}>${reasonLabel(ctx, r)}</label>`)}</div></fieldset>
    ${canNote ? html`<textarea class="ba-input k-textarea" name="details" maxlength="500" aria-label="${t.t('safety.report.details')}" placeholder="${t.t('safety.report.details')}" data-key="report-details">${s.details}</textarea>` : ''}
    <label class="k-check"><input type="checkbox" name="alsoBlock" data-key="report-block"${attr('checked', s.alsoBlock)}>${t.t('safety.report.alsoBlock', { name: who.name })}</label>
    <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.report.send">${icon('flag')}${t.t('safety.report.send')}</button><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div>
    <p class="k-fine" id="sheet-d">${t.t('safety.report.fine', { name: who.name })}</p></div>`;
}

export function blockSheet(ctx: ViewContext, who: { fid: string; name: string }): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${avatar(who.fid)}<h2 id="sheet-h">${t.t('safety.block.title', { name: who.name })}</h2></div>
    <p class="ba-small k-flat" id="sheet-d">${t.t('safety.block.body', { name: who.name })}</p>
    <div class="btns"><button class="ba-btn ba-btn--danger ba-btn--lg" type="button" data-dialog-close="yes">${icon('block')}${t.t('safety.block.cta')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="no" autofocus>${t.t('common.cancel')}</button></div></div>`;
}

/** The host picks the game of the room. A Pro game carries its tag: the Room starts it only while the host's Pro stands behind it. */
export function gameSheet(ctx: ViewContext, games: readonly ShellGame[], current: string): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('room.game.label')}</h2>
    <div class="k-radios">${games.map((g) => html`<button class="k-radio k-radio--btn" type="button" data-dialog-close="${g.id}"${attr('aria-current', g.id === current && 'true')}><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="48" height="36">${titleOf(ctx, g)}${isProGame(g.id) ? html`<span class="k-protag k-protag--pill">${t.t('common.pro')}</span>` : ''}</button>`)}</div>
    <div class="btns"><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
}

/**
 * A Pro game was refused to the host (or the page knows the host has no Pro): why, and the way to Pro. The other way, a free game, is the
 * picker the player already has. Closes with 'see' (to the Pro page) or 'later'.
 */
export function proSheet(ctx: ViewContext, o: { game: ShellGame | null; reason: ProNeeded['reason'] }): SafeHtml {
  const u = ux(ctx);
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${icon('sparkle', { size: 28 })}<h2 id="sheet-h">${u('pro.title')}</h2></div>
    ${o.game ? html`<p class="k-progame"><img src="${ctx.assets.tile(o.game.catalogue.tile, 400)}" alt="" width="48" height="36"><b>${titleOf(ctx, o.game)}</b></p>` : ''}
    <p class="ba-small k-flat" id="sheet-d">${u(`pro.${o.reason}`)}</p>
    <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-dialog-close="see">${u('pro.see')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="later" autofocus>${u('pro.later')}</button></div></div>`;
}

export function qrSheet(ctx: ViewContext, link: string): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('room.qrTitle')}</h2>
    <div class="ba-qr ba-qr--big">${qrSvg(link, t.t('room.qr'))}</div>
    <div class="btns"><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="done" autofocus>${t.t('common.done')}</button></div></div>`;
}

// ---- invitations ------------------------------------------------------------------------------------------------------------

/** "1:42": what is left of an invitation. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The tray of invitations that wait for an answer: one card each, with the game and the time left. Empty markup when there are none. */
export function inviteTray(ctx: ViewContext, invites: readonly PendingInvite[], now: number): SafeHtml {
  const u = ux(ctx);
  const live = invites.filter((i) => i.exp > now);
  if (live.length === 0) return html``;
  return html`<section class="k-tray" aria-label="${u('invite.region')}">${live.slice(0, 3).map((i) => {
    const g = ctx.games.find((x) => x.id === i.game);
    const line = u('invite.line', { name: i.from.name, game: g ? titleOf(ctx, g) : i.game });
    return html`<div class="k-tray__card" role="group" aria-label="${line}" data-invite="${i.id}">${avatar(i.from.fid)}<div class="grow"><b>${line}</b><small data-invite-left>${u('invite.left', { time: clockText(i.exp - now) })}</small></div><div class="k-rowbtns"><button class="ba-btn ba-btn--primary" type="button" data-action="invite.join" data-id="${i.id}">${u('invite.join')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="invite.decline" data-id="${i.id}">${u('invite.decline')}</button></div></div>`;
  })}</section>`;
}
