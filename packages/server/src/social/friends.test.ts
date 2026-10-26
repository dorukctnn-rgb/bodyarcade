// Friend rules: requests by code or link, accept and decline, the age rules, blocks, limits and what is told to whom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, DECLINE_COOLDOWN_MS, HOUR, MAX_BLOCKS, REQUEST_TTL_MS } from '../../../core/social/rules.ts';
import type { AgeBand } from '../../../core/social/types.ts';
import { createTestApp, type TestApp, type TestPlayer } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let app: TestApp;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const player = (band: AgeBand = 'adult') => app.signup(band);
const requestBy = (from: TestPlayer, to: TestPlayer) => from.post('/api/social/friends/request', { code: to.me.code });
const befriend = async (a: TestPlayer, b: TestPlayer) => {
  await requestBy(a, b);
  const r = await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
  expect(r.status).toBe(200);
};
const friendsOf = async (p: TestPlayer) => (await p.get('/api/social/friends')).body.friends as { fid: string; name: string; band: string; presence: { status: string } }[];
const incomingOf = async (p: TestPlayer) => (await p.get('/api/social/requests')).body.incoming as { fid: string; name: string; via: string }[];
const outgoingOf = async (p: TestPlayer) => (await p.get('/api/social/requests')).body.outgoing as { fid: string; name: string }[];
const count = (sql: string, ...p: unknown[]) => (app.db.raw.prepare(sql).get(...(p as never[])) as { n: number }).n;
/** Fake rows for a player: friends / requests / blocks with random ids, to fill a list without making real players. */
const fill = (table: 'friends' | 'out' | 'in' | 'blocks', pid: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const other = `fake-${table}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    if (table === 'friends') app.db.raw.prepare('INSERT INTO soc_friends (pid, friend, since) VALUES (?, ?, ?)').run(pid, other, T0);
    else if (table === 'out') app.db.raw.prepare('INSERT INTO soc_requests (from_pid, to_pid, at, via) VALUES (?, ?, ?, ?)').run(pid, other, T0, 'code');
    else if (table === 'in') app.db.raw.prepare('INSERT INTO soc_requests (from_pid, to_pid, at, via) VALUES (?, ?, ?, ?)').run(other, pid, T0, 'code');
    else app.db.raw.prepare('INSERT INTO soc_blocks (pid, target, at) VALUES (?, ?, ?)').run(pid, other, T0);
  }
};

describe('sending a request', () => {
  it('goes to the other player, who sees it with the sender name and how it came', async () => {
    const a = await player();
    const b = await player();
    const r = await requestBy(a, b);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'sent' });
    expect(await incomingOf(b)).toEqual([{ fid: a.me.fid, name: a.me.name, at: T0, via: 'code' }]);
    expect(await outgoingOf(a)).toEqual([{ fid: b.me.fid, name: b.me.name, at: T0 }]);
    expect((await b.get('/api/social/me')).body.me.counts.incoming).toBe(1);
    expect((await a.get('/api/social/me')).body.me.counts.outgoing).toBe(1);
  });

  it('takes the code as typed or pasted, or the whole link', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    const d = await player();
    const typed = b.me.code.toLowerCase().replace('ba-', 'ba ');
    expect((await a.post('/api/social/friends/request', { code: typed })).body.status).toBe('sent');
    expect((await a.post('/api/social/friends/request', { link: c.me.link })).body.status).toBe('sent');
    expect((await a.post('/api/social/friends/request', { code: d.me.code.replace('BA-', '') })).body.status).toBe('sent');
    expect((await incomingOf(c))[0]?.via).toBe('link');
    expect((await incomingOf(b))[0]?.via).toBe('code');
    expect(await incomingOf(d)).toHaveLength(1);
    // a link opened in the app passes the code and says how it came
    const e = await player();
    await a.post('/api/social/friends/request', { code: e.me.code, via: 'link' });
    expect((await incomingOf(e))[0]?.via).toBe('link');
  });

  it('is pushed to the other player when they are online, and only then', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    expect(app.hubs.events(b.pid())).toEqual([]);
    const c = await player();
    app.hubs.connect(c.pid());
    await requestBy(a, c);
    expect(app.hubs.take(c.pid())).toEqual([{ t: 'friend_request', from: { fid: a.me.fid, name: a.me.name }, at: T0, via: 'code' }]);
  });

  it('refuses a malformed code without counting it, and says plainly when a code does not exist', async () => {
    const a = await player();
    expect((await a.post('/api/social/friends/request', { code: 'hello' })).body).toMatchObject({ error: 'bad_request', field: 'code' });
    expect((await a.post('/api/social/friends/request', {})).status).toBe(400);
    expect((await a.post('/api/social/friends/request', { link: 'https://bodyarcade.com/r/ABCDEF' })).status).toBe(400);
    const miss = await a.post('/api/social/friends/request', { code: 'BA-222222' });
    expect(miss.status).toBe(404);
    expect(miss.body).toMatchObject({ error: 'not_found' });
  });

  it('stops a guesser: eight misses an hour, and then even the right code waits', async () => {
    const a = await player();
    const b = await player();
    for (let i = 0; i < 8; i++) expect((await a.post('/api/social/friends/request', { code: `BA-22222${'ABCDEFGH'[i]}` })).status).toBe(404);
    const blocked = await a.post('/api/social/friends/request', { code: b.me.code });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: 'too_many_attempts' });
    expect(blocked.body.retryAfterMs).toBeGreaterThan(0);
    expect(await outgoingOf(a)).toEqual([]);
    vi.setSystemTime(T0 + HOUR);
    expect((await requestBy(a, b)).status).toBe(200);
  });

  it('limits code tries to thirty an hour, hits included', async () => {
    const a = await player();
    const b = await player();
    for (let i = 0; i < 30; i++) expect((await requestBy(a, b)).status).toBe(200);
    const r = await requestBy(a, b);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    expect(count('SELECT COUNT(*) AS n FROM soc_requests')).toBe(1);
  });

  it('refuses a request to yourself or to a friend, and repeats cost nothing and change nothing', async () => {
    const a = await player();
    const b = await player();
    expect((await requestBy(a, a)).body).toMatchObject({ error: 'self' });
    await requestBy(a, b);
    await requestBy(a, b);
    expect(count('SELECT COUNT(*) AS n FROM soc_requests')).toBe(1);
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    const again = await requestBy(a, b);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'already_friends' });
  });

  it('two requests make a friendship: asking someone who already asked you adds them at once', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    app.hubs.connect(a.pid());
    const r = await requestBy(b, a);
    expect(r.body).toMatchObject({ status: 'friends', friend: { fid: a.me.fid, name: a.me.name, band: 'adult' } });
    expect(await friendsOf(a)).toHaveLength(1);
    expect(await friendsOf(b)).toHaveLength(1);
    expect(count('SELECT COUNT(*) AS n FROM soc_requests')).toBe(0);
    expect(app.hubs.take(a.pid())).toEqual([{ t: 'friend_added', friend: { fid: b.me.fid, name: b.me.name, band: 'adult' } }]);
  });

  it('expires after thirty days: it disappears from both lists and can be sent again', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    vi.setSystemTime(T0 + REQUEST_TTL_MS + 1000);
    expect(await incomingOf(b)).toEqual([]);
    expect(await outgoingOf(a)).toEqual([]);
    expect((await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true })).status).toBe(404);
    expect((await requestBy(a, b)).body.status).toBe('sent');
    expect(await incomingOf(b)).toHaveLength(1);
    expect(count('SELECT COUNT(*) AS n FROM soc_requests')).toBe(1);
  });

  it('is never delivered to a banned player, and the sender cannot tell', async () => {
    const a = await player();
    const b = await player();
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(T0 + DAY, b.pid());
    expect((await requestBy(a, b)).body.status).toBe('sent');
    expect(count('SELECT COUNT(*) AS n FROM soc_requests')).toBe(0);
  });
});

describe('the age rules', () => {
  it('an adult cannot send a request to an under-18 player: it is dropped and looks sent', async () => {
    const adult = await player('adult');
    for (const band of ['teen', 'child'] as const) {
      const minor = await player(band);
      app.hubs.connect(minor.pid());
      const r = await requestBy(adult, minor);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ status: 'sent', serverTime: T0 });
      expect(await incomingOf(minor)).toEqual([]);
      expect(app.hubs.events(minor.pid())).toEqual([]);
    }
    expect(count('SELECT COUNT(*) AS n FROM soc_requests')).toBe(0);
  });

  it('the answer to an adult is the same whether the code is a teen, a child or an adult', async () => {
    const adult = await player('adult');
    const answers: unknown[] = [];
    for (const band of ['teen', 'child', 'adult'] as const) {
      const other = await player(band);
      const r = await requestBy(adult, other);
      answers.push({ status: r.status, body: { ...r.body, serverTime: 0 } });
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual(answers[2]);
  });

  it('an under-18 player can send to an adult (code or link), and then the adult can accept', async () => {
    const adult = await player('adult');
    const teen = await player('teen');
    const child = await player('child');
    expect((await requestBy(teen, adult)).body.status).toBe('sent');
    expect((await child.post('/api/social/friends/request', { link: adult.me.link })).body.status).toBe('sent');
    const inbox = await incomingOf(adult);
    expect(inbox.map((x) => x.fid).sort()).toEqual([teen.me.fid, child.me.fid].sort());
    expect((await adult.post('/api/social/friends/respond', { fid: teen.me.fid, accept: true })).body.friend).toMatchObject({ fid: teen.me.fid, band: 'teen' });
    expect((await friendsOf(teen))[0]).toMatchObject({ fid: adult.me.fid, band: 'adult' });
  });

  it('when the minor asked first, the adult can answer by asking back', async () => {
    const adult = await player('adult');
    const teen = await player('teen');
    await requestBy(teen, adult);
    const r = await requestBy(adult, teen);
    expect(r.body.status).toBe('friends');
  });

  it('minors can ask each other, children included', async () => {
    const teen = await player('teen');
    const child = await player('child');
    const teen2 = await player('teen');
    expect((await requestBy(teen, child)).body.status).toBe('sent');
    expect(await incomingOf(child)).toHaveLength(1);
    expect((await requestBy(child, teen2)).body.status).toBe('sent');
    expect(await incomingOf(teen2)).toHaveLength(1);
  });

  it('stepping down to an under-18 band removes the adult requests that were waiting', async () => {
    const a = await player('adult');
    const b = await player('adult');
    const c = await player('adult');
    await requestBy(b, a);
    await requestBy(c, a);
    await a.post('/api/social/me', { band: 'teen' });
    expect(await incomingOf(a)).toEqual([]);
  });
});

describe('answering', () => {
  it('accepting makes both players friends, tells the sender, and clears the request', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    app.hubs.connect(a.pid());
    const r = await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    expect(r.body).toMatchObject({ status: 'friends', friend: { fid: a.me.fid, name: a.me.name } });
    expect((await friendsOf(a)).map((f) => f.fid)).toEqual([b.me.fid]);
    expect((await friendsOf(b)).map((f) => f.fid)).toEqual([a.me.fid]);
    expect(await incomingOf(b)).toEqual([]);
    expect(await outgoingOf(a)).toEqual([]);
    expect(app.hubs.take(a.pid())).toEqual([{ t: 'friend_added', friend: { fid: b.me.fid, name: b.me.name, band: 'adult' } }]);
    expect((await a.get('/api/social/me')).body.me.counts.friends).toBe(1);
  });

  it('needs a request that exists and a boolean answer', async () => {
    const a = await player();
    const b = await player();
    expect((await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true })).status).toBe(404);
    expect((await b.post('/api/social/friends/respond', { fid: 'nope', accept: true })).status).toBe(400);
    await requestBy(a, b);
    expect((await b.post('/api/social/friends/respond', { fid: a.me.fid })).status).toBe(400);
    // the sender cannot accept their own request
    expect((await a.post('/api/social/friends/respond', { fid: b.me.fid, accept: true })).status).toBe(404);
  });

  it('declining is silent: the sender is not told and cannot ask again for a week', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    app.hubs.connect(a.pid());
    const r = await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: false });
    expect(r.body.status).toBe('declined');
    expect(app.hubs.events(a.pid())).toEqual([]);
    expect(await friendsOf(a)).toEqual([]);
    // asking again looks sent and goes nowhere
    expect((await requestBy(a, b)).body.status).toBe('sent');
    expect(await incomingOf(b)).toEqual([]);
    vi.setSystemTime(T0 + DECLINE_COOLDOWN_MS - 1000);
    expect((await requestBy(a, b)).body.status).toBe('sent');
    expect(await incomingOf(b)).toEqual([]);
    vi.setSystemTime(T0 + DECLINE_COOLDOWN_MS + 1000);
    expect((await requestBy(a, b)).body.status).toBe('sent');
    expect(await incomingOf(b)).toHaveLength(1);
  });

  it('the one who declined can still ask the other (the decline only binds the sender)', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: false });
    expect((await requestBy(b, a)).body.status).toBe('sent');
    expect(await incomingOf(a)).toHaveLength(1);
  });

  it('cannot accept when a friend list is full: tells whose', async () => {
    const child = await player('child');
    const adult = await player('adult');
    const other = await player('adult');
    await requestBy(adult, other);
    await requestBy(child, adult);
    fill('friends', child.pid(), 25);
    const full = await adult.post('/api/social/friends/respond', { fid: child.me.fid, accept: true });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ error: 'friends_full', who: 'them' });
    const t = await player('teen');
    await requestBy(t, child);
    const mine = await child.post('/api/social/friends/respond', { fid: t.me.fid, accept: true });
    expect(mine.body).toMatchObject({ error: 'friends_full', who: 'me' });
    expect(await incomingOf(child)).toHaveLength(1);
  });
});

describe('limits of the lists', () => {
  it('a full friend list stops new requests with a plain answer', async () => {
    const child = await player('child');
    const adult = await player('adult');
    fill('friends', child.pid(), 25);
    const r = await requestBy(child, adult);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'friends_full' });
  });

  it('too many requests waiting from one player: requests_full', async () => {
    const child = await player('child');
    const adult = await player('adult');
    fill('out', child.pid(), 10);
    const r = await requestBy(child, adult);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'requests_full' });
  });

  it('a full inbox drops new requests without telling the sender', async () => {
    const teen = await player('teen');
    const teen2 = await player('teen');
    fill('in', teen2.pid(), 25);
    const r = await requestBy(teen, teen2);
    expect(r.body.status).toBe('sent');
    expect(count('SELECT COUNT(*) AS n FROM soc_requests WHERE from_pid = ? AND to_pid = ?', teen.pid(), teen2.pid())).toBe(0);
  });

  it('the daily request limit comes from the band: ten for a child, then a wait until tomorrow', async () => {
    const child = await player('child');
    const adults: TestPlayer[] = [];
    for (let i = 0; i < 11; i++) adults.push(await player('adult'));
    for (let i = 0; i < 10; i++) expect((await requestBy(child, adults[i] as TestPlayer)).status).toBe(200);
    const r = await requestBy(child, adults[10] as TestPlayer);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    expect(r.body.retryAfterMs).toBe(DAY - (T0 % DAY));
    // dropped requests count too, so the answer cannot be used to tell them apart
    const teen = await player('teen');
    const target = await player('teen');
    app.db.raw.prepare('INSERT INTO soc_blocks (pid, target, at) VALUES (?, ?, ?)').run(target.pid(), teen.pid(), T0);
    for (let i = 0; i < 15; i++) await requestBy(teen, target);
    expect((await requestBy(teen, target)).body).toMatchObject({ error: 'rate_limited' });
    // tomorrow the day's count starts again; the ten waiting requests still fill the outgoing list until one is withdrawn
    vi.setSystemTime(Math.ceil((T0 + 1) / DAY) * DAY + 1000);
    expect((await requestBy(child, adults[10] as TestPlayer)).body).toMatchObject({ error: 'requests_full' });
    await child.post('/api/social/friends/cancel', { fid: (adults[0] as TestPlayer).me.fid });
    expect((await requestBy(child, adults[10] as TestPlayer)).status).toBe(200);
  });
});

describe('cancel and remove', () => {
  it('cancelling withdraws the request and tells the other player', async () => {
    const a = await player();
    const b = await player();
    await requestBy(a, b);
    app.hubs.connect(b.pid());
    const r = await a.post('/api/social/friends/cancel', { fid: b.me.fid });
    expect(r.body.status).toBe('cancelled');
    expect(await incomingOf(b)).toEqual([]);
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'request_cancelled', fid: a.me.fid }]);
    expect((await a.post('/api/social/friends/cancel', { fid: b.me.fid })).status).toBe(404);
  });

  it('removing a friend ends the friendship on both sides and tells the other player', async () => {
    const a = await player();
    const b = await player();
    await befriend(a, b);
    app.hubs.connect(b.pid());
    expect((await a.post('/api/social/friends/remove', { fid: b.me.fid })).body.status).toBe('removed');
    expect(await friendsOf(a)).toEqual([]);
    expect(await friendsOf(b)).toEqual([]);
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'friend_removed', fid: a.me.fid }]);
    const again = await a.post('/api/social/friends/remove', { fid: b.me.fid });
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ error: 'not_friends' });
  });

  it('a removed friend can be asked again', async () => {
    const a = await player();
    const b = await player();
    await befriend(a, b);
    await a.post('/api/social/friends/remove', { fid: b.me.fid });
    expect((await requestBy(a, b)).body.status).toBe('sent');
    expect(await incomingOf(b)).toHaveLength(1);
  });
});

describe('blocking', () => {
  it('ends the friendship and every request at once, and the other player hears only that the friend is gone', async () => {
    const a = await player();
    const b = await player();
    await befriend(a, b);
    app.hubs.connect(b.pid());
    const r = await a.post('/api/social/blocks', { fid: b.me.fid });
    expect(r.body.status).toBe('blocked');
    expect(await friendsOf(a)).toEqual([]);
    expect(await friendsOf(b)).toEqual([]);
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'friend_removed', fid: a.me.fid }]);
    expect((await a.get('/api/social/blocks')).body.blocks).toEqual([{ fid: b.me.fid, name: b.me.name, at: T0 }]);
    expect((await a.get('/api/social/me')).body.me.counts.blocks).toBe(1);
  });

  it('a request from a blocked player is dropped; the blocked player is not told', async () => {
    const a = await player();
    const b = await player();
    await a.post('/api/social/blocks', { fid: b.me.fid });
    const r = await requestBy(b, a);
    expect(r.body).toMatchObject({ status: 'sent' });
    expect(await incomingOf(a)).toEqual([]);
    // the one who blocked is told to unblock first
    const mine = await requestBy(a, b);
    expect(mine.status).toBe(409);
    expect(mine.body).toMatchObject({ error: 'you_blocked' });
  });

  it('removes a request waiting in either direction', async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    await requestBy(b, a);
    await requestBy(a, c);
    await a.post('/api/social/blocks', { fid: b.me.fid });
    await a.post('/api/social/blocks', { fid: c.me.fid });
    expect(await incomingOf(a)).toEqual([]);
    expect(await outgoingOf(a)).toEqual([]);
    expect(await incomingOf(c)).toEqual([]);
  });

  it('can be undone; the friendship does not come back, new requests work again', async () => {
    const a = await player();
    const b = await player();
    await befriend(a, b);
    await a.post('/api/social/blocks', { fid: b.me.fid });
    expect((await a.post('/api/social/blocks/remove', { fid: b.me.fid })).body.status).toBe('unblocked');
    expect((await a.get('/api/social/blocks')).body.blocks).toEqual([]);
    expect(await friendsOf(a)).toEqual([]);
    expect((await requestBy(b, a)).body.status).toBe('sent');
    expect(await incomingOf(a)).toHaveLength(1);
  });

  it('knows its own limits: not yourself, not a stranger id, at most two hundred', async () => {
    const a = await player();
    const b = await player();
    expect((await a.post('/api/social/blocks', { fid: a.me.fid })).body).toMatchObject({ error: 'self' });
    expect((await a.post('/api/social/blocks', { fid: '2222222222' })).status).toBe(404);
    expect((await a.post('/api/social/blocks', { fid: 'x' })).status).toBe(400);
    fill('blocks', a.pid(), MAX_BLOCKS);
    const full = await a.post('/api/social/blocks', { fid: b.me.fid });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ error: 'blocks_full' });
    // a player already on the list can still be blocked again
    app.db.raw.prepare('INSERT INTO soc_blocks (pid, target, at) VALUES (?, ?, ?)').run(a.pid(), b.pid(), T0);
    expect((await a.post('/api/social/blocks', { fid: b.me.fid })).status).toBe(200);
  });
});

describe('the friends list', () => {
  it('lists friends by name with their band and since when, and nothing secret', async () => {
    const a = await player();
    const b = await player('teen');
    const c = await player();
    await a.post('/api/social/me', { name: 'Zed Zed' });
    await c.post('/api/social/me', { name: 'Abe Abe' });
    await requestBy(b, a);
    await a.post('/api/social/friends/respond', { fid: b.me.fid, accept: true });
    await befriend(a, c);
    const list = await friendsOf(a);
    expect(list.map((f) => f.name)).toEqual(['Abe Abe', b.me.name].sort((x, y) => x.localeCompare(y)));
    expect(list.find((f) => f.fid === b.me.fid)).toMatchObject({ band: 'teen', since: T0, presence: { status: 'offline' } });
    const text = JSON.stringify(await a.get('/api/social/friends'));
    expect(text).not.toContain(b.pid());
    expect(text).not.toContain(c.pid());
    expect(text).not.toContain(c.me.code.replace('BA-', ''));
  });

  it('a stranger cannot be found: there is no search, and a friend list shows only friends', async () => {
    const a = await player();
    await player();
    expect(await friendsOf(a)).toEqual([]);
    expect((await a.get('/api/social/friends?name=x')).body.friends).toEqual([]);
  });
});
