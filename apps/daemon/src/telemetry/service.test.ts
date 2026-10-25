import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TELEMETRY_RANGES, telemetrySchema } from '@codebox/contracts';
import type { Approval, ChatSession, Repo } from '@codebox/contracts';
import { USAGE_RANGES } from '@codebox/core';
import { openInMemoryStore } from '@codebox/store';
import type { RunRecord, Store } from '@codebox/store';
import { createApp } from '../app.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { startDaemon } from '../main.js';
import type { DaemonHandle } from '../main.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry, loadModules } from '../modules.js';
import type { AppVariables, DaemonApp, DaemonContext } from '../modules.js';
import { createModule } from './index.js';
import { registerTelemetryRoutes } from './routes.js';
import { createTelemetryService } from './service.js';
import type { TelemetryService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const AT = new Date('2026-10-25T12:00:00.000Z');
const DAY_MS = 86_400_000;
const DISK = { freeBytes: 4_000, totalBytes: 10_000, usedPercent: 60 };
const QUEUE = { pending: 7, running: 2, maxConcurrency: 2 };

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const stores: Store[] = [];
const directories: string[] = [];
const handles: DaemonHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop('test-teardown');
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly lines: Record<string, unknown>[];
  readonly logsDir: string;
  readonly root: string;
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'cb-27-telemetry-'));
  directories.push(root);
  const stateDir = join(root, 'state');
  const logsDir = join(stateDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: stateDir,
    CB_REPO_ROOT: join(root, 'repos'),
    CB_WORKSPACE_ROOT: join(root, 'worktrees'),
    CB_LOG_LEVEL: 'debug',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => AT,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(root, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  return { context, store, lines, logsDir, root };
}

function daysAgo(days: number): string {
  return new Date(AT.getTime() - days * DAY_MS).toISOString();
}

function runRecord(id: string, createdAt: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    repoId: REPO.id,
    jobId: null,
    state: 'queued',
    trigger: 'manual',
    branch: `cb/${id}-work`,
    baseRef: 'main',
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
    prompt: 'do the work',
    promptHash: null,
    agent: 'build',
    model: null,
    gateCommand: null,
    scheduledFor: null,
    attempt: 1,
    failureCode: null,
    failureMessage: null,
    startedAt: null,
    ...overrides,
  };
}

function chatSession(id: string, updatedAt: string, status: ChatSession['status']): ChatSession {
  return {
    id,
    repoId: REPO.id,
    title: 'Chat',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    lastMessage: null,
  };
}

function approval(
  id: string,
  createdAt: string,
  chatId: string,
  state: Approval['state'],
): Approval {
  return {
    id,
    state,
    tool: 'bash',
    title: 'Run the gate',
    runId: null,
    chatId,
    input: {},
    createdAt,
    expiresAt: createdAt,
    resolvedAt: state === 'pending' ? null : createdAt,
  };
}

