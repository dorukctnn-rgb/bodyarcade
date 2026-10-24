// The Friends screens, drawn from the practice ports in both complete languages: every string exists, the names of other
// players are escaped, each state of a screen says what it should, and the controls have names. No browser: views are
// functions of the context and the state.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { createDemoSocial } from './app/demo-social.ts';
import { makeContext } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import { NO_ROOM_STATE, type RoomState, type SocialState } from './social/port.ts';
import {
  avatarLook, blockSheet, friendLinkPage, friendMenuSheet, friendsPage, gameSheet, lobbiesPage, onlineGames, profileSheet, qrSheet, reportSheet, roomPage, safetyPage,
  type LobbiesView, type RoomView,
} from './views/social.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];

function ctxOf(lang: Lang, url = '/friends/') {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, flags: { social: true }, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) } });
  return { ctx, missing };
}

async function ready(mode: 'ready' | 'fresh' | 'offline' = 'ready'): Promise<{ state: () => SocialState; svc: ReturnType<typeof createDemoSocial> }> {
  const svc = createDemoSocial({ mode, roomCode: 'K7Q2MX' });
  await svc.social.open();
  return { state: () => svc.social.state(), svc };
}

const ids = (html: string): string[] => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
const NO_LEAK = /undefined|\[object|NaN|\{[a-z]+\}/;

describe.each(LANGS)('friends screens in %s', (lang) => {
  it('the friends page shows the profile, the code, a real QR code, requests and friends with their presence', async () => {
    const { ctx, missing } = ctxOf(lang);
    const { state } = await ready();
    const html = friendsPage(ctx, { state: state(), add: { value: '', busy: false, note: null } }).value;
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
  });

  it('names from other players are escaped, never markup', async () => {
    const { ctx } = ctxOf(lang);
    const { state } = await ready();
    const evil = '<img src=x onerror=alert(1)>';
    const s: SocialState = { ...state(), friends: [{ fid: 'EVILEVIL23', name: evil, band: 'adult', since: 0, presence: { status: 'online' } }], requests: { incoming: [{ fid: 'EVIL222222', name: evil, at: 0, via: 'link' }], outgoing: [] } };
    const html = friendsPage(ctx, { state: s, add: { value: '', busy: false, note: null } }).value;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('a player with no profile is asked to make one, and an unreachable server gets a retry', async () => {
    const { ctx } = ctxOf(lang);
    const fresh = await ready('fresh');
    expect(friendsPage(ctx, { state: fresh.state(), add: { value: '', busy: false, note: null } }).value).toContain('data-action="social.profile"');
    const off = await ready('offline');
    expect(friendsPage(ctx, { state: off.state(), add: { value: '', busy: false, note: null } }).value).toContain('data-action="social.retry"');
  });

  it('the add box keeps what was typed and says what happened, as an error when it failed', async () => {
    const { ctx } = ctxOf(lang);
    const { state } = await ready();
    const html = friendsPage(ctx, { state: state(), add: { value: 'BA-12', busy: false, note: { ok: false, text: ctx.i18n.t('social.add.bad') } } }).value;
    expect(html).toContain('value="BA-12"');
    expect(html).toContain('is-error');
    expect(html).toContain('aria-describedby="add-note"');
  });

  it('lobbies list seats, say when a lobby is full, and close for a player who may not use them', async () => {
    const { ctx, missing } = ctxOf(lang, '/lobbies/');
    const { state, svc } = await ready();
    const online = onlineGames(ctx);
    expect(online.length).toBeGreaterThan(0);
    const game = online[0] ?? null;
    const list = await svc.social.lobbies({ game: game?.id ?? '', region: 'eu' });
    const view: LobbiesView = { state: state(), games: online, game, band: 'medium', region: 'eu', list: list.ok ? list.value : [], failed: false, search: 'idle' };
    const html = lobbiesPage(ctx, view).value;
    expect(missing).toEqual([]);
    expect(textOf(html)).not.toMatch(NO_LEAK);
    expect((html.match(/data-action="lobby.join"/g) ?? []).length).toBe(3);
    expect(html).toContain('class="full"');
    expect(html).toContain('data-action="lobby.quick"');
    const child = { ...state(), profile: state().profile ? { ...state().profile!, band: 'child' as const, can: { ...state().profile!.can, publicPlay: false } } : null };
    const closed = lobbiesPage(ctx, { ...view, state: child }).value;
    expect(closed).not.toContain('data-action="lobby.join"');
    expect(textOf(closed)).toContain(ctx.i18n.t('lobby.closed'));
    const looking = lobbiesPage(ctx, { ...view, search: 'waiting' }).value;
    expect(looking).toContain('data-action="lobby.stop"');
    expect(looking).not.toContain('data-action="lobby.quick"');
  });

  it('a room: everybody gets ready, nobody presses start, and the page says what the Room is waiting for', async () => {
    const { ctx, missing } = ctxOf(lang, '/r/K7Q2MX/');
    const { state, svc } = await ready();
    await svc.rooms.create({ game: 'squat-flap', kind: 'private', size: 4, band: null });
    const room = svc.rooms.state();
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const view = (r: RoomState, profile = state().profile): RoomView => ({ room: r, game, profile, games: onlineGames(ctx), draft: '', chatNote: '' });

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

  it('a room that cannot be joined says why, in an alert, and goes back to friends', () => {
    const { ctx } = ctxOf(lang, '/r/FULL22/');
    for (const problem of ['full', 'no_room', 'removed', 'replaced', 'version', 'not_allowed', 'ticket', 'offline'] as const) {
      const r: RoomState = { ...NO_ROOM_STATE, phase: 'closed', problem };
      const html = roomPage(ctx, { room: r, game: null, profile: null, games: [], draft: '', chatNote: '' }).value;
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
    const adult = roomPage(ctx, { room, game, profile: state().profile, games: [], draft: '', chatNote: '' }).value;
    expect(adult).toContain('name="share"');
    expect(adult).toContain('data-form="room-say"');
    const teen = state().profile ? { ...state().profile!, band: 'teen' as const, can: { ...state().profile!.can, video: false, freeText: false } } : null;
    const teenRoom: RoomState = { ...room, info: room.info ? { ...room.info, chat: 'preset', video: false } : null };
    const minor = roomPage(ctx, { room: teenRoom, game, profile: teen, games: [], draft: '', chatNote: '' }).value;
    expect(minor).not.toContain('name="share"');
    expect(minor).not.toContain('data-form="room-say"');
    expect(textOf(minor)).toContain(ctx.i18n.t('room.chat.preset'));
  });

  it('the friend link page names the code and asks for a profile first when there is none', () => {
    const { ctx } = ctxOf(lang, '/f/BA-9PXMR3/');
    const withProfile = friendLinkPage(ctx, { code: 'BA-9PXMR3', profile: true, busy: false, note: null }).value;
    expect(withProfile).toContain('BA-9PXMR3');
    expect(withProfile).toContain('data-action="friendlink.send"');
    const without = friendLinkPage(ctx, { code: 'BA-9PXMR3', profile: false, busy: false, note: null }).value;
    expect(without).toContain('data-action="social.profile"');
    expect(friendLinkPage(ctx, { code: null, profile: true, busy: false, note: null }).value).toContain('role="alert"');
  });

  it('safety explains the three moments and lists who is blocked, with a way to undo it', () => {
    const { ctx, missing } = ctxOf(lang, '/safety/');
    const html = safetyPage(ctx, [{ fid: 'BLOCKED234', name: 'Rude Raven 42', at: 0 }]).value;
    expect(missing).toEqual([]);
    expect(html).toContain('data-action="social.unblock"');
    expect(textOf(html)).toContain('Rude Raven 42');
    expect(textOf(html)).not.toMatch(NO_LEAK);
    expect(textOf(safetyPage(ctx, []).value)).toContain(ctx.i18n.t('safety.blocked.empty'));
  });

  it('the sheets are named dialogs with their buttons, and the age sheet waits for a choice', async () => {
    const { ctx, missing } = ctxOf(lang);
    const { state } = await ready();
    const f = state().friends[0]!;
    const age = profileSheet(ctx, { step: 'age', band: null, name: '', error: null, busy: false }).value;
    expect((age.match(/type="radio" name="age"/g) ?? []).length).toBe(3);
    expect(age).toMatch(/data-action="sheet.age.next"[^>]*disabled/);
    const picked = profileSheet(ctx, { step: 'age', band: 'teen', name: '', error: null, busy: false }).value;
    expect(picked).not.toMatch(/data-action="sheet.age.next"[^>]*disabled/);
    expect(picked).toContain('value="teen" data-key="age-teen" checked');
    const adultName = profileSheet(ctx, { step: 'name', band: 'adult', name: 'Doruk', error: 'rejected', busy: false }).value;
    expect(adultName).toContain('name="name"');
    expect(adultName).toContain('role="alert"');
    const minorName = profileSheet(ctx, { step: 'name', band: 'child', name: 'Swift Falcon 42', error: null, busy: false }).value;
    expect(minorName).not.toContain('name="name"');
    expect(minorName).toContain('Swift Falcon 42');
    for (const sheet of [age, friendMenuSheet(ctx, f).value, reportSheet(ctx, f, { reason: 'abuse', alsoBlock: true, details: '' }).value, blockSheet(ctx, f).value, gameSheet(ctx, onlineGames(ctx), 'squat-flap').value, qrSheet(ctx, 'https://bodyarcade.com/r/K7Q2MX').value]) {
      expect(sheet).toContain('id="sheet-h"');
      expect(textOf(sheet)).not.toMatch(NO_LEAK);
    }
    expect(reportSheet(ctx, f, { reason: 'cheating', alsoBlock: false, details: '' }).value).toContain('value="cheating" data-key="reason-cheating" checked');
    expect(missing).toEqual([]);
  });
});

describe('the pages as the router draws them', () => {
  it('every social address is a page with the flag on, a 404 with it off, and never indexed', () => {
    for (const url of ['/friends/', '/lobbies/', '/r/K7Q2MX/', '/f/BA-9PXMR3/', '/safety/']) {
      const route = router.match(url);
      expect(route, url).not.toBeNull();
      const off = renderPage(makeContext({ lang: 'en', games, url }), route, EMPTY_STATE);
      expect(off.status, `${url} off`).toBe(404);
      const on = renderPage(makeContext({ lang: 'en', games, url, flags: { social: true } }), route, EMPTY_STATE);
      expect(on.status, `${url} on`).toBe(200);
      expect(on.noindex, url).toBe(true);
    }
  });

  it('the same player and the same id always get the same figure and colour', () => {
    expect(avatarLook('MERT234567')).toEqual(avatarLook('MERT234567'));
    const looks = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => JSON.stringify(avatarLook(`ID${id}`))));
    expect(looks.size).toBeGreaterThan(2);
  });
});
