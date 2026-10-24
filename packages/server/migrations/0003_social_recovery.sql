-- BodyArcade social module, part 3: the recovery code (see src/social/recovery.ts). Applied after 0002.
--
-- A hash of the profile id and the code that gets the profile back on a new device; '' means the profile has none (it cannot be
-- recovered). The code itself is shown to the player once and never stored.
ALTER TABLE soc_profiles ADD COLUMN recovery TEXT NOT NULL DEFAULT '';
