// What the player does on the Friends screens: the profile and its age question, friend codes and requests, the friend
// menu with report and block, public lobbies and quick match, and a room (ready check, messages, camera switch).
// The views draw from the ports' state; this class holds the little that is only the screen's (what is typed, which game
// is picked, which sheet is open) and turns clicks into port calls. Nothing here knows a server.
import { openDialog, type DialogHandle } from '../../../core/ui/dialog.ts';
import type { Matched } from '../../../core/ui/router.ts';
import { codeFromInvite, isRoomCode } from '../../../core/net/codes.ts';
import { checkChat, checkName } from '../../../core/net/chat-filter.ts';
import { formatFriendCode, parseFriendCode, parseFriendLink } from '../../../core/social/codes.ts';
import { isPresetMessage, isReaction, randomPresetName } from '../../../core/social/presets.ts';
import type { AgeBand, LevelBand, LobbyEntry, Region, ReportReason } from '../../../core/social/types.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { ViewContext } from '../context.ts';
import type { RouteId } from '../routes.ts';
import type { SocialFailure, SocialServices } from '../social/port.ts';
import {
  blockSheet, friendMenuSheet, gameSheet, onlineGames, profileSheet, qrSheet, reportSheet,
  type FriendLinkView, type FriendsView, type LobbiesView, type ProfileSheet, type ReportSheet, type RoomView,
} from '../views/social.ts';
import { confirmHtml, type ConfirmOptions } from '../views/misc.ts';

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
}

/** What renderPage needs for the social routes. */
export interface SocialPageState {
  friends: FriendsView;
  lobbies: LobbiesView;
  room: RoomView;
  friendLink: FriendLinkView;
}

export const SOCIAL_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['friends', 'lobbies', 'room', 'friendlink', 'safety']);

const BAND_OF_AGE: Record<AgeBand, LevelBand> = { child: 'easy', teen: 'easy', adult: 'medium' };

export class SocialController {
  private readonly host: SocialHost;
  private readonly svc: SocialServices;
  private readonly cleanups: (() => void)[] = [];
  private active = false;
  private route: Matched<RouteId> | null = null;
  private redrawTimer: ReturnType<typeof setTimeout> | null = null;

  private add = { value: '', busy: false, note: null as { ok: boolean; text: string } | null };
  private lobby: { gameId: string | null; band: LevelBand | null; region: Region; list: readonly LobbyEntry[] | null; failed: boolean; search: 'idle' | 'looking' | 'waiting'; token: number } =
    { gameId: null, band: null, region: 'eu', list: null, failed: false, search: 'idle', token: 0 };
  private room = { draft: '', chatNote: '', joining: '' };
  private link = { busy: false, note: null as { ok: boolean; text: string } | null };
  private sheet: { handle: DialogHandle; render(): void } | null = null;

  constructor(host: SocialHost, svc: SocialServices) {
    this.host = host;
    this.svc = svc;
  }

  start(): void {
    this.cleanups.push(this.svc.social.subscribe(() => this.changed()), this.svc.rooms.subscribe(() => this.changed()));
  }

  stop(): void {
    for (const c of this.cleanups.splice(0)) c();
    if (this.redrawTimer) clearTimeout(this.redrawTimer);
    this.sheet?.handle.close('cancel');
    this.svc.rooms.leave();
    this.svc.social.close();
  }

  // ---- routes --------------------------------------------------------------------------------------------------------

  /** A page of the social area is about to be drawn (or another page, with `route` null or outside the area). */
  enter(route: Matched<RouteId> | null): void {
    const was = this.route;
    this.route = route && SOCIAL_ROUTES.has(route.id) ? route : null;
    this.sheet?.handle.close('cancel');
    if (!this.route) {
      if (this.active) { this.active = false; this.svc.rooms.leave(); this.svc.social.close(); }
      return;
    }
    if (!this.active) { this.active = true; void this.svc.social.open(); }
    if (was?.id === 'room' && (this.route.id !== 'room' || was.params['code'] !== this.route.params['code'])) this.svc.rooms.leave();
    if (this.route.id === 'lobbies') void this.loadLobbies();
    if (this.route.id === 'room') void this.enterRoom(this.route.params['code'] ?? '');
  }

