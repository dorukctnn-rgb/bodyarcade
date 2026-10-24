// Abuse limits backed by D1 (soc_limits): fixed-window counters per player or per hashed address. A call that is already
// over its limit is refused after one read and writes nothing, so a script hammering a limited route cannot burn the
// database's daily write budget (100,000 row writes on the free plan).
import { HOUR, retryAfterMs, windowOf, limitKey, type LimitSpec } from '../../../core/social/rules.ts';
import { HttpError } from '../http.ts';
import { one, run, stmt, type SqlLike, type SqlStmt } from './db.ts';

type Spec = Pick<LimitSpec, 'name' | 'max' | 'windowMs'>;

const BUMP_SQL = 'INSERT INTO soc_limits (k, n, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET n = n + ?2 RETURNING n';

/** The counter increment as a statement, to run inside a batch together with the write it pays for (all or nothing). */
export function bumpStmt(db: SqlLike, scope: string, spec: Spec, now: number, by = 1): SqlStmt {
  return stmt(db, BUMP_SQL, limitKey(scope, spec, now), by, windowOf(now, spec.windowMs).end + HOUR);
}

/** How many times this scope has used the limit in the current window. */
export async function used(db: SqlLike, scope: string, spec: Spec, now: number): Promise<number> {
  const r = await one<{ n: number }>(db, 'SELECT n FROM soc_limits WHERE k = ?1', limitKey(scope, spec, now));
  return r?.n ?? 0;
}

/** Counts one use and returns the new count. Writes one row. */
export async function bump(db: SqlLike, scope: string, spec: Spec, now: number, by = 1): Promise<number> {
  const r = await bumpStmt(db, scope, spec, now, by).first<{ n: number }>();
  return r?.n ?? by;
}

/** Throws 429 when the limit is used up; otherwise counts one use. */
export async function enforce(db: SqlLike, scope: string, spec: Spec, now: number, code = 'rate_limited'): Promise<number> {
  if ((await used(db, scope, spec, now)) >= spec.max) throw new HttpError(429, code, { retryAfterMs: retryAfterMs(spec, now) });
  return bump(db, scope, spec, now);
}

/** Throws 429 when the limit is already used up; counts nothing (for counting only failures, `bump` is called by the caller). */
export async function guard(db: SqlLike, scope: string, spec: Spec, now: number, code = 'rate_limited'): Promise<void> {
  if ((await used(db, scope, spec, now)) >= spec.max) throw new HttpError(429, code, { retryAfterMs: retryAfterMs(spec, now) });
}

/** Deletes counters whose window is long over. Returns the rows removed. */
export async function sweepLimits(db: SqlLike, now: number): Promise<number> {
  return run(db, 'DELETE FROM soc_limits WHERE exp < ?1', now);
}
