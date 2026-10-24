// The lobby directory, quick match and invitations.
//
// Rooms live in N's Room Durable Objects. Each Room reports its state through the publishRoom hook; this module keeps the
// reports in D1 (soc_lobbies) so a list, a quick match and a friend's "join" can be answered without waking any room. The
// directory is the only place where strangers meet: only teens meet teens and adults meet adults, nobody who blocked
// another (either way) shows up in the other's list, children have no public lobbies, and a stranger in a public room is
// a skeleton ghost with preset messages (the Room enforces that; core/social/age.ts says what each band may do).
import { lobbyGroupOf, policyFor } from '../../../core/social/age.ts';
import { INVITE_TTL_MS, LIMITS } from '../../../core/social/rules.ts';
import { GHOST_OFFER_AFTER_MS, levelBand, isLevelBand } from '../../../core/social/levels.ts';
import { MAX_SEARCH_MS, decideQuick, newSearchId, searchStart, waited, type LobbyCandidate, type Seeker } from '../../../core/social/quickmatch.ts';
import { isGameId, isRegion } from '../../../core/social/rules.ts';
import type { LevelBand, LobbyEntry, QuickAction, Region } from '../../../core/social/types.ts';
import { isFid } from '../../../core/social/codes.ts';
import { normalizeRoomCode } from '../../../core/net/codes.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import { HttpError } from '../http.ts';
import { one, rows } from './db.ts';
import type { D1Like } from './db.ts';
import { enforce } from './limits.ts';
import { areFriends, byFid } from './people.ts';
import { hubSend, presenceOf } from './presence.ts';
import { memAllow, randomId, type Ctx, type SocialHandler } from './util.ts';
import type { Me } from './auth.ts';

/** A lobby row the Room has not refreshed for this long is treated as gone (the Room reports every change). */
export const LOBBY_STALE_MS = 15 * 60_000;
/** An unchanged report is not written again before this much time has passed. */
export const LOBBY_REFRESH_MS = 5 * 60_000;

const BLOCKED_PAIR = `EXISTS (SELECT 1 FROM json_each(l.pids) j JOIN soc_blocks b ON (b.pid = ?5 AND b.target = j.value) OR (b.target = ?5 AND b.pid = j.value))`;
const HAS_ME = 'EXISTS (SELECT 1 FROM json_each(l.pids) j WHERE j.value = ?5)';

interface LobbyDbRow {
  code: string; kind: 'public' | 'private'; grp: string | null; region: string; game: string; band: string | null; size: number;
  players: number; open: number; names: string; pids: string; phase: 'lobby' | 'playing'; created_at: number; updated_at: number;
}

