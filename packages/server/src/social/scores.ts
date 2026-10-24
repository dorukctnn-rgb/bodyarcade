// Weekly boards: the best score of a player in a game in a week, for the player's friends and for the players of the same
// age group in the same country.
//
//   POST /api/social/scores/start  {game}                 -> {run, game, at}   a ticket the server signs and times
//   POST /api/social/scores        {run, game, score}     -> {improved, best, week}
//   GET  /api/social/leaderboard   ?game=&scope=friends|country&week=current|previous   -> BoardView
//
// What is checked is in core/social/scores.ts (signed profile, a run the server saw start and finish, a ceiling for the time
// it took). What a board shows is minimal: a name, a score and a rank. Country boards never carry a friend id; children are on
// friends boards only; teens and adults have separate country boards; players suspended from public play and players the
// viewer blocked (or who blocked the viewer) are left out. Nobody is added to a board to fill it.
//
// Free-plan cost: a score that is not the player's best writes nothing; a better one writes two rows (the score and its place on
// the board's index), at most 30 times per game and week (the count is kept in the row itself); a board read looks at 80 rows of an index (answered from memory
// for 30 seconds), a friends board at one row per friend.
import { toB64u } from '../../../core/social/codes.ts';
import {
  BOARD_GAMES, KEEP_WEEKS, SCORES, cleanCountry, isBoardGame, judgeRun, weekOf, weekRange, type BoardGame,
} from '../../../core/social/scores.ts';
import type { BoardEntry, BoardScope, BoardView } from '../../../core/social/types.ts';
import { HttpError } from '../http.ts';
import { rows, one, stmt, type D1Like } from './db.ts';
import type { SocialEnv } from './env.ts';
import { memAllow, randomId, type SocialHandler } from './util.ts';

const enc = new TextEncoder();
const TICKET_VERSION = 'r1';
const BOARD_CACHE_MS = 30_000;
const BOARD_CACHE_MAX = 300;

// ───────── tickets ─────────

const keys = new Map<string, Promise<CryptoKey>>();

async function sign(env: SocialEnv, text: string): Promise<string> {
  const secret = env.TICKET_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'unavailable');
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, key);
  }
  return toB64u(new Uint8Array(await crypto.subtle.sign('HMAC', await key, enc.encode(text))).slice(0, 16));
}

const same = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const signedText = (pid: string, game: string, at: number, nonce: string): string => `${TICKET_VERSION}|${pid}|${game}|${at}|${nonce}`;

/** POST /api/social/scores/start {game}: the server notes the time and signs it with the player and the game (nothing is stored). */
export const startRun: SocialHandler = async (c) => {
  const game = c.body.game;
  if (!isBoardGame(game)) throw new HttpError(400, 'unknown_game');
  if (!memAllow(`runstart:${c.me.pid}`, SCORES.startsPerMinute, 60_000, c.now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 30_000 });
  const nonce = randomId(6);
  const run = `${TICKET_VERSION}.${c.now}.${nonce}.${await sign(c.env, signedText(c.me.pid, game, c.now, nonce))}`;
  return { run, game, at: c.now };
};

/** The start time and nonce of a ticket that carries a valid signature for this player and game; null otherwise. */
async function openTicket(env: SocialEnv, pid: string, game: string, run: unknown): Promise<{ at: number } | null> {
  if (typeof run !== 'string' || run.length > 120) return null;
  const [v, at, nonce, sig, extra] = run.split('.');
  if (v !== TICKET_VERSION || !at || !nonce || !sig || extra !== undefined || !/^\d{10,16}$/.test(at)) return null;
  const t = Number(at);
  if (!Number.isSafeInteger(t) || !same(sig, await sign(env, signedText(pid, game, t, nonce)))) return null;
  return { at: t };
}

// ───────── the country of a request ─────────

/** `request.cf.country` on Cloudflare, or the CF-IPCountry header; null when it is not a country. */
export function countryOf(req: Request): string | null {
  return cleanCountry((req as unknown as { cf?: { country?: unknown } }).cf?.country) ?? cleanCountry(req.headers.get('CF-IPCountry'));
}

// ───────── a finished run ─────────

