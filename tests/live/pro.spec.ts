// The Pro check of live play against the real thing (builder N): the Worker on workerd checking real ES256 entitlement tokens (the
// format the entitlement service issues, signed with the key pair of this run, which the Worker holds as ENT_PRIV_JWK), a real Room
// (Durable Object) and real WebSockets, played by the real LiveClient; no browser. The paywall promises "rooms where everyone plays
// the Pro games the host picks": a room may start a Pro game only while a Pro token that checks out stands behind it, the players who
// join never need one, free games stay open, and nothing a page says about itself is believed.
//   node node_modules/@playwright/test/cli.js test -c tests/live/playwright.config.ts --workers=1 tests/live/pro.spec.ts
import { expect, test } from '@playwright/test';
import { LiveClient, joinRoom, makeSchedule, specFor, type Identity } from '../../packages/core/net/index.ts';
import type { JoinGrant, MatchInfo, MatchResult, ObstacleResult, RoomInfo } from '../../packages/core/types/net.ts';
import { DAY_S, makeProKit } from '../../packages/server/src/live/prokit.ts';
import { startStack, type Stack } from './support/stack.ts';

test.skip(!!process.env.CI, 'the live suite runs on the local release gate, not on GitHub runners');

let stack: Stack;
test.beforeAll(async () => { test.setTimeout(120_000); stack = await startStack(); });
test.afterAll(async () => { await stack?.stop(); });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nowS = (): number => Math.floor(Date.now() / 1000);
const stamp = Date.now().toString(36);
const who = (name: string): Identity => ({ pid: `pro-${name}-${stamp}-device`.slice(0, 60), name, age: 'adult' });

async function until(fn: () => unknown, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}

