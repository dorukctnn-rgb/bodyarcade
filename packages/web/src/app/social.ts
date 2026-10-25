// What the player does on the Friends screens: the age question and the profile, the recovery code, my profile, friend codes
// and requests, the friend menu with report and block, public lobbies and quick match, the weekly boards, invitations, and a room
// (ready check, messages, camera switch). The views draw from the ports' state; this class holds the little that is only the
// screen's (what is typed, which game is picked, which sheet is open) and turns clicks into port calls. Nothing here knows a server.
import { openDialog, type DialogHandle } from '../../../core/ui/dialog.ts';
import type { Matched } from '../../../core/ui/router.ts';
import { codeFromInvite, isRoomCode } from '../../../core/net/codes.ts';
import { isProGame } from '../../../core/net/live-games.ts';
import { checkChat, checkName } from '../../../core/net/chat-filter.ts';
import { formatFriendCode, formatRecoveryCode, parseFriendCode, parseFriendLink } from '../../../core/social/codes.ts';
import { GHOST_OFFER_AFTER_MS, levelBand } from '../../../core/social/levels.ts';
import { isPresetMessage, isReaction, randomPresetName } from '../../../core/social/presets.ts';
import { isBoardGame } from '../../../core/social/scores.ts';
import type { AgeBand, BoardScope, BoardView, LevelBand, LobbyEntry, Region, ReportReason, RunTicket } from '../../../core/social/types.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { hasPro, titleOf, type ViewContext } from '../context.ts';
import type { RouteId } from '../routes.ts';
import { failText } from '../social/messages.ts';
import type { Failed, MatchDriver, MatchProgress, ProNeeded, RoomDone, SocialNotice, SocialServices } from '../social/port.ts';
import { ux } from '../social/strings.ts';
import { IDLE_QUICK, type QuickView } from '../social/screens/lobbies.ts';
import '../social/social.css';
import {
  blockSheet, boardGames, friendMenuSheet, friendsPartOf, gameSheet, inviteTray, NEW_PROFILE_SHEET, onlineGames, proSheet, profileSheet, qrSheet, recoverySheet, reportSheet, seatMenuSheet,
  type FriendsPart, type ProfileSheet, type ReportSheet, type SocialPageState,
} from '../views/social.ts';
import { confirmHtml, type ConfirmOptions } from '../views/misc.ts';

export type { SocialPageState };

/** What the controller needs from the app around it. */
export interface SocialHost {
  document: Document;
  context(): ViewContext;
  go(href: string, o?: { replace?: boolean }): void;
  toast(text: string, kind?: 'warn'): void;
  announce(text: string): void;
  /** Draws the current page again from the state (called when something the page shows has changed). */
  rerender(): void;
  /** Copies text, or hands a link to the system share sheet where there is one; false when neither worked. */
  share(text: string, o: { link: boolean }): Promise<boolean>;
  /** How long a race with a friend lasts (the game's round, half a minute to a minute and a half; a test build can shorten it). */
  raceMs?(g: ShellGame): number;
}

export const SOCIAL_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['friends', 'lobbies', 'room', 'friendlink', 'safety']);

/** The room a page belongs to: the room page itself, the stage of a race played in it (`/play/<game>/?room=<code>`) or its results. */
export function roomOfRoute(route: Matched<RouteId> | null): string | null {
  if (!route) return null;
  // the results of a room's race stay with the room (`/results/?room=<code>`): the rematch and the way back to the room need it open
  const raw = route.id === 'room' ? (route.params['code'] ?? '') : route.id === 'play' || route.id === 'results' ? (route.query.get('room') ?? '') : '';
  return raw ? codeFromInvite(raw) : null;
}

/** The level a player's usual band stands for when it is chosen on the profile page (levelBand maps them back). */
const LEVEL_OF_BAND: Readonly<Record<LevelBand, number>> = { easy: 5, medium: 15, hard: 30 };

/** A race lasts as long as the game's round, up to a minute and a half (a friend race is a sprint, not a workout). */
export const raceMs = (g: Pick<ShellGame, 'durationSec'>): number => Math.max(30, Math.min(90, g.durationSec)) * 1000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Note = { ok: boolean; text: string };
/** What a port call answered, as far as the controller reads it. */
type Result = { ok: true } | Failed;

export class SocialController {
  private readonly host: SocialHost;
  private readonly svc: SocialServices;
  private readonly cleanups: (() => void)[] = [];
  private started = false;
  private route: Matched<RouteId> | null = null;
  /** The page the app is on, whatever it is (the Friends area or not). */
  private current: Matched<RouteId> | null = null;
  /** The room this controller keeps open: the room page and the stage of a race in it both belong to it. */
  private openCode: string | null = null;
  private redrawTimer: ReturnType<typeof setTimeout> | null = null;
  /** The first read of the profile and the lists (what a round waits for before it asks for its ticket). */
  private opened: Promise<void> = Promise.resolve();
  private tray: HTMLElement | null = null;
  private trayTimer: ReturnType<typeof setInterval> | null = null;

  private add = { value: '', busy: false, note: null as Note | null };
  private lobby: {
    gameId: string | null; band: LevelBand | null; region: Region | null; list: readonly LobbyEntry[] | null; failed: string | null; quick: QuickView;
    abort: AbortController | null; token: number; ghostDismissed: boolean; loading: boolean;
  } = { gameId: null, band: null, region: null, list: null, failed: null, quick: IDLE_QUICK, abort: null, token: 0, ghostDismissed: false, loading: false };
  private boards: { gameId: string | null; scope: BoardScope; week: 'current' | 'previous'; board: BoardView | null; loading: boolean; failed: boolean; token: number } =
    { gameId: null, scope: 'friends', week: 'current', board: null, loading: false, failed: false, token: 0 };
  private me: { draft: string | null; notes: Partial<Record<'name' | 'code' | 'recovery' | 'prefs' | 'data' | 'age', Note>>; busy: string | null } = { draft: null, notes: {}, busy: null };
  private room = { draft: '', chatNote: '', joining: '', invited: [] as string[] };
  private link: { busy: boolean; note: Note | null; done: 'sent' | 'friends' | null } = { busy: false, note: null, done: null };
  private active: { kind: 'profile'; handle: DialogHandle; sheet: ProfileSheet; finish(ok: boolean): void } | { kind: 'report'; handle: DialogHandle; state: ReportSheet; sent: boolean } | { kind: 'recovery'; handle: DialogHandle } | null = null;
  /** The weekly-board ticket of the solo round that is being played. */
  private round: { ticket: RunTicket; game: string } | null = null;

  constructor(host: SocialHost, svc: SocialServices) {
    this.host = host;
    this.svc = svc;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const doc = this.host.document;
    this.cleanups.push(this.svc.social.subscribe(() => this.changed()), this.svc.rooms.subscribe(() => this.changed()), this.svc.social.notices((n) => this.noticed(n)));
    const tray = doc.createElement('div');
    tray.className = 'ba-invites';
    tray.setAttribute('data-invites', '');
    // A notice that floats over the top of the page for two minutes by design (the QA layout probe leaves a layer like this alone).
    tray.setAttribute('data-qa-layer', '');
    doc.body.appendChild(tray);
    this.tray = tray;
    this.cleanups.push(() => tray.remove());
    const visible = (): void => this.svc.social.setActive(!doc.hidden);
    doc.addEventListener('visibilitychange', visible);
    this.cleanups.push(() => doc.removeEventListener('visibilitychange', visible));
    this.opened = this.svc.social.open().then(() => { this.changed(); });
    this.mark();
    this.renderTray();
  }

