// My profile: everything the service holds about the player and everything the player can do with it. The name, the friend
// code and link, the recovery code, what the age group allows, the switches of privacy and play, the lists, the synced
// documents, the notices and, last, the player's own data: download it, delete it, or step down an age group.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { icon } from '../../../../core/ui/icons.ts';
import { levelBand } from '../../../../core/social/levels.ts';
import { LEVEL_BANDS, REGIONS, type MyProfile } from '../../../../core/social/types.ts';
import type { ViewContext } from '../../context.ts';
import { chrome } from '../../views/chrome.ts';
import { segmented, switchRow } from '../../views/forms.ts';
import { pageHead } from '../../views/parts.ts';
import type { SocialState } from '../port.ts';
import { qrSvg } from '../qr.ts';
import { ux } from '../strings.ts';
import { avatar, stateBanners } from '../ui.ts';
import { kidPanel, needProfile, youngPanel } from './friends.ts';

export interface ProfileView {
  state: SocialState;
  /** The text in the rename box, kept across redraws. */
  name: string;
  /** What the last action on a part of the page said; the part is where the line is drawn. */
  notes: Readonly<Partial<Record<'name' | 'code' | 'recovery' | 'prefs' | 'data' | 'age', { ok: boolean; text: string }>>>;
  /** The action that is running (its buttons wait). */
  busy: string | null;
}

export const NO_PROFILE_VIEW: ProfileView = { state: { status: 'loading', profile: null, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [], invites: [], hub: 'idle', signedOut: null, bannedUntil: null, recovery: null, persistent: true, noOnline: null }, name: '', notes: {}, busy: null };

const noteLine = (v: ProfileView, where: keyof ProfileView['notes']): SafeHtml => {
  const n = v.notes[where];
  return html`<p class="ba-small k-note-line${n && !n.ok ? ' is-error' : ''}" role="status">${n ? n.text : ''}</p>`;
};

const bandName = (ctx: ViewContext, band: MyProfile['band']): string => ux(ctx)(band === 'child' ? 'me.band.child' : band === 'teen' ? 'me.band.teen' : 'me.band.adult');

function identityCard(ctx: ViewContext, v: ProfileView, p: MyProfile): SafeHtml {
  const u = ux(ctx);
  const busy = v.busy !== null;
  return html`<section class="k-card k-me" aria-labelledby="me-id">
    <div class="k-me__head">${avatar(p.fid)}<div><h2 class="k-h3 k-flat" id="me-id">${u('me.name')}</h2><p class="k-me__name">${p.name}</p></div></div>
    ${p.can.freeName
      ? html`<form data-form="me-name" novalidate>
        <div class="k-addrow k-mt"><input class="ba-input k-nameinput" id="me-name" name="name" type="text" autocomplete="nickname" maxlength="20" spellcheck="false" aria-label="${u('me.name')}" aria-describedby="me-name-hint" data-key="me-name" value="${v.name}"><button class="ba-btn ba-btn--secondary" type="submit"${attr('disabled', busy)}>${u('me.rename')}</button></div>
        <p class="ba-small k-flat k-mt" id="me-name-hint">${u('me.renameHint')}</p>${noteLine(v, 'name')}
      </form>`
      : html`<div class="k-namepick k-mt"><p class="ba-small k-flat" id="me-name-hint">${u('me.rerollHint')}</p><button class="ba-btn ba-btn--secondary" type="button" data-action="me.reroll" aria-describedby="me-name-hint"${attr('disabled', busy)}>${icon('replay')}${u('me.reroll')}</button></div>${noteLine(v, 'name')}`}
  </section>`;
}

function codeCard(ctx: ViewContext, v: ProfileView, p: MyProfile): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  return html`<section class="k-card" aria-labelledby="me-code">
    <h2 class="k-h3" id="me-code">${u('me.codeTitle')}</h2>
    <p class="ba-small k-flat">${u('me.codeHint')}</p>
    <div class="k-codebox k-mt">
      <div class="k-stack k-stack--tight">
        <span class="k-code" role="group" aria-label="${t.t('social.profile.codeLabel', { code: p.code })}"><span aria-hidden="true">${p.code}</span><button type="button" data-action="social.copy" data-what="code" aria-label="${t.t('social.profile.copy')}">${icon('copy')}</button></span>
        <p class="k-linkline" data-link>${p.link}</p>
        <div class="k-rowbtns k-rowbtns--wrap"><button class="ba-btn ba-btn--secondary" type="button" data-action="social.copy" data-what="link">${icon('share')}${t.t('social.profile.share')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="me.renewCode"${attr('disabled', v.busy !== null)}>${icon('replay')}${u('me.codeRenew')}</button></div>
      </div>
      <span class="ba-qr">${qrSvg(p.link, t.t('social.profile.qr'))}</span>
    </div>
    ${noteLine(v, 'code')}
  </section>`;
}