async function api(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(stack.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

interface Seat {
  c: LiveClient;
  who: Identity;
  seat: string;
  match: MatchInfo | null;
  results: MatchResult[];
  rooms: RoomInfo[];
  roomErrors: string[];
  errors: string[];
  mine: ObstacleResult[];
  /** How many times the client asked the Worker for a new ticket (a renewal, or a rejected ticket). */
  renewals: number;
}

/** One player: a real LiveClient on the Room relay. `pro` is what the app holds (null for a free player), `proSent` what the ticket was made from. */
function seat(grant: JoinGrant, me: Identity, o: { pro?: () => string | null; proSent?: string | null } = {}): Seat {
  const s: Seat = { c: null as unknown as LiveClient, who: me, seat: '', match: null, results: [], rooms: [], roomErrors: [], errors: [], mine: [], renewals: 0 };
  s.c = new LiveClient({
    grant, origin: stack.base, peers: 'none',
    refreshTicket: () => { s.renewals++; return joinRoom(stack.base, grant.code, me, undefined, o.pro?.()); },
    ...(o.pro ? { pro: o.pro, proSent: o.proSent ?? null } : {}),
  });
  s.c.on('welcome', (w) => { s.seat = w.you; s.rooms.push(w.room); });
  s.c.on('room', (r) => { s.rooms.push(r); });
  s.c.on('match', (d) => { s.match = d.match; });
  s.c.on('result', (r) => { s.results.push(r); });
  s.c.on('roomError', (e) => { s.roomErrors.push(e.code); });
  s.c.on('fatal', (f) => { s.errors.push(`fatal ${f.reason} ${f.code}`); });
  return s;
}

const roomOf = (s: Seat): RoomInfo | undefined => s.rooms.at(-1);

/** The host makes a room with the given game and token; a friend with no token joins; both connect. */
async function pair(game: string, hostToken: string | undefined, o: { hostPro?: () => string | null; hostSent?: string | null } = {}): Promise<{ a: Seat; b: Seat; code: string }> {
  const host = who('host'); const friend = who('friend');
  const created = await api('/api/rooms', { gameId: game, durationMs: 15_000, ...host, ...(hostToken ? { pro: hostToken } : {}) });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const g = created.json as unknown as JoinGrant;
  const joined = await api(`/api/rooms/${g.code}/join`, friend);
  expect(joined.status).toBe(200);
  const a = seat(g, host, { ...(o.hostPro ? { pro: o.hostPro } : {}), ...(o.hostSent !== undefined ? { proSent: o.hostSent } : {}) });
  const b = seat(joined.json as unknown as JoinGrant, friend);
  await a.c.start();                                                                                // the creator connects first, so the creator is the host (the first to say hello is)
  await until(() => a.seat, 20_000, 'the host welcomed');
  await b.c.start();
  await until(() => b.seat && a.c.members.length === 2, 20_000, 'both players welcomed');
  expect(roomOf(a)?.host).toBe(a.seat);
  return { a, b, code: g.code };
}

/** Plays a whole match like a player would: every obstacle reported once, the final list at the end. */
async function playOut(a: Seat, b: Seat): Promise<void> {
  const m = a.match as MatchInfo;
  const course = makeSchedule(m.seed, m.duration, specFor(m.gameId));
  const timer = setInterval(() => {
    for (const [k, s] of [a, b].entries()) {
      const mt = s.c.matchTime();
      if (mt < 0 || s.c.match?.phase === 'over') continue;
      for (const o of course) {
        if (o.t > mt || s.mine.some((e) => e.ob === o.id)) continue;
        const kind = (o.id + k) % 4 === 0 ? 'hit' : 'pass';
        s.mine.push({ ob: o.id, k: kind });
        s.c.reportResult(o.id, kind);
      }
      if (mt >= m.duration && !s.c.match?.result) s.c.finish(s.mine);
    }
  }, 66);
  try { await until(() => a.results.length && b.results.length, 60_000, 'the result on both sides'); } finally { clearInterval(timer); }
}

test('the Worker makes a Pro room only for a host whose signed token checks out', async () => {
  const stranger = await makeProKit();
  const host = who('http');
  const create = (pro: unknown, gameId = 'limbo-bend') => api('/api/rooms', { gameId, durationMs: 15_000, ...host, ...(pro === undefined ? {} : { pro }) });
  const refused = (reason: string) => ({ status: 403, json: { error: 'pro_required', reason } });

  expect(await create(undefined)).toMatchObject(refused('none'));                                  // a free host
  for (const flag of [true, 'true', 'pro', 'a.b.c']) expect(await create(flag), String(flag)).toMatchObject(refused('invalid'));   // a flag, junk
  expect(await create(await stranger.mint())).toMatchObject(refused('invalid'));                   // the right format, another key: forged
  expect(await create(await stack.pro.mint({ feat: [] }))).toMatchObject(refused('invalid'));      // genuine, but not a Pro plan
  expect(await create(await stack.pro.mint({ iat: nowS() - 5 * DAY_S, exp: nowS() - 2 * DAY_S }))).toMatchObject(refused('expired'));
  const real = await stack.pro.mint({ plan: 'pro-monthly', iat: nowS() - 60, exp: nowS() + 600 });
  const [h, p, s] = real.split('.') as [string, string, string];
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
  const longer = `${h}.${Buffer.from(JSON.stringify({ ...payload, exp: nowS() + 6 * DAY_S })).toString('base64url')}.${s}`;
  expect(await create(longer)).toMatchObject(refused('invalid'));                                   // changed after signing

  expect((await create(undefined, 'squat-flap')).status).toBe(201);                                // free games stay open to everybody
  expect((await create('junk', 'knee-sprint')).status).toBe(201);                                  // and a bad token is no error there
  const ok = await create(await stack.pro.mint());
  expect(ok.status, JSON.stringify(ok.json)).toBe(201);                                            // a genuine token opens the Pro game
  expect((ok.json as unknown as JoinGrant).room).toMatchObject({ gameId: 'limbo-bend', phase: 'lobby' });
  expect((await create(await stack.pro.mint(), 'pad-work')).status).toBe(201);                    // every Pro game of the catalogue the same
  expect((await create(await stack.pro.mint(), 'reaction-tag')).status).toBe(201);
});

test('a Pro host and a friend without Pro play the Pro game the host picked, from the lobby to the result', async () => {
  test.setTimeout(150_000);
  const { a, b } = await pair('limbo-bend', await stack.pro.mint());
  try {
    expect(roomOf(a)?.pro).toEqual({ ok: true });
    expect(roomOf(b)?.pro).toEqual({ ok: true });                                                  // the friend is covered by the host
    a.c.setReady(true); b.c.setReady(true);
    await until(() => a.match && b.match, 20_000, 'the Pro match to start');
    expect(a.match?.gameId).toBe('limbo-bend');
    await playOut(a, b);
    expect(a.results[0]?.reason).toBe('complete');
    expect(JSON.stringify(a.results[0])).toBe(JSON.stringify(b.results[0]));
    expect([a.errors, b.errors, a.roomErrors, b.roomErrors]).toEqual([[], [], [], []]);
  } finally { a.c.stop(); b.c.stop(); }
});

test('a free host who picks a Pro game in the lobby is told no, and the room goes on with the free game', async () => {
  test.setTimeout(90_000);
  const { a, b } = await pair('squat-flap', undefined);
  try {
    a.c.configure({ gameId: 'limbo-bend' });
    await until(() => a.roomErrors.includes('pro_required'), 10_000, 'the refusal');
    expect(a.c.room?.config.gameId).toBe('squat-flap');
    expect(roomOf(b)?.config.gameId).toBe('squat-flap');
    expect(b.roomErrors).toEqual([]);                                                              // only the host who asked hears of it
    a.c.setReady(true); b.c.setReady(true);
    await until(() => a.match && b.match, 20_000, 'the free match to start');
    expect(a.match?.gameId).toBe('squat-flap');
  } finally { a.c.stop(); b.c.stop(); }
});

test('an app that holds a forged token gets no Pro game either, however it asks', async () => {
  test.setTimeout(90_000);
  const stranger = await makeProKit();
  const forged = await stranger.mint();
  const { a, b } = await pair('squat-flap', undefined, { hostPro: () => forged, hostSent: null });
  try {
    a.c.configure({ gameId: 'pad-work' });                                                          // the page renews its ticket first with the token it holds
    await until(() => a.roomErrors.includes('pro_required'), 15_000, 'the refusal');
    expect(a.renewals).toBe(1);
    expect(a.c.room?.config.gameId).toBe('squat-flap');
    a.c.configure({ gameId: 'reaction-tag' });                                                      // the token the Room read is the one it holds: no second renewal
    await until(() => a.roomErrors.length === 2, 10_000, 'the second refusal');
    expect(a.renewals).toBe(1);
    expect(roomOf(b)?.config.gameId).toBe('squat-flap');
  } finally { a.c.stop(); b.c.stop(); }
});

test('a host who gets Pro in the lobby renews the ticket and then the Pro game is taken, for everyone', async () => {
  test.setTimeout(120_000);
  let token: string | null = null;
  const { a, b } = await pair('squat-flap', undefined, { hostPro: () => token, hostSent: null });
  try {
    a.c.configure({ gameId: 'pad-work' });
    await until(() => a.roomErrors.includes('pro_required'), 10_000, 'the refusal while free');
    expect(a.renewals).toBe(0);
    token = await stack.pro.mint();                                                                 // she buys Pro, the app holds a token now
    a.c.configure({ gameId: 'pad-work' });
    await until(() => a.c.room?.config.gameId === 'pad-work' && b.c.room?.config.gameId === 'pad-work', 15_000, 'the Pro game to be taken');
    expect(a.renewals).toBe(1);
    expect(roomOf(a)?.pro).toEqual({ ok: true });
    expect(roomOf(b)?.pro).toEqual({ ok: true });
    expect(a.roomErrors).toHaveLength(1);
    a.c.setReady(true); b.c.setReady(true);
    await until(() => a.match && b.match, 20_000, 'the Pro match to start');
    expect(a.match?.gameId).toBe('pad-work');
    expect(a.errors).toEqual([]);
  } finally { a.c.stop(); b.c.stop(); }
});

test('a proof that ends while the room waits: the Pro match does not start until the host shows a fresh token', async () => {
  test.setTimeout(120_000);
  const endsAt = nowS() + 10;
  const short = await stack.pro.mint({ iat: nowS() - 60, exp: endsAt });                           // good for ten seconds
  let token: string | null = short;
  const { a, b } = await pair('limbo-bend', short, { hostPro: () => token, hostSent: short });
  try {
    expect(roomOf(a)?.pro).toEqual({ ok: true });
    await sleep(Math.max(0, endsAt * 1000 + 800 - Date.now()));                                       // the proof ended; nobody was told, nobody was ready
    a.c.setReady(true); b.c.setReady(true);
    await until(() => roomOf(b)?.pro?.ok === false && roomOf(a)?.pro?.ok === false, 10_000, 'the room to say that no proof stands behind the game');
    await sleep(4_000);
    expect(a.match).toBeNull();                                                                      // it waits, for everybody
    expect(b.match).toBeNull();
    expect(a.renewals).toBe(0);                                                                      // the app has nothing newer yet
    token = await stack.pro.mint();                                                                  // the app renewed its token a moment later
    await until(() => a.match && b.match, 20_000, 'the match to start once the host shows the fresh token');
    expect(a.match?.gameId).toBe('limbo-bend');
    expect(a.renewals).toBe(1);
    expect(roomOf(a)?.pro).toEqual({ ok: true });
    expect([a.errors, b.errors]).toEqual([[], []]);
  } finally { a.c.stop(); b.c.stop(); }
});
