// A practice implementation of the social and room ports, in memory: the friends, requests, lobbies and a room of the
// art director's mock, so the screens can be developed, photographed and tested before the server exists, and so every state
// of a screen can be reached on purpose (a suspended profile, another window that took the connection, a quick match that
// finds nobody). Development and test builds only (boot.ts); a published build has no way to reach it.
//
// `?social=1` is a player who has a profile, `?social=fresh` one who has none, `?social=offline` a service that does not
// answer; the other modes below are the states of the Friends page that need a scene of their own. In a development or test
// build `window.__BA_SOCIAL__` holds the control of the practice port: a test makes a friend send an invitation, a request
// arrive, a friend come online, or the connection change.
import { inviteLink, randomRoomCode } from '../../../core/net/codes.ts';
import { policyFor } from '../../../core/social/age.ts';
import { friendLink, formatRecoveryCode, parseFriendCode, parseRecoveryCode } from '../../../core/social/codes.ts';
import { randomPresetName } from '../../../core/social/presets.ts';
import { checkName } from '../../../core/net/chat-filter.ts';
import type {
  AgeBand, BlockEntry, BoardEntry, BoardScope, BoardView, FriendEntry, FriendPresence, IncomingRequest, LobbyEntry, MyProfile, OutgoingRequest,
} from '../../../core/social/types.ts';
import type { MemberInfo, RoomInfo } from '../../../core/types/net.ts';
import {
  NO_ROOM_STATE, NO_SOCIAL_STATE, type Done, type FeedItem, type PendingInvite, type RoomDone, type RoomPort, type RoomState, type SocialNotice, type SocialPort, type SocialServices,
  type SocialState,
} from '../social/port.ts';

export type DemoSocialMode =
  | 'ready' | 'fresh' | 'offline'
  /** A profile of a 16 to 17 player. */
  | 'teen'
  /** The player said they are under 16, or the profile in use is a kid profile of the Family plan: no online identity. */
  | 'young' | 'kid'
  /** A suspended profile; another window took the connection; the profile was deleted elsewhere; the server forgot the device. */
  | 'banned' | 'replaced' | 'deleted' | 'unknown'
  /** The profile is new and its recovery code has not been saved yet. */
  | 'recovery'
  /** Lobbies are closed for this profile, or its typed messages are paused. */
  | 'suspended' | 'muted'
  /** A profile with no friends at all. */
  | 'alone'
  /** The connection to the friends is being made again. */
  | 'reconnecting';

export const DEMO_SOCIAL_MODES: readonly DemoSocialMode[] = [
  'ready', 'fresh', 'offline', 'teen', 'young', 'kid', 'banned', 'replaced', 'deleted', 'unknown', 'recovery', 'suspended', 'muted', 'alone', 'reconnecting',
];

export interface DemoSocialOptions {
  mode: DemoSocialMode;
  origin?: string;
  /** Fixed room code (tests); random otherwise. */
  roomCode?: string;
  /** Makes the waits of a quick match shorter in tests (1 is real time). */
  timeScale?: number;
  /** What a quick match finds: a lobby at once (default), or nobody (it offers a ghost after 20 seconds and gives up after two minutes). */
  quick?: 'lobby' | 'never';
}

/** What a test can do to the practice port while the page runs. */
export interface DemoSocialControl {
  /** A friend asks the player into a room. */
  invite(from: string, game?: string, room?: string): void;
  /** Somebody sends a friend request. */
  request(name: string): void;
  /** A friend's presence changes. */
  presence(name: string, presence: FriendPresence): void;
  /** The connection to the friends changes. */
  hub(status: SocialState['hub']): void;
  /** The service stops or starts answering. */
  offline(on: boolean): void;
  /** The practice calls the page made, in order (`name` and the arguments as JSON). */
  calls(): string[];
}

declare global {
  interface Window {
    __BA_SOCIAL__?: DemoSocialControl;
  }
}

const ME_FID = 'DEMOME2345';
const OK: Done = { ok: true, value: undefined };
const OK_ROOM: RoomDone = { ok: true, value: undefined };
export const DEMO_RECOVERY = '7K2Q-4XMV-ABCD-EFGH';

class Listeners {
  private readonly all = new Set<() => void>();
  add(cb: () => void): () => void { this.all.add(cb); return () => { this.all.delete(cb); }; }
  fire(): void { for (const cb of [...this.all]) cb(); }
}

const WEEK = 7 * 86_400_000;

