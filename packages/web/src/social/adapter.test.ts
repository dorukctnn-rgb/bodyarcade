// The social port on a scripted client: what the screens are told in each situation (no profile, saved profile and no
// network, a suspended profile, under 16, a kid profile, the recovery code, a profile deleted elsewhere) and that no call of
// the port ever throws. The real client against the real routes is in adapter.server.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { SocialApiError, type MatchProgress, type PendingInvite, type SignUp, type SocialEvents } from '../../../core/social/client.ts';
import type { BlockEntry, FriendEntry, MyProfile, RequestResult, RequestsView } from '../../../core/social/types.ts';
import { createSocialPort, type SocialClientLike } from './adapter.ts';
import { codeOf, failed } from './errors.ts';
import type { SocialNotice } from './port.ts';

const PROFILE: MyProfile = {
  fid: 'ABCDEFGH23', name: 'Mia', code: 'BA-7K2Q4X', link: 'https://x.test/f/BA-7K2Q4X', band: 'adult', level: 12, region: 'eu', lang: 'en', dnd: false, createdAt: 1, mutedUntil: 0, publicBlockedUntil: 0,
  counts: { friends: 0, incoming: 0, outgoing: 0, blocks: 0 }, can: { freeName: true, freeText: true, video: true, publicPlay: true, maxFriends: 100 },
};
const FRIEND: FriendEntry = { fid: 'FRIEND2345', name: 'Ola', band: 'adult', since: 1, presence: { status: 'online' } };

type Calls = string[];

/** A client the test scripts: every call is recorded, and a call can be told to fail. */
class FakeClient implements SocialClientLike {
  calls: Calls = [];
  profile: MyProfile | null = null;
  friends: readonly FriendEntry[] = [];
  requests: RequestsView = { incoming: [], outgoing: [] };
  blocks: readonly BlockEntry[] = [];
  invites: readonly PendingInvite[] = [];
  hub: SocialClientLike['hub'] = 'idle';
  recoveryCode: string | null = null;
  persistent = true;
  /** What init() answers (the saved profile), and what makes calls fail. */
  saved: MyProfile | null = null;
  fail: Record<string, SocialApiError> = {};
  private readonly listeners = new Map<string, Set<(v: never) => void>>();