/** POST /api/social/scores {run, game, score}: the ticket, the time it took, the ceiling for that time, then the best of the week. */
export const finishRun: SocialHandler = async (c) => {
  const { me, db, now, body: b } = c;
  const game = b.game;
  if (!isBoardGame(game)) throw new HttpError(400, 'unknown_game');
  const ticket = await openTicket(c.env, me.pid, game, b.run);
  if (!ticket) throw new HttpError(400, 'bad_run');
  const score = b.score;
  const verdict = judgeRun(game, now - ticket.at, score);
  if (verdict === 'bad_score') throw new HttpError(400, 'bad_score');
  if (verdict === 'expired') throw new HttpError(409, 'run_expired');
  if (verdict === 'too_short') throw new HttpError(409, 'run_too_short');
  if (verdict === 'implausible') {
    // Worth a look: a ceiling that is too low turns honest players away, one that is too high lets a faker in.
    console.log(JSON.stringify({ evt: 'score_rejected', game, score, elapsedMs: now - ticket.at, band: me.band }));
    throw new HttpError(422, 'score_implausible');
  }
  const points = score as number;
  const wk = weekOf(now);
  const prev = await one<{ score: number; n: number }>(db, 'SELECT score, n FROM soc_scores WHERE wk = ?1 AND game = ?2 AND pid = ?3', wk, game, me.pid);
  if (prev && prev.score >= points) return { improved: false, best: prev.score, week: wk };
  // The count of improvements is in the row, so the limit costs no row of its own.
  if (prev && prev.n >= SCORES.improvementsPerWeek) throw new HttpError(429, 'rate_limited', { retryAfterMs: weekRange(wk).end - now });
  const country = countryOf(c.req) ?? '';
  await stmt(db,
    `INSERT INTO soc_scores (wk, game, pid, score, at, grp, country, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
     ON CONFLICT(wk, game, pid) DO UPDATE SET score = ?4, at = ?5, grp = ?6, country = ?7, n = n + 1`,
    wk, game, me.pid, points, now, me.band, country).run();
  dropBoards(wk, game);
  return { improved: true, best: points, week: wk };
};

// ───────── reading a board ─────────

interface CountryRow { pid: string; name: string; score: number; at: number }
const boardCache = new Map<string, { at: number; rows: CountryRow[] }>();

const dropBoards = (wk: number, game: string): void => {
  for (const k of boardCache.keys()) if (k.startsWith(`${wk}|${game}|`)) boardCache.delete(k);
};
/** Tests only. */
export function resetBoardCache(): void { boardCache.clear(); }

/** The rows of a country board: the best first, leaving out the profiles suspended from public play. */
async function countryRows(db: D1Like, wk: number, game: BoardGame, grp: string, country: string, now: number): Promise<CountryRow[]> {
  const key = `${wk}|${game}|${grp}|${country}`;
  const hit = boardCache.get(key);
  if (hit && now - hit.at < BOARD_CACHE_MS) return hit.rows;
  const list = await rows<CountryRow>(
    db,
    `SELECT s.pid, p.name, s.score, s.at FROM soc_scores s JOIN soc_profiles p ON p.pid = s.pid
     WHERE s.wk = ?1 AND s.game = ?2 AND s.grp = ?3 AND s.country = ?4 AND p.banned_until <= ?5 AND p.public_blocked_until <= ?5
     ORDER BY s.score DESC, s.at ASC LIMIT ?6`,
    wk, game, grp, country, now, SCORES.boardFetch,
  );
  if (boardCache.size >= BOARD_CACHE_MAX) boardCache.clear();
  boardCache.set(key, { at: now, rows: list });
  return list;
}

/** Competition ranking: players with the same score share a rank, and the next rank skips the shared places (1, 2, 2, 4). */
function ranked<T extends { score: number }>(list: readonly T[]): (T & { rank: number })[] {
  const out: (T & { rank: number })[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i] as T;
    const before = out[i - 1];
    out.push({ ...r, rank: before && before.score === r.score ? before.rank : i + 1 });
  }
  return out;
}

