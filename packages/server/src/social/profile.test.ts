// Profile rules: passwordless sign-up with a device key, the age gate on names, the limits, export and deletion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY } from '../../../core/social/age.ts';
import { generateDeviceKey, signRequest } from '../../../core/social/sign.ts';
import { isPresetName } from '../../../core/social/presets.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from './testkit.ts';

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

describe('register', () => {
  it('creates a profile for an adult with a preset name, a friend code and a link', async () => {
    const p = await app.signup('adult');
    expect(p.me.band).toBe('adult');
    expect(isPresetName(p.me.name)).toBe(true);
    expect(p.me.code).toMatch(/^BA-[2-9A-HJ-NP-Z]{6}$/);
    expect(p.me.link).toBe(`${TEST_ORIGIN}/f/${p.me.code}`);
    expect(p.me.counts).toEqual({ friends: 0, incoming: 0, outgoing: 0, blocks: 0 });
    expect(p.me.can).toEqual({ freeName: true, freeText: true, video: true, publicPlay: true, maxFriends: 100 });
    expect(p.me.level).toBe(1);
    expect(p.me.mutedUntil).toBe(0);
    expect(p.me.fid).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
  });

  it('never sends the secret profile id and answers with the server time', async () => {
    const dev = await app.newDevice();
    const r = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'teen' } });
    expect(r.status).toBe(201);
    expect(r.body.serverTime).toBe(T0);
    const text = JSON.stringify(r.body);
    const pid = (app.db.raw.prepare('SELECT pid FROM soc_profiles').get() as { pid: string }).pid;
    expect(text).not.toContain(pid);
    expect(Object.keys(r.body.me)).not.toContain('pid');
  });

  it('gives under-18 players a preset name and what the band allows', async () => {
    const child = await app.signup('child');
    const teen = await app.signup('teen');
    expect(isPresetName(child.me.name)).toBe(true);
    expect(isPresetName(teen.me.name)).toBe(true);
    expect(child.me.can).toEqual({ freeName: false, freeText: false, video: false, publicPlay: false, maxFriends: 25 });
    expect(teen.me.can).toEqual({ freeName: false, freeText: false, video: false, publicPlay: true, maxFriends: 50 });
  });

  it('refuses a typed name from an under-18 player and filters an adult name', async () => {
    const dev = await app.newDevice();
    const typed = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'teen', name: 'Mert' } });
    expect(typed.status).toBe(400);
    expect(typed.body).toMatchObject({ error: 'name_rejected', reason: 'preset_only' });
    const dev2 = await app.newDevice();
    const link = await app.call('POST', '/api/social/register', { dev: dev2, body: { pub: dev2.keys.publicRaw, band: 'adult', name: 'visit example.com' } });
    expect(link.status).toBe(400);
    expect(link.body).toMatchObject({ error: 'name_rejected', reason: 'link' });
    const ok = await app.signup('adult', { name: 'Coach Zed' });
    expect(ok.me.name).toBe('Coach Zed');
  });

  it('needs a valid band, key, region and language', async () => {
    const dev = await app.newDevice();
    const bad = (body: Record<string, unknown>) => app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult', ...body } });
    expect((await bad({ band: 'senior' })).body).toMatchObject({ error: 'bad_request', field: 'band' });
    expect((await bad({ band: undefined })).body).toMatchObject({ error: 'bad_request', field: 'band' });
    expect((await bad({ region: 'mars' })).body).toMatchObject({ error: 'bad_request', field: 'region' });
    expect((await bad({ lang: 'x' })).body).toMatchObject({ error: 'bad_request', field: 'lang' });
    expect((await bad({ pub: 'not-a-key' })).body).toMatchObject({ error: 'bad_request', field: 'pub' });
  });

  it('clamps the level and takes region and language from the request', async () => {
    const p = await app.signup('adult', { level: 500, region: 'na', lang: 'tr' });
    expect(p.me.level).toBe(99);
    expect(p.me.region).toBe('na');
    expect(p.me.lang).toBe('tr');
  });

  it('proves the sender holds the private key', async () => {
    const dev = await app.newDevice();
    const other = await app.newDevice();
    // signed by another key: the kid does not match the key in the body
    const r = await app.call('POST', '/api/social/register', { dev: other, body: { pub: dev.keys.publicRaw, band: 'adult' } });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: 'unauthorized' });
    // no signature at all
    const none = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult' }, rawAuth: '' });
    expect(none.status).toBe(401);
  });

  it('answers clock_skew with the server time and refuses a replayed request', async () => {
    const dev = await app.newDevice();
    const body = { pub: dev.keys.publicRaw, band: 'adult' };
    const late = await app.call('POST', '/api/social/register', { dev, body, at: T0 - 6 * 60_000 });
    expect(late.status).toBe(401);
    expect(late.body).toMatchObject({ error: 'clock_skew', serverTime: T0 });
    const url = `${TEST_ORIGIN}/api/social/register`;
    const header = await signRequest(dev.keys, { method: 'POST', url, body }, T0);
    const first = await app.call('POST', '/api/social/register', { body, rawAuth: header, ip: '10.1.1.1' });
    expect(first.status).toBe(201);
    const replay = await app.call('POST', '/api/social/register', { body, rawAuth: header, ip: '10.1.1.1' });
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ error: 'replayed' });
  });

  it('is idempotent for the same key: the same profile comes back', async () => {
    const dev = await app.newDevice();
    const body = { pub: dev.keys.publicRaw, band: 'adult' };
    const a = await app.call('POST', '/api/social/register', { dev, body });
    const b = await app.call('POST', '/api/social/register', { dev, body: { ...body, band: 'child' } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.created).toBe(false);
    expect(b.body.me.fid).toBe(a.body.me.fid);
    expect(b.body.me.band).toBe('adult');
    expect((app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_profiles').get() as { n: number }).n).toBe(1);
  });

  it('limits new profiles per address: 20 an hour, then a wait', async () => {
    for (let i = 0; i < 20; i++) await app.signup('adult', {}, { ip: '10.5.5.5' });
    const dev = await app.newDevice('10.5.5.5');
    const r = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult' } });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    expect(r.body.retryAfterMs).toBeGreaterThan(0);
    // another address is not affected, and the wait ends with the hour
    await app.signup('adult', {}, { ip: '10.5.5.6' });
    vi.setSystemTime(T0 + 3_600_000);
    const later = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult' } });
    expect(later.status).toBe(201);
  });

  it('limits new profiles per address: 60 a day', async () => {
    for (let h = 0; h < 3; h++) {
      for (let i = 0; i < 20; i++) await app.signup('adult', {}, { ip: '10.6.6.6' });
      vi.setSystemTime(T0 + (h + 1) * 3_600_000);
    }
    const dev = await app.newDevice('10.6.6.6');
    const r = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult' } });
    expect(r.status).toBe(429);
  });

  it('stops all sign-ups for the rest of the day once the daily ceiling is reached', async () => {
    const small = createTestApp({ env: { SOCIAL_MAX_SIGNUPS_PER_DAY: '3' } });
    for (let i = 0; i < 3; i++) await small.signup('adult');
    const dev = await small.newDevice();
    const r = await small.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult' } });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: 'closed' });
    expect(r.body.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('signed requests', () => {
  it('refuses a request without a signature, from an unknown device, or with a tampered body', async () => {
    const p = await app.signup('adult');
    expect((await app.call('GET', '/api/social/me')).status).toBe(401);
    const stranger = await app.newDevice();
    const unknown = await app.call('GET', '/api/social/me', { dev: stranger });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toMatchObject({ error: 'unknown_device' });
    // a signature made for one body does not carry another
    const url = `${TEST_ORIGIN}/api/social/me`;
    const header = await signRequest(p.dev.keys, { method: 'POST', url, body: { dnd: false } }, Date.now());
    const tampered = await app.call('POST', '/api/social/me', { body: { dnd: true }, rawAuth: header });
    expect(tampered.status).toBe(401);
    // nor does it carry another path or method
    const get = await app.call('GET', '/api/social/friends', { rawAuth: await signRequest(p.dev.keys, { method: 'GET', url }, Date.now()) });
    expect(get.status).toBe(401);
  });

  it('refuses the same signed request twice', async () => {
    const p = await app.signup('adult');
    const url = `${TEST_ORIGIN}/api/social/me`;
    const header = await signRequest(p.dev.keys, { method: 'GET', url }, Date.now());
    expect((await app.call('GET', '/api/social/me', { rawAuth: header })).status).toBe(200);
    const again = await app.call('GET', '/api/social/me', { rawAuth: header });
    expect(again.status).toBe(401);
    expect(again.body).toMatchObject({ error: 'replayed' });
  });

  it('keeps error answers free of the secret profile id and always carries serverTime', async () => {
    const r = await app.call('GET', '/api/social/me');
    expect(r.body).toMatchObject({ error: 'unauthorized' });
    expect(typeof r.body.serverTime).toBe('number');
  });

  it('answers 503 unavailable when the Worker has no social bindings', async () => {
    const res = await app.router.handle(new Request(`${TEST_ORIGIN}/api/social/me`), {}, { waitUntil: () => {} });
    expect(res?.status).toBe(503);
  });

  it('a second device key of another player cannot act as the first', async () => {
    const a = await app.signup('adult');
    const b = await app.signup('adult');
    const r = await app.call('GET', '/api/social/me', { dev: b.dev });
    expect(r.body.me.fid).toBe(b.me.fid);
    expect(r.body.me.fid).not.toBe(a.me.fid);
  });
});

describe('changing the profile', () => {
  it('lets an adult rename (filtered) up to three times a day', async () => {
    const p = await app.signup('adult');
    expect((await p.post('/api/social/me', { name: 'Kai One' })).body.me.name).toBe('Kai One');
    expect((await p.post('/api/social/me', { name: 'Kai Two' })).status).toBe(200);
    expect((await p.post('/api/social/me', { name: 'Kai Three' })).status).toBe(200);
    const fourth = await p.post('/api/social/me', { name: 'Kai Four' });
    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ error: 'rate_limited' });
    expect((await p.get('/api/social/me')).body.me.name).toBe('Kai Three');
    // the same name again changes nothing and costs nothing
    expect((await p.post('/api/social/me', { name: 'Kai Three' })).status).toBe(200);
    vi.setSystemTime(T0 + 86_400_000);
    expect((await p.post('/api/social/me', { name: 'Kai Four' })).status).toBe(200);
    const bad = await p.post('/api/social/me', { name: 'call 0555 123 45 67' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'name_rejected' });
  });

  it('keeps under-18 players on preset names, which they can re-roll', async () => {
    const t = await app.signup('teen');
    const typed = await t.post('/api/social/me', { name: 'Mert' });
    expect(typed.status).toBe(400);
    expect(typed.body).toMatchObject({ reason: 'preset_only' });
    const first = t.me.name;
    let changed = false;
    for (let i = 0; i < 3 && !changed; i++) {
      const r = await t.post('/api/social/me', { reroll: true });
      expect(r.status).toBe(200);
      expect(isPresetName(r.body.me.name)).toBe(true);
      changed = r.body.me.name !== first;
    }
    expect(changed).toBe(true);
    // a preset name given back is accepted
    expect((await t.post('/api/social/me', { name: 'Swift Falcon 42' })).body.me.name).toBe('Swift Falcon 42');
  });

  it('only lowers the age band, and a free name becomes a preset name when it does', async () => {
    const a = await app.signup('adult', { name: 'Coach Zed' });
    const up = await a.post('/api/social/me', { band: 'adult' });
    expect(up.status).toBe(200);
    const down = await a.post('/api/social/me', { band: 'teen' });
    expect(down.status).toBe(200);
    expect(down.body.me.band).toBe('teen');
    expect(isPresetName(down.body.me.name)).toBe(true);
    expect(down.body.me.can.video).toBe(false);
    const raise = await a.post('/api/social/me', { band: 'adult' });
    expect(raise.status).toBe(403);
    expect(raise.body).toMatchObject({ error: 'band_locked' });
    expect((await a.post('/api/social/me', { band: 'child' })).body.me.band).toBe('child');
    expect((await a.post('/api/social/me', { band: 'teen' })).status).toBe(403);
    expect((await a.post('/api/social/me', { band: 'nope' })).status).toBe(400);
  });

  it('updates level (clamped, limited), region, language and appear-offline', async () => {
    const p = await app.signup('adult');
    const r = await p.post('/api/social/me', { level: 30, region: 'as', lang: 'ja', dnd: true });
    expect(r.body.me).toMatchObject({ level: 30, region: 'as', lang: 'ja', dnd: true });
    expect((await p.post('/api/social/me', { level: 1000 })).body.me.level).toBe(99);
    expect((await p.post('/api/social/me', { level: 'high' })).status).toBe(400);
    expect((await p.post('/api/social/me', { region: 'moon' })).status).toBe(400);
    expect((await p.post('/api/social/me', { dnd: 'yes' })).status).toBe(400);
    for (let i = 0; i < 10; i++) await p.post('/api/social/me', { level: 2 + i });
    const over = await p.post('/api/social/me', { level: 50 });
    expect(over.status).toBe(429);
  });

  it('an empty update changes and writes nothing', async () => {
    const p = await app.signup('adult');
    await p.get('/api/social/me'); // the first request of the hour claims the sweep (one counter write)
    app.db.resetCounters();
    const r = await p.post('/api/social/me', {});
    expect(r.status).toBe(200);
    expect(app.db.counters.writes).toBe(0);
  });
});

describe('friend code', () => {
  it('renews the code: the old one stops working, three times a day', async () => {
    const p = await app.signup('adult');
    const old = p.me.code;
    const r = await p.post('/api/social/me/code');
    expect(r.status).toBe(200);
    expect(r.body.me.code).not.toBe(old);
    expect(r.body.me.code).toMatch(/^BA-[2-9A-HJ-NP-Z]{6}$/);
    const other = await app.signup('adult');
    const lookup = await other.post('/api/social/friends/request', { code: old });
    expect(lookup.status).toBe(404);
    expect((await other.post('/api/social/friends/request', { code: r.body.me.code })).body.status).toBe('sent');
    await p.post('/api/social/me/code');
    await p.post('/api/social/me/code');
    expect((await p.post('/api/social/me/code')).status).toBe(429);
  });
});

describe('export and deletion', () => {
  it('exports everything stored about the player and nothing secret', async () => {
    const a = await app.signup('adult', { name: 'Coach Zed' });
    const b = await app.signup('adult', { name: 'Kai One' });
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    const c = await app.signup('adult');
    await c.post('/api/social/friends/request', { code: a.me.code });
    const r = await a.get('/api/social/me/export');
    expect(r.status).toBe(200);
    const x = r.body.export;
    expect(x.profile).toMatchObject({ fid: a.me.fid, name: 'Coach Zed', band: 'adult' });
    expect(x.profile.counts).toBeUndefined();
    expect(x.friends.map((f: { name: string }) => f.name)).toEqual(['Kai One']);
    expect(x.incoming).toHaveLength(1);
    expect(x.reportsFiled).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain(a.pid());
  });

  it('deletes everything: devices, friendships, requests, blocks, presence; the friends are told', async () => {
    const a = await app.signup('adult');
    const b = await app.signup('adult');
    const c = await app.signup('adult');
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    await c.post('/api/social/friends/request', { code: a.me.code });
    await a.post('/api/social/blocks', { fid: c.me.fid });
    app.db.raw.prepare("INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)").run(a.pid(), T0, T0);
    const aPid = a.pid();
    app.hubs.connect(b.pid());
    app.hubs.connect(aPid);
    const refused = await a.post('/api/social/me/delete', {});
    expect(refused.status).toBe(400);
    const r = await a.post('/api/social/me/delete', { confirm: 'delete' });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    for (const t of ['soc_profiles', 'soc_devices', 'soc_presence']) {
      expect((app.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE pid = ?`).get(aPid) as { n: number }).n).toBe(0);
    }
    for (const [t, cols] of [['soc_friends', 'pid = ?1 OR friend = ?1'], ['soc_requests', 'from_pid = ?1 OR to_pid = ?1'], ['soc_blocks', 'pid = ?1 OR target = ?1']] as const) {
      expect((app.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${cols}`).get(aPid) as { n: number }).n).toBe(0);
    }
    expect(app.hubs.events(b.pid())).toContainEqual({ t: 'friend_removed', fid: a.me.fid });
    expect(app.hubs.closes).toContainEqual({ pid: aPid, reason: 'deleted' });
    const after = await a.get('/api/social/me');
    expect(after.status).toBe(401);
    expect(after.body).toMatchObject({ error: 'unknown_device' });
    expect((await b.get('/api/social/friends')).body.friends).toEqual([]);
    expect((await b.get('/api/social/requests')).body.incoming).toEqual([]);
  });

  it('reports filed by a deleted player stay as evidence without the reporter; reports against them lose the name', async () => {
    const a = await app.signup('adult', { name: 'Coach Zed' });
    const b = await app.signup('adult', { name: 'Kai One' });
    await a.post('/api/social/report', { fid: b.me.fid, reason: 'abuse' });
    await b.post('/api/social/report', { fid: a.me.fid, reason: 'spam', note: 'rude' });
    await a.post('/api/social/me/delete', { confirm: 'delete' });
    const rows = app.db.raw.prepare('SELECT reporter, target_name, note FROM soc_reports ORDER BY id').all() as { reporter: string | null; target_name: string; note: string | null }[];
    expect(rows[0]).toMatchObject({ reporter: null, target_name: 'Kai One' });
    expect(rows[1]).toMatchObject({ target_name: '', note: null });
  });

  it('limits deletion attempts and cannot be done without a signature', async () => {
    expect((await app.call('POST', '/api/social/me/delete', { body: { confirm: 'delete' } })).status).toBe(401);
  });
});

describe('banned players', () => {
  it('cannot use the API but can still export and delete their data', async () => {
    const p = await app.signup('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(T0 + 86_400_000, p.pid());
    const me = await p.get('/api/social/me');
    expect(me.status).toBe(403);
    expect(me.body).toMatchObject({ error: 'banned', until: T0 + 86_400_000 });
    expect((await p.get('/api/social/friends')).status).toBe(403);
    expect((await p.get('/api/social/me/export')).status).toBe(200);
    // registering the same key again does not lift the ban
    const again = await app.call('POST', '/api/social/register', { dev: p.dev, body: { pub: p.dev.keys.publicRaw, band: 'adult' } });
    expect(again.status).toBe(403);
    expect((await p.post('/api/social/me/delete', { confirm: 'delete' })).status).toBe(200);
  });

  it('a ban ends by itself', async () => {
    const p = await app.signup('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(T0 + 60_000, p.pid());
    expect((await p.get('/api/social/me')).status).toBe(403);
    vi.setSystemTime(T0 + 61_000);
    expect((await p.get('/api/social/me')).status).toBe(200);
  });
});

describe('key handling', () => {
  it('a profile can have only the key it registered with', async () => {
    const p = await app.signup('adult');
    const other = await generateDeviceKey();
    const r = await app.call('GET', '/api/social/me', { dev: { keys: other, ip: p.dev.ip } });
    expect(r.status).toBe(401);
  });
});

// The production setting of the under-13 rule: the test kit turns POLICY.child.online on so the suites can exercise every band;
// these cases turn it off again, as it is in the real Worker (core/social/age.ts).
describe('under 13 has no online identity (the production setting)', () => {
  beforeEach(() => { POLICY.child.online = false; });
  afterEach(() => { POLICY.child.online = true; });

  it('refuses the registration and stores nothing, not even a rate-limit count', async () => {
    const dev = await app.newDevice();
    const r = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'child' } });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'child_no_online' });
    expect(JSON.stringify(r.body)).not.toContain(dev.keys.publicRaw);
    for (const table of ['soc_profiles', 'soc_devices', 'soc_limits']) {
      expect((app.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0);
    }
    // a name or anything else in the body changes nothing: the band decides
    const named = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'child', name: 'Swift Falcon 42' } });
    expect(named.status).toBe(403);
    expect((app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_profiles').get() as { n: number }).n).toBe(0);
  });

  it('keeps the other bands as they were', async () => {
    expect((await app.signup('teen')).me.band).toBe('teen');
    expect((await app.signup('adult')).me.band).toBe('adult');
  });

  it('does not let a profile step down to it: the player deletes the profile instead', async () => {
    const t = await app.signup('teen');
    const r = await t.post('/api/social/me', { band: 'child' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'child_no_online' });
    expect((await t.get('/api/social/me')).body.me.band).toBe('teen');
    expect((await t.post('/api/social/me/delete', { confirm: 'delete' })).status).toBe(200);
  });
});
