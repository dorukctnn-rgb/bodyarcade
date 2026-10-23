// The hourly tidy-up: expired counters, requests and declines, abandoned lobbies, stale presence, old reports and profiles
// nobody has used for over a year. One isolate does it each hour: the first request after the hour claims the job with a
// counter row (so a thousand players cost one extra write an hour, not a thousand).
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

export async function sweep(db: D1Like, now: number): Promise<SweepReport> {
  const limits = await sweepLimits(db, now);
  const requests = await run(db, 'DELETE FROM soc_requests WHERE at < ?1', now - REQUEST_TTL_MS);
  const declines = await run(db, 'DELETE FROM soc_declines WHERE at < ?1', now - DECLINE_COOLDOWN_MS);
  const lobbies = await run(db, 'DELETE FROM soc_lobbies WHERE updated_at < ?1', now - LOBBY_GONE_MS);
  const presence = await sweepPresence(db, now);
  const reports =
    (await run(db, "DELETE FROM soc_reports WHERE status != 'open' AND handled_at < ?1", now - RESOLVED_REPORT_KEEP_MS)) +
    (await run(db, 'DELETE FROM soc_reports WHERE at < ?1 AND target NOT IN (SELECT pid FROM soc_profiles)', now - ORPHAN_REPORT_KEEP_MS));
  const audit = await run(db, 'DELETE FROM soc_audit WHERE at < ?1', now - AUDIT_KEEP_MS);
  const idle = await rows<{ pid: string }>(db, 'SELECT pid FROM soc_profiles WHERE seen_day < ?1 LIMIT ?2', Math.floor(now / DAY) - UNUSED_PROFILE_DAYS, PROFILES_PER_SWEEP);
  for (const p of idle) await eraseProfile(db, p.pid);
  return { limits, requests, declines, lobbies, presence, reports, audit, profiles: idle.length };
}

let lastCheck = 0;

/** Runs the sweep when this isolate is the first to ask in the current hour. Never throws. */
export function maybeSweep(db: D1Like, now: number, wait: (p: Promise<unknown>) => void): void {
  if (now - lastCheck < 10 * 60_000) return;
  lastCheck = now;
  wait((async () => {
    const claim = await bump(db, 'sweep', { name: 'sw', max: 1, windowMs: HOUR }, now);
    if (claim === 1) await sweep(db, now);
  })());
}

/** Tests only. */
export function resetSweepThrottle(): void {
  lastCheck = 0;
}
