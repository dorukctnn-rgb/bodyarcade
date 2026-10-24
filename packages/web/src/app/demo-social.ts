// A practice implementation of the social and room ports, in memory: the friends, requests, lobbies and a room of the
// art director's mock, so the screens can be developed, photographed and tested before the server exists. Development
// and test builds only (boot.ts); a published build has no way to reach it.
import { inviteLink, randomRoomCode } from '../../../core/net/codes.ts';
import { policyFor } from '../../../core/social/age.ts';
import { friendLink } from '../../../core/social/codes.ts';
import { randomPresetName } from '../../../core/social/presets.ts';
import type { AgeBand, BlockEntry, FriendEntry, IncomingRequest, LobbyEntry, MyProfile, OutgoingRequest } from '../../../core/social/types.ts';
import type { MemberInfo, RoomInfo } from '../../../core/types/net.ts';
import { NO_ROOM_STATE, NO_SOCIAL_STATE, type Done, type FeedItem, type RoomDone, type RoomPort, type RoomState, type SocialPort, type SocialServices, type SocialState } from '../social/port.ts';

export type DemoSocialMode = 'ready' | 'fresh' | 'offline';

export interface DemoSocialOptions {
  mode: DemoSocialMode;
  origin?: string;
  /** Fixed room code (tests); random otherwise. */
  roomCode?: string;
}

const ME_FID = 'DEMOME2345';
const OK: Done = { ok: true, value: undefined };
const OK_ROOM: RoomDone = { ok: true, value: undefined };

class Listeners {
  private readonly all = new Set<() => void>();
  add(cb: () => void): () => void { this.all.add(cb); return () => { this.all.delete(cb); }; }
  fire(): void { for (const cb of [...this.all]) cb(); }
}

