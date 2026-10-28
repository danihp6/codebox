-- 0006_works.sql — the D44/D51–D56 model: works, sessions, session messages and the legacy marker.
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- Additive on `runs`, `run_events` and `schedules`; no table is rebuilt and no row is migrated.
-- `schema_legacy` records the tables D44 retired as read-only for every reader.
-- Ids and timestamps are caller-supplied TEXT; booleans INTEGER (0, 1); money REAL USD; objects
-- and arrays JSON TEXT.

CREATE TABLE works (
  id               TEXT PRIMARY KEY,
  repo_id          TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  backlog_ref      TEXT NOT NULL,
  title            TEXT NOT NULL,
  prompt           TEXT NOT NULL,
  spec_sha         TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('queued', 'running', 'review', 'merged', 'failed', 'needs_decision', 'abandoned')),
  origin           TEXT NOT NULL CHECK (origin IN ('manual', 'backlog', 'schedule')),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts >= 1),
  usage_usd        REAL NOT NULL DEFAULT 0 CHECK (usage_usd >= 0),
  usage_tokens_in  INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_in >= 0),
  usage_tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_out >= 0),
  context_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (context_tokens >= 0),
  context_epoch    INTEGER NOT NULL DEFAULT 1 CHECK (context_epoch >= 1),
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX works_repo_state   ON works (repo_id, state, updated_at DESC);
CREATE INDEX works_repo_backlog ON works (repo_id, backlog_ref, created_at DESC);
-- One work in flight per backlog item: the D56 selection must never open a second run of it.
CREATE UNIQUE INDEX works_live_item ON works (repo_id, backlog_ref)
  WHERE state IN ('queued', 'running', 'needs_decision');

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  repo_id             TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  target              TEXT NOT NULL CHECK (target IN ('backlog', 'design', 'schedule', 'work', 'repo')),
  work_id             TEXT REFERENCES works(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('idle', 'working', 'archived')),
  opencode_session_id TEXT,
  worktree            TEXT,
  branch              TEXT,
  pending_proposal    TEXT,
  usage_usd           REAL NOT NULL DEFAULT 0 CHECK (usage_usd >= 0),
  usage_tokens_in     INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_in >= 0),
  usage_tokens_out    INTEGER NOT NULL DEFAULT 0 CHECK (usage_tokens_out >= 0),
  context_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (context_tokens >= 0),
  context_epoch       INTEGER NOT NULL DEFAULT 1 CHECK (context_epoch >= 1),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK ((target = 'work') = (work_id IS NOT NULL))
);

CREATE INDEX sessions_repo   ON sessions (repo_id, updated_at DESC);
CREATE INDEX sessions_target ON sessions (repo_id, target, updated_at DESC);
CREATE INDEX sessions_work   ON sessions (work_id) WHERE work_id IS NOT NULL;

CREATE TABLE session_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX session_messages_session ON session_messages (session_id, created_at);

-- D44: the chat tables are retired. They stay readable and their rows are never rewritten by
-- new code; the refusal triggers land with the removal of their last writer (Task-76).
CREATE TABLE schema_legacy (
  table_name TEXT PRIMARY KEY,
  retired_by TEXT NOT NULL,
  read_only  INTEGER NOT NULL CHECK (read_only = 1)
);

INSERT INTO schema_legacy (table_name, retired_by, read_only) VALUES
  ('chat_sessions', 'D44', 1),
  ('chat_messages', 'D44', 1);

ALTER TABLE runs ADD COLUMN work_id TEXT REFERENCES works(id) ON DELETE SET NULL;
CREATE INDEX runs_work_created ON runs (work_id, created_at DESC);

ALTER TABLE run_events ADD COLUMN work_id TEXT REFERENCES works(id) ON DELETE CASCADE;
ALTER TABLE run_events ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX run_events_work_seq ON run_events (work_id, seq) WHERE work_id IS NOT NULL;
CREATE UNIQUE INDEX run_events_session_seq ON run_events (session_id, seq) WHERE session_id IS NOT NULL;

-- D56: the schedule becomes the repository's. Additive on purpose: the legacy `/v1/schedules`
-- accessors still read title, prompt, chat_session_id, fire_policy and policy, and they are
-- retired by a later task; a rebuild that made repo_id NOT NULL would break them here.
ALTER TABLE schedules ADD COLUMN selection TEXT NOT NULL DEFAULT 'nextPending'
  CHECK (selection IN ('nextPending', 'refs'));
ALTER TABLE schedules ADD COLUMN refs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE schedules ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 2
  CHECK (max_attempts >= 1);
-- D56: one D56 schedule per repository. The predicate is `title = ''`, the sentinel a D56 row
-- writes: the legacy `/v1/schedules` rows carry a real title and stay insertable until Task-76
-- removes their last writer, so a plain unique index on `repo_id` would break the tree.
CREATE UNIQUE INDEX schedules_one_per_repo ON schedules (repo_id)
  WHERE repo_id IS NOT NULL AND title = '';
