// The Friends page: what the player sees first. Every state of it is a function of the port's state: no profile (the age
// question waits behind a button), under 13 and kid profiles (no online identity, said plainly), the service not answering,
// a suspended profile, and the profile itself with its code, its friends and their presence, the requests and the way into rooms,
// lobbies and the weekly boards.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { icon } from '../../../../core/ui/icons.ts';
import type { FriendEntry, IncomingRequest, MyProfile, OutgoingRequest } from '../../../../core/social/types.ts';
import type { ViewContext } from '../../context.ts';
import { chrome } from '../../views/chrome.ts';
import { NO_SOCIAL_STATE, type SocialState } from '../port.ts';
import { qrSvg } from '../qr.ts';
import { ux } from '../strings.ts';
import { avatar, DOT_OF, onlineGames, presenceText, stateBanners } from '../ui.ts';

export interface FriendsView {
  state: SocialState;
  add: { value: string; busy: boolean; note: { ok: boolean; text: string } | null };
}

export const NO_FRIENDS_VIEW: FriendsView = { state: NO_SOCIAL_STATE, add: { value: '', busy: false, note: null } };

/** A big calm message with a way out: the shape of every "you cannot be here yet" state. */
export function panel(o: { icon: Parameters<typeof icon>[0]; title: string; body: string; note?: string; actions: SafeHtml }): SafeHtml {
  return html`<div class="ba-panel ba-soon k-statepanel">${icon(o.icon)}<div><h2 class="k-h3">${o.title}</h2><p>${o.body}</p>${o.note ? html`<p class="ba-small k-mt">${o.note}</p>` : ''}<div class="ba-actions k-mt">${o.actions}</div></div></div>`;
}

export function under13Panel(ctx: ViewContext): SafeHtml {
  const u = ux(ctx);
  return panel({
    icon: 'shield', title: u('under13.title'), body: u('under13.body'), note: u('under13.kept'),
    actions: html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('home')}">${u('under13.games')}</a><a class="ba-link" href="${ctx.href('safety')}">${ctx.i18n.t('social.safetyLink')}</a>`,
  });
}

export function kidPanel(ctx: ViewContext): SafeHtml {
  const u = ux(ctx);
  return panel({
    icon: 'users', title: u('kid.title'), body: u('kid.body'),
    actions: html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('home')}">${u('under13.games')}</a><a class="ba-link" href="${ctx.href('safety')}">${ctx.i18n.t('social.safetyLink')}</a>`,
  });
}

function profileCard(ctx: ViewContext, p: MyProfile): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  return html`<section class="k-card k-profile" aria-label="${t.t('social.profile.label')}">
    ${avatar(p.fid)}
    <div><p class="name">${p.name}</p><div class="k-codeline"><span class="k-code" role="group" aria-label="${t.t('social.profile.codeLabel', { code: p.code })}"><span aria-hidden="true">${p.code}</span><button type="button" data-action="social.copy" data-what="code" aria-label="${t.t('social.profile.copy')}">${icon('copy')}</button></span><a class="ba-link k-minor" href="${ctx.href('friends', { query: { view: 'profile' } })}">${icon('user')}${u('friends.profile')}</a></div></div>
    <div class="k-share"><div class="k-stack k-stack--tight"><p class="ba-small k-flat">${t.t('social.profile.shareHint')}</p><button class="ba-btn ba-btn--secondary" type="button" data-action="social.copy" data-what="link">${icon('share')}${t.t('social.profile.share')}</button></div><span class="ba-qr">${qrSvg(p.link, t.t('social.profile.qr'))}</span></div>
  </section>`;
}

function addCard(ctx: ViewContext, v: FriendsView): SafeHtml {
  const t = ctx.i18n;
  const note = v.add.note;
  return html`<section class="k-card" aria-labelledby="add">
    <h2 class="k-h3" id="add">${t.t('social.add.title')}</h2>
    <form data-form="friend-add" novalidate>
      <div class="k-addrow k-mt"><input class="ba-input" id="friend-code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="BA-" aria-label="${t.t('social.add.label')}" aria-describedby="add-note" data-key="friend-code" value="${v.add.value}"><button class="ba-btn ba-btn--secondary" type="submit"${attr('disabled', v.add.busy)}>${t.t('social.add.button')}</button></div>
      <p class="ba-small k-note-line${note && !note.ok ? ' is-error' : ''}" id="add-note" role="status">${note ? note.text : ''}</p>
    </form>
  </section>`;
}

function requestRow(ctx: ViewContext, r: IncomingRequest): SafeHtml {
  const t = ctx.i18n;
  return html`<li>${avatar(r.fid)}<div class="grow"><b>${r.name}</b><small>${t.tx(`social.req.via.${r.via}`)}</small></div><div class="k-rowbtns"><button class="ba-btn ba-btn--secondary" type="button" data-action="social.accept" data-fid="${r.fid}">${t.t('social.req.accept')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="social.decline" data-fid="${r.fid}">${t.t('social.req.decline')}</button></div></li>`;
}

function outgoingRow(ctx: ViewContext, r: OutgoingRequest): SafeHtml {
  const t = ctx.i18n;
  return html`<li>${avatar(r.fid)}<div class="grow"><b>${r.name}</b><small>${t.t('social.req.waiting', { name: r.name })}</small></div><div class="k-rowbtns"><button class="ba-btn ba-btn--quiet" type="button" data-action="social.cancel" data-fid="${r.fid}">${t.t('social.req.cancel')}</button></div></li>`;
}

