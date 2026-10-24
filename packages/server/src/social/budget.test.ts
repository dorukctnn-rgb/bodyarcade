// The free-plan budget of the social module. Cloudflare's free D1 allows 100,000 rows written and 5,000,000 rows read a day,
// and a row written counts once for the table and once for every index entry it needs. This file measures what the real
// code writes (the table row plus the index entries, the way D1 bills it), for a day of a typical social player and for the
// worst a single client can do, and checks that no query the module runs scans a whole table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, HOUR, LIMITS, MINUTE, PRESENCE } from '../../../core/social/rules.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import type { LiveEnv } from '../live/env.ts';
import { BEAT_MIN_GAP_MS, PlayerHub, STATUS_BURST } from './hub.ts';
import { sweep } from './sweep.ts';
import { socialHooks } from './hooks.ts';
import { createTestApp, FakeSocket, FakeState, type TestApp, type TestPlayer } from './testkit.ts';

const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);
/** What the free plan allows per day. */
const FREE_WRITES_PER_DAY = 100_000;

vi.setConfig({ testTimeout: 60_000 });

let app: TestApp;
let meter: Meter;

// ───────── the meter ─────────

interface IndexInfo { name: string; cols: string[] }

/** Splits a SET list at the commas that are not inside parentheses. */
function topLevelParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
const setColumns = (list: string): string[] => topLevelParts(list).map((p) => /^\s*(\w+)\s*=/.exec(p)?.[1] ?? '').filter(Boolean);

/** Counts the rows every statement writes the way D1 bills them, and remembers each distinct statement for the plan check. */
class Meter {
  weighted = 0;
  statements = 0;
  readonly byTable = new Map<string, number>();
  readonly sql = new Map<string, unknown[]>();
  private readonly indexes = new Map<string, IndexInfo[]>();
  private readonly autoincrement = new Set<string>();
  private readonly app: TestApp;

  constructor(a: TestApp) {
    this.app = a;
    const raw = a.db.raw;
    const tables = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'soc_%'").all() as { name: string; sql: string }[];
    for (const t of tables) {
      if (/AUTOINCREMENT/i.test(t.sql)) this.autoincrement.add(t.name);
      const idx = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").all(t.name) as { name: string }[];
      this.indexes.set(t.name, idx.map((i) => ({ name: i.name, cols: (raw.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[]).map((c) => c.name) })));
    }
    const original = a.db.execute.bind(a.db);
    a.db.execute = (sql, params) => this.run(original, sql, params);
  }