describe('telemetry service', () => {
  it('keeps USAGE_RANGES equal to the contract ranges, element by element', () => {
    expect([...USAGE_RANGES]).toEqual([...TELEMETRY_RANGES]);
  });

  it('answers the 24h window from the usage ledger, the run counts and the probes', async () => {
    const { context, store } = harness();
    store.repos.create(REPO);
    store.runs.create(
      runRecord('run_0000001', '2026-10-25T09:00:00.000Z', {
        state: 'succeeded',
        finishedAt: '2026-10-25T10:00:00.000Z',
      }),
    );
    store.runs.create(runRecord('run_0000002', '2026-10-25T10:30:00.000Z', { state: 'failed' }));
    store.runs.create(runRecord('run_0000003', '2026-10-25T11:30:00.000Z', { state: 'queued' }));
    store.runs.create(
      runRecord('run_0000004', '2026-10-20T10:00:00.000Z', {
        state: 'cancelled',
        finishedAt: '2026-10-20T11:00:00.000Z',
      }),
    );
    store.usage.record({
      runId: 'run_0000001',
      repoId: REPO.id,
      day: '2026-10-25',
      model: null,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.5,
      createdAt: '2026-10-25T11:00:00.000Z',
    });
    store.usage.record({
      runId: 'run_0000002',
      repoId: REPO.id,
      day: '2026-10-25',
      model: null,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.25,
      createdAt: '2026-10-25T10:00:00.000Z',
    });
    store.usage.record({
      runId: 'run_0000001',
      repoId: REPO.id,
      day: '2026-10-25',
      model: null,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0.25,
      createdAt: '2026-10-25T12:00:00.000Z',
    });
    store.usage.record({
      runId: null,
      repoId: null,
      day: '2026-10-24',
      model: null,
      tokensIn: 900,
      tokensOut: 900,
      costUsd: 10,
      createdAt: '2026-10-24T11:59:59.999Z',
    });

    const service = createTelemetryService({
      context,
      probes: { disk: () => DISK, queue: () => QUEUE },
    });
    const telemetry = await service.report('24h');

    expect(telemetrySchema.safeParse(telemetry).success).toBe(true);
    expect(telemetry).toEqual({
      range: '24h',
      since: '2026-10-24T12:00:00.000Z',
      spendUsd: 1,
      runs: { total: 3, succeeded: 1, failed: 1, cancelled: 0 },
      disk: DISK,
      queueDepth: 7,
    });
  });

  it('reports the window start of every range', async () => {
    const { context } = harness();
    const service = createTelemetryService({
      context,
      probes: { disk: () => DISK, queue: () => QUEUE },
    });
    const since: Record<string, string> = {};
    for (const range of USAGE_RANGES) {
      since[range] = (await service.report(range)).since;
    }
    expect(since).toEqual({
      '1h': '2026-10-25T11:00:00.000Z',
      '24h': '2026-10-24T12:00:00.000Z',
      '7d': '2026-10-18T12:00:00.000Z',
      '30d': '2026-09-25T12:00:00.000Z',
    });
  });

  it('prunes exactly the expired rows and run log directories, never a usage row', () => {
    const fixture = harness();
    const { context, store, logsDir } = fixture;
    store.repos.create(REPO);
    store.runs.create(
      runRecord('run_0000001', daysAgo(100), {
        state: 'succeeded',
        finishedAt: daysAgo(100),
      }),
    );
    store.runs.create(
      runRecord('run_0000002', daysAgo(1), { state: 'failed', finishedAt: daysAgo(1) }),
    );
    store.runs.create(runRecord('run_0000003', daysAgo(200), { state: 'running' }));
    store.usage.record({
      runId: 'run_0000001',
      repoId: REPO.id,
      day: '2026-07-17',
      model: null,
      tokensIn: 5,
      tokensOut: 5,
      costUsd: 0.75,
      createdAt: daysAgo(100),
    });

    store.chats.createSession(chatSession('chat_0000001', daysAgo(100), 'archived'), {
      opencodeSessionId: null,
      worktree: null,
    });
    store.chats.createSession(chatSession('chat_0000002', daysAgo(1), 'archived'), {
      opencodeSessionId: null,
      worktree: null,
    });
    store.chats.createSession(chatSession('chat_0000003', daysAgo(100), 'idle'), {
      opencodeSessionId: null,
      worktree: null,
    });

    store.events.append({
      runId: null,
      chatId: null,
      seq: null,
      type: 'telemetry',
      data: {},
      ts: daysAgo(20),
    });
    store.events.append({
      runId: null,
      chatId: null,
      seq: null,
      type: 'telemetry',
      data: {},
      ts: daysAgo(1),
    });

    store.approvals.create(approval('apv_0000001', daysAgo(10), 'chat_0000002', 'allowed'));
    store.approvals.create(approval('apv_0000002', daysAgo(10), 'chat_0000002', 'pending'));
    store.approvals.create(approval('apv_0000003', daysAgo(1), 'chat_0000002', 'denied'));

    const stale = join(logsDir, 'run-run_01JABCDEF');
    const fresh = join(logsDir, 'run-run_01JFRESH');
    mkdirSync(stale);
    mkdirSync(fresh);
    writeFileSync(join(stale, 'gate.log'), 'old gate\n');
    writeFileSync(join(fresh, 'gate.log'), 'new gate\n');
    writeFileSync(join(logsDir, 'keepalive.jsonl'), '{}\n');
    const longAgo = new Date(AT.getTime() - 40 * DAY_MS);
    utimesSync(stale, longAgo, longAgo);

    const service = createTelemetryService({
      context,
      probes: { disk: () => DISK, queue: () => QUEUE },
      logsDir,
    });

    expect(service.retention(AT)).toEqual({
      runs: 1,
      events: 1,
      chats: 1,
      approvals: 1,
      logDirectories: 1,
    });

    expect(store.runs.get('run_0000001')).toBeNull();
    expect(store.runs.get('run_0000002')).not.toBeNull();
    expect(store.runs.get('run_0000003')?.state).toBe('running');
    expect(store.usage.listByDay('2026-07-17').map((entry) => entry.runId)).toEqual([null]);
    expect(store.chats.getSession('chat_0000001')).toBeNull();
    expect(store.chats.getSession('chat_0000002')).not.toBeNull();
    expect(store.chats.getSession('chat_0000003')).not.toBeNull();
    expect(store.approvals.get('apv_0000001')).toBeNull();
    expect(store.approvals.get('apv_0000002')?.state).toBe('pending');
    expect(store.approvals.get('apv_0000003')?.state).toBe('denied');
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(join(logsDir, 'keepalive.jsonl'))).toBe(true);

    const done = fixture.lines.filter((line) => line['msg'] === 'retention_done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      runs: 1,
      events: 1,
      chats: 1,
      approvals: 1,
      logDirectories: 1,
    });
  });

  it('logs the second retention pass as zero when nothing is left', () => {
    const fixture = harness();
    const service = createTelemetryService({
      context: fixture.context,
      probes: { disk: () => DISK, queue: () => QUEUE },
      logsDir: fixture.logsDir,
    });
    expect(service.retention(AT)).toEqual({
      runs: 0,
      events: 0,
      chats: 0,
      approvals: 0,
      logDirectories: 0,
    });
  });
});

