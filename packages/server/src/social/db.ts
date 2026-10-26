// The slice of SQL the social module uses, in the shape of Cloudflare's D1 API (prepare, bind, first, all, run, batch), so every
// query in the module reads the same wherever it runs. The social database is the SQLite storage of one Durable Object
// (SocialDirectory, directory.ts): `sqlOfDurableObject` serves this interface from `ctx.storage.sql`. Tests run the very same
// queries on node:sqlite (testkit.ts) and, in workerd, on the real Durable Object (the Miniflare tests).
//
// The calls are async only in their signature: a Durable Object's SQL answers synchronously, so a read followed by a write with
// nothing but microtasks between them cannot be interleaved with another request. A handler that awaits something real (a
// signature check, a hash) between the two must not rely on that, and none does: every write is conditional or idempotent.
// Undefined is refused by some SQL back ends, so every helper turns it into null (and a boolean into 0 or 1).

export interface SqlMeta { changes?: number; rows_read?: number; rows_written?: number }
export interface SqlResult<T = Record<string, unknown>> { results: T[]; success: boolean; meta: SqlMeta }

export interface SqlStmt {
  bind(...values: unknown[]): SqlStmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<SqlResult>;
}

export interface SqlLike {
  prepare(sql: string): SqlStmt;
  /** Runs the statements in one transaction: all or nothing. */
  batch(stmts: SqlStmt[]): Promise<SqlResult[]>;
}

const clean = (v: unknown): unknown => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** A prepared statement with its values bound. */
export function stmt(db: SqlLike, sql: string, ...params: unknown[]): SqlStmt {
  return db.prepare(sql).bind(...params.map(clean));
}

export async function one<T = Record<string, unknown>>(db: SqlLike, sql: string, ...params: unknown[]): Promise<T | null> {
  return stmt(db, sql, ...params).first<T>();
}

export async function rows<T = Record<string, unknown>>(db: SqlLike, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await stmt(db, sql, ...params).all<T>()).results;
}

/** Runs a write and returns how many rows it changed. */
export async function run(db: SqlLike, sql: string, ...params: unknown[]): Promise<number> {
  const r = await stmt(db, sql, ...params).run();
  return r.meta.changes ?? 0;
}

/** A UNIQUE constraint failure (the caller retries with a new random value). */
export function isUniqueError(e: unknown): boolean {
  return /UNIQUE constraint failed|constraint failed: .*(UNIQUE|PRIMARY)|SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)/i.test(String((e as { message?: unknown })?.message ?? e));
}

// ───────── a Durable Object's SQLite storage as SqlLike ─────────

/** What `ctx.storage.sql.exec` hands back. */
export interface DoSqlCursor {
  toArray(): Record<string, unknown>[];
  readonly rowsRead?: number;
  readonly rowsWritten?: number;
}

/** The parts of a SQLite-backed Durable Object's storage this module touches. */
export interface DoSqlStorage {
  sql: { exec(query: string, ...bindings: unknown[]): DoSqlCursor };
  transactionSync<T>(fn: () => T): T;
}

/** Statements that change rows: their `changes` is read right after they ran. */
const WRITES = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

/** What a Durable Object's SQL did: the numbers its bill is made of (rows read and written, indexes included). */
export interface SqlMeter { statements: number; rowsRead: number; rowsWritten: number }

/**
 * A Durable Object's storage as SqlLike. `meter` (optional) is added to after every statement: the directory logs it, the tests
 * read it. The module writes numbered placeholders (`?1`, `?2`, one number used twice); SQLite binds them by position, so the
 * statements go through as they are.
 */
export function sqlOfDurableObject(storage: DoSqlStorage, meter?: SqlMeter): SqlLike {
  class DoStmt implements SqlStmt {
    readonly sql: string;
    private readonly params: unknown[];
    constructor(sql: string, params: unknown[] = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...values: unknown[]): SqlStmt {
      return new DoStmt(this.sql, values);
    }
    /** Runs the statement now. Only used inside this adapter (and inside `batch`'s transaction). */
    exec(): SqlResult {
      const cursor = storage.sql.exec(this.sql, ...this.params);
      const results = cursor.toArray();
      let changes = 0;
      if (WRITES.test(this.sql)) changes = Number(storage.sql.exec('SELECT changes() AS n').toArray()[0]?.n ?? 0);
      if (meter) {
        meter.statements++;
        meter.rowsRead += cursor.rowsRead ?? 0;
        meter.rowsWritten += cursor.rowsWritten ?? 0;
      }
      return { results, success: true, meta: { changes, rows_read: cursor.rowsRead ?? 0, rows_written: cursor.rowsWritten ?? 0 } };
    }
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      return (this.exec().results[0] as T | undefined) ?? null;
    }
    async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
      return this.exec() as SqlResult<T>;
    }
    async run(): Promise<SqlResult> {
      return this.exec();
    }
  }
  return {
    prepare: (sql) => new DoStmt(sql),
    async batch(stmts) {
      return storage.transactionSync(() => stmts.map((s) => {
        if (!(s instanceof DoStmt)) throw new Error('a statement of another database in this batch');
        return s.exec();
      }));
    },
  };
}