const parseList = (s: string): string[] => {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// ───────── what the Room reports ─────────

/**
 * A room was created or changed. Rooms nobody sits in yet are not stored; a report that changes nothing is not written
 * again for five minutes (that keeps the write count of a busy lobby low). The region of a room is the first member's.
 */
export async function publishRoom(db: D1Like, s: RoomSummary, pids: readonly string[], now: number): Promise<boolean> {
  const prev = await one<LobbyDbRow>(db, 'SELECT * FROM soc_lobbies WHERE code = ?1', s.code);
  if (!prev && pids.length === 0) return false;
  const names = JSON.stringify(s.names.slice(0, 4));
  const members = JSON.stringify(pids.slice(0, 4));
  const grp = s.kind === 'public' ? s.audience : null;
  if (
    prev && prev.kind === s.kind && prev.grp === grp && prev.game === s.gameId && prev.band === s.band && prev.size === s.size &&
    prev.players === s.players && prev.open === s.open && prev.names === names && prev.pids === members && prev.phase === s.phase &&
    now - prev.updated_at < LOBBY_REFRESH_MS
  ) return false;
  let region: string = prev?.region ?? 'eu';
  if ((!prev || prev.players === 0) && pids[0]) {
    const p = await one<{ region: string }>(db, 'SELECT region FROM soc_profiles WHERE pid = ?1', pids[0]);
    if (p) region = p.region;
  }
  if (prev) {
    // Only the columns that changed are written: assigning an indexed column rewrites its index entry even when the value is
    // the same, and a free-plan row write is a row write. Players, seats, names and phase are in no index.
    const set: [string, unknown][] = [['players', s.players], ['open', s.open], ['names', names], ['pids', members], ['phase', s.phase], ['updated_at', now]];
    if (prev.kind !== s.kind) set.push(['kind', s.kind]);
    if (prev.grp !== grp) set.push(['grp', grp]);
    if (prev.game !== s.gameId) set.push(['game', s.gameId]);
    if (prev.band !== s.band) set.push(['band', s.band]);
    if (prev.size !== s.size) set.push(['size', s.size]);
    if (prev.region !== region) set.push(['region', region]);
    await db.prepare(`UPDATE soc_lobbies SET ${set.map(([col], i) => `${col} = ?${i + 2}`).join(', ')} WHERE code = ?1`).bind(s.code, ...set.map(([, v]) => v)).run();
    return true;
  }
  await db.prepare(
    `INSERT INTO soc_lobbies (code, kind, grp, region, game, band, size, players, open, names, pids, phase, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
     ON CONFLICT(code) DO UPDATE SET kind = ?2, grp = ?3, region = ?4, game = ?5, band = ?6, size = ?7, players = ?8, open = ?9,
       names = ?10, pids = ?11, phase = ?12, updated_at = ?13`,
  ).bind(s.code, s.kind, grp, region, s.gameId, s.band, s.size, s.players, s.open, names, members, s.phase, now).run();
  return true;
}

export async function removeRoom(db: D1Like, code: string): Promise<void> {
  await db.prepare('DELETE FROM soc_lobbies WHERE code = ?1').bind(code).run();
}

// ───────── who may enter ─────────

/** A player may use public lobbies and quick match: not a child, not suspended from them. */
export function requirePublicPlay(me: Pick<Me, 'band' | 'publicBlockedUntil'>, now: number): void {
  if (!policyFor(me.band).publicPlay) throw new HttpError(403, 'child_no_public');
  if (me.publicBlockedUntil > now) throw new HttpError(403, 'public_suspended', { until: me.publicBlockedUntil });
}

/**
 * The join gate of a public room (the gateJoin hook): the right age group, not suspended, and nobody in the room blocked
 * this player or was blocked by them. Rooms the Room has not reported yet cannot be checked here; the Room checks block keys itself.
 */
export async function mayJoinPublic(db: D1Like, s: Pick<RoomSummary, 'code' | 'audience'>, pid: string, now: number): Promise<boolean> {
  const p = await one<{ band: string; banned_until: number; public_blocked_until: number }>(db, 'SELECT band, banned_until, public_blocked_until FROM soc_profiles WHERE pid = ?1', pid);
  if (!p || p.banned_until > now || p.public_blocked_until > now) return false;
  const band = p.band as Me['band'];
  const group = lobbyGroupOf(band);
  if (group === null) return false;
  if (s.audience !== null && s.audience !== group) return false;
  const blocked = await one(
    db,
    `SELECT 1 AS x FROM soc_lobbies l WHERE l.code = ?1 AND EXISTS (SELECT 1 FROM json_each(l.pids) j JOIN soc_blocks b ON (b.pid = ?2 AND b.target = j.value) OR (b.target = ?2 AND b.pid = j.value))`,
    s.code, pid,
  );
  return blocked === null;
}

// ───────── the list ─────────

function toEntry(r: LobbyDbRow): LobbyEntry {
  const names = parseList(r.names);
  return {
    code: r.code, game: r.game, region: r.region as Region, band: isLevelBand(r.band) ? r.band : null, size: r.size, players: r.players,
    open: r.open, hostName: names[0] ?? '', names, phase: r.phase, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** GET /api/social/lobbies?game=&region=: open public lobbies of the player's own age group. */
export const listLobbies: SocialHandler = async (c) => {
  requirePublicPlay(c.me, c.now);
  if (!memAllow(`lobbies:${c.me.pid}`, 30, 60_000, c.now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 30_000 });
  const game = c.url.searchParams.get('game');
  const region = c.url.searchParams.get('region');
  if (game !== null && !isGameId(game)) throw new HttpError(400, 'bad_request', { field: 'game' });
  if (region !== null && !isRegion(region)) throw new HttpError(400, 'bad_request', { field: 'region' });
  const group = lobbyGroupOf(c.me.band);
  const list = await rows<LobbyDbRow>(
    c.db,
    `SELECT * FROM soc_lobbies l
     WHERE l.kind = 'public' AND l.grp = ?1 AND l.phase = 'lobby' AND l.players >= 1 AND l.open >= 1 AND l.updated_at > ?2
       AND (?3 IS NULL OR l.game = ?3) AND (?4 IS NULL OR l.region = ?4)
       AND NOT ${BLOCKED_PAIR} AND NOT ${HAS_ME}
     ORDER BY (l.region = ?6) DESC, l.players DESC, l.created_at ASC, l.code LIMIT 40`,
    group, c.now - LOBBY_STALE_MS, game, region, c.me.pid, c.me.region,
  );
  return { lobbies: list.map(toEntry) };
};

// ───────── quick match ─────────

/**
 * POST /api/social/match {game, searchId?, hosting?}. The player asks again every four seconds until they are in a room.
 * Answers `join` (an open lobby fits: take a seat with the room API), `create` (open a public room, then ask again with
 * `hosting` set to its code), `wait`, or `merge` (an older fitting lobby exists and the player's own is still empty).
 */
export const quickMatch: SocialHandler = async (c) => {
  const { me, db, now, body: b } = c;
  requirePublicPlay(me, now);
  if (!isGameId(b.game)) throw new HttpError(400, 'bad_request', { field: 'game' });
  if (!memAllow(`match:${me.pid}`, 40, 60_000, now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 15_000 });
  const game = b.game;

  const start = searchStart(b.searchId);
  const known = start !== null && start <= now + 5_000 && now - start <= MAX_SEARCH_MS;
  const searchId = known ? (b.searchId as string) : newSearchId(now, randomId(9));
  const waitedMs = known ? waited(searchId, now) : 0;

  let hosting: Seeker['hosting'] = null;
  if (b.hosting !== undefined && b.hosting !== null) {
    const code = typeof b.hosting === 'string' ? normalizeRoomCode(b.hosting) : null;
    if (!code) throw new HttpError(400, 'bad_request', { field: 'hosting' });
    const mine = await one<LobbyDbRow>(db, `SELECT * FROM soc_lobbies l WHERE l.code = ?1 AND l.kind = 'public' AND ${HAS_ME.replace('?5', '?2')}`, code, me.pid);
    if (!mine) return { action: 'wait', searchId, waitedMs, offerGhost: waitedMs >= GHOST_OFFER_AFTER_MS } satisfies QuickAction;
    hosting = { code, players: mine.players, createdAt: mine.created_at };
  }

  const group = lobbyGroupOf(me.band);
  const list = await rows<LobbyDbRow>(
    db,
    `SELECT * FROM soc_lobbies l
     WHERE l.kind = 'public' AND l.grp = ?1 AND l.game = ?3 AND l.phase = 'lobby' AND l.players >= 1 AND l.open >= 1 AND l.updated_at > ?2
       AND NOT ${BLOCKED_PAIR} AND NOT ${HAS_ME}
     ORDER BY l.created_at ASC, l.code LIMIT 40`,
    group, now - LOBBY_STALE_MS, game, null, me.pid,
  );
  const cands: LobbyCandidate[] = list.map((r) => ({
    code: r.code, game: r.game, region: r.region as Region, band: isLevelBand(r.band) ? r.band : null, open: r.open, players: r.players, phase: r.phase, createdAt: r.created_at,
  }));
  const seeker: Seeker = { game, band: levelBand(me.level) as LevelBand, region: me.region, hosting };
  const d = decideQuick(cands, seeker, waitedMs);
  switch (d.action) {
    case 'join': return { action: 'join', code: d.code, searchId } satisfies QuickAction;
    case 'merge': return { action: 'merge', code: d.code, searchId } satisfies QuickAction;
    case 'create': return { action: 'create', band: d.band, searchId } satisfies QuickAction;
    case 'wait': return { action: 'wait', searchId, waitedMs, offerGhost: d.offerGhost } satisfies QuickAction;
  }
};

// ───────── invitations ─────────

/**
 * POST /api/social/invite {fid, room}: ask an online friend into the room the player is in. The invitation is a push to the
 * friend's open hub socket and is not stored: an offline friend cannot be invited (the player shares the room link instead).
 */
export const invite: SocialHandler = async (c) => {
  const { me, db, now, body: b } = c;
  if (!isFid(b.fid)) throw new HttpError(400, 'bad_request', { field: 'fid' });
  const code = typeof b.room === 'string' ? normalizeRoomCode(b.room) : null;
  if (!code) throw new HttpError(400, 'bad_request', { field: 'room' });
  const friend = await byFid(db, b.fid);
  if (!friend || !(await areFriends(db, me.pid, friend.pid))) throw new HttpError(404, 'not_friends');
  const mine = await one<{ room: string | null }>(db, 'SELECT room FROM soc_presence WHERE pid = ?1', me.pid);
  if (!mine || mine.room !== code) throw new HttpError(409, 'not_in_room');
  const lobby = await one<LobbyDbRow>(db, 'SELECT * FROM soc_lobbies WHERE code = ?1', code);
  if (!lobby || lobby.phase !== 'lobby' || lobby.open < 1) throw new HttpError(409, 'not_joinable');
  if (lobby.kind === 'public' && lobby.grp !== lobbyGroupOf(friend.band)) throw new HttpError(409, 'not_joinable');
  const who = await presenceOf(db, friend.pid, now);
  if (!who || who.presence.status === 'offline') throw new HttpError(409, 'offline');
  await enforce(db, me.pid, LIMITS.invite, now);
  await enforce(db, `${me.pid}>${friend.pid}`, LIMITS.invitePair, now);
  const id = randomId(9);
  const exp = now + INVITE_TTL_MS;
  const delivered = await hubSend(c.env, friend.pid, { t: 'invite', id, from: { fid: me.fid, name: me.name }, room: code, game: lobby.game, exp });
  if (!delivered) throw new HttpError(409, 'offline');
  return { id, exp };
};

/** POST /api/social/invite/decline {fid, id}: tell the friend who invited that the invitation was turned down. */
export const declineInvite: SocialHandler = async (c) => {
  const { me, db, body: b } = c;
  if (!isFid(b.fid)) throw new HttpError(400, 'bad_request', { field: 'fid' });
  if (typeof b.id !== 'string' || b.id.length < 4 || b.id.length > 40) throw new HttpError(400, 'bad_request', { field: 'id' });
  if (!memAllow(`decline:${me.pid}`, 30, 60_000, c.now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 30_000 });
  const friend = await byFid(db, b.fid);
  if (!friend || !(await areFriends(db, me.pid, friend.pid))) throw new HttpError(404, 'not_friends');
  c.wait(hubSend(c.env, friend.pid, { t: 'invite_declined', id: b.id, fid: me.fid }));
  return { ok: true };
};

export type { Ctx };
