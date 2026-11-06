-- Account sync's tables. The server holds ciphertext, never a key or an email address: see docs/SYNC_DESIGN.md.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  salt TEXT,
  check_value TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store INTEGER NOT NULL,
  id_hash TEXT NOT NULL,
  seq INTEGER NOT NULL,
  size INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (user_id, store, id_hash)
);
CREATE INDEX IF NOT EXISTS records_by_seq ON records (user_id, seq);
CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