/** GET /api/social/leaderboard?game=&scope=friends|country&week=current|previous */
export const leaderboard: SocialHandler = async (c) => {
  const { me, db, now, url } = c;
  const game = url.searchParams.get('game');
  if (!isBoardGame(game)) throw new HttpError(400, 'unknown_game');
  const scope = url.searchParams.get('scope') ?? 'friends';
  if (scope !== 'friends' && scope !== 'country') throw new HttpError(400, 'bad_request', { field: 'scope' });
  const weekParam = url.searchParams.get('week') ?? 'current';
  if (weekParam !== 'current' && weekParam !== 'previous') throw new HttpError(400, 'bad_request', { field: 'week' });
  if (!memAllow(`board:${me.pid}`, 60, 60_000, now)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 30_000 });
  const current = weekOf(now);
  const wk = weekParam === 'current' ? current : current - 1;
  const week = { ...weekRange(wk), current: wk === current };
  const view: BoardView = { game, scope: scope as BoardScope, week, country: null, entries: [], you: null };
  const mine = await one<{ score: number; at: number }>(db, 'SELECT score, at FROM soc_scores WHERE wk = ?1 AND game = ?2 AND pid = ?3', wk, game, me.pid);

  if (scope === 'friends') {
    const list = await rows<{ fid: string; name: string; score: number; at: number; mine: number }>(
      db,
      `WITH ids AS (SELECT ?3 AS pid UNION ALL SELECT friend FROM soc_friends WHERE pid = ?3)
       SELECT p.fid, p.name, s.score, s.at, (s.pid = ?3) AS mine
       FROM ids JOIN soc_scores s ON s.wk = ?1 AND s.game = ?2 AND s.pid = ids.pid JOIN soc_profiles p ON p.pid = s.pid
       ORDER BY s.score DESC, s.at ASC LIMIT ?4`,
      wk, game, me.pid, SCORES.friendsFetch,
    );
    const all = ranked(list).map((r): BoardEntry => ({ rank: r.rank, name: r.name, score: r.score, you: r.mine === 1, ...(r.mine === 1 ? {} : { fid: r.fid }) }));
    view.entries = all.slice(0, SCORES.boardSize);
    const self = all.find((e) => e.you);
    if (self) {
      view.you = { score: self.score, rank: self.rank, atLeast: false };
      if (!view.entries.includes(self)) view.entries.push(self);
    }
    return { board: view };
  }

  if (me.band === 'child') throw new HttpError(403, 'child_no_public');
  const country = countryOf(c.req);
  view.country = country;
  if (!country) return { board: view };
  const [fetched, blocked] = await Promise.all([
    countryRows(db, wk, game, me.band, country, now),
    rows<{ other: string }>(db, 'SELECT target AS other FROM soc_blocks WHERE pid = ?1 UNION SELECT pid FROM soc_blocks WHERE target = ?1', me.pid),
  ]);
  const hide = new Set(blocked.map((b) => b.other));
  const shown = ranked(fetched.filter((r) => r.pid === me.pid || !hide.has(r.pid)));
  view.entries = shown.slice(0, SCORES.boardSize).map((r): BoardEntry => ({ rank: r.rank, name: r.name, score: r.score, you: r.pid === me.pid }));
  const inList = shown.find((r) => r.pid === me.pid);
  if (inList) {
    view.you = { score: inList.score, rank: inList.rank, atLeast: false };
    if (inList.rank > SCORES.boardSize && !view.entries.some((e) => e.you)) view.entries.push({ rank: inList.rank, name: inList.name, score: inList.score, you: true });
  } else if (mine) {
    // Not among the 80 best: count the players ahead, up to a bound (a rank is "at least 101" beyond it).
    const ahead = await one<{ n: number }>(
      db,
      'SELECT COUNT(*) AS n FROM (SELECT 1 FROM soc_scores WHERE wk = ?1 AND game = ?2 AND grp = ?3 AND country = ?4 AND score > ?5 LIMIT ?6)',
      wk, game, me.band, country, mine.score, SCORES.rankCap + 1,
    );
    const n = ahead?.n ?? 0;
    view.you = { score: mine.score, rank: n + 1, atLeast: n > SCORES.rankCap };
  }
  return { board: view };
};

/** The best scores of a player in the weeks the boards keep (the data export). */
export async function scoresOf(db: D1Like, pid: string, now: number): Promise<{ week: number; game: string; score: number }[]> {
  return rows<{ week: number; game: string; score: number }>(
    db, 'SELECT wk AS week, game, score FROM soc_scores WHERE pid = ?1 AND wk > ?2 ORDER BY wk DESC, game', pid, weekOf(now) - KEEP_WEEKS,
  );
}

/** The games with a board, for a screen that lists them. */
export const BOARD_GAME_IDS = Object.keys(BOARD_GAMES);