function friendRow(ctx: ViewContext, f: FriendEntry, canInvite: boolean): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const dot = DOT_OF[f.presence.status];
  // A friend who is in a room with a seat free can be joined; otherwise an online friend can be asked into a room of mine.
  const act = f.presence.room
    ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.join" data-room="${f.presence.room}" aria-label="${u('friends.joinLabel', { name: f.name })}">${u('friends.join')}</button>`
    : canInvite && f.presence.status !== 'offline'
      ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.invite" data-fid="${f.fid}" aria-label="${t.t('social.friend.inviteLabel', { name: f.name })}">${t.t('social.friend.invite')}</button>` : '';
  return html`<li data-friend="${f.fid}">${avatar(f.fid, dot)}<div class="grow"><b>${f.name}</b><small><i class="${dot}" aria-hidden="true"></i>${presenceText(ctx, f.presence)}</small></div><div class="k-rowbtns">${act}<button class="ba-icon-btn" type="button" data-action="social.menu" data-fid="${f.fid}" aria-label="${t.t('social.friend.more', { name: f.name })}">${icon('more')}</button></div></li>`;
}

function friendsBody(ctx: ViewContext, v: FriendsView, p: MyProfile): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const s = v.state;
  const incoming = s.requests.incoming;
  const outgoing = s.requests.outgoing;
  const canRooms = onlineGames(ctx).length > 0;
  const offline = s.status === 'offline';
  return html`<div class="k-cols k-cols--even">
    <div class="k-stack">
      ${profileCard(ctx, p)}
      <div class="k-start"><button class="ba-btn ba-btn--primary" type="button" data-action="room.new"${attr('disabled', !canRooms)}>${icon('plus')}${t.t('social.start.room')}</button><a class="ba-btn ba-btn--secondary" href="${ctx.href('lobbies')}">${icon('search')}${t.t('social.start.lobbies')}</a><a class="ba-btn ba-btn--secondary" href="${ctx.href('friends', { query: { view: 'boards' } })}">${icon('trophy')}${u('friends.boards')}</a></div>
      ${canRooms ? '' : html`<p class="ba-small k-flat">${t.t('lobby.noGames')}</p>`}
      ${addCard(ctx, v)}
    </div>
    <div class="k-stack">
      ${incoming.length > 0 || outgoing.length > 0 ? html`<section aria-labelledby="req">
        <div class="k-sechead"><h2 class="k-h3" id="req">${t.t('social.req.title')}</h2><span class="ba-small">${t.t('social.req.new', { n: incoming.length })}</span></div>
        <ul class="ba-list k-mt" data-list="requests">${incoming.map((r) => requestRow(ctx, r))}${outgoing.map((r) => outgoingRow(ctx, r))}</ul>
      </section>` : ''}
      <section aria-labelledby="list">
        <div class="k-sechead"><h2 class="k-h3" id="list">${t.t('social.list.title')}</h2><span class="ba-small">${u('friends.of', { n: s.friends.length, max: p.can.maxFriends })}</span></div>
        ${s.friends.length > 0
          ? html`<ul class="ba-list k-flist k-mt" data-list="friends">${s.friends.map((f) => friendRow(ctx, f, canRooms))}</ul>`
          : offline ? '' : html`<p class="ba-lead k-mt">${t.t('social.list.empty')}</p>`}
      </section>
      <section class="k-card k-under18">${icon('shield')}<p>${p.band === 'adult' ? html`${u('friends.blocked', { n: p.counts.blocks })}.` : t.t('social.under18')} <a class="ba-link" href="${ctx.href('safety')}">${t.t('social.safetyLink')}</a></p></section>
    </div>
  </div>`;
}

/** The friends page. `view` carries the page's own state; the profile and boards views are drawn by their own modules. */
export function friendsMain(ctx: ViewContext, v: FriendsView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const s = v.state;
  const banners = stateBanners(ctx, s);
  let body: SafeHtml;
  if (s.noOnline === 'under13') body = under13Panel(ctx);
  else if (s.noOnline === 'kid') body = kidPanel(ctx);
  else if (s.profile && s.bannedUntil !== null) body = html`<p class="ba-lead k-mt"><a class="ba-link" href="${ctx.href('friends', { query: { view: 'profile' } })}">${u('friends.profile')}</a></p>`;
  else if (s.profile) body = friendsBody(ctx, v, s.profile);
  else if (s.status === 'loading') body = html`<p class="ba-lead" role="status">${t.t('social.loading')}</p>`;
  else if (s.status === 'offline') {
    body = panel({ icon: 'wifi', title: t.t('social.offline.title'), body: t.t('social.offline.body'), actions: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.retry">${t.t('social.retry')}</button>` });
  } else {
    body = panel({
      icon: 'friends', title: t.t('social.intro.title'), body: t.t('social.intro.body'),
      actions: html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="social.profile">${t.t('social.intro.cta')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="social.recover">${u('age.have')}</button><a class="ba-link" href="${ctx.href('safety')}">${t.t('social.safetyLink')}</a>`,
    });
  }
  return html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('social.h1')}</h1><a class="ba-icon-btn" href="${ctx.href('safety')}" aria-label="${t.t('settings.safety')}">${icon('shield')}</a></header>${banners}${body}`;
}

export function friendsPage(ctx: ViewContext, v: FriendsView = NO_FRIENDS_VIEW): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: friendsMain(ctx, v), mainClass: 'ba-page--friends' });
}
