// Reports, the automatic steps and the moderator API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, HOUR, LIMITS, MOD, STATS_COUNT_CAP } from '../../../core/social/rules.ts';
import type { AgeBand, ReportReason } from '../../../core/social/types.ts';
import { socialHooks } from './hooks.ts';
import { cleanNote, fileReport, REPORTER_MIN_AGE_MS } from './moderation.ts';
import { createTestApp, type TestApp, type TestPlayer } from './testkit.ts';
import type { LiveEnv } from '../live/env.ts';

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
const report = (from: TestPlayer, target: TestPlayer, reason: ReportReason = 'abuse', extra: Record<string, unknown> = {}) =>
  from.post('/api/social/report', { fid: target.me.fid, reason, ...extra });
const profile = (p: TestPlayer) => app.db.raw.prepare('SELECT muted_until, public_blocked_until, banned_until FROM soc_profiles WHERE pid = ?').get(p.pid()) as { muted_until: number; public_blocked_until: number; banned_until: number };
const reports = () => app.db.raw.prepare('SELECT * FROM soc_reports ORDER BY id').all() as Record<string, unknown>[];
const audit = () => app.db.raw.prepare('SELECT * FROM soc_audit ORDER BY id').all() as { actor: string; action: string; detail: string }[];
/** Players old enough for their reports to count towards the automatic steps. */
async function reporters(n: number): Promise<TestPlayer[]> {
  const list: TestPlayer[] = [];
  for (let i = 0; i < n; i++) list.push(await player());
  vi.setSystemTime(T0 + REPORTER_MIN_AGE_MS + 60_000);
  return list;
}

describe('reporting a player', () => {
  it('puts the report in the queue with who, why and when, and answers filed', async () => {
    const [a, b] = await reporters(2) as [TestPlayer, TestPlayer];
    const r = await report(a, b, 'spam', { note: '  keeps inviting me  ' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'filed', blocked: false });
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toMatchObject({ reporter: a.pid(), target: b.pid(), target_fid: b.me.fid, target_name: b.me.name, target_band: 'adult', reason: 'spam', source: 'friend', note: 'keeps inviting me', status: 'open', urgent: 0 });
  });

  it('knows the reasons, the player and the limits of a note', async () => {
    const [a, b] = await reporters(2) as [TestPlayer, TestPlayer];
    expect((await report(a, b, 'rude' as ReportReason)).body).toMatchObject({ error: 'bad_request', field: 'reason' });
    expect((await a.post('/api/social/report', { fid: 'bad', reason: 'abuse' })).status).toBe(400);
    expect((await a.post('/api/social/report', { fid: '2222222222', reason: 'abuse' })).status).toBe(404);
    expect((await report(a, a)).body).toMatchObject({ error: 'self' });
    await report(a, b, 'abuse', { note: 'x'.repeat(1000) });
    expect((reports()[0]?.note as string).length).toBe(MOD.noteMaxChars);
  });

  it('an under-18 player picks a reason; a typed note is dropped', async () => {
    const teen = await player('teen');
    const b = await player();
    await report(teen, b, 'abuse', { note: 'he said something bad' });
    expect(reports()[0]?.note).toBeNull();
  });

  it('cleans a note: control characters out, whitespace trimmed, empty means none', () => {
    expect(cleanNote('  a\u0000b\u0007c  ', 50)).toBe('abc');
    expect(cleanNote('   ', 50)).toBeNull();
    expect(cleanNote(42, 50)).toBeNull();
    expect(cleanNote('abcdef', 3)).toBe('abc');
    expect(cleanNote('line1\nline2', 50)).toBe('line1\nline2');
  });

  it('the same report twice in a day is one report, and the reporter hears the same answer', async () => {
    const [a, b] = await reporters(2) as [TestPlayer, TestPlayer];
    const first = await report(a, b);
    const second = await report(a, b);
    expect(second.body).toEqual({ ...first.body, serverTime: second.body.serverTime });
    expect(reports()).toHaveLength(1);
    vi.setSystemTime(T0 + REPORTER_MIN_AGE_MS + 60_000 + DAY + 1000);
    await report(a, b);
    expect(reports()).toHaveLength(2);
    // another reason is another report
    await report(a, b, 'cheating');
    expect(reports()).toHaveLength(3);
  });

  it('limits a reporter to ten reports a day', async () => {
    const [a] = await reporters(1) as [TestPlayer];
    const targets: TestPlayer[] = [];
    for (let i = 0; i < 11; i++) targets.push(await player());
    for (let i = 0; i < 10; i++) expect((await report(a, targets[i] as TestPlayer)).status).toBe(200);
    const r = await report(a, targets[10] as TestPlayer);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    expect(reports()).toHaveLength(10);
  });

  it('can block at the same time, which also ends a friendship', async () => {
    const [a, b] = await reporters(2) as [TestPlayer, TestPlayer];
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    app.hubs.connect(b.pid());
    const r = await report(a, b, 'abuse', { block: true });
    expect(r.body).toMatchObject({ status: 'filed', blocked: true });
    expect((await a.get('/api/social/blocks')).body.blocks).toHaveLength(1);
    expect((await a.get('/api/social/friends')).body.friends).toEqual([]);
    expect(app.hubs.take(b.pid())).toEqual([{ t: 'friend_removed', fid: a.me.fid }]);
  });
});