  on<K extends keyof SocialEvents>(event: K, fn: (value: SocialEvents[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, set);
    set.add(fn as (v: never) => void);
    return () => { set.delete(fn as (v: never) => void); };
  }
  emit<K extends keyof SocialEvents>(event: K, value: SocialEvents[K]): void { for (const fn of [...(this.listeners.get(event) ?? [])]) (fn as (v: SocialEvents[K]) => void)(value); }
  private go(name: string, ...args: unknown[]): void {
    this.calls.push(`${name}${args.length ? ` ${JSON.stringify(args)}` : ''}`);
    const e = this.fail[name];
    if (e) throw e;
  }
  serverNow(): number { return 1000; }
  async init(): Promise<MyProfile | null> { this.go('init'); this.profile = this.saved; return this.saved; }
  async signUp(input: SignUp): Promise<MyProfile> {
    this.go('signUp', input);
    this.profile = { ...PROFILE, band: input.band, name: input.name ?? 'Swift Falcon 42' };
    this.recoveryCode = '7K2Q-4XMV-ABCD-EFGH';
    this.emit('profile', this.profile);
    return this.profile;
  }
  async recoverProfile(input: { code: string; recovery: string }): Promise<MyProfile> {
    this.go('recoverProfile', input);
    this.profile = PROFILE;
    this.recoveryCode = input.recovery;
    this.emit('profile', PROFILE);
    return PROFILE;
  }
  async renewRecovery(): Promise<string> { this.go('renewRecovery'); this.recoveryCode = '9JXK-2MQR-VTWB-C4HN'; return this.recoveryCode; }
  async updateProfile(change: object): Promise<MyProfile> { this.go('updateProfile', change); this.profile = { ...(this.profile ?? PROFILE), ...change }; this.emit('profile', this.profile); return this.profile; }
  async renewCode(): Promise<MyProfile> { this.go('renewCode'); return this.profile ?? PROFILE; }
  async exportData(): Promise<never> { this.go('exportData'); return { exportedAt: 1 } as never; }
  async deleteProfile(): Promise<void> { this.go('deleteProfile'); this.profile = null; this.friends = []; this.emit('signedOut', { reason: 'deleted' }); }
  async sync(): Promise<void> { this.go('sync'); this.emit('friends', [...this.friends]); }
  async sendRequest(input: string): Promise<RequestResult> { this.go('sendRequest', input); return { status: 'sent' }; }
  async respond(fid: string, accept: boolean): Promise<void> { this.go('respond', fid, accept); }
  async cancelRequest(fid: string): Promise<void> { this.go('cancelRequest', fid); }
  async removeFriend(fid: string): Promise<void> { this.go('removeFriend', fid); }
  async block(fid: string): Promise<void> { this.go('block', fid); }
  async unblock(fid: string): Promise<void> { this.go('unblock', fid); }
  async report(fid: string, reason: string, opts?: object): Promise<{ blocked: boolean }> { this.go('report', fid, reason, opts ?? {}); return { blocked: false }; }
  async invite(fid: string, room: string): Promise<{ id: string; exp: number }> { this.go('invite', fid, room); return { id: 'i1', exp: 5000 }; }
  async declineInvite(invite: PendingInvite): Promise<void> { this.go('declineInvite', invite.id); }
  acceptInvite(invite: PendingInvite): void { this.go('acceptInvite', invite.id); }
  async lobbies(filter?: object): Promise<never[]> { this.go('lobbies', filter ?? {}); return []; }
  async quickMatch(game: string, _driver: unknown, opts?: { onProgress?: (p: MatchProgress) => void }): Promise<{ outcome: 'joined'; code: string }> {
    this.go('quickMatch', game);
    opts?.onProgress?.({ phase: 'searching', waitedMs: 0, code: null, offerGhost: false });
    return { outcome: 'joined', code: 'ROOM22' };
  }
  async startRun(game: string): Promise<{ run: string; game: string; at: number }> { this.go('startRun', game); return { run: 'r1', game, at: 1 }; }
  async finishRun(_t: unknown, score: number): Promise<{ improved: boolean; best: number; week: number }> { this.go('finishRun', score); return { improved: true, best: score, week: 1 }; }
  async leaderboard(q: object): Promise<never> { this.go('leaderboard', q); return {} as never; }
  async loadSync(): Promise<Partial<Record<string, { rev: number; at: number; data: unknown }>>> { this.go('loadSync'); return {}; }
  async updateSync<T>(_key: 'daily' | 'habit' | 'plans', change: (c: T | null) => T): Promise<{ rev: number; at: number; data: T }> { this.go('updateSync'); return { rev: 1, at: 1, data: change(null) }; }
  connect(): void { this.calls.push('connect'); this.hub = 'connecting'; this.emit('hub', 'connecting'); }
  disconnect(): void { this.calls.push('disconnect'); this.hub = 'idle'; }
  setActive(a: boolean): void { this.calls.push(`setActive ${a}`); }
  setStatus(s: string, game?: string): void { this.calls.push(`setStatus ${s} ${game ?? ''}`); }
}

function make(opts: { young?: boolean; kid?: boolean } = {}) {
  const client = new FakeClient();
  let tooYoung = opts.young === true;
  const remembered = vi.fn(() => { tooYoung = true; });
  let kid = opts.kid === true;
  const port = createSocialPort({ client, age: { tooYoung: () => tooYoung, remember: remembered }, kidProfile: () => kid, lang: () => 'tr' });
  const notices: SocialNotice[] = [];
  port.notices((n) => notices.push(n));
  return { client, port, notices, remembered, setKid: (v: boolean) => { kid = v; } };
}

describe('opening', () => {
  it('a device with no profile gets the sign-up, and nothing is sent', async () => {
    const { client, port } = make();
    expect(port.state().status).toBe('loading');
    await port.open();
    expect(port.state()).toMatchObject({ status: 'ready', profile: null, noOnline: null, signedOut: null, bannedUntil: null });
    expect(client.calls).toEqual(['init']);
    expect(client.calls).not.toContain('connect');
  });

  it('a saved profile is loaded, the lists are read and the hub is opened', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    await port.open();
    expect(client.calls).toEqual(['init', 'connect', 'sync']);
    expect(port.state()).toMatchObject({ status: 'ready', profile: { name: 'Mia' } });
  });

  it('two calls at once share one attempt', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    await Promise.all([port.open(), port.open()]);
    expect(client.calls.filter((c) => c === 'init')).toHaveLength(1);
  });

