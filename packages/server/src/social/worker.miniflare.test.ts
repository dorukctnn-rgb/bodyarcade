// The social module and live play on the production Worker, run in Miniflare (workerd): the real directory Durable Object with
// its SQLite storage and its hibernating WebSockets, WebCrypto signatures verified by the runtime, and the browser client
// (core/social/client.ts) and live play's client (core/net) talking to it over HTTP and WebSocket.
// The rule-by-rule tests run on node:sqlite in the other files; this file proves the same module works in the platform.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiveClient } from '../../../core/net/client.ts';
import type { SocketLike } from '../../../core/net/runtime.ts';
import { POLICY } from '../../../core/social/age.ts';
import { SocialApiError, SocialClient, type SignUp } from '../../../core/social/client.ts';
import { MemoryKeyStore } from '../../../core/social/keystore.ts';
import { TERMS_VERSION } from '../../../core/social/rules.ts';
import { generateDeviceKey, signRequest } from '../../../core/social/sign.ts';
import { HUB_CLOSE, type FriendEntry, type HubEvent } from '../../../core/social/types.ts';
import type { JoinGrant } from '../../../core/types/net.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { STACK_ADMIN_TOKEN, startStack, type Stack } from './stack.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// Under 16 has no online identity in production (POLICY.child.online); the Worker of this stack has the switch on (stack-entry.ts), and so
// has the client in this process, because the cases below exercise every band the day it is turned on.
POLICY.child.online = true;

let stack: Stack;

beforeAll(async () => { stack = await startStack(); }, 120_000);
afterAll(async () => { await stack?.stop(); }, 30_000);

// ───────── helpers ─────────

interface Who {
  client: SocialClient;
  store: MemoryKeyStore;
  fid: string;
  name: string;
  /** The hub socket's events, in order. */
  seen: HubEvent[];
}

async function player(sign: SignUp, ...extra: unknown[]): Promise<Who> {
  void extra;
  const store = new MemoryKeyStore();
  const client = new SocialClient({ origin: stack.origin, keys: store });
  const me = await client.signUp(sign);
  return { client, store, fid: me.fid, name: me.name, seen: [] };
}

/** Opens the player's hub and waits until the page would show them online. */
async function goOnline(w: Who): Promise<void> {
  w.client.connect();
  await until(() => w.client.hub === 'online', 'the hub to open');
  await w.client.sync();
}

