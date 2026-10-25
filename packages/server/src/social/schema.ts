// The tables of the social module: profiles, friends, presence, the lobby directory, weekly boards, synced documents and the
// moderation queue. They live in the SQLite storage of the one SocialDirectory Durable Object (directory.ts); the numbered
// versions below are applied in order when the object starts, each in one transaction, and the number reached is kept in
// `soc_meta`. A change to a table is a new entry at the end of VERSIONS (never an edit of an old one): an object that
// already holds data runs only the entries it has not seen.
//
// Every table is prefixed soc_. Free-plan budget (Durable Object SQLite: 100,000 rows written and 5,000,000 rows read a day
// for the whole account, index entries counted): the heavy writers are presence (one row per status change and one per
// four-minute heartbeat), lobbies (one row per room change) and counters (one row per limited action). See budget.test.ts.
import type { DoSqlStorage } from './db.ts';

export interface SchemaVersion {
  version: number;
  statements: readonly string[];
}

export const VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    statements: [
      // One row per player. pid is the secret profile id (never sent to a client); fid is what friends see; code is the six
      // characters of the friend code (BA-XXXXXX without the prefix). Under-18 players never have a typed name or a typed note.
      // seen_day is the day number (epoch ms / 86,400,000) of the last request, written at most once a day, used to retire
      // unused profiles. recovery is a hash of the profile id and the code that gets the profile back on a new device ('' = the
      // profile has none); the code itself is shown to the player once and never stored.
      `CREATE TABLE soc_profiles (
        pid TEXT PRIMARY KEY,
        fid TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        band TEXT NOT NULL CHECK (band IN ('child', 'teen', 'adult')),
        level INTEGER NOT NULL DEFAULT 1,
        region TEXT NOT NULL,
        lang TEXT NOT NULL DEFAULT 'en',
        dnd INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        seen_day INTEGER NOT NULL DEFAULT 0,
        muted_until INTEGER NOT NULL DEFAULT 0,
        public_blocked_until INTEGER NOT NULL DEFAULT 0,
        banned_until INTEGER NOT NULL DEFAULT 0,
        recovery TEXT NOT NULL DEFAULT ''
      ) STRICT`,

      // The device keys that may sign for a profile (kid = first 22 characters of base64url(SHA-256(raw public key))).
      `CREATE TABLE soc_devices (
        kid TEXT PRIMARY KEY,
        pid TEXT NOT NULL,
        pub TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT`,
      `CREATE INDEX soc_devices_pid ON soc_devices (pid)`,

      // A friendship is two rows, one for each side, so every list is a single index range.
      `CREATE TABLE soc_friends (
        pid TEXT NOT NULL,
        friend TEXT NOT NULL,
        since INTEGER NOT NULL,
        PRIMARY KEY (pid, friend)
      ) STRICT, WITHOUT ROWID`,

      `CREATE TABLE soc_requests (
        from_pid TEXT NOT NULL,
        to_pid TEXT NOT NULL,
        at INTEGER NOT NULL,
        via TEXT NOT NULL DEFAULT 'code',
        PRIMARY KEY (from_pid, to_pid)
      ) STRICT, WITHOUT ROWID`,
      `CREATE INDEX soc_requests_to ON soc_requests (to_pid)`,

      `CREATE TABLE soc_blocks (
        pid TEXT NOT NULL,
        target TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (pid, target)
      ) STRICT, WITHOUT ROWID`,
      `CREATE INDEX soc_blocks_target ON soc_blocks (target)`,

      // A declined request keeps its sender out for a week (rules.ts DECLINE_COOLDOWN_MS).
      `CREATE TABLE soc_declines (
        from_pid TEXT NOT NULL,
        to_pid TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (from_pid, to_pid)
      ) STRICT, WITHOUT ROWID`,
      `CREATE INDEX soc_declines_to ON soc_declines (to_pid)`,

      // Fixed-window counters for the abuse limits: k = <scope>:<limit name>:<window id>, exp = when the row may be deleted.
      `CREATE TABLE soc_limits (
        k TEXT PRIMARY KEY,
        n INTEGER NOT NULL,
        exp INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID`,
      `CREATE INDEX soc_limits_exp ON soc_limits (exp)`,

      // Presence. online = a hub socket is open (set when the socket opens, cleared when the last one closes); c_* is what the
      // client said about solo play; room / r_* is what the Room itself said (authoritative: the client cannot claim a room).
      `CREATE TABLE soc_presence (
        pid TEXT PRIMARY KEY,
        online INTEGER NOT NULL DEFAULT 0,
        seen_at INTEGER NOT NULL,
        c_status TEXT NOT NULL DEFAULT 'online',
        c_game TEXT,
        room TEXT,
        r_state TEXT,
        r_game TEXT,
        changed_at INTEGER NOT NULL
      ) STRICT`,

      // Every room the Room reports (public and private): the lobby directory and the "can my friend still be joined" check.
      // pids is a JSON array of member device ids and never leaves the server: it is only used to hide blocked pairs.
      `CREATE TABLE soc_lobbies (
        code TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('public', 'private')),
        grp TEXT,
        region TEXT NOT NULL,
        game TEXT NOT NULL,
        band TEXT,
        size INTEGER NOT NULL,
        players INTEGER NOT NULL,
        open INTEGER NOT NULL,
        names TEXT NOT NULL,
        pids TEXT NOT NULL,
        phase TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT`,
      // Only the columns that never change for a room: phase, open and players change on every join and every round, and an
      // index that contained them would be rewritten each time (a row write each). The few live rooms of one game are filtered
      // on the row.
      `CREATE INDEX soc_lobbies_dir ON soc_lobbies (kind, grp, game)`,

      // The moderation queue. reporter becomes NULL when the reporter deletes their data; the target's name is blanked when the
      // target does. evidence is the JSON list of chat lines the Room saw (at most 50).
      `CREATE TABLE soc_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        reporter TEXT,
        target TEXT NOT NULL,
        target_fid TEXT NOT NULL,
        target_name TEXT NOT NULL,
        target_band TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('friend', 'room')),
        room TEXT,
        match_id TEXT,
        note TEXT,
        evidence TEXT,
        urgent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
        handled_at INTEGER,
        handled_action TEXT
      ) STRICT`,
      `CREATE INDEX soc_reports_queue ON soc_reports (status, urgent, at)`,
      `CREATE INDEX soc_reports_target ON soc_reports (target, at)`,
      `CREATE INDEX soc_reports_reporter ON soc_reports (reporter, at)`,

      // What a moderator did, and what automatic rules did.
      `CREATE TABLE soc_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT
      ) STRICT`,
      `CREATE INDEX soc_audit_at ON soc_audit (at)`,

      // Weekly boards: one row per player, game and week, the best score. A score that is not a best writes nothing. The boards
      // keep the current week and the one before it (the daily sweep removes older rows). Nothing about a run is kept except
      // its best score. The first score of a game in a week writes the row and two index entries; a better score rewrites the
      // row and one index entry (soc_scores_pid does not change). See budget.test.ts.
      //   wk       weeks since Monday 5 January 1970 (UTC), see core/social/scores.ts weekOf().
      //   at       when the best was made (server time). Of two equal scores the one made first ranks higher.
      //   grp      the age band of the player. Country boards are per band (teens and adults never share one); children are on
      //            friends boards only.
      //   country  two letters from the request (Cloudflare's country of the caller), or '' when it was not known.
      //   n        how many times this best was beaten this week: the cap on writes of one player (SCORES.improvementsPerWeek).
      `CREATE TABLE soc_scores (
        wk INTEGER NOT NULL,
        game TEXT NOT NULL,
        pid TEXT NOT NULL,
        score INTEGER NOT NULL,
        at INTEGER NOT NULL,
        grp TEXT NOT NULL CHECK (grp IN ('child', 'teen', 'adult')),
        country TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (wk, game, pid)
      ) STRICT, WITHOUT ROWID`,
      // A country board: the best first, with no sort. A friends board reads one row of the primary key per friend.
      `CREATE INDEX soc_scores_board ON soc_scores (wk, game, grp, country, score DESC, at)`,
      // A player's own rows: the data export and the erase.
      `CREATE INDEX soc_scores_pid ON soc_scores (pid, wk)`,

      // Synced documents (sync.ts): a few small JSON documents per profile (the daily challenge and the streak, progress, plans,
      // preferences) so that a second device, or the same device after the browser cleared its data and the profile came back
      // with the recovery code, can pick up where the player was. The server stores them as they are; what is in them and how
      // two copies are merged is up to the store module (core/store).
      //   k        which document: one of SYNC_KEYS in core/social/types.ts.
      //   rev      counts the writes; a write names the revision it was made from (baseRev), and is refused with the current
      //            document when the document has moved on.
      //   wday/wn  writes of this document today (the day number and the count): a client that writes in a loop costs a bounded
      //            number of rows.
      `CREATE TABLE soc_sync (
        pid TEXT NOT NULL,
        k TEXT NOT NULL,
        rev INTEGER NOT NULL,
        data TEXT NOT NULL,
        at INTEGER NOT NULL,
        wday INTEGER NOT NULL DEFAULT 0,
        wn INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pid, k)
      ) STRICT, WITHOUT ROWID`,
    ],
  },
  {
    version: 2,
    statements: [
      // The terms the player agreed to in the sign-up (core/social/rules.ts TERMS_VERSION, an ISO day) and when (epoch ms). '' and 0 =
      // not recorded: a profile made before this version, or by a client that did not send it. Both go with the profile when it is erased.
      `ALTER TABLE soc_profiles ADD COLUMN terms TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE soc_profiles ADD COLUMN terms_at INTEGER NOT NULL DEFAULT 0`,
    ],
  },
];