  it('under 16: the page sends nothing, not even a question to the server', async () => {
    const { client, port } = make({ young: true });
    await port.open();
    expect(client.calls).toEqual([]);
    expect(port.state()).toMatchObject({ status: 'ready', noOnline: 'young', profile: null });
    const made = await port.createProfile({ band: 'child', name: null });
    expect(made).toMatchObject({ ok: false, code: 'child_no_online' });
    expect(client.calls).toEqual([]);
  });

  it('saying under 16 is remembered on the device and changes the state at once', async () => {
    const { client, port, remembered } = make();
    await port.open();
    const seen: string[] = [];
    port.subscribe(() => seen.push(String(port.state().noOnline)));
    port.declareTooYoung();
    expect(remembered).toHaveBeenCalledOnce();
    expect(port.state().noOnline).toBe('young');
    expect(seen).toEqual(['young']);
    // the age band chosen in the sign-up never reaches the client: a child band is refused before any call
    expect(await port.createProfile({ band: 'child', name: 'Mia' })).toMatchObject({ ok: false, code: 'child_no_online' });
    expect(client.calls.filter((c) => c.startsWith('signUp'))).toEqual([]);
  });

  it('a kid profile of the Family plan never goes online and shows nothing of the device\'s own profile', async () => {
    const { client, port, setKid } = make({ kid: true });
    client.saved = PROFILE;
    await port.open();
    expect(client.calls).toEqual([]);
    expect(port.state()).toMatchObject({ noOnline: 'kid', profile: null, hub: 'idle' });
    expect(await port.createProfile({ band: 'adult', name: 'Mia' })).toMatchObject({ ok: false, code: 'child_no_online' });
    expect(await port.recoverProfile({ code: 'BA-7K2Q4X', recovery: '7K2Q4XMVABCDEFGH' })).toMatchObject({ ok: false, code: 'child_no_online' });
    expect(port.syncPort()).toBeNull();
    // the grown-up's profile is back when the kid profile is left
    setKid(false);
    port.recheck();
    await vi.waitFor(() => expect(port.state().profile?.name).toBe('Mia'));
    expect(port.state().noOnline).toBeNull();
  });

  it('no network with a saved profile: the saved copy stays on screen and the page is offline; the first answer brings it back', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    client.fail['sync'] = new SocialApiError(0, 'network');
    await port.open();
    expect(port.state()).toMatchObject({ status: 'offline', profile: { name: 'Mia' } });
    delete client.fail['sync'];
    client.emit('friends', [FRIEND]);
    expect(port.state().status).toBe('ready');
    expect(port.state().profile?.name).toBe('Mia');
  });

  it('a server that answers with a failure counts as offline too, and opening again tries again', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    client.fail['init'] = new SocialApiError(503, 'unavailable', { error: 'unavailable' });
    await port.open();
    expect(port.state().status).toBe('offline');
    delete client.fail['init'];
    await port.open();
    expect(port.state().status).toBe('ready');
  });

  it('a suspended profile is not offline: the page says until when', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    client.fail['init'] = new SocialApiError(403, 'banned', { error: 'banned', until: 99_000 });
    await port.open();
    expect(port.state()).toMatchObject({ status: 'ready', bannedUntil: 99_000 });
    expect(client.calls).not.toContain('connect');
  });

  it('a hub closed because of a suspension finds out until when', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    await port.open();
    client.fail['init'] = new SocialApiError(403, 'banned', { error: 'banned', until: 77_000 });
    client.hub = 'banned';
    client.emit('hub', 'banned');
    await vi.waitFor(() => expect(port.state().bannedUntil).toBe(77_000));
    // the connection coming back clears it
    delete client.fail['init'];
    client.hub = 'online';
    client.emit('hub', 'online');
    expect(port.state().bannedUntil).toBeNull();
  });

  it('the connection states reach the screen: connecting, replaced by another window, and taking it back', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    await port.open();
    client.hub = 'replaced';
    client.emit('hub', 'replaced');
    expect(port.state().hub).toBe('replaced');
    port.takeOver();
    expect(client.calls.at(-1)).toBe('connect');
  });

  it('the page being hidden or visible and what the player is doing go to the client', () => {
    const { client, port } = make();
    port.setActive(false);
    port.setStatus('playing', 'squat-flap');
    expect(client.calls).toEqual(['setActive false', 'setStatus playing squat-flap']);
  });
});

