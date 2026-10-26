// The players screens (the Family plan): "Who is playing?", the list to manage, and the form to add or edit a player. They are
// real buttons, links and form fields (the page works from the keyboard and a screen reader); the rules of who may do what are the
// profile book's (core/store/profiles.ts), so a card that cannot be chosen says why and nothing here decides it. A child's name
// and picture are only ever drawn on this device. The words say what happens (what is kept, what is removed), not a warning.
import type { AvatarId, FamilyEntry, ProfileView } from '../../../core/store/index.ts';
import { NAME_MAX } from '../../../core/store/index.ts';
import { AVATAR_IDS, avatar } from '../../../core/ui/avatars.ts';
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';
import { failureKey, lastPlayed, type FormDraft, type ProfilesPageState, type ProfilesView } from '../app/profiles-model.ts';
import { chrome } from './chrome.ts';
import { switchRow } from './forms.ts';

const avatarName = (ctx: ViewContext, id: AvatarId): string => ctx.i18n.tx(`profile.avatar.${id}`);

/** "Played yesterday" and the like, from the day the profile was last used. */
export function lastPlayedText(ctx: ViewContext, at: number | null, now: number): string {
  const t = ctx.i18n;
  const l = lastPlayed(now, at);
  switch (l.kind) {
    case 'never': return t.t('profile.lastPlayed.never');
    case 'today': return t.t('profile.lastPlayed.today');
    case 'yesterday': return t.t('profile.lastPlayed.yesterday');
    case 'days': return t.t('profile.lastPlayed.days', { n: l.n });
  }
}

function badges(ctx: ViewContext, p: ProfileView): SafeHtml {
  const t = ctx.i18n;
  return html`${p.owner ? html`<span class="pf-badge">${t.t('profile.badge.owner')}</span>` : ''}${p.kid ? html`<span class="pf-badge pf-badge--kid">${t.t('profile.badge.kid')}</span>` : ''}`;
}

/** One player on the picker: the whole card is the button that chooses them. A closed one is shown and says why. */
function pickCard(ctx: ViewContext, p: ProfileView, now: number): SafeHtml {
  const t = ctx.i18n;
  const locked = p.state === 'locked';
  const status = locked ? t.t('profile.locked') : p.active ? t.t('profile.playing') : lastPlayedText(ctx, p.lastUsedAt, now);
  // The picture is only a drawing; the name, the badges and the line under them are the button's name (read in that order), so the
  // name holds every word the card shows (WCAG 2.5.3, label in name). Nothing is added to it.
  const inner = html`<span class="pf-face">${avatar(p.avatar, { size: 88 })}${locked ? html`<span class="pf-lock">${icon('lock')}</span>` : ''}</span>
    <b class="pf-name">${p.name}</b><span class="pf-badges">${badges(ctx, p)}</span>
    <small>${status}</small>`;
  return locked
    ? html`<li><div class="pf-card is-locked" data-profile="${p.id}" aria-disabled="true">${inner}</div></li>`
    : html`<li><button type="button" class="pf-card${p.active ? ' is-active' : ''}" data-action="profile-pick" data-id="${p.id}"${attr('aria-current', p.active && 'true')}>${inner}</button></li>`;
}

function addCard(ctx: ViewContext, st: ProfilesPageState): SafeHtml {
  const t = ctx.i18n;
  const add = st.picker?.add;
  if (!add?.show) return html``;
  // While the Family plan is not sold, a device that cannot add players is not told about it.
  if (add.why === 'plan' && !ctx.flags.family) return html``;
  if (add.why === 'plan') return html`<li><a class="pf-card pf-card--add" href="${ctx.href('pro')}"><span class="pf-plus" aria-hidden="true">${icon('plus')}</span><b>${t.t('profile.add.plan')}</b></a></li>`;
  return html`<li><button type="button" class="pf-card pf-card--add" data-action="profile-add"><span class="pf-plus" aria-hidden="true">${icon('plus')}</span><b>${t.t('profile.add')}</b></button></li>`;
}

function notices(ctx: ViewContext, st: ProfilesPageState): SafeHtml {
  const t = ctx.i18n;
  const n = st.picker?.notice;
  return html`${n === 'frozen' ? html`<p class="ba-callout" role="note">${icon('info')}<span>${t.t('profile.notice.frozen')}</span></p>` : ''}${n === 'memory' ? html`<p class="ba-callout" role="note">${icon('info')}<span>${t.t('profile.notice.memory')}</span></p>` : ''}`;
}

function askRow(ctx: ViewContext, st: ProfilesPageState): SafeHtml {
  const t = ctx.i18n;
  if (!st.picker || st.picker.notice === 'frozen') return html``;
  return html`<div class="k-card pf-ask">${switchRow({ id: 'pf-ask', name: 'askOnStart', label: t.t('profile.askOnStart'), checked: st.picker.askOnStart })}</div>`;
}

