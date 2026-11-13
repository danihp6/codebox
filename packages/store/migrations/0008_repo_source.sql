-- 0008_repo_source.sql — a repository is local first: `source` and `name` are new and `slug` is
-- the optional remote coordinate (D62), so a row can describe a repository with no remote.
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- Twelve-step rebuild, because SQLite cannot drop `slug`'s NOT NULL in place. The children are
-- `jobs.repo_id`, `runs.repo_id`, `works.repo_id`, `sessions.repo_id`, `chat_sessions.repo_id`,
-- `routines.repo_id` and `schedules.repo_id`; they all name `repos`, so the old table is dropped
-- first and the new one takes its name, and with foreign keys disabled by the runner the drop
-- cannot cascade. The runner runs `PRAGMA foreign_key_check` before the commit.
-- `name` is backfilled from the slug with the rule `nameFromSlug` applies in the store: the part
-- after the first `/`, lowercased, cut at 64 characters.

CREATE TABLE repos_new (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'github' CHECK (source IN ('local', 'github')),
  name            TEXT NOT NULL,
  slug            TEXT,
  default_branch  TEXT NOT NULL,
  gate            TEXT NOT NULL,
  policy          TEXT NOT NULL CHECK (policy IN ('auto', 'manual')),
  protected_paths TEXT NOT NULL,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at      TEXT NOT NULL,
  CHECK (source <> 'github' OR slug IS NOT NULL)
);

INSERT INTO repos_new (id, source, name, slug, default_branch, gate, policy,
                       protected_paths, enabled, created_at)
SELECT
  id,
  'github',
  substr(lower(CASE WHEN instr(slug, '/') > 0 THEN substr(slug, instr(slug, '/') + 1)
                    ELSE slug END), 1, 64),
  slug, default_branch, gate, policy, protected_paths, enabled, created_at
FROM repos;

DROP TABLE repos;
ALTER TABLE repos_new RENAME TO repos;

-- A unique index allows many NULLs, so two local repositories with no remote never collide while
-- two github rows with the same slug still do.
CREATE UNIQUE INDEX repos_slug ON repos (slug);
-- Partial on purpose: a local repository named `example` and a github repository `dani/example`
-- are two rows about two different things and both may exist.
CREATE UNIQUE INDEX repos_local_name ON repos (name) WHERE source = 'local';