describe('the profile', () => {
  it('a sign-up hands the recovery code over once, then it is gone from the state', async () => {
    const { client, port } = make();
    await port.open();
    const r = await port.createProfile({ band: 'teen', name: 'Swift Falcon 42' });
    expect(r).toMatchObject({ ok: true, value: { band: 'teen', name: 'Swift Falcon 42' } });
    expect(client.calls.find((c) => c.startsWith('signUp'))).toBe(`signUp [{"band":"teen","name":"Swift Falcon 42","lang":"tr"}]`);
    expect(port.state()).toMatchObject({ profile: { name: 'Swift Falcon 42' }, recovery: '7K2Q-4XMV-ABCD-EFGH', status: 'ready' });
    expect(client.calls).toContain('connect');
    port.dismissRecovery();
    expect(port.state().recovery).toBeNull();
  });

  it('a sign-up carries the version of the terms the player agreed to, and none when the request has none', async () => {
    const { client, port } = make();
    await port.createProfile({ band: 'adult', name: 'Mia', terms: '2026-10-25' });
    expect(client.calls.find((c) => c.startsWith('signUp'))).toBe('signUp [{"band":"adult","name":"Mia","terms":"2026-10-25","lang":"tr"}]');
    const bare = make();
    await bare.port.createProfile({ band: 'adult', name: 'Mia' });
    expect(bare.client.calls.find((c) => c.startsWith('signUp'))).toBe('signUp [{"band":"adult","name":"Mia","lang":"tr"}]');
  });

  it('a sign-up without a typed name sends none (the server makes one)', async () => {
    const { client, port } = make();
    await port.createProfile({ band: 'adult', name: null });
    expect(client.calls.find((c) => c.startsWith('signUp'))).toBe('signUp [{"band":"adult","lang":"tr"}]');
  });

  it('a name the filter refuses comes back as a failure with its reason; the profile is not made', async () => {
    const { client, port } = make();
    client.fail['signUp'] = new SocialApiError(400, 'name_rejected', { error: 'name_rejected', reason: 'link' });
    expect(await port.createProfile({ band: 'adult', name: 'a.com' })).toEqual({ ok: false, code: 'name_rejected', reason: 'link' });
    expect(port.state().profile).toBeNull();
    expect(port.state().recovery).toBeNull();
  });

  it('bringing a profile back does not show the recovery code again, and says which field was wrong', async () => {
    const { client, port } = make();
    const ok = await port.recoverProfile({ code: 'BA-7K2Q4X', recovery: '7K2Q-4XMV-ABCD-EFGH' });
    expect(ok.ok).toBe(true);
    expect(port.state()).toMatchObject({ profile: { name: 'Mia' }, recovery: null });
    client.fail['recoverProfile'] = new SocialApiError(400, 'bad_request', { error: 'bad_request', field: 'recovery' });
    expect(await port.recoverProfile({ code: 'BA-7K2Q4X', recovery: 'x' })).toEqual({ ok: false, code: 'bad_request', field: 'recovery' });
    client.fail['recoverProfile'] = new SocialApiError(429, 'too_many_attempts', { error: 'too_many_attempts', retryAfterMs: 3_000_000 });
    expect(await port.recoverProfile({ code: 'BA-7K2Q4X', recovery: 'x' })).toEqual({ ok: false, code: 'too_many_attempts', retryAfterMs: 3_000_000 });
    client.fail['recoverProfile'] = new SocialApiError(403, 'recovery_failed', { error: 'recovery_failed' });
    expect(await port.recoverProfile({ code: 'BA-7K2Q4X', recovery: 'x' })).toEqual({ ok: false, code: 'recovery_failed' });
  });

  it('a new recovery code is shown once like the first', async () => {
    const { port } = make();
    const r = await port.renewRecovery();
    expect(r).toEqual({ ok: true, value: '9JXK-2MQR-VTWB-C4HN' });
    expect(port.state().recovery).toBe('9JXK-2MQR-VTWB-C4HN');
    port.dismissRecovery();
    expect(port.state().recovery).toBeNull();
  });

  it('a profile the player deletes leaves no "deleted" notice behind; one deleted elsewhere does', async () => {
    const mine = make();
    mine.client.saved = PROFILE;
    await mine.port.open();
    expect(await mine.port.deleteProfile()).toEqual({ ok: true, value: undefined });
    expect(mine.port.state()).toMatchObject({ profile: null, signedOut: null });
    expect(mine.notices).toEqual([]);

    const other = make();
    other.client.saved = PROFILE;
    await other.port.open();
    other.client.profile = null;
    other.client.emit('signedOut', { reason: 'unknown_device' });
    expect(other.port.state()).toMatchObject({ profile: null, signedOut: 'unknown_device' });
    expect(other.notices).toEqual([{ kind: 'signedOut', reason: 'unknown_device' }]);
    // making a new profile clears the banner
    await other.port.createProfile({ band: 'adult', name: 'Mia' });
    expect(other.port.state().signedOut).toBeNull();
  });

  it('the profile follows the client: a rename, the counts of a list', async () => {
    const { client, port } = make();
    client.saved = PROFILE;
    await port.open();
    const r = await port.updateProfile({ name: 'Mia L' });
    expect(r).toMatchObject({ ok: true, value: { name: 'Mia L' } });
    expect(port.state().profile?.name).toBe('Mia L');
  });
});

