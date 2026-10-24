// Presence: who is online, in a room or playing, as friends may see it, and how a change reaches the friends who are online.
//
//   soc_presence.online      set by the registry (hub.ts) when a socket opens, cleared when the last one closes (or by the sweep after the TTL)
//   soc_presence.c_*         what the CLIENT said about solo play ('online' or 'playing' plus a game id)
//   soc_presence.room, r_*   what the ROOM said (the Room's setPlaying hook): authoritative, a client cannot claim a room
//
// A change costs one write and, for each online friend (at most 30), one push to that friend's socket (the directory holds the
// sockets, so a push is a local send). A heartbeat is one write every four minutes. Everything here is best effort: a failed
// push is logged and forgotten, the friend's list is read from the tables the next time the page asks.
import { PRESENCE, viewPresence, type PresenceRow } from '../../../core/social/rules.ts';
import type { FriendPresence, HubEvent, PresenceStatus } from '../../../core/social/types.ts';
import { one, rows, run, type SqlLike } from './db.ts';
import type { SocialEnv } from './env.ts';

/** The presence columns as the tables return them (joined next to a profile in several queries). */
export interface PresenceCols {
  online: number | null;
  seen_at: number | null;
  c_status: string | null;
  c_game: string | null;
  room: string | null;
  r_state: string | null;
  r_game: string | null;
  /** 1 when the room named in `room` is in its lobby phase with a free seat (from soc_lobbies). */
  joinable: number | null;
}

/** Columns to select next to `soc_presence pr` and `soc_lobbies l` (LEFT JOINs on pr.pid and l.code = pr.room). */
export const PRESENCE_SELECT = "pr.online, pr.seen_at, pr.c_status, pr.c_game, pr.room, pr.r_state, pr.r_game, (l.phase = 'lobby' AND l.open >= 1) AS joinable";

/** The joins that go with PRESENCE_SELECT, for a query whose profile alias is `p`. */
export const PRESENCE_JOIN = 'LEFT JOIN soc_presence pr ON pr.pid = p.pid LEFT JOIN soc_lobbies l ON l.code = pr.room';

export function statusOf(r: Pick<PresenceCols, 'online' | 'c_status' | 'room' | 'r_state'>): PresenceStatus {
  if (!r.online) return 'offline';
  if (r.room && r.r_state) return r.r_state === 'playing' ? 'playing' : 'in_room';
  return r.c_status === 'playing' ? 'playing' : 'online';
}

/** What friends see for a stored row; `dnd` is the owner's "appear offline" switch. */
export function viewOf(cols: PresenceCols, dnd: boolean, now: number): FriendPresence {
  if (!cols.online || cols.seen_at === null) return { status: 'offline' };
  const inRoom = !!(cols.room && cols.r_state);
  const row: PresenceRow = {
    status: statusOf(cols),
    game: (inRoom ? cols.r_game : cols.c_game) ?? null,
    room: inRoom ? cols.room : null,
    seenAt: cols.seen_at,
    dnd,
    roomJoinable: cols.joinable === 1,
  };
  return viewPresence(row, now);
}

// ───────── reading ─────────

export interface PersonPresence { pid: string; fid: string; name: string; presence: FriendPresence }

/** The visible presence of one player (what a friend would see right now). */
export async function presenceOf(db: SqlLike, pid: string, now: number): Promise<PersonPresence | null> {
  const r = await one<PresenceCols & { pid: string; fid: string; name: string; dnd: number }>(
    db,
    `SELECT p.pid, p.fid, p.name, p.dnd, ${PRESENCE_SELECT} FROM soc_profiles p ${PRESENCE_JOIN} WHERE p.pid = ?1`,
    pid,
  );
  if (!r) return null;
  return { pid: r.pid, fid: r.fid, name: r.name, presence: viewOf(r, r.dnd === 1, now) };
}

/** Friends of `pid` that have a live hub socket right now (fresh heartbeat), newest first, at most PRESENCE.pushMax. */
export async function onlineFriends(db: SqlLike, pid: string, now: number): Promise<string[]> {
  const r = await rows<{ pid: string }>(
    db,
    `SELECT f.friend AS pid FROM soc_friends f JOIN soc_presence pr ON pr.pid = f.friend
     WHERE f.pid = ?1 AND pr.online = 1 AND pr.seen_at > ?2 ORDER BY pr.seen_at DESC LIMIT ?3`,
    pid, now - PRESENCE.ttlMs, PRESENCE.pushMax,
  );
  return r.map((x) => x.pid);
}

// ───────── pushing ─────────

function logFail(what: string, e: unknown): void {
  console.log(JSON.stringify({ evt: 'social_push_error', what, error: String((e as { message?: unknown })?.message ?? e) }));
}

