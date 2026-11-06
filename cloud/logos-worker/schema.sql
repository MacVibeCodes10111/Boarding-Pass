-- D1 database bp-uploads. Safe to run again. Drops the first design's `logos`
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
-- Who uses each picture, per channel: dev and the real game stay apart.
CREATE TABLE IF NOT EXISTS logo_owners (
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('main', 'dev')),
  hash TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel, hash)
);
CREATE INDEX IF NOT EXISTS logo_owners_hash ON logo_owners (hash);
CREATE TABLE IF NOT EXISTS uploads_log (user_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS uploads_log_user ON uploads_log (user_id, at);
