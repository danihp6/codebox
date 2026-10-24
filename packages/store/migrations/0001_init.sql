-- 0001_init.sql — the ten tables of docs/architecture.md §2 that belong to v1.
-- Ids and timestamps are caller-supplied TEXT; booleans are INTEGER (0,1); objects are JSON TEXT.
-- The routines tables are migration 0002 (Task-34).

CREATE TABLE repos (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  default_branch  TEXT NOT NULL,
  gate            TEXT NOT NULL,
  policy          TEXT NOT NULL CHECK (policy IN ('auto', 'manual')),
  protected_paths TEXT NOT NULL,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at      TEXT NOT NULL
);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  title        TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('work')),
  agent        TEXT NOT NULL,
  model        TEXT,
  cron         TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  enabled      INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  policy       TEXT NOT NULL CHECK (policy IN ('auto', 'manual')),
  max_cost_usd REAL,
  next_fire_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE chat_sessions (
  id                  TEXT PRIMARY KEY,
  repo_id             TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('idle', 'working', 'archived')),
  opencode_session_id TEXT,
  worktree            TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text       TEXT NOT NULL,
  origin     TEXT NOT NULL CHECK (origin IN ('user', 'assistant', 'routine')),
  created_at TEXT NOT NULL
);

CREATE TABLE runs (
  id               TEXT PRIMARY KEY,
  repo_id          TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  job_id           TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  state            TEXT NOT NULL CHECK (state IN ('queued', 'preparing', 'running', 'gating', 'pr_open', 'merging', 'succeeded', 'failed', 'cancelled')),
  "trigger"        TEXT NOT NULL CHECK ("trigger" IN ('schedule', 'manual', 'promote', 'revert', 'retry')),
  branch           TEXT NOT NULL,
  base_ref         TEXT NOT NULL,
  base_sha         TEXT,
  worktree         TEXT,
  session_id       TEXT,
  prompt           TEXT NOT NULL,
  prompt_hash      TEXT,
  agent            TEXT NOT NULL,
  model            TEXT,
  gate_command     TEXT,
  scheduled_for    TEXT,
  attempt          INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  pr_number        INTEGER,
  pr_url           TEXT,
  pr_mergeable     INTEGER,
  gate_status      TEXT,
  gate_exit_code   INTEGER,
  gate_duration_ms INTEGER,
  guardrails       TEXT NOT NULL DEFAULT '[]',
  blockers         TEXT NOT NULL DEFAULT '[]',
  diff_files       INTEGER,
  diff_added       INTEGER,
  diff_removed     INTEGER,
  cost_usd         REAL NOT NULL DEFAULT 0,
  tokens_in        INTEGER NOT NULL DEFAULT 0,
  tokens_out       INTEGER NOT NULL DEFAULT 0,
  failure_code     TEXT,
  failure_message  TEXT,
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  finished_at      TEXT,
  UNIQUE (job_id, scheduled_for)
);

CREATE TABLE run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT REFERENCES runs(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
  seq     INTEGER,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts      TEXT NOT NULL
);

CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  state       TEXT NOT NULL CHECK (state IN ('pending', 'allowed', 'denied', 'expired')),
  tool        TEXT NOT NULL,
  title       TEXT NOT NULL,
  run_id      TEXT REFERENCES runs(id) ON DELETE CASCADE,
  chat_id     TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
  input       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (run_id IS NOT NULL OR chat_id IS NOT NULL)
);

CREATE TABLE devices (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  platform              TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'cli')),
  public_key            TEXT,
  fingerprint           TEXT,
  scopes                TEXT NOT NULL,
  refresh_token_hash    TEXT NOT NULL UNIQUE,
  refresh_previous_hash TEXT,
  refresh_expires_at    TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  last_seen_at          TEXT,
  revoked_at            TEXT
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT REFERENCES runs(id) ON DELETE SET NULL,
  repo_id    TEXT,
  day        TEXT NOT NULL,
  model      TEXT,
  tokens_in  INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_usd   REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX jobs_due              ON jobs (enabled, next_fire_at);
CREATE INDEX runs_repo_created     ON runs (repo_id, created_at DESC);
CREATE INDEX runs_state            ON runs (state);
CREATE INDEX runs_job_created      ON runs (job_id, created_at DESC);
CREATE UNIQUE INDEX run_events_run_seq  ON run_events (run_id, seq)  WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX run_events_chat_seq ON run_events (chat_id, seq) WHERE chat_id IS NOT NULL;
CREATE INDEX run_events_ts         ON run_events (ts);
CREATE INDEX approvals_state       ON approvals (state, created_at);
CREATE INDEX chat_messages_chat    ON chat_messages (chat_id, created_at);
CREATE INDEX chat_sessions_repo    ON chat_sessions (repo_id, updated_at DESC);
CREATE INDEX devices_revoked       ON devices (revoked_at);
CREATE INDEX usage_day_repo        ON usage (day, repo_id);
CREATE INDEX usage_run             ON usage (run_id);