function prefsCard(ctx: ViewContext, v: ProfileView, p: MyProfile): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const band = levelBand(p.level);
  return html`<section class="k-card" aria-labelledby="me-prefs">
    <h2 class="k-h3" id="me-prefs">${u('me.privacyTitle')}</h2>
    <div data-form="me-prefs" class="k-prefs">
      <div class="k-mt">${switchRow({ id: 'me-dnd', name: 'dnd', label: u('me.dnd'), hint: u('me.dndHint'), checked: p.dnd, disabled: v.busy !== null })}</div>
      <div class="ba-field k-mt"><label for="me-region">${u('me.region')}</label><select class="ba-input" id="me-region" name="region" data-key="me-region" aria-describedby="me-region-hint"${attr('disabled', v.busy !== null)}>${REGIONS.map((r) => html`<option value="${r}"${attr('selected', r === p.region)}>${t.tx(`lobby.region.${r}`)}</option>`)}</select><small class="ba-small" id="me-region-hint">${u('me.regionHint')}</small></div>
      <div class="k-mt">${segmented('level', u('me.level'), LEVEL_BANDS.map((b) => ({ value: b, label: t.tx(`lobby.band.${b}`), checked: b === band, disabled: v.busy !== null })), { legendClass: 'k-label', describedBy: 'me-level-hint' })}<small class="ba-small" id="me-level-hint">${u('me.levelHint')}</small></div>
    </div>
    ${noteLine(v, 'prefs')}
  </section>`;
}

const canRow = (ok: boolean, text: string): SafeHtml => html`<li class="${ok ? 'yes' : 'no'}">${icon(ok ? 'check' : 'close')}<span>${text}</span></li>`;

function canCard(ctx: ViewContext, p: MyProfile): SafeHtml {
  const u = ux(ctx);
  const c = p.can;
  return html`<section class="k-card" aria-labelledby="me-can">
    <h2 class="k-h3" id="me-can">${u('me.canTitle')}</h2>
    <ul class="k-canlist k-mt">${canRow(c.freeName, c.freeName ? u('me.canName.free') : u('me.canName.preset'))}${canRow(c.freeText, c.freeText ? u('me.canText.yes') : u('me.canText.no'))}${canRow(c.video, c.video ? u('me.canVideo.yes') : u('me.canVideo.no'))}${canRow(c.publicPlay, c.publicPlay ? u('me.canPublic.yes') : u('me.canPublic.no'))}${canRow(true, u('me.canFriends', { max: c.maxFriends }))}</ul>
  </section>`;
}

function listsCard(ctx: ViewContext, p: MyProfile): SafeHtml {
  const u = ux(ctx);
  return html`<section class="k-card" aria-labelledby="me-lists">
    <h2 class="k-h3" id="me-lists">${u('me.countsTitle')}</h2>
    <dl class="k-facts k-mt">
      <div><dt>${u('me.countsFriends')}</dt><dd>${u('friends.of', { n: p.counts.friends, max: p.can.maxFriends })}</dd></div>
      <div><dt>${u('me.countsRequests')}</dt><dd>${u('me.countsRequestsLine', { incoming: p.counts.incoming, outgoing: p.counts.outgoing })}</dd></div>
      <div><dt>${ctx.i18n.t('safety.blocked.title')}</dt><dd><a class="ba-link" href="${ctx.href('safety')}">${u('friends.blocked', { n: p.counts.blocks })}</a></dd></div>
    </dl>
  </section>`;
}

function syncCard(ctx: ViewContext): SafeHtml {
  const u = ux(ctx);
  return html`<section class="k-card k-under18" aria-labelledby="me-sync">${icon('replay')}<div><h2 class="k-h3" id="me-sync">${u('me.syncTitle')}</h2><p>${u('me.syncBody')}</p></div></section>`;
}

