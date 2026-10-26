// Weekly boards: the ticket of a run, what a finished run may score, the best of the week, friends boards and country boards.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY } from '../../../core/social/rules.ts';
import { BOARD_GAMES, SCORES, ceilingFor, runWindowMs, weekOf } from '../../../core/social/scores.ts';
import type { AgeBand, BoardView, DataExport } from '../../../core/social/types.ts';
import { resetBoardCache } from './scores.ts';
import { sweep } from './sweep.ts';
import { createTestApp, type TestApp, type TestPlayer } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Wednesday 21 October 2026, noon UTC: the week runs from Monday the 19th to Monday the 26th. */
const WED = Date.UTC(2026, 9, 21, 12);
const GAME = 'squat-flap';
let app: TestApp;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WED);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const where = (c: string): Record<string, string> => ({ 'CF-IPCountry': c });
const player = (band: AgeBand = 'adult', name?: string): Promise<TestPlayer> => app.signup(band, name ? { name } : {});

async function start(p: TestPlayer, game = GAME, c = 'TR'): Promise<string> {
  const r = await app.call<{ run: string }>('POST', '/api/social/scores/start', { dev: p.dev, body: { game }, headers: where(c) });
  expect(r.status).toBe(200);
  return r.body.run;
}

interface PostOptions { game?: string; ms?: number; c?: string; run?: string }
/** Starts a run, lets time pass (a minute by default) and posts the score. */
async function post(p: TestPlayer, points: unknown, o: PostOptions = {}) {
  const game = o.game ?? GAME;
  const run = o.run ?? await start(p, game, o.c ?? 'TR');
  vi.setSystemTime(Date.now() + (o.ms ?? 60_000));
  return app.call<{ improved: boolean; best: number; week: number; error?: string }>('POST', '/api/social/scores', { dev: p.dev, body: { run, game, score: points }, headers: where(o.c ?? 'TR') });
}