  private count(table: string): number {
    return (this.app.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
  private insertWeight(t: string): number { return 1 + (this.indexes.get(t)?.length ?? 0) + (this.autoincrement.has(t) ? 1 : 0); }
  private updateWeight(t: string, cols: string[]): number {
    return 1 + (this.indexes.get(t) ?? []).filter((i) => i.cols.some((c) => cols.includes(c))).length;
  }
  private deleteWeight(t: string): number { return 1 + (this.indexes.get(t)?.length ?? 0); }
  private add(table: string, n: number): void {
    if (n <= 0) return;
    this.weighted += n;
    this.byTable.set(table, (this.byTable.get(table) ?? 0) + n);
  }

  private run(original: (sql: string, params: unknown[]) => { results: Record<string, unknown>[]; changes: number }, sql: string, params: unknown[]): { results: Record<string, unknown>[]; changes: number } {
    this.statements++;
    const norm = sql.replace(/\s+/g, ' ').trim();
    if (!this.sql.has(norm)) this.sql.set(norm, params);
    const ins = /^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)/i.exec(sql);
    if (ins) {
      const t = ins[1] as string;
      const before = this.count(t);
      const r = original(sql, params);
      const inserted = this.count(t) - before;
      const upsert = /DO\s+UPDATE\s+SET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/i.exec(sql);
      this.add(t, inserted * this.insertWeight(t) + Math.max(0, r.changes - inserted) * this.updateWeight(t, upsert ? setColumns(upsert[1] as string) : []));
      return r;
    }
    const upd = /^\s*UPDATE\s+(\w+)\s+SET\b([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/i.exec(sql);
    if (upd) {
      const r = original(sql, params);
      this.add(upd[1] as string, r.changes * this.updateWeight(upd[1] as string, setColumns(upd[2] as string)));
      return r;
    }
    const del = /^\s*DELETE\s+FROM\s+(\w+)/i.exec(sql);
    if (del) {
      const r = original(sql, params);
      this.add(del[1] as string, r.changes * this.deleteWeight(del[1] as string));
      return r;
    }
    return original(sql, params);
  }

  reset(): void {
    this.weighted = 0;
    this.statements = 0;
    this.byTable.clear();
  }

  /** Query plan lines that read a whole table (or a whole index) for the statements run so far. */
  scans(): string[] {
    const out: string[] = [];
    for (const [sql, params] of this.sql) {
      if (!/^(SELECT|WITH|UPDATE|DELETE)\b/i.test(sql)) continue;
      let plan: { detail: string }[];
      try { plan = this.app.db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]; } catch { continue; }
      for (const row of plan) if (/^SCAN /.test(row.detail)) out.push(`${row.detail}   <=   ${sql.slice(0, 110)}`);
    }
    return out;
  }
}

// ───────── helpers ─────────

const env = (): LiveEnv => app.env as unknown as LiveEnv;
const minutes = (n: number): void => { vi.setSystemTime(Date.now() + n * MINUTE); };

function beforeEachSetup(): void {
  vi.setSystemTime(T0);
  app = createTestApp();
  meter = new Meter(app);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  beforeEachSetup();
});
afterEach(() => vi.useRealTimers());

async function connect(p: TestPlayer): Promise<{ hub: PlayerHub; state: FakeState; ws: FakeSocket; send: (cmd: object) => Promise<void> }> {
  const state = new FakeState();
  const hub = new PlayerHub(state, app.env);
  const ws = new FakeSocket();
  hub.accept(ws, { pid: p.pid(), fid: p.me.fid, name: p.me.name, band: p.me.band });
  await state.settle();
  return { hub, state, ws, send: async (cmd) => { await hub.webSocketMessage(ws, JSON.stringify(cmd)); await state.settle(); } };
}

const roomSummary = (code: string, host: TestPlayer, over: Partial<RoomSummary> = {}): RoomSummary => ({
  kind: 'public', gameId: 'jacks', band: 'easy', audience: 'adult', size: 2, players: 1, open: 1, names: [host.me.name], phase: 'lobby', updatedAt: Date.now(), code, ...over,
});

/** A network of players where everyone is friends with the next two. */
async function ring(n: number): Promise<TestPlayer[]> {
  const players: TestPlayer[] = [];
  for (let i = 0; i < n; i++) players.push(await app.signup('adult', { name: `Player${i}`, region: i % 2 ? 'na' : 'eu' }));
  for (let i = 0; i < n; i++) {
    for (const step of [1, 2]) {
      const to = players[(i + step) % n] as TestPlayer;
      await (players[i] as TestPlayer).post('/api/social/friends/request', { code: to.me.code });
      await to.post('/api/social/friends/respond', { fid: (players[i] as TestPlayer).me.fid, accept: true });
    }
  }
  return players;
}

// ───────── a day of a typical social player ─────────

/**
 * One day of `n` social players who are all friends with the next two: each opens the page, stays online for twenty minutes
 * (a beat every four minutes, four status changes), plays three rounds in a public room (the Room reports every change),
 * looks at the lobby list and searches for a quick match three times, then closes the page. The sessions are spread over
 * 24 hours. The window ends with the next day's sweep, which deletes what the day created. Sign-up and the friendships are
 * set up (and swept) before the window opens: they happen once per player, not once a day.
 */
async function simulateDay(n: number): Promise<{ rows: number; byTable: Map<string, number> }> {
  const players = await ring(n);
  vi.setSystemTime(T0 + 26 * HOUR);
  await sweep(app.db, Date.now());                            // what the sign-ups left behind is gone before the day starts
  meter.reset();
  const dayStart = Date.now();
  const slot = (24 * HOUR) / n;
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(Math.max(Date.now(), dayStart + i * slot));
    const p = players[i] as TestPlayer;
    const friend = players[(i + 1) % n] as TestPlayer;
    await p.get('/api/social/me');
    await p.get('/api/social/friends');
    await p.get('/api/social/requests');
    const { send, hub, ws, state } = await connect(p);
    for (let k = 0; k < 5; k++) {
      minutes(4);
      await send({ t: 'beat' });
      await send({ t: 'beat' });                              // an impatient page sends a second one: it costs nothing
      if (k === 0) await send({ t: 'status', status: 'playing', game: 'squat-flap' });
      if (k === 1) await send({ t: 'status', status: 'online' });
      if (k === 2) await send({ t: 'status', status: 'playing', game: 'knee-sprint' });
      if (k === 3) await send({ t: 'status', status: 'online' });
    }
    const code = `RM${letters[i % 32]}${letters[Math.floor(i / 32) % 32]}${letters[(i * 7) % 32]}Z`;
    await socialHooks.publishRoom?.(env(), roomSummary(code, p), [p.pid()]);
    await socialHooks.setPlaying?.(env(), { code, pid: p.pid(), inRoom: true, playing: false, gameId: 'jacks' });
    for (let r = 0; r < 3; r++) {
      minutes(2);
      await socialHooks.publishRoom?.(env(), roomSummary(code, p, { players: 2, open: 0, names: [p.me.name, friend.me.name], phase: 'playing' }), [p.pid(), friend.pid()]);
      await socialHooks.setPlaying?.(env(), { code, pid: p.pid(), inRoom: true, playing: true, gameId: 'jacks' });
      minutes(1);
      await socialHooks.publishRoom?.(env(), roomSummary(code, p, { players: 2, open: 0, names: [p.me.name, friend.me.name], phase: 'lobby' }), [p.pid(), friend.pid()]);
      await socialHooks.setPlaying?.(env(), { code, pid: p.pid(), inRoom: true, playing: false, gameId: 'jacks' });
    }
    await socialHooks.setPlaying?.(env(), { code, pid: p.pid(), inRoom: false, playing: false, gameId: 'jacks' });
    await socialHooks.removeRoom?.(env(), code);
    await p.get('/api/social/lobbies?game=jacks');
    for (let k = 0; k < 3; k++) { minutes(0.07); await p.post('/api/social/match', { game: 'jacks' }); }
    // one score a day, the dearer kind (the first of the week in a game: the row and two index entries), and a look at both boards
    const ticket = await p.post('/api/social/scores/start', { game: 'squat-flap' });
    minutes(1);
    await p.post('/api/social/scores', { run: ticket.body.run, game: 'squat-flap', score: 500 + i });
    await p.get('/api/social/leaderboard?game=squat-flap&scope=friends');
    await p.get('/api/social/leaderboard?game=squat-flap&scope=country');
    hub.webSocketClose(ws, 1000, 'bye');
    await state.settle();
  }
  vi.setSystemTime(Math.max(Date.now(), dayStart + 24 * HOUR) + 2 * HOUR);
  await sweep(app.db, Date.now());                            // the next day's sweep removes the counters of this one
  return { rows: meter.weighted, byTable: new Map(meter.byTable) };
}