  stop(): void {
    this.started = false;
    for (const c of this.cleanups.splice(0)) c();
    if (this.redrawTimer) clearTimeout(this.redrawTimer);
    if (this.trayTimer) clearInterval(this.trayTimer);
    this.lobby.abort?.abort();
    this.active?.handle.close('cancel');
    this.svc.rooms.leave();
    this.svc.social.close();
  }

  // ---- routes --------------------------------------------------------------------------------------------------------

  /** A page of the app is about to be drawn (the Friends area, or any other page with `route` outside it). */
  enter(route: Matched<RouteId> | null): void {
    this.current = route;
    this.route = route && SOCIAL_ROUTES.has(route.id) ? route : null;
    this.active?.handle.close('cancel');
    const code = roomOfRoute(route);
    // Leaving the room's pages (or going to another room) leaves the room; going from its page to its stage and back does not.
    if (this.openCode && this.openCode !== code) { this.svc.rooms.leave(); this.room.invited = []; }
    this.openCode = code;
    if (this.lobby.abort && route?.id !== 'lobbies') this.stopSearch();
    this.presence(route);
    this.renderTray();
    if (!this.route) return;
    if (this.svc.social.state().status === 'offline') void this.svc.social.open();
    switch (this.route.id) {
      case 'lobbies': void this.loadLobbies(); break;
      case 'room': void this.enterRoom(this.route.params['code'] ?? ''); break;
      case 'friendlink': this.link = { busy: false, note: null, done: null }; break;
      case 'friends':
        this.me = { draft: null, notes: {}, busy: null };
        if (friendsPartOf(this.route) === 'boards') void this.loadBoard();
        break;
      default: break;
    }
  }

  /** What the player is doing, for the friends who look: playing a game by themselves on a round page, online anywhere else. */
  private presence(route: Matched<RouteId> | null): void {
    if (route?.id === 'play' && !route.query.get('room')) {
      const g = this.host.context().games.find((x) => x.seo.slug === (route.params['slug'] ?? ''));
      this.svc.social.setStatus('playing', g?.id);
    } else this.svc.social.setStatus('online');
  }

  /** The services of the room and the friends, for the stage of a race. */
  services(): SocialServices { return this.svc; }

  /**
   * The stage of a race in a room was opened without the room open on this page (a reload, a link to the stage): the room is joined
   * again. A player without a profile is not asked here: the stage sends them to the room's page, which asks the age first.
   */
  async joinForStage(raw: string): Promise<RoomDone> {
    const code = codeFromInvite(raw);
    const rooms = this.svc.rooms;
    if (!code || !isRoomCode(code)) return { ok: false, code: 'no_room' };
    await this.opened;
    if (this.svc.social.state().noOnline || !this.svc.social.state().profile) return { ok: false, code: 'not_allowed' };
    if (rooms.state().info?.code === code && rooms.state().phase !== 'closed') return { ok: true, value: undefined };
    const r = await rooms.join(code);
    this.changed();
    return r;
  }

  /** Asks the age and the name when this player has no profile yet; true once there is one. */
  async ensureProfile(): Promise<boolean> {
    // a press that comes before the profile of this device is read (a page just opened) waits for it, it does not ask the age again
    await this.profileRead();
    const s = this.svc.social.state();
    if (s.profile) return true;
    if (s.noOnline) { this.host.toast(ux(this.host.context())('err.child_no_online'), 'warn'); return false; }
    return this.openProfileSheet();
  }

  /** Until this device's profile is read (the services say 'loading' before that), ten seconds at most. */
  private profileRead(): Promise<void> {
    const social = this.svc.social;
    const known = (): boolean => social.state().status !== 'loading' || !!social.state().profile;
    if (known()) return Promise.resolve();
    return new Promise((done) => {
      let off: () => void = () => undefined;
      const timer = setTimeout(() => { off(); done(); }, 10_000);
      off = social.subscribe(() => { if (known()) { clearTimeout(timer); off(); done(); } });
    });
  }

  private async enterRoom(raw: string): Promise<void> {
    const code = codeFromInvite(raw);
    const rooms = this.svc.rooms;
    if (!code || !isRoomCode(code)) return;
    if (this.svc.social.state().noOnline) return;
    if (rooms.state().info?.code === code && rooms.state().phase !== 'closed') return;
    if (this.room.joining === code) return;
    this.room.joining = code;
    try {
      // A profile is needed before any room: the age question is asked once, here at the latest.
      if (!this.svc.social.state().profile) {
        await this.svc.social.open();
        if (this.svc.social.state().noOnline) return;
        const made = this.svc.social.state().profile ? true : await this.openProfileSheet();
        if (!made) { if (this.route?.id === 'room') this.host.go(this.host.context().href('friends'), { replace: true }); return; }
      }
      if (this.route?.id !== 'room') return;
      const r = await rooms.join(code);
      if (!r.ok) this.host.toast(this.roomProblem(r.code), 'warn');
    } finally {
      this.room.joining = '';
      this.changed();
    }
  }

  private roomProblem(code: string): string {
    const t = this.host.context().i18n;
    return t.tx(`room.problem.${code}`);
  }

  // ---- what the pages draw -----------------------------------------------------------------------------------------

  pageState(route: Matched<RouteId> | null): SocialPageState {
    const ctx = this.host.context();
    const state = this.svc.social.state();
    const profile = state.profile;
    const part: FriendsPart = friendsPartOf(route);
    const games = onlineGames(ctx);
    const l = this.lobby;
    const game = games.find((g) => g.id === l.gameId) ?? games[0] ?? null;
    const bgames = boardGames(ctx);
    const bgame = bgames.find((g) => g.id === this.boards.gameId) ?? bgames[0] ?? null;
    const room = this.svc.rooms.state();
    const info = room.info;
    const code = route?.id === 'friendlink' ? (parseFriendLink(route.params['code'] ?? '') ?? parseFriendCode(route.params['code'] ?? '')) : null;
    const formatted = code ? formatFriendCode(code) : null;
    return {
      part,
      friends: { state, add: this.add },
      profile: { state, name: this.me.draft ?? profile?.name ?? '', notes: this.me.notes, busy: this.me.busy },
      boards: { state, games: bgames, game: bgame, scope: this.boards.scope, week: this.boards.week, board: this.boards.board, loading: this.boards.loading, failed: this.boards.failed },
      lobbies: { state, games, game, band: l.band ?? (profile ? levelBand(profile.level) : 'medium'), region: l.region ?? profile?.region ?? 'eu', list: l.list, failed: l.failed, quick: l.quick },
      room: { room, game: info ? (ctx.games.find((g) => g.id === info.config.gameId) ?? null) : null, profile, games, draft: this.room.draft, chatNote: this.room.chatNote, friends: state.friends, invited: this.room.invited, noOnline: state.noOnline, pro: this.svc.rooms.proNeeded?.() ?? null },
      friendLink: {
        code: formatted, profile: !!profile, own: !!formatted && profile?.code === formatted, busy: this.link.busy, done: this.link.done, note: this.link.note, noOnline: state.noOnline,
        offline: state.status === 'offline',
      },
    };
  }

  /** The state of the friends side on the page's root element, for styles and for tests: loading, ready or offline, and the connection. */
  private mark(): void {
    const s = this.svc.social.state();
    const d = this.host.document.documentElement.dataset;
    d['socialStatus'] = s.status;
    d['socialHub'] = s.hub;
  }

  /** Something in a port changed: draw again once, soon, without losing what is typed. */
  private changed(): void {
    this.mark();
    this.renderTray();
    this.catchUp();
    if (!this.route || this.redrawTimer) return;
    this.redrawTimer = setTimeout(() => { this.redrawTimer = null; if (this.route) this.host.rerender(); }, 40);
  }

