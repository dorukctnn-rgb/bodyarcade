// The rooms side of the friends screens on the live client (builder N): one LiveClient per room, mapped onto the RoomPort
// the views draw from. The room is a service of the app, not of a page: the player goes from the room page to the stage of a
// race and back with the same client, so a race starts from a lobby that never noticed the page change.
//
// What the Room does on its own and this does not repeat: it starts the match itself when every member is ready and online
// (there is no start button), it decides who may chat in free text, who may share a camera and what a stranger may see, and whether a Pro
// game may start (it asks for the host's signed Pro token: `deps.pro` hands it over, and `proNeeded()` says when it was refused).
import { LiveClient, type FatalReason, type LiveClientOptions } from '../../../core/net/client.ts';
import { createRoom, fetchIce, joinRoom, LiveApiError, type Identity } from '../../../core/net/api.ts';
import { inviteLink, normalizeRoomCode } from '../../../core/net/codes.ts';
import { DEFAULT_DURATION_MS, MAX_DURATION_MS, MIN_DURATION_MS, type JoinGrant, type RoomKind } from '../../../core/types/net.ts';
import type { Unsubscribe } from '../../../core/types/index.ts';
import type { LevelBand } from '../../../core/social/types.ts';
import { NO_ROOM_STATE, type FeedItem, type RoomDone, type RoomPort, type RoomProblem, type RoomState } from '../social/port.ts';

export type { Identity };

export interface LiveRoomDeps {
  /** Where the Worker is: the page's own origin. */
  origin: string;
  /** Who is playing: a device id, a name that has passed the filter and the age the player declared. Null until the age question is answered. */
  identity(): Identity | null;
  /** The fetch that carries the player's identity (the signed one of the social client); the plain one when there is none. */
  fetcher?: typeof fetch;
  /** A client of the Worker's room (tests give it fake sockets and a manual clock). */
  makeClient?: (o: LiveClientOptions) => LiveClient;
  /** The block keys this device holds (opaque, kept between visits). */
  blocks?: { load(): string[]; save(keys: string[]): void };
  /** The camera for sharing with friends (only called when the player switches sharing on). */
  openCamera?: () => Promise<MediaStream>;
  /** The match length for a new room when the caller does not say. */
  durationMs?: number;
  /**
   * The player's signed entitlement token, asked for at every create, join and ticket renewal so it is always the current one
   * (`() => entitlements.current().token`), or null for a free player. A Pro game starts in a room only with a Pro host's token behind it;
   * players who join never need one. Without this a player is free as far as rooms are concerned.
   */
  pro?: () => string | null | undefined;
}

const FEED_MAX = 40;

/** A room that is left or joined starts clean: the camera notes, the last refusal and the connection of the room before do not carry over. */
const FRESH: RoomState = { ...NO_ROOM_STATE, videos: undefined, rejected: undefined, connection: undefined };

const FATAL_PROBLEM: Readonly<Record<FatalReason, RoomProblem>> = {
  replaced: 'replaced', full: 'full', removed: 'removed', no_room: 'no_room', version: 'version', not_allowed: 'not_allowed', ticket: 'ticket', stopped: 'offline',
};

/** What a failed call to the Worker means for the player. */
export function problemOf(e: unknown): RoomProblem {
  if (e instanceof LiveApiError) {
    switch (e.code) {
      case 'no_room': case 'bad_code': return 'no_room';
      case 'full': return 'full';
      case 'not_allowed': case 'age_not_allowed': case 'pro_required': return 'not_allowed';
      default: return e.status === 0 || e.status >= 500 || e.status === 429 ? 'offline' : 'not_allowed';
    }
  }
  return 'offline';
}

/** A match length the Room accepts, in whole seconds. */
export const clampDuration = (ms: number): number => Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(ms / 1000) * 1000));

/**
 * The host tried to make a room with a Pro game, or to pick one in a room, and the Worker or the Room did not find a Pro token of the host that checks out.
 * `reason`: none (the player has no Pro token to show), expired (the app has not renewed it: open it online), invalid, refused (the Room said so
 * while picking a game and the page cannot tell why). The screen answers with the paywall (or a "renew" line) instead of a bare error.
 */