function pickView(ctx: ViewContext, st: ProfilesPageState, now: number): SafeHtml {
  const t = ctx.i18n;
  const p = st.picker;
  const guarded = p?.guarded === true;
  return html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${guarded ? t.t('profile.guard.title') : t.t('profile.title')}</h1></header>
    <p class="ba-lead">${guarded ? t.t('profile.guard.body') : t.t('profile.lead')}</p>
    ${notices(ctx, st)}
    ${guarded ? html`<div class="ba-actions"><button type="button" class="ba-btn ba-btn--primary ba-btn--lg" data-action="profile-gate">${t.t('profile.gate.go')}</button></div>` : ''}
    <ul class="pf-cards" aria-label="${t.t('profile.title')}">${(p?.cards ?? []).filter((c) => !guarded || c.kid).map((c) => pickCard(ctx, c, now))}${guarded ? '' : addCard(ctx, st)}</ul>
    <div class="ba-actions pf-actions"><button type="button" class="ba-btn ba-btn--secondary" data-action="profile-manage">${t.t('profile.manage')}</button></div>
    ${askRow(ctx, st)}`;
}

function manageRow(ctx: ViewContext, p: ProfileView, now: number): SafeHtml {
  const t = ctx.i18n;
  const locked = p.state === 'locked';
  return html`<li class="pf-row">${avatar(p.avatar, { size: 48 })}<div class="pf-who"><b>${p.name}</b><span class="pf-badges">${badges(ctx, p)}</span><small>${locked ? t.t('profile.locked') : lastPlayedText(ctx, p.lastUsedAt, now)}</small></div>
    <div class="pf-rowbtns">${locked ? '' : html`<button type="button" class="ba-btn ba-btn--quiet" data-action="profile-edit" data-id="${p.id}" aria-label="${t.t('profile.edit')}: ${p.name}">${t.t('profile.edit')}</button>`}<button type="button" class="ba-btn ba-btn--quiet" data-action="profile-remove" data-id="${p.id}" aria-label="${t.t('profile.remove')}: ${p.name}">${t.t('profile.remove')}</button></div></li>`;
}

function manageView(ctx: ViewContext, st: ProfilesPageState, now: number): SafeHtml {
  const t = ctx.i18n;
  const p = st.picker;
  const cap = ctx.player?.capacity;
  return html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('profile.title.manage')}</h1></header>
    ${cap ? html`<p class="ba-lead" data-capacity>${t.t('profile.capacity', { used: cap.used, max: cap.max })}</p>` : ''}
    ${notices(ctx, st)}
    <ul class="pf-list" aria-label="${t.t('profile.title.manage')}">${(p?.cards ?? []).map((c) => manageRow(ctx, c, now))}</ul>
    <div class="ba-actions pf-actions">
      ${p?.add.show && p.add.why === null ? html`<button type="button" class="ba-btn ba-btn--secondary" data-action="profile-add">${icon('plus')}<span>${t.t('profile.add')}</span></button>` : ''}
      ${p?.add.show && p.add.why === 'plan' && ctx.flags.family ? html`<a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}">${t.t('profile.add.plan')}</a>` : ''}
      ${p?.add.why === 'full' ? html`<p class="ba-small" data-full>${t.t('profile.full')}</p>` : ''}
      <button type="button" class="ba-btn ba-btn--primary" data-action="profile-done">${t.t('profile.done')}</button>
    </div>
    ${askRow(ctx, st)}`;
}

/** Lines about one field of the form; the one that is about the form as a whole sits above its buttons. */
function fieldError(ctx: ViewContext, view: Extract<ProfilesView, { kind: 'form' }>, field: 'name' | 'avatar' | 'form', id: string): SafeHtml {
  if (view.error?.field !== field) return html``;
  const code = view.error.code;
  const text = ctx.i18n.t(failureKey(code) as 'profile.err.unknown', { n: NAME_MAX });
  return html`<p class="ba-small pf-error" id="${id}" role="alert">${text}</p>`;
}

function formView(ctx: ViewContext, view: Extract<ProfilesView, { kind: 'form' }>, st: ProfilesPageState): SafeHtml {
  const t = ctx.i18n;
  const d: FormDraft = view.draft;
  const create = view.mode === 'create';
  const used = new Set((st.picker?.cards ?? []).filter((c) => c.id !== view.id).map((c) => c.avatar));
  return html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t(create ? 'profile.form.add' : 'profile.form.edit')}</h1></header>
    <form class="k-stack pf-form" data-form="profile" novalidate>
      <div class="ba-field"><label for="pf-name">${t.t('profile.form.name')}</label>
        <input class="ba-input" id="pf-name" name="name" data-key="name" type="text" value="${d.name}" autocomplete="off" autocapitalize="words" spellcheck="false" aria-describedby="pf-name-hint${view.error?.field === 'name' ? ' pf-name-err' : ''}"${attr('aria-invalid', view.error?.field === 'name' && 'true')}>
        <small class="ba-small" id="pf-name-hint">${t.t('profile.form.nameHint', { n: NAME_MAX })}</small>${fieldError(ctx, view, 'name', 'pf-name-err')}</div>
      <fieldset class="ba-fieldset"><legend class="k-label">${t.t('profile.form.avatar')}</legend>
        <div class="pf-avatars" role="radiogroup" aria-label="${t.t('profile.form.avatar')}">${AVATAR_IDS.map((id) => html`<label class="pf-pick${used.has(id) ? ' is-used' : ''}"><input type="radio" name="avatar" value="${id}" data-key="avatar-${id}"${attr('checked', d.avatar === id)}><span>${avatar(id, { size: 56, label: avatarName(ctx, id) })}</span></label>`)}</div>
        ${fieldError(ctx, view, 'avatar', 'pf-avatar-err')}</fieldset>
      ${switchRow({ id: 'pf-kid', name: 'kid', label: t.t('profile.form.kid'), hint: t.t('profile.form.kid.body'), checked: d.kid, disabled: view.id === 'p1' })}
      ${switchRow({ id: 'pf-seated', name: 'seated', label: t.t('profile.form.seated'), hint: t.t('profile.form.seated.body'), checked: d.seated })}
      ${fieldError(ctx, view, 'form', 'pf-form-err')}
      <div class="ba-actions">
        <button type="submit" class="ba-btn ba-btn--primary ba-btn--lg">${t.t(create ? 'profile.form.create' : 'profile.form.save')}</button>
        <button type="button" class="ba-btn ba-btn--quiet" data-action="profile-cancel">${t.t('profile.form.cancel')}</button>
      </div>
    </form>`;
}