  /**
   * A page that asked for its data before the profile was there (the first answer had not come) asks again once the profile is: the
   * lobbies and the board of a page opened at the start would otherwise wait for ever.
   */
  private catchUp(): void {
    const st = this.svc.social.state();
    if (!st.profile || st.bannedUntil !== null || !this.route) return;
    if (this.route.id === 'lobbies' && this.lobby.list === null && this.lobby.failed === null && !this.lobby.loading) void this.loadLobbies();
    if (this.route.id === 'friends' && friendsPartOf(this.route) === 'boards' && this.boards.board === null && !this.boards.loading && !this.boards.failed) void this.loadBoard();
  }

  // ---- notices and invitations -------------------------------------------------------------------------------------

  private noticed(n: SocialNotice): void {
    const ctx = this.host.context();
    const u = ux(ctx);
    switch (n.kind) {
      case 'request': this.host.toast(u('notice.request', { name: n.name })); break;
      case 'friend': this.host.toast(u('notice.friend', { name: n.name })); break;
      case 'invite': {
        const g = ctx.games.find((x) => x.id === n.invite.game);
        this.host.announce(u('invite.line', { name: n.invite.from.name, game: g ? titleOf(ctx, g) : n.invite.game }));
        break;
      }
      case 'inviteDeclined': this.host.toast(n.name ? u('invite.declined', { name: n.name }) : u('invite.declined', { name: '' }).trim()); break;
      case 'signedOut': this.host.toast(n.reason === 'deleted' ? u('notice.deleted') : u('notice.unknown'), 'warn'); break;
    }
    this.changed();
  }

  /** Draws the tray of invitations, and keeps its clocks running while there is one. Hidden during a round. */
  private renderTray(): void {
    const tray = this.tray;
    if (!tray) return;
    const st = this.svc.social.state();
    const now = this.svc.social.serverNow();
    const live = this.current?.id !== 'play' ? st.invites.filter((i) => i.exp > now) : [];
    tray.innerHTML = live.length > 0 ? inviteTray(this.host.context(), live, now).value : '';
    if (live.length > 0 && !this.trayTimer) this.trayTimer = setInterval(() => this.renderTray(), 1000);
    if (live.length === 0 && this.trayTimer) { clearInterval(this.trayTimer); this.trayTimer = null; }
  }

