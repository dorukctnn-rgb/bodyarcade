// A room of two to four players: the code, the link and the QR code, who is in it, the game and its length, the camera switch
// (only where the room and the player's age allow it), preset messages and reactions (typed chat only where every member is an
// adult), friends to invite, and a way to report or block a player in a seat. Everybody gets ready (the game's camera is
// calibrated first); the Room starts the race by itself when all are ready, so there is no start button.
import { attr, html, raw, type SafeHtml } from '../../../../core/ui/html.ts';
import { icon } from '../../../../core/ui/icons.ts';
import type { FriendEntry, MyProfile } from '../../../../core/social/types.ts';
import { PRESETS, REACTIONS, type MemberInfo, type PresetId, type ReactionId } from '../../../../core/types/net.ts';
import type { ShellGame } from '../../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../../context.ts';
import { chrome } from '../../views/chrome.ts';
import { switchRow } from '../../views/forms.ts';
import { pageHead } from '../../views/parts.ts';
import type { FeedItem, NoOnline, ProNeeded, RoomProblem, RoomState } from '../port.ts';
import { ux } from '../strings.ts';
import { avatar, banner, DOT_OF, presenceText } from '../ui.ts';
import { kidPanel, youngPanel } from './friends.ts';

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
  /** The player's friends, for the invitations. */
  friends: readonly FriendEntry[];
  /** The friends who were asked into this room just now. */
  invited: readonly string[];
  noOnline: NoOnline | null;
  /** The host's last Pro refusal (a Pro game the Worker or the Room would not take), or null. */
  pro: ProNeeded | null;
}

export const NO_ROOM_VIEW: RoomView = { room: { phase: 'idle', info: null, members: [], me: null, feed: [], problem: null, shareVideo: false, link: '' }, game: null, profile: null, games: [], draft: '', chatNote: '', friends: [], invited: [], noOnline: null, pro: null };

const secondsLabel = (ctx: ViewContext, ms: number): string => {
  const s = Math.round(ms / 1000);
  return s >= 90 && s % 60 === 0 ? ctx.i18n.t('room.min', { n: s / 60 }) : ctx.i18n.t('room.sec', { n: s });
};

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
  const u = ux(ctx);
  const state = !m.online ? html`<span class="k-state wait">${t.t('room.seat.away')}</span>`
    : m.ready ? html`<span class="k-state ready"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${t.t('room.seat.ready')}</span>`
    : html`<span class="k-state wait">${t.t('room.seat.notReady')}</span>`;
  const more = me ? '' : html`<button class="ba-icon-btn k-seatmore" type="button" data-action="room.seat" data-seat="${m.seat}" aria-label="${u('room.seatMore', { name: m.name })}">${icon('more')}</button>`;
  return html`<div class="k-seat" data-seat="${m.seat}">${m.host ? html`<span class="host" role="img" aria-label="${t.t('room.seat.host')}">${icon('host')}</span>` : ''}${canShow ? html`<span class="cam" role="img" aria-label="${m.video ? t.t('room.cam.shared') : t.t('room.cam.off')}">${m.video ? icon('camera') : icon('cameraOff')}</span>` : ''}${avatar(m.seat)}<b>${m.name}${me ? html` <span class="ba-small">(${t.t('room.seat.you')})</span>` : ''}</b><div class="k-seatfoot">${state}${more}</div></div>`;
}

function feedRow(ctx: ViewContext, f: FeedItem, members: readonly MemberInfo[]): SafeHtml {
  const t = ctx.i18n;
  const who = members.find((m) => m.seat === f.seat);
  const name = who?.name ?? '';
  const what = f.react ? html`<span>${t.t('room.feed.sent')}</span><span class="k-react" role="img" aria-label="${t.tx(`room.react.${f.react}`)}">${reactionArt(f.react)}</span>`
    : f.say ? html`<span>${t.tx(`room.say.${f.say}`)}</span>` : html`<span>${f.text ?? ''}</span>`;
  return html`<li>${avatar(f.seat)}<span><b>${name}</b> </span>${what}</li>`;
}

