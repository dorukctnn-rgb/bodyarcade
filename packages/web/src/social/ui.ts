// Small pieces the friends screens share: a figure and a colour for a player, the dot of a friend's presence, the games that
// have online play, the banners of the Friends page. Pure functions of the page's context and the ports' state.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph, type PoseName } from '../../../core/ui/glyphs.ts';
import { icon, type IconName } from '../../../core/ui/icons.ts';
import { BOARD_GAMES, isBoardGame } from '../../../core/social/scores.ts';
import type { FriendPresence } from '../../../core/social/types.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../context.ts';
import { dateTimeText } from './messages.ts';
import type { SocialState } from './port.ts';
import { ux } from './strings.ts';

const AVATAR_COLORS = ['#FF4F6E', '#46B4FF', '#FFC53A', '#22C383', '#9B7BFF', '#FF8A3D'] as const;
const AVATAR_POSES: readonly PoseName[] = ['stand', 'jackOpen', 'reach', 'squat', 'tPose', 'highKnee', 'twist', 'sideBend'];

/** The same figure and colour for the same id on every screen and every device. */
export function avatarLook(id: string): { color: string; pose: PoseName } {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { color: AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#FF4F6E', pose: AVATAR_POSES[(h >>> 8) % AVATAR_POSES.length] ?? 'stand' };
}

export type Dot = 'online' | 'ingame' | 'offline';
export const DOT_OF: Record<FriendPresence['status'], Dot> = { offline: 'offline', online: 'online', in_room: 'ingame', playing: 'ingame' };

export function avatar(id: string, dot: Dot | null = null): SafeHtml {
  const { color, pose } = avatarLook(id);
  return html`<span class="ba-avatar">${glyph(pose, { ink: 'currentColor', accent: color, ball: color, floor: false, size: 100, decorative: true })}${dot ? html`<span class="dot ${dot}" aria-hidden="true"></span>` : ''}</span>`;
}

export function presenceText(ctx: ViewContext, p: FriendPresence): string {
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

/** The games that have a weekly board (the server keeps boards for these only). */
export function boardGames(ctx: Pick<ViewContext, 'games'>): ShellGame[] {
  return ctx.games.filter((g) => isBoardGame(g.id));
}

export { BOARD_GAMES };

/** A calm line with an icon: what the page is telling the player about the connection or the profile. */
export function banner(o: { kind: 'info' | 'warn'; icon: IconName; text: string; role?: 'status' | 'alert'; action?: SafeHtml; id?: string }): SafeHtml {
  return html`<div class="k-banner k-banner--${o.kind}" role="${o.role ?? 'status'}"${o.id ? html` data-banner="${o.id}"` : ''}>${icon(o.icon)}<p>${o.text}</p>${o.action ?? ''}</div>`;
}

/**
 * The banners that belong on the top of the Friends page for the state of the connection and the profile: what the player has to
 * know before anything else (a recovery code not saved, a suspended profile, the connection taken by another window, no network).
 */
export function stateBanners(ctx: ViewContext, s: SocialState): SafeHtml[] {
  const u = ux(ctx);
  const out: SafeHtml[] = [];
  if (s.recovery) {
    out.push(banner({ kind: 'warn', icon: 'key', id: 'recovery', text: u('recovery.banner'), action: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="recovery.show">${u('recovery.show')}</button>` }));
  }
  if (s.signedOut === 'deleted') out.push(banner({ kind: 'info', icon: 'info', id: 'deleted', text: u('banner.deleted') }));
  if (s.signedOut === 'unknown_device') {
    out.push(banner({ kind: 'warn', icon: 'info', id: 'unknown', text: u('banner.unknown'), action: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.recover">${u('age.have')}</button>` }));
  }
  if (s.bannedUntil !== null) {
    out.push(banner({ kind: 'warn', icon: 'shield', id: 'banned', role: 'alert', text: s.bannedUntil > 0 ? u('banner.banned', { until: dateTimeText(ctx, s.bannedUntil) }) : u('banner.bannedNoDate') }));
  }
  if (s.profile && s.bannedUntil === null) {
    if (s.status === 'offline') {
      out.push(banner({ kind: 'warn', icon: 'wifi', id: 'offline', text: u('banner.offline'), action: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.retry">${ctx.i18n.t('social.retry')}</button>` }));
    } else if (s.hub === 'replaced') {
      out.push(banner({ kind: 'warn', icon: 'users', id: 'replaced', text: u('banner.replaced'), action: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="social.takeover">${u('banner.takeOver')}</button>` }));
    } else if (s.hub === 'connecting') {
      out.push(banner({ kind: 'info', icon: 'wifi', id: 'reconnecting', text: u('banner.reconnecting') }));
    }
    if (s.profile.mutedUntil > Date.now()) out.push(banner({ kind: 'info', icon: 'chat', id: 'muted', text: u('banner.muted', { until: dateTimeText(ctx, s.profile.mutedUntil) }) }));
    if (s.profile.publicBlockedUntil > Date.now()) out.push(banner({ kind: 'info', icon: 'shield', id: 'suspended', text: u('banner.suspended', { until: dateTimeText(ctx, s.profile.publicBlockedUntil) }) }));
  }
  return out;
}