  private async answerInvite(id: string, accept: boolean): Promise<void> {
    const inv = this.svc.social.state().invites.find((i) => i.id === id);
    if (!inv) return;
    const r = await this.svc.social.answerInvite(inv, accept);
    if (!r.ok) { this.host.toast(failText(this.host.context(), r), 'warn'); return; }
    this.renderTray();
    if (accept) this.host.go(this.host.context().href('room', { params: { code: inv.room } }));
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  click(action: string, el: HTMLElement): boolean {
    const d = el.dataset;
    switch (action) {
      case 'social.profile': void this.openProfileSheet(); return true;
      case 'social.recover': void this.openProfileSheet('recover'); return true;
      case 'social.retry': void this.retry(); return true;
      case 'social.takeover': this.svc.social.takeOver(); return true;
      case 'social.copy': void this.copyOwn(d['what'] ?? ''); return true;
      case 'social.accept': void this.answer(d['fid'] ?? '', true); return true;
      case 'social.decline': void this.answer(d['fid'] ?? '', false); return true;
      case 'social.cancel': void this.run(this.svc.social.cancelRequest(d['fid'] ?? '')); return true;
      case 'social.invite': void this.inviteFriend(d['fid'] ?? ''); return true;
      case 'social.join': this.host.go(this.host.context().href('room', { params: { code: d['room'] ?? '' } })); return true;
      case 'social.menu': void this.friendMenu(d['fid'] ?? ''); return true;
      case 'social.unblock': void this.unblock(d['fid'] ?? ''); return true;
      case 'recovery.show': this.showRecovery(); return true;
      case 'friendlink.send': void this.sendFriendLink(); return true;
      case 'invite.join': void this.answerInvite(d['id'] ?? '', true); return true;
      case 'invite.decline': void this.answerInvite(d['id'] ?? '', false); return true;
      case 'room.new': void this.newRoom(); return true;
      case 'race.new': void this.newRace(d['game'] ?? ''); return true;
      case 'lobby.game': this.lobby = { ...this.lobby, gameId: d['game'] ?? null, list: null, failed: null, loading: false, token: this.lobby.token + 1 }; this.stopSearch(); this.host.rerender(); void this.loadLobbies(); return true;
      case 'lobby.quick': void this.quickMatch(); return true;
      case 'lobby.stop': this.stopSearch(); this.host.rerender(); return true;
      case 'lobby.keep': this.lobby = { ...this.lobby, ghostDismissed: true, quick: { ...this.lobby.quick, offerGhost: false } }; this.host.rerender(); return true;
      case 'lobby.ghost': this.raceGhost(); return true;
      case 'lobby.refresh': this.lobby = { ...this.lobby, list: null, failed: null, loading: false, token: this.lobby.token + 1 }; this.host.rerender(); void this.loadLobbies(); return true;
      case 'lobby.join': this.host.go(this.host.context().href('room', { params: { code: d['code'] ?? '' } })); return true;
      case 'lobby.start': void this.newRoom('public'); return true;
      case 'boards.game': this.boards = { ...this.boards, gameId: d['game'] ?? null }; void this.loadBoard(); return true;
      case 'boards.retry': void this.loadBoard(); return true;
      case 'me.reroll': void this.reroll(); return true;
      case 'me.renewCode': void this.renewCode(); return true;
      case 'me.renewRecovery': void this.renewRecovery(); return true;
      case 'me.download': void this.download(); return true;
      case 'me.delete': void this.deleteProfile(); return true;
      case 'me.ageDown': void this.ageDown(); return true;
      case 'me.ageChild': void this.ageChild(); return true;
      case 'room.leave': this.svc.rooms.leave(); this.host.go(this.host.context().href('friends'), { replace: true }); return true;
      case 'room.copy': void this.copyRoom(d['what'] ?? ''); return true;
      case 'room.qr': this.openQr(); return true;
      case 'room.ready': this.ready(d['ready'] === '1'); return true;
      case 'room.return': this.toStage(); return true;
      case 'room.remind': this.remind(d['seat'] ?? ''); return true;
      case 'room.say': if (isPresetMessage(d['id'])) this.svc.rooms.say(d['id']); return true;
      case 'room.react': if (isReaction(d['id'])) this.svc.rooms.react(d['id']); return true;
      case 'room.game': void this.chooseGame(); return true;
      case 'room.proDismiss': this.svc.rooms.dismissProNeeded?.(); this.changed(); return true;
      case 'room.seat': void this.seatMenu(d['seat'] ?? ''); return true;
      case 'room.video.retry': this.svc.rooms.retryVideo?.(); this.host.announce(this.host.context().i18n.t('room.video.connecting')); return true;
      case 'sheet.age.next': this.sheetAgeNext(); return true;
      case 'sheet.recover.open': this.sheetStep('recover'); return true;
      case 'sheet.recover.back': this.sheetStep('age'); return true;
      case 'sheet.recover.go': void this.sheetRecover(); return true;
      case 'sheet.name.shuffle': this.sheetShuffle(); return true;
      case 'sheet.name.back': this.sheetStep('age'); return true;
      case 'sheet.name.create': void this.sheetCreate(); return true;
      case 'sheet.recovery.copy': void this.copyRecovery(); return true;
      case 'sheet.recovery.download': this.downloadRecovery(); return true;
      case 'sheet.recovery.saved': this.svc.social.dismissRecovery(); return true;
      case 'sheet.report.send': this.sheetReportSend(); return true;
      default: return false;
    }
  }

  submit(form: HTMLFormElement): boolean {
    const kind = form.dataset['form'];
    if (kind === 'friend-add') { void this.addFriend(); return true; }
    if (kind === 'room-say') { this.sendText(new FormData(form).get('text')); return true; }
    if (kind === 'me-name') { void this.rename(); return true; }
    if (kind === 'lobby' || kind === 'boards') return true;
    return false;
  }

  /** A choice changed on a social page or in a sheet; true when it was one of ours. */
  change(t: HTMLInputElement | HTMLSelectElement): boolean {
    const form = t.closest<HTMLElement>('[data-form]');
    const kind = form?.dataset['form'];
    if (kind === 'lobby' && t.name === 'band') {
      this.lobby = { ...this.lobby, band: t.value as LevelBand };
      this.host.rerender();
      return true;
    }
    if (kind === 'lobby-region' && t.name === 'region') {
      this.lobby = { ...this.lobby, region: t.value as Region, list: null, failed: null, loading: false, token: this.lobby.token + 1 };
      this.host.rerender();
      void this.loadLobbies();
      return true;
    }
    if (kind === 'boards' && (t.name === 'scope' || t.name === 'week')) {
      if (t.name === 'scope') this.boards = { ...this.boards, scope: t.value === 'country' ? 'country' : 'friends' };
      else this.boards = { ...this.boards, week: t.value === 'previous' ? 'previous' : 'current' };
      void this.loadBoard();
      return true;
    }
    if (kind === 'me-prefs') { void this.savePrefs(t); return true; }
    if (kind === 'room-share' && t.name === 'share') { this.svc.rooms.setShareVideo((t as HTMLInputElement).checked); return true; }
    if (this.active && t.closest('dialog')) return this.sheetChanged(t);
    return false;
  }

  input(t: HTMLInputElement): boolean {
    if (t.name === 'code' && t.closest('[data-form="friend-add"]')) { this.add = { ...this.add, value: t.value, note: null }; return true; }
    if (t.name === 'text' && t.closest('[data-form="room-say"]')) { this.room.draft = t.value; return true; }
    if (t.name === 'name' && t.closest('[data-form="me-name"]')) { this.me.draft = t.value; return true; }
    if (this.active?.kind === 'profile' && t.closest('dialog')) {
      const s = this.active.sheet;
      if (t.name === 'name') s.name = t.value;
      else if (t.name === 'recoverCode') s.recoverCode = t.value;
      else if (t.name === 'recoverRecovery') s.recoverRecovery = t.value;
      else return false;
      return true;
    }
    return false;
  }

  // ---- friends -----------------------------------------------------------------------------------------------------

  private text(f: Failed, o: { name?: string; gone?: boolean } = {}): string { return failText(this.host.context(), f, o); }

  private async run(p: Promise<Result>, done?: string, o: { name?: string } = {}): Promise<boolean> {
    const r = await p;
    if (!r.ok) { this.host.toast(this.text(r, o), 'warn'); return false; }
    if (done) { this.host.toast(done); this.host.announce(done); }
    return true;
  }

  private async retry(): Promise<void> {
    await this.svc.social.open();
    this.changed();
  }

  private async addFriend(): Promise<void> {
    const t = this.host.context().i18n;
    const chars = parseFriendLink(this.add.value) ?? parseFriendCode(this.add.value);
    if (!chars) { this.add = { ...this.add, note: { ok: false, text: t.t('social.add.bad') } }; this.host.rerender(); return; }
    if (!this.svc.social.state().profile && !(await this.ensureProfile())) return;
    this.add = { ...this.add, busy: true, note: null };
    this.host.rerender();
    const r = await this.svc.social.addByCode(formatFriendCode(chars));
    if (r.ok) {
      const v = r.value;
      const text = v.status === 'friends' ? t.t('social.add.friends', { name: v.friend.name }) : t.t('social.add.sent');
      this.add = { value: '', busy: false, note: { ok: true, text } };
    } else this.add = { ...this.add, busy: false, note: { ok: false, text: this.text(r) } };
    this.host.rerender();
    this.host.announce(this.add.note?.text ?? '');
  }

  private async answer(fid: string, accept: boolean): Promise<void> {
    const t = this.host.context().i18n;
    const who = this.svc.social.state().requests.incoming.find((r) => r.fid === fid)?.name ?? '';
    await this.run(this.svc.social.answer(fid, accept), accept ? t.t('social.req.accepted', { name: who }) : undefined, { name: who });
  }

  private async copyOwn(what: string): Promise<void> {
    const p = this.svc.social.state().profile;
    if (!p) return;
    const t = this.host.context().i18n;
    const link = what === 'link';
    const ok = await this.host.share(link ? p.link : p.code, { link });
    if (ok) { const text = link ? t.t('social.profile.shared') : t.t('social.profile.copied'); this.host.toast(text); this.host.announce(text); }
  }

  private async friendMenu(fid: string): Promise<void> {
    const f = this.svc.social.state().friends.find((x) => x.fid === fid);
    if (!f) return;
    const ctx = this.host.context();
    const t = ctx.i18n;
    const d = openDialog({ document: this.host.document, html: friendMenuSheet(ctx, f), labelledBy: 'sheet-h', className: 'ba-modal--sheet' });
    const pick = await d.closed;
    if (pick === 'remove') {
      const yes = await this.confirm({ title: t.t('social.friend.removeTitle', { name: f.name }), body: t.t('social.friend.removeBody', { name: f.name }), confirm: t.t('social.friend.remove'), cancel: t.t('common.cancel'), danger: true });
      if (yes) await this.run(this.svc.social.unfriend(fid), t.t('social.friend.removed', { name: f.name }));
    } else if (pick === 'block') await this.blockFlow(fid, f.name, (id) => this.svc.social.block(id));
    else if (pick === 'report') await this.reportFlow({ fid, name: f.name }, (r) => this.svc.social.report({ fid, reason: r.reason, details: r.details, alsoBlock: r.alsoBlock }));
  }

  private async blockFlow(id: string, name: string, block: (id: string) => Promise<Result>): Promise<void> {
    const ctx = this.host.context();
    const d = openDialog({ document: this.host.document, html: blockSheet(ctx, { fid: id, name }), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet' });
    if ((await d.closed) !== 'yes') return;
    await this.run(block(id), ctx.i18n.t('safety.block.done', { name }));
  }

  private async unblock(fid: string): Promise<void> {
    const name = this.svc.social.state().blocks.find((b) => b.fid === fid)?.name ?? '';
    await this.run(this.svc.social.unblock(fid), this.host.context().i18n.t('safety.blocked.done', { name }));
  }

  /** The report sheet: a reason, a note for grown-ups, and whether to block as well. `send` files it when the player pressed Send. */
  private async reportFlow(who: { fid: string; name: string }, send: (r: ReportSheet) => Promise<Result> | void): Promise<void> {
    const ctx = this.host.context();
    const state: ReportSheet = { reason: 'abuse', alsoBlock: true, details: '' };
    const canNote = this.svc.social.state().profile?.band === 'adult';
    const handle = openDialog({ document: this.host.document, html: reportSheet(ctx, who, state, canNote), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet' });
    const flow: { kind: 'report'; handle: DialogHandle; state: ReportSheet; sent: boolean } = { kind: 'report', handle, state, sent: false };
    this.active = flow;
    const r = await handle.closed;
    if (this.active === flow) this.active = null;
    if (r !== 'sent' || !flow.sent) return;
    state.details = state.details.trim();
    const out = send(state);
    if (out) await this.run(out, ctx.i18n.t('safety.report.sent'));
    else { this.host.toast(ctx.i18n.t('safety.report.sent')); this.host.announce(ctx.i18n.t('safety.report.sent')); }
  }

  private sheetReportSend(): void {
    if (this.active?.kind !== 'report') return;
    this.active.sent = true;
    this.active.handle.close('sent');
  }

  // ---- the profile sheet (age, name, recovery code, bringing a profile back) -----------------------------------------------

  private sheetChanged(t: HTMLInputElement | HTMLSelectElement): boolean {
    const s = this.active;
    if (!s) return false;
    if (s.kind === 'profile' && t.name === 'age') {
      s.sheet.band = t.value as AgeBand;
      s.sheet.name = s.sheet.band === 'adult' ? '' : randomPresetName();
      s.handle.setHtml(profileSheet(this.host.context(), s.sheet));
      return true;
    }
    if (s.kind === 'report') {
      if (t.name === 'reason') s.state.reason = t.value as ReportReason;
      else if (t.name === 'alsoBlock') s.state.alsoBlock = (t as HTMLInputElement).checked;
      else return false;
      return true;
    }
    return false;
  }

  /** Asks the age and the name, shows the recovery code, and resolves true once the player has a profile (made or brought back). */
  openProfileSheet(start: 'age' | 'recover' = 'age'): Promise<boolean> {
    if (this.active) return Promise.resolve(false);
    const st = this.svc.social.state();
    if (st.noOnline) return Promise.resolve(false);
    const ctx = (): ViewContext => this.host.context();
    const sheet: ProfileSheet = { ...NEW_PROFILE_SHEET, step: start, persistent: st.persistent };
    const handle = openDialog({ document: this.host.document, html: profileSheet(ctx(), sheet), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet', dismissible: true });
    return new Promise<boolean>((resolve) => {
      const flow: NonNullable<SocialController['active']> = { kind: 'profile', handle, sheet, finish: (ok) => handle.close(ok ? 'created' : 'cancel') };
      this.active = flow;
      void handle.closed.then((result) => {
        if (this.active === flow) this.active = null;
        // The sheet was closed by Escape or a click outside after the profile was made: the profile is there, and the banner keeps the code until it is saved.
        const has = !!this.svc.social.state().profile;
        if (result === 'games') this.host.go(ctx().href('home'));
        resolve(has);
      });
    });
  }

  private draw(): void {
    const a = this.active;
    if (a?.kind === 'profile') a.handle.setHtml(profileSheet(this.host.context(), a.sheet));
  }

  private sheetStep(step: ProfileSheet['step']): void {
    const a = this.active;
    if (a?.kind !== 'profile') return;
    a.sheet.step = step;
    a.sheet.error = null;
    a.sheet.recoverField = null;
    this.draw();
  }

  private sheetAgeNext(): void {
    const a = this.active;
    if (a?.kind !== 'profile' || !a.sheet.band) return;
    if (a.sheet.band === 'child') {
      // Nothing is made and nothing is sent: the answer is remembered on this device and that is all.
      this.svc.social.declareTooYoung();
      a.sheet.step = 'young';
    } else {
      a.sheet.step = 'name';
      a.sheet.name = a.sheet.band === 'adult' ? '' : randomPresetName();
    }
    a.sheet.error = null;
    this.draw();
  }

  private sheetShuffle(): void {
    const a = this.active;
    if (a?.kind !== 'profile') return;
    a.sheet.name = randomPresetName();
    this.draw();
  }

  private async sheetCreate(): Promise<void> {
    const a = this.active;
    if (a?.kind !== 'profile' || !a.sheet.band || a.sheet.busy) return;
    const p = a.sheet;
    const ctx = this.host.context();
    const adult = p.band === 'adult';
    if (adult) {
      const n = checkName(p.name);
      if (!n.ok) { p.error = this.text({ ok: false, code: 'name_rejected', reason: n.reason }); this.draw(); return; }
      p.name = n.text;
    }
    p.busy = true;
    p.error = null;
    this.draw();
    const r = await this.svc.social.createProfile({ band: p.band as AgeBand, name: p.name });
    p.busy = false;
    if (!r.ok) { p.error = this.text(r); this.draw(); return; }
    // The hyphen of the code does not break the line (a toast on a small phone would cut BA- from the rest).
    const text = ctx.i18n.t('safety.name.created', { code: r.value.code.replace('-', '\u2011') });
    this.host.toast(text);
    this.host.announce(text);
    const after = this.svc.social.state();
    // Whether the browser keeps the profile is known for certain only now that the key was saved: the code screen says so if it does not.
    p.persistent = after.persistent;
    if (after.recovery) { p.step = 'recovery'; p.recovery = { friend: r.value.code, code: after.recovery }; this.draw(); } else a.finish(true);
  }

  private async sheetRecover(): Promise<void> {
    const a = this.active;
    if (a?.kind !== 'profile' || a.sheet.busy) return;
    const p = a.sheet;
    const ctx = this.host.context();
    const u = ux(ctx);
    p.error = null;
    p.recoverField = null;
    const chars = parseFriendLink(p.recoverCode) ?? parseFriendCode(p.recoverCode);
    if (!chars) { p.error = u('recover.badCode'); p.recoverField = 'code'; this.draw(); return; }
    p.busy = true;
    this.draw();
    const r = await this.svc.social.recoverProfile({ code: formatFriendCode(chars), recovery: p.recoverRecovery });
    p.busy = false;
    if (!r.ok) {
      p.error = r.code === 'conflict' ? u('recover.hasProfile') : this.text(r);
      if (r.code === 'bad_request' && (r.field === 'code' || r.field === 'recovery')) p.recoverField = r.field;
      this.draw();
      return;
    }
    const text = u('recover.welcome', { name: r.value.name });
    this.host.toast(text);
    this.host.announce(text);
    a.finish(true);
  }

  /** The recovery code again (the banner on the Friends page, or a new one from my profile): a sheet of its own. */
  private showRecovery(): void {
    const st = this.svc.social.state();
    if (!st.recovery || !st.profile || this.active) return;
    const ctx = this.host.context();
    const handle = openDialog({ document: this.host.document, html: recoverySheet(ctx, { friend: st.profile.code, code: st.recovery, persistent: st.persistent }), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet' });
    const flow = { kind: 'recovery' as const, handle };
    this.active = flow;
    void handle.closed.then(() => { if (this.active === flow) this.active = null; });
  }

  private async copyRecovery(): Promise<void> {
    const st = this.svc.social.state();
    const code = st.recovery;
    if (!code) return;
    const ok = await this.host.share(code, { link: false });
    if (ok) { const text = ux(this.host.context())('recovery.copied'); this.host.toast(text); this.host.announce(text); }
  }

  private downloadRecovery(): void {
    const st = this.svc.social.state();
    if (!st.recovery || !st.profile) return;
    const u = ux(this.host.context());
    this.save('bodyarcade-recovery.txt', u('recovery.file', { code: st.profile.code, recovery: formatRecoveryCode(st.recovery.replace(/-/g, '')) }), 'text/plain');
    this.host.toast(u('recovery.downloaded'));
  }

  /** A file for the player's own disk: the recovery code, the data export. Nothing is uploaded. */
  private save(name: string, text: string, type: string): void {
    const doc = this.host.document;
    const url = doc.defaultView?.URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    if (!url) return;
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => doc.defaultView?.URL.revokeObjectURL(url), 10_000);
  }

  // ---- my profile ----------------------------------------------------------------------------------------------------------

  private note(where: keyof SocialController['me']['notes'], n: Note | null): void {
    if (n) this.me.notes = { ...this.me.notes, [where]: n };
    else { const { [where]: _gone, ...rest } = this.me.notes; this.me.notes = rest; }
    this.host.rerender();
    if (n) this.host.announce(n.text);
  }

  private async busy<T>(what: string, fn: () => Promise<T>): Promise<T> {
    this.me.busy = what;
    this.host.rerender();
    try { return await fn(); } finally { this.me.busy = null; this.host.rerender(); }
  }

  private async rename(): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const typed = this.me.draft ?? this.svc.social.state().profile?.name ?? '';
    const n = checkName(typed);
    if (!n.ok) { this.note('name', { ok: false, text: this.text({ ok: false, code: 'name_rejected', reason: n.reason }) }); return; }
    if (n.text === this.svc.social.state().profile?.name) { this.note('name', null); return; }
    const r = await this.busy('name', () => this.svc.social.updateProfile({ name: n.text }));
    if (!r.ok) { this.note('name', { ok: false, text: this.text(r) }); return; }
    this.me.draft = null;
    this.note('name', { ok: true, text: u('me.renamed', { name: r.value.name }) });
  }

  private async reroll(): Promise<void> {
    const u = ux(this.host.context());
    const r = await this.busy('name', () => this.svc.social.updateProfile({ reroll: true }));
    this.note('name', r.ok ? { ok: true, text: u('me.renamed', { name: r.value.name }) } : { ok: false, text: this.text(r) });
  }

  private async savePrefs(t: HTMLInputElement | HTMLSelectElement): Promise<void> {
    const t18 = this.host.context().i18n;
    const change = t.name === 'dnd' ? { dnd: (t as HTMLInputElement).checked }
      : t.name === 'region' ? { region: t.value }
        : t.name === 'level' ? { level: LEVEL_OF_BAND[t.value as LevelBand] ?? 15 } : null;
    if (!change) return;
    const r = await this.busy('prefs', () => this.svc.social.updateProfile(change));
    this.note('prefs', r.ok ? { ok: true, text: t18.t('settings.saved') } : { ok: false, text: this.text(r) });
    if (r.ok && t.name === 'region') this.lobby = { ...this.lobby, region: null, list: null };
  }

  private async renewCode(): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const yes = await this.confirm({ title: u('me.codeRenewTitle'), body: u('me.codeRenewBody'), confirm: u('me.codeRenew'), cancel: ctx.i18n.t('common.cancel') });
    if (!yes) return;
    const r = await this.busy('code', () => this.svc.social.renewCode());
    this.note('code', r.ok ? { ok: true, text: u('me.codeRenewed', { code: r.value.code }) } : { ok: false, text: this.text(r) });
  }

  private async renewRecovery(): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const yes = await this.confirm({ title: u('me.recoveryRenewTitle'), body: u('me.recoveryRenewBody'), confirm: u('me.recoveryRenew'), cancel: ctx.i18n.t('common.cancel') });
    if (!yes) return;
    const r = await this.busy('recovery', () => this.svc.social.renewRecovery());
    if (!r.ok) { this.note('recovery', { ok: false, text: this.text(r) }); return; }
    this.note('recovery', null);
    this.showRecovery();
  }

  private async download(): Promise<void> {
    const u = ux(this.host.context());
    const r = await this.busy('data', () => this.svc.social.exportData());
    if (!r.ok) { this.note('data', { ok: false, text: this.text(r) }); return; }
    this.save('bodyarcade-data.json', JSON.stringify(r.value, null, 2), 'application/json');
    this.note('data', { ok: true, text: u('me.dataDownloaded') });
  }

  private async deleteProfile(): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const yes = await this.confirm({ title: u('me.dataDeleteTitle'), body: u('me.dataDeleteBody'), confirm: u('me.dataDelete'), cancel: ctx.i18n.t('common.cancel'), danger: true });
    if (!yes) return;
    const r = await this.busy('data', () => this.svc.social.deleteProfile());
    if (!r.ok) { this.note('data', { ok: false, text: this.text(r) }); return; }
    this.me = { draft: null, notes: {}, busy: null };
    this.host.toast(u('me.dataDeleted'));
    this.host.announce(u('me.dataDeleted'));
    this.host.go(ctx.href('friends'), { replace: true });
  }

  private async ageDown(): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const yes = await this.confirm({ title: u('me.ageDownTitle'), body: u('me.ageDownBody'), confirm: u('me.ageDown'), cancel: ctx.i18n.t('common.cancel'), danger: true });
    if (!yes) return;
    const r = await this.busy('age', () => this.svc.social.updateProfile({ band: 'teen' }));
    this.note('age', r.ok ? { ok: true, text: u('me.ageDownDone') } : { ok: false, text: this.text(r) });
  }

  /** Under 16 has no online profile: the profile is erased and the answer is kept on the device. */
  private async ageChild(): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const yes = await this.confirm({ title: u('me.ageChildTitle'), body: u('me.ageChildBody'), confirm: u('me.dataDelete'), cancel: ctx.i18n.t('common.cancel'), danger: true });
    if (!yes) return;
    const r = await this.busy('age', () => this.svc.social.deleteProfile());
    if (!r.ok) { this.note('age', { ok: false, text: this.text(r) }); return; }
    this.svc.social.declareTooYoung();
    this.me = { draft: null, notes: {}, busy: null };
    this.host.toast(u('me.dataDeleted'));
    this.host.go(ctx.href('friends'), { replace: true });
  }

  // ---- friend link ---------------------------------------------------------------------------------------------------

  private async sendFriendLink(): Promise<void> {
    const route = this.route;
    const chars = route ? (parseFriendLink(route.params['code'] ?? '') ?? parseFriendCode(route.params['code'] ?? '')) : null;
    const ctx = this.host.context();
    const u = ux(ctx);
    if (!chars || this.svc.social.state().noOnline) return;
    if (!this.svc.social.state().profile && !(await this.ensureProfile())) return;
    if (this.svc.social.state().profile?.code === formatFriendCode(chars)) { this.link = { busy: false, note: { ok: false, text: u('link.own') }, done: null }; this.host.rerender(); return; }
    this.link = { busy: true, note: null, done: null };
    this.host.rerender();
    // The address itself goes to the client, so the other player is told the request came from their link (and not from their code).
    const here = this.host.document.defaultView?.location.href ?? '';
    const r = await this.svc.social.addByCode(parseFriendLink(here) === chars ? here : formatFriendCode(chars));
    if (r.ok) {
      this.link = r.value.status === 'friends'
        ? { busy: false, done: 'friends', note: { ok: true, text: u('link.friends', { name: r.value.friend.name }) } }
        : { busy: false, done: 'sent', note: { ok: true, text: u('link.sent') } };
    } else if (r.code === 'not_found') this.link = { busy: false, done: null, note: { ok: false, text: u('link.stale') } };
    else this.link = { busy: false, done: null, note: { ok: false, text: this.text(r) } };
    this.host.rerender();
    this.host.announce(this.link.note?.text ?? '');
  }

  // ---- lobbies and quick match --------------------------------------------------------------------------------------

  private selectedGame(): ShellGame | null {
    const games = onlineGames(this.host.context());
    return games.find((g) => g.id === this.lobby.gameId) ?? games[0] ?? null;
  }

  private async loadLobbies(): Promise<void> {
    const game = this.selectedGame();
    const profile = this.svc.social.state().profile;
    if (!game || !profile?.can.publicPlay) return;
    const token = this.lobby.token;
    this.lobby.loading = true;
    const r = await this.svc.social.lobbies({ game: game.id, region: this.lobby.region ?? profile.region });
    if (token !== this.lobby.token) return;
    this.lobby = { ...this.lobby, list: r.ok ? r.value : [], failed: r.ok ? null : this.text(r), loading: false };
    this.host.rerender();
  }

  /** Stops a search that is running (the player said stop, left the page, or the room it opened has a player in it) and closes the room it opened. */
  private stopSearch(keepRoom = false): void {
    const ctl = this.lobby.abort;
    if (!ctl) { if (this.lobby.quick.phase !== 'idle') this.lobby = { ...this.lobby, quick: IDLE_QUICK }; return; }
    ctl.abort();
    this.lobby = { ...this.lobby, abort: null, quick: IDLE_QUICK, token: this.lobby.token + 1 };
    if (!keepRoom && this.lobby.quick.hosting) this.svc.rooms.leave();
  }

  private async quickMatch(): Promise<void> {
    const game = this.selectedGame();
    const profile = this.svc.social.state().profile;
    if (!game || !profile || this.lobby.abort) return;
    // The service matches by the level of the profile: the level chosen here becomes the player's usual level.
    const band = this.lobby.band ?? levelBand(profile.level);
    if (band !== levelBand(profile.level)) {
      const saved = await this.svc.social.updateProfile({ level: LEVEL_OF_BAND[band] });
      if (!saved.ok) { this.lobby = { ...this.lobby, quick: { ...IDLE_QUICK, note: this.text(saved) } }; this.host.rerender(); return; }
    }
    const ctl = new AbortController();
    const rooms = this.svc.rooms;
    const hosted: { code: string | null } = { code: null };
    this.lobby = { ...this.lobby, abort: ctl, ghostDismissed: false, quick: { phase: 'looking', hosting: false, waitedMs: 0, offerGhost: false, note: null } };
    this.host.rerender();
    // The search opens a public room when nobody is waiting; when another player takes a seat in it the search is over.
    const off = rooms.subscribe(() => {
      const s = rooms.state();
      if (hosted.code && s.info?.code === hosted.code && s.phase === 'lobby' && s.members.length >= 2) ctl.abort();
    });
    const driver: MatchDriver = {
      create: async (g, band) => {
        const r = await rooms.create({ game: g, kind: 'public', size: 4, band });
        if (!r.ok) throw new Error(r.code);
        hosted.code = r.value;
        return { code: r.value };
      },
      join: async (code) => {
        const r = await rooms.join(code);
        if (!r.ok) throw new Error(r.code);
      },
      leave: async () => { rooms.leave(); hosted.code = null; },
    };
    const onProgress = (p: MatchProgress): void => {
      if (this.lobby.abort !== ctl) return;
      // The service says when a ghost is due; the clock of the page says it too (a lobby that cannot be joined keeps the answers from saying it).
      this.lobby = { ...this.lobby, quick: { phase: 'looking', hosting: p.phase === 'hosting', waitedMs: p.waitedMs, offerGhost: (p.offerGhost || p.waitedMs >= GHOST_OFFER_AFTER_MS) && !this.lobby.ghostDismissed, note: null } };
      this.host.rerender();
    };
    const r = await this.svc.social.quickMatch({ game: game.id, driver, signal: ctl.signal, onProgress });
    off();
    if (this.lobby.abort !== ctl) { if (hosted.code && !this.keepsRoom(hosted.code)) rooms.leave(); return; }
    this.lobby = { ...this.lobby, abort: null };
    const t = this.host.context().i18n;
    if (!r.ok) {
      if (hosted.code) rooms.leave();
      // The search could not open a room because the game is a Pro game and the host has no proof: the window says so, not a line.
      const pro = rooms.proNeeded?.() ?? null;
      this.lobby = { ...this.lobby, quick: pro ? IDLE_QUICK : { ...IDLE_QUICK, note: this.text(r) } };
      this.host.rerender();
      if (pro) void this.openProSheet(pro);
      return;
    }
    const out = r.value;
    if (out.outcome === 'joined') {
      this.lobby = { ...this.lobby, quick: IDLE_QUICK };
      this.host.toast(ux(this.host.context())('lobby.quick.found'));
      this.host.announce(t.t('room.joining'));
      this.host.go(this.host.context().href('room', { params: { code: out.code } }));
      return;
    }
    const s = rooms.state();
    // Stopped because a player took a seat in the room the search opened: the match is that room.
    if (out.outcome === 'stopped' && hosted.code && s.info?.code === hosted.code && s.members.length >= 2) {
      this.lobby = { ...this.lobby, quick: IDLE_QUICK };
      this.host.toast(ux(this.host.context())('lobby.quick.found'));
      this.host.go(this.host.context().href('room', { params: { code: hosted.code } }));
      return;
    }
    if (hosted.code) rooms.leave();
    this.lobby = { ...this.lobby, quick: out.outcome === 'timeout' ? { ...IDLE_QUICK, phase: 'timeout', offerGhost: true } : IDLE_QUICK };
    this.host.rerender();
  }

  /** The room the search opened is kept when somebody sits in it. */
  private keepsRoom(code: string): boolean {
    const s = this.svc.rooms.state();
    return s.info?.code === code && s.members.length >= 2;
  }

  /** After twenty seconds of looking (or two minutes): a race against a practice ghost on the game's own stage. */
  private raceGhost(): void {
    const ctx = this.host.context();
    const game = this.selectedGame();
    this.stopSearch();
    if (!game) return;
    this.host.go(ctx.href('play', { params: { slug: game.seo.slug }, query: { ghost: 'practice' } }));
  }

  // ---- weekly boards -------------------------------------------------------------------------------------------------

  private async loadBoard(): Promise<void> {
    const ctx = this.host.context();
    const games = boardGames(ctx);
    const game = games.find((g) => g.id === this.boards.gameId) ?? games[0] ?? null;
    if (!game || !this.svc.social.state().profile) { this.host.rerender(); return; }
    const token = this.boards.token + 1;
    this.boards = { ...this.boards, gameId: game.id, loading: true, failed: false, board: null, token };
    this.host.rerender();
    const r = await this.svc.social.leaderboard({ game: game.id, scope: this.boards.scope, week: this.boards.week });
    if (token !== this.boards.token) return;
    this.boards = { ...this.boards, loading: false, failed: !r.ok, board: r.ok ? r.value : null };
    this.host.rerender();
  }

  /** A solo round begins: the server notes the time and signs a ticket (the weekly board counts only rounds it saw start). */
  async runBegan(game: ShellGame, solo: boolean): Promise<void> {
    this.round = null;
    // A round that starts with the page (a play address opened directly) begins before the profile is read: it waits for it.
    await this.opened;
    if (!solo || !isBoardGame(game.id) || !this.svc.social.state().profile) return;
    const r = await this.svc.social.startRun(game.id);
    if (r.ok) this.round = { ticket: r.value, game: game.id };
  }

  /** The round ended with a score: the server checks it and keeps the player's best of the week. A score that cannot count is said once. */
  async runEnded(game: ShellGame, score: number): Promise<void> {
    const run = this.round;
    this.round = null;
    if (!run || run.game !== game.id) return;
    const ctx = this.host.context();
    const u = ux(ctx);
    const r = await this.svc.social.finishRun(run.ticket, score);
    if (r.ok) {
      if (r.value.improved) this.host.toast(u('notice.scoreBest', { game: titleOf(ctx, game), score: ctx.i18n.number(score) }));
      return;
    }
    // A round that could not count (too fast, too high, too late) is told; a service that did not answer is not worth a line here.
    if (r.code === 'score_implausible' || r.code === 'run_too_short' || r.code === 'run_expired' || r.code === 'bad_run' || r.code === 'bad_score') this.host.toast(u('notice.scoreSkipped'), 'warn');
  }

  // ---- rooms -------------------------------------------------------------------------------------------------------

  private async newRoom(kind: 'private' | 'public' = 'private', band: LevelBand | null = null): Promise<string | null> {
    const game = this.selectedGame();
    if (!game) { this.host.toast(this.host.context().i18n.t('lobby.noGames'), 'warn'); return null; }
    if (!(await this.ensureProfile())) return null;
    const profile = this.svc.social.state().profile;
    const r = await this.svc.rooms.create({ game: game.id, kind, size: 4, band: kind === 'public' ? (band ?? this.lobby.band ?? (profile ? levelBand(profile.level) : 'medium')) : null });
    if (!r.ok) { this.roomFailed(r.code); return null; }
    this.room.joining = r.value;
    this.room.invited = [];
    this.host.go(this.host.context().href('room', { params: { code: r.value } }));
    return r.value;
  }

  /** Asks a friend into the room the player is in (a new room when there is none yet). A friend who is not online gets nothing: the link is the way. */
  private async inviteFriend(fid: string): Promise<void> {
    const ctx = this.host.context();
    const u = ux(ctx);
    const name = this.svc.social.state().friends.find((f) => f.fid === fid)?.name ?? '';
    let code = this.svc.rooms.state().info?.code ?? null;
    if (!code) code = await this.newRoom();
    if (!code) return;
    // The room has to know the player is in it before the invitation can be sent: a few tries while it opens.
    let r = await this.svc.social.invite(fid, code);
    for (let i = 0; i < 4 && !r.ok && r.code === 'not_in_room'; i++) {
      await sleep(700);
      r = await this.svc.social.invite(fid, code);
    }
    if (!r.ok) {
      this.host.toast(r.code === 'offline' ? u('invite.share', { name }) : r.code === 'not_in_room' ? u('invite.tryAgain') : this.text(r, { name }), 'warn');
      return;
    }
    if (!this.room.invited.includes(fid)) this.room.invited = [...this.room.invited, fid];
    this.host.toast(u('invite.sent', { name }));
    this.host.announce(u('invite.sent', { name }));
    this.changed();
  }

  private async copyRoom(what: string): Promise<void> {
    const room = this.svc.rooms.state();
    const code = room.info?.code;
    if (!code) return;
    const t = this.host.context().i18n;
    const link = what === 'link';
    const ok = await this.host.share(link ? room.link : code, { link });
    if (ok) { const text = link ? t.t('room.linkCopied') : t.t('room.codeCopied'); this.host.toast(text); this.host.announce(text); }
  }

  private openQr(): void {
    const room = this.svc.rooms.state();
    if (!room.link) return;
    const ctx = this.host.context();
    openDialog({ document: this.host.document, html: qrSheet(ctx, room.link), labelledBy: 'sheet-h', className: 'ba-modal--sheet' });
  }

  private remind(seat: string): void {
    const m = this.svc.rooms.state().members.find((x) => x.seat === seat);
    if (!m) return;
    this.svc.rooms.remind(seat);
    const text = this.host.context().i18n.t('room.reminded', { name: m.name });
    this.host.toast(text);
  }

  private async chooseGame(): Promise<void> {
    const ctx = this.host.context();
    const room = this.svc.rooms.state();
    const games = onlineGames(ctx);
    const d = openDialog({ document: this.host.document, html: gameSheet(ctx, games, room.info?.config.gameId ?? ''), labelledBy: 'sheet-h', className: 'ba-modal--sheet' });
    const pick = await d.closed;
    if (typeof pick !== 'string' || !games.some((g) => g.id === pick)) return;
    // A player without Pro cannot start a Pro game in a room (the Room would refuse it too): the window says so without asking it.
    if (isProGame(pick) && !hasPro(ctx)) { void this.openProSheet({ game: pick, reason: 'none', at: Date.now() }); return; }
    this.svc.rooms.chooseGame(pick);
  }

  /** A room could not be made: a Pro game that the host has no proof for gets its window, anything else a line. */
  private roomFailed(code: string): void {
    const pro = this.svc.rooms.proNeeded?.() ?? null;
    if (pro) void this.openProSheet(pro); else this.host.toast(this.roomProblem(code), 'warn');
  }

  /** A Pro game was refused to the host: the window says why and offers the Pro page. The refusal is spent once it has been said. */
  private async openProSheet(p: ProNeeded): Promise<void> {
    const ctx = this.host.context();
    const game = ctx.games.find((g) => g.id === p.game) ?? null;
    const d = openDialog({ document: this.host.document, html: proSheet(ctx, { game, reason: p.reason }), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet' });
    const pick = await d.closed;
    this.svc.rooms.dismissProNeeded?.();
    if (pick === 'see') this.host.go(ctx.href('pro', game ? { query: { game: game.id } } : {}));
  }

  /** The menu of a player in a seat: report them (the Room files what it saw) or block them for this device. */
  private async seatMenu(seat: string): Promise<void> {
    const rooms = this.svc.rooms;
    const m = rooms.state().members.find((x) => x.seat === seat);
    if (!m) return;
    const ctx = this.host.context();
    const d = openDialog({ document: this.host.document, html: seatMenuSheet(ctx, { seat, name: m.name }), labelledBy: 'sheet-h', className: 'ba-modal--sheet' });
    const pick = await d.closed;
    if (pick === 'report') await this.reportFlow({ fid: seat, name: m.name }, (r) => { rooms.reportSeat?.(seat, r.reason, r.alsoBlock); });
    else if (pick === 'block') {
      await this.blockFlow(seat, m.name, async () => { rooms.blockSeat?.(seat); return { ok: true }; });
    }
  }

  private sendText(value: FormDataEntryValue | null): void {
    const t = this.host.context().i18n;
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    const check = checkChat(text);
    if (!check.ok) {
      this.room.chatNote = t.t('room.chat.rejected');
      this.host.rerender();
      return;
    }
    const sent = this.svc.rooms.sendText(check.text);
    this.room = sent.ok ? { ...this.room, draft: '', chatNote: '' } : { ...this.room, chatNote: sent.reason === 'rate' ? t.t('room.chat.rate') : sent.reason === 'muted' ? t.t('room.chat.muted') : t.t('room.chat.rejected') };
    this.host.rerender();
  }

  /** The way into a race from a game's page: a private room for two, then the room page where the friend is asked in. */
  private async newRace(gameId: string): Promise<void> {
    const t = this.host.context().i18n;
    const g = this.host.context().games.find((x) => x.id === gameId);
    if (!g || !g.modes.includes('duel')) return;
    if (!(await this.ensureProfile())) return;
    const r = await this.svc.rooms.create({ game: g.id, kind: 'private', size: 2, band: null, durationMs: this.host.raceMs?.(g) ?? raceMs(g) });
    if (!r.ok) { this.roomFailed(r.code); return; }
    this.room.joining = r.value;
    this.room.invited = [];
    this.host.announce(t.t('room.created'));
    this.host.go(this.host.context().href('room', { params: { code: r.value } }));
  }

  /** Getting ready is calibrating the camera on the stage first; undoing it is only a flag. */
  private ready(on: boolean): void {
    if (!on) { this.svc.rooms.setReady(false); return; }
    this.toStage();
  }

  /** To the stage of the race in this room (the game of the room, its camera and its calibration). */
  private toStage(): void {
    const ctx = this.host.context();
    const info = this.svc.rooms.state().info;
    const g = info ? ctx.games.find((x) => x.id === info.config.gameId) : undefined;
    if (!info || !g) return;
    this.host.go(ctx.href('play', { params: { slug: g.seo.slug }, query: { room: info.code } }));
  }

  private confirm(o: ConfirmOptions): Promise<boolean> {
    const d = openDialog({ document: this.host.document, html: confirmHtml(o), labelledBy: 'confirm-title', describedBy: 'confirm-body' });
    return d.closed.then((r) => r === 'yes');
  }
}

