// The browser client (core/social/client.ts) against the real routes in process: sign-up and the stored device key, the clock
// correction, friends and blocks, the hub socket (a scripted WebSocket: backoff, close codes, half-open detection, pushes),
// the signed fetch for live play and quick match. Real browsers and a real Worker are covered by tests/social.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialApiError, SocialClient, type MatchDriver, type SignUp, type WebSocketLike } from '../../../core/social/client.ts';
import { MemoryKeyStore, openKeyStore } from '../../../core/social/keystore.ts';
import { isPresetName } from '../../../core/social/presets.ts';
import { PRESENCE } from '../../../core/social/rules.ts';
import { HUB_CLOSE, type AgeBand, type HubEvent } from '../../../core/social/types.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import type { ExecutionContextLike } from '../cf.ts';
import { publishRoom } from './lobbies.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
let app: TestApp;
let ipSeq = 0;
let offline = false;
let calls: string[] = [];

class FakeWs implements WebSocketLike {
  static all: FakeWs[] = [];
  readonly sent: string[] = [];
  closed: number | null = null;
  /** The platform answers the text 'ping' with 'pong' by itself; a test that wants a half-open socket turns this off. */
  autoPong = true;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; FakeWs.all.push(this); }
  send(data: string): void {
    this.sent.push(data);
    if (data === 'ping' && this.autoPong) queueMicrotask(() => this.receive('pong'));
  }
  close(code = 1000): void { this.closed = code; }
  open(): void { this.onopen?.({}); }
  receive(ev: HubEvent | 'pong'): void { this.onmessage?.({ data: typeof ev === 'string' ? ev : JSON.stringify(ev) }); }
  drop(code = 1006): void { this.onclose?.({ code }); }
  commands(): unknown[] { return this.sent.filter((s) => s !== 'ping').map((s) => JSON.parse(s) as unknown); }
}
const lastWs = (): FakeWs => FakeWs.all[FakeWs.all.length - 1] as FakeWs;

const realSetTimeout = globalThis.setTimeout;
/** Lets real asynchronous work (WebCrypto runs on a thread) finish while timers stay fake: `ms` of real time. */
async function idle(ms = 8): Promise<void> {
  await new Promise<void>((r) => realSetTimeout(r, ms));
}
/** Waits in real time until the condition holds (the fake clock does not move meanwhile). */
async function until(cond: () => boolean, what = 'the condition', ms = 8000): Promise<void> {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((r) => realSetTimeout(r, 2));
  }
}
const clients: SocialClient[] = [];

interface Dev {
  client: SocialClient;
  store: MemoryKeyStore;
  ip: string;
  /** Added to the client's clock (a phone with a wrong clock). */
  skew: { ms: number };
  pid(): string;
  fid(): string;
}

function makeClient(store: MemoryKeyStore, ip: string, skew: { ms: number }): SocialClient {
  const pending: Promise<unknown>[] = [];
  const ctx: ExecutionContextLike = { waitUntil: (p) => { pending.push(p); } };
  const net = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (offline) throw new TypeError('network down');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req = new Request(url, init);
    req.headers.set('CF-Connecting-IP', ip);
    req.headers.set('CF-IPCountry', 'TR');
    calls.push(`${req.method} ${new URL(url).pathname}`);
    const res = await app.router.handle(req, app.env, ctx);
    while (pending.length > 0) await Promise.allSettled(pending.splice(0));
    if (!res) throw new Error(`no route for ${req.method} ${url}`);
    return res;
  };
  const client = new SocialClient({ origin: TEST_ORIGIN, keys: store, fetch: net as typeof fetch, WebSocket: FakeWs, now: () => Date.now() + skew.ms, random: () => 0.5 });
  clients.push(client);
  return client;
}

