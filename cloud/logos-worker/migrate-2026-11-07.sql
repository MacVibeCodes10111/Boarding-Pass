-- Logos and schedules per shared airline (2026-11-07). Run once, on a database made
-- with schema.sql from before this date. Afterwards schema.sql describes it.
--
-- Old logo rows don't know their airline: give them the player's one shared airline
-- straight after (UPDATE logo_owners SET airline = '<public id>' WHERE user_id = '<user>'),
-- or they wait until the player's next upload replaces them, or their account is deleted.
CREATE TABLE logo_owners_new (
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('main', 'dev')),
  airline TEXT NOT NULL,
  hash TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel, airline, hash)
);
INSERT INTO logo_owners_new (user_id, channel, airline, hash, seen_at) SELECT user_id, channel, '', hash, seen_at FROM logo_owners;
DROP TABLE logo_owners;
ALTER TABLE logo_owners_new RENAME TO logo_owners;
CREATE INDEX IF NOT EXISTS logo_owners_hash ON logo_owners (hash);

CREATE TABLE schedules_new (
  channel TEXT NOT NULL CHECK (channel IN ('main', 'dev')),
  public_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel, public_id)
);
INSERT INTO schedules_new (channel, public_id, user_id, bytes, version, updated_at) SELECT channel, public_id, user_id, bytes, version, updated_at FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
CREATE INDEX IF NOT EXISTS schedules_user ON schedules (user_id, channel);
