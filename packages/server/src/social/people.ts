// Looking players up and the two operations that touch every table: blocking a player and erasing a profile.
import type { AgeBand } from '../../../core/social/types.ts';
import { one, rows, stmt, type D1Like } from './db.ts';

/** The few columns other players' rows are read for. `pid` is secret: it is used inside the server and never sent out. */
export interface Person {
  pid: string;
  fid: string;
  name: string;
  band: AgeBand;
  bannedUntil: number;
}

interface PersonRow { pid: string; fid: string; name: string; band: AgeBand; banned_until: number }

const COLS = 'pid, fid, name, band, banned_until';
const toPerson = (r: PersonRow): Person => ({ pid: r.pid, fid: r.fid, name: r.name, band: r.band, bannedUntil: r.banned_until });

export async function byFid(db: D1Like, fid: string): Promise<Person | null> {
  const r = await one<PersonRow>(db, `SELECT ${COLS} FROM soc_profiles WHERE fid = ?1`, fid);
  return r ? toPerson(r) : null;
}

export async function byCode(db: D1Like, chars: string): Promise<Person | null> {
  const r = await one<PersonRow>(db, `SELECT ${COLS} FROM soc_profiles WHERE code = ?1`, chars);
  return r ? toPerson(r) : null;
}

export async function byPid(db: D1Like, pid: string): Promise<Person | null> {
  const r = await one<PersonRow>(db, `SELECT ${COLS} FROM soc_profiles WHERE pid = ?1`, pid);
  return r ? toPerson(r) : null;
}

export async function areFriends(db: D1Like, a: string, b: string): Promise<boolean> {
  return (await one(db, 'SELECT 1 AS x FROM soc_friends WHERE pid = ?1 AND friend = ?2', a, b)) !== null;
}

/** Either of the two blocked the other. */
export async function blockedEitherWay(db: D1Like, a: string, b: string): Promise<boolean> {
  return (await one(db, 'SELECT 1 AS x FROM soc_blocks WHERE (pid = ?1 AND target = ?2) OR (pid = ?2 AND target = ?1) LIMIT 1', a, b)) !== null;
}

/** The statements that end the relationship between two players (friendship and requests, both directions). */
export function unlinkStmts(db: D1Like, a: string, b: string) {
  return [
    stmt(db, 'DELETE FROM soc_friends WHERE (pid = ?1 AND friend = ?2) OR (pid = ?2 AND friend = ?1)', a, b),
    stmt(db, 'DELETE FROM soc_requests WHERE (from_pid = ?1 AND to_pid = ?2) OR (from_pid = ?2 AND to_pid = ?1)', a, b),
  ];
}

/**
 * `pid` blocks `target`: the block row, and the friendship and any request between them end in the same transaction.
 * True when they were friends (the caller tells the other player's hub).
 */
export async function blockPlayer(db: D1Like, pid: string, target: string, now: number): Promise<{ wasFriends: boolean }> {
  const wasFriends = await areFriends(db, pid, target);
  await db.batch([
    stmt(db, 'INSERT OR IGNORE INTO soc_blocks (pid, target, at) VALUES (?1, ?2, ?3)', pid, target, now),
    ...unlinkStmts(db, pid, target),
  ]);
  return { wasFriends };
}

/**
 * Deletes everything held about a player. What stays: the random profile id inside reports filed against other players
 * (evidence, no name), and reports against this player with the name blanked; the sweep removes those after 90 days.
 * Returns the friends' ids (the caller tells their hubs).
 */
export async function eraseProfile(db: D1Like, pid: string): Promise<{ friends: string[] }> {
  const friends = (await rows<{ friend: string }>(db, 'SELECT friend FROM soc_friends WHERE pid = ?1', pid)).map((r) => r.friend);
  await db.batch([
    stmt(db, 'DELETE FROM soc_devices WHERE pid = ?1', pid),
    // the other side's rows first, found through this player's own (primary key lookups: no scan of the whole table)
    stmt(db, 'DELETE FROM soc_friends WHERE (pid, friend) IN (SELECT friend, pid FROM soc_friends WHERE pid = ?1)', pid),
    stmt(db, 'DELETE FROM soc_friends WHERE pid = ?1', pid),
    stmt(db, 'DELETE FROM soc_requests WHERE from_pid = ?1 OR to_pid = ?1', pid),
    stmt(db, 'DELETE FROM soc_blocks WHERE pid = ?1 OR target = ?1', pid),
    stmt(db, 'DELETE FROM soc_declines WHERE from_pid = ?1 OR to_pid = ?1', pid),
    stmt(db, 'DELETE FROM soc_presence WHERE pid = ?1', pid),
    stmt(db, 'DELETE FROM soc_scores WHERE pid = ?1', pid),
    stmt(db, 'UPDATE soc_reports SET reporter = NULL WHERE reporter = ?1', pid),
    stmt(db, "UPDATE soc_reports SET target_name = '', note = NULL WHERE target = ?1", pid),
    stmt(db, 'DELETE FROM soc_profiles WHERE pid = ?1', pid),
  ]);
  return { friends };
}