/** The camera links that are not up: one line, and a retry button when it can work. The friend is a skeleton meanwhile and the race never waits. */
function videoLinks(ctx: ViewContext, r: RoomState): SafeHtml {
  const t = ctx.i18n;
  const down = (r.videos ?? []).filter((v) => v.state === 'failed' || v.state === 'connecting');
  if (!down.length) return html``;
  const failed = down.some((v) => v.state === 'failed');
  const retry = down.some((v) => v.state === 'failed' && v.retryable);
  return html`<div class="k-videolink" data-state="${failed ? 'failed' : 'connecting'}"><p class="k-fine" role="status">${t.t(failed ? 'room.video.failed' : 'room.video.connecting')}</p>${retry ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="room.video.retry">${t.t('common.retry')}</button>` : ''}</div>`;
}

/**
 * What the room says about Pro: to the host whose Pro game was refused, why and where to go (the Pro page, or a free game); to
 * everybody, when the host's proof ran out while the room waits (the match starts again when it is renewed or a free game is picked).
 */
function proNote(ctx: ViewContext, v: RoomView): SafeHtml {
  const u = ux(ctx);
  const p = v.pro;
  const waiting = v.room.info?.pro?.ok === false ? html`<div class="k-mt">${banner({ kind: 'warn', icon: 'sparkle', id: 'pro-waiting', text: u('pro.waiting') })}</div>` : '';
  if (p) {
    const known = ctx.games.some((g) => g.id === p.game);
    const pick = v.room.members.find((m) => m.seat === v.room.me)?.host === true && v.games.length > 1;
    return html`<section class="k-card k-pronote k-mt" role="alert" aria-labelledby="pro-h" data-pro="${p.reason}">
      <div class="k-pronote__head">${icon('sparkle')}<h2 class="k-h3" id="pro-h">${u('pro.title')}</h2></div>
      <p class="ba-small k-flat">${u(`pro.${p.reason}`)}</p>
      <div class="k-rowbtns k-rowbtns--wrap k-mt"><a class="ba-btn ba-btn--primary" href="${ctx.href('pro', known ? { query: { game: p.game } } : {})}">${u('pro.see')}</a>${pick ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="room.game">${u('pro.free')}</button>` : ''}<button class="ba-btn ba-btn--quiet" type="button" data-action="room.proDismiss">${u('pro.later')}</button></div>
    </section>${waiting}`;
  }
  return html`${waiting}`;
}

const PROBLEMS: readonly RoomProblem[] = ['full', 'no_room', 'removed', 'replaced', 'version', 'not_allowed', 'ticket', 'offline'];

/**
 * Everybody gets ready (the game's camera is calibrated first); the Room starts the match by itself the moment all
 * players are ready and online, so nobody presses a start button and nobody waits for a host.
 */
function roomActionBar(ctx: ViewContext, v: RoomView): SafeHtml {
  const t = ctx.i18n;
  const r = v.room;
  const me = r.members.find((m) => m.seat === r.me);
  if (!me) return html``;
  if (r.phase === 'playing') {
    return html`<div class="k-actionbar"><div class="k-actions"><button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="room.return">${icon('play')}${t.t('room.return')}</button></div><p class="k-note">${t.t('room.playing')}</p></div>`;
  }
  const others = r.members.filter((m) => m.seat !== me.seat);
  const waiting = others.filter((m) => !m.ready || !m.online);
  const first = waiting[0];
  const note = others.length === 0 ? t.t('room.alone')
    : me.ready && waiting.length === 0 ? t.t('room.starting')
      : me.ready && waiting.length === 1 && first ? t.t('room.waiting', { name: first.name })
        : me.ready ? t.t('room.waitingMany', { n: waiting.length })
          : t.t('room.ready.note');
  const button = me.ready
    ? html`<button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-action="room.ready" data-ready="0">${t.t('room.unready')}</button>`
    : html`<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="room.ready" data-ready="1">${icon('camera')}${t.t('room.ready')}</button>`;
  const remind = me.ready && waiting.length === 1 && first && first.online
    ? html`<button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-action="room.remind" data-seat="${first.seat}">${t.t('room.remind', { name: first.name })}</button>` : '';
  return html`<div class="k-actionbar"><div class="k-actions">${button}${remind}</div><p class="k-note" role="status">${note}</p></div>`;
}