/** The page: whichever of the three screens the state asks for, in the frame of the site. */
export function profilesPage(ctx: ViewContext, st: ProfilesPageState, now = Date.now()): SafeHtml {
  const v = st.view;
  const body = v.kind === 'pick' ? pickView(ctx, st, now) : v.kind === 'manage' ? manageView(ctx, st, now) : formView(ctx, v, st);
  const main = html`${body}${st.notice ? html`<p class="ba-small pf-notice" role="status">${st.notice}</p>` : ''}`;
  return chrome(ctx, { tab: 'settings', main, mainClass: 'ba-page--profiles' });
}

/** "Best in the family" on a game's page: the players of this device and their best, best first (only where there are two or more). */
export function familyTable(ctx: ViewContext, rows: readonly FamilyEntry[]): SafeHtml {
  const t = ctx.i18n;
  if (rows.length < 2) return html``;
  return html`<section class="k-card pf-family" aria-labelledby="pf-family-h" data-family><h2 class="k-h3" id="pf-family-h">${t.t('profile.family.title')}</h2>
    <ol class="pf-board">${rows.map((r) => html`<li${attr('aria-current', r.active && 'true')}>${avatar(r.avatar, { size: 32 })}<span class="who">${r.name}</span><b class="n">${r.best > 0 ? t.number(r.best) : t.t('profile.family.none')}</b></li>`)}</ol></section>`;
}

/** What the friends pages say to a child (they have no online identity): where to go instead. */
export function childSocialPage(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const main = html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('social.title')}</h1></header>
    <p class="ba-lead">${t.t('profile.child.social')}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('profiles', { query: { next: ctx.url } })}">${t.t('profile.switch')}</a></div>`;
  return chrome(ctx, { tab: null, main, mainClass: 'ba-page--profiles' });
}

/** The parent gate: a sum for a grown-up. Drawn inside a dialog; the question and the answer box are redrawn after a wrong answer. */
export function gateHtml(ctx: ViewContext, o: { a: number; b: number; message: string | null; waitText: string | null }): SafeHtml {
  const t = ctx.i18n;
  return html`<form class="pf-gate" data-form="gate" novalidate>
    <h2 class="ba-h3" id="gate-title">${t.t('profile.gate.title')}</h2>
    <p id="gate-body">${t.t('profile.gate.body')}</p>
    <div class="ba-field"><label for="gate-answer"><span class="pf-sum">${t.t('profile.gate.question', { a: o.a, b: o.b })}</span><span class="ba-visually-hidden"> ${t.t('profile.gate.answer')}</span></label>
      <input class="ba-input" id="gate-answer" name="answer" data-key="answer" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autofocus aria-describedby="gate-note"${attr('disabled', o.waitText !== null)}></div>
    <p class="ba-small pf-error" id="gate-note" role="status">${o.waitText ?? o.message ?? ''}</p>
    <div class="ba-actions ba-actions--end">
      <button type="button" class="ba-btn ba-btn--secondary" data-dialog-close="no">${t.t('common.cancel')}</button>
      <button type="submit" class="ba-btn ba-btn--primary"${attr('disabled', o.waitText !== null)}>${t.t('profile.gate.go')}</button>
    </div>
  </form>`;
}