/** The newest schema version this code knows. */
export const SCHEMA_VERSION = VERSIONS[VERSIONS.length - 1]?.version ?? 0;

/** Every statement of every version, in order (the tests build a fresh database from this). */
export const ALL_STATEMENTS: readonly string[] = VERSIONS.flatMap((v) => v.statements);

const META_TABLE = 'CREATE TABLE IF NOT EXISTS soc_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT, WITHOUT ROWID';

/**
 * Brings the object's tables up to date: runs the versions it has not seen, each in one transaction. Synchronous, so the object
 * can run it before it answers anything (`blockConcurrencyWhile`). Returns the version the tables had and the one they have.
 */
export function migrate(storage: DoSqlStorage): { from: number; to: number } {
  storage.sql.exec(META_TABLE);
  const row = storage.sql.exec(`SELECT v FROM soc_meta WHERE k = 'schema'`).toArray()[0];
  const from = row ? Number(row.v) : 0;
  if (from > SCHEMA_VERSION) throw new Error(`the social tables are from a newer version (${from}, this code knows ${SCHEMA_VERSION})`);
  for (const v of VERSIONS) {
    if (v.version <= from) continue;
    storage.transactionSync(() => {
      for (const s of v.statements) storage.sql.exec(s);
      storage.sql.exec(`INSERT INTO soc_meta (k, v) VALUES ('schema', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, String(v.version));
    });
  }
  return { from, to: SCHEMA_VERSION };
}
