-- BodyArcade social module, part 2: weekly boards. Applied after 0001 by `wrangler d1 migrations apply`.
--
-- One row per player, game and week: the best score. A score that is not a best writes nothing. The boards keep the current
-- week and the one before it (the daily sweep removes older rows). Nothing about a run is kept except its best score.
--
-- Free-plan cost of a row: the first score of a game in a week writes the row and two index entries; a better score rewrites
-- the row and one index entry (soc_scores_pid does not change). See budget.test.ts.
CREATE TABLE soc_scores (
  -- Week id: weeks since Monday 5 January 1970 (UTC), see core/social/scores.ts weekOf().
  wk INTEGER NOT NULL,
  game TEXT NOT NULL,
  pid TEXT NOT NULL,
  score INTEGER NOT NULL,
  -- When the best was made (server time). Of two equal scores the one made first ranks higher.
  at INTEGER NOT NULL,
  -- The age band of the player. Country boards are per band (teens and adults never share one); children are on friends boards only.
  grp TEXT NOT NULL CHECK (grp IN ('child', 'teen', 'adult')),
  -- Two letters from the request (Cloudflare's country of the caller), or '' when it was not known: the country board the score is on.
  country TEXT NOT NULL,
  -- How many times this best was beaten this week: the cap on writes of one player (core/social/scores.ts SCORES.improvementsPerWeek).
  n INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (wk, game, pid)
) STRICT, WITHOUT ROWID;
-- A country board: the best first, with no sort. A friends board reads one row of the primary key per friend.
CREATE INDEX soc_scores_board ON soc_scores (wk, game, grp, country, score DESC, at);
-- A player's own rows: the data export and the erase.
CREATE INDEX soc_scores_pid ON soc_scores (pid, wk);
