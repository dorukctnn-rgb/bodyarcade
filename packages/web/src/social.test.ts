// The Friends screens, drawn from the practice ports in both complete languages: every string exists, the names of other
// players are escaped, each state of a screen says what it should, and the controls have names. No browser: views are
// functions of the context and the state.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import type { BoardView, LobbyEntry } from '../../core/social/types.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { titleOf } from './context.ts';
import { createDemoSocial, DEMO_SOCIAL_MODES, type DemoSocialMode } from './app/demo-social.ts';
import { makeContext } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import { NO_ROOM_STATE, type PendingInvite, type RoomState, type SocialState } from './social/port.ts';
import { ux } from './social/strings.ts';
import {
  avatarLook, blockSheet, boardsMain, boardsPage, clockText, friendLinkPage, friendMenuSheet, friendsMain, friendsPage, gameSheet, IDLE_QUICK, inviteTray, lobbiesPage, NEW_PROFILE_SHEET,
  NO_LINK_VIEW, NO_PROFILE_VIEW, NO_ROOM_VIEW, onlineGames, proSheet, profileMain, profilePage, profileSheet, qrSheet, recoverySheet, reportSheet, roomPage, safetyPage, seatMenuSheet, socialPage,
  type BoardsView, type FriendLinkView, type LobbiesView, type ProfileSheet, type ProfileView, type RoomView,
} from './views/social.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];

function ctxOf(lang: Lang, url = '/friends/') {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, flags: { social: true }, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) } });
  return { ctx, missing };
}

async function ready(mode: DemoSocialMode = 'ready'): Promise<{ state: () => SocialState; svc: ReturnType<typeof createDemoSocial> }> {
  const svc = createDemoSocial({ mode, roomCode: 'K7Q2MX' });
  await svc.social.open();
  return { state: () => svc.social.state(), svc };
}

