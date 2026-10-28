import type { Run, RunState } from '@codebox/contracts';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { decodeCursor, encodeCursor, type PageResult } from './cursor.js';
import { isForeignKeyViolation, isUniqueViolation, withTransaction } from './db.js';
import { StoreError } from './errors.js';
import {
  LIVE_RUN_STATES_SQL,
  booleanToInteger,
  enumColumn,
  integerColumn,
  jsonText,
  row,
  runRecordFromRow,
  textColumn,
} from './mappers.js';

export interface RunRecord extends Run {
  /** D44: the work this run belongs to, when the run came from the backlog or a schedule. */
  readonly workId?: string | null;
  readonly baseSha: string | null;
  readonly worktree: string | null;
  readonly sessionId: string | null;
  readonly prompt: string;
  readonly promptHash: string | null;
  readonly agent: string;
  readonly model: string | null;
  readonly gateCommand: string | null;
  readonly scheduledFor: string | null;
  readonly attempt: number;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly startedAt: string | null;
}

export interface RunFilter {
  readonly repoId?: string;
  readonly jobId?: string;
  readonly workId?: string;
  readonly state?: RunState;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface RunPatch {
  readonly state?: RunState;
  readonly pr?: Run['pr'];
  readonly gate?: Run['gate'];
  readonly guardrails?: Run['guardrails'];
  readonly blockers?: Run['blockers'];
  readonly diff?: Run['diff'];
  readonly cost?: Run['cost'];
  readonly baseSha?: string | null;
  readonly worktree?: string | null;
  readonly sessionId?: string | null;
  readonly gateCommand?: string | null;
  readonly promptHash?: string | null;
  readonly scheduledFor?: string | null;
  readonly attempt?: number;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
}

export interface ClaimScheduledRunInput {
  readonly jobId: string;
  readonly scheduledFor: string;
  readonly runId: string;
  readonly now: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly agent: string;
  readonly model: string | null;
  readonly prompt: string;
}

export interface RunRepository {
  get(id: string): Run | null;
  getRecord(id: string): RunRecord | null;
  list(filter: RunFilter): PageResult<Run>;
  create(record: RunRecord): RunRecord;
  update(id: string, patch: RunPatch): RunRecord;
  claimScheduledRun(input: ClaimScheduledRunInput): RunRecord | null;
  countLive(repoId?: string): number;
  listByJob(jobId: string, limit: number): Run[];
  /** Counts runs whose `created_at` is in [since, until], by state; every key is present. */
  countByState(filter: {
    readonly since: string;
    readonly until: string;
  }): Readonly<Record<RunState, number>>;
  /** Deletes terminal runs finished before `cutoff`; returns the number of rows removed. */
  pruneBefore(cutoff: string): number;
}

// The contract enums are re-declared here because @codebox/contracts is imported type-only: a
// value import would need packages/contracts/dist, which does not exist during `npm test`.
const RUN_STATES: readonly RunState[] = Object.freeze([
  'queued',
  'preparing',
  'running',
  'gating',
  'pr_open',
  'merging',
  'succeeded',
  'failed',
  'cancelled',
]);

const COLUMNS = [
  'id',
  'repo_id',
  'job_id',
  'work_id',
  'state',
  '"trigger"',
  'branch',
  'base_ref',
  'base_sha',
  'worktree',
  'session_id',
  'prompt',
  'prompt_hash',
  'agent',
  'model',
  'gate_command',
  'scheduled_for',
  'attempt',
  'pr_number',
  'pr_url',
  'pr_mergeable',
  'gate_status',
  'gate_exit_code',
  'gate_duration_ms',
  'guardrails',
  'blockers',
  'diff_files',
  'diff_added',
  'diff_removed',
  'cost_usd',
  'tokens_in',
  'tokens_out',
  'failure_code',
  'failure_message',
  'created_at',
  'started_at',
  'finished_at',
].join(', ');

type ScalarPatchKey =
  | 'baseSha'
  | 'worktree'
  | 'sessionId'
  | 'gateCommand'
  | 'promptHash'
  | 'scheduledFor'
  | 'attempt'
  | 'failureCode'
  | 'failureMessage'
  | 'startedAt'
  | 'finishedAt';

export function toRun(record: RunRecord): Run {
  return {
    id: record.id,
    repoId: record.repoId,
    jobId: record.jobId,
    state: record.state,
    trigger: record.trigger,
    branch: record.branch,
    baseRef: record.baseRef,
    pr: record.pr,
    gate: record.gate,
    guardrails: record.guardrails,
    blockers: record.blockers,
    diff: record.diff,
    cost: record.cost,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
  };
}

/**
 * `runRecordFromRow` lives in `mappers.ts` and does not read `work_id`; the link is filled here so
 * a work can list its own runs without a second query.
 */
function withWorkId(
  record: RunRecord,
  value: Record<string, SQLOutputValue> | undefined,
): RunRecord {
  const id = row(value)['work_id'];
  return typeof id === 'string' ? { ...record, workId: id } : record;
}

export function createRunRepository(db: DatabaseSync): RunRepository {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM runs WHERE id = ?`);
  const selectJob = db.prepare('SELECT repo_id, enabled FROM jobs WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO runs (
      id, repo_id, job_id, work_id, state, "trigger", branch, base_ref, base_sha, worktree,
      session_id, prompt, prompt_hash, agent, model, gate_command, scheduled_for, attempt,
      pr_number, pr_url, pr_mergeable, gate_status, gate_exit_code, gate_duration_ms, guardrails,
      blockers, diff_files, diff_added, diff_removed, cost_usd, tokens_in, tokens_out,
      failure_code, failure_message, created_at, started_at, finished_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  const countAllLive = db.prepare(
    `SELECT COUNT(*) AS live FROM runs WHERE state IN (${LIVE_RUN_STATES_SQL})`,
  );
  const countRepoLive = db.prepare(
    `SELECT COUNT(*) AS live FROM runs WHERE repo_id = ? AND state IN (${LIVE_RUN_STATES_SQL})`,
  );
  const selectByJob = db.prepare(`
    SELECT ${COLUMNS} FROM runs WHERE job_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const countStates = db.prepare(`
    SELECT state, COUNT(*) AS n FROM runs
    WHERE created_at >= ? AND created_at <= ? GROUP BY state
  `);
  const deleteFinishedBefore = db.prepare(
    'DELETE FROM runs WHERE finished_at IS NOT NULL AND finished_at < ?',
  );

  const scalarColumns: readonly [ScalarPatchKey, string][] = [
    ['baseSha', 'base_sha'],
    ['worktree', 'worktree'],
    ['sessionId', 'session_id'],
    ['gateCommand', 'gate_command'],
    ['promptHash', 'prompt_hash'],
    ['scheduledFor', 'scheduled_for'],
    ['attempt', 'attempt'],
    ['failureCode', 'failure_code'],
    ['failureMessage', 'failure_message'],
    ['startedAt', 'started_at'],
    ['finishedAt', 'finished_at'],
  ];

  function findById(id: string): RunRecord | null {
    const value = selectById.get(id);
    return value === undefined ? null : withWorkId(runRecordFromRow(row(value)), value);
  }

  function insertRecord(record: RunRecord): void {
    insert.run(
      record.id,
      record.repoId,
      record.jobId,
      record.workId ?? null,
      record.state,
      record.trigger,
      record.branch,
      record.baseRef,
      record.baseSha,
      record.worktree,
      record.sessionId,
      record.prompt,
      record.promptHash,
      record.agent,
      record.model,
      record.gateCommand,
      record.scheduledFor,
      record.attempt,
      record.pr === null ? null : record.pr.number,
      record.pr === null ? null : record.pr.url,
      record.pr === null ? null : booleanToInteger(record.pr.mergeable),
      record.gate === null ? null : record.gate.status,
      record.gate === null ? null : record.gate.exitCode,
      record.gate === null ? null : record.gate.durationMs,
      jsonText(record.guardrails),
      jsonText(record.blockers),
      record.diff === null ? null : record.diff.files,
      record.diff === null ? null : record.diff.added,
      record.diff === null ? null : record.diff.removed,
      record.cost.usd,
      record.cost.tokensIn,
      record.cost.tokensOut,
      record.failureCode,
      record.failureMessage,
      record.createdAt,
      record.startedAt,
      record.finishedAt,
    );
  }

  return {
    get(id: string): Run | null {
      const record = findById(id);
      return record === null ? null : toRun(record);
    },

    getRecord(id: string): RunRecord | null {
      return findById(id);
    },

    list(filter: RunFilter): PageResult<Run> {
      const limit = Math.max(1, Math.trunc(filter.limit));
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (filter.repoId !== undefined) {
        conditions.push('repo_id = ?');
        parameters.push(filter.repoId);
      }
      if (filter.jobId !== undefined) {
        conditions.push('job_id = ?');
        parameters.push(filter.jobId);
      }
      if (filter.workId !== undefined) {
        conditions.push('work_id = ?');
        parameters.push(filter.workId);
      }
      if (filter.state !== undefined) {
        conditions.push('state = ?');
        parameters.push(filter.state);
      }
      if (filter.cursor !== null) {
        const cursor = decodeCursor(filter.cursor);
        conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
      const values = db
        .prepare(`SELECT ${COLUMNS} FROM runs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(...parameters, limit + 1)
        .map((value) => withWorkId(runRecordFromRow(row(value)), value));
      const data = values.slice(0, limit).map((record) => toRun(record));
      const last = values.at(limit - 1);
      return {
        data,
        nextCursor:
          values.length > limit && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      };
    },

    create(record: RunRecord): RunRecord {
      try {
        insertRecord(record);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new StoreError('unique_violation', 'run already exists');
        }
        if (isForeignKeyViolation(error)) {
          throw new StoreError('foreign_key_violation', 'run reference is missing');
        }
        throw error;
      }
      const created = findById(record.id);
      if (created === null) throw new StoreError('invalid_row', 'run was not stored');
      return created;
    },

    update(id: string, patch: RunPatch): RunRecord {
      const assignments: string[] = [];
      const parameters: (string | number | null)[] = [];
      if (patch.state !== undefined) {
        assignments.push('state = ?');
        parameters.push(patch.state);
      }
      for (const [key, column] of scalarColumns) {
        const value = patch[key];
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          parameters.push(value);
        }
      }
      if (patch.pr !== undefined) {
        assignments.push('pr_number = ?', 'pr_url = ?', 'pr_mergeable = ?');
        parameters.push(
          patch.pr === null ? null : patch.pr.number,
          patch.pr === null ? null : patch.pr.url,
          patch.pr === null ? null : booleanToInteger(patch.pr.mergeable),
        );
      }
      if (patch.gate !== undefined) {
        assignments.push('gate_status = ?', 'gate_exit_code = ?', 'gate_duration_ms = ?');
        parameters.push(
          patch.gate === null ? null : patch.gate.status,
          patch.gate === null ? null : patch.gate.exitCode,
          patch.gate === null ? null : patch.gate.durationMs,
        );
      }
      if (patch.diff !== undefined) {
        assignments.push('diff_files = ?', 'diff_added = ?', 'diff_removed = ?');
        parameters.push(
          patch.diff === null ? null : patch.diff.files,
          patch.diff === null ? null : patch.diff.added,
          patch.diff === null ? null : patch.diff.removed,
        );
      }
      if (patch.cost !== undefined) {
        assignments.push('cost_usd = ?', 'tokens_in = ?', 'tokens_out = ?');
        parameters.push(patch.cost.usd, patch.cost.tokensIn, patch.cost.tokensOut);
      }
      if (patch.guardrails !== undefined) {
        assignments.push('guardrails = ?');
        parameters.push(jsonText(patch.guardrails));
      }
      if (patch.blockers !== undefined) {
        assignments.push('blockers = ?');
        parameters.push(jsonText(patch.blockers));
      }
      if (assignments.length > 0) {
        try {
          db.prepare(`UPDATE runs SET ${assignments.join(', ')} WHERE id = ?`).run(
            ...parameters,
            id,
          );
        } catch (error) {
          if (isForeignKeyViolation(error)) {
            throw new StoreError('foreign_key_violation', 'run reference is missing');
          }
          throw error;
        }
      }
      const updated = findById(id);
      if (updated === null) throw new StoreError('not_found', 'run not found');
      return updated;
    },

    claimScheduledRun(input: ClaimScheduledRunInput): RunRecord | null {
      return withTransaction(db, () => {
        const job = selectJob.get(input.jobId);
        if (job === undefined) return null;
        if (integerColumn(row(job), 'enabled') !== 1) return null;
        const repoId = textColumn(row(job), 'repo_id');
        try {
          insert.run(
            input.runId,
            repoId,
            input.jobId,
            null,
            'queued',
            'schedule',
            input.branch,
            input.baseRef,
            null,
            null,
            null,
            input.prompt,
            null,
            input.agent,
            input.model,
            null,
            input.scheduledFor,
            1,
            null,
            null,
            null,
            null,
            null,
            null,
            '[]',
            '[]',
            null,
            null,
            null,
            0,
            0,
            0,
            null,
            null,
            input.now,
            null,
            null,
          );
        } catch (error) {
          if (isUniqueViolation(error)) return null;
          if (isForeignKeyViolation(error)) {
            throw new StoreError('foreign_key_violation', 'claim reference is missing');
          }
          throw error;
        }
        const claimed = findById(input.runId);
        if (claimed === null) throw new StoreError('invalid_row', 'run was not stored');
        return claimed;
      });
    },

    countLive(repoId?: string): number {
      const result = repoId === undefined ? countAllLive.get() : countRepoLive.get(repoId);
      const value = result?.['live'];
      return value === null || value === undefined ? 0 : Number(value);
    },

    listByJob(jobId: string, limit: number): Run[] {
      return selectByJob
        .all(jobId, Math.max(1, Math.trunc(limit)))
        .map((value) => toRun(runRecordFromRow(row(value))));
    },

    countByState(filter: {
      readonly since: string;
      readonly until: string;
    }): Readonly<Record<RunState, number>> {
      const counts = {} as Record<RunState, number>;
      for (const state of RUN_STATES) counts[state] = 0;
      for (const value of countStates.all(filter.since, filter.until)) {
        const rowValue = row(value);
        counts[enumColumn<RunState>(rowValue, 'state', RUN_STATES)] = integerColumn(rowValue, 'n');
      }
      return counts;
    },

    pruneBefore(cutoff: string): number {
      return Number(deleteFinishedBefore.run(cutoff).changes);
    },
  };
}
