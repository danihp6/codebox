import { canCancel } from '@codebox/core';
import { parseSseEvent } from '@codebox/contracts';
import type { Approval, Repo, Run, RunDiff, RunTrigger } from '@codebox/contracts';
import { toRun, withTransaction } from '@codebox/store';
import type { EventRecord, RunRecord, Store } from '@codebox/store';
import { branchName } from '@codebox/workspaces';
import type { WorkspaceManager, Worktree } from '@codebox/workspaces';
import type { DaemonContext } from '../modules.js';
import { createRunEventWriter } from '../run/events.js';
import type { RunEngine, RunStartInput } from '../run/ports.js';
import { createDaemonEngine, createDaemonWorkspaces } from './engine.js';
import { RunApiError } from './errors.js';
import { createIdempotencyStore, idempotentRun } from './idempotency.js';
import type { IdempotencyStore } from './idempotency.js';
import { newRunId } from './ids.js';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH = 200;
const TITLE_MAX_CHARS = 80;
const MERGED_EVENT_SCAN = 200;

export interface EventPageItem {
  readonly id: number;
  readonly seq: number | null;
  readonly type: EventRecord['type'];
  readonly data: Readonly<Record<string, unknown>>;
  readonly ts: string;
}

export interface EventPage {
  readonly data: EventPageItem[];
  readonly nextCursor: string | null;
}

export interface CreateRunsServiceOptions {
  readonly context: DaemonContext;
  readonly engine?: RunEngine;
  readonly workspaces?: Pick<WorkspaceManager, 'status'>;
  readonly idempotency?: IdempotencyStore;
  readonly now?: () => Date;
}

export interface RunsService {
  /** The engine, built on first call and cached for the process. */
  engine(): RunEngine;
  createRun(input: {
    readonly repoId: string;
    readonly prompt: string;
    readonly mode: 'work';
    readonly agent?: string;
    readonly model?: string | null;
    readonly baseRef?: string;
    readonly deviceId: string;
    readonly idempotencyKey: string;
  }): Run;
  cancel(runId: string, reason?: 'operator'): Promise<Run>;
  revert(input: {
    readonly runId: string;
    readonly deviceId: string;
    readonly idempotencyKey: string;
  }): Run;
  diff(runId: string): Promise<RunDiff>;
  events(runId: string, after: number, limit: number): EventPage;
  replyApproval(input: {
    readonly id: string;
    readonly decision: 'allow' | 'deny';
    readonly scope: 'once' | 'session';
  }): Approval;
  /** Resolves every pending approval whose `expiresAt <= now`; returns how many. */
  sweepApprovals(): number;
  stop(): void;
}

/** What a route needs from the shared instance beyond the frozen `RunsService` surface. */
export interface RunsServiceInternals {
  readonly store: Store;
  readonly idempotency: IdempotencyStore;
  readonly clock: () => Date;
}

export interface QueueRunInput {
  readonly context: DaemonContext;
  readonly engine: RunEngine;
  readonly now: () => Date;
  readonly repo: Repo;
  readonly jobId: string | null;
  readonly trigger: RunTrigger;
  readonly title: string;
  readonly prompt: string;
  readonly agent: string;
  readonly model: string | null;
  readonly baseRef?: string;
  readonly workId?: string | null;
  readonly backlogRef?: string | null;
}

const INTERNALS = new WeakMap<RunsService, RunsServiceInternals>();
const SERVICES = new WeakMap<DaemonContext, RunsService>();

/** `runs/index.ts` and `jobs/index.ts` reach the one instance through this. */
export function runsServiceInternals(service: RunsService): RunsServiceInternals {
  const internals = INTERNALS.get(service);
  if (internals === undefined) {
    throw new Error('the runs service was not created by createRunsService');
  }
  return internals;
}

export function requireRepo(context: DaemonContext, repoId: string, path: string): Repo {
  const repo = context.store.repos.get(repoId);
  if (repo === null) throw new RunApiError('validation_failed', 422, { path });
  return repo;
}

/** A manual run has no title column, so the branch slug and the PR title come from the prompt. */
export function titleFromPrompt(prompt: string): string {
  const first = prompt.trim().split('\n')[0]?.trim() ?? '';
  return first === '' ? 'Manual run' : first.slice(0, TITLE_MAX_CHARS);
}

/**
 * The daemon creates the `queued` row and lets the engine adopt it (`engine.ts` `queue()`), so
 * the route can answer `202` with a row that already exists.
 */
