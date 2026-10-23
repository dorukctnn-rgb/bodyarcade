// Moderation: the report queue, the automatic steps that protect other players while a person has not looked yet, the
// moderator API and the audit trail.
//
// A report comes from a friend list (POST /api/social/report) or from a Room (the submitReport hook, with the last chat
// lines the Room saw as evidence). Every report goes to the queue. On top of that, three different players reporting one
// player within 24 hours silence the player's free text for 24 hours; six within a week, or two for a serious reason
// (sexual content, a child) within a day, close public lobbies for three days. Reporters count only when their profile is
// at least an hour old, so a script that makes accounts cannot silence a player. A moderator ends or extends any of it.
import { policyFor } from '../../../core/social/age.ts';
import { DAY, HOUR, LIMITS, MOD, escalate, isUrgentReason, type Escalation } from '../../../core/social/rules.ts';
import { isFid } from '../../../core/social/codes.ts';
import { REPORT_REASONS, type ReportReason } from '../../../core/social/types.ts';
import { HttpError } from '../http.ts';
import { one, rows, stmt } from './db.ts';
import type { D1Like } from './db.ts';
import { used, bump } from './limits.ts';
import { blockPlayer, byFid, byPid } from './people.ts';
import { hubClose, hubSend } from './presence.ts';
import { open, sha256Bytes, type Ctx, type SocialHandler } from './util.ts';
import type { SocialEnv } from './env.ts';

/** A reporter's profile must be at least this old for the report to count towards the automatic steps. */
export const REPORTER_MIN_AGE_MS = HOUR;

export interface ReportInput {
  reporter: string;
  target: string;
  reason: ReportReason;
  source: 'friend' | 'room';
  room?: string | null;
  matchId?: string | null;
  note?: string | null;
  /** Chat lines the Room saw (at most MOD.evidenceLines are kept). */
  evidence?: readonly { seat?: string; name?: string; text?: string; at?: number }[] | null;
  at: number;
}

export interface ReportOutcome {
  /** 'filed', or 'duplicate' (same reporter, target and reason within a day) or 'unknown_target'. */
  status: 'filed' | 'duplicate' | 'unknown_target';
  id?: number;
  escalation?: Escalation;
}

export const isReason = (x: unknown): x is ReportReason => typeof x === 'string' && (REPORT_REASONS as readonly string[]).includes(x);

/** Strips control characters and cuts to `max` characters; null when nothing is left. */
export function cleanNote(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return t === '' ? null : [...t].slice(0, max).join('');
}

