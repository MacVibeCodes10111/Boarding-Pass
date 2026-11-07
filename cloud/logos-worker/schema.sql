-- D1 database bp-uploads, as it is now. Safe to run again on a new or current database;
-- one made before 2026-11-07 needs migrate-2026-11-07.sql instead. Drops the first design's `logos`
-- table, which was never used (the Worker hadn't been deployed).
DROP TABLE IF EXISTS logos;
CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY CHECK (id = 1), bytes INTEGER NOT NULL DEFAULT 0, objects INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO usage (id, bytes, objects) VALUES (1, 0, 0);
-- One row per picture. status: pending, approved or rejected. A rejected one keeps its row with bytes 0, so it can't return.
CREATE TABLE IF NOT EXISTS logo_files (
  hash TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS logo_files_status ON logo_files (status, created_at);
-- Which shared airline (its public id) uses each picture, per channel: dev and the real game stay apart.
CREATE TABLE IF NOT EXISTS logo_owners (
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('main', 'dev')),
  airline TEXT NOT NULL,
  hash TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel, airline, hash)
);
CREATE INDEX IF NOT EXISTS logo_owners_hash ON logo_owners (hash);
CREATE TABLE IF NOT EXISTS uploads_log (user_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS uploads_log_user ON uploads_log (user_id, at);
-- Friends' schedules (A4): one file per shared airline, counted in usage. The newest version is what viewers ask for.
CREATE TABLE IF NOT EXISTS schedules (
  channel TEXT NOT NULL CHECK (channel IN ('main', 'dev')),
  public_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel, public_id)
);
CREATE INDEX IF NOT EXISTS schedules_user ON schedules (user_id, channel);
