-- 0003_chat_scope.sql — the chat's scope, usage and context epoch (D43, D48).
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- `kind` defaults to 'repo' because every session that predates this migration was bound to a
-- repository (D36); the UPDATE states the backfill instead of relying on the column default.
-- `repo_id` stays NOT NULL here: dropping that constraint needs the twelve-step table rebuild,
-- and a rebuild inside the migration transaction would cascade-delete chat_messages and
-- run_events, whose foreign keys point at chat_sessions with ON DELETE CASCADE.

ALTER TABLE chat_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'repo'
  CHECK (kind IN ('free', 'repo', 'schedule'));
ALTER TABLE chat_sessions ADD COLUMN usage_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN usage_tokens_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN usage_tokens_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN context_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN context_epoch INTEGER NOT NULL DEFAULT 1
  CHECK (context_epoch >= 1);
ALTER TABLE chat_sessions ADD COLUMN reviewed_at TEXT;

UPDATE chat_sessions SET kind = 'repo' WHERE kind <> 'repo';

CREATE INDEX chat_sessions_kind ON chat_sessions (kind, updated_at DESC);
