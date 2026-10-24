// The slice of SQL storage the entitlement engine uses, and its schema.
//
// Synchronous on purpose: a Durable Object's SQLite storage answers synchronously, and a check followed by a write
// (is there a free seat? then take it) is only safe when no other request can run between the two. The engine awaits the
// outside services first and then does its reading and writing in one `tx` with no await inside.
//
// Tests run the very same SQL on node:sqlite (testkit.ts); the Workers runtime is covered by the Miniflare test.

export type Row = Record<string, unknown>;

export interface SqlDb {
  all<T = Row>(sql: string, ...params: unknown[]): T[];
  one<T = Row>(sql: string, ...params: unknown[]): T | null;
  run(sql: string, ...params: unknown[]): void;
  /** Runs `fn` as one atomic unit (all or nothing). `fn` must not await. */
  tx<T>(fn: () => T): T;
}

/** What a Durable Object's `ctx.storage.sql.exec` hands back. */
export interface DoSqlCursor {
  toArray(): Row[];
}

/** The parts of a SQLite-backed Durable Object's storage this module touches. */
export interface DoSqlStorage {
  sql: { exec(query: string, ...bindings: unknown[]): DoSqlCursor };
  transactionSync<T>(fn: () => T): T;
}

/** SQL does not take undefined (D1 and Durable Objects both refuse it) and has no booleans. */
export const clean = (v: unknown): unknown => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** A Durable Object's storage as a SqlDb. */
export function sqlDbOfDurableObject(storage: DoSqlStorage): SqlDb {
  const exec = (sql: string, params: unknown[]): Row[] => storage.sql.exec(sql, ...params.map(clean)).toArray();
  return {
    all: <T = Row>(sql: string, ...params: unknown[]): T[] => exec(sql, params) as T[],
    one: <T = Row>(sql: string, ...params: unknown[]): T | null => (exec(sql, params)[0] as T | undefined) ?? null,
    run: (sql, ...params) => { exec(sql, params); },
    tx: (fn) => storage.transactionSync(fn),
  };
}

/** Bumped when the tables change; `migrate` knows how to get from each older number to the next. */
export const SCHEMA_VERSION = 1;

const SCHEMA_V1: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`,
  // One row per purchase, named by the SHA-256 of the licence key or of the Play purchase token. Neither is kept.
  `CREATE TABLE IF NOT EXISTS purchases (
     sub TEXT PRIMARY KEY,
     src TEXT NOT NULL,
     plan TEXT NOT NULL,
     product TEXT NOT NULL,
     status TEXT NOT NULL,
     paid_until INTEGER,
     checked_at INTEGER NOT NULL,
     first_seen INTEGER NOT NULL,
     started_at INTEGER,
     trial_end INTEGER,
     test INTEGER NOT NULL DEFAULT 0
   ) WITHOUT ROWID`,
  // A seat is one device using one purchase. 'did' is the device's random identifier.
  `CREATE TABLE IF NOT EXISTS seats (
     sub TEXT NOT NULL,
     did TEXT NOT NULL,
     first_at INTEGER NOT NULL,
     last_at INTEGER NOT NULL,
     PRIMARY KEY (sub, did)
   ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS seats_idle ON seats (last_at)`,
  // The address a player gave for the one trial reminder. Deleted when the mail is sent (or can no longer be).
  `CREATE TABLE IF NOT EXISTS reminders (
     sub TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     lang TEXT NOT NULL,
     send_at INTEGER NOT NULL,
     trial_end INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     tries INTEGER NOT NULL DEFAULT 0
   ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS reminders_due ON reminders (send_at)`,
];

/** Creates or upgrades the tables. Safe to run at every start. */
export function migrate(db: SqlDb): void {
  db.tx(() => {
    db.run(SCHEMA_V1[0] as string);
    const row = db.one<{ v: string }>(`SELECT v FROM meta WHERE k = 'schema'`);
    const have = row ? Number(row.v) : 0;
    if (have > SCHEMA_VERSION) throw new Error(`the database is from a newer version (${have})`);
    if (have < 1) for (const stmt of SCHEMA_V1.slice(1)) db.run(stmt);
    if (have !== SCHEMA_VERSION) db.run(`INSERT INTO meta (k, v) VALUES ('schema', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, String(SCHEMA_VERSION));
  });
}

/** A value kept in the meta table (the address-hash salt, for one). */
export function metaGet(db: SqlDb, key: string): string | null {
  return db.one<{ v: string }>(`SELECT v FROM meta WHERE k = ?1`, key)?.v ?? null;
}

export function metaSet(db: SqlDb, key: string, value: string): void {
  db.run(`INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, key, value);
}