export interface ProNeeded {
  game: string;
  reason: 'none' | 'expired' | 'invalid' | 'refused';
  at: number;
}

export interface LiveRoomPort extends RoomPort {
  /** The client of the room that is open (the stage of a race plays through it), or null. */
  client(): LiveClient | null;
  /**
   * The last Pro refusal, or null. Cleared by the next try to make or join a room, when the Room takes the game that was picked (a free game,
   * or a Pro game with a proof behind it), when the room is left, and by dismissProNeeded. Listeners of `subscribe` are called when it changes.
   */
  proNeeded(): ProNeeded | null;
  dismissProNeeded(): void;
}

export function createLiveRoomPort(deps: LiveRoomDeps): LiveRoomPort {
  const listeners = new Set<() => void>();
  let state: RoomState = NO_ROOM_STATE;
  let client: LiveClient | null = null;
  let offs: Unsubscribe[] = [];
  let feedId = 0;
  let stream: MediaStream | null = null;
  /** Counts rooms: a late event of a room that was left changes nothing. */
  let epoch = 0;
  let needed: ProNeeded | null = null;
  /** The game the host asked for last (a Pro refusal from the Room names it). */
  let picked: string | null = null;
  const setNeeded = (v: ProNeeded | null): void => {
    if (v === null && needed === null) return;
    needed = v;
    for (const cb of [...listeners]) cb();
  };

  const set = (patch: Partial<RoomState>): void => {
    state = { ...state, ...patch };
    for (const cb of [...listeners]) cb();
  };

  const releaseStream = (): void => {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
  };

  function detach(): void {
    epoch++;
    for (const off of offs.splice(0)) off();
    client?.stop();
    client = null;
    releaseStream();
  }

  function pushFeed(item: Omit<FeedItem, 'id'>): void {
    set({ feed: [...state.feed, { ...item, id: ++feedId }].slice(-FEED_MAX) });
  }

  function attach(grant: JoinGrant, who: Identity, proSent: string | null): void {
    detach();
    const mine = epoch;
    const live = (): boolean => mine === epoch;
    const c = (deps.makeClient ?? ((o) => new LiveClient(o)))({
      grant, origin: deps.origin, blocks: deps.blocks?.load() ?? [], peers: 'webrtc',
      refreshTicket: () => joinRoom(deps.origin, grant.code, who, deps.fetcher, deps.pro?.()),
      ...(deps.pro ? { pro: deps.pro, proSent } : {}),
      ice: () => fetchIce(deps.origin, deps.fetcher),
    });
    client = c;
    set({ ...FRESH, phase: 'joining', link: grant.link || inviteLink(deps.origin, grant.code) });
    offs.push(
      c.on('welcome', (w) => {
        if (!live()) return;
        set({ phase: w.match && w.match.phase !== 'over' ? 'playing' : 'lobby', info: w.room, members: w.members, me: w.you, problem: null, connection: 'online' });
      }),
      c.on('presence', (members) => { if (live()) set({ members }); }),
      c.on('room', (info) => {
        if (!live()) return;
        set({ info });
        if (picked !== null && info.config.gameId === picked && info.pro?.ok !== false) { picked = null; setNeeded(null); }
      }),
      c.on('roomError', (e) => {
        if (live() && e.code === 'pro_required') setNeeded({ game: picked ?? c.room?.config.gameId ?? '', reason: 'refused', at: Date.now() });
      }),
      c.on('match', () => { if (live()) set({ phase: 'playing' }); }),
      c.on('result', () => { if (live()) set({ phase: 'lobby' }); }),
      c.on('chat', (m) => { if (live()) pushFeed({ seat: m.from, text: m.text, at: m.at }); }),
      c.on('preset', (m) => { if (live()) pushFeed({ seat: m.from, say: m.id, at: m.at }); }),
      c.on('react', (m) => { if (live()) pushFeed({ seat: m.from, react: m.id, at: m.at }); }),
      c.on('chatRejected', (m) => { if (live()) set({ rejected: { reason: m.reason, at: Date.now() } }); }),
      c.on('blocked', () => { if (live()) deps.blocks?.save(c.blocks); }),
      c.on('status', (s) => { if (live()) set({ connection: s.state === 'online' ? 'online' : s.state === 'stopped' ? 'stopped' : 'reconnecting' }); }),
      c.on('video', () => { if (live()) set({ videos: c.videoStatuses() }); }),
      c.on('removed', () => { if (live()) set({ phase: 'closed', problem: 'removed' }); }),
      c.on('fatal', (f) => { if (live()) set({ phase: 'closed', problem: FATAL_PROBLEM[f.reason] ?? 'offline' }); }),
    );
    void c.start();
  }

  async function open(grantFor: (who: Identity, pro: string | null) => Promise<JoinGrant>, game: string | null = null): Promise<RoomDone<string>> {
    const who = deps.identity();
    if (!who) return { ok: false, code: 'not_allowed' };
    set({ ...FRESH, phase: 'joining' });
    picked = null;
    setNeeded(null);                                                // a new try ends the note of an earlier one
    const pro = deps.pro?.() ?? null;
    try {
      const grant = await grantFor(who, pro);
      attach(grant, who, pro);
      return { ok: true, value: grant.code };
    } catch (e) {
      const code = problemOf(e);
      if (e instanceof LiveApiError && e.code === 'pro_required') {
        const why = e.info?.reason;
        setNeeded({ game: game ?? '', reason: why === 'expired' || why === 'invalid' ? why : 'none', at: Date.now() });
      }
      set({ ...FRESH, phase: 'closed', problem: code });
      return { ok: false, code };
    }
  }

  return {
    state: () => state,
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    client: () => client,

    create(o) {
      const kind: RoomKind = o.kind;
      return open((who, pro) => createRoom(deps.origin, who, {
        kind, gameId: o.game, size: Math.min(4, Math.max(2, o.size)), durationMs: clampDuration(o.durationMs ?? deps.durationMs ?? DEFAULT_DURATION_MS),
        band: kind === 'public' ? (o.band as LevelBand | null) : null,
      }, deps.fetcher, pro), o.game);
    },

    async join(raw) {
      const code = normalizeRoomCode(raw);
      if (!code) return { ok: false, code: 'no_room' };
      if (client && state.info?.code === code && state.phase !== 'closed') return { ok: true, value: undefined };
      const r = await open((who, pro) => joinRoom(deps.origin, code, who, deps.fetcher, pro));
      return r.ok ? { ok: true, value: undefined } : r;
    },

    setReady(ready) { client?.setReady(ready); },
    chooseGame(game) {
      picked = game;
      // a Pro game: the client renews the ticket first when the player's token is newer than the one the Room read, then asks
      client?.configure({ gameId: game });
    },
    /** The Room starts the match by itself when everybody is ready: nothing to press. */
    start() { /* no-op */ },
    leave() {
      client?.leave();
      detach();
      picked = null;
      setNeeded(null);
      set({ ...FRESH });
    },
    say(id) { client?.preset(id); },
    react(id) { client?.react(id); },
    sendText(text) {
      if (!client || state.info?.chat !== 'text') return { ok: false, reason: 'not_allowed' };
      client.chat(text);
      return { ok: true };
    },
    setShareVideo(on) {
      const c = client;
      if (!c) return;
      if (!on) {
        c.setVideo(false);
        releaseStream();
        c.stream = null;
        set({ shareVideo: false });
        return;
      }
      const openCamera = deps.openCamera ?? (() => navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false }));
      set({ shareVideo: true });
      openCamera().then((s) => {
        if (client !== c) { for (const t of s.getTracks()) t.stop(); return; }
        stream = s;
        c.stream = s;
        c.setVideo(true);
      }).catch(() => { if (client === c) set({ shareVideo: false }); });
    },
    /** A nudge is the preset "ready?" to the room: the Room has no message to one seat. */
    remind() { client?.preset('ready'); },
    retryVideo(seat) { client?.retryVideo(seat); },
    proNeeded: () => needed,
    dismissProNeeded() { setNeeded(null); },
  };
}
