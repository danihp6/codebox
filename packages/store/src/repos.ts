import type { Repo } from '@codebox/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { isForeignKeyViolation, isUniqueViolation } from './db.js';
import { StoreError } from './errors.js';
import {
  LIVE_RUN_STATES_SQL,
  booleanToInteger,
  integerColumn,
  jsonText,
  repoFromRow,
  row,
} from './mappers.js';

export interface RepoPatch {
  readonly slug?: string;
  readonly defaultBranch?: string;
  readonly gate?: string;
  readonly policy?: 'auto' | 'manual';
  readonly protectedPaths?: readonly string[];
  readonly enabled?: boolean;
}

export interface RepoRepository {
  get(id: string): Repo | null;
  getBySlug(slug: string): Repo | null;
  list(): Repo[];
  create(repo: Repo): Repo;
  update(id: string, patch: RepoPatch): Repo;
  delete(id: string): void;
}

// D59: the three counts are read in the same statement that loads the row, so the daemon never
// assembles a repository from two queries and no client ever counts works.
const COUNTS_SQL = `(SELECT COUNT(*) FROM works w WHERE w.repo_id = repos.id AND w.state = 'queued') AS pending_count,
  (SELECT COUNT(*) FROM works w WHERE w.repo_id = repos.id AND w.state = 'running') AS running_count,
  (SELECT COUNT(*) FROM works w WHERE w.repo_id = repos.id AND w.state = 'merged') AS merged_count`;

const COLUMNS = `id, slug, default_branch, gate, policy, protected_paths, enabled, created_at, ${COUNTS_SQL}`;

function repoOf(value: Parameters<typeof row>[0]): Repo {
  const record = row(value);
  return {
    ...repoFromRow(record),
    counts: {
      pending: integerColumn(record, 'pending_count'),
      running: integerColumn(record, 'running_count'),
      merged: integerColumn(record, 'merged_count'),
    },
  };
}

export function createRepoRepository(db: DatabaseSync): RepoRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM repos WHERE id = ?`);
  const selectBySlug = db.prepare(`SELECT ${COLUMNS} FROM repos WHERE slug = ?`);
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM repos ORDER BY created_at DESC, id DESC`);
  const insert = db.prepare(`
    INSERT INTO repos (id, slug, default_branch, gate, policy, protected_paths, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const countLiveRuns = db.prepare(
    `SELECT COUNT(*) AS live FROM runs WHERE repo_id = ? AND state IN (${LIVE_RUN_STATES_SQL})`,
  );
  const remove = db.prepare('DELETE FROM repos WHERE id = ?');

  function findById(id: string): Repo | null {
    const value = selectById.get(id);
    return value === undefined ? null : repoOf(value);
  }

  return {
    get(id: string): Repo | null {
      return findById(id);
    },

    getBySlug(slug: string): Repo | null {
      const value = selectBySlug.get(slug);
      return value === undefined ? null : repoOf(value);
    },

    list(): Repo[] {
      return selectAll.all().map((value) => repoOf(value));
    },

    create(repo: Repo): Repo {
      try {
        insert.run(
          repo.id,
          repo.slug,
          repo.defaultBranch,
          repo.gate,
          repo.policy,
          jsonText(repo.protectedPaths),
          booleanToInteger(repo.enabled),
          repo.createdAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'repo slug already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'repo reference is missing');
        }
        throw error;
      }
      const created = findById(repo.id);
      if (created === null) throw new StoreError('invalid_row', 'repo was not stored');
      return created;
    },

    update(id: string, patch: RepoPatch): Repo {
      const assignments: string[] = [];
      const parameters: (string | number)[] = [];
      if (patch.slug !== undefined) {
        assignments.push('slug = ?');
        parameters.push(patch.slug);
      }
      if (patch.defaultBranch !== undefined) {
        assignments.push('default_branch = ?');
        parameters.push(patch.defaultBranch);
      }
      if (patch.gate !== undefined) {
        assignments.push('gate = ?');
        parameters.push(patch.gate);
      }
      if (patch.policy !== undefined) {
        assignments.push('policy = ?');
        parameters.push(patch.policy);
      }
      if (patch.protectedPaths !== undefined) {
        assignments.push('protected_paths = ?');
        parameters.push(jsonText(patch.protectedPaths));
      }
      if (patch.enabled !== undefined) {
        assignments.push('enabled = ?');
        parameters.push(booleanToInteger(patch.enabled));
      }
      if (assignments.length > 0) {
        try {
          db.prepare(`UPDATE repos SET ${assignments.join(', ')} WHERE id = ?`).run(
            ...parameters,
            id,
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new StoreError('unique_violation', 'repo slug already exists');
          }
          throw error;
        }
      }
      const updated = findById(id);
      if (updated === null) throw new StoreError('not_found', 'repo not found');
      return updated;
    },

    delete(id: string): void {
      if (findById(id) === null) throw new StoreError('not_found', 'repo not found');
      const live = countLiveRuns.get(id);
      if (Number(live?.['live'] ?? 0) > 0) {
        throw new StoreError('repo_has_live_run', 'repo still has a live run');
      }
      try {
        remove.run(id);
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'repo still has run history');
        }
        throw error;
      }
    },
  };
}