async function board(p: TestPlayer, query: string, c = 'TR'): Promise<BoardView> {
  const r = await app.call<{ board: BoardView }>('GET', `/api/social/leaderboard?${query}`, { dev: p.dev, headers: where(c) });
  expect(r.status).toBe(200);
  return r.body.board;
}
const country = (p: TestPlayer, c = 'TR', game = GAME, week = 'current'): Promise<BoardView> => board(p, `game=${game}&scope=country&week=${week}`, c);
const friendsOf = (p: TestPlayer, game = GAME, week = 'current'): Promise<BoardView> => board(p, `game=${game}&scope=friends&week=${week}`);
const names = (b: BoardView): string[] => b.entries.map((e) => e.name);
const rows = (): number => (app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_scores').get() as { n: number }).n;

async function befriend(a: TestPlayer, b: TestPlayer): Promise<void> {
  await a.post('/api/social/friends/request', { code: b.me.code });
  await b.post('/api/social/friends/respond', { fid: a.me.fid, accept: true });
}

let seq = 0;
/** Players and their scores written straight into the tables (a board of any size without a hundred sign-ups). */
function seed(n: number, o: { band?: AgeBand; country?: string; score: (i: number) => number; game?: string; wk?: number }): string[] {
  const insert = app.db.raw.prepare("INSERT INTO soc_profiles (pid, fid, code, name, band, region, created_at, seen_day) VALUES (?, ?, ?, ?, ?, 'eu', 0, ?)");
  const score = app.db.raw.prepare('INSERT INTO soc_scores (wk, game, pid, score, at, grp, country) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const pids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = String(++seq).padStart(8, '0');
    insert.run(`seedpid${id}`, `F${id}X`, `C${id}`, `Seed ${i}`, o.band ?? 'adult', Math.floor(WED / DAY));
    score.run(o.wk ?? weekOf(WED), o.game ?? GAME, `seedpid${id}`, o.score(i), WED + i, o.band ?? 'adult', o.country ?? 'TR');
    pids.push(`seedpid${id}`);
  }
  return pids;
}

// ───────── the ticket of a run ─────────

describe('the ticket of a run', () => {
  it('a run that took a minute posts its score, which is then the best of the week for the game', async () => {
    const ada = await player('adult', 'Ada');
    const r = await post(ada, 1200);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ improved: true, best: 1200, week: weekOf(WED) });
    expect(app.db.raw.prepare('SELECT wk, game, score, grp, country FROM soc_scores').all()).toEqual([{ wk: weekOf(WED), game: GAME, score: 1200, grp: 'adult', country: 'TR' }]);
  });

  it('a ticket belongs to the player and the game it was made for, and cannot be altered', async () => {
    const ada = await player('adult');
    const bo = await player('adult');
    const run = await start(ada);
    expect((await post(bo, 100, { run })).body.error).toBe('bad_run');
    expect((await post(ada, 100, { run, game: 'knee-sprint' })).body.error).toBe('bad_run');
    // one letter of the signature changed (the one before the last: the last carries bits that base64 leaves unused); it must differ from the one it replaces
    const flipped = run.slice(0, -2) + (run.at(-2) === 'A' ? 'B' : 'A') + run.slice(-1);
    expect(flipped).not.toBe(run);
    expect((await post(ada, 100, { run: flipped })).body.error).toBe('bad_run');
    const later = run.replace(/^r1\.(\d+)\./, (_, t: string) => `r1.${Number(t) + 1000}.`);
    expect((await post(ada, 100, { run: later })).body.error).toBe('bad_run');
    vi.setSystemTime(Date.now() + 60_000);
    for (const junk of ['', 'r1', 'r1.1.2.3.4', 'r2.1.2.3', `${run}.x`, 'x'.repeat(500), 5, null, undefined, { run }]) {
      const r = await app.call('POST', '/api/social/scores', { dev: ada.dev, body: { run: junk, game: GAME, score: 100 } });
      expect(r.body.error, JSON.stringify(junk)).toBe('bad_run');
    }
    expect(rows()).toBe(0);
    // the same ticket, used by its owner for its game, still works
    expect((await post(ada, 100, { run })).status).toBe(200);
  });

  it('a game that has no board is refused when the run starts and when it ends', async () => {
    const ada = await player('adult');
    for (const game of ['xyz', '', '__proto__', 'constructor', 5, null]) {
      const r = await app.call('POST', '/api/social/scores/start', { dev: ada.dev, body: { game } });
      expect(r.status, String(game)).toBe(400);
      expect(r.body.error).toBe('unknown_game');
    }
    const run = await start(ada);
    const r = await app.call('POST', '/api/social/scores', { dev: ada.dev, body: { run, game: 'xyz', score: 5 } });
    expect(r.body.error).toBe('unknown_game');
  });

  it('a run that was too short, took too long, scored too much or is not a number writes nothing', async () => {
    const ada = await player('adult');
    expect((await post(ada, 10, { ms: 1000 })).body).toMatchObject({ error: 'run_too_short' });
    expect((await post(ada, 10, { ms: runWindowMs(GAME) + 1000 })).body).toMatchObject({ error: 'run_expired' });
    const fast = await post(ada, ceilingFor(GAME, 20_000) + 1, { ms: 20_000 });
    expect(fast.status).toBe(422);
    expect(fast.body.error).toBe('score_implausible');
    expect((await post(ada, ceilingFor(GAME, 20_000), { ms: 20_000 })).status).toBe(200);
    app.db.raw.exec('DELETE FROM soc_scores');
    for (const bad of [-1, 1.5, '300', null, SCORES.maxScore + 1, Number.MAX_SAFE_INTEGER]) {
      const r = await post(ada, bad, { ms: 60_000 });
      expect(r.body.error, String(bad)).toBe('bad_score');
    }
    expect(rows()).toBe(0);
  });

  it('waiting does not raise the ceiling beyond what the game can award in its length', async () => {
    const ada = await player('adult');
    const run = await start(ada);
    const top = ceilingFor(GAME, 1e9);
    expect(top).toBeLessThan(BOARD_GAMES[GAME].ratePerSecond * (BOARD_GAMES[GAME].seconds + 31) + SCORES.slack + 1);
    const r = await post(ada, top + 1, { run, ms: 12 * 60_000 });
    expect(r.status).toBe(422);
    expect((await post(ada, top, { run, ms: 0 })).status).toBe(200);
  });

  it('starting runs is limited to a few a minute and writes nothing', async () => {
    const ada = await player('adult');
    await ada.get('/api/social/me');                              // the first call of a day notes that the player was seen
    app.db.resetCounters();
    for (let i = 0; i < SCORES.startsPerMinute; i++) await start(ada);
    const over = await app.call('POST', '/api/social/scores/start', { dev: ada.dev, body: { game: GAME } });
    expect(over.status).toBe(429);
    expect(app.db.counters.writes).toBe(0);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await app.call('POST', '/api/social/scores/start', { dev: ada.dev, body: { game: GAME } })).status).toBe(200);
  });

  it('an unsigned call, a banned player and a missing secret get nothing', async () => {
    expect((await app.call('POST', '/api/social/scores/start', { body: { game: GAME } })).status).toBe(401);
    expect((await app.call('GET', `/api/social/leaderboard?game=${GAME}`)).status).toBe(401);
    const ada = await player('adult');
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(WED + DAY, ada.pid());
    expect((await app.call('POST', '/api/social/scores/start', { dev: ada.dev, body: { game: GAME } })).status).toBe(403);
    const bare = createTestApp({ env: { TICKET_SECRET: 'short' } });
    const p = await bare.signup('adult');
    expect((await bare.call('POST', '/api/social/scores/start', { dev: p.dev, body: { game: GAME } })).status).toBe(503);
  });
});

