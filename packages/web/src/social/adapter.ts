// The social port on the real social client (core/social/client.ts): what the Friends screens call, answered by the signed
// requests of the device's profile. The client keeps the truth (profile, friends, requests, blocks, invitations, the hub);
// this keeps a snapshot of it for the views (`state()`), turns the client's events into one change callback and a few notices
// (a request, a new friend, an invitation, being signed out), and turns every failure into a plain answer: the calls here never throw.
//
// What it adds to the client, and nothing else:
//   - under 16 and kid profiles: the page asks, and nothing leaves the device (no key, no request, no socket);
//   - the recovery code of a sign-up or a renewal, handed to the screen once (`state().recovery`, gone at `dismissRecovery()`);
//   - the profile that left the device without the player asking (deleted on another device, or the server no longer knows the key);
//   - the profile's saved copy while the server does not answer: the page shows it and says it is offline.
import { canGoOnline } from '../../../core/social/age.ts';
import { SocialApiError, type HubStatus, type SignUp, type SocialEvents } from '../../../core/social/client.ts';
import type { SyncPort } from '../../../core/store/sync-docs.ts';
import type { BlockEntry, BoardScope, BoardView, DataExport, FriendEntry, LobbyEntry, MyProfile, ReportReason, RequestResult, RequestsView, RunTicket, ScoreResult } from '../../../core/social/types.ts';
import type { Unsubscribe } from '../../../core/types/index.ts';
import { failed } from './errors.ts';
import {
  NO_SOCIAL_STATE, type Done, type MatchDriver, type MatchOutcome, type MatchProgress, type NoOnline, type PendingInvite, type ProfileChange, type SignedOut, type SocialNotice,
  type SocialPort, type SocialState,
} from './port.ts';

/** What of the social client this module uses (a structural subset: the real `SocialClient` fits, a test can script one). */
export interface SocialClientLike extends SyncPort {
  readonly profile: MyProfile | null;
  readonly friends: readonly FriendEntry[];
  readonly requests: RequestsView;
  readonly blocks: readonly BlockEntry[];
  readonly invites: readonly PendingInvite[];
  readonly hub: HubStatus;
  readonly recoveryCode: string | null;
  readonly persistent: boolean;
  serverNow(): number;
  on<K extends keyof SocialEvents>(event: K, fn: (value: SocialEvents[K]) => void): () => void;
  init(): Promise<MyProfile | null>;
  signUp(input: SignUp): Promise<MyProfile>;
  recoverProfile(input: { code: string; recovery: string }): Promise<MyProfile>;
  renewRecovery(): Promise<string>;
  updateProfile(change: ProfileChange): Promise<MyProfile>;
  renewCode(): Promise<MyProfile>;
  exportData(): Promise<DataExport>;
  deleteProfile(): Promise<void>;
  sync(): Promise<void>;
  sendRequest(input: string): Promise<RequestResult>;
  respond(fid: string, accept: boolean): Promise<void>;
  cancelRequest(fid: string): Promise<void>;
  removeFriend(fid: string): Promise<void>;
  block(fid: string): Promise<void>;
  unblock(fid: string): Promise<void>;
  report(fid: string, reason: ReportReason, opts?: { note?: string; block?: boolean }): Promise<{ blocked: boolean }>;
  invite(fid: string, room: string): Promise<{ id: string; exp: number }>;
  declineInvite(invite: PendingInvite): Promise<void>;
  acceptInvite(invite: PendingInvite): void;
  lobbies(filter?: { game?: string; region?: string }): Promise<LobbyEntry[]>;
  quickMatch(game: string, driver: MatchDriver, opts?: { signal?: AbortSignal; onProgress?: (p: MatchProgress) => void; pollMs?: number }): Promise<MatchOutcome>;
  startRun(game: string): Promise<RunTicket>;
  finishRun(ticket: RunTicket, score: number): Promise<ScoreResult>;
  leaderboard(q: { game: string; scope: BoardScope; week?: 'current' | 'previous' }): Promise<BoardView>;
  connect(): void;
  disconnect(): void;
  setActive(active: boolean): void;
  setStatus(status: 'online' | 'playing', game?: string): void;
}

export interface SocialPortDeps {
  client: SocialClientLike;
  /** The shell's memory of "I am under 16": one flag on this device, nothing else, nothing sent. */
  age: { tooYoung(): boolean; remember(): void };
  /** The profile in use is a kid profile of the Family plan (it never goes online). Asked again at `recheck()`. */
  kidProfile?: () => boolean;
  /** The language a new profile is made with ('en', 'tr'); the server's own default when missing. */
  lang?: () => string | undefined;
}

export interface SocialPortHandle extends SocialPort {
  /** Stops listening to the client (tests; the app keeps its port for as long as it runs). */
  dispose(): void;
}

const OK: Done = { ok: true, value: undefined };