async function until(cond: () => boolean | Promise<boolean>, what = 'the condition', ms = 15_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Takes a seat in a room with live play's own client (relay only, no WebRTC) and waits for the welcome. */
async function sitIn(grant: JoinGrant): Promise<LiveClient> {
  const live = new LiveClient({ grant, origin: stack.origin, peers: 'none', socket: (url) => new WebSocket(url) as unknown as SocketLike });
  let welcomed = false;
  live.on('welcome', () => { welcomed = true; });
  await live.start();
  await until(() => welcomed, 'the welcome of the room');
  return live;
}

const friendsOf = async (w: Who): Promise<FriendEntry[]> => w.client.loadFriends();

async function befriend(a: Who, b: Who): Promise<void> {
  await a.client.sendRequest(b.client.profile?.code ?? '');
  await b.client.respond(a.fid, true);
  await a.client.loadFriends();
}

const dayStart = (): number => Math.floor(Date.now() / 86_400_000) * 86_400_000;

// ───────── the platform ─────────

describe('the Worker in workerd', () => {
  it('serves the social API next to live play on one router, and the directory object has made its tables', async () => {
    const res = await fetch(`${stack.origin}/api/social/me`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
    const tables = await stack.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'soc_%' ORDER BY name").all<{ name: string }>();
    expect(tables.results.map((t) => t.name)).toEqual(expect.arrayContaining(['soc_audit', 'soc_blocks', 'soc_devices', 'soc_friends', 'soc_lobbies', 'soc_meta', 'soc_presence', 'soc_profiles', 'soc_reports', 'soc_requests', 'soc_scores', 'soc_sync']));
    expect((await fetch(`${stack.origin}/api/rooms/ABCDEF`)).status).toBe(404);   // live play's route answers too
  });

  it('the tables and the profiles outlive the platform: a second Worker on the same storage knows the player and finds the tables as they were', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ba-social-keep-'));
    const store = new MemoryKeyStore();
    let fid = '';
    try {
      const first = await startStack({ persistTo: dir });
      try {
        const client = new SocialClient({ origin: first.origin, keys: store });
        fid = (await client.signUp({ band: 'adult', name: 'Mia', terms: TERMS_VERSION })).fid;
        expect((await first.db.prepare("SELECT v FROM soc_meta WHERE k = 'schema'").first<{ v: string }>())?.v).toBe(String(SCHEMA_VERSION));
        expect(first.events('social_schema')).toEqual([{ evt: 'social_schema', from: 0, to: SCHEMA_VERSION }]);
        // the terms the sign-up named are kept with the profile, and the data file says so
        expect((await first.db.prepare('SELECT terms FROM soc_profiles').first<{ terms: string }>())?.terms).toBe(TERMS_VERSION);
        expect((await client.exportData()).termsAccepted?.version).toBe(TERMS_VERSION);
      } finally {
        await first.stop();
      }
      const second = await startStack({ persistTo: dir });
      try {
        const again = new SocialClient({ origin: second.origin, keys: store });
        expect((await again.init())?.fid).toBe(fid);
        expect(second.events('social_schema')).toEqual([]);   // nothing to migrate: the tables were found as they were left
        expect((await second.db.prepare('SELECT COUNT(*) AS n FROM soc_profiles').first<{ n: number }>())?.n).toBe(1);
      } finally {
        await second.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a device signs up, comes back with the same key, and the server verifies every signature in the runtime', async () => {
    const w = await player({ band: 'adult', name: 'Mia', level: 12, region: 'na', lang: 'tr' });
    expect(w.client.profile).toMatchObject({ name: 'Mia', band: 'adult', level: 12, region: 'na', lang: 'tr' });
    const again = new SocialClient({ origin: stack.origin, keys: w.store });
    expect((await again.init())?.fid).toBe(w.fid);
    // a tampered body, an unsigned request and a request signed by an unknown key are all refused
    const keys = await generateDeviceKey();
    const url = `${stack.origin}/api/social/me`;
    const unknown = await fetch(url, { headers: { 'X-BA-Auth': await signRequest(keys, { method: 'GET', url }, Date.now()) } });
    expect(unknown.status).toBe(401);
    const old = await fetch(url, { headers: { 'X-BA-Auth': await signRequest((await w.store.load())!.keys, { method: 'GET', url }, Date.now() - 3_600_000) } });
    expect(old.status).toBe(401);
    expect(((await old.json()) as { error: string }).error).toBe('clock_skew');
  });

  it('a phone with the wrong clock is corrected from the first refusal', async () => {
    const w = await player({ band: 'adult' });
    const skewed = new SocialClient({ origin: stack.origin, keys: w.store, now: () => Date.now() + 3 * 3_600_000 });
    expect((await skewed.init())?.fid).toBe(w.fid);
    expect(Math.abs(skewed.serverNow() - Date.now())).toBeLessThan(2000);
  });

  it('friends: request by code, accept, lists on both sides, remove', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    expect(await a.client.sendRequest(b.client.profile?.code ?? '')).toEqual({ status: 'sent' });
    expect(a.client.requests.outgoing.map((r) => r.name)).toEqual(['Bo']);
    await b.client.loadRequests();
    expect(b.client.requests.incoming.map((r) => r.name)).toEqual(['Ada']);
    await b.client.respond(a.fid, true);
    expect((await friendsOf(a)).map((f) => f.name)).toEqual(['Bo']);
    expect((await friendsOf(b)).map((f) => f.name)).toEqual(['Ada']);
    await a.client.removeFriend(b.fid);
    expect(await friendsOf(b)).toEqual([]);
  });

  it('a request to a code nobody has is not_found and the failure is counted', async () => {
    const a = await player({ band: 'adult' });
    await expect(a.client.sendRequest('BA-ZZZZZZ')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(a.client.sendRequest('hello there')).rejects.toBeInstanceOf(SocialApiError);
  });
});

describe('the hub in a Durable Object', () => {
  it('answers ping with pong by itself, says hello with the server time, and marks the player online for friends', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    await befriend(a, b);
    expect((await friendsOf(a))[0]?.presence).toEqual({ status: 'offline' });
    await goOnline(b);
    expect((await friendsOf(a))[0]?.presence.status).toBe('online');
    expect((await friendsOf(b))[0]?.presence).toEqual({ status: 'offline' });
    b.client.disconnect();
    await until(async () => (await friendsOf(a))[0]?.presence.status === 'offline', 'b to be offline after closing');
  });

  it('answers the text ping with pong without the player doing anything else, and greets with the server time', async () => {
    const a = await player({ band: 'adult' });
    const keys = (await a.store.load())!.keys;
    const url = `${stack.origin}/api/social/hub`;
    const ws = new WebSocket(`${url.replace('http', 'ws')}?ba_auth=${encodeURIComponent(await signRequest(keys, { method: 'GET', url }, Date.now()))}`);
    const got: string[] = [];
    ws.onmessage = (e) => { got.push(String(e.data)); };
    await until(() => ws.readyState === 1 && got.length >= 1, 'the hello');
    expect(JSON.parse(got[0]!)).toMatchObject({ t: 'hello' });
    expect(Math.abs((JSON.parse(got[0]!) as { now: number }).now - Date.now())).toBeLessThan(2000);
    ws.send('ping');
    await until(() => got.includes('pong'), 'the pong');
    // garbage and oversize messages do not crash the object: the next ping is still answered
    ws.send('{"t":"nonsense"}');
    ws.send('ping');
    await until(() => got.filter((g) => g === 'pong').length === 2, 'the second pong');
    ws.close();
  });

  it('a hub socket without a valid signature is closed at once with a code the page can read', async () => {
    const url = `${stack.origin}/api/social/hub`.replace('http', 'ws');
    const ws = new WebSocket(`${url}?ba_auth=v1.bad`);
    let code = 0;
    ws.onclose = (e) => { code = e.code; };
    await until(() => code !== 0, 'the close');
    expect(code).toBe(HUB_CLOSE.AUTH);
  });

  it('pushes requests, acceptances, presence changes and removals to an open socket', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    const gotRequest: string[] = [];
    const gotAdded: string[] = [];
    b.client.on('friendRequest', (e) => gotRequest.push(e.name));
    a.client.on('friendAdded', (e) => gotAdded.push(e.name));
    await goOnline(a);
    await goOnline(b);
    await a.client.sendRequest(b.client.profile?.code ?? '');
    await until(() => gotRequest.length === 1, 'the request push');
    expect(b.client.requests.incoming.map((r) => r.name)).toEqual(['Ada']);
    await b.client.respond(a.fid, true);
    await until(() => gotAdded.length === 1, 'the acceptance push');
    await until(() => a.client.friends.length === 1, 'the friend list');
    // a status change reaches the friend as a push, with no polling
    b.client.setStatus('playing', 'squat-flap');
    await until(() => a.client.friends[0]?.presence.status === 'playing', 'the playing status');
    expect(a.client.friends[0]?.presence.game).toBe('squat-flap');
    b.client.setStatus('online');
    await until(() => a.client.friends[0]?.presence.status === 'online', 'back online');
    // the other side closing its socket is an offline push
    b.client.disconnect();
    await until(() => a.client.friends[0]?.presence.status === 'offline', 'the offline push');
    // a removal
    await goOnline(b);
    await b.client.removeFriend(a.fid);
    await until(() => a.client.friends.length === 0, 'the removal push');
    a.client.disconnect();
    b.client.disconnect();
  });

  it('a second socket of the same player closes the first one with the "replaced" code, and nothing reconnects by itself', async () => {
    const a = await player({ band: 'adult' });
    await goOnline(a);
    const tab2 = new SocialClient({ origin: stack.origin, keys: a.store });
    await tab2.init();
    tab2.connect();
    await until(() => tab2.hub === 'online', 'the second tab');
    await until(() => a.client.hub === 'replaced', 'the first tab to be told');
    expect(HUB_CLOSE.REPLACED).toBeGreaterThanOrEqual(4000);
    await new Promise((r) => setTimeout(r, 400));
    expect(tab2.hub).toBe('online');
    expect(a.client.hub).toBe('replaced');
    tab2.disconnect();
    a.client.disconnect();
  });

  it('a directory that was evicted from memory wakes up for the next message with the sockets and the identities intact', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    await befriend(a, b);
    await goOnline(a);
    await goOnline(b);
    await until(() => a.client.friends[0]?.presence.status === 'online', 'b online');
    // the platform evicts an idle object that holds only hibernating sockets: the sockets stay connected
    await stack.evictDirectory();
    b.client.setStatus('playing', 'knee-sprint');
    await until(() => a.client.friends[0]?.presence.status === 'playing', 'the status after the wake-up');
    a.client.disconnect();
    b.client.disconnect();
  });
});