// ───────── the best of the week ─────────

describe('the best of the week', () => {
  it('a score that is not better changes nothing and writes nothing; a better one replaces it', async () => {
    const ada = await player('adult');
    expect((await post(ada, 500)).body).toMatchObject({ improved: true, best: 500 });
    const run = await start(ada);
    app.db.resetCounters();
    vi.setSystemTime(Date.now() + 60_000);
    for (const points of [400, 500, 0]) {
      const r = await app.call('POST', '/api/social/scores', { dev: ada.dev, body: { run, game: GAME, score: points } });
      expect(r.body).toMatchObject({ improved: false, best: 500 });
    }
    expect(app.db.counters.writes).toBe(0);
    app.db.resetCounters();
    const better = await app.call('POST', '/api/social/scores', { dev: ada.dev, body: { run, game: GAME, score: 700 } });
    expect(better.body).toMatchObject({ improved: true, best: 700 });
    expect(app.db.counters.writes).toBeLessThanOrEqual(3);
    expect(app.db.raw.prepare('SELECT score FROM soc_scores').all()).toEqual([{ score: 700 }]);
  });

  it('every game has its own best, and a new week starts from nothing', async () => {
    const ada = await player('adult');
    await post(ada, 500);
    await post(ada, 90, { game: 'knee-sprint' });
    expect(rows()).toBe(2);
    vi.setSystemTime(Date.UTC(2026, 9, 26, 0, 30));              // Monday, half past midnight
    expect((await post(ada, 100)).body).toMatchObject({ improved: true, best: 100, week: weekOf(WED) + 1 });
    expect(rows()).toBe(3);
  });

  it('a run that ends in the new week is the new week\'s, wherever it began', async () => {
    const ada = await player('adult');
    vi.setSystemTime(Date.UTC(2026, 9, 25, 23, 59));             // Sunday, one minute before the week turns
    const r = await post(ada, 800, { ms: 90_000 });
    expect(r.body.week).toBe(weekOf(WED) + 1);
    const was = await friendsOf(ada, GAME, 'previous');
    expect(was.entries).toEqual([]);
    expect((await friendsOf(ada)).entries.map((e) => e.score)).toEqual([800]);
  });

  it('a player may beat their best thirty times per game and week; the thirty-first has to wait for the next week', async () => {
    const ada = await player('adult');
    for (let i = 1; i <= SCORES.improvementsPerWeek; i++) expect((await post(ada, i * 10, { ms: 20_000 })).status, `improvement ${i}`).toBe(200);
    const over = await post(ada, SCORES.improvementsPerWeek * 10 + 10, { ms: 20_000 });
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('rate_limited');
    expect(app.db.raw.prepare('SELECT score, n FROM soc_scores').get()).toEqual({ score: SCORES.improvementsPerWeek * 10, n: SCORES.improvementsPerWeek });
    // a score that is not better is not counted against it, and another game has its own allowance
    expect((await post(ada, 5, { ms: 20_000 })).body.improved).toBe(false);
    expect((await post(ada, 50, { game: 'knee-sprint', ms: 20_000 })).status).toBe(200);
    vi.setSystemTime(Date.UTC(2026, 9, 26, 1));
    expect((await post(ada, 1000, { ms: 20_000 })).status).toBe(200);
  });
});

