// Test support (never imported by the Worker): the production Worker (src/index.ts, every module on one router) bundled
// with esbuild and run in Miniflare, i.e. in workerd with a real D1 database, real Durable Objects with hibernating
// WebSockets, real WebCrypto and the same assets arrangement as wrangler.jsonc. The Miniflare tests and the multi-browser
// suite (tests/social) both start it. The bundle's entry is stack-entry.ts: the production Worker plus a clock the test
// holds and moves (`stack.clock`), so nothing here sleeps to let the server's time pass.
//
//   const stack = await startStack();                       // migrations applied, listening on a free local port
//   const social = new SocialClient({ origin: stack.origin, keys: new MemoryKeyStore(), fetch, WebSocket });
//   await stack.clock.pin();  ...  await stack.clock.advance(3_000);  ...  await stack.clock.release();
//   ...
//   await stack.stop();
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { D1Like } from './db.ts';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));

export const STACK_ADMIN_TOKEN = 'stack-admin-token-0123456789abcdef';

export interface StackOptions {
  /** A folder served as the site's static assets (`/api/*` and the invitation and friend-link pages `/r/*`, `/f/*` go to the Worker first, as in production). */
  assetsDir?: string;
  /** Extra or replaced Worker vars and secrets. */
  vars?: Record<string, string>;
  /** Keeps the D1 and Durable Object storage in this folder (a restart test); memory when absent. */
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
  /** The social database: tests read and write it directly. */
  db: D1Like;
  mf: Miniflare;
  /** The logged events with this `evt` name. */
  events(evt: string): Record<string, unknown>[];
  /** Evicts the player's hub object from memory while its WebSockets stay connected (they hibernate), as the platform does when idle. */
  evictHub(pid: string): Promise<void>;
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

/** The statements of a migration file (the files hold one statement per `;` and `--` comment lines). */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line)) continue;
    cur += line + '\n';
    if (/;\s*$/.test(line)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Applies the files of packages/server/migrations in name order. */
export async function applyMigrations(db: D1Like, dir = `${SERVER_DIR}migrations`): Promise<number> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let n = 0;
  for (const f of files) {
    const stmts = splitSql(readFileSync(`${dir}/${f}`, 'utf8'));
    await db.batch(stmts.map((s) => db.prepare(s)));
    n += stmts.length;
  }
  return n;
}

export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const code = await workerBundle();
  const logs: string[] = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: [{ type: 'ESModule', path: 'worker.mjs', contents: code }],
    compatibilityDate: '2026-09-01',
    host: '127.0.0.1',
    port: 0,
    durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, HUB: { className: 'PlayerHub', useSQLite: true } },
    d1Databases: { DB: 'bodyarcade-social-test' },
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
  const db = (await mf.getD1Database('DB')) as unknown as D1Like;
  await applyMigrations(db);
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
    evictHub: (pid) => mf.unsafeEvictDurableObject('', 'PlayerHub', { name: pid, webSockets: 'hibernate' }),
    stop: () => mf.dispose(),
  };
}
