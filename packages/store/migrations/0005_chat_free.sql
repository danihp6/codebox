-- 0005_chat_free.sql — `chat_sessions.repo_id` becomes nullable so a chat can be born free (D43).
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- Twelve-step rebuild: the children are `chat_messages.chat_id`, `run_events.chat_id` and
-- `approvals.chat_id` (ON DELETE CASCADE), `routines.chat_session_id`,
-- `schedules.chat_session_id` and `schedule_fires.chat_id` (ON DELETE SET NULL). They all name
-- `chat_sessions`, so the old table is dropped first and the new one takes its name; with
-- foreign keys disabled by the runner the drop cannot cascade. The runner runs
-- `PRAGMA foreign_key_check` before the commit.

CREATE TABLE chat_sessions_new (
  id                  TEXT PRIMARY KEY,
  repo_id             TEXT REFERENCES repos(id) ON DELETE RESTRICT,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('idle', 'working', 'archived')),
  opencode_session_id TEXT,
  worktree            TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'repo' CHECK (kind IN ('free', 'repo', 'schedule')),
  usage_usd           REAL NOT NULL DEFAULT 0,
  usage_tokens_in     INTEGER NOT NULL DEFAULT 0,
  usage_tokens_out    INTEGER NOT NULL DEFAULT 0,
  context_tokens      INTEGER NOT NULL DEFAULT 0,
  context_epoch       INTEGER NOT NULL DEFAULT 1 CHECK (context_epoch >= 1),
  reviewed_at         TEXT
);

INSERT INTO chat_sessions_new (
  id, repo_id, title, status, opencode_session_id, worktree, created_at, updated_at,
  kind, usage_usd, usage_tokens_in, usage_tokens_out, context_tokens, context_epoch, reviewed_at
)
SELECT
  id, repo_id, title, status, opencode_session_id, worktree, created_at, updated_at,
  kind, usage_usd, usage_tokens_in, usage_tokens_out, context_tokens, context_epoch, reviewed_at
FROM chat_sessions;

DROP TABLE chat_sessions;
ALTER TABLE chat_sessions_new RENAME TO chat_sessions;

CREATE INDEX chat_sessions_repo ON chat_sessions (repo_id, updated_at DESC);
CREATE INDEX chat_sessions_kind ON chat_sessions (kind, updated_at DESC);
