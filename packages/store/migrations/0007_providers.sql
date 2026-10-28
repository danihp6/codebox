-- 0007_providers.sql — the provider adapters and their failover accounts (D54).
-- Forward only: once applied this file is checksum-pinned, so a change needs a new migration.
-- A provider is an adapter; an account is a credential plus a position in the failover order.
-- Ids and timestamps are caller-supplied TEXT; money is REAL USD; UTC day is TEXT `YYYY-MM-DD`.

CREATE TABLE providers (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  auth_kind  TEXT NOT NULL CHECK (auth_kind IN ('oauth', 'token')),
  base_url   TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_accounts (
  id             TEXT PRIMARY KEY,
  provider_id    TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  credential_id  TEXT NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  state          TEXT NOT NULL CHECK (state IN ('active', 'exhausted', 'invalid', 'disabled')),
  reset_at       TEXT,
  budget_usd     REAL CHECK (budget_usd IS NULL OR budget_usd >= 0),
  used_today_usd REAL NOT NULL DEFAULT 0 CHECK (used_today_usd >= 0),
  used_today_day TEXT NOT NULL DEFAULT '1970-01-01',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (provider_id, label),
  CHECK (state <> 'exhausted' OR reset_at IS NOT NULL)
);

CREATE UNIQUE INDEX provider_accounts_credential ON provider_accounts (credential_id);
CREATE INDEX provider_accounts_selection ON provider_accounts (provider_id, state, priority, id);
CREATE INDEX provider_accounts_reset ON provider_accounts (state, reset_at);