describe('the automatic steps', () => {
  it('three different reporters within a day silence the free text for a day', async () => {
    const [a, b, c, target] = await reporters(4) as [TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    const now = Date.now();
    await report(a, target);
    await report(b, target);
    expect(profile(target).muted_until).toBe(0);
    await report(c, target);
    expect(profile(target).muted_until).toBe(now + MOD.muteMs);
    expect(profile(target).public_blocked_until).toBe(0);
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ actor: 'auto', action: 'mute_text' });
    expect((await target.get('/api/social/me')).body.me.mutedUntil).toBe(now + MOD.muteMs);
  });

  it('one player reporting again and again counts once', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    for (const reason of ['abuse', 'spam', 'cheating', 'other'] as const) await report(a, target, reason);
    expect(reports()).toHaveLength(4);
    expect(profile(target).muted_until).toBe(0);
  });

  it('reports from profiles younger than an hour are queued but do not trigger anything', async () => {
    const target = await player();
    vi.setSystemTime(T0 + 2 * HOUR);
    const fresh: TestPlayer[] = [];
    for (let i = 0; i < 8; i++) fresh.push(await player());
    for (const f of fresh) await report(f, target);
    expect(reports()).toHaveLength(8);
    expect(profile(target).muted_until).toBe(0);
    expect(profile(target).public_blocked_until).toBe(0);
    expect(audit()).toEqual([]);
  });

  it('reports older than a day do not add up with new ones', async () => {
    const [a, b, c, target] = await reporters(4) as [TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    await report(a, target);
    await report(b, target);
    vi.setSystemTime(Date.now() + DAY + 1000);
    await report(c, target);
    expect(profile(target).muted_until).toBe(0);
  });

  it('six different reporters within a week close the public lobbies for three days, pending review', async () => {
    const list = await reporters(7);
    const target = list.pop() as TestPlayer;
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(Date.now() + 26 * HOUR);
      await report(list[i] as TestPlayer, target);
    }
    expect(profile(target).public_blocked_until).toBe(Date.now() + MOD.suspendMs);
    expect(audit().at(-1)).toMatchObject({ action: 'suspend_public' });
    expect(reports().at(-1)?.urgent).toBe(1);
  });

  it('a serious report goes to the top of the queue at once; two of them suspend', async () => {
    const [a, b, target] = await reporters(3) as [TestPlayer, TestPlayer, TestPlayer];
    await report(a, target, 'sexual');
    expect(reports()[0]?.urgent).toBe(1);
    expect(profile(target).public_blocked_until).toBe(0);
    await report(b, target, 'underage');
    expect(profile(target).public_blocked_until).toBe(Date.now() + MOD.suspendMs);
    const lobbies = await target.get('/api/social/lobbies');
    expect(lobbies.body).toMatchObject({ error: 'public_suspended' });
  });

  it('a sanction is never shortened by a later, smaller one', async () => {
    const [a, b, c, target] = await reporters(4) as [TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    app.db.raw.prepare('UPDATE soc_profiles SET muted_until = ? WHERE pid = ?').run(Date.now() + 10 * DAY, target.pid());
    await report(a, target); await report(b, target); await report(c, target);
    expect(profile(target).muted_until).toBe(Date.now() + 10 * DAY);
  });

  it('reports against a player who is gone are ignored', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    const pid = target.pid();
    await target.post('/api/social/me/delete', { confirm: 'delete' });
    expect((await fileReport(app.db, { reporter: a.pid(), target: pid, reason: 'abuse', source: 'room', at: Date.now() })).status).toBe('unknown_target');
    expect(reports()).toEqual([]);
  });
});

