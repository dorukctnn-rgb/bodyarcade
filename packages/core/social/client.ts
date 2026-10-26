// The browser side of the social module: the passwordless profile (a device key that signs every request), friends and
// requests, blocks and reports, invitations, the public lobby list, quick match, the data export and deletion, and the
// hub socket that carries presence and pushes. It talks to packages/server/src/social and to live play's room API, and it
// has no DOM dependency beyond `fetch`, `WebSocket` and `indexedDB`, all of which a test can replace.
//
// How a screen uses it:
//   const social = new SocialClient({ origin: '', keys: await openKeyStore() });
//   const me = await social.init();                        // null on a device without a profile: show the sign-up
//   await social.signUp({ band: 'adult', name: 'Mia' });   // the age declaration is the first thing the sign-up asks
//   social.on('friends', render); social.on('requests', render); social.on('invites', render); social.on('hub', render);
//   social.connect();                                      // presence; call disconnect() when leaving
//   await social.sendRequest('BA-7K2Q4X');                 // a code, a link or a bare code; "Request sent" whatever follows
//   const grant = await social.createRoom({ kind: 'private', gameId: 'squat-flap' });   // live play, signed as this player
//   await social.invite(fid, grant.code);                  // a push to the friend's open hub socket
import { createRoom as apiCreateRoom, joinRoom as apiJoinRoom, type Identity, type NewRoomRequest } from '../net/api.ts';
import type { JoinGrant } from '../types/net.ts';
import { canGoOnline } from './age.ts';
import { formatRecoveryCode, parseFriendCode, parseFriendLink, parseRecoveryCode } from './codes.ts';
import type { KeyStore, StoredIdentity } from './keystore.ts';
import { isPresetName } from './presets.ts';
import { MAX_SEARCH_MS, POLL_EVERY_MS } from './quickmatch.ts';
import { PRESENCE } from './rules.ts';
import { AUTH_HEADER, AUTH_QUERY, generateDeviceKey, signRequest } from './sign.ts';
import {
  HUB_CLOSE,
  type AgeBand, type BlockEntry, type BoardScope, type BoardView, type DataExport, type FriendEntry, type HubCommand, type HubEvent, type LevelBand, type LobbyEntry,
  type MyProfile, type QuickAction, type ReportReason, type RequestResult, type RequestsView, type RunTicket, type ScoreResult, type SocialErrorBody, type SyncDoc, type SyncKey,
} from './types.ts';

// ───────── errors ─────────

/** A failed call. status 0 is a network failure (code 'network'); otherwise the server's status and `error` code. */
export class SocialApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | undefined;
  readonly body: SocialErrorBody | null;
  constructor(status: number, code: string, body: SocialErrorBody | null = null) {
    super(code);
    this.name = 'SocialApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = typeof body?.retryAfterMs === 'number' ? body.retryAfterMs : undefined;
    this.body = body;
  }
}

// ───────── types ─────────

/** idle: not connected on purpose. connecting/online: the hub socket. replaced: another tab or device took it (call connect()
 * to take it back). banned: the account is suspended. */
export type HubStatus = 'idle' | 'connecting' | 'online' | 'replaced' | 'banned';

/** A friend asked this player into a room. `exp` is server time; accept with joinRoom(room) or decline with declineInvite. */
export interface PendingInvite { id: string; from: { fid: string; name: string }; room: string; game: string; exp: number }

export interface SignUp {
  /** The age declaration (child under 16, teen 16-17, adult 18+). It decides everything the profile may do. */
  band: AgeBand;
  /** Adults: a name of their own, filtered by the server. Under 18: only a generated name (core/social/presets.ts randomPresetName) is taken; anything else is ignored and the server generates one. */
  name?: string;
  region?: string;
  lang?: string;
  level?: number;
  /** The version of the terms the player agreed to in the sign-up (core/social/rules.ts TERMS_VERSION); the server keeps it with the profile. */
  terms?: string;
}

export interface ProfileChange {
  name?: string;
  region?: string;
  lang?: string;
  level?: number;
  /** Appear offline to friends. */
  dnd?: boolean;
  /** Only downward (adult to teen to child); a higher band needs a new profile. */
  band?: AgeBand;
  /** A new generated name (under 18). */
  reroll?: boolean;
}

export interface SocialEvents {
  profile: MyProfile;
  friends: FriendEntry[];
  requests: RequestsView;
  blocks: BlockEntry[];
  invites: PendingInvite[];
  hub: HubStatus;
  /** A request arrived (for a toast); the list is in `requests`. */
  friendRequest: { fid: string; name: string; at: number; via: 'code' | 'link' };
  /** A request was accepted, or a request of the other player matched this player's own. */
  friendAdded: { fid: string; name: string; band: AgeBand };
  inviteDeclined: { id: string; fid: string };
  /** The profile is gone from this device (deleted, or the server no longer knows the key). Show the sign-up. */
  signedOut: { reason: 'deleted' | 'unknown_device' };
}

