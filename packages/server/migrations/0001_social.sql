-- BodyArcade social module (profiles, friends, presence, lobby directory, moderation).
-- Applied with `wrangler d1 migrations apply bodyarcade-social` (migrations_dir in wrangler.jsonc). Nothing here is
-- deployed yet. Every table is prefixed soc_ so other modules can share the database.
--
-- Free-plan budget (100,000 row writes a day): the heavy writers are presence (one row per status change and one per
-- four-minute heartbeat), lobbies (one row per room change) and counters (one row per limited action). See the budget
-- test in packages/server/src/social/budget.test.ts.

-- One row per player. pid is the secret profile id (never sent to a client); fid is what friends see; code is the six
-- characters of the friend code (BA-XXXXXX without the prefix). Under-18 players never have a typed name or a typed note.
CREATE TABLE soc_profiles (
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
  -- Day number (epoch ms / 86,400,000) of the last request; written at most once a day, used to retire unused profiles.
  seen_day INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0,
  public_blocked_until INTEGER NOT NULL DEFAULT 0,
  banned_until INTEGER NOT NULL DEFAULT 0
) STRICT;

-- The device keys that may sign for a profile (kid = first 22 characters of base64url(SHA-256(raw public key))).
CREATE TABLE soc_devices (
  kid TEXT PRIMARY KEY,
  pid TEXT NOT NULL,
  pub TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX soc_devices_pid ON soc_devices (pid);

-- A friendship is two rows, one for each side, so every list is a single index range.
CREATE TABLE soc_friends (
  pid TEXT NOT NULL,
  friend TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (pid, friend)
) STRICT, WITHOUT ROWID;

CREATE TABLE soc_requests (
  from_pid TEXT NOT NULL,
  to_pid TEXT NOT NULL,
  at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'code',
  PRIMARY KEY (from_pid, to_pid)
) STRICT, WITHOUT ROWID;
CREATE INDEX soc_requests_to ON soc_requests (to_pid);

CREATE TABLE soc_blocks (
  pid TEXT NOT NULL,
  target TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (pid, target)
) STRICT, WITHOUT ROWID;
CREATE INDEX soc_blocks_target ON soc_blocks (target);

-- A declined request keeps its sender out for a week (rules.ts DECLINE_COOLDOWN_MS).
CREATE TABLE soc_declines (
  from_pid TEXT NOT NULL,
  to_pid TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (from_pid, to_pid)
) STRICT, WITHOUT ROWID;
CREATE INDEX soc_declines_to ON soc_declines (to_pid);

-- Fixed-window counters for the abuse limits: k = <scope>:<limit name>:<window id>, exp = when the row may be deleted.
CREATE TABLE soc_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  exp INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX soc_limits_exp ON soc_limits (exp);

-- Presence. online = a hub socket is open (set by the hub, cleared on close). c_* is what the client said about solo play;
-- room / r_* is what the Room itself said (authoritative: the client cannot claim a room).
CREATE TABLE soc_presence (
  pid TEXT PRIMARY KEY,
  online INTEGER NOT NULL DEFAULT 0,
  seen_at INTEGER NOT NULL,
  c_status TEXT NOT NULL DEFAULT 'online',
  c_game TEXT,
  room TEXT,
  r_state TEXT,
  r_game TEXT,
  changed_at INTEGER NOT NULL
) STRICT;

-- Every room the Room reports (public and private): the lobby directory and the "can my friend still be joined" check.
-- pids is a JSON array of member device ids and never leaves the server: it is only used to hide blocked pairs.
CREATE TABLE soc_lobbies (
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
) STRICT;
-- Only the columns that never change for a room: phase, open and players change on every join and every round, and an index that
-- contained them would be rewritten each time (a free-plan row write each). The few live rooms of one game are filtered on the row.
CREATE INDEX soc_lobbies_dir ON soc_lobbies (kind, grp, game);

-- The moderation queue. reporter becomes NULL when the reporter deletes their data; the target's name is blanked when the
-- target does. evidence is the JSON list of chat lines the Room saw (at most 50).
CREATE TABLE soc_reports (
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
) STRICT;
CREATE INDEX soc_reports_queue ON soc_reports (status, urgent, at);
CREATE INDEX soc_reports_target ON soc_reports (target, at);
CREATE INDEX soc_reports_reporter ON soc_reports (reporter, at);

-- What a moderator did, and what automatic rules did.
CREATE TABLE soc_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
) STRICT;
CREATE INDEX soc_audit_at ON soc_audit (at);