export function queueRun(input: QueueRunInput): Run {
  const store = input.context.store;
  const runId = newRunId();
  const baseRef = input.baseRef ?? input.repo.defaultBranch;
  const createdAt = input.now().toISOString();
  const record: RunRecord = {
    id: runId,
    repoId: input.repo.id,
    jobId: input.jobId,
    workId: input.workId ?? null,
    state: 'queued',
    trigger: input.trigger,
    branch: branchName(runId, input.title),
    baseRef,
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt,
    finishedAt: null,
    baseSha: null,
    worktree: null,
    sessionId: null,
    prompt: input.prompt,
    promptHash: null,
    agent: input.agent,
    model: input.model,
    gateCommand: input.repo.gate,
    scheduledFor: null,
    attempt: 1,
    failureCode: null,
    failureMessage: null,
    startedAt: null,
  };
  const events = createRunEventWriter({ store, clock: input.now, runId });
  withTransaction(store.db, () => {
    store.runs.create(record);
    events.appendRun('run.queued', {
      repoId: input.repo.id,
      jobId: input.jobId,
      trigger: input.trigger,
    });
  });
  const start: RunStartInput = {
    runId,
    repo: {
      id: input.repo.id,
      slug: input.repo.slug,
      defaultBranch: input.repo.defaultBranch,
      gate: input.repo.gate,
      policy: input.repo.policy,
      protectedPaths: input.repo.protectedPaths,
      cloneUrl: `https://github.com/${input.repo.slug}.git`,
    },
    jobId: input.jobId,
    trigger: input.trigger,
    title: input.title,
    prompt: input.prompt,
    agent: input.agent,
    model: input.model,
    baseRef,
    workId: input.workId ?? null,
    backlogRef: input.backlogRef ?? null,
  };
  try {
    void Promise.resolve(input.engine.start(start)).catch((error: unknown) => {
      input.context.logger.warn({ msg: 'run_start_failed', runId, err: error });
    });
  } catch (error) {
    input.context.logger.warn({ msg: 'run_start_failed', runId, err: error });
    throw new RunApiError('agent_unavailable', 502, { reason: 'run_start_failed' });
  }
  const stored = store.runs.getRecord(runId);
  if (stored === null) throw new Error('the run row was not stored');
  return toRun(stored);
}

