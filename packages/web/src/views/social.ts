// The screens behind the Friends tab: friends, my profile, the weekly boards, public lobbies, a room, the friend link, safety,
// and the sheets that open over them (sign-up, recovery, friend menu, report, block, game choice, QR, invitations). They follow
// the art director's UI kit pages (friends, lobbies, room, safety) and draw only from the shapes in social/port.ts, so the
// social client and the live client plug in without touching a view. Off until the social server answers (ctx.flags.social).
//
// The screens themselves are in social/screens/*; this file is the one door the page renderer, the page generator and the tests use.
import { REGIONS, type Region } from '../../../core/social/types.ts';
import type { Matched } from '../../../core/ui/router.ts';
import type { SafeHtml } from '../../../core/ui/html.ts';
import type { ViewContext } from '../context.ts';
import type { RouteId } from '../routes.ts';
import { boardsPage, type BoardsView } from '../social/screens/boards.ts';
import { friendsPage, NO_FRIENDS_VIEW, type FriendsView } from '../social/screens/friends.ts';
import { friendLinkPage, NO_LINK_VIEW, safetyPage, type FriendLinkView } from '../social/screens/link.ts';
import { IDLE_QUICK, lobbiesPage, type LobbiesView } from '../social/screens/lobbies.ts';
import { NO_PROFILE_VIEW, profilePage, type ProfileView } from '../social/screens/profile.ts';
import { NO_ROOM_VIEW, roomPage, type RoomView } from '../social/screens/room.ts';
import { ux } from '../social/strings.ts';

export { avatar, avatarLook, boardGames, onlineGames, type Dot } from '../social/ui.ts';
export { friendsPage, friendsMain, kidPanel, NO_FRIENDS_VIEW, panel, youngPanel, type FriendsView } from '../social/screens/friends.ts';
export { NO_PROFILE_VIEW, profileMain, profilePage, type ProfileView } from '../social/screens/profile.ts';
export { boardsMain, boardsPage, type BoardsView } from '../social/screens/boards.ts';
export { IDLE_QUICK, lobbiesMain, lobbiesPage, type LobbiesView, type QuickView } from '../social/screens/lobbies.ts';
export { NO_ROOM_VIEW, roomMain, roomPage, type RoomView } from '../social/screens/room.ts';
export { friendLinkMain, friendLinkPage, NO_LINK_VIEW, safetyMain, safetyPage, type FriendLinkView } from '../social/screens/link.ts';
export {
  blockSheet, clockText, friendMenuSheet, gameSheet, inviteTray, NEW_PROFILE_SHEET, profileSheet, qrSheet, recoveryBody, recoverySheet, reportSheet, seatMenuSheet,
  type ProfileSheet, type ReportSheet,
} from '../social/screens/sheets.ts';

/** Region and level choices the lobby page remembers (used by the controller). */
export const LOBBY_REGIONS: readonly Region[] = REGIONS;

/** Which part of the Friends page is on screen: the page itself, my profile, or the weekly boards (`/friends/?view=...`). */
export type FriendsPart = 'friends' | 'profile' | 'boards';

/** What the pages of the Friends area draw: the controller (app/social.ts) fills it from the ports; the page generator never has one. */
export interface SocialPageState {
  part: FriendsPart;
  friends: FriendsView;
  profile: ProfileView;
  boards: BoardsView;
  lobbies: LobbiesView;
  room: RoomView;
  friendLink: FriendLinkView;
}

export const friendsPartOf = (route: Pick<Matched<RouteId>, 'query'> | null): FriendsPart => {
  const v = route?.query.get('view');
  return v === 'profile' || v === 'boards' ? v : 'friends';
};

/** The page of a route of the Friends area, and its title. */
export function socialPage(ctx: ViewContext, route: Matched<RouteId>, s: SocialPageState | null): { body: SafeHtml; title: string } {
  const t = ctx.i18n;
  const u = ux(ctx);
  const friends = s?.friends ?? NO_FRIENDS_VIEW;
  switch (route.id) {
    case 'friends': {
      const part = s?.part ?? friendsPartOf(route);
      if (part === 'profile') return { body: profilePage(ctx, s?.profile ?? { ...NO_PROFILE_VIEW, state: friends.state }), title: u('me.title') };
      if (part === 'boards') {
        return { body: boardsPage(ctx, s?.boards ?? { state: friends.state, games: [], game: null, scope: 'friends', week: 'current', board: null, loading: false, failed: false }), title: u('boards.title') };
      }
      return { body: friendsPage(ctx, friends), title: t.t('social.title') };
    }
    case 'lobbies':
      return { body: lobbiesPage(ctx, s?.lobbies ?? { state: friends.state, games: [], game: null, band: 'medium', region: 'eu', list: null, failed: null, quick: IDLE_QUICK }), title: t.t('lobby.title') };
    case 'room':
      return { body: roomPage(ctx, s?.room ?? NO_ROOM_VIEW), title: t.t('room.title') };
    case 'friendlink':
      return { body: friendLinkPage(ctx, s?.friendLink ?? NO_LINK_VIEW), title: t.t('social.add.title') };
    default:
      return { body: safetyPage(ctx, friends.state.blocks), title: t.t('safety.title') };
  }
}