describe('reports from a Room', () => {
  const hookEnv = (): LiveEnv => app.env as unknown as LiveEnv;
  const roomReport = (a: TestPlayer, target: TestPlayer, over: Record<string, unknown> = {}) => ({
    code: 'ABCDEF', matchId: 'm1', reporterPid: a.pid(), targetPid: target.pid(), reporterSeat: 's1', targetSeat: 's2', reason: 'abuse' as ReportReason,
    at: Date.now(), chat: [{ seat: 's2', name: target.me.name, text: 'you are bad', at: Date.now() }], ...over,
  });

  it('are queued with the room, the match and the chat lines the Room saw', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    await socialHooks.submitReport?.(hookEnv(), roomReport(a, target));
    expect(reports()[0]).toMatchObject({ source: 'room', room: 'ABCDEF', match_id: 'm1', reporter: a.pid(), target: target.pid() });
    expect(JSON.parse(reports()[0]?.evidence as string)).toEqual([{ seat: 's2', name: target.me.name, text: 'you are bad', at: Date.now() }]);
  });

  it('keep at most fifty chat lines, each cut short', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    const chat = Array.from({ length: 80 }, (_, i) => ({ seat: 's2', name: 'x', text: `line ${i} ${'y'.repeat(600)}`, at: Date.now() }));
    await socialHooks.submitReport?.(hookEnv(), roomReport(a, target, { chat }));
    const ev = JSON.parse(reports()[0]?.evidence as string) as { text: string }[];
    expect(ev).toHaveLength(MOD.evidenceLines);
    expect(ev[0]?.text.startsWith('line 30 ')).toBe(true);
    expect(ev.every((l) => l.text.length <= 400)).toBe(true);
  });

  it('count towards the same automatic steps as friend reports, and share the daily limit', async () => {
    const [a, b, c, target] = await reporters(4) as [TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    await socialHooks.submitReport?.(hookEnv(), roomReport(a, target));
    await report(b, target);
    await socialHooks.submitReport?.(hookEnv(), roomReport(c, target, { reason: 'cheating' }));
    expect(profile(target).muted_until).toBe(Date.now() + MOD.muteMs);
    const extra: TestPlayer[] = [];
    for (let i = 0; i < 11; i++) extra.push(await player());
    const spammer = a;
    for (let i = 0; i < 12; i++) await socialHooks.submitReport?.(hookEnv(), roomReport(spammer, extra[i % 11] as TestPlayer, { reason: i % 2 ? 'spam' : 'other' }));
    expect(reports().filter((r) => r.reporter === a.pid()).length).toBeLessThanOrEqual(10);
  });

  it('a report that claims to be from the future is dated now', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    await socialHooks.submitReport?.(hookEnv(), roomReport(a, target, { at: Date.now() + 10 * DAY }));
    expect(reports()[0]?.at).toBe(Date.now());
  });
});