/** Friends who can be asked into this room: online ones get a button, the others a word that says to share the link. */
function inviteCard(ctx: ViewContext, v: RoomView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  if (!v.profile) return html``;
  const inRoom = new Set(v.room.members.map((m) => m.name));
  const list = v.friends.filter((f) => !inRoom.has(f.name)).slice().sort((a, b) => Number(b.presence.status !== 'offline') - Number(a.presence.status !== 'offline'));
  const row = (f: FriendEntry): SafeHtml => {
    const on = f.presence.status !== 'offline';
    const sent = v.invited.includes(f.fid);
    const dot = DOT_OF[f.presence.status];
    return html`<li data-friend="${f.fid}">${avatar(f.fid, dot)}<div class="grow"><b>${f.name}</b><small>${on ? presenceText(ctx, f.presence) : u('invite.offline')}</small></div>${on
      ? html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.invite" data-fid="${f.fid}" aria-label="${u('invite.sendLabel', { name: f.name })}"${attr('disabled', sent)}>${sent ? u('invite.asked') : u('invite.send')}</button>` : ''}</li>`;
  };
  return html`<section class="k-card k-invitecard" aria-labelledby="invite-h"><h2 class="k-h3" id="invite-h">${u('invite.cardTitle')}</h2><p class="ba-small k-flat">${u('invite.cardBody')}</p>
    ${list.length > 0 ? html`<ul class="ba-list k-mt" data-list="invite">${list.slice(0, 8).map(row)}</ul>` : html`<p class="ba-small k-mt">${v.friends.length > 0 ? u('invite.cardAll') : u('invite.cardEmpty')}</p>`}</section>`;
}

export function roomMain(ctx: ViewContext, v: RoomView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const r = v.room;
  const back = ctx.href('friends');
  const leave = html`<button class="ba-btn ba-btn--quiet" type="button" data-action="room.leave">${icon('door')}${t.t('room.leave')}</button>`;
  if (v.noOnline === 'young') return html`${pageHead(ctx, t.t('room.title'), { back })}<div class="k-mt">${youngPanel(ctx)}</div>`;
  if (v.noOnline === 'kid') return html`${pageHead(ctx, t.t('room.title'), { back })}<div class="k-mt">${kidPanel(ctx)}</div>`;
  if (r.problem || r.phase === 'closed' || r.phase === 'idle') {
    const problem: RoomProblem = r.problem && PROBLEMS.includes(r.problem) ? r.problem : 'no_room';
    return html`${pageHead(ctx, t.t('room.title'), { back })}<div class="ba-panel ba-soon k-mt">${icon('users')}<div><p role="alert">${t.tx(`room.problem.${problem}`)}</p><a class="ba-btn ba-btn--secondary k-mt" href="${back}">${t.t('room.problem.back')}</a></div></div>`;
  }
  if (r.phase === 'joining' || !r.info) {
    return html`${pageHead(ctx, t.t('room.title'), { back })}<p class="ba-lead k-mt" role="status">${t.t('room.joining')}</p>`;
  }
  const info = r.info;
  const me = r.members.find((m) => m.seat === r.me);
  const g = v.game;
  const canVideo = info.video && v.profile?.can.video === true;
  const videoNote = v.profile && !v.profile.can.video ? t.t('room.share.minors') : t.t('room.share.unavailable');
  const empty = Math.max(0, info.size - r.members.length);
  const canText = info.chat === 'text' && v.profile?.can.freeText === true;
  const seats = html`${r.members.map((m) => seatCard(ctx, m, m.seat === r.me, canVideo))}${Array.from({ length: empty }, () => html`<button class="k-seat empty" type="button" data-action="room.copy" data-what="link"><span class="plus">${icon('plus')}</span><b>${t.t('room.seat.invite')}</b><span class="ba-small">${t.t('room.seat.open')}</span></button>`)}`;
  return html`${pageHead(ctx, t.t('room.title'), { back, actions: leave })}
    <div class="k-invite">
      <span class="k-code" role="group" aria-label="${t.t('room.code', { code: info.code })}"><span aria-hidden="true">${info.code}</span><button type="button" data-action="room.copy" data-what="code" aria-label="${t.t('room.copyCode')}">${icon('copy')}</button></span>
      <button class="ba-btn ba-btn--secondary" type="button" data-action="room.copy" data-what="link">${icon('link')}${t.t('room.link')}</button>
      <button class="ba-btn ba-btn--secondary" type="button" data-action="room.qr">${icon('qr')}${t.t('room.qr')}</button>
    </div>
    ${proNote(ctx, v)}
    <div class="k-cols k-mt-lg">
      <div class="k-stack">
        <section class="k-card" aria-labelledby="rg"><div class="k-gamepick">${g ? html`<img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="400" height="300">` : ''}<div><span class="k-label k-flat" id="rg">${t.t('room.game.label')}</span><b>${g ? titleOf(ctx, g) : info.config.gameId}</b><small>${t.t('room.game.line', { duration: secondsLabel(ctx, info.config.durationMs) })}</small>${info.pro ? html`<small class="k-protag" data-pro-game>${icon('sparkle')}${u('pro.gameLine')}</small>` : ''}${me?.host && v.games.length > 1 ? html`<br><button class="ba-link k-mt" type="button" data-action="room.game">${t.t('room.game.change')}</button>` : ''}</div></div></section>
        <section aria-labelledby="rp"><span class="k-label" id="rp">${t.t('room.players', { n: r.members.length, size: info.size })}</span><div class="k-seats">${seats}</div></section>
        ${info.kind === 'private' ? inviteCard(ctx, v) : ''}
      </div>
      <div class="k-stack">
        <section class="k-card k-camcard" aria-labelledby="cam">
          ${canVideo
            ? html`<div data-form="room-share">${switchRow({ id: 'room-share', name: 'share', label: t.t('room.share.title'), hint: t.t('room.share.hint'), checked: r.shareVideo })}</div><p class="k-fine">${t.t('room.share.minors')}</p>`
            : html`<b id="cam">${t.t('room.share.title')}</b><p class="k-fine">${videoNote}</p>`}
          ${videoLinks(ctx, r)}
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
}

export function roomPage(ctx: ViewContext, v: RoomView): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: roomMain(ctx, v), mainClass: 'ba-page--room', pushed: true });
}
