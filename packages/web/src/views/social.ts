// The screens behind the Friends tab: friends, public lobbies, a room, the friend link, safety, and the sheets that open
// over them (profile, friend menu, report, block, game choice, QR). They follow the art director's UI kit pages
// (friends, lobbies, room, safety) and draw only from the shapes in social/port.ts, so the social client and the live
// client plug in without touching a view. Off until the social server exists (ctx.flags.social).
import { attr, html, raw, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph, type PoseName } from '../../../core/ui/glyphs.ts';
import { icon } from '../../../core/ui/icons.ts';
import { LEVEL_BANDS, REGIONS, type AgeBand, type BlockEntry, type FriendEntry, type FriendPresence, type IncomingRequest, type LevelBand, type LobbyEntry, type MyProfile, type Region, type ReportReason } from '../../../core/social/types.ts';
import { REPORT_REASONS, PRESETS, REACTIONS, type MemberInfo, type PresetId, type ReactionId } from '../../../core/types/net.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../context.ts';
import type { FeedItem, RoomProblem, RoomState, SocialState } from '../social/port.ts';
import { qrSvg } from '../social/qr.ts';
import { chrome } from './chrome.ts';
import { segmented, switchRow } from './forms.ts';
import { pageHead } from './parts.ts';

// ---- small pieces ----------------------------------------------------------------------------------------------------

const AVATAR_COLORS = ['#FF4F6E', '#46B4FF', '#FFC53A', '#22C383', '#9B7BFF', '#FF8A3D'] as const;
const AVATAR_POSES: readonly PoseName[] = ['stand', 'jackOpen', 'reach', 'squat', 'tPose', 'highKnee', 'twist', 'sideBend'];