const ids = (html: string): string[] => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
const NO_LEAK = /undefined|\[object|NaN|\{[a-z]+\}/;
const add = { value: '', busy: false, note: null };
const sheet = (over: Partial<ProfileSheet> = {}): ProfileSheet => ({ ...NEW_PROFILE_SHEET, ...over });

describe.each(LANGS)('friends screens in %s', (lang) => {
  it('the friends page shows the profile, the code, a real QR code, requests and friends with their presence', async () => {
    const { ctx, missing } = ctxOf(lang);
    const { state } = await ready();
    const html = friendsPage(ctx, { state: state(), add }).value;
    const text = textOf(html);
    expect(missing).toEqual([]);
    expect(text).not.toMatch(NO_LEAK);
    for (const s of ['BA-7K2Q4X', 'Doruk', 'Mert', 'Ayşe', 'Can', 'Selin', 'Elif']) expect(text, s).toContain(s);
    expect(html).toContain('data-action="social.accept"');
    expect(html).toContain('data-action="social.decline"');
    expect(html).toMatch(/<svg[^>]+role="img"[^>]+shape-rendering="crispEdges"/);
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    const all = ids(html);
    expect(new Set(all).size).toBe(all.length);
    // The friend who is playing says which game; the offline ones say so.
    expect(text).toContain(lang === 'en' ? 'Playing Star Catch' : 'Star Catch oynuyor');
    expect(text).toContain(lang === 'en' ? 'Offline' : 'Çevrimdışı');
    // the way to my profile and the weekly boards, and how full the list is
    expect(html).toContain('/friends/?view=profile');
    expect(html).toContain('/friends/?view=boards');
    expect(text).toContain(lang === 'en' ? '4 of 100' : '100 içinde 4');
  });

  it('a friend who sits in a room with a free seat can be joined; one who is online and not in a room can be invited; an offline one neither', async () => {
    const { ctx } = ctxOf(lang);
    const { state } = await ready();
    const html = friendsPage(ctx, { state: state(), add }).value;
    const row = (name: string): string => html.split('<li data-friend=').find((r) => r.includes(`<b>${name}</b>`)) ?? '';
    expect(row('Selin')).toContain('data-action="social.join" data-room="SELN22"');
    expect(row('Selin')).not.toContain('data-action="social.invite"');
    expect(row('Mert')).toContain('data-action="social.invite"');
    expect(row('Can')).not.toContain('data-action="social.invite"');
    expect(row('Can')).not.toContain('data-action="social.join"');
  });

  it('names from other players are escaped, never markup', async () => {
    const { ctx } = ctxOf(lang);
    const { state } = await ready();
    const evil = '<img src=x onerror=alert(1)>';
    const s: SocialState = { ...state(), friends: [{ fid: 'EVILEVIL23', name: evil, band: 'adult', since: 0, presence: { status: 'online' } }], requests: { incoming: [{ fid: 'EVIL222222', name: evil, at: 0, via: 'link' }], outgoing: [] } };
    for (const html of [friendsPage(ctx, { state: s, add }).value, profileMain(ctx, { ...NO_PROFILE_VIEW, state: { ...s, profile: { ...s.profile!, name: evil } }, name: evil }).value, boardsMain(ctx, boardsView(s, { entries: [{ rank: 1, name: evil, score: 5, you: false, fid: 'EVILEVIL23' }] })).value]) {
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x');
    }
  });

  it('a player with no profile is asked to make one or to bring one back, and an unreachable server gets a retry', async () => {
    const { ctx } = ctxOf(lang);
    const fresh = await ready('fresh');
    const intro = friendsPage(ctx, { state: fresh.state(), add }).value;
    expect(intro).toContain('data-action="social.profile"');
    expect(intro).toContain('data-action="social.recover"');
    const off = await ready('offline');
    expect(friendsPage(ctx, { state: off.state(), add }).value).toContain('data-action="social.retry"');
  });

  it('under 16 and kid profiles are told there is no online profile, with a way back to the games and nothing to press for a profile', async () => {
    const { ctx, missing } = ctxOf(lang);
    for (const mode of ['young', 'kid'] as const) {
      const s = (await ready(mode)).state();
      const html = friendsPage(ctx, { state: s, add }).value;
      expect(html, mode).not.toContain('data-action="social.profile"');
      expect(html, mode).not.toContain('data-action="social.recover"');
      expect(html, mode).toContain(`href="${ctx.href('home')}"`);
      expect(textOf(html), mode).toContain(ctx.i18n.tx(`ux.${mode === 'kid' ? 'kid' : 'young'}.title`));
      // every other page of the area says the same instead of asking
      for (const body of [
        profileMain(ctx, { ...NO_PROFILE_VIEW, state: s }).value, boardsMain(ctx, boardsView(s)).value, friendLinkPage(ctx, { ...NO_LINK_VIEW, code: 'BA-9PXMR3', noOnline: s.noOnline }).value,
        roomPage(ctx, { ...NO_ROOM_VIEW, noOnline: s.noOnline }).value, lobbiesPage(ctx, lobbiesView(s, [])).value,
      ]) expect(body, mode).toContain(ctx.i18n.tx(`ux.${mode === 'kid' ? 'kid' : 'young'}.title`));
    }
    expect(missing).toEqual([]);
  });

  it('every state of the connection and the profile has its banner, and the right button on it', async () => {
    const { ctx, missing } = ctxOf(lang);
    const body = async (mode: DemoSocialMode): Promise<string> => friendsPage(ctx, { state: (await ready(mode)).state(), add }).value;
    expect(await body('banned')).toMatch(/data-banner="banned"/);
    expect(await body('banned')).toContain('role="alert"');
    expect(await body('banned')).not.toContain('data-action="social.accept"');
    expect(await body('replaced')).toContain('data-action="social.takeover"');
    expect(await body('reconnecting')).toContain('data-banner="reconnecting"');
    expect(await body('recovery')).toContain('data-action="recovery.show"');
    expect(await body('deleted')).toContain('data-banner="deleted"');
    expect(await body('unknown')).toContain('data-banner="unknown"');
    expect(await body('unknown')).toContain('data-action="social.recover"');
    expect(await body('muted')).toContain('data-banner="muted"');
    expect(await body('suspended')).toContain('data-banner="suspended"');
    const off = (await ready()).state();
    const offline = friendsPage(ctx, { state: { ...off, status: 'offline' }, add }).value;
    expect(offline).toContain('data-banner="offline"');
    expect(offline).toContain('data-action="social.retry"');
    expect(offline).toContain('Doruk');                                             // the saved profile stays on screen
    expect(missing).toEqual([]);
  });

  it('the add box keeps what was typed and says what happened, as an error when it failed', async () => {
    const { ctx } = ctxOf(lang);
    const { state } = await ready();
    const html = friendsPage(ctx, { state: state(), add: { value: 'BA-12', busy: false, note: { ok: false, text: ctx.i18n.t('social.add.bad') } } }).value;
    expect(html).toContain('value="BA-12"');
    expect(html).toContain('is-error');
    expect(html).toContain('aria-describedby="add-note"');
  });

  it('my profile: an adult types a name, a teenager picks another made-up one; both see the code, the link, the QR code and what the age group allows', async () => {
    const { ctx, missing } = ctxOf(lang, '/friends/?view=profile');
    const adult = (await ready()).state();
    const html = profileMain(ctx, { ...NO_PROFILE_VIEW, state: adult, name: 'Doruk' }).value;
    const text = textOf(html);
    expect(missing).toEqual([]);
    expect(text).not.toMatch(NO_LEAK);
    expect(html).toContain('data-form="me-name"');
    expect(html).not.toContain('data-action="me.reroll"');
    expect(html).toContain('BA-7K2Q4X');
    expect(html).toContain('https://bodyarcade.com/f/BA-7K2Q4X');
    expect(html).toMatch(/<svg[^>]+role="img"[^>]+shape-rendering="crispEdges"/);
    for (const action of ['me.renewCode', 'me.renewRecovery', 'me.download', 'me.delete', 'me.ageDown', 'me.ageChild']) expect(html, action).toContain(`data-action="${action}"`);
    expect(html).toContain('name="dnd"');
    expect(html).toContain('name="region"');
    expect(html).toContain('name="level"');
    expect(html).toContain('value="medium" data-key="level-medium" checked');           // level 12 is the middle band
    expect(html).toContain('value="eu" selected');
    const teen = (await ready('teen')).state();
    const t = profileMain(ctx, { ...NO_PROFILE_VIEW, state: teen }).value;
    expect(t).not.toContain('data-form="me-name"');
    expect(t).toContain('data-action="me.reroll"');
    expect(t).not.toContain('data-action="me.ageDown"');                                   // there is nothing below 16 to 17 but no profile
    expect(t).toContain('data-action="me.ageChild"');
    expect(new Set(ids(html)).size).toBe(ids(html).length);
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });

  it('my profile shows the notices of the profile and what the last action said, an error in the error colour', async () => {
    const { ctx } = ctxOf(lang, '/friends/?view=profile');
    const s = (await ready('muted')).state();
    const view: ProfileView = { ...NO_PROFILE_VIEW, state: s, notes: { name: { ok: false, text: 'That name cannot be used.' }, prefs: { ok: true, text: 'Saved' } }, busy: 'name' };
    const html = profileMain(ctx, view).value;
    expect(html).toContain('data-banner="muted"');
    expect(html).toContain('is-error');
    expect(textOf(html)).toContain('That name cannot be used.');
    expect(html).toMatch(/data-action="me\.delete"[^>]*disabled/);                          // a running action holds the other buttons
    // a suspended profile can be downloaded and deleted and nothing else
    const banned = profileMain(ctx, { ...NO_PROFILE_VIEW, state: (await ready('banned')).state() }).value;
    expect(banned).toContain('data-action="me.download"');
    expect(banned).toContain('data-action="me.delete"');
    expect(banned).not.toContain('data-form="me-name"');
    expect(banned).not.toContain('data-action="me.ageChild"');
  });

  it('the weekly boards: loading, failed, a list with the player\'s own line, below the top, nothing yet, no friends, no country', async () => {
    const { ctx, missing } = ctxOf(lang, '/friends/?view=boards');
    const s = (await ready()).state();
    const board = (over: Partial<BoardView> = {}): BoardView => ({
      game: 'squat-flap', scope: 'friends', week: { id: 2980, start: Date.UTC(2026, 9, 19), end: Date.UTC(2026, 9, 26), current: true }, country: null,
      entries: [{ rank: 1, name: 'Mert', score: 4820, you: false, fid: 'MERT234567' }, { rank: 2, name: 'Doruk', score: 4310, you: true, fid: 'DEMOME2345' }], you: { score: 4310, rank: 2, atLeast: false }, ...over,
    });
    const loading = boardsMain(ctx, { ...boardsView(s), loading: true }).value;
    expect(loading).toContain('aria-busy="true"');
    expect(textOf(loading)).toContain(ctx.i18n.tx('ux.boards.loading'));
    expect(boardsMain(ctx, { ...boardsView(s), failed: true }).value).toContain('data-action="boards.retry"');
    const list = boardsMain(ctx, { ...boardsView(s), board: board() }).value;
    expect(list).toContain('class="you"');
    expect(list).toContain('data-board="friends"');
    expect(textOf(list)).toContain(lang === 'en' ? '4,820' : '4.820');
    expect(textOf(list)).toContain(lang === 'en' ? 'Your best this week: 4,310, rank 2.' : 'Bu haftaki en iyin: 4.310, sıra 2.');
    expect(list).toContain('data-action="boards.game"');
    expect(list).toContain('name="scope"');
    expect(list).toContain('name="week"');
    // last week's own line says last week (it is not this week's)
    const lastWeek = { id: 2979, start: Date.UTC(2026, 9, 12), end: Date.UTC(2026, 9, 19), current: false };
    const before = textOf(boardsMain(ctx, { ...boardsView(s), week: 'previous', board: board({ week: lastWeek }) }).value);
    expect(before).toContain(lang === 'en' ? 'Your best last week: 4,310, rank 2.' : 'Geçen haftaki en iyin: 4.310, sıra 2.');
    expect(before).not.toContain(lang === 'en' ? 'this week' : 'Bu haftaki');
    const beforeLow = textOf(boardsMain(ctx, { ...boardsView(s), week: 'previous', scope: 'country', board: board({ week: lastWeek, scope: 'country', country: 'TR', entries: [], you: { score: 50, rank: 100, atLeast: true } }) }).value);
    expect(beforeLow).toContain(lang === 'en' ? 'Your best last week: 50, rank 100 or lower.' : 'Geçen haftaki en iyin: 50, sıra 100 ya da daha geride.');
    // an own line below the visible entries, as a lower bound
    const low = boardsMain(ctx, { ...boardsView(s), scope: 'country', board: board({ scope: 'country', country: 'TR', entries: [{ rank: 1, name: 'Kestrel', score: 9000, you: false }], you: { score: 50, rank: 100, atLeast: true } }) }).value;
    expect(low).toContain('class="you gap"');
    expect(low).toContain('100+');
    expect(textOf(low)).toContain(lang === 'en' ? 'rank 100 or lower' : 'sıra 100 ya da daha geride');
    expect(textOf(low)).toMatch(lang === 'en' ? /Players in T(ü|u)rkiye|Players in Turkey/ : /Türkiye/);
    const squat = ctx.games.find((g) => g.id === 'squat-flap')!;
    expect(textOf(boardsMain(ctx, { ...boardsView(s), board: board({ entries: [], you: null }) }).value)).toContain(ctx.i18n.tx('ux.boards.empty', { game: titleOf(ctx, squat) }));
    expect(textOf(boardsMain(ctx, { ...boardsView({ ...s, friends: [] }), board: board({ entries: [], you: null }) }).value)).toContain(ctx.i18n.tx('ux.boards.noFriends'));
    expect(textOf(boardsMain(ctx, { ...boardsView(s), scope: 'country', board: board({ scope: 'country', country: null, entries: [], you: null }) }).value)).toContain(ctx.i18n.tx('ux.boards.noCountry'));
    expect(textOf(list)).toContain(ctx.i18n.tx('ux.boards.honest'));
    const fresh = boardsMain(ctx, boardsView((await ready('fresh')).state())).value;
    expect(fresh).toContain('data-action="social.profile"');
    expect(missing).toEqual([]);
    expect(boardsPage(ctx, boardsView(s)).value).toContain('ba-page--boards');
  });

  it('lobbies list seats, say when a lobby is full, and close for a player who may not use them', async () => {
    const { ctx, missing } = ctxOf(lang, '/lobbies/');
    const { state, svc } = await ready();
    const online = onlineGames(ctx);
    expect(online.length).toBeGreaterThan(0);
    const game = online[0] ?? null;
    const list = await svc.social.lobbies({ game: game?.id ?? '', region: 'eu' });
    const view = lobbiesView(state(), list.ok ? list.value : []);
    const html = lobbiesPage(ctx, view).value;
    expect(missing).toEqual([]);
    expect(textOf(html)).not.toMatch(NO_LEAK);
    expect((html.match(/data-action="lobby.join"/g) ?? []).length).toBe(3);
    expect(textOf(html)).toContain(ctx.i18n.tx('ux.lobby.playersShort', { n: 2, of: 4 }));
    expect(html).toContain('class="full"');
    expect(html).toContain('data-action="lobby.quick"');
    expect(html).toContain('name="region"');
    const closedProfile = state().profile ? { ...state().profile!, can: { ...state().profile!.can, publicPlay: false } } : null;
    const closed = lobbiesPage(ctx, { ...view, state: { ...state(), profile: closedProfile } }).value;
    expect(closed).not.toContain('data-action="lobby.join"');
    expect(textOf(closed)).toContain(ctx.i18n.t('lobby.closed'));
    const away = lobbiesPage(ctx, lobbiesView((await ready('suspended')).state(), [])).value;
    expect(away).not.toContain('data-action="lobby.join"');
    expect(away).not.toContain('data-banner="suspended"');
    expect(textOf(away)).toMatch(lang === 'en' ? /closed for you until .*\d{4}/ : /\d{4}.* tarihine kadar sana kapalı/);
  });

  it('a quick match says how long it has looked, offers a ghost after twenty seconds and says when nobody came', async () => {
    const { ctx, missing } = ctxOf(lang, '/lobbies/');
    const { state } = await ready();
    const base = lobbiesView(state(), []);
    const looking = lobbiesPage(ctx, { ...base, quick: { ...IDLE_QUICK, phase: 'looking', waitedMs: 9_000 } }).value;
    expect(looking).toContain('data-action="lobby.stop"');
    expect(looking).not.toContain('data-action="lobby.quick"');
    expect(looking).not.toContain('data-action="lobby.ghost"');
    expect(textOf(looking)).toContain(lang === 'en' ? 'Looking for 9 seconds' : '9 saniyedir aranıyor');
    expect(looking).toMatch(/name="band"[^>]*disabled/);
    const hosting = lobbiesPage(ctx, { ...base, quick: { ...IDLE_QUICK, phase: 'looking', hosting: true, waitedMs: 7_000 } }).value;
    expect(textOf(hosting)).toContain(ctx.i18n.t('lobby.quick.waiting'));
    const ghost = lobbiesPage(ctx, { ...base, quick: { ...IDLE_QUICK, phase: 'looking', hosting: true, waitedMs: 21_000, offerGhost: true } }).value;
    expect(ghost).toContain('data-action="lobby.ghost"');
    expect(ghost).toContain('data-action="lobby.keep"');
    expect(ghost).toContain('data-action="lobby.stop"');
    const out = lobbiesPage(ctx, { ...base, quick: { ...IDLE_QUICK, phase: 'timeout', offerGhost: true } }).value;
    expect(out).toContain('data-action="lobby.ghost"');
    expect(out).toContain('data-action="lobby.quick"');
    expect(textOf(out)).toContain(ctx.i18n.tx('ux.lobby.quick.timeoutTitle'));
    const note = lobbiesPage(ctx, { ...base, quick: { ...IDLE_QUICK, note: 'No connection.' } }).value;
    expect(textOf(note)).toContain('No connection.');
    expect(missing).toEqual([]);
  });

  it('a lobby list that did not load says why, in the player\'s words, with a way to try again', async () => {
    const { ctx } = ctxOf(lang, '/lobbies/');
    const { state } = await ready();
    const html = lobbiesPage(ctx, { ...lobbiesView(state(), null), failed: 'No connection. Try again when you are online.' }).value;
    expect(textOf(html)).toContain('No connection. Try again when you are online.');
    expect(html).toContain('data-action="lobby.refresh"');
    expect(textOf(lobbiesPage(ctx, lobbiesView(state(), null)).value)).toContain(ctx.i18n.t('lobby.loading'));
  });

  it('a room: everybody gets ready, nobody presses start, and the page says what the Room is waiting for', async () => {
    const { ctx, missing } = ctxOf(lang, '/r/K7Q2MX/');
    const { state, svc } = await ready();
    await svc.rooms.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    const room = svc.rooms.state();
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const view = (r: RoomState, profile = state().profile): RoomView => ({ ...NO_ROOM_VIEW, room: r, game, profile, games: onlineGames(ctx), friends: state().friends });

    // I am ready and one of the others is not: the page names who it waits for and offers a nudge
    const hostReady = { ...room, members: room.members.map((m, i) => ({ ...m, ready: m.seat === room.me || i === 1 })) };
    const waiting = roomPage(ctx, view(hostReady)).value;
    expect(missing).toEqual([]);
    expect(textOf(waiting)).not.toMatch(NO_LEAK);
    expect(waiting).toContain('data-action="room.remind"');
    expect(waiting).toContain('data-action="room.ready" data-ready="0"');
    expect(waiting).not.toContain('data-action="room.start"');
    expect(waiting).toContain('K7Q2MX');

    // not ready yet: the way in is Get ready, which goes through the camera
    const notYet = roomPage(ctx, view({ ...room, members: room.members.map((m) => ({ ...m, ready: false })) })).value;
    expect(notYet).toContain('data-action="room.ready" data-ready="1"');
    expect(textOf(notYet)).toContain(ctx.i18n.t('room.ready.note'));

    // everybody ready: the Room starts the match itself, there is no button for it
    const allReady = { ...room, members: room.members.map((m) => ({ ...m, ready: true })) };
    const start = roomPage(ctx, view(allReady)).value;
    expect(start).not.toContain('data-action="room.start"');
    expect(textOf(start)).toContain(ctx.i18n.t('room.starting'));

    // a match is running: the way back to it
    const playing = roomPage(ctx, view({ ...room, phase: 'playing' })).value;
    expect(playing).toContain('data-action="room.return"');

    const g = createDemoSocial({ mode: 'ready' });
    await g.social.open();
    await g.rooms.join('ABCDEF');
    const guestHtml = roomPage(ctx, view(g.rooms.state())).value;
    expect(guestHtml).toContain('data-action="room.ready"');
    expect(guestHtml).toContain('data-ready="1"');

    for (const id of ids(waiting)) expect(ids(waiting).filter((x) => x === id).length, id).toBe(1);
  });

  it('a room says why a Pro game was refused to the host and where to go, tells everybody when the Pro of the host ran out, and marks a Pro game', async () => {
    const { ctx, missing } = ctxOf(lang, '/r/K7Q2MX/');
    const u = ux(ctx);
    const { state, svc } = await ready();
    await svc.rooms.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    const room = svc.rooms.state();
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const view = (over: Partial<RoomView> = {}): RoomView => ({ ...NO_ROOM_VIEW, room, game, profile: state().profile, games: onlineGames(ctx), friends: state().friends, ...over });

    // nothing to say while there was no refusal and the room's game is a free one
    const quiet = roomPage(ctx, view()).value;
    for (const marker of ['data-pro', 'pro-waiting', 'room.proDismiss']) expect(quiet, marker).not.toContain(marker);

    // the host's refusals: each reason in its own words, the Pro page of the game, a way to a free game, and a way to dismiss it
    const said = new Set<string>();
    for (const reason of ['none', 'expired', 'invalid', 'refused'] as const) {
      const html = roomPage(ctx, view({ pro: { game: 'pad-work', reason, at: 1 } })).value;
      expect(html).toContain(`data-pro="${reason}"`);
      expect(textOf(html)).toContain(u(`pro.${reason}`));
      expect(textOf(html)).toContain(u('pro.title'));
      expect(html).toContain(`href="${ctx.href('pro', { query: { game: 'pad-work' } })}"`);
      expect(html).toContain('data-action="room.proDismiss"');
      expect(html.match(/data-action="room.game"/g)?.length, 'the host can pick a free game from the note and from the game card').toBe(2);
      expect(html).toContain('role="alert"');
      said.add(u(`pro.${reason}`));
    }
    expect(said.size).toBe(4);
    // a guest cannot pick the game, so the note offers no free game
    const guest = { ...room, members: room.members.map((m) => ({ ...m, host: false })) };
    expect(roomPage(ctx, view({ room: guest, pro: { game: 'pad-work', reason: 'none', at: 1 } })).value.match(/data-action="room.game"/g) ?? []).toHaveLength(0);
    // a game this build does not know: the Pro page without a game
    expect(roomPage(ctx, view({ pro: { game: 'no-such-game', reason: 'refused', at: 1 } })).value).toContain(`href="${ctx.href('pro')}"`);

    // the proof of the host ran out while the room waits: everybody is told, and the match starts again when it is renewed or a free game is picked
    if (!room.info) throw new Error('no room');
    const waiting = roomPage(ctx, view({ room: { ...room, info: { ...room.info, pro: { ok: false } } } })).value;
    expect(waiting).toContain('data-banner="pro-waiting"');
    expect(textOf(waiting)).toContain(u('pro.waiting'));
    // both at once (the host's pick was refused while the old proof had run out): the note and the line, one each
    const both = roomPage(ctx, view({ room: { ...room, info: { ...room.info, pro: { ok: false } } }, pro: { game: 'pad-work', reason: 'refused', at: 1 } })).value;
    expect(both).toContain('data-pro="refused"');
    expect(both).toContain('data-banner="pro-waiting"');
    // a Pro game with its proof in place: the line under the game says whose Pro opens it, and no warning
    const proGame = roomPage(ctx, view({ room: { ...room, info: { ...room.info, pro: { ok: true } } } })).value;
    expect(proGame).toContain('data-pro-game');
    expect(textOf(proGame)).toContain(u('pro.gameLine'));
    expect(proGame).not.toContain('pro-waiting');
    expect(missing).toEqual([]);
    for (const html of [waiting, proGame]) expect(textOf(html)).not.toMatch(NO_LEAK);
  });

  it('the game picker tags the Pro games, and the Pro window says why and offers the Pro page or a way back', () => {
    const { ctx, missing } = ctxOf(lang, '/r/K7Q2MX/');
    const u = ux(ctx);
    const padWork = games.find((g) => g.id === 'pad-work');
    if (!padWork) throw new Error('no pad-work fixture');
    const picker = gameSheet(ctx, [...onlineGames(ctx), padWork], 'squat-flap').value;
    expect(picker.match(/k-protag--pill/g)).toHaveLength(1);                       // only the Pro game carries the tag
    expect(textOf(picker)).toContain(ctx.i18n.t('common.pro'));
    expect(gameSheet(ctx, onlineGames(ctx), 'squat-flap').value).not.toContain('k-protag');
    for (const reason of ['none', 'expired', 'invalid', 'refused'] as const) {
      const html = proSheet(ctx, { game: padWork, reason }).value;
      expect(textOf(html)).toContain(u('pro.title'));
      expect(textOf(html)).toContain(u(`pro.${reason}`));
      expect(textOf(html)).toContain(titleOf(ctx, padWork));
      expect(html).toContain('data-dialog-close="see"');
      expect(html).toContain('data-dialog-close="later"');
      expect(html).toContain('aria-labelledby'.slice(0, 0) + 'id="sheet-h"');
      expect(html).toContain('id="sheet-d"');
    }
    expect(proSheet(ctx, { game: null, reason: 'none' }).value).not.toContain('k-progame');
    expect(missing).toEqual([]);
  });

  it('a private room lists the friends to ask in (online ones get a button, offline ones are marked), and every other player has a menu to report or block', async () => {
    const { ctx } = ctxOf(lang, '/r/K7Q2MX/');
    const { state, svc } = await ready();
    await svc.rooms.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    const room = svc.rooms.state();
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const html = roomPage(ctx, { ...NO_ROOM_VIEW, room, game, profile: state().profile, games: [], friends: state().friends, invited: ['AYSE234567'] }).value;
    const card = html.split('data-list="invite"')[1] ?? '';
    expect(card).toContain('data-action="social.invite" data-fid="SELIN23456"');
    expect(card).toMatch(/data-fid="AYSE234567"[^>]*disabled/);                              // asked already
    expect(card).not.toContain('data-fid="CAN2345678"');                                      // offline: no button
    expect(textOf(card)).toContain(ctx.i18n.tx('ux.invite.offline'));
    expect((html.match(/data-action="room\.seat"/g) ?? []).length).toBe(room.members.length - 1);
    expect(html).not.toMatch(new RegExp(`data-action="room\\.seat" data-seat="${room.me}"`));
    // a public room is not for inviting by name: the link and the lobby list are
    const pub = createDemoSocial({ mode: 'ready' });
    await pub.social.open();
    await pub.rooms.create({ game: 'squat-flap', kind: 'public', size: 4, band: 'medium' });
    expect(roomPage(ctx, { ...NO_ROOM_VIEW, room: pub.rooms.state(), game, profile: pub.social.state().profile, friends: pub.social.state().friends }).value).not.toContain('data-list="invite"');
  });

  it('a room that cannot be joined says why, in an alert, and goes back to friends', () => {
    const { ctx } = ctxOf(lang, '/r/FULL22/');
    for (const problem of ['full', 'no_room', 'removed', 'replaced', 'version', 'not_allowed', 'ticket', 'offline'] as const) {
      const r: RoomState = { ...NO_ROOM_STATE, phase: 'closed', problem };
      const html = roomPage(ctx, { ...NO_ROOM_VIEW, room: r }).value;
      expect(html, problem).toContain('role="alert"');
      expect(textOf(html), problem).not.toMatch(NO_LEAK);
      expect(html, problem).toContain(ctx.href('friends'));
    }
  });

  it('video and free text appear only where the room and the player allow them', async () => {
    const { ctx } = ctxOf(lang, '/r/K7Q2MX/');
    const { state, svc } = await ready();
    await svc.rooms.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    const room = svc.rooms.state();
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const adult = roomPage(ctx, { ...NO_ROOM_VIEW, room, game, profile: state().profile }).value;
    expect(adult).toContain('name="share"');
    expect(adult).toContain('data-form="room-say"');
    const teen = state().profile ? { ...state().profile!, band: 'teen' as const, can: { ...state().profile!.can, video: false, freeText: false } } : null;
    const teenRoom: RoomState = { ...room, info: room.info ? { ...room.info, chat: 'preset', video: false } : null };
    const minor = roomPage(ctx, { ...NO_ROOM_VIEW, room: teenRoom, game, profile: teen }).value;
    expect(minor).not.toContain('name="share"');
    expect(minor).not.toContain('data-form="room-say"');
    expect(textOf(minor)).toContain(ctx.i18n.t('room.chat.preset'));
  });

  it('a friend camera that did not connect gets one line and a retry button, in the room page; a camera that is only connecting gets the line alone', async () => {
    const { ctx } = ctxOf(lang, '/r/K7Q2MX/');
    const { state, svc } = await ready();
    await svc.rooms.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    const room = svc.rooms.state();
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const view = (videos: RoomState['videos']): string => roomPage(ctx, { ...NO_ROOM_VIEW, room: { ...room, shareVideo: true, ...(videos ? { videos } : {}) }, game, profile: state().profile }).value;
    const st = (state: 'connecting' | 'live' | 'failed', over: Partial<NonNullable<RoomState['videos']>[number]> = {}): NonNullable<RoomState['videos']>[number] => ({ seat: 's2', state, reason: state === 'failed' ? 'timeout' : null, retryable: true, attempts: 0, since: 0, ...over });
    const none = view(undefined);
    expect(none).not.toContain('room.video.retry');
    expect(none).not.toContain('k-videolink');
    const failed = view([st('failed')]);
    expect(failed).toContain('data-action="room.video.retry"');
    expect(textOf(failed)).toContain(ctx.i18n.t('room.video.failed'));
    expect(textOf(failed)).toContain(ctx.i18n.t('common.retry'));
    const connecting = view([st('connecting')]);
    expect(textOf(connecting)).toContain(ctx.i18n.t('room.video.connecting'));
    expect(connecting).not.toContain('room.video.retry');
    // a device that cannot make the link at all is told, and is not offered a button that cannot work
    const unsupported = view([st('failed', { reason: 'unsupported', retryable: false })]);
    expect(textOf(unsupported)).toContain(ctx.i18n.t('room.video.failed'));
    expect(unsupported).not.toContain('room.video.retry');
    // a picture that flows needs no line
    expect(view([st('live')])).not.toContain('k-videolink');
  });

  it('the friend link page names the code, never a name, and asks for a profile through the same button when there is none', () => {
    const { ctx, missing } = ctxOf(lang, '/f/BA-9PXMR3/');
    const link = (over: Partial<FriendLinkView> = {}): string => friendLinkPage(ctx, { ...NO_LINK_VIEW, code: 'BA-9PXMR3', profile: true, ...over }).value;
    const withProfile = link();
    expect(withProfile).toContain('BA-9PXMR3');
    expect(withProfile).toContain('data-action="friendlink.send"');
    expect(withProfile).not.toContain('data-action="social.recover"');
    const without = link({ profile: false });
    expect(without).toContain('data-action="friendlink.send"');                           // the age question comes after the press
    expect(without).toContain('data-action="social.recover"');
    expect(link({ code: null })).toContain('role="alert"');
    expect(link({ own: true })).not.toContain('data-action="friendlink.send"');
    const sent = link({ done: 'sent', note: { ok: true, text: ctx.i18n.tx('ux.link.sent') } });
    expect(sent).not.toContain('data-action="friendlink.send"');
    expect(sent).toContain(ctx.href('friends'));
    expect(textOf(sent)).toContain(ctx.i18n.tx('ux.link.sent'));
    expect(link({ note: { ok: false, text: 'x' } })).toContain('is-error');
    expect(link({ profile: false, offline: true })).toContain('data-action="social.retry"');
    expect(link({ busy: true })).toMatch(/data-action="friendlink.send"[^>]*disabled/);
    expect(missing).toEqual([]);
  });

  it('safety explains the moments, the rules of each age group (under 16 has no profile), what is kept, and lists who is blocked, with a way to undo it', () => {
    const { ctx, missing } = ctxOf(lang, '/safety/');
    const html = safetyPage(ctx, [{ fid: 'BLOCKED234', name: 'Rude Raven 42', at: 0 }]).value;
    expect(missing).toEqual([]);
    expect(html).toContain('data-action="social.unblock"');
    expect(textOf(html)).toContain('Rude Raven 42');
    expect(textOf(html)).not.toMatch(NO_LEAK);
    expect(textOf(safetyPage(ctx, []).value)).toContain(ctx.i18n.t('safety.blocked.empty'));
    for (const key of ['ux.age.child.1', 'ux.safety.keepBody', 'ux.safety.searchBody', 'ux.safety.sentBody', 'ux.safety.youngBody']) expect(textOf(html), key).toContain(ctx.i18n.tx(key));
    // the sample windows of a report and a block name nobody (no placeholder dots where a name would stand)
    for (const key of ['ux.safety.reportTitle', 'ux.safety.reportFine', 'ux.safety.blockTitle', 'ux.safety.blockBody']) expect(textOf(html), key).toContain(ctx.i18n.tx(key));
    expect(textOf(html)).not.toContain('...');
    // the old promise that under 16 plays in private rooms is gone
    expect(textOf(html)).not.toContain(ctx.i18n.tx('safety.age.child.3'));
  });

  it('the sign-up: the age question has three neutral choices, under 16 says there is no profile, a made-up name for the young, the code for the grown-up', async () => {
    const { ctx, missing } = ctxOf(lang);
    const age = profileSheet(ctx, sheet()).value;
    expect((age.match(/type="radio" name="age"/g) ?? []).length).toBe(3);
    expect(age).toMatch(/data-action="sheet.age.next"[^>]*disabled/);
    expect(age).toContain('data-action="sheet.recover.open"');
    expect(textOf(age)).toContain(ctx.i18n.tx('ux.age.child.1'));
    const picked = profileSheet(ctx, sheet({ band: 'teen' })).value;
    expect(picked).not.toMatch(/data-action="sheet.age.next"[^>]*disabled/);
    expect(picked).toContain('value="teen" data-key="age-teen" checked');
    const under = profileSheet(ctx, sheet({ step: 'young', band: 'child' })).value;
    expect(textOf(under)).toContain(ctx.i18n.tx('ux.young.body'));
    expect(under).toContain('data-dialog-close="games"');
    expect(under).not.toContain('name="name"');
    const adultName = profileSheet(ctx, sheet({ step: 'name', band: 'adult', name: 'Doruk', error: 'That name cannot be used.' })).value;
    expect(adultName).toContain('name="name"');
    expect(adultName).toContain('role="alert"');
    expect(textOf(adultName)).toContain('That name cannot be used.');
    expect(textOf(adultName)).toContain(ctx.i18n.tx('ux.name.hintAdult'));
    const minorName = profileSheet(ctx, sheet({ step: 'name', band: 'teen', name: 'Swift Falcon 42' })).value;
    expect(minorName).not.toContain('name="name"');
    expect(minorName).toContain('Swift Falcon 42');
    expect(minorName).not.toContain(ctx.i18n.tx('ux.name.persistent'));
    expect(textOf(profileSheet(ctx, sheet({ step: 'name', band: 'adult', persistent: false })).value)).toContain(ctx.i18n.tx('ux.name.persistent'));
    const recovery = profileSheet(ctx, sheet({ step: 'recovery', band: 'adult', recovery: { friend: 'BA-7K2Q4X', code: '7K2Q-4XMV-ABCD-EFGH' } })).value;
    expect(textOf(recovery)).toContain('7K2Q-4XMV-ABCD-EFGH');
    expect(textOf(recovery)).toContain('BA-7K2Q4X');
    expect(recovery).toContain('data-action="sheet.recovery.copy"');
    expect(recovery).toContain('data-action="sheet.recovery.download"');
    expect(recovery).toContain('data-action="sheet.recovery.saved"');
    expect(recovery).toContain('data-dialog-close="created"');
    const again = recoverySheet(ctx, { friend: 'BA-7K2Q4X', code: '9JXK-2MQR-VTWB-C4HN' }).value;
    expect(again).toContain('data-dialog-close="saved"');
    const recover = profileSheet(ctx, sheet({ step: 'recover', recoverCode: 'BA-7K2Q4X', recoverRecovery: 'x', recoverField: 'recovery', error: 'No match.' })).value;
    expect(recover).toContain('name="recoverCode"');
    expect(recover).toContain('name="recoverRecovery"');
    expect(recover).toContain('value="BA-7K2Q4X"');
    expect(recover).toMatch(/name="recoverRecovery"[^>]*aria-invalid="true"/);
    expect(recover).not.toMatch(/name="recoverCode"[^>]*aria-invalid/);
    expect(textOf(recover)).toContain('No match.');
    expect(recover).toContain('data-action="sheet.recover.go"');
    for (const s of [age, under, adultName, recovery, recover]) {
      expect(s).toContain('id="sheet-h"');
      expect(textOf(s)).not.toMatch(NO_LEAK);
    }
    expect(missing).toEqual([]);
  });

  it('the other sheets are named dialogs with their buttons; a young player\'s report has no typed note', async () => {
    const { ctx, missing } = ctxOf(lang);
    const { state } = await ready();
    const f = state().friends[0]!;
    for (const s of [friendMenuSheet(ctx, f).value, seatMenuSheet(ctx, { seat: 's2', name: 'Elif' }).value, reportSheet(ctx, f, { reason: 'abuse', alsoBlock: true, details: '' }).value, blockSheet(ctx, f).value, gameSheet(ctx, onlineGames(ctx), 'squat-flap').value, qrSheet(ctx, 'https://bodyarcade.com/r/K7Q2MX').value]) {
      expect(s).toContain('id="sheet-h"');
      expect(textOf(s)).not.toMatch(NO_LEAK);
    }
    expect(reportSheet(ctx, f, { reason: 'cheating', alsoBlock: false, details: '' }).value).toContain('value="cheating" data-key="reason-cheating" checked');
    expect(reportSheet(ctx, f, { reason: 'abuse', alsoBlock: true, details: '' }).value).toContain('name="details"');
    expect(reportSheet(ctx, f, { reason: 'abuse', alsoBlock: true, details: '' }, false).value).not.toContain('name="details"');
    expect(seatMenuSheet(ctx, { seat: 's2', name: 'Elif' }).value).not.toContain('social.friend.remove');
    expect(missing).toEqual([]);
  });

  it('the tray of invitations shows the friend, the game and the time left, and holds only invitations that are not over', async () => {
    const { ctx, missing } = ctxOf(lang);
    const now = 1_000_000;
    const inv = (id: string, name: string, left: number): PendingInvite => ({ id, from: { fid: `${name}22222222`.slice(0, 10), name }, room: 'INV222', game: 'squat-flap', exp: now + left });
    const html = inviteTray(ctx, [inv('a', 'Elif', 102_000), inv('b', 'Mert', 30_000), inv('c', 'Late', -1)], now).value;
    expect(html).toContain('data-invite="a"');
    expect(html).toContain('data-invite="b"');
    expect(html).not.toContain('data-invite="c"');
    expect(html).toContain('data-action="invite.join" data-id="a"');
    expect(html).toContain('data-action="invite.decline" data-id="a"');
    expect(textOf(html)).toContain('1:42');
    expect(textOf(html)).toContain('0:30');
    expect(textOf(html)).toContain('Elif');
    expect(textOf(html)).not.toMatch(NO_LEAK);
    expect(inviteTray(ctx, [inv('c', 'Late', 0)], now).value).toBe('');
    expect(clockText(61_000)).toBe('1:01');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(-5)).toBe('0:00');
    expect(missing).toEqual([]);
  });
});

