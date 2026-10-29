import { describe, expect, it } from 'vitest';
import type { Repo, Schedule } from '@codebox/contracts';
import { parseSchedule } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createBacklogService } from '../backlog/service.js';
import type { BacklogService } from '../backlog/service.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import type { RunEngine } from '../run/ports.js';
import { createRunsService } from '../runs/service.js';
import { createSchedulesService, schedulesRuntimeOf } from './service.js';
import { ScheduleFireError, createScheduleFirePort } from './fire.js';
import type { ScheduleFireErrorCode } from './fire.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_fire01';
const NOW = '2026-10-25T10:05:00.000Z';
const SCHEDULED_FOR = '2026-10-25T10:00:00Z';
const REVISION = '9f1c2ab';

const BLOCKED_THEN_OPEN = `# Backlog

## Batch 1 — Alpha

- [!] **[Task-01]** Blocked item.
  It cannot run.
- [ ] **[Task-02]** Open item.
  Body of the open item.
`;

const ALL_REFUSED = `## Batch 1 — Alpha

- [!] **[Task-01]** Blocked item.
`;

const stores: Store[] = [];

function contextFor(store: Store): DaemonContext {
  const config = loadConfig({ CB_ENV: 'test', CB_SESSION_SECRET: SESSION_SECRET });
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    config,
    store,
    logger,
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: '/nonexistent/app',
    shutdown: createShutdownRegistry(logger),
  };
}

function engine(): RunEngine {
  return {
    start: async () => ({ runId: 'run_ignored', state: 'succeeded' }),
    cancel: async () => false,
    active: () => [],
  };
}

function repoOf(): Repo {
  return {
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'manual',
    protectedPaths: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function harness(markdown: string | null): {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly backlog: BacklogService;
} {
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create(repoOf());
  const context = contextFor(store);
  const backlog = createBacklogService({
    context,
    runtime: {
      readSnapshot: async () =>
        markdown === null
          ? Promise.reject(new Error('no backlog'))
          : Promise.resolve({ markdown, revision: REVISION }),
    },
  });
  return { context, store, backlog };
}

function scheduleOf(input: Partial<Schedule> = {}): Schedule {
  return parseSchedule({
    id: 'sch_000001',
    repoId: REPO_ID,
    chatSessionId: null,
    title: 'Nightly drain',
    prompt: 'Pick the next issue and open a PR.',
    mode: 'every',
    cron: '0 10 * * *',
    timezone: 'UTC',
    windowStart: null,
    windowEnd: null,
    cooldownMinutes: 0,
    maxFires: null,
    maxCostPerFireUsd: null,
    firePolicy: 'new_chat',
    consecutiveFailures: 0,
    firesCount: 0,
    spendUsd: 0,
    enabled: true,
    policy: 'manual',
    nextFireAt: SCHEDULED_FOR,
    lastFiredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  });
}

async function errorOf(run: () => Promise<unknown>): Promise<ScheduleFireError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ScheduleFireError) return error;
    throw error;
  }
  throw new Error('the call should have thrown');
}

