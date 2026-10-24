-- BodyArcade social module, part 4: synced documents (see src/social/sync.ts). Applied after 0003.
--
-- A few small JSON documents per profile (the daily challenge and the streak, progress, plans, preferences) so that a second
-- device, or the same device after the browser cleared its data and the profile came back with the recovery code, can pick up
-- where the player was. The server stores them as they are; what is in them and how two copies are merged is up to the store
-- module (core/store). One row per document: a write is one row (there is no index to maintain).
CREATE TABLE soc_sync (
  pid TEXT NOT NULL,
  -- Which document: one of SYNC_KEYS in core/social/types.ts.
  k TEXT NOT NULL,
  -- Counts the writes. A write names the revision it was made from (baseRev); if the document has moved on, the write is
  -- refused with the current document and the client merges and writes again.
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  -- Writes of this document today (the day number and the count), so a client that writes in a loop costs a bounded number of rows.
  wday INTEGER NOT NULL DEFAULT 0,
  wn INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pid, k)
) STRICT, WITHOUT ROWID;