// ───────── friends boards ─────────

describe('the friends board', () => {
  it('shows the player and the friends, best first, equal scores sharing a place, and nobody else', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    const cy = await player('adult', 'Cy');
    const dee = await player('adult', 'Dee');
    await befriend(ada, bo);
    await befriend(ada, cy);
    await post(ada, 500);
    await post(bo, 900);
    await post(cy, 500);                                          // later than Ada: ranks behind her at the same score
    await post(dee, 2000);                                        // not a friend
    const b = await friendsOf(ada);
    expect(b).toMatchObject({ game: GAME, scope: 'friends', country: null, week: { id: weekOf(WED), current: true } });
    expect(b.entries).toEqual([
      { rank: 1, name: 'Bo', score: 900, you: false, fid: bo.me.fid },
      { rank: 2, name: 'Ada', score: 500, you: true },
      { rank: 2, name: 'Cy', score: 500, you: false, fid: cy.me.fid },
    ]);
    expect(b.you).toEqual({ score: 500, rank: 2, atLeast: false });
    expect(JSON.stringify(b)).not.toContain(dee.me.fid);
    // Bo sees Ada, not Cy (they are not friends)
    expect(names(await friendsOf(bo))).toEqual(['Bo', 'Ada']);
    // Dee has no friends: her own line only
    expect(names(await friendsOf(dee))).toEqual(['Dee']);
  });

  it('a player with no score this week has no line, and last week is a board of its own', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    await befriend(ada, bo);
    await post(bo, 300);
    const b = await friendsOf(ada);
    expect(b.you).toBeNull();
    expect(names(b)).toEqual(['Bo']);
    vi.setSystemTime(WED + 7 * DAY);
    expect((await friendsOf(ada)).entries).toEqual([]);
    expect(names(await friendsOf(ada, GAME, 'previous'))).toEqual(['Bo']);
    expect((await friendsOf(ada, GAME, 'previous')).week.current).toBe(false);
  });

  it('children have a friends board (their friends only) and nothing else', async () => {
    const kid = await player('child');
    const mum = await player('adult', 'Mum');
    await kid.post('/api/social/friends/request', { code: mum.me.code });
    await mum.post('/api/social/friends/respond', { fid: kid.me.fid, accept: true });
    await post(kid, 100);
    await post(mum, 700);
    const b = await friendsOf(kid);
    expect(b.entries.map((e) => e.score)).toEqual([700, 100]);
    expect(b.entries.find((e) => !e.you)?.name).toBe('Mum');
    const c = await app.call('GET', `/api/social/leaderboard?game=${GAME}&scope=country`, { dev: kid.dev, headers: where('TR') });
    expect(c.status).toBe(403);
    expect(c.body.error).toBe('child_no_public');
    // a child's score is on no country board, not even for the adults of the same country
    expect(names(await country(mum))).toEqual(['Mum']);
  });

  it('a friend who is blocked is no longer a friend and no longer on the board', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    await befriend(ada, bo);
    await post(bo, 900);
    expect(names(await friendsOf(ada))).toEqual(['Bo']);
    await ada.post('/api/social/blocks', { fid: bo.me.fid });
    expect(names(await friendsOf(ada))).toEqual([]);
  });

  it('with a hundred friends the board shows fifty of them and always the player\'s own line', async () => {
    const ada = await player('adult', 'Ada');
    const pids = seed(100, { score: (i) => 1000 + i });
    const insert = app.db.raw.prepare('INSERT INTO soc_friends (pid, friend, since) VALUES (?, ?, 0)');
    for (const p of pids) insert.run(ada.pid(), p);
    await post(ada, 10);
    const b = await friendsOf(ada);
    expect(b.entries).toHaveLength(SCORES.boardSize + 1);
    expect(b.entries[0]).toMatchObject({ rank: 1, score: 1099 });
    expect(b.entries.at(-1)).toMatchObject({ name: 'Ada', you: true, rank: 101 });
    expect(b.you).toEqual({ score: 10, rank: 101, atLeast: false });
  });
});