describe('friends, invitations and the rest', () => {
  it('a friend request, a new friend and an invitation each become a notice, an invitation only once', async () => {
    const { client, port, notices } = make();
    client.saved = PROFILE;
    await port.open();
    client.emit('friendRequest', { fid: 'F1', name: 'Ola', at: 1, via: 'link' });
    client.emit('friendAdded', { fid: 'F1', name: 'Ola', band: 'adult' });
    const inv: PendingInvite = { id: 'i1', from: { fid: 'F1', name: 'Ola' }, room: 'ROOM22', game: 'squat-flap', exp: 5000 };
    client.invites = [inv];
    client.emit('invites', [inv]);
    client.emit('invites', [inv]);
    client.friends = [FRIEND];
    client.emit('inviteDeclined', { id: 'i0', fid: FRIEND.fid });
    expect(notices).toEqual([
      { kind: 'request', name: 'Ola' }, { kind: 'friend', name: 'Ola' }, { kind: 'invite', invite: inv }, { kind: 'inviteDeclined', name: 'Ola' },
    ]);
    expect(port.state().invites).toEqual([inv]);
  });

  it('taking an invitation asks nobody, turning it down tells the inviter', async () => {
    const { client, port } = make();
    const inv: PendingInvite = { id: 'i1', from: { fid: 'F1', name: 'Ola' }, room: 'ROOM22', game: 'squat-flap', exp: 5000 };
    await port.answerInvite(inv, true);
    await port.answerInvite(inv, false);
    expect(client.calls).toEqual(['acceptInvite ["i1"]', 'declineInvite ["i1"]']);
  });

  it('a report carries the typed note only for an adult', async () => {
    const { client, port } = make();
    client.profile = PROFILE;
    await port.report({ fid: 'F1', reason: 'abuse', details: ' rude ', alsoBlock: true });
    client.profile = { ...PROFILE, band: 'teen' };
    await port.report({ fid: 'F1', reason: 'abuse', details: 'rude', alsoBlock: false });
    expect(client.calls).toEqual(['report ["F1","abuse",{"note":"rude","block":true}]', 'report ["F1","abuse",{}]']);
  });

  it('whose friends list is full, how long to wait and until when a profile is suspended all come back with the failure', async () => {
    const { client, port } = make();
    client.fail['respond'] = new SocialApiError(409, 'friends_full', { error: 'friends_full', who: 'them' });
    expect(await port.answer('F1', true)).toEqual({ ok: false, code: 'friends_full', who: 'them' });
    client.fail['sendRequest'] = new SocialApiError(429, 'rate_limited', { error: 'rate_limited', retryAfterMs: 4000 });
    expect(await port.addByCode('BA-7K2Q4X')).toEqual({ ok: false, code: 'rate_limited', retryAfterMs: 4000 });
    client.fail['lobbies'] = new SocialApiError(403, 'public_suspended', { error: 'public_suspended', until: 123 });
    expect(await port.lobbies({ game: 'squat-flap', region: 'eu' })).toEqual({ ok: false, code: 'public_suspended', until: 123 });
  });

  it('no call of the port throws, whatever the client throws', async () => {
    const { client, port } = make();
    for (const name of ['sendRequest', 'respond', 'cancelRequest', 'removeFriend', 'block', 'unblock', 'report', 'invite', 'lobbies', 'startRun', 'finishRun', 'leaderboard', 'exportData', 'renewCode']) {
      client.fail[name] = new SocialApiError(0, 'network');
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const results = await Promise.all([
      port.addByCode('x'), port.answer('f', true), port.cancelRequest('f'), port.unfriend('f'), port.block('f'), port.unblock('f'),
      port.report({ fid: 'f', reason: 'abuse', details: '', alsoBlock: false }), port.invite('f', 'ROOM22'), port.lobbies({ game: 'g', region: 'eu' }),
      port.startRun('g'), port.finishRun({ run: 'r', game: 'g', at: 1 }, 1), port.leaderboard({ game: 'g', scope: 'friends', week: 'current' }), port.exportData(), port.renewCode(),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, code: 'network' });
    // a bug of the page (not a failed call) is logged and told as "unavailable"
    client.fail['block'] = new TypeError('boom') as unknown as SocialApiError;
    expect(await port.block('f')).toEqual({ ok: false, code: 'unavailable' });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('a quick match goes to the client with the game, the signal and the progress callback', async () => {
    const { client, port } = make();
    const seen: MatchProgress[] = [];
    const r = await port.quickMatch({ game: 'squat-flap', driver: { create: async () => ({ code: 'X' }), join: async () => undefined, leave: async () => undefined }, signal: new AbortController().signal, onProgress: (p) => seen.push(p) });
    expect(r).toEqual({ ok: true, value: { outcome: 'joined', code: 'ROOM22' } });
    expect(seen).toHaveLength(1);
    expect(client.calls).toEqual(['quickMatch ["squat-flap"]']);
  });

  it('the synced documents go through the client\'s own sync calls, and only while there is a profile', async () => {
    const { client, port } = make();
    expect(port.syncPort()).toBeNull();
    client.profile = PROFILE;
    const sync = port.syncPort();
    expect(sync).not.toBeNull();
    await sync?.loadSync();
    await sync?.updateSync('habit', (cur: unknown) => cur ?? { v: 1 });
    expect(client.calls).toEqual(['loadSync', 'updateSync']);
  });

  it('stopping listening ends the callbacks', async () => {
    const { client, port } = make();
    const seen: number[] = [];
    port.subscribe(() => seen.push(1));
    client.emit('friends', []);
    port.dispose();
    client.emit('friends', []);
    expect(seen).toHaveLength(1);
  });
});

describe('what a failed answer means', () => {
  it('the code of an answer: the server\'s own when we know it, else what its status says', () => {
    expect(codeOf(0, 'network')).toBe('network');
    expect(codeOf(409, 'already_friends')).toBe('already_friends');
    expect(codeOf(503, 'something_new')).toBe('unavailable');
    expect(codeOf(429, 'whatever')).toBe('rate_limited');
    expect(codeOf(418, 'teapot')).toBe('bad_request');
  });

  it('carries the extras of the answer and nothing else', () => {
    expect(failed(new SocialApiError(403, 'banned', { error: 'banned', until: 5, serverTime: 1 }))).toEqual({ ok: false, code: 'banned', until: 5 });
    expect(failed(new SocialApiError(400, 'name_rejected', { error: 'name_rejected', reason: 'profanity' }))).toEqual({ ok: false, code: 'name_rejected', reason: 'profanity' });
    expect(failed(new SocialApiError(409, 'friends_full', { error: 'friends_full', who: 'me' }))).toEqual({ ok: false, code: 'friends_full', who: 'me' });
    expect(failed(new SocialApiError(429, 'too_many_attempts', { error: 'too_many_attempts', retryAfterMs: 9 }))).toEqual({ ok: false, code: 'too_many_attempts', retryAfterMs: 9 });
    expect(failed(new SocialApiError(400, 'bad_request', { error: 'bad_request', field: 'code' }))).toEqual({ ok: false, code: 'bad_request', field: 'code' });
  });
});
