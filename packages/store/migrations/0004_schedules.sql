-- 0004_schedules.sql — the schedule object and its fires (D44, D46).
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- Additive: `jobs`, `runs` and `chat_sessions` are untouched; `jobs` keeps working as it is.
-- UNIQUE (schedule_id, scheduled_for) is the idempotency key of the claim: the tick claims on it.
-- Ids and timestamps are caller-supplied TEXT; booleans are INTEGER (0,1); money is REAL USD.

CREATE TABLE schedules (
  id                    TEXT PRIMARY KEY,
  repo_id               TEXT REFERENCES repos(id) ON DELETE RESTRICT,
  chat_session_id       TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  prompt                TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK (mode IN ('once', 'every', 'window')),
  cron                  TEXT,
  timezone              TEXT NOT NULL,
  window_start          TEXT,
  window_end            TEXT,
  cooldown_minutes      INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_minutes >= 0),
  max_fires             INTEGER CHECK (max_fires IS NULL OR max_fires >= 1),
  max_cost_per_fire_usd REAL CHECK (max_cost_per_fire_usd IS NULL OR max_cost_per_fire_usd >= 0),
  fire_policy           TEXT NOT NULL CHECK (fire_policy IN ('new_chat', 'continue')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  fires_count           INTEGER NOT NULL DEFAULT 0 CHECK (fires_count >= 0),
  spend_usd             REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  enabled               INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  policy                TEXT NOT NULL CHECK (policy IN ('auto', 'manual')),
  next_fire_at          TEXT,
  last_fired_at         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK ((mode = 'window') = (cron IS NULL)),
  CHECK ((mode = 'window') = (window_start IS NOT NULL AND window_end IS NOT NULL)),
  CHECK (window_start IS NULL OR window_start <> window_end),
  CHECK (repo_id IS NOT NULL OR chat_session_id IS NOT NULL)
);

CREATE TABLE schedule_fires (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  fired_at      TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('claimed', 'fired', 'skipped', 'failed')),
  run_id        TEXT REFERENCES runs(id) ON DELETE SET NULL,
  chat_id       TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  cost_usd      REAL NOT NULL DEFAULT 0,
  detail        TEXT,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX schedules_due            ON schedules (enabled, next_fire_at);
CREATE INDEX schedules_repo           ON schedules (repo_id, created_at DESC);
CREATE INDEX schedule_fires_schedule  ON schedule_fires (schedule_id, fired_at DESC);