// ───────── country boards ─────────

describe('the country board', () => {
  it('lists the players of the same age group in the same country, best first, with no friend id', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    const cy = await player('adult', 'Cy');
    const teen = await player('teen');
    const teen2 = await player('teen');
    await post(ada, 700, { c: 'TR' });
    await post(bo, 900, { c: 'TR' });
    await post(cy, 5000, { c: 'DE' });
    await post(teen, 3000, { c: 'TR' });
    await post(teen2, 100, { c: 'TR' });
    const b = await country(ada, 'TR');
    expect(b).toMatchObject({ scope: 'country', country: 'TR' });
    expect(b.entries).toEqual([{ rank: 1, name: 'Bo', score: 900, you: false }, { rank: 2, name: 'Ada', score: 700, you: true }]);
    expect(b.you).toEqual({ score: 700, rank: 2, atLeast: false });
    expect(JSON.stringify(b)).not.toMatch(/fid|pid/);
    expect(names(await country(cy, 'DE'))).toEqual(['Cy']);
    // the teens have a board of their own; an adult's board never shows them and theirs never shows adults
    const t = await country(teen, 'TR');
    expect(t.entries.map((e) => e.score)).toEqual([3000, 100]);
    expect(t.entries.every((e) => /^[A-Z][a-z]+ [A-Z][a-z]+/.test(e.name) || e.name.length > 0)).toBe(true);
  });

  it('is the board of the country the player is in, and where that is not known there is none', async () => {
    const ada = await player('adult', 'Ada');
    await post(ada, 700, { c: 'TR' });
    expect((await country(ada, 'TR')).entries).toHaveLength(1);
    expect((await country(ada, 'DE')).entries).toEqual([]);           // travelling: this country's board, which is empty
    const none = await app.call<{ board: BoardView }>('GET', `/api/social/leaderboard?game=${GAME}&scope=country`, { dev: ada.dev });
    expect(none.body.board).toMatchObject({ country: null, entries: [], you: null });
    // a score posted from nowhere is on the friends boards and on no country board
    const bo = await player('adult', 'Bo');
    const run = await app.call<{ run: string }>('POST', '/api/social/scores/start', { dev: bo.dev, body: { game: GAME } });
    vi.setSystemTime(Date.now() + 60_000);
    await app.call('POST', '/api/social/scores', { dev: bo.dev, body: { run: run.body.run, game: GAME, score: 100 } });
    expect(app.db.raw.prepare("SELECT country FROM soc_scores WHERE pid = ?").get(bo.pid())).toEqual({ country: '' });
    expect(names(await country(ada, 'TR'))).toEqual(['Ada']);
  });

  it('leaves out players the viewer blocked, players who blocked the viewer, and players suspended from public play', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    const cy = await player('adult', 'Cy');
    const dee = await player('adult', 'Dee');
    const eve = await player('adult', 'Eve');
    const fay = await player('adult', 'Fay');
    for (const p of [ada, bo, cy, dee, eve, fay]) await post(p, 100 + [ada, bo, cy, dee, eve, fay].indexOf(p) * 10);
    await befriend(ada, bo);
    await befriend(cy, ada);
    await ada.post('/api/social/blocks', { fid: bo.me.fid });            // Ada blocked Bo
    await cy.post('/api/social/blocks', { fid: ada.me.fid });            // Cy blocked Ada
    app.db.raw.prepare('UPDATE soc_profiles SET public_blocked_until = ? WHERE pid = ?').run(WED + DAY, dee.pid());
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(WED + DAY, eve.pid());
    resetBoardCache();
    expect(names(await country(ada))).toEqual(['Fay', 'Ada']);
    // somebody who blocked nobody sees everybody who may be seen
    expect(names(await country(fay))).toEqual(['Fay', 'Cy', 'Bo', 'Ada']);
    // once the suspension is over the player is back
    vi.setSystemTime(WED + 2 * DAY);
    resetBoardCache();
    expect(names(await country(fay))).toEqual(['Fay', 'Eve', 'Dee', 'Cy', 'Bo', 'Ada']);
  });

  it('a score from the same minute ranks the player who got there first higher', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    await post(bo, 400);
    await post(ada, 400);
    expect((await country(ada)).entries.map((e) => `${e.rank}:${e.name}`)).toEqual(['1:Bo', '1:Ada']);
  });

  it('shows the first fifty, and tells a player further down their place: exact up to a hundred, "at least" beyond', async () => {
    seed(130, { score: (i) => 10_000 - i * 10 });
    const ada = await player('adult', 'Ada');
    await post(ada, 7000);                                         // all 130 seeded players (10000 .. 8710) are ahead
    let b = await country(ada);
    expect(b.entries).toHaveLength(SCORES.boardSize);
    expect(b.entries.some((e) => e.you)).toBe(false);
    expect(b.you).toEqual({ score: 7000, rank: SCORES.rankCap + 2, atLeast: true });
    // fewer ahead than the bound: the rank is exact
    app.db.raw.exec('DELETE FROM soc_scores WHERE score > 9600');           // 90 seeded players are left ahead of her
    resetBoardCache();
    b = await country(ada);
    expect(b.you).toEqual({ score: 7000, rank: 91, atLeast: false });
    expect(b.entries).toHaveLength(SCORES.boardSize);
  });

  it('a player inside the fetched eighty but beyond the first fifty is added to the list as their own line', async () => {
    seed(60, { score: (i) => 10_000 - i * 10 });
    const ada = await player('adult', 'Ada');
    await post(ada, 9_000);                                        // behind all sixty seeded players (10000 .. 9410)
    const b = await country(ada);
    expect(b.entries).toHaveLength(SCORES.boardSize + 1);
    expect(b.entries.at(-1)).toMatchObject({ name: 'Ada', you: true });
    expect(b.you?.rank).toBe(b.entries.at(-1)?.rank);
  });

  it('answers from memory for half a minute, and the player\'s own new best shows at once', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    await post(ada, 300);
    expect(names(await country(ada))).toEqual(['Ada']);
    app.db.raw.prepare("INSERT INTO soc_scores (wk, game, pid, score, at, grp, country) VALUES (?, ?, ?, 900, ?, 'adult', 'TR')").run(weekOf(WED), GAME, bo.pid(), Date.now());
    app.db.resetCounters();
    expect(names(await country(ada))).toEqual(['Ada']);               // a second isolate wrote Bo; this one still has the old board
    expect(app.db.counters.statements).toBeLessThan(6);               // the player's own row and the block lists, not the board
    vi.setSystemTime(Date.now() + 31_000);
    expect(names(await country(ada))).toEqual(['Bo', 'Ada']);
    await post(ada, 1200, { ms: 90_000 });
    expect(names(await country(ada))).toEqual(['Ada', 'Bo']);          // her own new best does not wait for the clock
  });

  it('the previous week keeps its own board', async () => {
    const ada = await player('adult', 'Ada');
    await post(ada, 300);
    vi.setSystemTime(WED + 7 * DAY);
    await post(ada, 50);
    expect((await country(ada)).entries.map((e) => e.score)).toEqual([50]);
    const was = await country(ada, 'TR', GAME, 'previous');
    expect(was.entries.map((e) => e.score)).toEqual([300]);
    expect(was.week.current).toBe(false);
  });

  it('reads the country from the request: the Cloudflare country field first, the header after it, junk never', async () => {
    const ada = await player('adult', 'Ada');
    await post(ada, 300, { c: 'tr' });                               // lower case is fine
    expect(app.db.raw.prepare('SELECT country FROM soc_scores').get()).toEqual({ country: 'TR' });
    for (const junk of ['XX', 'T1', 'TUR', '']) expect((await country(ada, junk)).country, junk).toBeNull();
  });

  it('answers a board request that makes no sense with 400, and reads no more than the index', async () => {
    const ada = await player('adult');
    for (const q of ['game=xyz', `game=${GAME}&scope=world`, `game=${GAME}&week=next`, '']) {
      const r = await app.call('GET', `/api/social/leaderboard?${q}`, { dev: ada.dev, headers: where('TR') });
      expect(r.status, q).toBe(400);
    }
    // the country query goes through the board index in its order: no table scan, no sort
    const seen: string[] = [];
    const original = app.db.execute.bind(app.db);
    app.db.execute = (sql, params) => { if (/FROM soc_scores s JOIN soc_profiles p/.test(sql) && /s\.country/.test(sql)) seen.push(sql); return original(sql, params); };
    await country(ada);
    app.db.execute = original;
    expect(seen).toHaveLength(1);
    const plan = (app.db.raw.prepare(`EXPLAIN QUERY PLAN ${seen[0]}`).all(weekOf(WED), GAME, 'adult', 'TR', WED, 80) as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toContain('soc_scores_board');
    expect(plan).not.toContain('TEMP B-TREE');
    expect(plan).not.toMatch(/SCAN soc_scores(?! USING)/);
  });
});