export function createDemoSocial(o: DemoSocialOptions): SocialServices {
  const origin = o.origin ?? 'https://bodyarcade.com';
  const now = Date.now();
  const listeners = new Listeners();
  const roomListeners = new Listeners();

  const profileFor = (band: AgeBand, name: string): MyProfile => {
    const p = policyFor(band);
    return {
      fid: ME_FID, name, code: 'BA-7K2Q4X', link: friendLink(origin, '7K2Q4X'), band, level: 12, region: 'eu', lang: 'en', dnd: false, createdAt: now, mutedUntil: 0, publicBlockedUntil: 0,
      counts: { friends: 4, incoming: 1, outgoing: 0, blocks: 0 },
      can: { freeName: !p.presetNameOnly, freeText: p.freeText, video: p.video, publicPlay: p.publicPlay, maxFriends: p.maxFriends },
    };
  };

  const friends0: FriendEntry[] = [
    { fid: 'MERT234567', name: 'Mert', band: 'adult', since: now, presence: { status: 'online' } },
    { fid: 'AYSE234567', name: 'Ayşe', band: 'adult', since: now, presence: { status: 'playing', game: 'star-catch' } },
    { fid: 'CAN2345678', name: 'Can', band: 'adult', since: now, presence: { status: 'offline' } },
    { fid: 'SELIN23456', name: 'Selin', band: 'adult', since: now, presence: { status: 'offline' } },
  ];
  const incoming0: IncomingRequest[] = [{ fid: 'ELIF234567', name: 'Elif', at: now, via: 'code' }];

  let state: SocialState = o.mode === 'ready'
    ? { status: 'loading', profile: profileFor('adult', 'Doruk'), friends: friends0, requests: { incoming: incoming0, outgoing: [] }, blocks: [] }
    : { ...NO_SOCIAL_STATE };
  const set = (patch: Partial<SocialState>): void => { state = { ...state, ...patch }; listeners.fire(); };
  const counts = (): void => {
    if (!state.profile) return;
    set({ profile: { ...state.profile, counts: { friends: state.friends.length, incoming: state.requests.incoming.length, outgoing: state.requests.outgoing.length, blocks: state.blocks.length } } });
  };

  const LOBBY_SEEDS = [{ band: 'medium', n: 2, host: 'Kestrel' }, { band: 'easy', n: 1, host: 'Maple' }, { band: 'hard', n: 3, host: 'Orbit' }, { band: 'medium', n: 4, host: 'Lumen' }] as const;
  const lobbies: LobbyEntry[] = LOBBY_SEEDS.map((l, i) => ({
    code: `LBY${'ABCD'[i]}22`, game: 'squat-flap', region: 'eu', band: l.band, size: 4, players: l.n, open: 4 - l.n, hostName: l.host, names: [l.host], phase: 'lobby', createdAt: now - i * 1000, updatedAt: now,
  }));

  const social: SocialPort = {
    state: () => state,
    subscribe: (cb) => listeners.add(cb),
    async open() {
      set({ status: o.mode === 'offline' ? 'offline' : 'ready' });
    },
    close() { /* nothing is open */ },
    async createProfile({ band, name }) {
      const profile = profileFor(band, name ?? randomPresetName());
      set({ profile, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [] });
      return { ok: true, value: profile };
    },
    async addByCode(code) {
      if (code === 'BA-7K2Q4X') return { ok: false, code: 'self' };
      if (state.friends.some((f) => f.fid.startsWith(code.slice(3, 7)))) return { ok: false, code: 'already_friends' };
      if (code === 'BA-BBBBBB') return { ok: false, code: 'not_found' };
      if (code === 'BA-CCCCCC') return { ok: false, code: 'rate_limited' };
      if (code === 'BA-AAAAAA') {
        const friend: FriendEntry = { fid: 'ZEDDD23456', name: 'Zed', band: 'adult', since: Date.now(), presence: { status: 'online' } };
        set({ friends: [...state.friends, friend] });
        counts();
        return { ok: true, value: { status: 'friends', friend: { fid: friend.fid, name: friend.name, band: friend.band } } };
      }
      const out: OutgoingRequest = { fid: `REQ${code.slice(3)}`.slice(0, 10), name: `Player ${code.slice(3, 7)}`, at: Date.now() };
      set({ requests: { ...state.requests, outgoing: [...state.requests.outgoing, out] } });
      counts();
      return { ok: true, value: { status: 'sent' } };
    },
    async answer(fid, accept) {
      const req = state.requests.incoming.find((r) => r.fid === fid);
      if (!req) return { ok: false, code: 'not_found' };
      const friend: FriendEntry = { fid: req.fid, name: req.name, band: 'adult', since: Date.now(), presence: { status: 'online' } };
      set({ requests: { ...state.requests, incoming: state.requests.incoming.filter((r) => r.fid !== fid) }, ...(accept ? { friends: [...state.friends, friend] } : {}) });
      counts();
      return OK;
    },
    async cancelRequest(fid) { set({ requests: { ...state.requests, outgoing: state.requests.outgoing.filter((r) => r.fid !== fid) } }); counts(); return OK; },
    async unfriend(fid) { set({ friends: state.friends.filter((f) => f.fid !== fid) }); counts(); return OK; },
    async block(fid) {
      const f = state.friends.find((x) => x.fid === fid);
      const entry: BlockEntry = { fid, name: f?.name ?? 'Player', at: Date.now() };
      set({ friends: state.friends.filter((x) => x.fid !== fid), blocks: [...state.blocks, entry] });
      counts();
      return OK;
    },
    async unblock(fid) { set({ blocks: state.blocks.filter((b) => b.fid !== fid) }); counts(); return OK; },
    async report(r) { if (r.alsoBlock) await social.block(r.fid); return OK; },
    async invite() { return OK; },
    async lobbies(q) { return { ok: true, value: lobbies.map((l) => ({ ...l, game: q.game })) }; },
    async quickMatch(q) {
      void q;
      return { ok: true, value: { action: 'join', code: lobbies[0]?.code ?? 'LBYA22', searchId: 'demo' } };
    },
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
    code, kind, size: 4, host, config: { gameId: game, durationMs: 90_000, band }, chat: kind === 'private' ? 'text' : 'preset', video: kind === 'private', phase: 'lobby',
  });

  const rooms: RoomPort = {
    state: () => room,
    subscribe: (cb) => roomListeners.add(cb),
    async create({ game, kind, band }) {
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
  };

  return { social, rooms };
}