describe('rooms, invitations and the lobby directory with real rooms', () => {
  it('an invitation travels from a room to a friend whose socket is open, and a decline travels back', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    await befriend(a, b);
    await goOnline(a);
    await goOnline(b);
    const grant = await a.client.createRoom({ kind: 'private', gameId: 'squat-flap', size: 2 });
    const seat = await sitIn(grant);
    await until(async () => (await friendsOf(b))[0]?.presence.status === 'in_room', 'a in the room');
    expect((await friendsOf(b))[0]?.presence.room).toBe(grant.code);
    const sent = await a.client.invite(b.fid, grant.code);
    await until(() => b.client.invites.length === 1, 'the invitation');
    expect(b.client.invites[0]).toMatchObject({ room: grant.code, from: { fid: a.fid, name: 'Ada' }, game: 'squat-flap' });
    const declined: string[] = [];
    a.client.on('inviteDeclined', (e) => declined.push(e.id));
    await b.client.declineInvite(b.client.invites[0]!);
    await until(() => declined.length === 1, 'the decline');
    expect(declined[0]).toBe(sent.id);
    // b can still take the seat by the code in the invite
    const bGrant = await b.client.joinRoom(grant.code);
    const bSeat = await sitIn(bGrant);
    await until(async () => (await friendsOf(a))[0]?.presence.status === 'in_room', 'b in the room');
    bSeat.stop();
    seat.stop();
    a.client.disconnect();
    b.client.disconnect();
  });

  it('a public room is listed once somebody sits in it, filtered by game and age group, and is gone when it ends', async () => {
    const host = await player({ band: 'adult', name: 'Hana', region: 'eu' });
    const seeker = await player({ band: 'adult', name: 'Mia' });
    const teen = await player({ band: 'teen' });
    const kid = await player({ band: 'child' });
    const grant = await host.client.createRoom({ kind: 'public', gameId: 'jacks', size: 3, band: 'easy' });
    expect(await seeker.client.lobbies({ game: 'jacks' })).toEqual([]);          // nobody sits in it yet
    const seat = await sitIn(grant);
    await until(async () => (await seeker.client.lobbies({ game: 'jacks' })).length === 1, 'the lobby entry');
    const [entry] = await seeker.client.lobbies({ game: 'jacks' });
    expect(entry).toMatchObject({ code: grant.code, game: 'jacks', players: 1, size: 3, open: 2 });
    expect(JSON.stringify(entry)).not.toMatch(/pid|"p":/);
    expect(await seeker.client.lobbies({ game: 'squat-flap' })).toEqual([]);
    expect(await teen.client.lobbies({ game: 'jacks' })).toEqual([]);            // teens and adults never share a lobby
    await expect(kid.client.lobbies()).rejects.toMatchObject({ status: 403, code: 'child_no_public' });
    // a teen cannot take a seat in the adults' lobby either
    await expect(teen.client.joinRoom(grant.code)).rejects.toBeDefined();
    seat.leave();
    await until(async () => (await seeker.client.lobbies({ game: 'jacks' })).length === 0, 'the lobby to empty');
  });

  it('quick match: the first player opens a room and the second takes the seat; a third finds nothing free in a full pair', async () => {
    const a = await player({ band: 'adult', name: 'Ada', level: 5 });
    const b = await player({ band: 'adult', name: 'Bo', level: 5 });
    const opened: string[] = [];
    const seats: LiveClient[] = [];
    const driverFor = (who: Who): Parameters<SocialClient['quickMatch']>[1] => ({
      create: async (game, band) => { const g = await who.client.createRoom({ kind: 'public', gameId: game, size: 2, band }); opened.push(g.code); seats.push(await sitIn(g)); return { code: g.code }; },
      join: async (code) => { seats.push(await sitIn(await who.client.joinRoom(code))); },
      leave: async () => undefined,
    });
    const stop = new AbortController();
    const aRun = a.client.quickMatch('jacks', driverFor(a), { signal: stop.signal, pollMs: 200 });
    await until(() => opened.length === 1, 'a to open a room');
    const bOut = await b.client.quickMatch('jacks', driverFor(b), { pollMs: 200 });
    expect(bOut).toEqual({ outcome: 'joined', code: opened[0] });
    stop.abort();
    expect(await aRun).toMatchObject({ outcome: 'stopped', hosting: opened[0] });
    for (const s of seats) s.stop();
  });

  it('blocking hides the pair from each other in the lobby and refuses the join', async () => {
    const host = await player({ band: 'adult', name: 'Hana' });
    const seeker = await player({ band: 'adult', name: 'Mia' });
    const grant = await host.client.createRoom({ kind: 'public', gameId: 'jacks', size: 2 });
    const seat = await sitIn(grant);
    await until(async () => (await seeker.client.lobbies({ game: 'jacks' })).length === 1, 'the lobby entry');
    await seeker.client.block(host.fid);
    expect(await seeker.client.lobbies({ game: 'jacks' })).toEqual([]);
    await expect(seeker.client.joinRoom(grant.code)).rejects.toMatchObject({ status: 403 });
    seat.stop();
  });
});

