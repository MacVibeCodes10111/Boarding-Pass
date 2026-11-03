-- D1 database bp-uploads (already created and set up)
CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY CHECK (id = 1), bytes INTEGER NOT NULL DEFAULT 0, objects INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO usage (id, bytes, objects) VALUES (1, 0, 0);
CREATE TABLE IF NOT EXISTS logos (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, save_id TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS logos_user_save ON logos (user_id, save_id);
CREATE INDEX IF NOT EXISTS logos_user ON logos (user_id);
CREATE TABLE IF NOT EXISTS uploads_log (user_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS uploads_log_user ON uploads_log (user_id, at);