export function createDemoSocial(o: DemoSocialOptions): SocialServices {
  const origin = o.origin ?? 'https://bodyarcade.com';
  const scale = Math.max(1, o.timeScale ?? 1);
  const now = Date.now();
  const listeners = new Listeners();
  const roomListeners = new Listeners();
  const noticeSubs = new Set<(n: SocialNotice) => void>();
  const log: string[] = [];
  const note = (name: string, ...args: unknown[]): void => { log.push(`${name} ${JSON.stringify(args)}`); };
  const notify = (n: SocialNotice): void => { for (const cb of [...noticeSubs]) cb(n); };
  let down = o.mode === 'offline';

  const profileFor = (band: AgeBand, name: string, extra: Partial<MyProfile> = {}): MyProfile => {
    const p = policyFor(band);
    return {
      fid: ME_FID, name, code: 'BA-7K2Q4X', link: friendLink(origin, '7K2Q4X'), band, level: 12, region: 'eu', lang: 'en', dnd: false, createdAt: now, mutedUntil: 0, publicBlockedUntil: 0,
      counts: { friends: 4, incoming: 1, outgoing: 0, blocks: 0 },
      can: { freeName: !p.presetNameOnly, freeText: p.freeText, video: p.video, publicPlay: p.publicPlay, maxFriends: p.maxFriends },
      ...extra,
    };
  };

  const friends0: FriendEntry[] = [
    { fid: 'MERT234567', name: 'Mert', band: 'adult', since: now, presence: { status: 'online' } },
    { fid: 'AYSE234567', name: 'Ayşe', band: 'adult', since: now, presence: { status: 'playing', game: 'star-catch' } },
    { fid: 'CAN2345678', name: 'Can', band: 'adult', since: now, presence: { status: 'offline' } },
    { fid: 'SELIN23456', name: 'Selin', band: 'adult', since: now, presence: { status: 'in_room', game: 'squat-flap', room: 'SELN22' } },
  ];
  const incoming0: IncomingRequest[] = [{ fid: 'ELIF234567', name: 'Elif', at: now, via: 'code' }];

  const own = o.mode === 'ready' || o.mode === 'teen' || o.mode === 'banned' || o.mode === 'replaced' || o.mode === 'recovery' || o.mode === 'suspended' || o.mode === 'muted' || o.mode === 'alone' || o.mode === 'reconnecting';
  const teen = o.mode === 'teen';
  let state: SocialState = own
    ? {
      ...NO_SOCIAL_STATE,
      profile: profileFor(teen ? 'teen' : 'adult', teen ? 'Swift Falcon 42' : 'Doruk', {
        ...(o.mode === 'suspended' ? { publicBlockedUntil: now + 3 * 86_400_000 } : {}),
        ...(o.mode === 'muted' ? { mutedUntil: now + 24 * 3_600_000 } : {}),
        ...(o.mode === 'alone' ? { counts: { friends: 0, incoming: 0, outgoing: 0, blocks: 0 } } : {}),
      }),
      friends: o.mode === 'alone' ? [] : friends0,
      requests: { incoming: o.mode === 'alone' ? [] : incoming0, outgoing: [] },
      recovery: o.mode === 'recovery' ? DEMO_RECOVERY : null,
      bannedUntil: o.mode === 'banned' ? now + 5 * 86_400_000 : null,
      hub: o.mode === 'replaced' ? 'replaced' : o.mode === 'reconnecting' ? 'connecting' : 'online',
    }
    : {
      ...NO_SOCIAL_STATE,
      noOnline: o.mode === 'young' ? 'young' : o.mode === 'kid' ? 'kid' : null,
      signedOut: o.mode === 'deleted' ? 'deleted' : o.mode === 'unknown' ? 'unknown_device' : null,
    };
  state = { ...state, status: 'loading' };
  const set = (patch: Partial<SocialState>): void => { state = { ...state, ...patch }; listeners.fire(); };
  const counts = (): void => {
    if (!state.profile) return;
    set({ profile: { ...state.profile, counts: { friends: state.friends.length, incoming: state.requests.incoming.length, outgoing: state.requests.outgoing.length, blocks: state.blocks.length } } });
  };

  const LOBBY_SEEDS = [{ band: 'medium', n: 2, host: 'Kestrel' }, { band: 'easy', n: 1, host: 'Maple' }, { band: 'hard', n: 3, host: 'Orbit' }, { band: 'medium', n: 4, host: 'Lumen' }] as const;
  const lobbies: LobbyEntry[] = LOBBY_SEEDS.map((l, i) => ({
    code: `LBY${'ABCD'[i]}22`, game: 'squat-flap', region: 'eu', band: l.band, size: 4, players: l.n, open: 4 - l.n, hostName: l.host, names: [l.host], phase: 'lobby', createdAt: now - i * 1000, updatedAt: now,
  }));

  let renames = 0;
  let inviteSeq = 0;
  const bandOf = (): AgeBand => state.profile?.band ?? 'adult';

  const social: SocialPort = {
    state: () => state,
    subscribe: (cb) => listeners.add(cb),
    notices(cb) { noticeSubs.add(cb); return () => { noticeSubs.delete(cb); }; },
    async open() {
      note('open');
      set({ status: down ? 'offline' : 'ready' });
    },
    close() { note('close'); },
    setActive(active) { note('setActive', active); },
    setStatus(status, game) { note('setStatus', status, game); },
    takeOver() { note('takeOver'); set({ hub: 'online' }); },
    declareTooYoung() { note('declareTooYoung'); set({ noOnline: 'young' }); },
    dismissRecovery() { set({ recovery: null }); },
    recheck() { /* the practice port has one profile */ },

    async createProfile({ band, name }) {
      note('createProfile', band, name);
      if (down) return { ok: false, code: 'network' };
      if (band === 'child') return { ok: false, code: 'child_no_online' };
      const profile = profileFor(band, name ?? randomPresetName(), { counts: { friends: 0, incoming: 0, outgoing: 0, blocks: 0 } });
      set({ profile, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [], recovery: DEMO_RECOVERY, signedOut: null, noOnline: null, status: 'ready', hub: 'online' });
      return { ok: true, value: profile };
    },
    async recoverProfile({ code, recovery }) {
      note('recoverProfile', code, recovery);
      if (down) return { ok: false, code: 'network' };
      const chars = parseFriendCode(code);
      const typed = parseRecoveryCode(recovery);
      if (!chars) return { ok: false, code: 'bad_request', field: 'code' };
      if (!typed) return { ok: false, code: 'bad_request', field: 'recovery' };
      if (code.toUpperCase().includes('ZZZZZZ')) return { ok: false, code: 'too_many_attempts', retryAfterMs: 55 * 60_000 };
      if (chars !== '7K2Q4X' || formatRecoveryCode(typed) !== DEMO_RECOVERY) return { ok: false, code: 'recovery_failed' };
      const profile = profileFor('adult', 'Doruk');
      set({ profile, friends: friends0, requests: { incoming: incoming0, outgoing: [] }, blocks: [], recovery: null, signedOut: null, noOnline: null, status: 'ready', hub: 'online' });
      return { ok: true, value: profile };
    },
    async updateProfile(change) {
      note('updateProfile', change);
      const p = state.profile;
      if (!p) return { ok: false, code: 'unauthorized' };
      if (change.name !== undefined || change.reroll) {
        if (renames >= 3) return { ok: false, code: 'rate_limited', retryAfterMs: 5 * 3_600_000 };
        renames += 1;
      }
      let name = p.name;
      if (change.reroll) name = randomPresetName();
      else if (change.name !== undefined) {
        const r = checkName(change.name);
        if (!r.ok) return { ok: false, code: 'name_rejected', reason: r.reason };
        name = r.text;
      }
      let band = p.band;
      if (change.band !== undefined) {
        if (change.band === 'child') return { ok: false, code: 'child_no_online' };
        if (change.band === 'adult' && p.band !== 'adult') return { ok: false, code: 'band_locked' };
        band = change.band;
        if (band !== 'adult') name = randomPresetName();
      }
      const pol = policyFor(band);
      const next: MyProfile = {
        ...p, name, band,
        ...(change.dnd !== undefined ? { dnd: change.dnd } : {}),
        ...(change.region !== undefined ? { region: change.region as MyProfile['region'] } : {}),
        ...(change.level !== undefined ? { level: change.level } : {}),
        can: { freeName: !pol.presetNameOnly, freeText: pol.freeText, video: pol.video, publicPlay: pol.publicPlay, maxFriends: pol.maxFriends },
      };
      set({ profile: next });
      return { ok: true, value: next };
    },
    async renewCode() {
      note('renewCode');
      const p = state.profile;
      if (!p) return { ok: false, code: 'unauthorized' };
      const code = `BA-${['N3WC8D', 'P4SS9K', 'Q5TT2M'][renames % 3] ?? 'N3WC8D'}`;
      const next = { ...p, code, link: friendLink(origin, code.slice(3)) };
      set({ profile: next });
      return { ok: true, value: next };
    },
    async renewRecovery() {
      note('renewRecovery');
      if (!state.profile) return { ok: false, code: 'unauthorized' };
      set({ recovery: '9JXK-2MQR-VTWB-C4HN' });
      return { ok: true, value: '9JXK-2MQR-VTWB-C4HN' };
    },
    async exportData() {
      note('exportData');
      const p = state.profile;
      if (!p) return { ok: false, code: 'unauthorized' };
      const { counts: _counts, can: _can, ...profile } = p;
      return { ok: true, value: { exportedAt: Date.now(), profile, friends: state.friends.map((f) => ({ fid: f.fid, name: f.name, since: f.since })), incoming: [...state.requests.incoming], outgoing: [...state.requests.outgoing], blocks: [...state.blocks], scores: [], sync: {}, reportsFiled: 0, reportsAgainstYou: 0 } };
    },
    async deleteProfile() {
      note('deleteProfile');
      set({ profile: null, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [], invites: [], recovery: null, hub: 'idle', bannedUntil: null });
      return OK;
    },

    async addByCode(code) {
      note('addByCode', code);
      if (down) return { ok: false, code: 'network' };
      if (code === 'BA-7K2Q4X') return { ok: false, code: 'self' };
      if (state.friends.some((f) => f.fid.startsWith(code.slice(3, 7)))) return { ok: false, code: 'already_friends' };
      if (code === 'BA-BBBBBB') return { ok: false, code: 'not_found' };
      if (code === 'BA-CCCCCC') return { ok: false, code: 'rate_limited', retryAfterMs: 40_000 };
      if (code === 'BA-DDDDDD') return { ok: false, code: 'too_many_attempts', retryAfterMs: 20 * 60_000 };
      if (code === 'BA-EEEEEE') return { ok: false, code: 'friends_full', who: 'me' };
      if (code === 'BA-FFFFFF') return { ok: false, code: 'requests_full' };
      if (code === 'BA-GGGGGG') return { ok: false, code: 'you_blocked' };
      if (code === 'BA-AAAAAA') {
        const friend: FriendEntry = { fid: 'ZEDDD23456', name: 'Zed', band: 'adult', since: Date.now(), presence: { status: 'online' } };
        set({ friends: [...state.friends, friend] });
        counts();
        return { ok: true, value: { status: 'friends', friend: { fid: friend.fid, name: friend.name, band: friend.band } } };
      }
      // Whatever the other side does with it (a blocked sender, a young player and an adult), the answer is the same: sent.
      const out: OutgoingRequest = { fid: `REQ${code.slice(3)}`.slice(0, 10), name: `Player ${code.slice(3, 7)}`, at: Date.now() };
      set({ requests: { ...state.requests, outgoing: [...state.requests.outgoing, out] } });
      counts();
      return { ok: true, value: { status: 'sent' } };
    },
    async answer(fid, accept) {
      note('answer', fid, accept);
      const req = state.requests.incoming.find((r) => r.fid === fid);
      if (!req) return { ok: false, code: 'not_found' };
      if (accept && fid === 'FULL234567') return { ok: false, code: 'friends_full', who: 'them' };
      const friend: FriendEntry = { fid: req.fid, name: req.name, band: 'adult', since: Date.now(), presence: { status: 'online' } };
      set({ requests: { ...state.requests, incoming: state.requests.incoming.filter((r) => r.fid !== fid) }, ...(accept ? { friends: [...state.friends, friend] } : {}) });
      counts();
      return OK;
    },
    async cancelRequest(fid) { note('cancelRequest', fid); set({ requests: { ...state.requests, outgoing: state.requests.outgoing.filter((r) => r.fid !== fid) } }); counts(); return OK; },
    async unfriend(fid) { note('unfriend', fid); set({ friends: state.friends.filter((f) => f.fid !== fid) }); counts(); return OK; },
    async block(fid) {
      note('block', fid);
      const f = state.friends.find((x) => x.fid === fid);
      const entry: BlockEntry = { fid, name: f?.name ?? 'Player', at: Date.now() };
      set({ friends: state.friends.filter((x) => x.fid !== fid), blocks: [...state.blocks, entry] });
      counts();
      return OK;
    },
    async unblock(fid) { note('unblock', fid); set({ blocks: state.blocks.filter((b) => b.fid !== fid) }); counts(); return OK; },
    async report(r) { note('report', r); if (r.alsoBlock) await social.block(r.fid); return OK; },
    async invite(fid, room) {
      note('invite', fid, room);
      const f = state.friends.find((x) => x.fid === fid);
      if (!f || f.presence.status === 'offline') return { ok: false, code: 'offline' };
      return { ok: true, value: { id: `inv${++inviteSeq}`, exp: Date.now() + 120_000 } };
    },
    async answerInvite(invite, accept) {
      note('answerInvite', invite.id, accept);
      set({ invites: state.invites.filter((i) => i.id !== invite.id) });
      return OK;
    },
    async lobbies(q) {
      note('lobbies', q);
      if (down) return { ok: false, code: 'network' };
      if (state.profile && state.profile.publicBlockedUntil > Date.now()) return { ok: false, code: 'public_suspended', until: state.profile.publicBlockedUntil };
      return { ok: true, value: lobbies.map((l) => ({ ...l, game: q.game })) };
    },
    async quickMatch(q) {
      note('quickMatch', q.game);
      if (o.quick !== 'never') return { ok: true, value: { outcome: 'joined', code: lobbies[0]?.code ?? 'LBYA22' } };
      const t0 = Date.now();
      const poll = 4000 / scale;
      for (;;) {
        if (q.signal.aborted) return { ok: true, value: { outcome: 'stopped', hosting: null } };
        const waitedMs = (Date.now() - t0) * scale;
        if (waitedMs > 120_000) return { ok: true, value: { outcome: 'timeout', hosting: null } };
        q.onProgress({ phase: waitedMs > 6_000 ? 'hosting' : 'searching', waitedMs, code: waitedMs > 6_000 ? 'HOSTED' : null, offerGhost: waitedMs >= 20_000 });
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, poll);
          q.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    },

    async leaderboard(q) {
      note('leaderboard', q);
      if (down) return { ok: false, code: 'network' };
      const entries: BoardEntry[] = q.scope === 'friends'
        ? [{ rank: 1, name: 'Mert', score: 4820, you: false, fid: 'MERT234567' }, { rank: 2, name: state.profile?.name ?? 'You', score: 4310, you: true, fid: ME_FID }, { rank: 3, name: 'Selin', score: 3975, you: false, fid: 'SELIN23456' }, { rank: 4, name: 'Ayşe', score: 2210, you: false, fid: 'AYSE234567' }]
        : [{ rank: 1, name: 'Kestrel', score: 9120, you: false }, { rank: 2, name: 'Maple', score: 8470, you: false }, { rank: 3, name: 'Orbit', score: 7900, you: false }, { rank: 41, name: state.profile?.name ?? 'You', score: 4310, you: true }];
      const start = Date.UTC(2026, 9, 19) - (q.week === 'previous' ? WEEK : 0);
      const view: BoardView = {
        game: q.game, scope: q.scope as BoardScope, week: { id: q.week === 'previous' ? 2979 : 2980, start, end: start + WEEK, current: q.week === 'current' },
        country: q.scope === 'country' ? 'TR' : null, entries, you: { score: 4310, rank: q.scope === 'friends' ? 2 : 41, atLeast: false },
      };
      return { ok: true, value: view };
    },
    async startRun(game) { note('startRun', game); return { ok: true, value: { run: 'demo-run', game, at: Date.now() } }; },
    async finishRun(ticket, score) { note('finishRun', ticket.game, score); return { ok: true, value: { improved: true, best: score, week: 2980 } }; },

    syncPort: () => null,
    serverNow: () => Date.now(),
  };

  // ---- rooms ----

  let room: RoomState = NO_ROOM_STATE;
  let feedId = 0;
  const setRoom = (patch: Partial<RoomState>): void => { room = { ...room, ...patch }; roomListeners.fire(); };
  const member = (seat: string, name: string, extra: Partial<MemberInfo> = {}): MemberInfo => ({ seat, name, host: false, online: true, ready: false, sess: seat, video: false, ...extra });
  const feed = (f: Omit<FeedItem, 'id' | 'at'>): FeedItem => ({ ...f, id: ++feedId, at: Date.now() });
  const patchMember = (seat: string, p: Partial<MemberInfo>): void => setRoom({ members: room.members.map((m) => (m.seat === seat ? { ...m, ...p } : m)) });
  const meSeat = 's1';

  const info = (code: string, kind: 'private' | 'public', game: string, band: string | null, host: string): RoomInfo => ({
    code, kind, size: 4, host, config: { gameId: game, durationMs: 90_000, band }, chat: kind === 'private' && bandOf() === 'adult' ? 'text' : 'preset', video: kind === 'private' && bandOf() === 'adult', phase: 'lobby',
  });

  const rooms: RoomPort = {
    state: () => room,
    subscribe: (cb) => roomListeners.add(cb),
    async create({ game, kind, band }) {
      note('rooms.create', game, kind);
      const code = o.roomCode ?? randomRoomCode();
      const me = member(meSeat, state.profile?.name ?? 'You', { host: true, ready: true });
      room = {
        phase: 'lobby', info: info(code, kind, game, band, meSeat), me: meSeat, problem: null, shareVideo: false, link: inviteLink(origin, code),
        members: [me, member('s2', 'Elif', { ready: true, video: true }), member('s3', 'Mert')],
        feed: [feed({ seat: 's2', say: 'ready' }), feed({ seat: 's3', react: 'clap' })],
      };
      roomListeners.fire();
      return { ok: true, value: code };
    },
    async join(code) {
      note('rooms.join', code);
      if (code === 'FULL22') { setRoom({ ...NO_ROOM_STATE, phase: 'closed', problem: 'full' }); return { ok: false, code: 'full' }; }
      if (code === 'GNE222') { setRoom({ ...NO_ROOM_STATE, phase: 'closed', problem: 'no_room' }); return { ok: false, code: 'no_room' }; }
      room = {
        phase: 'lobby', info: info(code, 'private', 'squat-flap', null, 's2'), me: meSeat, problem: null, shareVideo: false, link: inviteLink(origin, code),
        members: [member('s2', 'Elif', { host: true, ready: true, video: true }), member(meSeat, state.profile?.name ?? 'You'), member('s3', 'Mert', { ready: true })],
        feed: [feed({ seat: 's2', say: 'hi' })],
      };
      roomListeners.fire();
      return OK_ROOM;
    },
    setReady(ready) {
      patchMember(meSeat, { ready });
      // The Room starts the match by itself when every member is ready and online.
      if (ready && room.members.length >= 2 && room.members.every((m) => m.ready && m.online)) setTimeout(() => { if (room.info) setRoom({ phase: 'playing', info: { ...room.info, phase: 'playing' } }); }, 600);
    },
    chooseGame(game) { if (room.info) setRoom({ info: { ...room.info, config: { ...room.info.config, gameId: game } } }); },
    start() { /* the Room starts the match by itself */ },
    leave() { if (room.phase !== 'idle') { room = NO_ROOM_STATE; roomListeners.fire(); } },
    say(id) { setRoom({ feed: [...room.feed, feed({ seat: meSeat, say: id })] }); },
    react(id) { setRoom({ feed: [...room.feed, feed({ seat: meSeat, react: id })] }); },
    sendText(text) { setRoom({ feed: [...room.feed, feed({ seat: meSeat, text })] }); return { ok: true }; },
    setShareVideo(on) { setRoom({ shareVideo: on }); patchMember(meSeat, { video: on }); },
    remind(seat) { for (const m of room.members) if (m.seat !== meSeat && !m.ready && (seat === undefined || m.seat === seat)) setTimeout(() => patchMember(m.seat, { ready: true }), 250); },
    reportSeat(seat, reason, alsoBlock) { note('rooms.reportSeat', seat, reason, alsoBlock); },
    blockSeat(seat) { note('rooms.blockSeat', seat); setRoom({ members: room.members.filter((m) => m.seat !== seat) }); },
  };

  const control: DemoSocialControl = {
    invite(from, game = 'squat-flap', code = 'INV222') {
      const inv: PendingInvite = { id: `demo${++inviteSeq}`, from: { fid: `INV${from}`.slice(0, 10).padEnd(10, '2'), name: from }, room: code, game, exp: Date.now() + 120_000 };
      set({ invites: [...state.invites, inv] });
      notify({ kind: 'invite', invite: inv });
    },
    request(name) {
      const r: IncomingRequest = { fid: `REQ${name}`.slice(0, 10).padEnd(10, '2'), name, at: Date.now(), via: 'link' };
      set({ requests: { ...state.requests, incoming: [r, ...state.requests.incoming] } });
      counts();
      notify({ kind: 'request', name });
    },
    presence(name, presence) { set({ friends: state.friends.map((f) => (f.name === name ? { ...f, presence } : f)) }); },
    hub(status) { set({ hub: status }); },
    offline(on) { down = on; set({ status: on ? 'offline' : 'ready' }); },
    calls: () => [...log],
  };
  if (typeof window !== 'undefined') window.__BA_SOCIAL__ = control;

  return { social, rooms };
}