describe('the moderator API', () => {
  const list = async (q = '') => (await app.admin('GET', `/api/admin/social/reports${q}`)).body.reports as Record<string, any>[];

  it('does not exist without a configured token, and refuses a wrong or missing one', async () => {
    const [a, b] = await reporters(2) as [TestPlayer, TestPlayer];
    await report(a, b);
    expect((await app.admin('GET', '/api/admin/social/reports', undefined, null)).status).toBe(401);
    expect((await app.admin('GET', '/api/admin/social/reports', undefined, 'wrong-token-0123456789')).status).toBe(401);
    const bare = createTestApp({ env: { ADMIN_TOKEN: undefined } });
    expect((await bare.admin('GET', '/api/admin/social/reports')).status).toBe(404);
    expect((await bare.admin('GET', '/api/admin/social/stats')).status).toBe(404);
    const short = createTestApp({ env: { ADMIN_TOKEN: 'short' } });
    expect((await short.admin('GET', '/api/admin/social/reports', undefined, 'short')).status).toBe(404);
    expect((await app.admin('GET', '/api/admin/social/reports')).status).toBe(200);
  });

  it('lists the queue with serious reports first, then the oldest, with the evidence and what the target already has', async () => {
    const [a, b, c, t1, t2] = await reporters(5) as [TestPlayer, TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    await report(a, t1, 'spam');
    vi.setSystemTime(Date.now() + 1000);
    await report(b, t2, 'sexual');
    vi.setSystemTime(Date.now() + 1000);
    await report(c, t1, 'abuse');
    const q = await list();
    expect(q.map((r) => [r.targetFid, r.reason])).toEqual([[t2.me.fid, 'sexual'], [t1.me.fid, 'spam'], [t1.me.fid, 'abuse']]);
    expect(q[0]).toMatchObject({ urgent: true, status: 'open', reporterFid: b.me.fid, targetName: t2.me.name, targetBand: 'adult', source: 'friend', reportsAgainstTarget: 1 });
    expect(q[1]?.reportsAgainstTarget).toBe(2);
    expect(q[0]?.sanctions).toEqual({ mutedUntil: 0, publicBlockedUntil: 0, bannedUntil: 0 });
    expect(JSON.stringify(q)).not.toContain(a.pid());
    expect(await list('?limit=1')).toHaveLength(1);
    expect((await app.admin('GET', '/api/admin/social/reports?status=nope')).status).toBe(400);
  });

  it("erases a profile by its friend code, as the player's own button does, for a request made by e-mail", async () => {
    const [a, b, t] = await reporters(3) as [TestPlayer, TestPlayer, TestPlayer];
    await a.post('/api/social/friends/request', { code: t.me.code });
    await t.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    await report(b, t, 'abuse');
    const tPid = t.pid();
    app.hubs.connect(a.pid());
    app.hubs.connect(tPid);
    expect((await app.admin('POST', '/api/admin/social/profiles/delete', { code: t.me.code }, null)).status).toBe(401);
    expect((await app.admin('POST', '/api/admin/social/profiles/delete', { code: 'nonsense' })).status).toBe(400);
    expect((await app.admin('POST', '/api/admin/social/profiles/delete', { code: 'BA-222222' })).status).toBe(404);
    const r = await app.admin('POST', '/api/admin/social/profiles/delete', { code: t.me.code, note: 'asked by e-mail 25 Oct' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, deleted: true });
    for (const tbl of ['soc_profiles', 'soc_devices']) expect((app.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE pid = ?`).get(tPid) as { n: number }).n).toBe(0);
    expect((app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_friends WHERE pid = ?1 OR friend = ?1').get(tPid) as { n: number }).n).toBe(0);
    expect(app.hubs.events(a.pid())).toContainEqual({ t: 'friend_removed', fid: t.me.fid });
    expect(app.hubs.closes).toContainEqual({ pid: tPid, reason: 'deleted' });
    expect((await t.get('/api/social/me')).status).toBe(401);
    // the report about the player stays without the name; the safety log keeps the act and the note, and nothing that names the player
    expect(app.db.raw.prepare('SELECT target_name, note FROM soc_reports').get()).toEqual({ target_name: '', note: null });
    const audit = app.db.raw.prepare("SELECT actor, action, target, detail FROM soc_audit WHERE action = 'delete_profile'").all() as { actor: string; action: string; target: string | null; detail: string }[];
    expect(audit).toEqual([{ actor: 'admin', action: 'delete_profile', target: null, detail: JSON.stringify({ note: 'asked by e-mail 25 Oct' }) }]);
    expect(JSON.stringify(audit)).not.toContain(t.me.name);
    // a second request for the same code finds nothing
    expect((await app.admin('POST', '/api/admin/social/profiles/delete', { code: t.me.code })).status).toBe(404);
    // and the route does not exist where no token is configured
    const bare = createTestApp({ env: { ADMIN_TOKEN: undefined } });
    expect((await bare.admin('POST', '/api/admin/social/profiles/delete', { code: a.me.code })).status).toBe(404);
  });

  it('dismiss and warn settle one report and change nothing about the player', async () => {
    const [a, b, target] = await reporters(3) as [TestPlayer, TestPlayer, TestPlayer];
    await report(a, target, 'spam');
    await report(b, target, 'abuse');
    const [first, second] = reports() as [{ id: number }, { id: number }];
    const d = await app.admin('POST', `/api/admin/social/reports/${first.id}`, { action: 'dismiss' });
    expect(d.body.report).toMatchObject({ status: 'dismissed', handledAction: 'dismiss' });
    const w = await app.admin('POST', `/api/admin/social/reports/${second.id}`, { action: 'warn', note: 'told them' });
    expect(w.body.report).toMatchObject({ status: 'actioned', handledAction: 'warn' });
    expect(profile(target)).toEqual({ muted_until: 0, public_blocked_until: 0, banned_until: 0 });
    expect(audit().map((x) => [x.actor, x.action])).toEqual([['admin', 'dismiss'], ['admin', 'warn']]);
    expect(await list()).toEqual([]);
    expect(await list('?status=dismissed')).toHaveLength(1);
    expect(await list('?status=actioned')).toHaveLength(1);
  });

  it('mute, suspend and ban set the sanction for the days asked and settle every open report on the player', async () => {
    const [a, b, c, target, other] = await reporters(5) as [TestPlayer, TestPlayer, TestPlayer, TestPlayer, TestPlayer];
    await report(a, target, 'spam');
    await report(b, target, 'abuse');
    await report(c, other, 'spam');
    const id = (reports()[0] as { id: number }).id;
    const m = await app.admin('POST', `/api/admin/social/reports/${id}`, { action: 'mute', days: 5 });
    expect(m.status).toBe(200);
    expect(profile(target).muted_until).toBe(Date.now() + 5 * DAY);
    expect((await list()).map((r) => r.targetFid)).toEqual([other.me.fid]);
    const s = await app.admin('POST', `/api/admin/social/reports/${id}`, { action: 'suspend' });
    expect(profile(target).public_blocked_until).toBe(Date.now() + 7 * DAY);
    expect(s.body.report.sanctions.publicBlockedUntil).toBe(Date.now() + 7 * DAY);
    app.hubs.connect(target.pid());
    await app.admin('POST', `/api/admin/social/reports/${id}`, { action: 'ban', days: 99999 });
    expect(profile(target).banned_until).toBe(Date.now() + 3650 * DAY);
    expect(app.hubs.closes).toContainEqual({ pid: target.pid(), reason: 'banned' });
    expect((await target.get('/api/social/me')).body).toMatchObject({ error: 'banned' });
    expect(audit().map((x) => x.action)).toEqual(['mute', 'suspend', 'ban']);
  });

  it('clear lifts every sanction and dismisses the report', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    await report(a, target);
    app.db.raw.prepare('UPDATE soc_profiles SET muted_until = ?, public_blocked_until = ?, banned_until = ? WHERE pid = ?').run(Date.now() + DAY, Date.now() + DAY, Date.now() + DAY, target.pid());
    const id = (reports()[0] as { id: number }).id;
    const r = await app.admin('POST', `/api/admin/social/reports/${id}`, { action: 'clear' });
    expect(r.body.report).toMatchObject({ status: 'dismissed', handledAction: 'clear' });
    expect(profile(target)).toEqual({ muted_until: 0, public_blocked_until: 0, banned_until: 0 });
    expect((await target.get('/api/social/me')).status).toBe(200);
  });

  it('refuses what it does not know', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    await report(a, target);
    const id = (reports()[0] as { id: number }).id;
    expect((await app.admin('POST', `/api/admin/social/reports/${id}`, { action: 'obliterate' })).status).toBe(400);
    expect((await app.admin('POST', `/api/admin/social/reports/${id}`, {})).status).toBe(400);
    expect((await app.admin('POST', '/api/admin/social/reports/99999', { action: 'dismiss' })).status).toBe(404);
    expect((await app.admin('POST', '/api/admin/social/reports/abc', { action: 'dismiss' })).status).toBe(400);
    expect((await app.admin('POST', `/api/admin/social/reports/${id}`, { action: 'dismiss' }, null)).status).toBe(401);
    expect(await list()).toHaveLength(1);
  });

  it('keeps a report after its target is deleted, with the name blanked, until the sweep removes it', async () => {
    const [a, target] = await reporters(2) as [TestPlayer, TestPlayer];
    await report(a, target);
    await target.post('/api/social/me/delete', { confirm: 'delete' });
    const q = await list();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ targetName: '', sanctions: { mutedUntil: 0, publicBlockedUntil: 0, bannedUntil: 0 } });
  });

  it('stats are counts only', async () => {
    const [a, b, target] = await reporters(3) as [TestPlayer, TestPlayer, TestPlayer];
    await player('teen'); await player('child');
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    await report(a, target, 'sexual');
    const res = (await app.admin('GET', '/api/admin/social/stats')).body;
    expect(res.stats).toMatchObject({ profiles: 5, children: 1, teens: 1, adults: 3, friendships: 1, open_reports: 1, urgent_reports: 1, banned: 0, online: 0, lobbies: 0, pending_requests: 0 });
    expect(res).toMatchObject({ cap: STATS_COUNT_CAP, capped: false });
  });

  it('stats read a bounded number of rows and are limited to a few calls a day', async () => {
    await player('adult');
    for (let i = 0; i < LIMITS.adminStats.max; i++) expect((await app.admin('GET', '/api/admin/social/stats')).status).toBe(200);
    expect((await app.admin('GET', '/api/admin/social/stats')).status).toBe(429);
    // a table bigger than the cap is counted up to the cap, and the answer says so
    app.db.raw.exec(`WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${STATS_COUNT_CAP + 500})
      INSERT INTO soc_profiles (pid, fid, code, name, band, region, created_at, seen_day) SELECT 'p' || i, 'F' || i, 'C' || i, 'n', 'adult', 'eu', 0, 1 FROM s`);
    vi.setSystemTime(Date.now() + 2 * DAY);
    const big = (await app.admin('GET', '/api/admin/social/stats')).body;
    expect(big.stats.profiles).toBe(STATS_COUNT_CAP);
    expect(big.capped).toBe(true);
  });
});