/** The engine may be unbuildable (bad config); a run start then answers 502, never a 500. */
export function engineForRun(service: RunsService, logger: DaemonContext['logger']): RunEngine {
  try {
    return service.engine();
  } catch (error) {
    logger.error({ msg: 'run_engine_unavailable', err: error });
    throw new RunApiError('agent_unavailable', 502, { reason: 'engine_unavailable' });
  }
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

export function createRunsService(options: CreateRunsServiceOptions): RunsService {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const logger = context.logger;
  const clock = options.now ?? context.clock;
  const idempotency = options.idempotency ?? createIdempotencyStore();
  let engine: RunEngine | null = options.engine ?? null;
  let workspaces: Pick<WorkspaceManager, 'status'> | null = options.workspaces ?? null;
  let timer: NodeJS.Timeout | null = null;

  function requireEngine(): RunEngine {
    if (engine === null) engine = createDaemonEngine(context);
    return engine;
  }

  function requireWorkspaces(): Pick<WorkspaceManager, 'status'> {
    if (workspaces === null) workspaces = createDaemonWorkspaces(context);
    return workspaces;
  }

  function requireRun(runId: string): RunRecord {
    const record = store.runs.getRecord(runId);
    if (record === null) throw new RunApiError('not_found', 404, { path: 'run.id' });
    return record;
  }

  function appendResolved(approval: Approval, decision: string, ts: string): void {
    const parsed = parseSseEvent({
      event: 'approval.resolved',
      data: { approvalId: approval.id, decision, ts },
    });
    store.events.append({
      runId: approval.runId,
      chatId: approval.chatId,
      seq: null,
      type: parsed.event,
      data: toRecord(parsed.data),
      ts,
    });
  }

  function sweep(): number {
    const now = clock();
    const at = now.toISOString();
    let resolved = 0;
    for (;;) {
      const pending = store.approvals.listPending(SWEEP_BATCH);
      let progressed = false;
      for (const approval of pending) {
        if (Date.parse(approval.expiresAt) > now.getTime()) continue;
        withTransaction(store.db, () => {
          const expired = store.approvals.resolve({
            id: approval.id,
            state: 'expired',
            resolvedAt: at,
          });
          appendResolved(expired, 'expired', at);
        });
        logger.info({ msg: 'approval_expired', approvalId: approval.id });
        resolved += 1;
        progressed = true;
      }
      if (!progressed || pending.length < SWEEP_BATCH) break;
    }
    return resolved;
  }

  const service: RunsService = {
    engine(): RunEngine {
      return requireEngine();
    },

    createRun(input): Run {
      return idempotentRun({
        store: idempotency,
        deviceId: input.deviceId,
        key: input.idempotencyKey,
        body: {
          repoId: input.repoId,
          prompt: input.prompt,
          mode: input.mode,
          agent: input.agent ?? null,
          model: input.model ?? null,
          baseRef: input.baseRef ?? null,
        },
        now: clock(),
        start: (): Run => {
          const repo = requireRepo(context, input.repoId, 'run.repoId');
          const runEngine = engineForRun(service, logger);
          return queueRun({
            context,
            engine: runEngine,
            now: clock,
            repo,
            jobId: null,
            trigger: 'manual',
            title: titleFromPrompt(input.prompt),
            prompt: input.prompt,
            agent: input.agent ?? config.CB_DEFAULT_AGENT,
            model: input.model === undefined ? config.CB_DEFAULT_MODEL : input.model,
            ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
          });
        },
      });
    },

    async cancel(runId, reason = 'operator'): Promise<Run> {
      const run = requireRun(runId);
      if (!canCancel(run.state)) {
        throw new RunApiError('conflict', 409, { reason: 'run_not_cancellable' });
      }
      const stopped = await engineForRun(service, logger).cancel(runId, reason);
      if (!stopped) {
        throw new RunApiError('conflict', 409, { reason: 'run_not_cancellable' });
      }
      const updated = requireRun(runId);
      return toRun(updated);
    },

    revert(input): Run {
      return idempotentRun({
        store: idempotency,
        deviceId: input.deviceId,
        key: input.idempotencyKey === '' ? null : input.idempotencyKey,
        body: { runId: input.runId },
        now: clock(),
        start: (): Run => {
          const record = requireRun(input.runId);
          if (record.state !== 'succeeded' || record.pr === null) {
            throw new RunApiError('conflict', 409, { reason: 'run_not_revertible' });
          }
          const repo = requireRepo(context, record.repoId, 'run.repoId');
          const mergeCommit = mergeCommitOf(record.id, record.pr.number);
          const runEngine = engineForRun(service, logger);
          return queueRun({
            context,
            engine: runEngine,
            now: clock,
            repo,
            jobId: null,
            trigger: 'revert',
            title: `Revert ${record.id}`,
            prompt: `Revert run ${record.id}. Open a pull request that reverts merge commit ${mergeCommit} and leave the gate and guardrails unchanged.`,
            agent: record.agent,
            model: record.model,
            baseRef: repo.defaultBranch,
          });
        },
      });
    },

    async diff(runId): Promise<RunDiff> {
      const record = requireRun(runId);
      if (record.worktree === null) {
        throw new RunApiError('conflict', 409, { reason: 'diff_unavailable' });
      }
      const repo = store.repos.get(record.repoId);
      if (repo === null) throw new RunApiError('not_found', 404, { path: 'run.repoId' });
      const worktree: Worktree = {
        runId: record.id,
        repoSlug: repo.slug,
        path: record.worktree,
        branch: record.branch,
        baseRef: record.baseRef,
        baseSha: record.baseSha ?? '',
      };
      const status = await requireWorkspaces().status(worktree, repo.protectedPaths);
      return status.diff;
    },

    events(runId, after, limit): EventPage {
      requireRun(runId);
      const records = store.events.readRunAfterSeq(runId, after, limit);
      const data: EventPageItem[] = records.map((record) => ({
        id: record.id,
        seq: record.seq,
        type: record.type,
        data: record.data,
        ts: record.ts,
      }));
      const last = data.at(-1);
      return {
        data,
        nextCursor: data.length === limit && last !== undefined ? String(last.id) : null,
      };
    },

    replyApproval(input): Approval {
      const current = store.approvals.get(input.id);
      if (current === null) throw new RunApiError('not_found', 404, { path: 'approval.id' });
      if (current.state !== 'pending') {
        throw new RunApiError('conflict', 409, { reason: 'approval_already_answered' });
      }
      const at = clock().toISOString();
      const resolved = withTransaction(store.db, (): Approval => {
        const approval = store.approvals.resolve({
          id: input.id,
          state: input.decision === 'allow' ? 'allowed' : 'denied',
          resolvedAt: at,
        });
        appendResolved(approval, input.decision, at);
        return approval;
      });
      logger.info({
        msg: 'approval_replied',
        approvalId: input.id,
        decision: input.decision,
        scope: input.scope,
      });
      return resolved;
    },

    sweepApprovals(): number {
      if (timer === null) {
        // `unref` keeps the daemon free to exit; `stop()` clears it on shutdown.
        timer = setInterval(() => {
          try {
            sweep();
          } catch (error) {
            logger.warn({ msg: 'approval_sweep_failed', err: error });
          }
        }, SWEEP_INTERVAL_MS);
        timer.unref();
      }
      return sweep();
    },

    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };

  function mergeCommitOf(runId: string, prNumber: number): string {
    for (const event of store.events.readRunAfterSeq(runId, 0, MERGED_EVENT_SCAN)) {
      if (event.type !== 'run.merged') continue;
      const value = event.data['mergeCommit'];
      if (typeof value === 'string' && value !== '') return value;
    }
    return String(prNumber);
  }

  INTERNALS.set(service, { store, idempotency, clock });
  return service;
}

/** One engine, one `inflight` map and one cost budget per daemon process. */
export function runsService(context: DaemonContext): RunsService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const created = createRunsService({ context });
  SERVICES.set(context, created);
  return created;
}