// ───────── the player's own data and the housekeeping ─────────

describe('data, erasing and the sweep', () => {
  it('the export lists the best scores of this week and the last, and erasing the profile removes them', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    await post(ada, 300);
    await post(ada, 70, { game: 'knee-sprint' });
    await post(bo, 999);
    vi.setSystemTime(WED + 7 * DAY);
    await post(ada, 40);
    const out = (await ada.get('/api/social/me/export')).body.export as DataExport;
    expect(out.scores).toEqual([
      { week: weekOf(WED) + 1, game: GAME, score: 40 },
      { week: weekOf(WED), game: 'knee-sprint', score: 70 },
      { week: weekOf(WED), game: GAME, score: 300 },
    ]);
    const adaPid = ada.pid();
    expect((await ada.post('/api/social/me/delete', { confirm: 'delete' })).status).toBe(200);
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_scores WHERE pid = ?').get(adaPid)).toEqual({ n: 0 });
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_scores').get()).toEqual({ n: 1 });
  });

  it('the daily sweep keeps the current week and the one before it', async () => {
    seed(1, { score: () => 5, wk: weekOf(WED) });
    seed(1, { score: () => 6, wk: weekOf(WED) - 1, country: 'DE' });
    seed(1, { score: () => 7, wk: weekOf(WED) - 2, country: 'FR' });
    seed(1, { score: () => 8, wk: weekOf(WED) - 40, country: 'ES' });
    const r = await sweep(app.db, WED);
    expect(r.scores).toBe(2);
    expect((app.db.raw.prepare('SELECT score FROM soc_scores ORDER BY score').all() as { score: number }[]).map((x) => x.score)).toEqual([5, 6]);
  });
});
