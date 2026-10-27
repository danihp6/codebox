import { describe, expect, it } from 'vitest';
import type { Schedule } from '@codebox/contracts';
import { parseSchedule } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createChatService } from '../chat/service.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import type { RunEngine } from '../run/ports.js';
import { createRunsService } from '../runs/service.js';
import { ScheduleFireError, createScheduleFirePort } from './fire.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_fire01';
const NOW = '2026-10-25T10:05:00.000Z';
const SCHEDULED_FOR = '2026-10-25T10:00:00Z';

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

function harness(): { readonly context: DaemonContext; readonly store: Store } {
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create({
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'manual',
    protectedPaths: [],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  return { context: contextFor(store), store };
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

function errorOf(run: () => unknown): ScheduleFireError {
  try {
    run();
  } catch (error) {
    if (error instanceof ScheduleFireError) return error;
    throw error;
  }
  throw new Error('the call should have thrown');
}

describe('startRun', () => {
  it('queues a schedule run and records the fire it belongs to', () => {
    const { context, store } = harness();
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs });

    const { runId } = port.startRun({
      schedule: scheduleOf(),
      scheduledFor: SCHEDULED_FOR,
      costCapUsd: null,
    });

    expect(runId).toMatch(/^run_/);
    const record = store.runs.getRecord(runId);
    expect(record?.trigger).toBe('schedule');
    expect(record?.jobId).toBeNull();
    expect(record?.repoId).toBe(REPO_ID);
    expect(record?.scheduledFor).toBe(SCHEDULED_FOR);
    expect(record?.prompt).toBe('Pick the next issue and open a PR.');
    expect(record?.agent).toBe(context.config.CB_DEFAULT_AGENT);
    expect(record?.model).toBe(context.config.CB_DEFAULT_MODEL);
    expect(record?.state).toBe('queued');
  });

  it('refuses a schedule with no repository and one whose repository is gone', () => {
    const { context } = harness();
    const runs = createRunsService({ context, engine: engine() });
    const port = createScheduleFirePort({ context, runs: () => runs });

    expect(
      errorOf(() =>
        port.startRun({
          schedule: scheduleOf({ repoId: null, chatSessionId: null }),
          scheduledFor: SCHEDULED_FOR,
          costCapUsd: null,
        }),
      ).code,
    ).toBe('repo_required');
    expect(
      errorOf(() =>
        port.startRun({
          schedule: scheduleOf({ repoId: 'repo_000404' }),
          scheduledFor: SCHEDULED_FOR,
          costCapUsd: null,
        }),
      ).code,
    ).toBe('repo_missing');
  });
});

describe('startChat', () => {
  it('fails with chat_unavailable when the chat subsystem is not running', async () => {
    const { context } = harness();
    const port = createScheduleFirePort({ context });
    await expect(
      port.startChat({
        schedule: scheduleOf({ repoId: null, chatSessionId: null }),
        scheduledFor: SCHEDULED_FOR,
      }),
    ).rejects.toMatchObject({ code: 'chat_unavailable' });
  });

  it('fails with chat_missing when there is no chat and no repository to open one', async () => {
    const { context } = harness();
    const chat = createChatService({ context });
    const port = createScheduleFirePort({ context, chat: () => chat });
    await expect(
      port.startChat({
        schedule: scheduleOf({ repoId: null, chatSessionId: null, firePolicy: 'continue' }),
        scheduledFor: SCHEDULED_FOR,
      }),
    ).rejects.toMatchObject({ code: 'chat_missing' });
  });
});