async function device(band: AgeBand = 'adult', extra: Partial<SignUp> = {}, signUp = true): Promise<Dev> {
  const store = new MemoryKeyStore();
  const skew = { ms: 0 };
  const ip = `10.60.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
  const client = makeClient(store, ip, skew);
  const dev: Dev = {
    client, store, ip, skew,
    pid: () => (app.db.raw.prepare('SELECT pid FROM soc_profiles WHERE fid = ?').get(client.profile?.fid ?? '') as { pid: string }).pid,
    fid: () => client.profile?.fid ?? '',
  };
  if (signUp) await client.signUp({ band, ...extra });
  return dev;
}

/** Opens the hub of a device (the server side counts the player as connected) and returns its socket. */
async function online(d: Dev): Promise<FakeWs> {
  const before = FakeWs.all.length;
  d.client.connect();
  await until(() => FakeWs.all.length > before, 'the hub socket to be opened');
  const ws = lastWs();
  app.hubs.connect(d.pid());
  ws.open();
  expect(d.client.hub).toBe('online');
  await d.client.sync();                                      // the lists the hub loads when it opens
  return ws;
}

/** Hands the socket of `d` what the server pushed to it. */
async function pump(d: Dev, ws: FakeWs): Promise<void> {
  for (const ev of app.hubs.take(d.pid())) ws.receive(ev);
  await idle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  app = createTestApp();
  FakeWs.all = [];
  offline = false;
  calls = [];
  ipSeq = 0;
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();         // no reconnect of one test may open a socket in the next
  vi.useRealTimers();
  await idle(5);
});

describe('the device identity', () => {
  it('a new device has no profile, signing up makes one and the key never leaves the device', async () => {
    const d = await device('adult', {}, false);
    expect(await d.client.init()).toBeNull();
    const me = await d.client.signUp({ band: 'adult', name: 'Mia', level: 12, region: 'na', lang: 'tr' });
    expect(me).toMatchObject({ name: 'Mia', band: 'adult', level: 12, region: 'na', lang: 'tr', can: { freeName: true, freeText: true, video: true, publicPlay: true } });
    expect(me.code).toMatch(/^BA-[A-Z2-9]{6}$/);
    expect(me.link).toBe(`${TEST_ORIGIN}/f/${me.code}`);
    const saved = await d.store.load();
    expect(saved?.registered).toBe(true);
    expect(saved?.keys.privateKey.extractable).toBe(false);
    expect(saved?.keys.publicRaw).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(d.client.persistent).toBe(false);
    // nothing about the secret id reaches the client
    expect(JSON.stringify(me)).not.toContain(d.pid());
  });

  it('comes back after a restart: the same store gives the same profile with a single read', async () => {
    const d = await device('adult', { name: 'Mia' });
    const fid = d.fid();
    calls = [];
    const again = makeClient(d.store, d.ip, d.skew);
    const me = await again.init();
    expect(me?.fid).toBe(fid);
    expect(calls).toEqual(['GET /api/social/me']);
    expect(await d.store.load()).toMatchObject({ registered: true, me: { fid } });
  });

  it('a teen and a child get a generated name whatever they typed; one device signs up once', async () => {
    const teen = await device('teen', { name: 'Totally Typed' });
    expect(teen.client.profile?.name).not.toBe('Totally Typed');
    expect(isPresetName(teen.client.profile?.name)).toBe(true);
    expect(teen.client.profile?.can).toMatchObject({ freeName: false, freeText: false, video: false });
    const kid = await device('child');
    expect(kid.client.profile?.can.publicPlay).toBe(false);
    await expect(teen.client.signUp({ band: 'teen' })).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });

  it('a device whose profile the server forgot signs out cleanly and can start over', async () => {
    const d = await device('adult');
    const signedOut: string[] = [];
    d.client.on('signedOut', (e) => signedOut.push(e.reason));
    app.db.raw.prepare('DELETE FROM soc_devices').run();
    const again = makeClient(d.store, d.ip, d.skew);
    again.on('signedOut', (e) => signedOut.push(e.reason));
    expect(await again.init()).toBeNull();
    expect(signedOut).toEqual(['unknown_device']);
    expect(await d.store.load()).toBeNull();
    const fresh = await again.signUp({ band: 'adult' });
    expect(fresh.fid).not.toBe(d.fid());
  });

  it('keeps showing the stored profile while the network is down', async () => {
    const d = await device('adult', { name: 'Mia' });
    const again = makeClient(d.store, d.ip, d.skew);
    offline = true;
    expect((await again.init())?.name).toBe('Mia');
    await expect(again.loadFriends()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('openKeyStore falls back to memory where there is no IndexedDB', async () => {
    const store = await openKeyStore();
    expect(store.persistent).toBe(false);
  });
});

describe('the clock', () => {
  it('a phone an hour fast is corrected from the first refusal and not refused again', async () => {
    const d = await device('adult', {}, false);
    d.skew.ms = 3_600_000;
    const me = await d.client.signUp({ band: 'adult' });
    expect(me.fid).toBeTruthy();
    expect(calls.filter((c) => c === 'POST /api/social/register')).toHaveLength(2);
    calls = [];
    await d.client.loadFriends();
    await d.client.loadRequests();
    expect(calls).toEqual(['GET /api/social/friends', 'GET /api/social/requests']);
    expect(Math.abs(d.client.serverNow() - Date.now())).toBeLessThan(50);
  });

  it('a phone that is slow works too', async () => {
    const d = await device('adult');
    d.skew.ms = -2 * 3_600_000;
    calls = [];
    await d.client.loadFriends();
    expect(calls).toEqual(['GET /api/social/friends', 'GET /api/social/friends']);
  });
});

describe('errors', () => {
  it('text that is no friend code never reaches the network', async () => {
    const d = await device();
    calls = [];
    await expect(d.client.sendRequest('hello')).rejects.toMatchObject({ status: 400, code: 'bad_code' });
    await expect(d.client.sendRequest('BA-IIII00')).rejects.toBeInstanceOf(SocialApiError);
    expect(calls).toEqual([]);
  });

  it('an unknown code is not_found, and the failure carries the status and the body', async () => {
    const d = await device();
    const err = (await d.client.sendRequest('BA-AAAAAA').catch((e: unknown) => e)) as SocialApiError;
    expect(err).toBeInstanceOf(SocialApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found' });
    expect(typeof err.body?.serverTime).toBe('number');
  });
});

describe('friends', () => {
  it('a request by code, by pasted link and by sloppy typing; the other side sees it, accepts it, and both lists show it', async () => {
    const a = await device('adult', { name: 'Ada' });
    const b = await device('adult', { name: 'Bo' });
    const c = await device('adult', { name: 'Cy' });
    const d = await device('adult', { name: 'Di' });
    const events: string[] = [];
    b.client.on('requests', () => events.push('requests'));
    expect(await a.client.sendRequest(b.client.profile?.code ?? '')).toEqual({ status: 'sent' });
    expect(await a.client.sendRequest(` ${(c.client.profile?.code ?? '').toLowerCase().replace('-', ' ')} `)).toEqual({ status: 'sent' });
    expect(await a.client.sendRequest(c.client.profile?.link ?? '')).toEqual({ status: 'sent' });
    expect(await a.client.sendRequest(`  ${d.client.profile?.link}  `)).toEqual({ status: 'sent' });
    expect(a.client.requests.outgoing.map((r) => r.name).sort()).toEqual(['Bo', 'Cy', 'Di']);
    await b.client.loadRequests();
    expect(b.client.requests.incoming).toMatchObject([{ name: 'Ada', via: 'code' }]);
    await c.client.loadRequests();
    // asking again by the link leaves the one request, the first way of asking stays
    expect(c.client.requests.incoming).toMatchObject([{ name: 'Ada', via: 'code' }]);
    await d.client.loadRequests();
    expect(d.client.requests.incoming).toMatchObject([{ name: 'Ada', via: 'link' }]);
    await b.client.respond(a.fid(), true);
    expect(b.client.requests.incoming).toEqual([]);
    expect(b.client.friends.map((f) => f.name)).toEqual(['Ada']);
    await a.client.loadFriends();
    await a.client.loadRequests();
    expect(a.client.friends.map((f) => f.name)).toEqual(['Bo']);
    expect(a.client.requests.outgoing.map((r) => r.name).sort()).toEqual(['Cy', 'Di']);
    expect(events).toContain('requests');
    await c.client.respond(a.fid(), false);
    expect(c.client.requests.incoming).toEqual([]);
    await a.client.cancelRequest(d.fid());
    expect(a.client.requests.outgoing.map((r) => r.name)).toEqual(['Cy']);
  });

  it('two players asking each other become friends at once', async () => {
    const a = await device('adult', { name: 'Ada' });
    const b = await device('adult', { name: 'Bo' });
    await a.client.sendRequest(b.client.profile?.code ?? '');
    const r = await b.client.sendRequest(a.client.profile?.code ?? '');
    expect(r).toMatchObject({ status: 'friends', friend: { name: 'Ada' } });
    expect(b.client.friends.map((f) => f.name)).toEqual(['Ada']);
  });

  it('an adult asking a minor looks the same as any request and goes nowhere; the minor can ask the adult', async () => {
    const adult = await device('adult', { name: 'Ada' });
    const teen = await device('teen');
    expect(await adult.client.sendRequest(teen.client.profile?.code ?? '')).toEqual({ status: 'sent' });
    expect(adult.client.requests.outgoing).toEqual([]);
    await teen.client.loadRequests();
    expect(teen.client.requests.incoming).toEqual([]);
    expect(await teen.client.sendRequest(adult.client.profile?.code ?? '')).toEqual({ status: 'sent' });
    await adult.client.loadRequests();
    expect(adult.client.requests.incoming).toHaveLength(1);
  });

  async function pair(): Promise<[Dev, Dev]> {
    const a = await device('adult', { name: 'Ada' });
    const b = await device('adult', { name: 'Bo' });
    await a.client.sendRequest(b.client.profile?.code ?? '');
    await b.client.respond(a.fid(), true);
    await a.client.loadFriends();
    return [a, b];
  }

  it('removing a friend, blocking and unblocking keep the lists current', async () => {
    const [a, b] = await pair();
    await a.client.removeFriend(b.fid());
    expect(a.client.friends).toEqual([]);
    await b.client.loadFriends();
    expect(b.client.friends).toEqual([]);
    const [c, d] = await pair();
    await c.client.block(d.fid());
    expect(c.client.friends).toEqual([]);
    expect(c.client.blocks.map((x) => x.name)).toEqual(['Bo']);
    await c.client.unblock(d.fid());
    expect(c.client.blocks).toEqual([]);
  });

  it('a report with the block switch files the report and blocks in one go', async () => {
    const [a, b] = await pair();
    const r = await a.client.report(b.fid(), 'abuse', { note: 'rude', block: true });
    expect(r).toEqual({ blocked: true });
    expect(a.client.friends).toEqual([]);
    await vi.waitFor(() => expect(a.client.blocks.map((x) => x.name)).toEqual(['Bo']));
    const queue = await app.admin('GET', '/api/admin/social/reports?status=open');
    expect(queue.body.reports).toHaveLength(1);
    expect(queue.body.reports[0]).toMatchObject({ reason: 'abuse', targetName: 'Bo', note: 'rude', source: 'friend' });
  });

  it('profile changes, a new friend code and the data export', async () => {
    const [a] = await pair();
    const old = a.client.profile?.code ?? '';
    const me = await a.client.updateProfile({ dnd: true, level: 30, region: 'as' });
    expect(me).toMatchObject({ dnd: true, level: 30, region: 'as' });
    const renewed = await a.client.renewCode();
    expect(renewed.code).not.toBe(old);
    const x = await a.client.exportData();
    expect(x.profile.name).toBe('Ada');
    expect(x.friends.map((f) => f.name)).toEqual(['Bo']);
    expect(JSON.stringify(x)).not.toContain(a.pid());
  });

  it('deleting the profile erases it here and there, and the friends no longer see the player', async () => {
    const [a, b] = await pair();
    const events: string[] = [];
    a.client.on('signedOut', (e) => events.push(e.reason));
    const pid = a.pid();
    await a.client.deleteProfile();
    expect(events).toEqual(['deleted']);
    expect(a.client.profile).toBeNull();
    expect(await a.store.load()).toBeNull();
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_profiles WHERE pid = ?').get(pid)).toEqual({ n: 0 });
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_devices WHERE pid = ?').get(pid)).toEqual({ n: 0 });
    await b.client.loadFriends();
    expect(b.client.friends).toEqual([]);
    await expect(a.client.loadFriends()).rejects.toMatchObject({ status: 401 });
  });
});

describe('the hub socket', () => {
  it('connects with a signed address, goes online, loads the lists and shows the hub state to the page', async () => {
    const d = await device('adult');
    const states: string[] = [];
    d.client.on('hub', (s) => states.push(s));
    calls = [];
    const ws = await online(d);
    const u = new URL(ws.url);
    expect(u.protocol).toBe('wss:');
    expect(u.pathname).toBe('/api/social/hub');
    expect(u.searchParams.get('ba_auth')).toMatch(/^v1\.[A-Za-z0-9_-]{22}\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
    expect(states).toEqual(['connecting', 'online']);
    expect(calls).toEqual(expect.arrayContaining(['GET /api/social/friends', 'GET /api/social/requests', 'GET /api/social/blocks', 'GET /api/social/me']));
  });

  it('pings every 45 seconds, beats every four minutes while the page is visible and once on return', async () => {
    const d = await device('adult');
    const ws = await online(d);
    await vi.advanceTimersByTimeAsync(PRESENCE.pingEveryMs);
    expect(ws.sent.filter((s) => s === 'ping')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PRESENCE.beatEveryMs);
    expect(ws.commands().filter((c) => (c as { t: string }).t === 'beat').length).toBeGreaterThanOrEqual(1);
    const beats = (): number => ws.commands().filter((c) => (c as { t: string }).t === 'beat').length;
    d.client.setActive(false);
    const before = beats();
    await vi.advanceTimersByTimeAsync(PRESENCE.beatEveryMs * 2);
    expect(ws.sent.filter((s) => s === 'ping').length).toBeGreaterThan(10);
    expect(beats()).toBe(before);
    d.client.setActive(true);
    expect(beats()).toBe(before + 1);
  });

  it('the pushes of the server update presence, requests, friends and invitations', async () => {
    const a = await device('adult', { name: 'Ada' });
    const b = await device('adult', { name: 'Bo' });
    const wsB = await online(b);
    const seen: string[] = [];
    b.client.on('friendRequest', (e) => seen.push(`request:${e.name}:${e.via}`));
    b.client.on('friendAdded', (e) => seen.push(`added:${e.name}`));
    await a.client.sendRequest(b.client.profile?.code ?? '');
    await pump(b, wsB);
    expect(b.client.requests.incoming.map((r) => r.name)).toEqual(['Ada']);
    expect(seen).toEqual(['request:Ada:code']);

    await b.client.respond(a.fid(), true);
    const wsA = await online(a);
    await a.client.loadFriends();
    expect(a.client.friends.map((f) => f.name)).toEqual(['Bo']);
    // presence of a friend arrives as a push and replaces the entry's status
    wsA.receive({ t: 'presence', fid: b.fid(), name: 'Bo', presence: { status: 'playing', game: 'squat-flap' } });
    expect(a.client.friends[0]?.presence).toEqual({ status: 'playing', game: 'squat-flap' });
    // a request cancelled by its sender disappears
    wsB.receive({ t: 'friend_request', from: { fid: 'ZZZZZZZZZZ', name: 'Zed' }, at: Date.now(), via: 'link' });
    expect(b.client.requests.incoming.map((r) => r.name)).toEqual(['Zed']);
    wsB.receive({ t: 'request_cancelled', fid: 'ZZZZZZZZZZ' });
    expect(b.client.requests.incoming).toEqual([]);
    // removal by the other side
    wsA.receive({ t: 'friend_removed', fid: b.fid() });
    expect(a.client.friends).toEqual([]);
  });

  it('an invitation shows up, expires on time, can be declined (the inviter hears) and is dropped when accepted', async () => {
    const a = await device('adult', { name: 'Ada' });
    const b = await device('adult', { name: 'Bo' });
    const ws = await online(b);
    const lists: number[] = [];
    b.client.on('invites', (l) => lists.push(l.length));
    const exp = Date.now() + 120_000;
    ws.receive({ t: 'invite', id: 'inv-one', from: { fid: a.fid(), name: 'Ada' }, room: 'ABCDEF', game: 'jacks', exp });
    ws.receive({ t: 'invite', id: 'inv-two', from: { fid: a.fid(), name: 'Ada' }, room: 'GHJKLM', game: 'jacks', exp: exp + 60_000 });
    expect(b.client.invites.map((i) => i.room)).toEqual(['ABCDEF', 'GHJKLM']);
    await vi.advanceTimersByTimeAsync(121_000);
    expect(b.client.invites.map((i) => i.room)).toEqual(['GHJKLM']);
    const third = { t: 'invite', id: 'inv-three', from: { fid: a.fid(), name: 'Ada' }, room: 'NPQRST', game: 'jacks', exp: Date.now() + 100_000 } as const;
    ws.receive(third);
    b.client.acceptInvite(b.client.invites.find((i) => i.id === 'inv-three') as never);
    expect(b.client.invites.map((i) => i.id)).toEqual(['inv-two']);
    expect(lists.at(-1)).toBe(1);
    ws.receive({ t: 'invite_declined', id: 'x', fid: a.fid() });
  });

  it('reconnects with a growing wait and a new signature, and a good connection resets the wait', async () => {
    const d = await device('adult');
    const ws = await online(d);
    const sigOf = (w: FakeWs): string => new URL(w.url).searchParams.get('ba_auth') ?? '';
    ws.drop(1006);
    expect(d.client.hub).toBe('connecting');
    await vi.advanceTimersByTimeAsync(700);                   // the first wait is 750 ms with the middle random number
    await idle();
    expect(FakeWs.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    await until(() => FakeWs.all.length === 2, 'the second socket');
    expect(sigOf(lastWs())).not.toBe(sigOf(ws));
    lastWs().drop(1006);                                      // never opened: the second wait is doubled
    await vi.advanceTimersByTimeAsync(1400);
    await idle();
    expect(FakeWs.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    await until(() => FakeWs.all.length === 3, 'the third socket');
    app.hubs.connect(d.pid());
    lastWs().open();
    expect(d.client.hub).toBe('online');
    await d.client.sync();
    lastWs().drop(1006);                                      // a good connection: the wait starts again at 750 ms
    await vi.advanceTimersByTimeAsync(800);
    await until(() => FakeWs.all.length === 4, 'the fourth socket');
  });

  it('another tab taking the socket stops the client until the player asks again; a ban stops it for good', async () => {
    const d = await device('adult');
    const ws = await online(d);
    ws.drop(HUB_CLOSE.REPLACED);
    expect(d.client.hub).toBe('replaced');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWs.all).toHaveLength(1);
    const again = await online(d);
    expect(FakeWs.all).toHaveLength(2);
    expect(again).not.toBe(ws);
    again.drop(HUB_CLOSE.BANNED);
    expect(d.client.hub).toBe('banned');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWs.all).toHaveLength(2);
  });

  it('the closing notice of the server is acted on at once, without waiting for the close frame that may come late', async () => {
    const d = await device('adult');
    const ws = await online(d);
    ws.receive({ t: 'closing', reason: 'replaced' });
    expect(d.client.hub).toBe('replaced');
    expect(ws.closed).toBe(1000);
    ws.drop(1006);                                            // the close frame arriving ten seconds later changes nothing
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWs.all).toHaveLength(1);
    expect(d.client.hub).toBe('replaced');

    const e = await device('adult');
    const ws2 = await online(e);
    const signedOut: string[] = [];
    e.client.on('signedOut', (x) => signedOut.push(x.reason));
    ws2.receive({ t: 'closing', reason: 'deleted' });
    await until(() => signedOut.length > 0, 'the sign out');
    expect(signedOut).toEqual(['deleted']);
    expect(await e.store.load()).toBeNull();

    const f = await device('adult');
    const ws3 = await online(f);
    ws3.receive({ t: 'closing', reason: 'banned' });
    expect(f.client.hub).toBe('banned');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWs.all.filter((w) => w.url === ws3.url || w === ws3)).toHaveLength(1);
  });

  it('a refused signature is retried at once; a deleted profile signs the device out', async () => {
    const d = await device('adult');
    const ws = await online(d);
    ws.drop(HUB_CLOSE.AUTH);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => FakeWs.all.length === 2, 'the retry');
    const signedOut: string[] = [];
    d.client.on('signedOut', (e) => signedOut.push(e.reason));
    lastWs().drop(HUB_CLOSE.DELETED);
    await until(() => signedOut.length > 0, 'the sign out');
    expect(signedOut).toEqual(['deleted']);
    expect(await d.store.load()).toBeNull();
  });

  it('a socket that has been silent for three pings is dropped and replaced', async () => {
    const d = await device('adult');
    const ws = await online(d);
    ws.autoPong = false;                                      // half open: the pings go nowhere
    await vi.advanceTimersByTimeAsync(PRESENCE.pingEveryMs * 3 + 1000);
    expect(ws.closed).toBeNull();                             // three pings unanswered is not yet more than three pings of silence
    await vi.advanceTimersByTimeAsync(PRESENCE.pingEveryMs);
    expect(ws.closed).toBe(4999);
    await vi.advanceTimersByTimeAsync(1500);
    await until(() => FakeWs.all.length >= 2, 'the replacement socket');
  });

  it('disconnect closes the socket and nothing reconnects; the status is replayed after a reconnect', async () => {
    const d = await device('adult');
    const ws = await online(d);
    d.client.setStatus('playing', 'squat-flap');
    expect(ws.commands()).toContainEqual({ t: 'status', status: 'playing', game: 'squat-flap' });
    ws.drop(1006);
    await vi.advanceTimersByTimeAsync(800);
    await until(() => FakeWs.all.length === 2, 'the second socket');
    app.hubs.connect(d.pid());
    lastWs().open();
    expect(d.client.hub).toBe('online');
    expect(lastWs().commands()).toContainEqual({ t: 'status', status: 'playing', game: 'squat-flap' });
    d.client.setStatus('online');
    expect(lastWs().commands().at(-1)).toEqual({ t: 'status', status: 'online' });
    const open = lastWs();
    d.client.disconnect();
    expect(open.closed).toBe(1000);
    expect(d.client.hub).toBe('idle');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWs.all).toHaveLength(2);
  });

  it('a device without a profile cannot connect', async () => {
    const d = await device('adult', {}, false);
    d.client.connect();
    await idle();
    expect(d.client.hub).toBe('idle');
    expect(FakeWs.all).toHaveLength(0);
  });
});

describe('signed requests for live play', () => {
  it('the signed fetch is accepted by the server and an unsigned one is not', async () => {
    const d = await device('adult', { name: 'Mia' });
    const ok = await d.client.fetcher(`${TEST_ORIGIN}/api/social/me`);
    expect(ok.status).toBe(200);
    const post = await d.client.fetcher(`${TEST_ORIGIN}/api/social/me`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dnd: true, level: 7 }) });
    expect(post.status).toBe(200);
    expect(((await post.json()) as { me: { dnd: boolean } }).me.dnd).toBe(true);
    const bare = await app.call('GET', '/api/social/me');
    expect(bare.status).toBe(401);
  });

  it('the identity handed to live play is the device key id, the profile name and the band', async () => {
    const d = await device('teen');
    const who = d.client.roomIdentity();
    expect(who).toMatchObject({ name: d.client.profile?.name, age: 'teen' });
    expect(who.pid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const anon = await device('adult', {}, false);
    expect(() => anon.client.roomIdentity()).toThrow();
  });
});

describe('quick match', () => {
  const room = (code: string, host: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
    kind: 'public', gameId: 'jacks', band: null, audience: 'adult', size: 4, players: 1, open: 3, names: [host], phase: 'lobby', updatedAt: Date.now(), code, ...over,
  });
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let seq = 0;
  const roomCode = (): string => { let n = ++seq; let s = ''; for (let i = 0; i < 6; i++) { s = ALPHA[n % 32] + s; n = Math.floor(n / 32); } return s; };

  function driver(over: Partial<MatchDriver> = {}): MatchDriver & { log: string[] } {
    const log: string[] = [];
    return {
      log,
      create: async (game, band) => { log.push(`create ${game} ${band}`); return { code: 'CREATE' }; },
      join: async (code) => { log.push(`join ${code}`); },
      leave: async (code) => { log.push(`leave ${code}`); },
      ...over,
    };
  }

  /** Runs a promise that needs fake time to pass. */
  async function drive<T>(p: Promise<T>, stepMs = 1000, limit = 400): Promise<T> {
    let done = false;
    void p.finally(() => { done = true; }).catch(() => undefined);
    for (let i = 0; i < limit && !done; i++) { await vi.advanceTimersByTimeAsync(stepMs); await idle(6); }
    return p;
  }

  it('takes a seat in an open lobby of the same game at once', async () => {
    const host = await device('adult', { name: 'Hana' });
    const me = await device('adult', { name: 'Mia' });
    const c = roomCode();
    await publishRoom(app.db, room(c, 'Hana'), [host.pid()], Date.now());
    const dr = driver();
    expect(await drive(me.client.quickMatch('jacks', dr, { pollMs: 1000 }))).toEqual({ outcome: 'joined', code: c });
    expect(dr.log).toEqual([`join ${c}`]);
  });

  it('opens a public room when nothing fits and keeps asking with its code; stops when told to', async () => {
    const me = await device('adult', { name: 'Mia', level: 5 });
    const dr = driver();
    const stop = new AbortController();
    const progress: string[] = [];
    const run = me.client.quickMatch('jacks', dr, { pollMs: 1000, signal: stop.signal, onProgress: (p) => progress.push(`${p.phase}:${p.code}`) });
    await until(() => dr.log.length > 0, 'the room to be opened');   // the first answer was "open a room"
    // the room appears in the directory once the host sits in it
    await publishRoom(app.db, room('CREATE', 'Mia', { band: 'easy' }), [me.pid()], Date.now());
    for (let i = 0; i < 3; i++) {
      const seen = progress.length;
      await vi.advanceTimersByTimeAsync(1000);
      await until(() => progress.length > seen, 'the next answer');
    }
    stop.abort();
    await vi.advanceTimersByTimeAsync(1000);
    const out = await run;
    expect(dr.log[0]).toBe('create jacks easy');
    expect(out).toEqual({ outcome: 'stopped', hosting: 'CREATE' });
    expect(progress[0]).toBe('hosting:CREATE');
  });

  it('a lobby that fills up before the seat is taken is not an error: the search asks again and finds the next', async () => {
    const h1 = await device('adult', { name: 'Hana' });
    const h2 = await device('adult', { name: 'Hugo' });
    const me = await device('adult', { name: 'Mia' });
    const c1 = roomCode();
    const c2 = roomCode();
    await publishRoom(app.db, room(c1, 'Hana'), [h1.pid()], Date.now());
    await publishRoom(app.db, room(c2, 'Hugo', { updatedAt: Date.now() + 1 }), [h2.pid()], Date.now() + 1);
    let n = 0;
    const dr = driver({ join: async (code) => { dr.log.push(`join ${code}`); if (n++ === 0) throw new Error('full'); } });
    const out = await drive(me.client.quickMatch('jacks', dr, { pollMs: 1000 }));
    expect(out.outcome).toBe('joined');
    expect(dr.log.filter((l) => l.startsWith('join'))).toHaveLength(2);
  });

  it('gives up after two minutes and says whether a room of its own is still open, with the ghost offer on the way', async () => {
    const me = await device('adult', { name: 'Mia' });
    const dr = driver();
    const offers: boolean[] = [];
    const out = await drive(me.client.quickMatch('jacks', dr, { pollMs: 4000, onProgress: (p) => offers.push(p.offerGhost) }), 4000, 60);
    expect(out.outcome).toBe('timeout');
    expect(offers.includes(true)).toBe(true);
  });

  it('a child has no public lobbies or quick match', async () => {
    const kid = await device('child');
    await expect(kid.client.lobbies()).rejects.toMatchObject({ status: 403, code: 'child_no_public' });
    await expect(kid.client.quickMatch('jacks', driver())).rejects.toMatchObject({ status: 403 });
  });

  it('the lobby list is filtered by game and region', async () => {
    const host = await device('adult', { name: 'Hana', region: 'na' });
    const me = await device('adult');
    await publishRoom(app.db, room(roomCode(), 'Hana'), [host.pid()], Date.now());
    expect(await me.client.lobbies({ game: 'jacks' })).toHaveLength(1);
    expect(await me.client.lobbies({ game: 'squat-flap' })).toEqual([]);
    expect(await me.client.lobbies({ game: 'jacks', region: 'as' })).toEqual([]);
  });
});

describe('weekly boards', () => {
  it('a run is started and finished, the best of the week is kept, and the boards show it for friends and for the country', async () => {
    const a = await device('adult', { name: 'Ada' });
    const b = await device('adult', { name: 'Bo' });
    await a.client.sendRequest(b.client.profile?.code ?? '');
    await b.client.respond(a.fid(), true);

    const ticket = await a.client.startRun('squat-flap');
    expect(ticket).toMatchObject({ game: 'squat-flap' });
    expect(ticket.run).toMatch(/^r1./);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await a.client.finishRun(ticket, 1500)).toMatchObject({ improved: true, best: 1500 });
    expect(await a.client.finishRun(ticket, 900)).toMatchObject({ improved: false, best: 1500 });

    const bTicket = await b.client.startRun('squat-flap');
    await vi.advanceTimersByTimeAsync(90_000);
    await b.client.finishRun(bTicket, 2100);

    const friends = await a.client.leaderboard({ game: 'squat-flap', scope: 'friends' });
    expect(friends.entries.map((e) => `${e.rank}:${e.name}:${e.score}:${e.you}`)).toEqual(['1:Bo:2100:false', '2:Ada:1500:true']);
    expect(friends.entries[0]?.fid).toBe(b.fid());
    const country = await a.client.leaderboard({ game: 'squat-flap', scope: 'country' });
    expect(country.country).toBe('TR');
    expect(country.entries.map((e) => e.name)).toEqual(['Bo', 'Ada']);
    expect(country.you).toEqual({ score: 1500, rank: 2, atLeast: false });
    expect((await a.client.leaderboard({ game: 'squat-flap', scope: 'friends', week: 'previous' })).entries).toEqual([]);
  });

  it('a score that cannot count is refused with a code the result screen can act on, and a child has no country board', async () => {
    const a = await device('adult', { name: 'Ada' });
    const ticket = await a.client.startRun('knee-sprint');
    await vi.advanceTimersByTimeAsync(500);
    await expect(a.client.finishRun(ticket, 10)).rejects.toMatchObject({ status: 409, code: 'run_too_short' });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(a.client.finishRun(ticket, 5_000_000)).rejects.toMatchObject({ status: 422, code: 'score_implausible' });
    await expect(a.client.finishRun({ ...ticket, run: 'r1.1.2.3' }, 10)).rejects.toMatchObject({ status: 400, code: 'bad_run' });
    await expect(a.client.startRun('no-such-game')).rejects.toMatchObject({ status: 400, code: 'unknown_game' });
    const kid = await device('child');
    await expect(kid.client.leaderboard({ game: 'squat-flap', scope: 'country' })).rejects.toMatchObject({ status: 403, code: 'child_no_public' });
    expect((await kid.client.leaderboard({ game: 'squat-flap', scope: 'friends' })).entries).toEqual([]);
  });
});