  private async enterRoom(raw: string): Promise<void> {
    const code = codeFromInvite(raw);
    const rooms = this.svc.rooms;
    if (!code || !isRoomCode(code)) return;
    if (rooms.state().info?.code === code && rooms.state().phase !== 'closed') return;
    if (this.room.joining === code) return;
    this.room.joining = code;
    try {
      // A profile is needed before any room: the age question is asked once, here at the latest.
      if (!this.svc.social.state().profile) {
        const made = await this.openProfileSheet();
        if (!made) { this.host.go(this.host.context().href('friends'), { replace: true }); return; }
      }
      if (this.route?.id !== 'room') return;
      const r = await rooms.join(code);
      if (!r.ok) this.host.toast(this.failure(r.code), 'warn');
    } finally {
      this.room.joining = '';
      this.changed();
    }
  }

  // ---- what the pages draw -----------------------------------------------------------------------------------------

  pageState(route: Matched<RouteId> | null): SocialPageState {
    const ctx = this.host.context();
    const state = this.svc.social.state();
    const games = onlineGames(ctx);
    const l = this.lobby;
    const game = games.find((g) => g.id === l.gameId) ?? games[0] ?? null;
    const profile = state.profile;
    const band = l.band ?? (profile ? BAND_OF_AGE[profile.band] : 'medium');
    const room = this.svc.rooms.state();
    const info = room.info;
    const code = route?.id === 'friendlink' ? (parseFriendLink(route.params['code'] ?? '') ?? parseFriendCode(route.params['code'] ?? '')) : null;
    return {
      friends: { state, add: this.add },
      lobbies: { state, games, game, band, region: profile?.region ?? l.region, list: l.list, failed: l.failed, search: l.search },
      room: { room, game: info ? (ctx.games.find((g) => g.id === info.config.gameId) ?? null) : null, profile, games, draft: this.room.draft, chatNote: this.room.chatNote },
      friendLink: { code: code ? formatFriendCode(code) : null, profile: !!profile, busy: this.link.busy, note: this.link.note },
    };
  }

