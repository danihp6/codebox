import type { Repo, Run, Session, Work, WorkOrigin, WorkState } from '@codebox/contracts';
import type { BacklogEntry } from '@codebox/backlog';
import { isTerminalRunState, parseSseEvent } from '@codebox/contracts';
import { StoreError, withTransaction } from '@codebox/store';
import type { PageResult, Store } from '@codebox/store';
import { backlogService } from '../backlog/index.js';
import type { BacklogService } from '../backlog/index.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { engineForRun, queueRun, runsService } from '../runs/service.js';
import type { RunsService } from '../runs/service.js';
import { sessionService } from '../sessions/index.js';
import type { CreateSessionInput } from '../sessions/index.js';
import { newWorkId } from './ids.js';

const PAGE_LIMIT = 200;
const WORK_PAGE = 500;

export interface CreateWorkOptions {
  readonly context: DaemonContext;
  readonly backlog?: BacklogService;
  readonly sessions?: SessionCreator;
  readonly runs?: () => RunsService;
}

/** The one call the works routes make into the sessions subsystem (D55 decision session). */
export interface SessionCreator {
  create(input: CreateSessionInput): Promise<Session>;
}

export interface WorkQuery {
  readonly repoId?: string;
  readonly state?: WorkState;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface WorksService {
  list(query: WorkQuery): PageResult<Work>;
  /** docs/api.md §5.6: the ref is verified against the file and the item seeds the prompt. */
  create(input: { readonly repoId: string; readonly backlogRef: string }): Promise<Work>;
  detail(id: string): WorkDetailResult;
  patch(
    id: string,
    body: { readonly title?: string | undefined; readonly prompt?: string | undefined },
  ): Work;
  archive(id: string): void;
  startRun(id: string, prompt?: string): Promise<Run>;
  decision(id: string): Promise<Session>;
  reviewed(id: string): Work;
  interrupt(id: string): Promise<Work>;
  runNext(repoId: string): Promise<Run>;
}

export interface WorkDetailResult {
  readonly work: Work;
  readonly repo: Repo;
  readonly runs: Run[];
}

export interface WorksInternals {
  readonly store: Store;
  readonly clock: () => Date;
}

const INTERNALS = new WeakMap<WorksService, WorksInternals>();
const SERVICES = new WeakMap<DaemonContext, WorksService>();

export function worksInternals(service: WorksService): WorksInternals {
  const internals = INTERNALS.get(service);
  if (internals === undefined) {
    throw new Error('the works service was not created by createWorksService');
  }
  return internals;
}

function conflict(reason: string, details: Record<string, unknown> = {}): RunApiError {
  return new RunApiError('conflict', 409, { reason, ...details });
}

function invalid(path: string, details: Record<string, unknown> = {}): RunApiError {
  return new RunApiError('validation_failed', 422, { path, ...details });
}

function requireWork(store: Store, id: string): Work {
  const work = store.works.get(id);
  if (work === null) throw new RunApiError('not_found', 404, { path: 'work.id' });
  return work;
}

function requireRepo(store: Store, id: string): Repo {
  const repo = store.repos.get(id);
  if (repo === null) throw new RunApiError('not_found', 404, { path: 'repo.id' });
  return repo;
}

function toRecord(value: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

export interface CreateWorkFromItemInput {
  readonly context: DaemonContext;
  readonly repo: Repo;
  readonly item: Pick<BacklogEntry, 'ref' | 'title' | 'body'>;
  readonly revision: string;
  readonly origin: WorkOrigin;
  readonly state: WorkState;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/**
 * The one constructor of a work row (D44, D51, D53): the file owns the title and the body, the
 * row caches them at `specSha`, and a second live work for the same item is refused by the store.
 */
export function createWorkFromItem(input: CreateWorkFromItemInput): Work {
  const store = input.context.store;
  const at = input.context.clock().toISOString();
  const work: Work = {
    id: newWorkId(),
    repoId: input.repo.id,
    backlogRef: input.item.ref,
    title: input.item.title,
    prompt: input.item.body,
    specSha: input.revision,
    state: input.state,
    origin: input.origin,
    attempts: input.attempts,
    maxAttempts: input.maxAttempts,
    usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
    contextTokens: 0,
    contextEpoch: 1,
    reviewedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  try {
    return withTransaction(store.db, () => {
      const created = store.works.create(work);
      appendWorkEvent(store, input.context, 'work.created', {
        workId: created.id,
        repoId: created.repoId,
        backlogRef: created.backlogRef,
        origin: created.origin,
      });
      return created;
    });
  } catch (error) {
    if (error instanceof StoreError && error.code === 'unique_violation') {
      throw conflict('live_work', { backlogRef: input.item.ref });
    }
    throw error;
  }
}

function appendWorkEvent(
  store: Store,
  context: DaemonContext,
  event: 'work.created' | 'work.updated' | 'work.closed',
  data: Readonly<Record<string, unknown>>,
): void {
  const workId = data['workId'];
  if (typeof workId !== 'string') throw new Error('a work event needs its work id');
  const seq = store.events.nextSeq({ workId });
  const ts = context.clock().toISOString();
  const parsed = parseSseEvent({ event, data: { ...data, seq, ts } });
  store.events.append({
    runId: null,
    chatId: null,
    workId,
    seq,
    type: parsed.event,
    data: toRecord(parsed.data),
    ts,
  });
}

export function createWorksService(options: CreateWorkOptions): WorksService {
  const context = options.context;
  const store = context.store;
  const config = context.config;
  const clock = context.clock;
  const backlog = options.backlog ?? backlogService(context);
  const runs = options.runs ?? ((): RunsService => runsService(context));

  function sessions(): SessionCreator {
    return options.sessions ?? sessionService(context);
  }

  function requireRepoAndWork(id: string): { work: Work; repo: Repo } {
    const work = requireWork(store, id);
    return { work, repo: requireRepo(store, work.repoId) };
  }

  function queueFor(work: Work, repo: Repo, prompt: string, trigger: 'manual'): Run {
    const run = queueRun({
      context,
      engine: engineForRun(runs(), context.logger),
      now: clock,
      repo,
      jobId: null,
      trigger,
      title: work.title,
      prompt,
      agent: config.CB_DEFAULT_AGENT,
      model: config.CB_DEFAULT_MODEL,
      workId: work.id,
      backlogRef: work.backlogRef,
    });
    return withTransaction(store.db, () => {
      store.works.update(work.id, {
        state: 'running',
        attempts: work.attempts + 1,
        updatedAt: clock().toISOString(),
      });
      appendWorkEvent(store, context, 'work.updated', {
        workId: work.id,
        state: 'running',
        attempts: work.attempts + 1,
      });
      return run;
    });
  }

  const service: WorksService = {
    list(query): PageResult<Work> {
      return store.works.list({
        limit: Math.min(query.limit, PAGE_LIMIT),
        cursor: query.cursor,
        ...(query.repoId === undefined ? {} : { repoId: query.repoId }),
        ...(query.state === undefined ? {} : { state: query.state }),
      });
    },

    async create(input): Promise<Work> {
      const repo = requireRepo(store, input.repoId);
      const resolved = await backlog.resolveItem(repo, input.backlogRef);
      return createWorkFromItem({
        context,
        repo,
        item: resolved.item,
        revision: resolved.revision,
        origin: 'backlog',
        state: 'queued',
        attempts: 0,
        maxAttempts: 2,
      });
    },

    detail(id): WorkDetailResult {
      const { work, repo } = requireRepoAndWork(id);
      const page = store.runs.list({ workId: work.id, limit: WORK_PAGE, cursor: null });
      return { work, repo, runs: page.data };
    },

    patch(id, body): Work {
      requireWork(store, id);
      if (body.title === undefined && body.prompt === undefined) {
        throw invalid('work', { reason: 'empty_patch' });
      }
      // D51: TODO.md owns the title and the body; the row is a cache and never the source.
      throw conflict('spec_in_git');
    },

    archive(id): void {
      requireWork(store, id);
      withTransaction(store.db, () => {
        store.works.update(id, { state: 'abandoned', updatedAt: clock().toISOString() });
        appendWorkEvent(store, context, 'work.closed', { workId: id, state: 'abandoned' });
      });
    },

    async startRun(id, prompt): Promise<Run> {
      const { work, repo } = requireRepoAndWork(id);
      return queueFor(work, repo, prompt ?? work.prompt, 'manual');
    },

    async decision(id): Promise<Session> {
      const { work, repo } = requireRepoAndWork(id);
      const session = await sessions().create({
        repoId: repo.id,
        target: 'work',
        workId: work.id,
        title: `Decision · ${work.title}`,
      });
      withTransaction(store.db, () => {
        store.works.update(work.id, {
          state: 'needs_decision',
          updatedAt: clock().toISOString(),
        });
        appendWorkEvent(store, context, 'work.updated', {
          workId: work.id,
          state: 'needs_decision',
          attempts: work.attempts,
        });
      });
      return session;
    },

    reviewed(id): Work {
      const work = requireWork(store, id);
      if (work.reviewedAt !== null) throw conflict('already_reviewed');
      return withTransaction(store.db, () => {
        const updated = store.works.update(id, {
          reviewedAt: clock().toISOString(),
          updatedAt: clock().toISOString(),
        });
        appendWorkEvent(store, context, 'work.updated', {
          workId: id,
          state: updated.state,
          attempts: updated.attempts,
        });
        return updated;
      });
    },

    async interrupt(id): Promise<Work> {
      const work = requireWork(store, id);
      const page = store.runs.list({ workId: work.id, limit: WORK_PAGE, cursor: null });
      const live = page.data.find((run) => !isTerminalRunState(run.state));
      if (live === undefined) throw conflict('no_live_run');
      const stopped = await engineForRun(runs(), context.logger).cancel(live.id, 'operator');
      if (!stopped) throw conflict('no_live_run');
      return withTransaction(store.db, () => {
        const updated = store.works.update(id, {
          state: 'failed',
          updatedAt: clock().toISOString(),
        });
        appendWorkEvent(store, context, 'work.updated', {
          workId: id,
          state: 'failed',
          attempts: updated.attempts,
        });
        return updated;
      });
    },

    async runNext(repoId): Promise<Run> {
      const repo = requireRepo(store, repoId);
      const schedule = store.repoSchedules.getByRepo(repoId);
      const selection = await backlog.select(repo, {
        selection: 'nextPending',
        refs: [],
        maxAttempts: schedule?.maxAttempts ?? 2,
      });
      if (selection.kind !== 'selected') throw conflict(selection.kind);
      const resolved = await backlog.resolveItem(repo, selection.item.ref);
      const work = createWorkFromItem({
        context,
        repo,
        item: resolved.item,
        revision: resolved.revision,
        origin: 'manual',
        state: 'running',
        attempts: 1,
        maxAttempts: schedule?.maxAttempts ?? 2,
      });
      const run = queueRun({
        context,
        engine: engineForRun(runs(), context.logger),
        now: clock,
        repo,
        jobId: null,
        trigger: 'manual',
        title: work.title,
        prompt: work.prompt,
        agent: config.CB_DEFAULT_AGENT,
        model: config.CB_DEFAULT_MODEL,
        workId: work.id,
        backlogRef: work.backlogRef,
      });
      return run;
    },
  };

  INTERNALS.set(service, { store, clock });
  return service;
}

export function worksService(context: DaemonContext): WorksService {
  const existing = SERVICES.get(context);
  if (existing !== undefined) return existing;
  const created = createWorksService({ context });
  SERVICES.set(context, created);
  return created;
}