/** The same figure and colour for the same id on every screen and every device. */
export function avatarLook(id: string): { color: string; pose: PoseName } {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { color: AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#FF4F6E', pose: AVATAR_POSES[(h >>> 8) % AVATAR_POSES.length] ?? 'stand' };
}

export type Dot = 'online' | 'ingame' | 'offline';
const DOT_OF: Record<FriendPresence['status'], Dot> = { offline: 'offline', online: 'online', in_room: 'ingame', playing: 'ingame' };

export function avatar(id: string, dot: Dot | null = null): SafeHtml {
  const { color, pose } = avatarLook(id);
  return html`<span class="ba-avatar">${glyph(pose, { ink: 'currentColor', accent: color, ball: color, floor: false, size: 100, decorative: true })}${dot ? html`<span class="dot ${dot}" aria-hidden="true"></span>` : ''}</span>`;
}

function presenceText(ctx: ViewContext, p: FriendPresence): string {
  const t = ctx.i18n;
  if (p.status === 'playing' && p.game) {
    const g = ctx.games.find((x) => x.id === p.game);
    if (g) return t.t('social.presence.playingGame', { game: titleOf(ctx, g) });
  }
  return t.tx(`social.presence.${p.status}`);
}

/** The games that have online play. */
export function onlineGames(ctx: Pick<ViewContext, 'games'>): ShellGame[] {
  return ctx.games.filter((g) => g.modes.includes('duel') || g.template === 'duel');
}

const secondsLabel = (ctx: ViewContext, ms: number): string => {
  const s = Math.round(ms / 1000);
  return s >= 90 && s % 60 === 0 ? ctx.i18n.t('room.min', { n: s / 60 }) : ctx.i18n.t('room.sec', { n: s });
};

const bandLabel = (ctx: ViewContext, b: LevelBand): string => ctx.i18n.tx(`lobby.band.${b}`);

// ---- friends -----------------------------------------------------------------------------------------------------------

export interface FriendsView {
  state: SocialState;
  add: { value: string; busy: boolean; note: { ok: boolean; text: string } | null };
}

export const NO_FRIENDS_VIEW: FriendsView = { state: { status: 'loading', profile: null, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [] }, add: { value: '', busy: false, note: null } };

function profileCard(ctx: ViewContext, p: MyProfile): SafeHtml {
  const t = ctx.i18n;
  return html`<section class="k-card k-profile" aria-label="${t.t('social.profile.label')}">
    ${avatar(p.fid)}
    <div><p class="name">${p.name}</p><div class="k-codeline"><span class="k-code" role="group" aria-label="${t.t('social.profile.codeLabel', { code: p.code })}"><span aria-hidden="true">${p.code}</span><button type="button" data-action="social.copy" data-what="code" aria-label="${t.t('social.profile.copy')}">${icon('copy')}</button></span></div></div>
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

function friendRow(ctx: ViewContext, f: FriendEntry, canInvite: boolean): SafeHtml {
  const t = ctx.i18n;
  const dot = DOT_OF[f.presence.status];
  const invite = canInvite && f.presence.status !== 'offline'
    ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.invite" data-fid="${f.fid}" aria-label="${t.t('social.friend.inviteLabel', { name: f.name })}">${t.t('social.friend.invite')}</button>` : '';
  return html`<li>${avatar(f.fid, dot)}<div class="grow"><b>${f.name}</b><small><i class="${dot}" aria-hidden="true"></i>${presenceText(ctx, f.presence)}</small></div><div class="k-rowbtns">${invite}<button class="ba-icon-btn" type="button" data-action="social.menu" data-fid="${f.fid}" aria-label="${t.t('social.friend.more', { name: f.name })}">${icon('more')}</button></div></li>`;
}

function friendsBody(ctx: ViewContext, v: FriendsView, p: MyProfile): SafeHtml {
  const t = ctx.i18n;
  const s = v.state;
  const incoming = s.requests.incoming;
  const outgoing = s.requests.outgoing;
  const canRooms = onlineGames(ctx).length > 0;
  return html`<div class="k-cols k-cols--even">
    <div class="k-stack">
      ${profileCard(ctx, p)}
      <div class="k-start"><button class="ba-btn ba-btn--primary" type="button" data-action="room.new"${attr('disabled', !canRooms)}>${icon('plus')}${t.t('social.start.room')}</button><a class="ba-btn ba-btn--secondary" href="${ctx.href('lobbies')}">${icon('search')}${t.t('social.start.lobbies')}</a></div>
      ${canRooms ? '' : html`<p class="ba-small k-flat">${t.t('lobby.noGames')}</p>`}
      ${addCard(ctx, v)}
    </div>
    <div class="k-stack">
      ${incoming.length > 0 || outgoing.length > 0 ? html`<section aria-labelledby="req">
        <div class="k-sechead"><h2 class="k-h3" id="req">${t.t('social.req.title')}</h2><span class="ba-small">${t.t('social.req.new', { n: incoming.length })}</span></div>
        <ul class="ba-list k-mt">${incoming.map((r) => requestRow(ctx, r))}${outgoing.map((r) => html`<li>${avatar(r.fid)}<div class="grow"><b>${r.name}</b><small>${t.t('social.req.waiting', { name: r.name })}</small></div><div class="k-rowbtns"><button class="ba-btn ba-btn--quiet" type="button" data-action="social.cancel" data-fid="${r.fid}">${t.t('social.req.cancel')}</button></div></li>`)}</ul>
      </section>` : ''}
      <section aria-labelledby="list">
        <div class="k-sechead"><h2 class="k-h3" id="list">${t.t('social.list.title')}</h2><span class="ba-small">${ctx.i18n.number(s.friends.length)}</span></div>
        ${s.friends.length > 0
          ? html`<ul class="ba-list k-flist k-mt">${s.friends.map((f) => friendRow(ctx, f, canRooms))}</ul>`
          : html`<p class="ba-lead k-mt">${t.t('social.list.empty')}</p>`}
      </section>
      <section class="k-card k-under18">${icon('shield')}<p>${t.t('social.under18')} <a class="ba-link" href="${ctx.href('safety')}">${t.t('social.safetyLink')}</a></p></section>
    </div>
  </div>`;
}

export function friendsPage(ctx: ViewContext, v: FriendsView = NO_FRIENDS_VIEW): SafeHtml {
  const t = ctx.i18n;
  const s = v.state;
  let body: SafeHtml;
  if (s.profile) body = friendsBody(ctx, v, s.profile);
  else if (s.status === 'loading') body = html`<p class="ba-lead" role="status">${t.t('social.loading')}</p>`;
  else if (s.status === 'offline') {
    body = html`<div class="ba-panel ba-soon">${icon('wifi')}<div><h2 class="k-h3">${t.t('social.offline.title')}</h2><p>${t.t('social.offline.body')}</p><button class="ba-btn ba-btn--secondary k-mt" type="button" data-action="social.retry">${t.t('social.retry')}</button></div></div>`;
  } else {
    body = html`<div class="ba-panel ba-soon">${icon('friends')}<div><h2 class="k-h3">${t.t('social.intro.title')}</h2><p>${t.t('social.intro.body')}</p><div class="ba-actions k-mt"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="social.profile">${t.t('social.intro.cta')}</button><a class="ba-link" href="${ctx.href('safety')}">${t.t('social.safetyLink')}</a></div></div></div>`;
  }
  const main = html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('social.h1')}</h1><a class="ba-icon-btn" href="${ctx.href('safety')}" aria-label="${t.t('settings.safety')}">${icon('shield')}</a></header>${body}`;
  return chrome(ctx, { tab: 'friends', main, mainClass: 'ba-page--friends' });
}

// ---- public lobbies ------------------------------------------------------------------------------------------------------

export interface LobbiesView {
  state: SocialState;
  /** The games that have online play; empty when none do. */
  games: readonly ShellGame[];
  game: ShellGame | null;
  band: LevelBand;
  region: Region;
  /** null while the list loads. */
  list: readonly LobbyEntry[] | null;
  failed: boolean;
  search: 'idle' | 'looking' | 'waiting';
}

const seatDots = (ctx: ViewContext, n: number, of: number): SafeHtml =>
  html`<span class="k-seatdots" role="img" aria-label="${ctx.i18n.t('lobby.seats', { n, of })}">${Array.from({ length: of }, (_, i) => html`<i class="${i < n ? '' : 'free'}"></i>`)}</span>`;

function lobbyRow(ctx: ViewContext, g: ShellGame, l: LobbyEntry): SafeHtml {
  const t = ctx.i18n;
  const full = l.open <= 0;
  const level = l.band ? t.t('lobby.levelLine', { level: bandLabel(ctx, l.band) }) : t.t('lobby.anyLevel');
  return html`<li class="${full ? 'full' : ''}"><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="72" height="54"><div><b>${level}</b><small>${seatDots(ctx, l.players, l.size)}<span>${t.t('lobby.players', { n: l.players, of: l.size })}</span><span>${t.t('lobby.host', { name: l.hostName })}</span></small></div>${full
    ? html`<span class="ba-badge">${t.t('lobby.full')}</span>`
    : html`<button class="ba-btn ba-btn--secondary" type="button" data-action="lobby.join" data-code="${l.code}" aria-label="${t.t('lobby.joinLabel', { level: l.band ? bandLabel(ctx, l.band) : t.t('lobby.anyLevel'), name: l.hostName })}">${t.t('lobby.join')}</button>`}</li>`;
}

export function lobbiesPage(ctx: ViewContext, v: LobbiesView): SafeHtml {
  const t = ctx.i18n;
  const can = v.state.profile?.can;
  const closed = !!v.state.profile && can?.publicPlay === false;
  const suspended = !!v.state.profile && (v.state.profile.publicBlockedUntil > Date.now());
  const g = v.game;
  const head = pageHead(ctx, t.t('lobby.title'), { back: ctx.href('friends') });
  let body: SafeHtml;
  if (v.games.length === 0) body = html`<p class="ba-lead k-mt">${t.t('lobby.noGames')}</p>`;
  else if (!v.state.profile) body = html`<div class="ba-panel ba-soon k-mt">${icon('users')}<div><p>${t.t('lobby.needProfile')}</p><button class="ba-btn ba-btn--primary k-mt" type="button" data-action="social.profile">${t.t('social.intro.cta')}</button></div></div>`;
  else if (closed || suspended) body = html`<p class="ba-callout k-mt">${icon('shield')}<span>${closed ? t.t('lobby.closed') : t.t('lobby.suspended')}</span></p>`;
  else {
    const chips = v.games.map((x) => html`<button class="ba-chip" type="button" data-action="lobby.game" data-game="${x.id}" aria-pressed="${x.id === g?.id}"><img src="${ctx.assets.tile(x.catalogue.tile, 400)}" alt="" width="34" height="26">${titleOf(ctx, x)}</button>`);
    const list = v.list;
    const rows = list === null
      ? html`<p class="ba-small" role="status">${t.t('lobby.loading')}</p>`
      : v.failed ? html`<p class="ba-small" role="status">${t.t('lobby.failed')}</p>`
      : list.length === 0 ? html`<p class="ba-small">${t.t('lobby.none')}</p>`
      : html`<ul class="k-lobbies">${g ? list.map((l) => lobbyRow(ctx, g, l)) : ''}</ul>`;
    const looking = v.search !== 'idle';
    body = html`<div class="k-cols k-cols--side k-mt-lg">
      <div class="k-stack">
        <div class="ba-filters k-gamechips" role="group" aria-label="${t.t('lobby.games')}">${chips}</div>
        <section aria-labelledby="open">
          <header class="k-sechead"><h2 id="open" class="k-h3">${g ? t.t('lobby.open', { game: titleOf(ctx, g) }) : t.t('lobby.title')}</h2><span class="ba-small">${t.tx(`lobby.region.${v.region}`)}</span></header>
          ${rows}
          <button class="ba-btn ba-btn--quiet k-mt" type="button" data-action="lobby.start"${attr('disabled', !g)}>${icon('plus')}${t.t('lobby.start')}</button>
        </section>
      </div>
      <aside class="k-stack">
        <form class="k-card k-quick" data-form="lobby" aria-labelledby="qm">
          <h2 id="qm" class="k-h3 k-flat">${t.t('lobby.quick.title')}</h2>
          ${g ? html`<div class="k-pick"><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="64" height="48"><div><small>${t.t('lobby.quick.game')}</small><b>${titleOf(ctx, g)}</b></div></div>` : ''}
          ${segmented('band', t.t('lobby.level'), LEVEL_BANDS.map((b) => ({ value: b, label: bandLabel(ctx, b), checked: b === v.band })), { legendClass: 'k-label' })}
          ${looking
            ? html`<p class="ba-small" role="status">${v.search === 'waiting' ? t.t('lobby.quick.waiting') : t.t('lobby.quick.searching')}</p><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-action="lobby.stop">${t.t('lobby.quick.stop')}</button>`
            : html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="lobby.quick"${attr('disabled', !g)}>${icon('search')}${t.t('lobby.quick.cta')}</button>`}
        </form>
        <section class="k-card k-ghostnote"><span class="pic">${glyph('jackOpen', { ink: '#F4F2F8', accent: '#46B4FF', ball: '#46B4FF', floor: false, size: 100, decorative: true })}</span><p>${t.t('lobby.ghost')}</p></section>
      </aside>
    </div>`;
  }
  return chrome(ctx, { tab: 'friends', main: html`${head}<p class="k-sub">${t.t('lobby.sub')}</p>${body}`, mainClass: 'ba-page--lobbies', pushed: true });
}

