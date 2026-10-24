// The tidy-up of expired counters, requests and declines, abandoned lobbies, stale presence, old reports and profiles nobody
// has used for over a year. One isolate does it: the first request after the hour claims the job with a counter row (so a
// thousand players cost one extra write an hour, not a thousand).
//
// Two cadences, because of the free plan's 5,000,000 rows read a day: the hourly part only touches tables that have an index
// on what it looks for (counters, the audit trail) or are tiny by design (lobbies: one row per live room); the daily part
// reads whole tables (requests, declines, presence, reports, profiles) and so runs once a day, never hourly. With 50,000
// profiles that is about 150,000 rows read a day, 3 percent of the allowance.
import { DAY, DECLINE_COOLDOWN_MS, HOUR, REQUEST_TTL_MS } from '../../../core/social/rules.ts';
import { run, rows, type D1Like } from './db.ts';
import { bump, sweepLimits } from './limits.ts';
import { eraseProfile } from './people.ts';
import { sweepPresence } from './presence.ts';

/** Lobby rows the Room stopped reporting are dropped after this long (listings already hide them after 15 minutes). */
export const LOBBY_GONE_MS = 6 * HOUR;
export const RESOLVED_REPORT_KEEP_MS = 90 * DAY;
export const ORPHAN_REPORT_KEEP_MS = 30 * DAY;
export const AUDIT_KEEP_MS = 365 * DAY;
export const UNUSED_PROFILE_DAYS = 400;
const PROFILES_PER_SWEEP = 25;

export interface SweepReport {
  limits: number; requests: number; declines: number; lobbies: number; presence: number; reports: number; audit: number; profiles: number;
}

/** The cheap part (index-backed or tiny tables): runs every hour. */
export async function sweepHourly(db: D1Like, now: number): Promise<Pick<SweepReport, 'limits' | 'lobbies' | 'audit'>> {
  const limits = await sweepLimits(db, now);
  const lobbies = await run(db, 'DELETE FROM soc_lobbies WHERE updated_at < ?1', now - LOBBY_GONE_MS);
  const audit = await run(db, 'DELETE FROM soc_audit WHERE at < ?1', now - AUDIT_KEEP_MS);
  return { limits, lobbies, audit };
}

/** The part that reads whole tables: runs once a day. */
export async function sweepDaily(db: D1Like, now: number): Promise<Pick<SweepReport, 'requests' | 'declines' | 'presence' | 'reports' | 'profiles'>> {
  const requests = await run(db, 'DELETE FROM soc_requests WHERE at < ?1', now - REQUEST_TTL_MS);
  const declines = await run(db, 'DELETE FROM soc_declines WHERE at < ?1', now - DECLINE_COOLDOWN_MS);
  const presence = await sweepPresence(db, now);
  const reports =
    (await run(db, "DELETE FROM soc_reports WHERE status != 'open' AND handled_at < ?1", now - RESOLVED_REPORT_KEEP_MS)) +
    (await run(db, 'DELETE FROM soc_reports WHERE at < ?1 AND target NOT IN (SELECT pid FROM soc_profiles)', now - ORPHAN_REPORT_KEEP_MS));
  const idle = await rows<{ pid: string }>(db, 'SELECT pid FROM soc_profiles WHERE seen_day < ?1 LIMIT ?2', Math.floor(now / DAY) - UNUSED_PROFILE_DAYS, PROFILES_PER_SWEEP);
  for (const p of idle) await eraseProfile(db, p.pid);
  return { requests, declines, presence, reports, profiles: idle.length };
}

/** Both parts (tests and tools; the Worker runs them on their own cadences). */
export async function sweep(db: D1Like, now: number): Promise<SweepReport> {
  return { ...(await sweepHourly(db, now)), ...(await sweepDaily(db, now)) };
}

let lastCheck = 0;

/** Runs the hourly sweep when this isolate is the first to ask in the current hour, and the daily one on the first hour of a day. Never throws. */
export function maybeSweep(db: D1Like, now: number, wait: (p: Promise<unknown>) => void): void {
  if (now - lastCheck < 10 * 60_000) return;
  lastCheck = now;
  wait((async () => {
    const claim = await bump(db, 'sweep', { name: 'sw', max: 1, windowMs: HOUR }, now);
    if (claim !== 1) return;
    await sweepHourly(db, now);
    if ((await bump(db, 'sweep', { name: 'sd', max: 1, windowMs: DAY }, now)) === 1) await sweepDaily(db, now);
  })());
}

/** Tests only. */
export function resetSweepThrottle(): void {
  lastCheck = 0;
}