  /** Something in a port changed: draw again once, soon, without losing what is typed. */
  private changed(): void {
    if (!this.route || this.redrawTimer) return;
    this.redrawTimer = setTimeout(() => { this.redrawTimer = null; if (this.route) this.host.rerender(); }, 40);
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  click(action: string, el: HTMLElement): boolean {
    const d = el.dataset;
    switch (action) {
      case 'social.profile': void this.openProfileSheet(); return true;
      case 'social.retry': void this.svc.social.open(); return true;
      case 'social.copy': void this.copyOwn(d['what'] ?? ''); return true;
      case 'social.accept': void this.answer(d['fid'] ?? '', true); return true;
      case 'social.decline': void this.answer(d['fid'] ?? '', false); return true;
      case 'social.cancel': void this.run(this.svc.social.cancelRequest(d['fid'] ?? '')); return true;
      case 'social.invite': void this.inviteFriend(d['fid'] ?? ''); return true;
      case 'social.menu': void this.friendMenu(d['fid'] ?? ''); return true;
      case 'social.unblock': void this.unblock(d['fid'] ?? ''); return true;
      case 'friendlink.send': void this.sendFriendLink(); return true;
      case 'room.new': void this.newRoom(); return true;
      case 'lobby.game': this.lobby = { ...this.lobby, gameId: d['game'] ?? null, list: null, failed: false, search: 'idle', token: this.lobby.token + 1 }; this.host.rerender(); void this.loadLobbies(); return true;
      case 'lobby.quick': void this.quickMatch(); return true;
      case 'lobby.stop': this.lobby = { ...this.lobby, search: 'idle', token: this.lobby.token + 1 }; this.host.rerender(); return true;
      case 'lobby.join': this.host.go(this.host.context().href('room', { params: { code: d['code'] ?? '' } })); return true;
      case 'lobby.start': void this.newRoom('public'); return true;
      case 'room.leave': this.svc.rooms.leave(); this.host.go(this.host.context().href('friends'), { replace: true }); return true;
      case 'room.copy': void this.copyRoom(d['what'] ?? ''); return true;
      case 'room.qr': this.openQr(); return true;
      case 'room.ready': this.svc.rooms.setReady(d['ready'] === '1'); return true;
      case 'room.start': this.svc.rooms.start(); return true;
      case 'room.remind': this.remind(d['seat'] ?? ''); return true;
      case 'room.say': if (isPresetMessage(d['id'])) this.svc.rooms.say(d['id']); return true;
      case 'room.react': if (isReaction(d['id'])) this.svc.rooms.react(d['id']); return true;
      case 'room.game': void this.chooseGame(); return true;
      case 'sheet.age.next': this.sheetAgeNext(); return true;
      case 'sheet.name.shuffle': this.sheetShuffle(); return true;
      case 'sheet.name.back': this.sheetBack(); return true;
      case 'sheet.name.create': void this.sheetCreate(); return true;
      case 'sheet.report.send': this.sheetReportSend(); return true;
      default: return false;
    }
  }

  submit(form: HTMLFormElement): boolean {
    const kind = form.dataset['form'];
    if (kind === 'friend-add') { void this.addFriend(); return true; }
    if (kind === 'room-say') { this.sendText(new FormData(form).get('text')); return true; }
    if (kind === 'lobby') return true;
    return false;
  }

  /** A choice changed on a social page or in a sheet; true when it was one of ours. */
  change(t: HTMLInputElement | HTMLSelectElement): boolean {
    const form = t.closest<HTMLElement>('[data-form]');
    const kind = form?.dataset['form'];
    if (kind === 'lobby' && t.name === 'band') {
      this.lobby = { ...this.lobby, band: t.value as LevelBand, list: null, token: this.lobby.token + 1 };
      void this.loadLobbies();
      return true;
    }
    if (kind === 'room-share' && t.name === 'share') { this.svc.rooms.setShareVideo((t as HTMLInputElement).checked); return true; }
    if (this.sheetState && t.closest('dialog')) return this.sheetChanged(t);
    return false;
  }

  input(t: HTMLInputElement): boolean {
    if (t.name === 'code' && t.closest('[data-form="friend-add"]')) { this.add = { ...this.add, value: t.value, note: null }; return true; }
    if (t.name === 'text' && t.closest('[data-form="room-say"]')) { this.room.draft = t.value; return true; }
    if (t.name === 'name' && t.closest('dialog') && this.sheetState?.kind === 'profile') { this.sheetState.profile.name = t.value; return true; }
    return false;
  }

  // ---- friends -----------------------------------------------------------------------------------------------------

  private failure(code: SocialFailure | string): string {
    const t = this.host.context().i18n;
    switch (code) {
      case 'self': return t.t('social.add.self');
      case 'already_friends': return t.t('social.add.already');
      case 'friends_full': return t.t('social.add.full');
      case 'requests_full': return t.t('social.add.requestsFull');
      case 'not_found': return t.t('social.add.unknown');
      case 'you_blocked': return t.t('social.add.blocked');
      case 'rate_limited': case 'too_many_attempts': return t.t('social.add.wait');
      case 'network': case 'offline': case 'unavailable': return t.t('social.add.offline');
      case 'name_rejected': return t.t('safety.name.rejected');
      case 'full': return t.t('room.problem.full');
      case 'no_room': return t.t('room.problem.no_room');
      default: return t.t('social.add.failed');
    }
  }

  private async run(p: Promise<{ ok: boolean; code?: SocialFailure }>, done?: string): Promise<boolean> {
    const r = await p;
    if (!r.ok) { this.host.toast(this.failure(r.code ?? 'failed'), 'warn'); return false; }
    if (done) { this.host.toast(done); this.host.announce(done); }
    return true;
  }

  private async addFriend(): Promise<void> {
    const t = this.host.context().i18n;
    const chars = parseFriendLink(this.add.value) ?? parseFriendCode(this.add.value);
    if (!chars) { this.add = { ...this.add, note: { ok: false, text: t.t('social.add.bad') } }; this.host.rerender(); return; }
    if (!this.svc.social.state().profile) { if (!(await this.openProfileSheet())) return; }
    this.add = { ...this.add, busy: true, note: null };
    this.host.rerender();
    const r = await this.svc.social.addByCode(formatFriendCode(chars));
    if (r.ok) {
      const v = r.value;
      const text = v.status === 'friends' ? t.t('social.add.friends', { name: v.friend.name }) : t.t('social.add.sent');
      this.add = { value: '', busy: false, note: { ok: true, text } };
    } else this.add = { ...this.add, busy: false, note: { ok: false, text: this.failure(r.code) } };
    this.host.rerender();
    this.host.announce(this.add.note?.text ?? '');
  }

  private async answer(fid: string, accept: boolean): Promise<void> {
    const t = this.host.context().i18n;
    const who = this.svc.social.state().requests.incoming.find((r) => r.fid === fid)?.name ?? '';
    await this.run(this.svc.social.answer(fid, accept), accept ? t.t('social.req.accepted', { name: who }) : undefined);
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
    } else if (pick === 'block') await this.blockFlow(fid, f.name);
    else if (pick === 'report') await this.reportFlow(fid, f.name);
  }

