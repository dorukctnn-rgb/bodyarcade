// The slice of Cloudflare D1 the social module uses, declared here so the Worker code type-checks without
// @cloudflare/workers-types and so tests can run the very same queries on node:sqlite (testkit.ts) and on real D1 in
// workerd (Miniflare). D1 refuses `undefined` as a bound value, so every helper turns it into null.

export interface D1Meta { changes?: number; rows_read?: number; rows_written?: number; last_row_id?: number }
export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta: D1Meta }

export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Like {
  prepare(sql: string): D1Stmt;
  /** Runs the statements in one transaction: all or nothing. */
  batch(stmts: D1Stmt[]): Promise<D1Result[]>;
}

const clean = (v: unknown): unknown => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** A prepared statement with its values bound. */
export function stmt(db: D1Like, sql: string, ...params: unknown[]): D1Stmt {
  return db.prepare(sql).bind(...params.map(clean));
}

export async function one<T = Record<string, unknown>>(db: D1Like, sql: string, ...params: unknown[]): Promise<T | null> {
  return stmt(db, sql, ...params).first<T>();
}

export async function rows<T = Record<string, unknown>>(db: D1Like, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await stmt(db, sql, ...params).all<T>()).results;
}

/** Runs a write and returns how many rows it changed. */
export async function run(db: D1Like, sql: string, ...params: unknown[]): Promise<number> {
  const r = await stmt(db, sql, ...params).run();
  return r.meta.changes ?? 0;
}

/** A UNIQUE constraint failure (the caller retries with a new random value). */
export function isUniqueError(e: unknown): boolean {
  return /UNIQUE constraint failed|constraint failed: .*(UNIQUE|PRIMARY)/i.test(String((e as { message?: unknown })?.message ?? e));
}