function recoveryCard(ctx: ViewContext, v: ProfileView, p: MyProfile | null): SafeHtml {
  const u = ux(ctx);
  return html`<section class="k-card" aria-labelledby="me-rec">
    <h2 class="k-h3" id="me-rec">${u('me.recoveryTitle')}</h2>
    <p class="ba-small k-flat">${u('me.recoveryBody')}</p>
    <div class="k-rowbtns k-mt"><button class="ba-btn ba-btn--secondary" type="button" data-action="me.renewRecovery"${attr('disabled', v.busy !== null || !p)}>${icon('key')}${u('me.recoveryRenew')}</button></div>
    ${noteLine(v, 'recovery')}
  </section>`;
}

function dataCard(ctx: ViewContext, v: ProfileView): SafeHtml {
  const u = ux(ctx);
  const busy = v.busy !== null;
  return html`<section class="k-card" aria-labelledby="me-data">
    <h2 class="k-h3" id="me-data">${u('me.dataTitle')}</h2>
    <p class="ba-small k-flat">${u('me.dataDownloadHint')}</p>
    <div class="k-rowbtns k-rowbtns--wrap k-mt"><button class="ba-btn ba-btn--secondary" type="button" data-action="me.download"${attr('disabled', busy)}>${icon('download')}${u('me.dataDownload')}</button><button class="ba-btn ba-btn--danger" type="button" data-action="me.delete"${attr('disabled', busy)}>${icon('trash')}${u('me.dataDelete')}</button></div>
    ${noteLine(v, 'data')}
  </section>`;
}

function ageCard(ctx: ViewContext, v: ProfileView, p: MyProfile): SafeHtml {
  const u = ux(ctx);
  const busy = v.busy !== null;
  return html`<section class="k-card" aria-labelledby="me-age">
    <h2 class="k-h3" id="me-age">${u('me.ageTitle')}</h2>
    <p class="ba-small k-flat">${u('me.ageNow', { band: bandName(ctx, p.band) })}</p>
    <div class="k-rowbtns k-rowbtns--wrap k-mt">${p.band === 'adult' ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="me.ageDown"${attr('disabled', busy)}>${u('me.ageDown')}</button>` : ''}<button class="ba-btn ba-btn--secondary" type="button" data-action="me.ageChild"${attr('disabled', busy)}>${u('me.ageChild')}</button></div>
    ${noteLine(v, 'age')}
  </section>`;
}

export function profileMain(ctx: ViewContext, v: ProfileView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const s = v.state;
  const head = pageHead(ctx, u('me.title'), { back: ctx.href('friends') });
  const banners = stateBanners(ctx, s);
  const p = s.profile;
  if (s.noOnline === 'young') return html`${head}${youngPanel(ctx)}`;
  if (s.noOnline === 'kid') return html`${head}${kidPanel(ctx)}`;
  if (!p) return html`${head}${banners}<div class="k-mt">${needProfile(ctx, s, { icon: 'friends', title: t.t('social.intro.title'), body: t.t('social.intro.body') })}</div>`;
  // A suspended profile can still be downloaded and deleted, and nothing else.
  if (s.bannedUntil !== null) return html`${head}${banners}<p class="k-sub">${u('me.sub')}</p><div class="k-cols k-cols--even k-mt-lg">${recoveryCard(ctx, v, null)}${dataCard(ctx, v)}</div>`;
  return html`${head}${banners}<p class="k-sub">${u('me.sub')}</p>
    <div class="k-cols k-cols--even k-mt-lg">
      <div class="k-stack">${identityCard(ctx, v, p)}${codeCard(ctx, v, p)}${prefsCard(ctx, v, p)}</div>
      <div class="k-stack">${canCard(ctx, p)}${listsCard(ctx, p)}${syncCard(ctx)}${recoveryCard(ctx, v, p)}${dataCard(ctx, v)}</div>
    </div>
    <div class="k-mt-lg">${ageCard(ctx, v, p)}</div>`;
}

export function profilePage(ctx: ViewContext, v: ProfileView = NO_PROFILE_VIEW): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: profileMain(ctx, v), mainClass: 'ba-page--me', pushed: true });
}