export interface MatchDriver {
  /** Opens a public room for the game (live play) and returns its code. */
  create(game: string, band: LevelBand): Promise<{ code: string }>;
  /** Takes a seat in a lobby (live play); throws when it is full or gone, the search then asks again. */
  join(code: string): Promise<unknown>;
  /** Leaves the room the search opened, before moving into an older lobby. */
  leave(code: string): Promise<void>;
}

export interface MatchProgress { phase: 'searching' | 'hosting'; waitedMs: number; code: string | null; offerGhost: boolean }

export type MatchOutcome =
  | { outcome: 'joined'; code: string }
  /** The caller stopped the search (or the room it opened filled up: it watches its own room). */
  | { outcome: 'stopped'; hosting: string | null }
  /** Two minutes without a match: offer the ghosts. */
  | { outcome: 'timeout'; hosting: string | null };

/** The subset of WebSocket the client needs, so tests can script it. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface SocialClientOptions {
  /** 'https://bodyarcade.com', or '' for the page's own origin. */
  origin: string;
  keys: KeyStore;
  fetch?: typeof fetch;
  WebSocket?: WebSocketCtor;
  /** The client clock (epoch ms); tests move it. */
  now?: () => number;
  random?: () => number;
}

type Listener<T> = (value: T) => void;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** A round trip longer than this does not correct the clock offset. */
const MAX_SYNC_ROUND_TRIP_MS = 10_000;
/** Silence for this long (three missed pings) and the socket is treated as half open. */
const STALE_AFTER_MS = PRESENCE.pingEveryMs * 3;
/** The blocks and the profile are read again on a reconnect only when the last full read is older than this. */
const FULL_REFRESH_AFTER_MS = 10 * 60_000;

export class SocialClient {
  private readonly origin: string;
  private readonly store: KeyStore;
  private readonly fetchFn: typeof fetch;
  private readonly wsCtor: WebSocketCtor | undefined;
  private readonly clock: () => number;
  private readonly rand: () => number;
  private readonly listeners = new Map<keyof SocialEvents, Set<Listener<never>>>();

  private identity: StoredIdentity | null = null;
  private loaded = false;
  /** serverTime minus the client clock, from the last answer. */
  private offset = 0;

  private recovery: string | null = null;
  private meCache: MyProfile | null = null;
  private friendsCache: FriendEntry[] = [];
  private requestsCache: RequestsView = { incoming: [], outgoing: [] };
  private blocksCache: BlockEntry[] = [];
  private invitesCache: PendingInvite[] = [];
  private syncing: Promise<void> | null = null;
  /** When the profile, the friends, the requests and the blocks were last all read (0: not yet). */
  private fullAt = 0;