// ---- a room ----------------------------------------------------------------------------------------------------------------

export interface RoomView {
  room: RoomState;
  game: ShellGame | null;
  profile: MyProfile | null;
  /** The games the host can switch to. */
  games: readonly ShellGame[];
  /** The text in the free-text box, kept across redraws. */
  draft: string;
  /** Said under the box when a message was turned away. */
  chatNote: string;
}

const REACTION_ART: Record<ReactionId, string> = {
  clap: '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="#46B4FF"><rect x="9" y="5.5" width="3.6" height="13" rx="1.8"/><rect x="13.2" y="3.6" width="3.6" height="14" rx="1.8"/><rect x="17.4" y="4.6" width="3.6" height="13.5" rx="1.8"/><rect x="21.6" y="7.4" width="3.4" height="11.5" rx="1.7"/><path d="M8.6 16.5h16.4v4.5a7.4 7.4 0 01-7.4 7.4h-1.6a7.4 7.4 0 01-6.5-3.9l-3.3-6.3a2 2 0 013.4-2.1z"/></g></svg>',
  fire: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29c-5.7 0-9.2-3.7-9.2-8.6 0-4.6 3.3-7.1 4.8-11.3.3-.9 1.5-1 2-.2 1 1.6 1.4 3.4 1.2 5.3 1.7-1.4 2.7-3.5 2.7-5.8 0-.8.9-1.3 1.6-.8 3.7 2.6 6.1 7.3 6.1 12.6 0 5-3.5 8.8-9.2 8.8z" fill="#FF4F6E"/><path d="M16.2 28.6c-2.7 0-4.4-1.8-4.4-4.1 0-2.6 2.2-3.8 3.1-6.4.6 1.5 1.6 2.3 2.6 2.3.4-.8.6-1.6.6-2.5 1.6 1.4 2.6 3.6 2.6 5.7 0 3-1.9 5-4.5 5z" fill="#FFC53A"/></svg>',
  wave: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 20c3-4 6-4 9 0s6 4 9 0 4-3 5-2" fill="none" stroke="#46B4FF" stroke-width="3.2" stroke-linecap="round"/><path d="M5 12c3-4 6-4 9 0s6 4 9 0 4-3 5-2" fill="none" stroke="#22C383" stroke-width="3.2" stroke-linecap="round"/></svg>',
  laugh: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="#FFC53A"/><path d="M10.5 13.5c1-1.4 2.4-1.4 3.4 0M18.1 13.5c1-1.4 2.4-1.4 3.4 0" fill="none" stroke="#1C1433" stroke-width="2" stroke-linecap="round"/><path d="M9.5 18.5c1.4 5 11.6 5 13 0z" fill="#1C1433"/></svg>',
  wow: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4.5l3.5 7.2 7.9 1.1-5.7 5.5 1.4 7.8L16 22.4l-7.1 3.7 1.4-7.8-5.7-5.5 7.9-1.1z" fill="#FFC53A" transform="translate(0 1.6)"/></svg>',
  strong: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27.5s-10.5-6.3-10.5-13.6A5.8 5.8 0 0116 10.4a5.8 5.8 0 0110.5 3.5c0 7.3-10.5 13.6-10.5 13.6z" fill="#FF4F6E" transform="translate(0 1.6)"/></svg>',
};
// The drawings above are written in this file and hold nothing from outside.
const reactionArt = (id: ReactionId): SafeHtml => raw(REACTION_ART[id]);