/** Sends one event to a player's hub. True when at least one open socket got it; false for "offline" and for errors. */
export async function hubSend(env: Pick<SocialEnv, 'HUB'>, pid: string, event: HubEvent): Promise<boolean> {
  try {
    const stub = env.HUB.get(env.HUB.idFromName(pid));
    const res = await stub.fetch(new Request('https://hub.internal/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }));
    return res.status === 200;
  } catch (e) {
    logFail('hubSend', e);
    return false;
  }
}

/** Asks a player's hub to close its sockets (the profile was deleted, the player was banned). */
export async function hubClose(env: Pick<SocialEnv, 'HUB'>, pid: string, reason: 'deleted' | 'banned'): Promise<void> {
  try {
    const stub = env.HUB.get(env.HUB.idFromName(pid));
    await stub.fetch(new Request('https://hub.internal/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }));
  } catch (e) {
    logFail('hubClose', e);
  }
}

/** Tells the online friends of `pid` how `pid` looks now. Returns how many hubs had an open socket. */
export async function pushPresence(env: Pick<SocialEnv, 'DB' | 'HUB'>, pid: string, now: number): Promise<number> {
  const who = await presenceOf(env.DB, pid, now);
  if (!who) return 0;
  const friends = await onlineFriends(env.DB, pid, now);
  if (friends.length === 0) return 0;
  const ev: HubEvent = { t: 'presence', fid: who.fid, name: who.name, presence: who.presence };
  const sent = await Promise.all(friends.map((f) => hubSend(env, f, ev)));
  return sent.filter(Boolean).length;
}

// ───────── writing ─────────

/**
 * A hub socket opened. Writes only when the row is not already fresh and online (a tab that reconnects in a loop costs one
 * write a minute, not one per attempt). True when friends should hear about it: the player was not visibly online before.
 */
export async function markOnline(db: SqlLike, pid: string, now: number): Promise<boolean> {
  const prev = await one<{ online: number; seen_at: number; c_status: string }>(db, 'SELECT online, seen_at, c_status FROM soc_presence WHERE pid = ?1', pid);
  const fresh = !!prev && prev.online === 1 && now - prev.seen_at < 60_000 && prev.c_status === 'online';
  if (fresh) return false;
  await run(
    db,
    `INSERT INTO soc_presence (pid, online, seen_at, c_status, c_game, changed_at) VALUES (?1, 1, ?2, 'online', NULL, ?2)
     ON CONFLICT(pid) DO UPDATE SET online = 1, seen_at = ?2, c_status = 'online', c_game = NULL, changed_at = ?2`,
    pid, now,
  );
  return !prev || prev.online === 0 || now - prev.seen_at > PRESENCE.ttlMs || prev.c_status !== 'online';
}

/** The last hub socket closed. True when the row said online (friends should hear the player left). */
export async function markOffline(db: SqlLike, pid: string, now: number): Promise<boolean> {
  const n = await run(db, "UPDATE soc_presence SET online = 0, c_status = 'online', c_game = NULL, changed_at = ?2 WHERE pid = ?1 AND online = 1", pid, now);
  return n > 0;
}

/** One heartbeat (every four minutes while the page is visible). True when the player had dropped out and is back. */
export async function beat(db: SqlLike, pid: string, now: number): Promise<boolean> {
  const prev = await one<{ online: number; seen_at: number }>(db, 'SELECT online, seen_at FROM soc_presence WHERE pid = ?1', pid);
  await run(
    db,
    `INSERT INTO soc_presence (pid, online, seen_at, changed_at) VALUES (?1, 1, ?2, ?2)
     ON CONFLICT(pid) DO UPDATE SET online = 1, seen_at = ?2, changed_at = CASE WHEN online = 0 THEN ?2 ELSE changed_at END`,
    pid, now,
  );
  return !prev || prev.online === 0 || now - prev.seen_at > PRESENCE.ttlMs;
}

/** The client's own word about solo play. Writes nothing when it changes nothing. True when it changed. */
export async function setClientStatus(db: SqlLike, pid: string, status: 'online' | 'playing', game: string | null, now: number): Promise<boolean> {
  const n = await run(
    db,
    `UPDATE soc_presence SET c_status = ?2, c_game = ?3, seen_at = ?4, changed_at = ?4
     WHERE pid = ?1 AND online = 1 AND (c_status != ?2 OR COALESCE(c_game, '') != COALESCE(?3, ''))`,
    pid, status, game, now,
  );
  return n > 0;
}

export interface RoomState { room: string; state: 'lobby' | 'playing'; game: string }

/** What the Room said (setPlaying hook): the player is in `room`, in its lobby or in a match; or, with null, left `room`. */
export async function setRoomState(db: SqlLike, pid: string, leaving: string | null, st: RoomState | null, now: number): Promise<boolean> {
  if (st) {
    // Only for a stored profile: a player who erased their data while still in a room must not leave a row behind.
    const n = await run(
      db,
      `INSERT INTO soc_presence (pid, online, seen_at, room, r_state, r_game, changed_at)
       SELECT ?1, 0, ?2, ?3, ?4, ?5, ?2 WHERE EXISTS (SELECT 1 FROM soc_profiles WHERE pid = ?1)
       ON CONFLICT(pid) DO UPDATE SET room = ?3, r_state = ?4, r_game = ?5, changed_at = ?2`,
      pid, now, st.room, st.state, st.game,
    );
    return n > 0;
  }
  // Leaving: only when the stored room is the one being left (a quick hop between two rooms must not erase the new one).
  const n = await run(
    db,
    'UPDATE soc_presence SET room = NULL, r_state = NULL, r_game = NULL, changed_at = ?3 WHERE pid = ?1 AND room = ?2',
    pid, leaving, now,
  );
  return n > 0;
}

/** Players whose hub went quiet for longer than the TTL are offline (the sweep; readers already treat them as offline). */
export async function sweepPresence(db: SqlLike, now: number): Promise<number> {
  return run(db, 'UPDATE soc_presence SET online = 0, c_status = \'online\', c_game = NULL WHERE online = 1 AND seen_at < ?1', now - PRESENCE.ttlMs);
}