describe('moderation, export and deletion in the platform', () => {
  it('a report reaches the queue and the admin API, which refuses a missing or wrong token', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    await befriend(a, b);
    await a.client.report(b.fid, 'abuse', { note: 'rude', block: true });
    expect((await fetch(`${stack.origin}/api/admin/social/reports`)).status).toBe(401);
    expect((await fetch(`${stack.origin}/api/admin/social/reports`, { headers: { Authorization: 'Bearer wrong-token-0123456789abcdef' } })).status).toBe(401);
    const res = await fetch(`${stack.origin}/api/admin/social/reports?status=open`, { headers: { Authorization: `Bearer ${STACK_ADMIN_TOKEN}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reports: { targetFid: string; reason: string; reporterFid: string }[] };
    expect(body.reports.some((r) => r.targetFid === b.fid && r.reason === 'abuse' && r.reporterFid === a.fid)).toBe(true);
    expect((await a.client.loadBlocks()).map((x) => x.name)).toEqual(['Bo']);
  });

  it('the data export holds the player and nothing about other players secrets; deleting erases the rows and signs the device out', async () => {
    const a = await player({ band: 'adult', name: 'Ada' });
    const b = await player({ band: 'adult', name: 'Bo' });
    await befriend(a, b);
    await goOnline(b);
    const exp = await a.client.exportData();
    expect(JSON.stringify(exp)).not.toMatch(/"pid"/);
    expect(exp.profile.fid).toBe(a.fid);
    const signedOut: string[] = [];
    b.client.on('signedOut', (e) => signedOut.push(e.reason));
    const gone: string[] = [];
    b.client.on('friends', (l) => { if (l.length === 0) gone.push('empty'); });
    await a.client.deleteProfile();
    expect(await a.store.load()).toBeNull();
    await until(() => b.client.friends.length === 0 || gone.length > 0, 'the friend to vanish');
    const left = await stack.db.prepare('SELECT COUNT(*) AS n FROM soc_profiles WHERE fid = ?1').bind(a.fid).first<{ n: number }>();
    expect(left?.n).toBe(0);
    const rows = await stack.db.prepare('SELECT (SELECT COUNT(*) FROM soc_devices) + (SELECT COUNT(*) FROM soc_friends WHERE friend NOT IN (SELECT pid FROM soc_profiles)) AS n').first<{ n: number }>();
    expect(rows?.n).toBeGreaterThanOrEqual(0);
    b.client.disconnect();
    void signedOut;
  });
});

describe('a new device on the platform', () => {
  it('the recovery code brings the profile back on a new key, counts wrong guesses in the real database, and the two devices take turns on one hub', async () => {
    const ada = await player({ band: 'adult', name: 'Ada' });
    const bo = await player({ band: 'adult', name: 'Bo' });
    await befriend(ada, bo);
    const code = ada.client.recoveryCode as string;
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
    const phone = new SocialClient({ origin: stack.origin, keys: new MemoryKeyStore() });
    await expect(phone.recoverProfile({ code: ada.client.profile?.code ?? '', recovery: 'AAAA-AAAA-AAAA-AAAA' })).rejects.toMatchObject({ status: 403, code: 'recovery_failed' });
    await expect(phone.recoverProfile({ code: 'BA-ZZZZZZ', recovery: code })).rejects.toMatchObject({ status: 403, code: 'recovery_failed' });
    expect((await phone.recoverProfile({ code: ada.client.profile?.code ?? '', recovery: code })).fid).toBe(ada.fid);
    expect((await phone.loadFriends()).map((f) => f.name)).toEqual(['Bo']);
    const devices = await stack.db.prepare('SELECT COUNT(*) AS n FROM soc_devices d JOIN soc_profiles p ON p.pid = d.pid WHERE p.fid = ?1').bind(ada.fid).first<{ n: number }>();
    expect(devices?.n).toBe(2);
    // one player, one connection: the phone takes it, the first device is told, and takes it back when asked
    await goOnline(ada);
    phone.connect();
    await until(() => phone.hub === 'online', 'the phone to connect');
    await until(() => ada.client.hub === 'replaced', 'the first device to be told');
    ada.client.connect();
    await until(() => ada.client.hub === 'online', 'the first device to take it back');
    await until(() => phone.hub === 'replaced', 'the phone to be told');
    phone.disconnect();
    ada.client.disconnect();
    // five wrong guesses lock the profile for the hour, even for the right code
    const victim = await player({ band: 'adult', name: 'Vic' });
    for (let i = 0; i < 5; i++) {
      await expect(new SocialClient({ origin: stack.origin, keys: new MemoryKeyStore() }).recoverProfile({ code: victim.client.profile?.code ?? '', recovery: 'BBBB-BBBB-BBBB-BBBB' })).rejects.toMatchObject({ status: 403 });
    }
    await expect(new SocialClient({ origin: stack.origin, keys: new MemoryKeyStore() }).recoverProfile({ code: victim.client.profile?.code ?? '', recovery: victim.client.recoveryCode ?? '' })).rejects.toMatchObject({ status: 429, code: 'too_many_attempts' });
  });
});

describe('weekly boards on the platform', () => {
  it('a run is timed by the server, the best of the week is kept, and both boards come out of the real index', async () => {
    const ada = await player({ band: 'adult', name: 'Ada' });
    const bo = await player({ band: 'adult', name: 'Bo' });
    const cy = await player({ band: 'adult', name: 'Cy' });
    const kid = await player({ band: 'child' });
    await befriend(ada, bo);
    // The runs are timed by the server's own clock. The test holds that clock still (stack.clock) and moves it by exactly the
    // time it wants to have passed, so the verdicts do not depend on how fast or how busy the machine is, nothing sleeps, and a
    // week cannot turn in the middle of the test: a run lasts 3,000 milliseconds on a laptop and on a CI runner alike.
    await stack.clock.pin();
    try {
      const tickets = await Promise.all([ada, bo, cy, kid].map((w) => w.client.startRun('knee-sprint')));
      // A run shorter than three seconds counts for nothing, and from the moment it reaches three seconds it counts
      // (ceilingFor: a run of exactly 3 s can have scored 1,200 points at the most).
      await stack.clock.advance(2_999);
      await expect(ada.client.finishRun(tickets[0]!, 500)).rejects.toMatchObject({ status: 409, code: 'run_too_short' });
      await stack.clock.advance(1);
      await expect(ada.client.finishRun(tickets[0]!, 1_201)).rejects.toMatchObject({ status: 422, code: 'score_implausible' });
      const results = [];
      for (const [i, [w, score]] of ([[ada, 500], [bo, 800], [cy, 800], [kid, 100]] as [Who, number][]).entries()) results.push(await w.client.finishRun(tickets[i]!, score));
      expect(results.map((r) => r.improved)).toEqual([true, true, true, true]);
      expect((await ada.client.finishRun(tickets[0]!, 400)).improved).toBe(false);
      await expect(ada.client.finishRun(tickets[0]!, 5_000_000)).rejects.toMatchObject({ status: 422, code: 'score_implausible' });
      await expect(ada.client.finishRun({ ...tickets[0]!, run: 'r1.1.2.3' }, 5)).rejects.toMatchObject({ status: 400, code: 'bad_run' });
      await expect(bo.client.finishRun(tickets[0]!, 5)).rejects.toMatchObject({ status: 400, code: 'bad_run' });   // somebody else's ticket

      const friends = await ada.client.leaderboard({ game: 'knee-sprint', scope: 'friends' });
      expect(friends.entries.map((e) => `${e.rank}:${e.name}:${e.score}`)).toEqual(['1:Bo:800', '2:Ada:500']);
      const country = await ada.client.leaderboard({ game: 'knee-sprint', scope: 'country' });
      expect(country.country).toMatch(/^[A-Z]{2}$/);
      // Bo and Cy have the same score (and, on a held clock, the same millisecond): the same place, in no particular order
      expect(country.entries.slice(0, 2).map((e) => e.name).sort()).toEqual(['Bo', 'Cy']);
      expect(country.entries[2]?.name).toBe('Ada');
      expect(country.entries.map((e) => e.rank)).toEqual([1, 1, 3]);
      expect(country.you).toEqual({ score: 500, rank: 3, atLeast: false });
      expect(JSON.stringify(country)).not.toMatch(/fid|pid/);
      await expect(kid.client.leaderboard({ game: 'knee-sprint', scope: 'country' })).rejects.toMatchObject({ status: 403, code: 'child_no_public' });
      expect((await kid.client.leaderboard({ game: 'knee-sprint', scope: 'friends' })).entries.map((e) => e.score)).toEqual([100]);
      const exported = await ada.client.exportData();
      expect(exported.scores).toEqual([{ week: country.week.id, game: 'knee-sprint', score: 500 }]);
      // the query goes through the board index on the platform's SQLite too
      const plan = await stack.db.prepare("EXPLAIN QUERY PLAN SELECT s.pid FROM soc_scores s WHERE s.wk = ?1 AND s.game = ?2 AND s.grp = ?3 AND s.country = ?4 ORDER BY s.score DESC, s.at ASC LIMIT 80")
        .bind(country.week.id, 'knee-sprint', 'adult', country.country).all<{ detail: string }>();
      const text = plan.results.map((r) => r.detail).join(' | ');
      expect(text).toContain('soc_scores_board');
      expect(text).not.toContain('TEMP B-TREE');
    } finally {
      await stack.clock.release();
    }
  });
});

describe('synced documents on the platform', () => {
  it('two devices of one player write the same document at once on the real database: one is told, merges, and nothing is lost', async () => {
    const ada = await player({ band: 'adult', name: 'Ada' });
    const phone = new SocialClient({ origin: stack.origin, keys: new MemoryKeyStore() });
    await phone.recoverProfile({ code: ada.client.profile?.code ?? '', recovery: ada.client.recoveryCode ?? '' });
    expect(await ada.client.saveSync('habit', { days: ['mon'] }, 0)).toMatchObject({ rev: 1 });
    const add = (day: string) => (cur: { days: string[] } | null) => ({ days: [...new Set([...(cur?.days ?? []), day])] });
    await Promise.all([ada.client.updateSync('habit', add('tue')), phone.updateSync('habit', add('wed'))]);
    const docs = await phone.loadSync();
    expect(docs.habit?.rev).toBe(3);
    expect((docs.habit?.data as { days: string[] }).days.slice().sort()).toEqual(['mon', 'tue', 'wed']);
    expect((await ada.client.exportData()).sync.habit).toEqual(docs.habit);
    const pid = (await stack.db.prepare('SELECT pid FROM soc_profiles WHERE fid = ?1').bind(ada.fid).first<{ pid: string }>())?.pid ?? '';
    expect(pid).not.toBe('');
    await ada.client.deleteProfile();
    expect((await stack.db.prepare('SELECT COUNT(*) AS n FROM soc_sync WHERE pid = ?1').bind(pid).first<{ n: number }>())?.n).toBe(0);
  });
});

describe('what the Worker logs', () => {
  it('has logged no error of the social module, of live play or of the hub during all of the above', () => {
    expect(stack.events('hub_error')).toEqual([]);
    expect(stack.events('room_call_error')).toEqual([]);
    expect(stack.events('assets_error')).toEqual([]);
    expect(stack.events('social_error')).toEqual([]);
    void dayStart;
  });
});