function seatCard(ctx: ViewContext, m: MemberInfo, me: boolean, canShow: boolean): SafeHtml {
  const t = ctx.i18n;
  const state = !m.online ? html`<span class="k-state wait">${t.t('room.seat.away')}</span>`
    : m.ready ? html`<span class="k-state ready"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${t.t('room.seat.ready')}</span>`
    : html`<span class="k-state wait">${t.t('room.seat.notReady')}</span>`;
  return html`<div class="k-seat">${m.host ? html`<span class="host" role="img" aria-label="${t.t('room.seat.host')}">${icon('host')}</span>` : ''}${canShow ? html`<span class="cam" role="img" aria-label="${m.video ? t.t('room.cam.shared') : t.t('room.cam.off')}">${m.video ? icon('camera') : icon('cameraOff')}</span>` : ''}${avatar(m.seat)}<b>${m.name}${me ? html` <span class="ba-small">(${t.t('room.seat.you')})</span>` : ''}</b>${state}</div>`;
}

function feedRow(ctx: ViewContext, f: FeedItem, members: readonly MemberInfo[]): SafeHtml {
  const t = ctx.i18n;
  const who = members.find((m) => m.seat === f.seat);
  const name = who?.name ?? '';
  const what = f.react ? html`<span>${t.t('room.feed.sent')}</span><span class="k-react" role="img" aria-label="${t.tx(`room.react.${f.react}`)}">${reactionArt(f.react)}</span>`
    : f.say ? html`<span>${t.tx(`room.say.${f.say}`)}</span>` : html`<span>${f.text ?? ''}</span>`;
  return html`<li>${avatar(f.seat)}<span><b>${name}</b> </span>${what}</li>`;
}