describe('startRun', () => {
  it('selects the first eligible item in file order and opens its run', async () => {
    const { context, store, backlog } = harness(BLOCKED_THEN_OPEN);
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs, backlog: () => backlog });

    const { runId } = await port.startRun({ schedule: scheduleOf(), scheduledFor: SCHEDULED_FOR });

    const record = store.runs.getRecord(runId);
    expect(record?.trigger).toBe('schedule');
    expect(record?.jobId).toBeNull();
    expect(record?.repoId).toBe(REPO_ID);
    expect(record?.scheduledFor).toBe(SCHEDULED_FOR);
    expect(record?.prompt).toContain('Open item.');
    expect(record?.agent).toBe(context.config.CB_DEFAULT_AGENT);
    expect(record?.model).toBe(context.config.CB_DEFAULT_MODEL);
    expect(record?.state).toBe('queued');

    const work = store.works.findByBacklogRef(REPO_ID, 'Task-02');
    expect(work).not.toBeNull();
    expect(work?.origin).toBe('schedule');
    expect(work?.state).toBe('running');
    expect(work?.specSha).toBe(REVISION);
    expect(record?.workId).toBe(work?.id);
    expect(store.runs.list({ workId: work?.id ?? '', limit: 10, cursor: null }).data).toHaveLength(
      1,
    );
  });

  it('reports blocked items as a refusal and picks the next open one', async () => {
    const { context, store, backlog } = harness(BLOCKED_THEN_OPEN);
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs, backlog: () => backlog });

    await port.startRun({ schedule: scheduleOf(), scheduledFor: SCHEDULED_FOR });

    expect(store.works.findByBacklogRef(REPO_ID, 'Task-01')).toBeNull();
    expect(store.works.findByBacklogRef(REPO_ID, 'Task-02')).not.toBeNull();
  });

  it('finishes without a run when every candidate is refused', async () => {
    const { context, store, backlog } = harness(ALL_REFUSED);
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs, backlog: () => backlog });

    const started = await port.startRun({
      schedule: scheduleOf(),
      scheduledFor: SCHEDULED_FOR,
    });

    expect(started.runId ?? null).toBeNull();
    expect(store.runs.list({ repoId: REPO_ID, limit: 10, cursor: null }).data).toHaveLength(0);
    const skipped = store.events
      .readAfterId(0, 10)
      .filter((event) => event.type === 'schedule.skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.data['reason']).toBe('nothing_runnable');
  });

  it('refuses a schedule with no repository and one whose repository is gone', async () => {
    const { context, backlog } = harness(BLOCKED_THEN_OPEN);
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs, backlog: () => backlog });

    expect(
      (
        await errorOf(() =>
          port.startRun({
            schedule: scheduleOf({ repoId: null, chatSessionId: null }),
            scheduledFor: SCHEDULED_FOR,
          }),
        )
      ).code,
    ).toBe('repo_required');
    expect(
      (
        await errorOf(() =>
          port.startRun({
            schedule: scheduleOf({ repoId: 'repo_000404' }),
            scheduledFor: SCHEDULED_FOR,
          }),
        )
      ).code,
    ).toBe('repo_missing');
  });

  it('reports an unreadable backlog as backlog_unavailable', async () => {
    const { context, backlog } = harness(null);
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs, backlog: () => backlog });

    expect(
      (await errorOf(() => port.startRun({ schedule: scheduleOf(), scheduledFor: SCHEDULED_FOR })))
        .code,
    ).toBe('backlog_unavailable');
  });

  it('accepts provider_exhausted as a fire error code', () => {
    const codes: readonly ScheduleFireErrorCode[] = [
      'repo_required',
      'repo_missing',
      'backlog_unavailable',
      'provider_exhausted',
      'internal',
    ];
    expect(codes).toContain('provider_exhausted');
    expect(new ScheduleFireError('provider_exhausted').code).toBe('provider_exhausted');
  });
});

describe('the schedules service finishes the row of a fire that selected nothing', () => {
  it('ends fired with no run instead of failing the schedule', async () => {
    const { context, store, backlog } = harness(ALL_REFUSED);
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs, backlog: () => backlog });
    const service = createSchedulesService({ context, now: () => new Date(NOW), fire: port });
    store.schedules.create(scheduleOf());

    const report = await service.tick(new Date(NOW));
    expect(report.fired).toBe(1);
    await Promise.all(schedulesRuntimeOf(service).pending());

    const fires = store.scheduleFires.listBySchedule('sch_000001', 10);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.outcome).toBe('fired');
    expect(fires[0]?.runId).toBeNull();
    expect(store.schedules.get('sch_000001')?.consecutiveFailures).toBe(0);
    service.stop();
  });
});