export function createSocialPort(deps: SocialPortDeps): SocialPortHandle {
  const { client } = deps;
  const subs = new Set<() => void>();
  const noticeSubs = new Set<(n: SocialNotice) => void>();
  let status: SocialState['status'] = 'loading';
  let signedOut: SignedOut | null = null;
  let bannedUntil: number | null = null;
  let recoveryPending = false;
  let selfDeleting = false;
  let opening: Promise<void> | null = null;
  let closed = false;
  const seenInvites = new Set<string>();

  const kid = (): boolean => deps.kidProfile?.() === true;
  const noOnlineNow = (): NoOnline | null => (kid() ? 'kid' : !client.profile && deps.age.tooYoung() ? 'young' : null);

  const build = (): SocialState => {
    const none = noOnlineNow();
    // A kid profile shows nothing of the device's own online profile (that one belongs to a parent).
    const hide = none === 'kid';
    return {
      // With no online identity to use there is nothing to wait for: the page can say so at once.
      status: none ? 'ready' : status,
      profile: hide ? null : client.profile,
      friends: hide ? NO_SOCIAL_STATE.friends : client.friends,
      requests: hide ? NO_SOCIAL_STATE.requests : client.requests,
      blocks: hide ? NO_SOCIAL_STATE.blocks : client.blocks,
      invites: hide ? NO_SOCIAL_STATE.invites : client.invites,
      hub: hide ? 'idle' : client.hub,
      signedOut,
      bannedUntil,
      // A recovery code that was not saved yet waits (in memory) for the owner: it is never shown while a kid's profile plays.
      recovery: !hide && recoveryPending ? client.recoveryCode : null,
      persistent: client.persistent,
      noOnline: none,
    };
  };
  let state = build();
  const emit = (): void => {
    state = build();
    for (const cb of [...subs]) cb();
  };
  const notify = (n: SocialNotice): void => { for (const cb of [...noticeSubs]) cb(n); };

  /** A server answer arrived, so the server is there (the page was showing its saved copy while it was not). */
  const heard = (): void => { if (status === 'offline' && client.profile) status = 'ready'; };

  const offs: Unsubscribe[] = [
    client.on('profile', () => { heard(); emit(); }),
    client.on('friends', () => { heard(); emit(); }),
    client.on('requests', () => { heard(); emit(); }),
    client.on('blocks', () => emit()),
    // The connection coming up proves nothing about the lists (the calls that read them may still be failing): only an answer does.
    client.on('hub', (h) => { if (h === 'online') bannedUntil = null; else if (h === 'banned' && bannedUntil === null) { bannedUntil = 0; void checkBan(); } emit(); }),
    client.on('invites', (list) => {
      const fresh = list.filter((i) => !seenInvites.has(i.id));
      for (const i of list) seenInvites.add(i.id);
      emit();
      for (const i of fresh) notify({ kind: 'invite', invite: i });
    }),
    client.on('friendRequest', (r) => notify({ kind: 'request', name: r.name })),
    client.on('friendAdded', (f) => notify({ kind: 'friend', name: f.name })),
    client.on('inviteDeclined', (d) => notify({ kind: 'inviteDeclined', name: client.friends.find((f) => f.fid === d.fid)?.name ?? '' })),
    client.on('signedOut', (s) => {
      recoveryPending = false;
      if (!selfDeleting) {
        signedOut = s.reason;
        notify({ kind: 'signedOut', reason: s.reason });
      }
      emit();
    }),
  ];

  /** The server closed the connection because the profile is suspended: ask it until when (the answer to any call carries the date). */
  async function checkBan(): Promise<void> {
    try { await client.init(); } catch (e) { if (e instanceof SocialApiError && e.code === 'banned') bannedUntil = typeof e.body?.until === 'number' ? e.body.until : 0; }
    emit();
  }

  async function doOpen(): Promise<void> {
    if (noOnlineNow()) { status = 'ready'; emit(); return; }
    if (!state.profile && status !== 'loading') { status = 'loading'; emit(); }
    try {
      const me = await client.init();
      if (closed) return;
      if (!me) { status = 'ready'; emit(); return; }
      status = 'ready';
      emit();
      client.connect();
      await client.sync();
      status = 'ready';
      emit();
    } catch (e) {
      if (e instanceof SocialApiError && e.code === 'banned') {
        // A suspended profile is not offline: the page says until when (the saved copy of the profile stays, for the data and the deletion).
        bannedUntil = typeof e.body?.until === 'number' ? e.body.until : 0;
        status = 'ready';
        emit();
        return;
      }
      // The server does not answer (or answers with a failure): the saved profile stays on the screen, the hub keeps trying by itself.
      if (!(e instanceof SocialApiError)) console.error(e);
      status = 'offline';
      emit();
    }
  }

  /**
   * Every call that reaches the server goes through here, and none goes when this device has no online identity to use (under 16, or
   * a kid profile of the Family plan): the answer is the same one the server gives and no request, no key and no socket is made. The
   * screens are hidden for those players already; this is the last guard against a mistake in a screen.
   */
  async function wrap<T>(fn: () => Promise<T>): Promise<Done<T>> {
    if (noOnlineNow()) return { ok: false, code: 'child_no_online' };
    try { return { ok: true, value: await fn() }; } catch (e) { return failed(e); }
  }

  /** The session of a new or recovered profile: connect, and read the lists in the background. */
  function started(): void {
    status = 'ready';
    signedOut = null;
    emit();
    client.connect();
    void client.sync().then(() => emit(), () => undefined);
  }

  const port: SocialPortHandle = {
    state: () => state,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    notices(cb) { noticeSubs.add(cb); return () => { noticeSubs.delete(cb); }; },

    open() {
      closed = false;
      if (!opening) opening = doOpen().finally(() => { opening = null; });
      return opening;
    },
    close() { closed = true; client.disconnect(); emit(); },
    setActive(active) { if (!noOnlineNow()) client.setActive(active); },
    setStatus(s, game) { if (!noOnlineNow()) client.setStatus(s, game); },
    takeOver() { if (!noOnlineNow()) client.connect(); },
    declareTooYoung() {
      deps.age.remember();
      emit();
    },
    dismissRecovery() { recoveryPending = false; emit(); },
    recheck() {
      if (kid()) client.disconnect();
      else if (!closed) void port.open();
      emit();
    },

    async createProfile(r) {
      if (!canGoOnline(r.band) || kid()) return { ok: false, code: 'child_no_online' };
      const input: SignUp = { band: r.band };
      if (r.name) input.name = r.name;
      if (r.terms) input.terms = r.terms;
      const lang = deps.lang?.();
      if (lang) input.lang = lang;
      const out = await wrap(() => client.signUp(input));
      if (!out.ok) return out;
      recoveryPending = true;
      started();
      return out;
    },
    async recoverProfile(r) {
      if (kid()) return { ok: false, code: 'child_no_online' };
      const out = await wrap(() => client.recoverProfile(r));
      if (!out.ok) return out;
      // The player has the code (they just typed it): it is not shown again.
      recoveryPending = false;
      started();
      return out;
    },
    async updateProfile(change) {
      const out = await wrap(() => client.updateProfile(change));
      emit();
      return out;
    },
    async renewCode() {
      const out = await wrap(() => client.renewCode());
      emit();
      return out;
    },
    async renewRecovery() {
      const out = await wrap(() => client.renewRecovery());
      if (out.ok) { recoveryPending = true; emit(); }
      return out;
    },
    exportData: () => wrap(() => client.exportData()),
    async deleteProfile() {
      selfDeleting = true;
      const out = await wrap(() => client.deleteProfile());
      selfDeleting = false;
      if (!out.ok) return out;
      signedOut = null;
      recoveryPending = false;
      status = 'ready';
      emit();
      return OK;
    },

    addByCode: (code) => wrap(() => client.sendRequest(code)),
    async answer(fid, accept) { return wrap(() => client.respond(fid, accept)); },
    async cancelRequest(fid) { return wrap(() => client.cancelRequest(fid)); },
    async unfriend(fid) { return wrap(() => client.removeFriend(fid)); },
    async block(fid) { return wrap(() => client.block(fid)); },
    async unblock(fid) { return wrap(() => client.unblock(fid)); },
    async report(r) {
      // The note is for grown-ups only: a young player's report carries the reason and nothing typed.
      const note = client.profile?.band === 'adult' && r.details.trim() ? r.details.trim() : undefined;
      const out = await wrap(() => client.report(r.fid, r.reason, { ...(note ? { note } : {}), ...(r.alsoBlock ? { block: true } : {}) }));
      return out.ok ? OK : out;
    },
    invite: (fid, room) => wrap(() => client.invite(fid, room)),
    async answerInvite(invite, accept) {
      if (accept) { if (noOnlineNow()) return { ok: false, code: 'child_no_online' }; client.acceptInvite(invite); return OK; }
      return wrap(() => client.declineInvite(invite));
    },
    lobbies: (q) => wrap(() => client.lobbies({ game: q.game, region: q.region })),
    quickMatch: (q) => wrap(() => client.quickMatch(q.game, q.driver, { signal: q.signal, onProgress: q.onProgress })),

    leaderboard: (q) => wrap(() => client.leaderboard({ game: q.game, scope: q.scope, week: q.week })),
    startRun: (game) => wrap(() => client.startRun(game)),
    finishRun: (ticket, score) => wrap(() => client.finishRun(ticket, score)),

    syncPort: () => (client.profile && !kid() ? client : null),
    serverNow: () => client.serverNow(),

    dispose() { for (const off of offs.splice(0)) off(); subs.clear(); noticeSubs.clear(); },
  };
  return port;
}