const PROBLEMS: readonly RoomProblem[] = ['full', 'no_room', 'removed', 'replaced', 'version', 'not_allowed', 'ticket', 'offline'];

function roomActionBar(ctx: ViewContext, v: RoomView): SafeHtml {
  const t = ctx.i18n;
  const r = v.room;
  const me = r.members.find((m) => m.seat === r.me);
  if (!me) return html``;
  if (r.phase === 'playing') return html`<div class="k-actionbar"><p class="k-note">${t.t('room.playing')}</p></div>`;
  if (!me.host) {
    return html`<div class="k-actionbar"><div class="k-actions">${me.ready
      ? html`<button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-action="room.ready" data-ready="0">${t.t('room.unready')}</button>`
      : html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="room.ready" data-ready="1">${t.t('room.ready')}</button>`}</div>
      <p class="k-note">${me.ready ? t.t('room.hostWaits') : t.t('room.waiting.note')}</p></div>`;
  }
  const others = r.members.filter((m) => !m.host);
  const waiting = others.filter((m) => !m.ready || !m.online);
  if (others.length === 0) return html`<div class="k-actionbar"><div class="k-actions"><button class="ba-btn ba-btn--primary ba-btn--lg is-waiting" type="button" disabled aria-disabled="true">${t.t('room.alone')}</button></div></div>`;
  if (waiting.length === 0) {
    return html`<div class="k-actionbar"><div class="k-actions"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="room.start">${icon('play')}${t.t('room.start')}</button></div><p class="k-note">${t.t('room.start.note')}</p></div>`;
  }
  const first = waiting[0];
  const label = waiting.length === 1 && first ? t.t('room.waiting', { name: first.name }) : t.t('room.waitingMany', { n: waiting.length });
  return html`<div class="k-actionbar"><div class="k-actions"><button class="ba-btn ba-btn--primary ba-btn--lg is-waiting" type="button" disabled aria-disabled="true">${label}</button>${waiting.length === 1 && first && first.online
    ? html`<button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-action="room.remind" data-seat="${first.seat}">${t.t('room.remind', { name: first.name })}</button>` : ''}</div><p class="k-note">${t.t('room.waiting.note')}</p></div>`;
}

export function roomPage(ctx: ViewContext, v: RoomView): SafeHtml {
  const t = ctx.i18n;
  const r = v.room;
  const back = ctx.href('friends');
  const leave = html`<button class="ba-btn ba-btn--quiet" type="button" data-action="room.leave">${icon('door')}${t.t('room.leave')}</button>`;
  if (r.problem || r.phase === 'closed' || r.phase === 'idle') {
    const problem: RoomProblem = r.problem && PROBLEMS.includes(r.problem) ? r.problem : 'no_room';
    const main = html`${pageHead(ctx, t.t('room.title'), { back })}<div class="ba-panel ba-soon k-mt">${icon('users')}<div><p role="alert">${t.tx(`room.problem.${problem}`)}</p><a class="ba-btn ba-btn--secondary k-mt" href="${back}">${t.t('room.problem.back')}</a></div></div>`;
    return chrome(ctx, { tab: 'friends', main, mainClass: 'ba-page--room', pushed: true });
  }
  if (r.phase === 'joining' || !r.info) {
    return chrome(ctx, { tab: 'friends', main: html`${pageHead(ctx, t.t('room.title'), { back })}<p class="ba-lead k-mt" role="status">${t.t('room.joining')}</p>`, mainClass: 'ba-page--room', pushed: true });
  }
  const info = r.info;
  const me = r.members.find((m) => m.seat === r.me);
  const g = v.game;
  const canVideo = info.video && v.profile?.can.video === true;
  const videoNote = v.profile && !v.profile.can.video ? t.t('room.share.minors') : t.t('room.share.unavailable');
  const empty = Math.max(0, info.size - r.members.length);
  const canText = info.chat === 'text' && v.profile?.can.freeText === true;
  const seats = html`${r.members.map((m) => seatCard(ctx, m, m.seat === r.me, canVideo))}${Array.from({ length: empty }, () => html`<button class="k-seat empty" type="button" data-action="room.copy" data-what="link"><span class="plus">${icon('plus')}</span><b>${t.t('room.seat.invite')}</b><span class="ba-small">${t.t('room.seat.open')}</span></button>`)}`;
  const main = html`${pageHead(ctx, t.t('room.title'), { back, actions: leave })}
    <div class="k-invite">
      <span class="k-code" role="group" aria-label="${t.t('room.code', { code: info.code })}"><span aria-hidden="true">${info.code}</span><button type="button" data-action="room.copy" data-what="code" aria-label="${t.t('room.copyCode')}">${icon('copy')}</button></span>
      <button class="ba-btn ba-btn--secondary" type="button" data-action="room.copy" data-what="link">${icon('link')}${t.t('room.link')}</button>
      <button class="ba-btn ba-btn--secondary" type="button" data-action="room.qr">${icon('qr')}${t.t('room.qr')}</button>
    </div>
    <div class="k-cols k-mt-lg">
      <div class="k-stack">
        <section class="k-card" aria-labelledby="rg"><div class="k-gamepick">${g ? html`<img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="400" height="300">` : ''}<div><span class="k-label k-flat" id="rg">${t.t('room.game.label')}</span><b>${g ? titleOf(ctx, g) : info.config.gameId}</b><small>${t.t('room.game.line', { duration: secondsLabel(ctx, info.config.durationMs) })}</small>${me?.host && v.games.length > 1 ? html`<br><button class="ba-link k-mt" type="button" data-action="room.game">${t.t('room.game.change')}</button>` : ''}</div></div></section>
        <section aria-labelledby="rp"><span class="k-label" id="rp">${t.t('room.players', { n: r.members.length, size: info.size })}</span><div class="k-seats">${seats}</div></section>
      </div>
      <div class="k-stack">
        <section class="k-card k-camcard" aria-labelledby="cam">
          ${canVideo
            ? html`<div data-form="room-share">${switchRow({ id: 'room-share', name: 'share', label: t.t('room.share.title'), hint: t.t('room.share.hint'), checked: r.shareVideo })}</div><p class="k-fine">${t.t('room.share.minors')}</p>`
            : html`<b id="cam">${t.t('room.share.title')}</b><p class="k-fine">${videoNote}</p>`}
        </section>
        <section class="k-card k-msgrow" aria-labelledby="say">
          <span class="k-label k-flat" id="say">${t.t('room.say.title')}</span>
          <div class="k-msgs">${PRESETS.map((id: PresetId) => html`<button class="ba-chip ba-chip--text" type="button" data-action="room.say" data-id="${id}">${t.tx(`room.say.${id}`)}</button>`)}</div>
          <div class="k-reacts">${REACTIONS.map((id: ReactionId) => html`<button class="k-react" type="button" data-action="room.react" data-id="${id}" aria-label="${t.t('room.react.send', { name: t.tx(`room.react.${id}`) })}">${reactionArt(id)}</button>`)}</div>
          ${canText ? html`<form class="k-chatbox" data-form="room-say" novalidate><label class="ba-visually-hidden" for="room-text">${t.t('room.chat.label')}</label><input class="ba-input" id="room-text" name="text" type="text" autocomplete="off" maxlength="200" data-key="room-text" aria-describedby="room-text-note" value="${v.draft}"><button class="ba-btn ba-btn--secondary" type="submit">${t.t('room.chat.send')}</button></form><p class="k-fine" id="room-text-note" role="status">${v.chatNote || t.t('room.chat.text')}</p>` : html`<p class="k-fine">${t.t('room.chat.preset')}</p>`}
          <ul class="k-feed" aria-label="${t.t('room.feed')}">${r.feed.slice(-6).map((f) => feedRow(ctx, f, r.members))}</ul>
        </section>
      </div>
      ${roomActionBar(ctx, v)}
    </div>`;
  return chrome(ctx, { tab: 'friends', main, mainClass: 'ba-page--room', pushed: true });
}

// ---- the friend link and safety --------------------------------------------------------------------------------------------

export interface FriendLinkView {
  /** The friend code in the link, or null when the link holds none that is valid. */
  code: string | null;
  profile: boolean;
  busy: boolean;
  note: { ok: boolean; text: string } | null;
}

export function friendLinkPage(ctx: ViewContext, v: FriendLinkView): SafeHtml {
  const t = ctx.i18n;
  const body = v.code === null
    ? html`<p class="ba-lead k-mt" role="alert">${t.t('friendlink.bad')}</p>`
    : html`<section class="k-card k-mt"><h2 class="k-h3">${t.t('friendlink.title')}</h2><p>${t.t('friendlink.bodyUnknown', { code: v.code })}</p>
      <div class="ba-actions k-mt">${v.profile
        ? html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="friendlink.send"${attr('disabled', v.busy)}>${t.t('friendlink.cta')}</button>`
        : html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="social.profile">${t.t('social.intro.cta')}</button>`}</div>
      <p class="ba-small k-note-line${v.note && !v.note.ok ? ' is-error' : ''}" role="status">${v.note ? v.note.text : ''}</p></section>`;
  return chrome(ctx, { tab: 'friends', main: html`${pageHead(ctx, t.t('social.add.title'), { back: ctx.href('friends') })}${body}`, mainClass: 'ba-page--friendlink', pushed: true });
}

function ageCard(ctx: ViewContext, band: AgeBand, checked: boolean): SafeHtml {
  const t = ctx.i18n;
  const lines = band === 'adult' ? [1, 2] : [1, 2, 3];
  return html`<label class="k-age"><input type="radio" name="age" value="${band}" data-key="age-${band}"${attr('checked', checked)}><b>${t.tx(`safety.age.${band}`)}</b><ul>${lines.map((n) => html`<li>${t.tx(`safety.age.${band}.${n}`)}</li>`)}</ul></label>`;
}

export function safetyPage(ctx: ViewContext, blocks: readonly BlockEntry[]): SafeHtml {
  const t = ctx.i18n;
  const sees = (id: 'strangers' | 'friends' | 'video', art: SafeHtml, cls = ''): SafeHtml =>
    html`<div class="k-card"><div class="pic ${cls}">${art}</div><h3>${t.tx(`safety.sees.${id}`)}</h3><ul>${[1, 2, 3].map((n) => html`<li>${t.tx(`safety.sees.${id}.${n}`)}</li>`)}</ul></div>`;
  const dark = (p: PoseName, accent: string): SafeHtml => glyph(p, { ink: '#F4F2F8', accent, ball: accent, floor: false, size: 100, decorative: true });
  const main = html`${pageHead(ctx, t.t('safety.title'), { back: ctx.href('friends') })}
    <p class="k-sub">${t.t('safety.sub')}</p>
    <div class="k-flows">
      <div><span class="k-flow-label">${t.t('safety.flow.age')}</span><section class="k-sheet" aria-labelledby="age-h"><h2 id="age-h">${t.t('safety.age.title')}</h2><p class="ba-small k-flat">${t.t('safety.age.body')}</p><div class="k-agecards">${(['child', 'teen', 'adult'] as const).map((b) => html`<div class="k-age k-age--static"><b>${t.tx(`safety.age.${b}`)}</b><ul>${(b === 'adult' ? [1, 2] : [1, 2, 3]).map((n) => html`<li>${t.tx(`safety.age.${b}.${n}`)}</li>`)}</ul></div>`)}</div></section></div>
      <div><span class="k-flow-label">${t.t('safety.flow.report')}</span><section class="k-sheet" aria-labelledby="rep-h"><h2 id="rep-h">${t.t('safety.report.title', { name: '...' })}</h2><ul class="k-plainlist">${REPORT_REASONS.map((r) => html`<li>${t.tx(`safety.report.reason.${r}`)}</li>`)}</ul><p class="k-fine">${t.t('safety.report.fine', { name: '...' })}</p></section></div>
      <div><span class="k-flow-label">${t.t('safety.flow.block')}</span><section class="k-sheet" aria-labelledby="blk-h"><h2 id="blk-h">${t.t('safety.block.title', { name: '...' })}</h2><p class="ba-small k-flat">${t.t('safety.block.body', { name: '...' })}</p></section></div>
    </div>
    <section class="ba-section" aria-labelledby="sees"><header><h2 id="sees">${t.t('safety.sees.title')}</h2></header>
      <div class="k-sees">${sees('strangers', dark('jackOpen', '#46B4FF'))}${sees('friends', avatar('friends'), 'friend')}${sees('video', html`${dark('squat', '#FF4F6E')}`)}</div>
    </section>
    <section class="ba-section" aria-labelledby="blocked"><header><h2 id="blocked">${t.t('safety.blocked.title')}</h2></header>
      ${blocks.length === 0 ? html`<p class="ba-lead">${t.t('safety.blocked.empty')}</p>` : html`<ul class="ba-list">${blocks.map((b) => html`<li>${avatar(b.fid)}<div class="grow"><b>${b.name}</b></div><div class="k-rowbtns"><button class="ba-btn ba-btn--secondary" type="button" data-action="social.unblock" data-fid="${b.fid}">${t.t('safety.blocked.unblock')}</button></div></li>`)}</ul>`}
    </section>`;
  return chrome(ctx, { tab: 'friends', main, mainClass: 'ba-page--safety', pushed: true });
}

// ---- sheets (dialog content) ------------------------------------------------------------------------------------------------

export interface ProfileSheet {
  step: 'age' | 'name';
  band: AgeBand | null;
  /** Adults type the name; for under 18 this is the preset name shown. */
  name: string;
  error: 'rejected' | 'failed' | null;
  busy: boolean;
}

export function profileSheet(ctx: ViewContext, s: ProfileSheet): SafeHtml {
  const t = ctx.i18n;
  if (s.step === 'age') {
    return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('safety.age.title')}</h2>
      <p class="ba-small k-flat" id="sheet-d">${t.t('safety.age.body')}</p>
      <fieldset class="ba-fieldset"><legend class="ba-visually-hidden">${t.t('safety.age.title')}</legend><div class="k-agecards">${(['child', 'teen', 'adult'] as const).map((b) => ageCard(ctx, b, s.band === b))}</div></fieldset>
      <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.age.next"${attr('disabled', s.band === null)}>${t.t('safety.age.continue')}</button><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
  }
  const adult = s.band === 'adult';
  return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('safety.name.title')}</h2>
    <p class="ba-small k-flat" id="sheet-d">${adult ? t.t('safety.name.adultBody') : t.t('safety.name.minorBody')}</p>
    ${adult
      ? html`<div class="ba-field"><label for="profile-name">${t.t('safety.name.label')}</label><input class="ba-input" id="profile-name" name="name" type="text" autocomplete="nickname" maxlength="20" data-key="profile-name" value="${s.name}" aria-describedby="profile-note"></div>`
      : html`<div class="k-namepick"><span class="k-namepick__name">${s.name}</span><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.name.shuffle">${t.t('safety.name.another')}</button></div>`}
    <p class="ba-small k-note-line is-error" id="profile-note" role="alert">${s.error === 'rejected' ? t.t('safety.name.rejected') : s.error === 'failed' ? t.t('safety.name.failed') : ''}</p>
    <div class="btns"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="sheet.name.create"${attr('disabled', s.busy)}>${t.t('safety.name.create')}</button><button class="ba-btn ba-btn--quiet" type="button" data-action="sheet.name.back">${t.t('common.back')}</button></div></div>`;
}

export function friendMenuSheet(ctx: ViewContext, f: FriendEntry): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${avatar(f.fid)}<h2 id="sheet-h">${f.name}</h2></div>
    <div class="btns"><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="remove">${t.t('social.friend.remove')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="report">${icon('flag')}${t.t('social.friend.report')}</button><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="block">${icon('block')}${t.t('social.friend.block')}</button><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
}

export interface ReportSheet { reason: ReportReason; alsoBlock: boolean; details: string }

export function reportSheet(ctx: ViewContext, who: { fid: string; name: string }, s: ReportSheet): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><div class="who">${avatar(who.fid)}<h2 id="sheet-h">${t.t('safety.report.title', { name: who.name })}</h2></div>
    <fieldset class="ba-fieldset"><legend class="ba-visually-hidden">${t.t('safety.report.reason')}</legend><div class="k-radios">${REPORT_REASONS.map((r) => html`<label class="k-radio"><input type="radio" name="reason" value="${r}" data-key="reason-${r}"${attr('checked', s.reason === r)}>${t.tx(`safety.report.reason.${r}`)}</label>`)}</div></fieldset>
    <textarea class="ba-input k-textarea" name="details" maxlength="500" aria-label="${t.t('safety.report.details')}" placeholder="${t.t('safety.report.details')}" data-key="report-details">${s.details}</textarea>
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

export function gameSheet(ctx: ViewContext, games: readonly ShellGame[], current: string): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('room.game.label')}</h2>
    <div class="k-radios">${games.map((g) => html`<button class="k-radio k-radio--btn" type="button" data-dialog-close="${g.id}"${attr('aria-current', g.id === current && 'true')}><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="48" height="36">${titleOf(ctx, g)}</button>`)}</div>
    <div class="btns"><button class="ba-btn ba-btn--quiet" type="button" data-dialog-close="cancel">${t.t('common.cancel')}</button></div></div>`;
}

export function qrSheet(ctx: ViewContext, link: string): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="k-sheet k-sheet--bare"><h2 id="sheet-h">${t.t('room.qrTitle')}</h2>
    <div class="ba-qr ba-qr--big">${qrSvg(link, t.t('room.qr'))}</div>
    <div class="btns"><button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-dialog-close="done" autofocus>${t.t('common.done')}</button></div></div>`;
}

/** Region and level choices the lobby page remembers (used by the controller). */
export const LOBBY_REGIONS: readonly Region[] = REGIONS;