describe('telemetry retention timer', () => {
  it('runs once after the first delay and then on every interval, and stops twice', () => {
    const fixture = harness();
    vi.useFakeTimers();
    try {
      const service = createTelemetryService({
        context: fixture.context,
        probes: { disk: () => DISK, queue: () => QUEUE },
        logsDir: fixture.logsDir,
        firstDelayMs: 1_000,
        retentionIntervalMs: 5_000,
      });
      expect(vi.getTimerCount()).toBe(0);
      service.start();
      expect(vi.getTimerCount()).toBe(1);
      service.start();
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(999);
      expect(fixture.lines.filter((line) => line['msg'] === 'retention_done')).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(fixture.lines.filter((line) => line['msg'] === 'retention_done')).toHaveLength(1);

      vi.advanceTimersByTime(5_000);
      expect(fixture.lines.filter((line) => line['msg'] === 'retention_done')).toHaveLength(2);

      service.stop();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => service.stop()).not.toThrow();
      vi.advanceTimersByTime(50_000);
      expect(fixture.lines.filter((line) => line['msg'] === 'retention_done')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a failing retention as retention_failed and keeps the timer alive', () => {
    const fixture = harness();
    vi.useFakeTimers();
    try {
      const service = createTelemetryService({
        context: fixture.context,
        probes: { disk: () => DISK, queue: () => QUEUE },
        logsDir: fixture.logsDir,
        firstDelayMs: 1_000,
        retentionIntervalMs: 5_000,
      });
      fixture.store.events.pruneBefore = (): number => {
        throw new Error('db gone');
      };
      service.start();
      vi.advanceTimersByTime(1_000);
      const failed = fixture.lines.filter((line) => line['msg'] === 'retention_failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.['err']).toMatchObject({ name: 'Error', message: 'db gone' });
      expect(fixture.lines.some((line) => line['msg'] === 'retention_done')).toBe(false);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('telemetry module', () => {
  it('is the `telemetry` seam and reads nothing when it is built or registered', () => {
    const fixture = harness();
    const calls: string[] = [];
    const probes = {
      disk: async () => {
        calls.push('disk');
        return DISK;
      },
      queue: () => {
        calls.push('queue');
        return QUEUE;
      },
    };
    vi.useFakeTimers();
    try {
      const service = createTelemetryService({ context: fixture.context, probes });
      const module = createModule(fixture.context);
      expect(module.name).toBe('telemetry');
      const app = createApp({ context: fixture.context });
      registerTelemetryRoutes(app, service);
      module.register(app, fixture.context);
      expect(calls).toEqual([]);
      expect(vi.getTimerCount()).toBe(1);
      module.shutdown?.();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => module.shutdown?.()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads through loadModules and answers the route on the app it registered', async () => {
    const fixture = harness();
    const app: DaemonApp = new Hono<{ Variables: AppVariables }>();
    const report = await loadModules({ app, context: fixture.context });
    expect(report.failed).toEqual([]);
    expect(report.loaded).toContain('telemetry');
    expect(fixture.lines.some((line) => line['msg'] === 'retention_done')).toBe(false);
  });

  it('boots and stops a real daemon with a temporary state directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cb-27-start-'));
    directories.push(root);
    mkdirSync(join(root, 'install', 'app'), { recursive: true });
    const handle = await startDaemon({
      env: {
        CB_ENV: 'test',
        CB_SESSION_SECRET: SESSION_SECRET,
        CB_BIND: '127.0.0.1:0',
        CB_STATE_DIR: join(root, 'state'),
        CB_INSTALL_DIR: join(root, 'install'),
        CB_OPENCODE_URL: 'http://127.0.0.1:9',
        CB_LOG_LEVEL: 'error',
      },
      sink: () => undefined,
    });
    handles.push(handle);
    expect(handle.report.failed).toEqual([]);
    expect(handle.report.loaded).toContain('telemetry');

    const anonymous = await fetch(`http://127.0.0.1:${handle.port}/v1/telemetry`);
    expect(anonymous.status).toBe(401);

    await handle.stop('test');
    handles.length = 0;
    await expect(handle.stop('again')).resolves.toBeUndefined();
  });
});

describe('telemetry service failure', () => {
  it('lets a contract violation escape to the caller', async () => {
    const fixture = harness();
    const service: TelemetryService = createTelemetryService({
      context: fixture.context,
      probes: {
        disk: () => ({ freeBytes: 0, totalBytes: 0, usedPercent: 0 }),
        queue: () => QUEUE,
      },
    });
    await expect(service.report('1h')).rejects.toThrow();
  });
});