  private hubStatus: HubStatus = 'idle';
  private hubWanted = false;
  private socket: WebSocketLike | null = null;
  private opening = false;
  private attempt = 0;
  private lastHeard = 0;
  private active = true;
  private desired: HubCommand | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private inviteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SocialClientOptions) {
    this.origin = opts.origin.replace(/\/+$/, '');
    this.store = opts.keys;
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.wsCtor = opts.WebSocket;
    this.clock = opts.now ?? (() => Date.now());
    this.rand = opts.random ?? Math.random;
  }

  // ───────── state, events ─────────

  get profile(): MyProfile | null { return this.meCache; }
  get friends(): readonly FriendEntry[] { return this.friendsCache; }
  get requests(): RequestsView { return this.requestsCache; }
  get blocks(): readonly BlockEntry[] { return this.blocksCache; }
  get invites(): readonly PendingInvite[] { return this.invitesCache; }
  get hub(): HubStatus { return this.hubStatus; }
  /**
   * The recovery code, from sign-up, a recovery or renewRecovery(): the one way back onto a new device (the device key cannot
   * be copied) and after the browser cleared its data. Show it once, ask the player to keep it; it is held in memory only and is
   * gone after a reload. Null when the page does not have it.
   */
  get recoveryCode(): string | null { return this.recovery; }
  /** False when the profile will be lost with the page (no IndexedDB): say so before the sign-up. */
  get persistent(): boolean { return this.store.persistent; }
  /** The server's clock as far as this client knows it (epoch ms). */
  serverNow(): number { return this.clock() + this.offset; }

  on<K extends keyof SocialEvents>(event: K, fn: Listener<SocialEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn as Listener<never>);
    return () => { set?.delete(fn as Listener<never>); };
  }

  private emit<K extends keyof SocialEvents>(event: K, value: SocialEvents[K]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try { (fn as Listener<SocialEvents[K]>)(value); } catch (e) { console.error('social listener', e); }
    }
  }

  private setProfile(me: MyProfile): void {
    this.meCache = me;
    if (this.identity) { this.identity = { ...this.identity, me }; void this.store.save(this.identity).catch(() => undefined); }
    this.emit('profile', me);
  }

  private setFriends(list: FriendEntry[]): void { this.friendsCache = list; this.count({ friends: list.length }); this.emit('friends', list); }
  private setRequests(v: RequestsView): void { this.requestsCache = v; this.count({ incoming: v.incoming.length, outgoing: v.outgoing.length }); this.emit('requests', v); }
  private setBlocks(list: BlockEntry[]): void { this.blocksCache = list; this.count({ blocks: list.length }); this.emit('blocks', list); }

  /** A list that was just loaded is the truth about its count: the profile's counts follow it without asking the server again. */
  private count(part: Partial<MyProfile['counts']>): void {
    if (this.meCache) this.meCache = { ...this.meCache, counts: { ...this.meCache.counts, ...part } };
  }

  // ───────── start, sign up, sign out ─────────

  /**
   * Loads the identity of this device and asks the server for the profile. Null when the device has no profile (or the
   * server forgot it: `signedOut` fires with 'unknown_device'); the stored profile is returned if the network is down.
   */
  async init(): Promise<MyProfile | null> {
    await this.load();
    const id = this.identity;
    if (!id || !id.registered) return null;
    if (id.me) this.meCache = id.me;
    try {
      const out = await this.call<{ me: MyProfile }>('GET', '/api/social/me');
      this.setProfile(out.me);
    } catch (e) {
      if (e instanceof SocialApiError && e.code === 'unknown_device') return null;   // call() has signed the device out
      if (!(e instanceof SocialApiError && e.status === 0)) throw e;
      // offline: the profile saved on the device is what the screen shows until the network is back
    }
    return this.meCache;
  }

  /** Makes the profile (a new device key signs the request, which proves the key is held). */
  async signUp(input: SignUp): Promise<MyProfile> {
    // Under 16 has no online identity at all (POLICY in age.ts): not even a device key is made, and nothing is sent.
    if (!canGoOnline(input.band)) throw new SocialApiError(403, 'child_no_online');
    await this.load();
    if (this.identity?.registered) throw new SocialApiError(409, 'conflict');
    const keys = this.identity?.keys ?? (await generateDeviceKey());
    this.identity = { keys, registered: false };
    await this.store.save(this.identity);
    const body: Record<string, unknown> = { pub: keys.publicRaw, band: input.band };
    // An adult's name is filtered by the server; under 18 only a generated name is taken (the one the sign-up showed), anything else is left out and the server makes one.
    if (input.name !== undefined && (input.band === 'adult' || isPresetName(input.name))) body.name = input.name;
    if (input.region !== undefined) body.region = input.region;
    if (input.lang !== undefined) body.lang = input.lang;
    if (input.level !== undefined) body.level = input.level;
    if (input.terms !== undefined) body.terms = input.terms;
    const out = await this.call<{ me: MyProfile; recovery?: string }>('POST', '/api/social/register', body);
    this.identity = { keys, registered: true, me: out.me };
    await this.store.save(this.identity);
    this.recovery = out.recovery ?? null;
    this.setProfile(out.me);
    return out.me;
  }

  /**
   * The profile back on this device: the friend code names it and the recovery code proves it is the player's. A new device key
   * is made here and added to the profile; the friends, the requests and the scores are all there. Throws recovery_failed (the
   * same answer for a code nobody has and a wrong recovery code) and too_many_attempts.
   */
  async recoverProfile(input: { code: string; recovery: string }): Promise<MyProfile> {
    await this.load();
    if (this.identity?.registered) throw new SocialApiError(409, 'conflict');
    const chars = parseFriendCode(input.code);
    const typed = parseRecoveryCode(input.recovery);
    if (!chars || !typed) throw new SocialApiError(400, 'bad_request', { error: 'bad_request', field: chars ? 'recovery' : 'code' });
    const keys = this.identity?.keys ?? (await generateDeviceKey());
    this.identity = { keys, registered: false };
    await this.store.save(this.identity);
    const out = await this.call<{ me: MyProfile }>('POST', '/api/social/recover', { pub: keys.publicRaw, code: chars, recovery: typed });
    this.identity = { keys, registered: true, me: out.me };
    await this.store.save(this.identity);
    this.recovery = formatRecoveryCode(typed);
    this.setProfile(out.me);
    return out.me;
  }

  /** A new recovery code (the old one stops working). Three a day. */
  async renewRecovery(): Promise<string> {
    const out = await this.call<{ recovery: string }>('POST', '/api/social/me/recovery');
    this.recovery = out.recovery;
    return out.recovery;
  }

  /** Removes everything this device keeps and stops the hub. The server's copy goes with deleteMe(). */
  private async forget(reason: SocialEvents['signedOut']['reason']): Promise<void> {
    this.disconnect();
    this.identity = null;
    this.meCache = null;
    this.fullAt = 0;
    this.recovery = null;
    this.friendsCache = [];
    this.requestsCache = { incoming: [], outgoing: [] };
    this.blocksCache = [];
    this.setInvites([]);
    try { await this.store.clear(); } catch { /* nothing to clear */ }
    this.emit('signedOut', { reason });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try { this.identity = await this.store.load(); } catch { this.identity = null; }
    this.loaded = true;
  }

  // ───────── signed requests ─────────

  private async keys(): Promise<NonNullable<StoredIdentity['keys']>> {
    await this.load();
    if (!this.identity) throw new SocialApiError(401, 'unauthorized');
    return this.identity.keys;
  }

  private async send(method: string, path: string, body: unknown): Promise<{ res: Response; data: Record<string, unknown> | null }> {
    const keys = await this.keys();
    const url = this.origin + path;
    const header = await signRequest(keys, { method, url, body }, this.serverNow());
    const headers: Record<string, string> = { [AUTH_HEADER]: header };
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res: Response;
    const sentAt = this.clock();
    try { res = await this.fetchFn(url, init); } catch { throw new SocialApiError(0, 'network'); }
    let data: Record<string, unknown> | null = null;
    try { const j: unknown = await res.json(); data = typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : null; } catch { data = null; }
    if (data && typeof data.serverTime === 'number') {
      // The server stamped its answer about half way through the round trip. An answer that was held up for long (a page
      // that slept with a request in flight) says nothing about the clocks, so it is not used.
      const heardAt = this.clock();
      if (heardAt - sentAt <= MAX_SYNC_ROUND_TRIP_MS) this.offset = data.serverTime - (sentAt + heardAt) / 2;
    }
    return { res, data };
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<T> {
    const payload = method === 'GET' ? undefined : (body ?? {});
    for (let attempt = 0; ; attempt++) {
      const { res, data } = await this.send(method, path, payload);
      if (res.ok) {
        const { serverTime: _serverTime, ...rest } = data ?? {};
        return rest as T;
      }
      const code = typeof data?.error === 'string' ? data.error : `http_${res.status}`;
      // A wrong device clock is the one failure worth a silent second try: the answer carried the server time.
      if (code === 'clock_skew' && attempt === 0 && typeof data?.serverTime === 'number') continue;
      // The server has no record of this key (its data was erased, or the profile idled for over a year): start over.
      if (code === 'unknown_device' && path !== '/api/social/register') await this.forget('unknown_device');
      throw new SocialApiError(res.status, code, data as SocialErrorBody | null);
    }
  }

  /**
   * A `fetch` that signs its requests as this player, for live play's room API (and anything else on the Worker that checks
   * signatures). The body must be JSON text or absent.
   */
  readonly fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    let body: unknown;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try { body = JSON.parse(init.body); } catch { throw new SocialApiError(0, 'bad_body'); }
    }
    const keys = await this.keys();
    const header = await signRequest(keys, { method, url, body }, this.serverNow());
    const headers = new Headers(init?.headers);
    headers.set(AUTH_HEADER, header);
    return this.fetchFn(input, { ...init, headers });
  };

  // ───────── profile ─────────

  async updateProfile(change: ProfileChange): Promise<MyProfile> {
    const out = await this.call<{ me: MyProfile }>('POST', '/api/social/me', { ...change });
    this.setProfile(out.me);
    return out.me;
  }

  /** A new friend code (the old one stops working). */
  async renewCode(): Promise<MyProfile> {
    const out = await this.call<{ me: MyProfile }>('POST', '/api/social/me/code');
    this.setProfile(out.me);
    return out.me;
  }

  /** Everything the server holds about the player ("download my data"). */
  async exportData(): Promise<DataExport> {
    return (await this.call<{ export: DataExport }>('GET', '/api/social/me/export')).export;
  }

  /** Erases the profile on the server and on this device. */
  async deleteProfile(): Promise<void> {
    await this.call('POST', '/api/social/me/delete', { confirm: 'delete' });
    await this.forget('deleted');
  }

  // ───────── friends ─────────

  async loadFriends(): Promise<FriendEntry[]> {
    const out = await this.call<{ friends: FriendEntry[] }>('GET', '/api/social/friends');
    this.setFriends(out.friends);
    return out.friends;
  }

  async loadRequests(): Promise<RequestsView> {
    const out = await this.call<RequestsView>('GET', '/api/social/requests');
    const v = { incoming: out.incoming, outgoing: out.outgoing };
    this.setRequests(v);
    return v;
  }

  async loadBlocks(): Promise<BlockEntry[]> {
    const out = await this.call<{ blocks: BlockEntry[] }>('GET', '/api/social/blocks');
    this.setBlocks(out.blocks);
    return out.blocks;
  }

  /** Friends, requests, blocks and the profile together (after sign in). */
  async refresh(): Promise<void> {
    this.fullAt = this.clock();
    await Promise.all([
      this.loadFriends(), this.loadRequests(), this.loadBlocks(),
      this.meCache ? this.call<{ me: MyProfile }>('GET', '/api/social/me').then((out) => this.setProfile(out.me)) : undefined,
    ]);
  }

  /**
   * refresh() for the moments the hub opens or the page comes back: while one is running, the callers share it (a flapping
   * network does not pile up requests). Resolves when the lists are current. What other players change while the page is away
   * (the friends and their presence, the requests) is read every time; the blocks and the profile change only by this player's own
   * hand, so they are read again only when the last full read is over ten minutes old: a connection that drops and returns every
   * minute costs two requests a time, not four (each one is a Durable Object request on the free plan's meter).
   */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    const full = this.fullAt === 0 || this.clock() - this.fullAt > FULL_REFRESH_AFTER_MS;
    const run: Promise<void> = (full ? this.refresh() : Promise.all([this.loadFriends(), this.loadRequests()]).then(() => undefined))
      .finally(() => { if (this.syncing === run) this.syncing = null; });
    this.syncing = run;
    return run;
  }

  /**
   * A request by friend code, a pasted link or a bare code. `sent` is the answer for every request that was accepted for
   * delivery AND for the ones that were dropped silently (blocked, an under-18 player and an adult, recently declined):
   * the screen says "Request sent" and nothing else. Throws bad_code for text that is no code.
   */
  async sendRequest(input: string): Promise<RequestResult> {
    const fromLink = parseFriendLink(input);
    const chars = fromLink ?? parseFriendCode(input);
    if (!chars) throw new SocialApiError(400, 'bad_code');
    const via = fromLink && /[/:]/.test(input) ? 'link' : 'code';
    const out = await this.call<RequestResult>('POST', '/api/social/friends/request', { code: chars, via });
    await Promise.all([this.loadRequests().catch(() => undefined), out.status === 'friends' ? this.loadFriends().catch(() => undefined) : undefined]);
    return out;
  }

  async respond(fid: string, accept: boolean): Promise<void> {
    await this.call('POST', '/api/social/friends/respond', { fid, accept });
    this.setRequests({ ...this.requestsCache, incoming: this.requestsCache.incoming.filter((r) => r.fid !== fid) });
    if (accept) await this.loadFriends();
  }

  async cancelRequest(fid: string): Promise<void> {
    await this.call('POST', '/api/social/friends/cancel', { fid });
    this.setRequests({ ...this.requestsCache, outgoing: this.requestsCache.outgoing.filter((r) => r.fid !== fid) });
  }

  async removeFriend(fid: string): Promise<void> {
    await this.call('POST', '/api/social/friends/remove', { fid });
    this.setFriends(this.friendsCache.filter((f) => f.fid !== fid));
  }

  async block(fid: string): Promise<void> {
    await this.call('POST', '/api/social/blocks', { fid });
    this.setFriends(this.friendsCache.filter((f) => f.fid !== fid));
    await Promise.all([this.loadBlocks(), this.loadRequests()]);
  }

  async unblock(fid: string): Promise<void> {
    await this.call('POST', '/api/social/blocks/remove', { fid });
    this.setBlocks(this.blocksCache.filter((b) => b.fid !== fid));
  }

  /** Reports a player (a friend, or one met in a room: the room's report button files the room evidence). `note` is adults only. */
  async report(fid: string, reason: ReportReason, opts: { note?: string; block?: boolean } = {}): Promise<{ blocked: boolean }> {
    const body: Record<string, unknown> = { fid, reason };
    if (opts.note) body.note = opts.note;
    if (opts.block) body.block = true;
    const out = await this.call<{ blocked?: boolean }>('POST', '/api/social/report', body);
    if (opts.block) { this.setFriends(this.friendsCache.filter((f) => f.fid !== fid)); void this.loadBlocks().catch(() => undefined); }
    return { blocked: out.blocked === true };
  }

  // ───────── invitations, lobbies, quick match ─────────

  /** Asks an online friend into the room this player is in. Throws offline when the friend has no open hub socket. */
  async invite(fid: string, room: string): Promise<{ id: string; exp: number }> {
    return this.call('POST', '/api/social/invite', { fid, room });
  }

  /** Turns an invitation down (the inviter is told) and drops it from the list. */
  async declineInvite(invite: PendingInvite): Promise<void> {
    this.setInvites(this.invitesCache.filter((i) => i.id !== invite.id));
    await this.call('POST', '/api/social/invite/decline', { fid: invite.from.fid, id: invite.id });
  }

  /** The invitation taken: removed from the list; the caller then joins with joinRoom(invite.room). */
  acceptInvite(invite: PendingInvite): void {
    this.setInvites(this.invitesCache.filter((i) => i.id !== invite.id));
  }

  /** Public lobbies of the player's age group that have a seat, oldest first. Children get `child_no_public`. */
  async lobbies(filter: { game?: string; region?: string } = {}): Promise<LobbyEntry[]> {
    const q = new URLSearchParams();
    if (filter.game) q.set('game', filter.game);
    if (filter.region) q.set('region', filter.region);
    const qs = q.toString();
    return (await this.call<{ lobbies: LobbyEntry[] }>('GET', `/api/social/lobbies${qs ? `?${qs}` : ''}`)).lobbies;
  }

  /** The player's identity in the shape live play's API wants; with signed requests the server ignores everything but the signature. */
  roomIdentity(): Identity {
    const id = this.identity;
    if (!id || !this.meCache) throw new SocialApiError(401, 'unauthorized');
    return { pid: id.keys.kid, name: this.meCache.name, age: this.meCache.band };
  }

  /** A room (live play), created as this player. */
  createRoom(room: NewRoomRequest): Promise<JoinGrant> {
    return apiCreateRoom(this.origin, this.roomIdentity(), room, this.fetcher);
  }

  /** A seat in a room (live play), taken as this player. */
  joinRoom(code: string): Promise<JoinGrant> {
    return apiJoinRoom(this.origin, code, this.roomIdentity(), this.fetcher);
  }

  /**
   * Quick match: asks every four seconds until the player is seated in somebody else's lobby, or the caller stops the search
   * (its own room filled up, or the player cancelled), or two minutes pass. A lobby that fills before the seat is taken is
   * not an error: the search just asks again. `progress.offerGhost` turns true after 20 seconds: show "Play against ghosts".
   */
  async quickMatch(game: string, driver: MatchDriver, opts: { signal?: AbortSignal; onProgress?: (p: MatchProgress) => void; pollMs?: number } = {}): Promise<MatchOutcome> {
    const poll = opts.pollMs ?? POLL_EVERY_MS;
    const began = this.clock();
    let searchId: string | undefined;
    let hosting: string | null = null;
    for (;;) {
      if (opts.signal?.aborted) return { outcome: 'stopped', hosting };
      const a: QuickAction = await this.call<QuickAction>('POST', '/api/social/match', { game, ...(searchId ? { searchId } : {}), ...(hosting ? { hosting } : {}) });
      searchId = a.searchId;
      let offerGhost = false;
      let waitedMs = this.clock() - began;
      if (a.action === 'join' || a.action === 'merge') {
        const target = a.code;
        try {
          if (a.action === 'merge' && hosting) { const mine = hosting; hosting = null; await driver.leave(mine).catch(() => undefined); }
          await driver.join(target);
          return { outcome: 'joined', code: target };
        } catch {
          // somebody else took the last seat: ask again
        }
      } else if (a.action === 'create') {
        hosting = (await driver.create(game, a.band)).code;
      } else {
        offerGhost = a.offerGhost;
        waitedMs = a.waitedMs;
      }
      opts.onProgress?.({ phase: hosting ? 'hosting' : 'searching', waitedMs, code: hosting, offerGhost });
      if (this.clock() - began > MAX_SEARCH_MS) return { outcome: 'timeout', hosting };
      await sleep(poll, opts.signal);
    }
  }

  // ───────── synced documents ─────────

  /** Every synced document of the player (the daily challenge and the streak, progress, plans, preferences). */
  async loadSync(): Promise<Partial<Record<SyncKey, SyncDoc>>> {
    return (await this.call<{ docs: Partial<Record<SyncKey, SyncDoc>> }>('GET', '/api/social/sync')).docs;
  }

  /**
   * One write of a document, from the revision it was read at (0 for a document that does not exist yet). Throws a 409
   * `conflict` when the document moved on; its `body.current` is the current document (null when there is none).
   */
  async saveSync(key: SyncKey, data: unknown, baseRev: number): Promise<{ rev: number; at: number }> {
    return this.call<{ rev: number; at: number }>('PUT', `/api/social/sync/${key}`, { baseRev, data });
  }

  /**
   * Read, change, write. `change` gets the current data (null when there is none) and returns the new data. When another
   * device wrote in the meantime the document is read again and `change` runs again on the new data, so it has to be a merge
   * (keep the longer streak, the later day), never an overwrite. Gives up after `tries` conflicts.
   */
  async updateSync<T>(key: SyncKey, change: (current: T | null) => T, tries = 4): Promise<{ rev: number; at: number; data: T }> {
    let cur: SyncDoc | null = (await this.loadSync())[key] ?? null;
    for (let attempt = 1; ; attempt++) {
      const data = change(cur ? (cur.data as T) : null);
      try {
        const saved = await this.saveSync(key, data, cur?.rev ?? 0);
        return { ...saved, data };
      } catch (e) {
        if (!(e instanceof SocialApiError) || e.code !== 'conflict' || attempt >= tries) throw e;
        const now = e.body?.current;
        cur = typeof now === 'object' && now !== null ? (now as SyncDoc) : null;
      }
    }
  }

  // ───────── weekly boards ─────────

  /**
   * A run begins: the server notes the time and signs a ticket for this player and game (nothing is stored). Keep the ticket
   * until the run ends. Only solo runs of the games with a board count.
   */
  async startRun(game: string): Promise<RunTicket> {
    return this.call<RunTicket>('POST', '/api/social/scores/start', { game });
  }

  /**
   * The run ended with `score`. The server checks the ticket, the time the run took and the most the game can award in that
   * time, and keeps the score when it is the player's best of the week (`improved`). Throws score_implausible, run_too_short,
   * run_expired or bad_run when the score cannot count; the player's result screen still shows the score, it is just not posted.
   */
  async finishRun(ticket: RunTicket, score: number): Promise<ScoreResult> {
    return this.call<ScoreResult>('POST', '/api/social/scores', { run: ticket.run, game: ticket.game, score });
  }

  /** The weekly board of a game: the player's friends, or the players of the same age group in the country they connect from. */
  async leaderboard(q: { game: string; scope: BoardScope; week?: 'current' | 'previous' }): Promise<BoardView> {
    const params = new URLSearchParams({ game: q.game, scope: q.scope });
    if (q.week) params.set('week', q.week);
    return (await this.call<{ board: BoardView }>('GET', `/api/social/leaderboard?${params.toString()}`)).board;
  }

  // ───────── hub: presence and pushes ─────────

  /** Opens the hub socket and keeps it open (reconnects with backoff) until disconnect(). */
  connect(): void {
    this.hubWanted = true;
    if (this.hubStatus === 'replaced' || this.hubStatus === 'banned') this.setHub('idle');
    if (!this.socket && !this.opening && !this.reconnectTimer) void this.openHub();
  }

  disconnect(): void {
    this.hubWanted = false;
    this.clearTimers();
    const ws = this.socket;
    this.socket = null;
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; try { ws.close(1000, 'bye'); } catch { /* closed already */ } }
    if (this.hubStatus !== 'replaced' && this.hubStatus !== 'banned') this.setHub('idle');
  }

  /** The page is visible (true) or hidden (false): beats stop while it is hidden, and resume with one at once. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!this.hubWanted) return;
    if (active) {
      if (!this.socket && !this.opening) { this.attempt = 0; this.clearReconnect(); void this.openHub(); } else this.sendCommand({ t: 'beat' });
    }
  }

  /** What the player is doing outside a room: 'online' or 'playing' a game by themselves. The room reports its own state. */
  setStatus(status: 'online' | 'playing', game?: string): void {
    this.desired = status === 'online' ? null : ({ t: 'status', status, ...(game ? { game } : {}) } as HubCommand);
    this.sendCommand(this.desired ?? { t: 'status', status: 'online' });
  }

  private sendCommand(cmd: HubCommand): void {
    const ws = this.socket;
    if (!ws || this.hubStatus !== 'online') return;
    try { ws.send(JSON.stringify(cmd)); } catch { /* the close handler reconnects */ }
  }

  private setHub(status: HubStatus): void {
    if (this.hubStatus === status) return;
    this.hubStatus = status;
    this.emit('hub', status);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private clearTimers(): void {
    this.clearReconnect();
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
  }

  private async openHub(): Promise<void> {
    if (!this.hubWanted || this.socket || this.opening) return;
    this.opening = true;
    this.setHub('connecting');
    try {
      const keys = await this.keys();
      const header = await signRequest(keys, { method: 'GET', url: '/api/social/hub' }, this.serverNow());
      const Ctor = this.wsCtor ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
      if (!Ctor) throw new Error('no WebSocket');
      const base = new URL(this.origin + '/api/social/hub', (globalThis as { location?: { href: string } }).location?.href ?? 'http://localhost/');
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      base.searchParams.set(AUTH_QUERY, header);
      if (!this.hubWanted) return;
      const ws = new Ctor(base.href);
      this.socket = ws;
      this.lastHeard = this.clock();
      ws.onopen = () => {
        this.attempt = 0;
        this.lastHeard = this.clock();
        this.setHub('online');
        this.startTimers();
        if (this.desired) this.sendCommand(this.desired);
        void this.sync().catch(() => undefined);
      };
      ws.onmessage = (ev) => this.onHubMessage(ev.data);
      ws.onclose = (ev) => this.onHubClose(ws, ev.code);
      ws.onerror = () => undefined;
    } catch (e) {
      if (!(e instanceof SocialApiError) || e.status !== 401) this.scheduleReconnect();
      else this.setHub('idle');
    } finally {
      this.opening = false;
    }
  }

  private startTimers(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      const ws = this.socket;
      if (!ws) return;
      if (this.clock() - this.lastHeard > STALE_AFTER_MS) { this.dropSocket(); return; }
      try { ws.send('ping'); } catch { this.dropSocket(); }
    }, PRESENCE.pingEveryMs);
    this.beatTimer = setInterval(() => { if (this.active) this.sendCommand({ t: 'beat' }); }, PRESENCE.beatEveryMs);
  }

  /** A socket that went quiet: close it from this side and reconnect. */
  private dropSocket(): void {
    const ws = this.socket;
    if (!ws) return;
    this.onHubClose(ws, 4999);
    try { ws.close(4999, 'stale'); } catch { /* gone */ }
  }

  private onHubMessage(data: unknown): void {
    this.lastHeard = this.clock();
    if (typeof data !== 'string' || data === 'pong') return;
    let ev: HubEvent;
    try { ev = JSON.parse(data) as HubEvent; } catch { return; }
    switch (ev.t) {
      case 'hello':
        if (typeof ev.now === 'number') this.offset = ev.now - this.clock();
        break;
      case 'presence':
        this.setFriends(this.friendsCache.map((f) => (f.fid === ev.fid ? { ...f, presence: ev.presence } : f)));
        break;
      case 'friend_request': {
        const next = this.requestsCache.incoming.filter((r) => r.fid !== ev.from.fid);
        next.unshift({ fid: ev.from.fid, name: ev.from.name, at: ev.at, via: ev.via });
        this.setRequests({ ...this.requestsCache, incoming: next });
        this.emit('friendRequest', { fid: ev.from.fid, name: ev.from.name, at: ev.at, via: ev.via });
        break;
      }
      case 'friend_added':
        this.setRequests({ incoming: this.requestsCache.incoming.filter((r) => r.fid !== ev.friend.fid), outgoing: this.requestsCache.outgoing.filter((r) => r.fid !== ev.friend.fid) });
        this.emit('friendAdded', ev.friend);
        void this.loadFriends().catch(() => undefined);
        break;
      case 'friend_removed':
        this.setFriends(this.friendsCache.filter((f) => f.fid !== ev.fid));
        break;
      case 'request_cancelled':
        this.setRequests({ ...this.requestsCache, incoming: this.requestsCache.incoming.filter((r) => r.fid !== ev.fid) });
        break;
      case 'invite':
        this.setInvites([...this.invitesCache.filter((i) => i.id !== ev.id), { id: ev.id, from: ev.from, room: ev.room, game: ev.game, exp: ev.exp }]);
        break;
      case 'invite_declined':
        this.emit('inviteDeclined', { id: ev.id, fid: ev.fid });
        break;
      case 'closing': {
        // The server says why it is about to close the socket. Act on it now: the close frame itself can arrive late
        // (workerd holds a server-initiated close of a sleeping socket for about ten seconds when run locally).
        const ws = this.socket;
        const code = ev.reason === 'replaced' ? HUB_CLOSE.REPLACED : ev.reason === 'banned' ? HUB_CLOSE.BANNED : ev.reason === 'deleted' ? HUB_CLOSE.DELETED : null;
        if (ws && code !== null) {
          this.onHubClose(ws, code);
          ws.onmessage = null; ws.onerror = null; ws.onclose = null;
          try { ws.close(1000, 'bye'); } catch { /* closed already */ }
        }
        break;
      }
    }
  }

  private setInvites(list: PendingInvite[]): void {
    const now = this.serverNow();
    const live = list.filter((i) => i.exp > now);
    this.invitesCache = live;
    this.emit('invites', live);
    if (this.inviteTimer) { clearTimeout(this.inviteTimer); this.inviteTimer = null; }
    const next = live.reduce<number>((m, i) => Math.min(m, i.exp), Infinity);
    if (Number.isFinite(next)) this.inviteTimer = setTimeout(() => this.setInvites(this.invitesCache), Math.max(50, next - now + 50));
  }

  private onHubClose(ws: WebSocketLike, code: number): void {
    if (this.socket !== ws) return;
    this.socket = null;
    this.clearTimers();
    if (code === HUB_CLOSE.REPLACED) { this.hubWanted = false; this.setHub('replaced'); return; }
    if (code === HUB_CLOSE.BANNED) { this.hubWanted = false; this.setHub('banned'); return; }
    if (code === HUB_CLOSE.DELETED) { void this.forget('deleted'); return; }
    if (!this.hubWanted) { this.setHub('idle'); return; }
    // AUTH: the signature was refused (clock): the next try signs again with the server time learned since.
    this.scheduleReconnect(code === HUB_CLOSE.AUTH && this.attempt === 0 ? 0 : undefined);
  }

  private scheduleReconnect(delayMs?: number): void {
    if (!this.hubWanted || this.reconnectTimer) return;
    this.setHub('connecting');
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    const wait = delayMs ?? Math.round(exp * (0.5 + this.rand() * 0.5));
    this.attempt++;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.openHub(); }, wait);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(done, ms);
    function done(): void { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}
