// Friends: the list (with presence), requests by code or link, accept and decline, cancel, remove, block and unblock.
//
// Nobody can be searched for. A request needs the other player's friend code or link; trying codes is limited per player
// (30 an hour, 8 misses an hour) so a code cannot be found by guessing. Everything that depends on the OTHER player (they
// blocked you, they are under 18 and you are an adult, they declined you lately, their inbox is full) is answered "sent"
// and dropped (core/social/rules.ts decideRequest), so a request is never a way to learn something about a stranger.
import { parseFriendCode, parseFriendLink, isFid } from '../../../core/social/codes.ts';
import { policyFor } from '../../../core/social/age.ts';
import {
  DECLINE_COOLDOWN_MS, LIMITS, MAX_BLOCKS, REQUEST_TTL_MS, decideAccept, decideRequest, requestsPerDay, retryAfterMs,
  type RequestFacts,
} from '../../../core/social/rules.ts';
import type { BlockEntry, FriendEntry, IncomingRequest, OutgoingRequest, RequestResult, RequestVia } from '../../../core/social/types.ts';
import { HttpError } from '../http.ts';
import { one, rows, stmt } from './db.ts';
import { bump, bumpStmt, enforce, guard, used } from './limits.ts';
import { blockPlayer, byCode, byFid, unlinkStmts, areFriends, type Person } from './people.ts';
import { PRESENCE_JOIN, PRESENCE_SELECT, hubSend, viewOf, type PresenceCols } from './presence.ts';
import type { SocialHandler } from './util.ts';

function needFid(v: unknown): string {
  if (!isFid(v)) throw new HttpError(400, 'bad_request', { field: 'fid' });
  return v;
}

async function needPerson(c: Parameters<SocialHandler>[0], v: unknown): Promise<Person> {
  const p = await byFid(c.db, needFid(v));
  if (!p) throw new HttpError(404, 'not_found');
  return p;
}

// ───────── lists ─────────

/** GET /api/social/friends: friends with what they are doing right now. */
export const listFriends: SocialHandler = async (c) => {
  const r = await rows<PresenceCols & { fid: string; name: string; band: FriendEntry['band']; dnd: number; since: number }>(
    c.db,
    `SELECT p.fid, p.name, p.band, p.dnd, f.since, ${PRESENCE_SELECT}
     FROM soc_friends f JOIN soc_profiles p ON p.pid = f.friend ${PRESENCE_JOIN}
     WHERE f.pid = ?1 ORDER BY p.name COLLATE NOCASE, p.fid`,
    c.me.pid,
  );
  const friends: FriendEntry[] = r.map((x) => ({ fid: x.fid, name: x.name, band: x.band, since: x.since, presence: viewOf(x, x.dnd === 1, c.now) }));
  return { friends };
};

/** GET /api/social/requests: waiting for the player, and sent by the player. */
export const listRequests: SocialHandler = async (c) => {
  const since = c.now - REQUEST_TTL_MS;
  const incoming = await rows<IncomingRequest>(
    c.db,
    'SELECT p.fid, p.name, r.at, r.via FROM soc_requests r JOIN soc_profiles p ON p.pid = r.from_pid WHERE r.to_pid = ?1 AND r.at > ?2 AND p.banned_until <= ?3 ORDER BY r.at DESC',
    c.me.pid, since, c.now,
  );
  const outgoing = await rows<OutgoingRequest>(
    c.db,
    'SELECT p.fid, p.name, r.at FROM soc_requests r JOIN soc_profiles p ON p.pid = r.to_pid WHERE r.from_pid = ?1 AND r.at > ?2 ORDER BY r.at DESC',
    c.me.pid, since,
  );
  return { incoming, outgoing };
};

// ───────── sending a request ─────────

interface FactsRow {
  from_friends: number; from_outgoing: number; to_friends: number; to_incoming: number;
  already_friends: number; from_blocked_to: number; to_blocked_from: number; declined_recently: number;
  already_requested: number; reverse_request: number;
}

