// Test support (never imported by the Worker): the production Worker (src/index.ts, every module on one router) bundled
// with esbuild and run in Miniflare, i.e. in workerd with the real Durable Objects (the directory with its SQLite storage and
// its hibernating WebSockets), real WebCrypto and the same assets arrangement as wrangler.jsonc. The Miniflare tests and the
// multi-browser suite (tests/social) both start it. The bundle's entry is stack-entry.ts: the production Worker plus a clock
// the test holds and moves (`stack.clock`), so nothing here sleeps to let the server's time pass, and a way to run SQL on the
// directory's tables (`stack.db`).
//
//   const stack = await startStack();                       // listening on a free local port; the tables are made by the first request
//   const social = new SocialClient({ origin: stack.origin, keys: new MemoryKeyStore(), fetch, WebSocket });
//   await stack.clock.pin();  ...  await stack.clock.advance(3_000);  ...  await stack.clock.release();
//   ...
//   await stack.stop();
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { SqlLike, SqlResult, SqlStmt } from './db.ts';
import { DIRECTORY_NAME } from './env.ts';

export const STACK_ADMIN_TOKEN = 'stack-admin-token-0123456789abcdef';

export interface StackOptions {
  /** A folder served as the site's static assets (`/api/*` and the invitation and friend-link pages `/r/*`, `/f/*` go to the Worker first, as in production). */
  assetsDir?: string;
  /** Extra or replaced Worker vars and secrets. */
  vars?: Record<string, string>;
  /** Keeps the Durable Object storage in this folder (a restart test); memory when absent. */
  persistTo?: string;
}

/**
 * The Worker's own time (`Date.now()` in the Worker and in its Durable Objects). A test that depends on how much time passed
 * between two requests moves it instead of waiting: `pin()`, then `advance(ms)` for exactly that much, then `release()`.
 * Time only goes forward, and releasing never sets it back.
 */
export interface StackClock {
  /** The Worker's time now. */
  now(): Promise<number>;
  /** The clock stands still where it is, whatever the real time does, until `release()`. Returns the time it stands at. */
  pin(): Promise<number>;
  /** Moves the clock forward by `ms` (a pinned clock jumps by exactly that much; a running one is ahead from now on). */
  advance(ms: number): Promise<number>;
  /** The clock runs again, from where it stands. */
  release(): Promise<number>;
}

export interface Stack {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** The Worker's clock, for the tests whose verdict depends on the time between two requests. */
  clock: StackClock;
  /** Everything the Worker wrote with console.log, one entry per line. Production code logs JSON events (`evt`). */
  logs: string[];
  /** The directory's tables: tests read and write them directly (each call is one request to the object that holds them). */
  db: SqlLike;
  mf: Miniflare;
  /** The logged events with this `evt` name. */
  events(evt: string): Record<string, unknown>[];
  /** Evicts the directory object from memory while the players' WebSockets stay connected (they hibernate), as the platform does when idle. */
  evictDirectory(): Promise<void>;
  stop(): Promise<void>;
}

let bundled: Promise<string> | null = null;

/** The Worker as one ES module (cached for the process): the production Worker with the test clock (stack-entry.ts). */
export function workerBundle(): Promise<string> {
  bundled ??= build({
    entryPoints: [fileURLToPath(new URL('./stack-entry.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'],
    logLevel: 'silent',
  }).then((r) => {
    const out = r.outputFiles[0];
    if (!out) throw new Error('the Worker bundle is empty');
    return out.text;
  });
  return bundled;
}

/** A SqlLike whose statements run in the directory object, through the test route of the Worker (stack-entry.ts). */
function remoteSql(origin: string): SqlLike {
  const send = async (statements: { sql: string; params: unknown[] }[], mode: 'first' | 'all' | 'run' | 'batch'): Promise<Record<string, unknown>> => {
    const res = await fetch(`${origin}/api/__test/sql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statements, mode }) });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(body.error ?? `the test SQL route answered ${res.status}`));
    return body;
  };
  class RemoteStmt implements SqlStmt {
    readonly sql: string;
    readonly params: unknown[];
    constructor(sql: string, params: unknown[] = []) { this.sql = sql; this.params = params; }
    bind(...values: unknown[]): SqlStmt { return new RemoteStmt(this.sql, values.map((v) => (v === undefined ? null : v))); }
    async first<T = Record<string, unknown>>(): Promise<T | null> { return ((await send([this], 'first')).row as T | null) ?? null; }
    async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> { return (await send([this], 'all')).result as SqlResult<T>; }
    async run(): Promise<SqlResult> { return (await send([this], 'run')).result as SqlResult; }
  }
  return {
    prepare: (sql) => new RemoteStmt(sql),
    async batch(stmts) { return (await send(stmts.map((x) => x as RemoteStmt), 'batch')).results as SqlResult[]; },
  };
}

export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const code = await workerBundle();
  const logs: string[] = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: [{ type: 'ESModule', path: 'worker.mjs', contents: code }],
    compatibilityDate: '2026-09-01',
    host: '127.0.0.1',
    port: 0,
    durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, SOCIAL: { className: 'SocialDirectory', useSQLite: true } },
    bindings: {
      TICKET_SECRET: 'stack-ticket-secret-0123456789abcdef0123456789',
      PUBLIC_ORIGIN: 'https://bodyarcade.test',
      ADMIN_TOKEN: STACK_ADMIN_TOKEN,
      SOCIAL_NO_LIMITS: '1',
      LIVE_NO_LIMITS: '1',
      TEST_CLOCK: '1',
      ...opts.vars,
    },
    ...(opts.assetsDir ? { assets: { directory: opts.assetsDir, binding: 'ASSETS', routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/api/*', '/f/*', '/r/*'] } }, assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: 'single-page-application' } } } : {}),
    ...(opts.persistTo ? { resourcePersistencePath: opts.persistTo } : {}),
    handleStructuredLogs: (l: { message: string }) => { for (const line of String(l.message).split('\n')) logs.push(line); },
  } as Parameters<typeof convertV4MiniflareOptions>[0]));
  const url = await mf.ready;
  const db = remoteSql(url.origin);
  const clockCall = async (op: 'now' | 'pin' | 'advance' | 'release', ms = 0): Promise<number> => {
    const res = await fetch(`${url.origin}/api/__test/clock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ms }) });
    if (!res.ok) throw new Error(`the test clock answered ${res.status}`);
    return ((await res.json()) as { now: number }).now;
  };
  return {
    origin: url.origin,
    clock: { now: () => clockCall('now'), pin: () => clockCall('pin'), advance: (ms) => clockCall('advance', ms), release: () => clockCall('release') },
    logs,
    db,
    mf,
    events: (evt) => logs.flatMap((l) => {
      try { const v = JSON.parse(l) as Record<string, unknown>; return v.evt === evt ? [v] : []; } catch { return []; }
    }),
    evictDirectory: () => mf.unsafeEvictDurableObject('', 'SocialDirectory', { name: DIRECTORY_NAME, webSockets: 'hibernate' }),
    stop: () => mf.dispose(),
  };
}