  private async blockFlow(fid: string, name: string): Promise<void> {
    const ctx = this.host.context();
    const d = openDialog({ document: this.host.document, html: blockSheet(ctx, { fid, name }), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet' });
    if ((await d.closed) !== 'yes') return;
    await this.run(this.svc.social.block(fid), ctx.i18n.t('safety.block.done', { name }));
  }

  private async unblock(fid: string): Promise<void> {
    const name = this.svc.social.state().blocks.find((b) => b.fid === fid)?.name ?? '';
    await this.run(this.svc.social.unblock(fid), this.host.context().i18n.t('safety.blocked.done', { name }));
  }

  private async reportFlow(fid: string, name: string): Promise<void> {
    const ctx = this.host.context();
    const state: ReportSheet = { reason: 'abuse', alsoBlock: true, details: '' };
    const handle = openDialog({ document: this.host.document, html: reportSheet(ctx, { fid, name }, state), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet' });
    this.sheetState = { kind: 'report', report: state, who: { fid, name } };
    this.sheet = { handle, render: () => undefined };
    const r = await handle.closed;
    this.sheet = null;
    const sent = this.sheetState && this.sheetState.kind === 'report' ? this.sheetState.sent : false;
    this.sheetState = null;
    if (r !== 'sent' || !sent) return;
    await this.run(this.svc.social.report({ fid, reason: state.reason, details: state.details.trim(), alsoBlock: state.alsoBlock }), ctx.i18n.t('safety.report.sent'));
  }

  private sheetReportSend(): void {
    if (this.sheetState?.kind !== 'report') return;
    this.sheetState.sent = true;
    this.sheet?.handle.close('sent');
  }

  // ---- the profile sheet (age, then name) -----------------------------------------------------------------------------

  private sheetState: ({ kind: 'profile'; profile: ProfileSheet; done: (ok: boolean) => void } | { kind: 'report'; report: ReportSheet; who: { fid: string; name: string }; sent?: boolean }) | null = null;

  private sheetChanged(t: HTMLInputElement | HTMLSelectElement): boolean {
    const s = this.sheetState;
    if (!s) return false;
    if (s.kind === 'profile' && t.name === 'age') {
      s.profile.band = t.value as AgeBand;
      s.profile.name = s.profile.band === 'adult' ? '' : randomPresetName();
      this.sheet?.render();
      return true;
    }
    if (s.kind === 'report') {
      if (t.name === 'reason') s.report.reason = t.value as ReportReason;
      else if (t.name === 'alsoBlock') s.report.alsoBlock = (t as HTMLInputElement).checked;
      else return false;
      return true;
    }
    return false;
  }

  /** Asks the age and the name; resolves true once the profile exists. */
  openProfileSheet(): Promise<boolean> {
    if (this.sheetState?.kind === 'profile') return Promise.resolve(false);
    const ctx = (): ViewContext => this.host.context();
    const profile: ProfileSheet = { step: 'age', band: null, name: '', error: null, busy: false };
    const handle = openDialog({ document: this.host.document, html: profileSheet(ctx(), profile), labelledBy: 'sheet-h', describedBy: 'sheet-d', className: 'ba-modal--sheet', dismissible: true });
    return new Promise<boolean>((resolve) => {
      let created = false;
      this.sheetState = { kind: 'profile', profile, done: (ok) => { created = ok; handle.close(ok ? 'created' : 'cancel'); } };
      this.sheet = { handle, render: () => handle.setHtml(profileSheet(ctx(), profile)) };
      void handle.closed.then(() => { this.sheet = null; this.sheetState = null; resolve(created); });
    });
  }

  private sheetAgeNext(): void {
    const s = this.sheetState;
    if (s?.kind !== 'profile' || !s.profile.band) return;
    s.profile.step = 'name';
    s.profile.name = s.profile.band === 'adult' ? '' : randomPresetName();
    s.profile.error = null;
    this.sheet?.render();
  }

  private sheetShuffle(): void {
    const s = this.sheetState;
    if (s?.kind !== 'profile') return;
    s.profile.name = randomPresetName();
    this.sheet?.render();
  }

  private sheetBack(): void {
    const s = this.sheetState;
    if (s?.kind !== 'profile') return;
    s.profile.step = 'age';
    s.profile.error = null;
    this.sheet?.render();
  }

  private async sheetCreate(): Promise<void> {
    const s = this.sheetState;
    if (s?.kind !== 'profile' || !s.profile.band || s.profile.busy) return;
    const p = s.profile;
    const adult = p.band === 'adult';
    if (adult) {
      const n = checkName(p.name);
      if (!n.ok) { p.error = 'rejected'; this.sheet?.render(); return; }
      p.name = n.text;
    }
    p.busy = true;
    p.error = null;
    this.sheet?.render();
    const r = await this.svc.social.createProfile({ band: p.band as AgeBand, name: adult ? p.name : null });
    p.busy = false;
    if (!r.ok) { p.error = r.code === 'name_rejected' ? 'rejected' : 'failed'; this.sheet?.render(); return; }
    const text = this.host.context().i18n.t('safety.name.created', { code: r.value.code });
    this.host.toast(text);
    this.host.announce(text);
    s.done(true);
  }

  // ---- friend link -------------------------------------------------------------------------------------------------

  private async sendFriendLink(): Promise<void> {
    const route = this.route;
    const chars = route ? (parseFriendLink(route.params['code'] ?? '') ?? parseFriendCode(route.params['code'] ?? '')) : null;
    const t = this.host.context().i18n;
    if (!chars) return;
    this.link = { busy: true, note: null };
    this.host.rerender();
    const r = await this.svc.social.addByCode(formatFriendCode(chars));
    this.link = r.ok
      ? { busy: false, note: { ok: true, text: r.value.status === 'friends' ? t.t('social.add.friends', { name: r.value.friend.name }) : t.t('social.add.sent') } }
      : { busy: false, note: { ok: false, text: this.failure(r.code) } };
    this.host.rerender();
    this.host.announce(this.link.note?.text ?? '');
  }

  // ---- lobbies -----------------------------------------------------------------------------------------------------

  private selectedGame(): ShellGame | null {
    const games = onlineGames(this.host.context());
    return games.find((g) => g.id === this.lobby.gameId) ?? games[0] ?? null;
  }

  private async loadLobbies(): Promise<void> {
    const game = this.selectedGame();
    const profile = this.svc.social.state().profile;
    if (!game || !profile?.can.publicPlay) return;
    const token = this.lobby.token;
    const r = await this.svc.social.lobbies({ game: game.id, region: profile.region });
    if (token !== this.lobby.token) return;
    this.lobby = { ...this.lobby, list: r.ok ? r.value : [], failed: !r.ok };
    this.host.rerender();
  }

  private async quickMatch(): Promise<void> {
    const game = this.selectedGame();
    const profile = this.svc.social.state().profile;
    if (!game || !profile) return;
    const band = this.lobby.band ?? BAND_OF_AGE[profile.band];
    const token = this.lobby.token + 1;
    this.lobby = { ...this.lobby, search: 'looking', token };
    this.host.rerender();
    for (let waited = 0; token === this.lobby.token && waited < 120_000; waited += 4000) {
      const r = await this.svc.social.quickMatch({ game: game.id, band });
      if (token !== this.lobby.token) return;
      if (!r.ok) { this.lobby = { ...this.lobby, search: 'idle' }; this.host.rerender(); this.host.toast(this.failure(r.code), 'warn'); return; }
      const a = r.value;
      if (a.action === 'join' || a.action === 'merge') { this.lobby = { ...this.lobby, search: 'idle', token: token + 1 }; this.host.go(this.host.context().href('room', { params: { code: a.code } })); return; }
      if (a.action === 'create') { this.lobby = { ...this.lobby, search: 'idle', token: token + 1 }; await this.newRoom('public', band); return; }
      this.lobby = { ...this.lobby, search: 'waiting' };
      this.host.rerender();
      await new Promise((ok) => setTimeout(ok, 4000));
    }
    if (token === this.lobby.token) { this.lobby = { ...this.lobby, search: 'idle' }; this.host.rerender(); }
  }

  // ---- rooms -------------------------------------------------------------------------------------------------------

  private async newRoom(kind: 'private' | 'public' = 'private', band: LevelBand | null = null): Promise<string | null> {
    const game = this.selectedGame();
    if (!game) { this.host.toast(this.host.context().i18n.t('lobby.noGames'), 'warn'); return null; }
    if (!this.svc.social.state().profile && !(await this.openProfileSheet())) return null;
    const profile = this.svc.social.state().profile;
    const r = await this.svc.rooms.create({ game: game.id, kind, size: 4, band: kind === 'public' ? (band ?? this.lobby.band ?? (profile ? BAND_OF_AGE[profile.band] : 'medium')) : null });
    if (!r.ok) { this.host.toast(this.failure(r.code), 'warn'); return null; }
    this.room.joining = r.value;
    this.host.go(this.host.context().href('room', { params: { code: r.value } }));
    return r.value;
  }

  private async inviteFriend(fid: string): Promise<void> {
    const t = this.host.context().i18n;
    const name = this.svc.social.state().friends.find((f) => f.fid === fid)?.name ?? '';
    let code = this.svc.rooms.state().info?.code ?? null;
    if (!code) code = await this.newRoom();
    if (!code) return;
    const ok = await this.run(this.svc.social.invite(fid, code), t.t('social.friend.invited', { name }));
    void ok;
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
    if (typeof pick === 'string' && games.some((g) => g.id === pick)) this.svc.rooms.chooseGame(pick);
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

  private confirm(o: ConfirmOptions): Promise<boolean> {
    const d = openDialog({ document: this.host.document, html: confirmHtml(o), labelledBy: 'confirm-title', describedBy: 'confirm-body' });
    return d.closed.then((r) => r === 'yes');
  }

}
