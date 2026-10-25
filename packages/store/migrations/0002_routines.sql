-- 0002_routines.sql — the two tables of routine chat schedules (D38).
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- UNIQUE (routine_id, scheduled_for) is the idempotency key of D38: the scheduler claims on it.
-- Ids and timestamps are caller-supplied TEXT; booleans are INTEGER (0,1); objects are JSON TEXT.

CREATE TABLE routines (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('prompt', 'reminder')),
  title           TEXT NOT NULL,
  cron            TEXT NOT NULL,
  timezone        TEXT NOT NULL,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  notify          INTEGER NOT NULL CHECK (notify IN (0, 1)),
  repo_id         TEXT REFERENCES repos(id) ON DELETE RESTRICT,
  prompt          TEXT,
  chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  next_fire_at    TEXT,
  last_fired_at   TEXT,
  created_at      TEXT NOT NULL,
  CHECK (kind <> 'prompt' OR (repo_id IS NOT NULL AND prompt IS NOT NULL AND prompt <> '')),
  CHECK (kind <> 'reminder' OR (repo_id IS NULL AND prompt IS NULL AND chat_session_id IS NULL))
);

CREATE TABLE routine_fires (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id    TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  fired_at      TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('claimed', 'sent', 'replied', 'failed', 'skipped')),
  detail        TEXT,
  UNIQUE (routine_id, scheduled_for)
);

CREATE INDEX routines_due            ON routines (enabled, next_fire_at);
CREATE INDEX routines_created        ON routines (created_at DESC, id DESC);
CREATE INDEX routine_fires_routine   ON routine_fires (routine_id, scheduled_for DESC);
