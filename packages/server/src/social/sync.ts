// Synced documents: a few small JSON documents per profile, so a second device, or the same device after the browser cleared
// its data and the profile came back with the recovery code, can pick up where the player was (the daily challenge and the
// streak, progress, plans, preferences). The server keeps them as they are and does not read them; what is in them and how two
// copies are merged is the store module's business (core/store).
//
//   GET /api/social/sync            -> {docs: {daily: {rev, at, data}, ...}}   every document of the player
//   PUT /api/social/sync/:key       {baseRev, data} -> {rev, at}
//
// A write names the revision it was made from. If the document moved on in the meantime (another device wrote), the answer is
// 409 `conflict` with the current document, the client merges its change into it and writes again (client.updateSync does
// this). A document is at most 3,000 characters of JSON and may be written 60 times a day: a client that writes in a loop
// costs a bounded number of rows (one per write; there is no index).
import { DAY } from '../../../core/social/rules.ts';
import { SYNC_MAX_CHARS, SYNC_WRITES_PER_DAY, isSyncKey, type SyncDoc } from '../../../core/social/types.ts';
import { HttpError } from '../http.ts';
import { one, rows, run } from './db.ts';
import type { SocialHandler } from './util.ts';

interface Row { k: string; rev: number; data: string; at: number }

const parse = (text: string): unknown => { try { return JSON.parse(text) as unknown; } catch { return null; } };
const doc = (r: Pick<Row, 'rev' | 'data' | 'at'>): SyncDoc => ({ rev: r.rev, at: r.at, data: parse(r.data) });

/** Every document of a player (the data export and GET /api/social/sync). */
export async function syncDocs(db: Parameters<typeof rows>[0], pid: string): Promise<Record<string, SyncDoc>> {
  const out: Record<string, SyncDoc> = {};
  for (const r of await rows<Row>(db, 'SELECT k, rev, data, at FROM soc_sync WHERE pid = ?1 ORDER BY k', pid)) out[r.k] = doc(r);
  return out;
}

export const getSync: SocialHandler = async (c) => ({ docs: await syncDocs(c.db, c.me.pid) });

export const putSync: SocialHandler = async (c) => {
  const { db, me, now, body: b } = c;
  const key = c.params.key;
  if (!isSyncKey(key)) throw new HttpError(400, 'bad_request', { field: 'key' });
  const baseRev = b.baseRev;
  if (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 0) throw new HttpError(400, 'bad_request', { field: 'baseRev' });
  if (b.data === undefined) throw new HttpError(400, 'bad_request', { field: 'data' });
  const text = JSON.stringify(b.data);
  if (text.length > SYNC_MAX_CHARS) throw new HttpError(413, 'payload_too_large', { max: SYNC_MAX_CHARS });
  const day = Math.floor(now / DAY);
  const cur = await one<Row & { wday: number; wn: number }>(db, 'SELECT k, rev, data, at, wday, wn FROM soc_sync WHERE pid = ?1 AND k = ?2', me.pid, key);
  const conflict = (row: Row | null): HttpError => new HttpError(409, 'conflict', { current: row ? doc(row) : null });
  if ((cur?.rev ?? 0) !== baseRev) throw conflict(cur);
  const writes = cur && cur.wday === day ? cur.wn : 0;
  if (writes >= SYNC_WRITES_PER_DAY) throw new HttpError(429, 'rate_limited', { retryAfterMs: (day + 1) * DAY - now });
  const changed = cur
    ? await run(db, 'UPDATE soc_sync SET rev = rev + 1, data = ?3, at = ?4, wday = ?5, wn = ?6 WHERE pid = ?1 AND k = ?2 AND rev = ?7', me.pid, key, text, now, day, writes + 1, baseRev)
    : await run(db, 'INSERT OR IGNORE INTO soc_sync (pid, k, rev, data, at, wday, wn) VALUES (?1, ?2, 1, ?3, ?4, ?5, 1)', me.pid, key, text, now, day);
  if (changed === 0) {
    // another request wrote between our read and our write
    throw conflict(await one<Row>(db, 'SELECT k, rev, data, at FROM soc_sync WHERE pid = ?1 AND k = ?2', me.pid, key));
  }
  return { rev: baseRev + 1, at: now };
};