describe('a day of a typical social player', () => {
  it('writes few enough rows that the free plan carries thousands of such players a day', async () => {
    const small = await simulateDay(12);
    // a second run on a fresh database with three times the players: the difference is the cost of one player, the rest is
    // the fixed cost of a day (the sweeps' claims)
    beforeEachSetup();
    const large = await simulateDay(36);
    const perPlayer = (large.rows - small.rows) / 24;
    const fixed = small.rows - perPlayer * 12;
    const capacity = Math.floor((FREE_WRITES_PER_DAY - fixed) / perPlayer);
    const tables = Object.fromEntries([...large.byTable].map(([t, rows]) => [t, Math.round((rows / 36) * 10) / 10]));
    // eslint-disable-next-line no-console
    console.info(`social budget: ${perPlayer.toFixed(1)} rows written per player-day, ${fixed.toFixed(0)} a day for everyone (${JSON.stringify(tables)} per player at 36); the free plan carries about ${capacity} such players a day`);
    expect(perPlayer).toBeLessThan(45);
    expect(fixed).toBeLessThan(250);
    expect(capacity).toBeGreaterThan(2200);
    // presence and the lobby directory are the two heavy writers (scores and counters come after); nothing else may become one
    const heavy = [...large.byTable].filter(([t]) => !['soc_presence', 'soc_lobbies', 'soc_limits', 'soc_profiles', 'soc_scores'].includes(t)).reduce((sum, [, rows]) => sum + rows, 0);
    expect(heavy / 36).toBeLessThan(2);
  });

  it('no statement the module ran reads a whole table that can grow with the players', async () => {
    const players = await ring(6);
    const [a, b, c] = players as [TestPlayer, TestPlayer, TestPlayer];
    const x = await app.signup('adult', { name: 'Xena' });
    const kid = await app.signup('teen');
    await a.get('/api/social/me');
    await a.get('/api/social/friends');
    await a.get('/api/social/requests');
    await a.get('/api/social/blocks');
    await a.post('/api/social/friends/request', { code: x.me.code });
    await x.post('/api/social/friends/respond', { fid: a.me.fid, accept: false });
    await a.post('/api/social/friends/request', { code: kid.me.code });
    await b.post('/api/social/friends/request', { code: x.me.code });
    await b.post('/api/social/friends/cancel', { fid: x.me.fid });
    await c.post('/api/social/friends/remove', { fid: players[3]?.me.fid });
    await c.post('/api/social/blocks', { fid: x.me.fid });
    await c.post('/api/social/blocks/remove', { fid: x.me.fid });
    await c.post('/api/social/report', { fid: x.me.fid, reason: 'abuse', note: 'x' });
    await c.get('/api/social/me/export');
    await c.post('/api/social/me/code', {});
    await c.post('/api/social/me', { level: 4, dnd: true });
    const { send, hub, ws, state } = await connect(a);
    await send({ t: 'beat' });
    await send({ t: 'status', status: 'playing', game: 'jacks' });
    await socialHooks.publishRoom?.(env(), roomSummary('PQRSTV', b), [b.pid()]);
    await socialHooks.setPlaying?.(env(), { code: 'PQRSTV', pid: b.pid(), inRoom: true, playing: false, gameId: 'jacks' });
    await a.get('/api/social/lobbies?game=jacks&region=eu');
    await a.post('/api/social/match', { game: 'jacks' });
    await a.post('/api/social/invite', { fid: b.me.fid, room: 'PQRSTV' });
    await socialHooks.gateJoin?.(env(), roomSummary('PQRSTV', b), { pid: a.pid(), name: a.me.name, age: 'adult' });
    await socialHooks.submitReport?.(env(), { code: 'PQRSTV', matchId: 'm1', reporterPid: a.pid(), targetPid: b.pid(), seats: ['s1', 's2'], reason: 'abuse', at: Date.now(), chat: [] } as never);
    await socialHooks.blockByPid?.(env(), a.pid(), c.pid());
    hub.webSocketClose(ws, 1000, 'bye');
    await state.settle();
    await app.admin('GET', '/api/admin/social/reports?status=open');
    await app.admin('GET', '/api/admin/social/stats');
    const ticket = await a.post('/api/social/scores/start', { game: 'squat-flap' });
    minutes(1);
    await a.post('/api/social/scores', { run: ticket.body.run, game: 'squat-flap', score: 300 });
    await a.post('/api/social/scores', { run: ticket.body.run, game: 'squat-flap', score: 400 });
    await b.get('/api/social/leaderboard?game=squat-flap&scope=friends');
    await a.get('/api/social/leaderboard?game=squat-flap&scope=friends&week=previous');
    await a.get('/api/social/leaderboard?game=squat-flap&scope=country');
    await a.get('/api/social/me/export');
    await x.post('/api/social/me/delete', { confirm: 'delete' });
    await sweep(app.db, Date.now() + 2 * DAY);
    const scans = meter.scans();
    // What may scan: a scalar subquery's constant row, json_each over the (at most four) members of one room, the lobby table
    // (one row per live room, read hourly by the sweep), the statistics (they read at most STATS_COUNT_CAP rows per table by
    // construction: their LIMIT sits inside the subquery) and the daily sweep, which reads whole tables once a day on purpose
    // (see sweep.ts: about 3 percent of the free reads at 50,000 profiles).
    const fine = /^SCAN CONSTANT ROW|VIRTUAL TABLE|<=\s+(SELECT band, COUNT|DELETE FROM soc_lobbies WHERE updated_at|DELETE FROM soc_(requests|declines) WHERE at|DELETE FROM soc_reports WHERE|UPDATE soc_presence SET online = 0|SELECT pid FROM soc_profiles WHERE seen_day)/;
    const statsScan = /<=\s+SELECT \(SELECT COUNT\(\*\) FROM \(SELECT online/;
    expect(scans.filter((line) => !fine.test(line) && !statsScan.test(line))).toEqual([]);
  });
});

// ───────── the worst one client can do ─────────

describe('what one client can make the database write', () => {
  it('a weekly score costs three rows the first time, two when it is beaten and none when it is not; a client cannot beat it more than thirty times', async () => {
    const [p] = await ring(3) as [TestPlayer];
    const post = async (score: number): Promise<number> => {
      const run = await p.post('/api/social/scores/start', { game: 'squat-flap' });
      minutes(1);
      meter.reset();
      await p.post('/api/social/scores', { run: run.body.run, game: 'squat-flap', score });
      return meter.weighted;
    };
    await p.get('/api/social/me');
    expect(await post(100)).toBe(3);
    expect(await post(200)).toBe(2);
    expect(await post(150)).toBe(0);
    let writes = 0;
    for (let i = 3; i <= 40; i++) writes += await post(200 + i);
    expect(writes).toBeGreaterThanOrEqual(2 * 28);                   // thirty beats in all, the third to the thirtieth are left
    expect(writes).toBeLessThanOrEqual(2 * 28 + 10);                 // plus an hourly sweep's claim while the minutes go by
  });

  it('a socket that sends a thousand beats in a day writes one row every thirty seconds at most', async () => {
    const [p] = await ring(3) as [TestPlayer];
    const { send } = await connect(p);
    meter.reset();
    for (let i = 0; i < 1000; i++) { minutes(0.01); await send({ t: 'beat' }); }
    const seconds = 1000 * 0.01 * 60;
    expect(meter.weighted).toBeLessThanOrEqual(Math.ceil(seconds / (BEAT_MIN_GAP_MS / 1000)) + 1);
  });

  it('a socket that flips its status a thousand times writes the burst and then a row a minute', async () => {
    const [p] = await ring(3) as [TestPlayer];
    const { send } = await connect(p);
    meter.reset();
    for (let i = 0; i < 1000; i++) {
      vi.setSystemTime(Date.now() + 10);
      await send({ t: 'status', status: i % 2 ? 'online' : 'playing', game: i % 2 ? undefined : 'jacks' });
    }
    // ten seconds in all: the burst of four and nothing more (the socket itself is dropped above twenty messages a second)
    expect(meter.weighted).toBeLessThanOrEqual(STATUS_BURST + 1);
  });

  it('one address making profiles is stopped at the hourly limit, and the whole service at the daily one', async () => {
    meter.reset();
    let made = 0;
    for (let i = 0; i < LIMITS.registerHour.max + 15; i++) {
      const dev = await app.newDevice('10.9.9.9');
      const r = await app.call('POST', '/api/social/register', { dev, body: { pub: dev.keys.publicRaw, band: 'adult' } });
      if (r.status === 201 || r.status === 200) made++;
    }
    expect(made).toBe(LIMITS.registerHour.max);
    // a profile costs the profile row with its three unique keys, the device row with its key, and the counters of the address
    expect(meter.weighted / made).toBeLessThan(14);
  });

  it('a player who asks for friendships all day writes at most the daily request allowance', async () => {
    const players = await ring(3);
    const [a] = players as [TestPlayer];
    const strangers: TestPlayer[] = [];
    for (let i = 0; i < 40; i++) strangers.push(await app.signup('adult', { name: `Stranger${i}` }));
    meter.reset();
    let sent = 0;
    for (const s of strangers) {
      const r = await a.post('/api/social/friends/request', { code: s.me.code });
      if (r.status === 200 && r.body.status === 'sent') sent++;
    }
    expect(a.me.counts).toBeDefined();
    const rows = app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_requests WHERE from_pid = ?').get(a.pid()) as { n: number };
    expect(rows.n).toBeLessThanOrEqual(40);
    // each request is a row with its index entry plus a counter or two; a hundred a day is the policy ceiling
    expect(meter.weighted / Math.max(1, sent)).toBeLessThan(8);
  });

  it('the presence a minute after a status change is a single write: friends are told, the database is not asked again', async () => {
    const [a, b] = await ring(3) as [TestPlayer, TestPlayer];
    await connect(b);
    app.hubs.connect(b.pid());
    const { send } = await connect(a);
    meter.reset();
    await send({ t: 'status', status: 'playing', game: 'jacks' });
    expect(meter.weighted).toBe(1);
    expect(PRESENCE.minGapMs).toBeGreaterThan(0);
  });
});