function boardsView(state: SocialState, over: { entries?: BoardView['entries'] } = {}): BoardsView {
  const view: BoardsView = { state, games: games.filter((g) => ['squat-flap', 'star-catch', 'knee-sprint'].includes(g.id)), game: games.find((g) => g.id === 'squat-flap') ?? null, scope: 'friends', week: 'current', board: null, loading: false, failed: false };
  if (over.entries) return { ...view, board: { game: 'squat-flap', scope: 'friends', week: { id: 1, start: 0, end: 7 * 86_400_000, current: true }, country: null, entries: over.entries, you: null } };
  return view;
}

function lobbiesView(state: SocialState, list: readonly LobbyEntry[] | null): LobbiesView {
  const online = onlineGames(makeContext({ lang: 'en', games, url: '/lobbies/', flags: { social: true } }));
  return { state, games: online, game: online[0] ?? null, band: 'medium', region: 'eu', list, failed: null, quick: IDLE_QUICK };
}

describe('every state of the practice port draws every page of the area without a missing word, in both languages', () => {
  it.each(DEMO_SOCIAL_MODES.map((m) => [m]))('%s', async (mode) => {
    for (const lang of LANGS) {
      const { ctx, missing } = ctxOf(lang);
      const { state } = await ready(mode);
      const s = state();
      const pages = [
        friendsPage(ctx, { state: s, add }), profilePage(ctx, { ...NO_PROFILE_VIEW, state: s }), boardsPage(ctx, boardsView(s)), lobbiesPage(ctx, lobbiesView(s, [])),
        friendLinkPage(ctx, { ...NO_LINK_VIEW, code: 'BA-9PXMR3', profile: !!s.profile, noOnline: s.noOnline }), safetyPage(ctx, s.blocks),
      ];
      for (const p of pages) {
        expect(textOf(p.value), `${mode} ${lang}`).not.toMatch(NO_LEAK);
        expect(p.value, `${mode} ${lang}`).toContain('<main');
      }
      expect(missing, `${mode} ${lang}`).toEqual([]);
    }
  });
});

