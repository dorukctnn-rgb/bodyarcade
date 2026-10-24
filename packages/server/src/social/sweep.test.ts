// The hourly tidy-up: what it removes, what it keeps, and that only one request an hour pays for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, DECLINE_COOLDOWN_MS, HOUR, REQUEST_TTL_MS } from '../../../core/social/rules.ts';
import { AUDIT_KEEP_MS, LOBBY_GONE_MS, ORPHAN_REPORT_KEEP_MS, RESOLVED_REPORT_KEEP_MS, UNUSED_PROFILE_DAYS, maybeSweep, resetSweepThrottle, sweep } from './sweep.ts';
import { createTestApp, type TestApp } from './testkit.ts';

let app: TestApp;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const count = (table: string) => (app.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('sweep', () => {
  it('removes what has run out and keeps what is current', async () => {
    const now = T0 + 500 * DAY;
    const run = (sql: string, ...p: unknown[]) => app.db.raw.prepare(sql).run(...(p as never[]));
    run('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)', 'old', now - 1);
    run('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)', 'new', now + HOUR);
    run('INSERT INTO soc_requests (from_pid, to_pid, at) VALUES (?, ?, ?)', 'a', 'b', now - REQUEST_TTL_MS - 1);
    run('INSERT INTO soc_requests (from_pid, to_pid, at) VALUES (?, ?, ?)', 'a', 'c', now - 1000);
    run('INSERT INTO soc_declines (from_pid, to_pid, at) VALUES (?, ?, ?)', 'a', 'b', now - DECLINE_COOLDOWN_MS - 1);
    run('INSERT INTO soc_declines (from_pid, to_pid, at) VALUES (?, ?, ?)', 'a', 'c', now - 1000);
    for (const [code, at] of [['OLD', now - LOBBY_GONE_MS - 1], ['NEW', now - 1000]] as const) {
      run("INSERT INTO soc_lobbies (code, kind, grp, region, game, band, size, players, open, names, pids, phase, created_at, updated_at) VALUES (?, 'public', 'adult', 'eu', 'jacks', NULL, 4, 1, 3, '[]', '[]', 'lobby', ?, ?)", code, at, at);
    }
    run('INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)', 'gone', now - 20 * 60_000, now);
    run('INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?, 1, ?, ?)', 'here', now - 1000, now);
    run("INSERT INTO soc_audit (at, actor, action) VALUES (?, 'x', 'y')", now - AUDIT_KEEP_MS - 1);
    run("INSERT INTO soc_audit (at, actor, action) VALUES (?, 'x', 'y')", now - 1000);
    const rep = (status: string, handledAt: number | null, at: number, target: string) =>
      run("INSERT INTO soc_reports (at, reporter, target, target_fid, target_name, target_band, reason, source, status, handled_at) VALUES (?, 'r', ?, 'f', 'n', 'adult', 'abuse', 'friend', ?, ?)", at, target, status, handledAt);
    app.db.raw.prepare("INSERT INTO soc_profiles (pid, fid, code, name, band, region, created_at, seen_day) VALUES ('live', 'LIVEFID234', 'LIV234', 'n', 'adult', 'eu', ?, ?)").run(now, Math.floor(now / DAY));
    rep('dismissed', now - RESOLVED_REPORT_KEEP_MS - 1, now - 200 * DAY, 'live');
    rep('dismissed', now - 1000, now - 2000, 'live');
    rep('open', null, now - ORPHAN_REPORT_KEEP_MS - 1, 'ghost');
    rep('open', null, now - 1000, 'ghost');
    rep('open', null, now - 200 * DAY, 'live');
    const r = await sweep(app.db, now);
    expect(r).toEqual({ limits: 1, requests: 1, declines: 1, lobbies: 1, presence: 1, reports: 2, audit: 1, profiles: 0 });
    expect(count('soc_limits')).toBe(1);
    expect(count('soc_requests')).toBe(1);
    expect(count('soc_declines')).toBe(1);
    expect(count('soc_lobbies')).toBe(1);
    expect(count('soc_reports')).toBe(3);
    expect(count('soc_audit')).toBe(1);
    expect((app.db.raw.prepare("SELECT online FROM soc_presence WHERE pid = 'gone'").get() as { online: number }).online).toBe(0);
    expect((app.db.raw.prepare("SELECT online FROM soc_presence WHERE pid = 'here'").get() as { online: number }).online).toBe(1);
  });

  it('retires profiles nobody has used for over a year, with everything that hangs on them', async () => {
    const a = await app.signup('adult');
    const b = await app.signup('adult');
    await a.post('/api/social/friends/request', { code: b.me.code });
    await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
    const now = T0 + (UNUSED_PROFILE_DAYS + 2) * DAY;
    app.db.raw.prepare('UPDATE soc_profiles SET seen_day = ? WHERE pid = ?').run(Math.floor(now / DAY), b.pid());
    const r = await sweep(app.db, now);
    expect(r.profiles).toBe(1);
    expect(count('soc_profiles')).toBe(1);
    expect(count('soc_devices')).toBe(1);
    expect(count('soc_friends')).toBe(0);
  });

  it('does a bounded amount of work: at most 25 profiles an hour', async () => {
    for (let i = 0; i < 30; i++) app.db.raw.prepare("INSERT INTO soc_profiles (pid, fid, code, name, band, region, created_at, seen_day) VALUES (?, ?, ?, 'n', 'adult', 'eu', 0, 1)").run(`p${i}`, `F${i}`, `C${i}`);
    expect((await sweep(app.db, T0)).profiles).toBe(25);
    expect(count('soc_profiles')).toBe(5);
  });
});

describe('who pays for it', () => {
  it('the first request of the hour in an isolate claims the sweep with one counter write; the others do nothing', async () => {
    const claims: Promise<unknown>[] = [];
    app.db.raw.prepare('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)').run('stale', T0 - 1);
    resetSweepThrottle();
    maybeSweep(app.db, T0, (p) => claims.push(p));
    maybeSweep(app.db, T0 + 1000, (p) => claims.push(p));
    maybeSweep(app.db, T0 + 9 * 60_000, (p) => claims.push(p));
    expect(claims).toHaveLength(1);
    await Promise.all(claims);
    expect(count('soc_limits')).toBe(2);                      // the hourly claim and the daily claim; the stale counter is gone
    // another isolate in the same hour finds the claim taken
    resetSweepThrottle();
    app.db.raw.prepare('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)').run('stale2', T0 - 1);
    const second: Promise<unknown>[] = [];
    maybeSweep(app.db, T0 + 20 * 60_000, (p) => second.push(p));
    await Promise.all(second);
    expect(count('soc_limits')).toBe(3);                      // the claim was taken: the second isolate swept nothing, stale2 is still there
    // and in the next hour it runs again
    resetSweepThrottle();
    const third: Promise<unknown>[] = [];
    maybeSweep(app.db, T0 + HOUR + 1000, (p) => third.push(p));
    await Promise.all(third);
    expect(app.db.raw.prepare("SELECT COUNT(*) AS n FROM soc_limits WHERE k LIKE 'stale%'").get()).toEqual({ n: 0 });
  });

  it('the daily part reads whole tables, so it runs on the first sweep of a day only; the hourly part runs every hour', async () => {
    const run = (sql: string, ...p: unknown[]) => app.db.raw.prepare(sql).run(...(p as never[]));
    const expired = (to: string) => run('INSERT INTO soc_requests (from_pid, to_pid, at) VALUES (?, ?, ?)', 'a', to, T0 - REQUEST_TTL_MS - 1);
    expired('b');
    run('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)', 'stale1', T0 - 1);
    resetSweepThrottle();
    const first: Promise<unknown>[] = [];
    maybeSweep(app.db, T0, (p) => first.push(p));
    await Promise.all(first);
    expect(count('soc_requests')).toBe(0);                    // the daily part ran
    expired('c');
    run('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)', 'stale2', T0 + HOUR - 1);
    resetSweepThrottle();
    const nextHour: Promise<unknown>[] = [];
    maybeSweep(app.db, T0 + HOUR + 1000, (p) => nextHour.push(p));
    await Promise.all(nextHour);
    expect(app.db.raw.prepare("SELECT COUNT(*) AS n FROM soc_limits WHERE k = 'stale2'").get()).toEqual({ n: 0 });   // the hourly part ran
    expect(count('soc_requests')).toBe(1);                    // the daily part did not
    resetSweepThrottle();
    const nextDay: Promise<unknown>[] = [];
    maybeSweep(app.db, T0 + 13 * HOUR, (p) => nextDay.push(p));
    await Promise.all(nextDay);
    expect(count('soc_requests')).toBe(0);                    // and does the next day
  });

  it('an ordinary request triggers it', async () => {
    app.db.raw.prepare('INSERT INTO soc_limits (k, n, exp) VALUES (?, 1, ?)').run('stale', T0 - 1);
    const p = await app.signup('adult');
    await p.get('/api/social/me');
    expect(app.db.raw.prepare("SELECT COUNT(*) AS n FROM soc_limits WHERE k = 'stale'").get()).toEqual({ n: 0 });
  });
});