const DECISION_STATUS: Record<string, number> = { self: 400, already_friends: 409, you_blocked: 409, friends_full: 409, requests_full: 409, rate_limited: 429 };

/**
 * POST /api/social/friends/request {code | link, via?}. Answers `{status: 'sent'}` or, when the other player had already
 * asked this one, `{status: 'friends', friend}`.
 */
export const sendRequest: SocialHandler = async (c) => {
  const { me, db, now, body: b } = c;
  const chars = typeof b.link === 'string' ? parseFriendLink(b.link) : typeof b.code === 'string' ? parseFriendCode(b.code) : null;
  if (!chars) throw new HttpError(400, 'bad_request', { field: typeof b.link === 'string' ? 'link' : 'code' });
  const via: RequestVia = typeof b.link === 'string' || b.via === 'link' ? 'link' : 'code';

  await guard(db, me.pid, LIMITS.lookupMiss, now, 'too_many_attempts');
  await enforce(db, me.pid, LIMITS.lookup, now);
  const target = await byCode(db, chars);
  if (!target) {
    await bump(db, me.pid, LIMITS.lookupMiss, now);
    throw new HttpError(404, 'not_found');
  }

  const sentSpec = requestsPerDay(me.band);
  const sentToday = await used(db, me.pid, sentSpec, now);
  const since = now - REQUEST_TTL_MS;
  const f = await one<FactsRow>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM soc_friends WHERE pid = ?1) AS from_friends,
       (SELECT COUNT(*) FROM soc_requests WHERE from_pid = ?1 AND at > ?3) AS from_outgoing,
       (SELECT COUNT(*) FROM soc_friends WHERE pid = ?2) AS to_friends,
       (SELECT COUNT(*) FROM soc_requests WHERE to_pid = ?2 AND at > ?3) AS to_incoming,
       EXISTS(SELECT 1 FROM soc_friends WHERE pid = ?1 AND friend = ?2) AS already_friends,
       EXISTS(SELECT 1 FROM soc_blocks WHERE pid = ?1 AND target = ?2) AS from_blocked_to,
       EXISTS(SELECT 1 FROM soc_blocks WHERE pid = ?2 AND target = ?1) AS to_blocked_from,
       EXISTS(SELECT 1 FROM soc_declines WHERE from_pid = ?1 AND to_pid = ?2 AND at > ?4) AS declined_recently,
       EXISTS(SELECT 1 FROM soc_requests WHERE from_pid = ?1 AND to_pid = ?2 AND at > ?3) AS already_requested,
       EXISTS(SELECT 1 FROM soc_requests WHERE from_pid = ?2 AND to_pid = ?1 AND at > ?3) AS reverse_request`,
    me.pid, target.pid, since, now - DECLINE_COOLDOWN_MS,
  );
  if (!f) throw new HttpError(503, 'unavailable');
  const facts: RequestFacts = {
    from: { band: me.band, friends: f.from_friends, outgoing: f.from_outgoing, sentToday },
    to: { band: target.band, friends: f.to_friends, incoming: f.to_incoming },
    relation: {
      self: target.pid === me.pid,
      alreadyFriends: f.already_friends === 1,
      fromBlockedTo: f.from_blocked_to === 1,
      toBlockedFrom: f.to_blocked_from === 1,
      declinedRecently: f.declined_recently === 1,
      alreadyRequested: f.already_requested === 1,
      reverseRequest: f.reverse_request === 1,
    },
  };
  // A banned player cannot be reached: the request goes nowhere, like any other request that cannot be delivered.
  const decision = target.bannedUntil > now ? ({ kind: 'silent' } as const) : decideRequest(facts);

  switch (decision.kind) {
    case 'error':
      throw new HttpError(DECISION_STATUS[decision.code] ?? 400, decision.code, decision.code === 'rate_limited' ? { retryAfterMs: retryAfterMs(sentSpec, now) } : undefined);
    case 'noop':
      return { status: 'sent' } satisfies RequestResult;
    case 'silent':
      await bump(db, me.pid, sentSpec, now);
      return { status: 'sent' } satisfies RequestResult;
    case 'create':
      await db.batch([
        stmt(db, 'INSERT INTO soc_requests (from_pid, to_pid, at, via) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(from_pid, to_pid) DO UPDATE SET at = ?3, via = ?4', me.pid, target.pid, now, via),
        bumpStmt(db, me.pid, sentSpec, now),
      ]);
      c.wait(hubSend(c.env, target.pid, { t: 'friend_request', from: { fid: me.fid, name: me.name }, at: now, via }));
      return { status: 'sent' } satisfies RequestResult;
    case 'befriend':
      await db.batch([
        stmt(db, 'DELETE FROM soc_requests WHERE (from_pid = ?1 AND to_pid = ?2) OR (from_pid = ?2 AND to_pid = ?1)', me.pid, target.pid),
        stmt(db, 'DELETE FROM soc_declines WHERE (from_pid = ?1 AND to_pid = ?2) OR (from_pid = ?2 AND to_pid = ?1)', me.pid, target.pid),
        stmt(db, 'INSERT OR IGNORE INTO soc_friends (pid, friend, since) VALUES (?1, ?2, ?3)', me.pid, target.pid, now),
        stmt(db, 'INSERT OR IGNORE INTO soc_friends (pid, friend, since) VALUES (?2, ?1, ?3)', me.pid, target.pid, now),
      ]);
      c.wait(hubSend(c.env, target.pid, { t: 'friend_added', friend: { fid: me.fid, name: me.name, band: me.band } }));
      return { status: 'friends', friend: { fid: target.fid, name: target.name, band: target.band } } satisfies RequestResult;
  }
};

// ───────── answering, cancelling, removing ─────────

/** POST /api/social/friends/respond {fid, accept}. */
export const respond: SocialHandler = async (c) => {
  const { me, db, now, body: b } = c;
  const fid = needFid(b.fid);
  if (typeof b.accept !== 'boolean') throw new HttpError(400, 'bad_request', { field: 'accept' });
  const from = await one<{ pid: string; fid: string; name: string; band: Person['band']; at: number }>(
    db,
    `SELECT p.pid, p.fid, p.name, p.band, r.at FROM soc_requests r JOIN soc_profiles p ON p.pid = r.from_pid
     WHERE r.to_pid = ?1 AND p.fid = ?2 AND r.at > ?3`,
    me.pid, fid, now - REQUEST_TTL_MS,
  );
  if (!from) throw new HttpError(404, 'not_found');

  if (!b.accept) {
    await db.batch([
      stmt(db, 'DELETE FROM soc_requests WHERE from_pid = ?1 AND to_pid = ?2', from.pid, me.pid),
      stmt(db, 'INSERT INTO soc_declines (from_pid, to_pid, at) VALUES (?1, ?2, ?3) ON CONFLICT(from_pid, to_pid) DO UPDATE SET at = ?3', from.pid, me.pid, now),
    ]);
    return { status: 'declined' };
  }

  const counts = await one<{ mine: number; theirs: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM soc_friends WHERE pid = ?1) AS mine, (SELECT COUNT(*) FROM soc_friends WHERE pid = ?2) AS theirs',
    me.pid, from.pid,
  );
  const verdict = decideAccept({ band: me.band, friends: counts?.mine ?? 0 }, { band: from.band, friends: counts?.theirs ?? 0 });
  if (verdict.kind === 'error') throw new HttpError(409, verdict.code, { who: verdict.who });
  await db.batch([
    stmt(db, 'DELETE FROM soc_requests WHERE (from_pid = ?1 AND to_pid = ?2) OR (from_pid = ?2 AND to_pid = ?1)', from.pid, me.pid),
    stmt(db, 'DELETE FROM soc_declines WHERE (from_pid = ?1 AND to_pid = ?2) OR (from_pid = ?2 AND to_pid = ?1)', from.pid, me.pid),
    stmt(db, 'INSERT OR IGNORE INTO soc_friends (pid, friend, since) VALUES (?1, ?2, ?3)', me.pid, from.pid, now),
    stmt(db, 'INSERT OR IGNORE INTO soc_friends (pid, friend, since) VALUES (?2, ?1, ?3)', me.pid, from.pid, now),
  ]);
  c.wait(hubSend(c.env, from.pid, { t: 'friend_added', friend: { fid: me.fid, name: me.name, band: me.band } }));
  return { status: 'friends', friend: { fid: from.fid, name: from.name, band: from.band } };
};

/** POST /api/social/friends/cancel {fid}: withdraw a request the player sent. */
export const cancel: SocialHandler = async (c) => {
  const target = await needPerson(c, c.body.fid);
  const r = await one<{ at: number }>(c.db, 'SELECT at FROM soc_requests WHERE from_pid = ?1 AND to_pid = ?2', c.me.pid, target.pid);
  if (!r) throw new HttpError(404, 'not_found');
  await stmt(c.db, 'DELETE FROM soc_requests WHERE from_pid = ?1 AND to_pid = ?2', c.me.pid, target.pid).run();
  c.wait(hubSend(c.env, target.pid, { t: 'request_cancelled', fid: c.me.fid }));
  return { status: 'cancelled' };
};

/** POST /api/social/friends/remove {fid}. */
export const removeFriend: SocialHandler = async (c) => {
  const target = await needPerson(c, c.body.fid);
  if (!(await areFriends(c.db, c.me.pid, target.pid))) throw new HttpError(404, 'not_friends');
  await c.db.batch(unlinkStmts(c.db, c.me.pid, target.pid));
  c.wait(hubSend(c.env, target.pid, { t: 'friend_removed', fid: c.me.fid }));
  return { status: 'removed' };
};

// ───────── blocks ─────────

/** GET /api/social/blocks. */
export const listBlocks: SocialHandler = async (c) => {
  const blocks = await rows<BlockEntry>(c.db, 'SELECT p.fid, p.name, b.at FROM soc_blocks b JOIN soc_profiles p ON p.pid = b.target WHERE b.pid = ?1 ORDER BY b.at DESC', c.me.pid);
  return { blocks };
};

/**
 * POST /api/social/blocks {fid}. The player ends any friendship and request with the target at once, and the two never meet
 * in a public lobby or a quick match again. The target is not told (the friendship just ends, as when it is removed).
 */
export const addBlock: SocialHandler = async (c) => {
  const target = await needPerson(c, c.body.fid);
  if (target.pid === c.me.pid) throw new HttpError(400, 'self');
  const already = await one(c.db, 'SELECT 1 AS x FROM soc_blocks WHERE pid = ?1 AND target = ?2', c.me.pid, target.pid);
  if (!already) {
    const n = await one<{ n: number }>(c.db, 'SELECT COUNT(*) AS n FROM soc_blocks WHERE pid = ?1', c.me.pid);
    if ((n?.n ?? 0) >= MAX_BLOCKS) throw new HttpError(409, 'blocks_full');
  }
  const { wasFriends } = await blockPlayer(c.db, c.me.pid, target.pid, c.now);
  if (wasFriends) c.wait(hubSend(c.env, target.pid, { t: 'friend_removed', fid: c.me.fid }));
  return { status: 'blocked' };
};

/** POST /api/social/blocks/remove {fid}. Does not bring the friendship back. */
export const removeBlock: SocialHandler = async (c) => {
  const target = await needPerson(c, c.body.fid);
  await stmt(c.db, 'DELETE FROM soc_blocks WHERE pid = ?1 AND target = ?2', c.me.pid, target.pid).run();
  return { status: 'unblocked' };
};

/** How many friends the band allows (the interface shows "12 of 25"). */
export const friendLimit = (band: Person['band']): number => policyFor(band).maxFriends;