/** Puts a report in the queue and applies the automatic steps. */
export async function fileReport(db: D1Like, r: ReportInput): Promise<ReportOutcome> {
  const target = await byPid(db, r.target);
  if (!target) return { status: 'unknown_target' };
  const dup = await one(db, 'SELECT 1 AS x FROM soc_reports WHERE reporter = ?1 AND target = ?2 AND reason = ?3 AND at > ?4', r.reporter, r.target, r.reason, r.at - DAY);
  if (dup) return { status: 'duplicate' };
  const evidence = r.evidence && r.evidence.length > 0
    ? JSON.stringify(r.evidence.slice(-MOD.evidenceLines).map((l) => ({ seat: l.seat, name: l.name, text: typeof l.text === 'string' ? l.text.slice(0, 400) : '', at: l.at })))
    : null;
  const urgent = isUrgentReason(r.reason) ? 1 : 0;
  const ins = await one<{ id: number }>(
    db,
    `INSERT INTO soc_reports (at, reporter, target, target_fid, target_name, target_band, reason, source, room, match_id, note, evidence, urgent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
    r.at, r.reporter, r.target, target.fid, target.name, target.band, r.reason, r.source, r.room ?? null, r.matchId ?? null, r.note ?? null, evidence, urgent,
  );
  const id = ins?.id;

  const f = await one<{ r24: number; r7: number; u24: number }>(
    db,
    `SELECT
       (SELECT COUNT(DISTINCT r.reporter) FROM soc_reports r JOIN soc_profiles rp ON rp.pid = r.reporter
         WHERE r.target = ?1 AND r.at > ?2 AND rp.created_at <= r.at - ?4) AS r24,
       (SELECT COUNT(DISTINCT r.reporter) FROM soc_reports r JOIN soc_profiles rp ON rp.pid = r.reporter
         WHERE r.target = ?1 AND r.at > ?3 AND rp.created_at <= r.at - ?4) AS r7,
       (SELECT COUNT(DISTINCT r.reporter) FROM soc_reports r JOIN soc_profiles rp ON rp.pid = r.reporter
         WHERE r.target = ?1 AND r.at > ?2 AND r.reason IN ('sexual', 'underage') AND rp.created_at <= r.at - ?4) AS u24`,
    r.target, r.at - DAY, r.at - 7 * DAY, REPORTER_MIN_AGE_MS,
  );
  const esc = escalate({ reporters24h: f?.r24 ?? 0, reporters7d: f?.r7 ?? 0, urgentReporters24h: f?.u24 ?? 0 });
  const stmts = [];
  if (esc.muteMs > 0 || esc.suspendMs > 0) {
    stmts.push(stmt(db, 'UPDATE soc_profiles SET muted_until = MAX(muted_until, ?2), public_blocked_until = MAX(public_blocked_until, ?3) WHERE pid = ?1',
      r.target, esc.muteMs > 0 ? r.at + esc.muteMs : 0, esc.suspendMs > 0 ? r.at + esc.suspendMs : 0));
    stmts.push(stmt(db, "INSERT INTO soc_audit (at, actor, action, target, detail) VALUES (?1, 'auto', ?2, ?3, ?4)",
      r.at, esc.suspendMs > 0 ? 'suspend_public' : 'mute_text', r.target, JSON.stringify({ report: id, reporters24h: f?.r24 ?? 0, reporters7d: f?.r7 ?? 0, urgent24h: f?.u24 ?? 0 })));
  }
  if (esc.urgent && !urgent && id !== undefined) stmts.push(stmt(db, 'UPDATE soc_reports SET urgent = 1 WHERE id = ?1', id));
  if (stmts.length > 0) await db.batch(stmts);
  return id === undefined ? { status: 'filed', escalation: esc } : { status: 'filed', id, escalation: esc };
}

// ───────── a player reports a friend or a request sender ─────────

/** POST /api/social/report {fid, reason, note?, block?}. Under-18 players pick a reason only; a typed note is an adult's. */
export const report: SocialHandler = async (c) => {
  const { me, db, now, body: b } = c;
  if (!isFid(b.fid)) throw new HttpError(400, 'bad_request', { field: 'fid' });
  if (!isReason(b.reason)) throw new HttpError(400, 'bad_request', { field: 'reason' });
  const target = await byFid(db, b.fid);
  if (!target) throw new HttpError(404, 'not_found');
  if (target.pid === me.pid) throw new HttpError(400, 'self');
  if ((await used(db, me.pid, LIMITS.report, now)) >= LIMITS.report.max) throw new HttpError(429, 'rate_limited', { retryAfterMs: DAY - (now % DAY) });
  await bump(db, me.pid, LIMITS.report, now);
  const note = policyFor(me.band).freeText ? cleanNote(b.note, MOD.noteMaxChars) : null;
  const out = await fileReport(db, { reporter: me.pid, target: target.pid, reason: b.reason, source: 'friend', note, at: now });
  let blocked = false;
  if (b.block === true) {
    const { wasFriends } = await blockPlayer(db, me.pid, target.pid, now);
    blocked = true;
    if (wasFriends) c.wait(hubSend(c.env, target.pid, { t: 'friend_removed', fid: me.fid }));
  }
  // A repeated report is answered like a new one: the reporter learns nothing about the queue.
  void out;
  return { status: 'filed', blocked };
};

// ───────── moderator API ─────────

/** True for a request that carries the moderator token. Without a configured token the API does not exist (404). */
async function adminCheck(env: SocialEnv, req: Request): Promise<void> {
  const token = env.ADMIN_TOKEN;
  if (typeof token !== 'string' || token.length < 16) throw new HttpError(404, 'not_found');
  const h = req.headers.get('Authorization') ?? '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [a, b] = await Promise.all([sha256Bytes(given), sha256Bytes(token)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) throw new HttpError(401, 'unauthorized');
}

interface ReportRow {
  id: number; at: number; reporter_fid: string | null; target_fid: string; target_name: string; target_band: string; reason: string;
  source: string; room: string | null; match_id: string | null; note: string | null; evidence: string | null; urgent: number; status: string;
  handled_at: number | null; handled_action: string | null; muted_until: number | null; public_blocked_until: number | null;
  banned_until: number | null; against: number;
}

function reportView(r: ReportRow): Record<string, unknown> {
  let evidence: unknown = null;
  try { evidence = r.evidence ? JSON.parse(r.evidence) : null; } catch { evidence = null; }
  return {
    id: r.id, at: r.at, reporterFid: r.reporter_fid, targetFid: r.target_fid, targetName: r.target_name, targetBand: r.target_band,
    reason: r.reason, source: r.source, room: r.room, matchId: r.match_id, note: r.note, evidence, urgent: r.urgent === 1,
    status: r.status, handledAt: r.handled_at, handledAction: r.handled_action, reportsAgainstTarget: r.against,
    sanctions: { mutedUntil: r.muted_until ?? 0, publicBlockedUntil: r.public_blocked_until ?? 0, bannedUntil: r.banned_until ?? 0 },
  };
}

const REPORT_SELECT = `SELECT r.id, r.at, rp.fid AS reporter_fid, r.target_fid, r.target_name, r.target_band, r.reason, r.source, r.room, r.match_id,
  r.note, r.evidence, r.urgent, r.status, r.handled_at, r.handled_action, tp.muted_until, tp.public_blocked_until, tp.banned_until,
  (SELECT COUNT(*) FROM soc_reports x WHERE x.target = r.target) AS against
  FROM soc_reports r LEFT JOIN soc_profiles rp ON rp.pid = r.reporter LEFT JOIN soc_profiles tp ON tp.pid = r.target`;

/** GET /api/admin/social/reports?status=open&limit=50: the queue, serious reports first, then the oldest. */
export const adminReports = open(async (c: Omit<Ctx, 'me'>) => {
  await adminCheck(c.env, c.req);
  const status = c.url.searchParams.get('status') ?? 'open';
  if (!['open', 'dismissed', 'actioned'].includes(status)) throw new HttpError(400, 'bad_request', { field: 'status' });
  const limit = Math.min(200, Math.max(1, Number(c.url.searchParams.get('limit') ?? 50) || 50));
  const list = await rows<ReportRow>(c.db, `${REPORT_SELECT} WHERE r.status = ?1 ORDER BY r.urgent DESC, r.at ASC LIMIT ?2`, status, limit);
  return { reports: list.map(reportView) };
});

export const ADMIN_ACTIONS = ['dismiss', 'warn', 'mute', 'suspend', 'ban', 'clear'] as const;
export type AdminAction = typeof ADMIN_ACTIONS[number];

/** POST /api/admin/social/reports/:id {action, days?, note?}. */
export const adminAct = open(async (c: Omit<Ctx, 'me'>) => {
  await adminCheck(c.env, c.req);
  const id = Number(c.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'bad_request', { field: 'id' });
  const action = c.body.action;
  if (typeof action !== 'string' || !(ADMIN_ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, 'bad_request', { field: 'action' });
  const rep = await one<{ id: number; target: string; status: string }>(c.db, 'SELECT id, target, status FROM soc_reports WHERE id = ?1', id);
  if (!rep) throw new HttpError(404, 'not_found');
  const daysRaw = c.body.days;
  const fallback = action === 'ban' ? 3650 : 7;
  const days = typeof daysRaw === 'number' && Number.isFinite(daysRaw) ? Math.min(3650, Math.max(1, Math.floor(daysRaw))) : fallback;
  const until = c.now + days * DAY;
  const note = cleanNote(c.body.note, 300);
  const a = action as AdminAction;
  const writes = [];
  switch (a) {
    case 'mute': writes.push(stmt(c.db, 'UPDATE soc_profiles SET muted_until = ?2 WHERE pid = ?1', rep.target, until)); break;
    case 'suspend': writes.push(stmt(c.db, 'UPDATE soc_profiles SET public_blocked_until = ?2 WHERE pid = ?1', rep.target, until)); break;
    case 'ban': writes.push(stmt(c.db, 'UPDATE soc_profiles SET banned_until = ?2 WHERE pid = ?1', rep.target, until)); break;
    case 'clear': writes.push(stmt(c.db, 'UPDATE soc_profiles SET muted_until = 0, public_blocked_until = 0, banned_until = 0 WHERE pid = ?1', rep.target)); break;
    default: break;
  }
  const sanction = a === 'mute' || a === 'suspend' || a === 'ban';
  const state = a === 'dismiss' || a === 'clear' ? 'dismissed' : 'actioned';
  // A sanction settles every open report against the same player; the other answers settle only the one in front of the moderator.
  writes.push(sanction
    ? stmt(c.db, "UPDATE soc_reports SET status = ?2, handled_at = ?3, handled_action = ?4 WHERE target = ?1 AND status = 'open'", rep.target, state, c.now, a)
    : stmt(c.db, 'UPDATE soc_reports SET status = ?2, handled_at = ?3, handled_action = ?4 WHERE id = ?1', id, state, c.now, a));
  writes.push(stmt(c.db, "INSERT INTO soc_audit (at, actor, action, target, detail) VALUES (?1, 'admin', ?2, ?3, ?4)", c.now, a, rep.target, JSON.stringify({ report: id, days: sanction ? days : undefined, note })));
  await c.db.batch(writes);
  if (a === 'ban') c.wait(hubClose(c.env, rep.target, 'banned'));
  const row = await one<ReportRow>(c.db, `${REPORT_SELECT} WHERE r.id = ?1`, id);
  return { ok: true, report: row ? reportView(row) : null };
});

/** GET /api/admin/social/stats: counts for the operator (no personal data). */
export const adminStats = open(async (c: Omit<Ctx, 'me'>) => {
  await adminCheck(c.env, c.req);
  const s = await one<Record<string, number>>(
    c.db,
    `SELECT
       (SELECT COUNT(*) FROM soc_profiles) AS profiles,
       (SELECT COUNT(*) FROM soc_profiles WHERE band = 'child') AS children,
       (SELECT COUNT(*) FROM soc_profiles WHERE band = 'teen') AS teens,
       (SELECT COUNT(*) FROM soc_profiles WHERE band = 'adult') AS adults,
       (SELECT COUNT(*) FROM soc_presence WHERE online = 1 AND seen_at > ?1) AS online,
       (SELECT COUNT(*) FROM soc_friends) / 2 AS friendships,
       (SELECT COUNT(*) FROM soc_requests) AS pending_requests,
       (SELECT COUNT(*) FROM soc_lobbies) AS lobbies,
       (SELECT COUNT(*) FROM soc_reports WHERE status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM soc_reports WHERE status = 'open' AND urgent = 1) AS urgent_reports,
       (SELECT COUNT(*) FROM soc_profiles WHERE banned_until > ?2) AS banned`,
    c.now - 9 * 60_000, c.now,
  );
  return { stats: s ?? {} };
});