describe('the pages as the router draws them', () => {
  it('every social address is a page with the flag on, a 404 with it off, and never indexed', () => {
    for (const url of ['/friends/', '/friends/?view=profile', '/friends/?view=boards', '/lobbies/', '/r/K7Q2MX/', '/f/BA-9PXMR3/', '/safety/']) {
      const route = router.match(url);
      expect(route, url).not.toBeNull();
      const off = renderPage(makeContext({ lang: 'en', games, url }), route, EMPTY_STATE);
      expect(off.status, `${url} off`).toBe(404);
      const on = renderPage(makeContext({ lang: 'en', games, url, flags: { social: true } }), route, EMPTY_STATE);
      expect(on.status, `${url} on`).toBe(200);
      expect(on.noindex, url).toBe(true);
    }
  });

  it('the profile and the boards are parts of the friends page, each with its own title', () => {
    const ctx = makeContext({ lang: 'en', games, url: '/friends/?view=profile', flags: { social: true } });
    const profile = socialPage(ctx, router.match('/friends/?view=profile')!, null);
    const boards = socialPage(ctx, router.match('/friends/?view=boards')!, null);
    const friends = socialPage(ctx, router.match('/friends/')!, null);
    expect(new Set([profile.title, boards.title, friends.title]).size).toBe(3);
    expect(profile.body.value).toContain('ba-page--me');
    expect(boards.body.value).toContain('ba-page--boards');
    expect(friends.body.value).toContain('ba-page--friends');
  });

  it('the same player and the same id always get the same figure and colour', () => {
    expect(avatarLook('MERT234567')).toEqual(avatarLook('MERT234567'));
    const looks = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => JSON.stringify(avatarLook(`ID${id}`))));
    expect(looks.size).toBeGreaterThan(2);
  });

  it('the friends page main can be drawn without the chrome (the e2e checks use it)', async () => {
    const { ctx } = ctxOf('en');
    const { state } = await ready();
    expect(friendsMain(ctx, { state: state(), add }).value).toContain('<h1');
  });
});
