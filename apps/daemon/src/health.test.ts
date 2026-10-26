import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseHealth } from '@codebox/contracts';
import type { CodeboxConfig, Health, Repo } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { RunRecord, Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from './config.js';
import { createLogger } from './logger.js';
import { DISK_UNKNOWN, aggregateStatus, collectHealth, createProbes, diskState } from './health.js';
import type { HealthProbes } from './health.js';
import { createShutdownRegistry } from './modules.js';
import type { DaemonContext } from './modules.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const CREATED_AT = '2026-01-01T00:00:00.000Z';

const REPO: Repo = {
  id: 'repo_000001',
  slug: 'octo/hello',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'auto',
  protectedPaths: ['.github/**'],
  enabled: true,
  createdAt: CREATED_AT,
};

const stores: Store[] = [];
const temporaryDirectories: string[] = [];
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cb-11-health-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runRecord(id: string, state: RunRecord['state']): RunRecord {
  return {
    id,
    repoId: REPO.id,
    jobId: null,
    state,
    trigger: 'manual',
    branch: `cb/${id}-work`,
    baseRef: 'main',
    pr: null,
    gate: null,
    guardrails: [],
    blockers: [],
    diff: null,
    cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
    createdAt: CREATED_AT,
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
  };
}

interface Harness {
  readonly context: DaemonContext;
  readonly store: Store;
}

function harness(overrides: Partial<CodeboxConfig> = {}): Harness {
  const directory = temporaryDirectory();
  const base = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const config: CodeboxConfig = { ...base, ...overrides };
  const store = openInMemoryStore();
  stores.push(store);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  return {
    store,
    context: {
      config,
      store,
      logger,
      clock: () => new Date('2026-10-25T00:00:00.000Z'),
      flags: {
        auth: true,
        chat: true,
        events: true,
        run: true,
        gate: true,
        jobs: true,
        runs: true,
        push: true,
        routines: true,
        telemetry: true,
        cli: true,
      },
      build: readBuildInfo(config),
      paths: resolvePaths(config),
      appDir: join(directory, 'app'),
      shutdown: createShutdownRegistry(logger),
    },
  };
}

interface TestServer {
  readonly url: string;
  readonly close: () => Promise<void>;
}

async function httpServer(status: number): Promise<TestServer> {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const url = await new Promise<string>((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no address');
      done(`http://127.0.0.1:${(address as AddressInfo).port}`);
    });
  });
  return {
    url,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

function healthWith(disk: Health['disk']): Health {
  return {
    status: 'ok',
    db: 'ok',
    opencode: 'ok',
    disk,
    queue: { pending: 0, running: 0, maxConcurrency: 1 },
    version: '0.0.0',
  };
}

function probes(overrides: Partial<HealthProbes> = {}): HealthProbes {
  return {
    db: () => 'ok',
    opencode: () => 'ok',
    disk: () => ({ freeBytes: 500, totalBytes: 1000, usedPercent: 50 }),
    queue: () => ({ pending: 0, running: 0, maxConcurrency: 2 }),
    ...overrides,
  };
}

describe('aggregateStatus', () => {
  it('is down when the database is down', () => {
    expect(aggregateStatus({ db: 'down', opencode: 'ok', disk: 'ok' })).toBe('down');
    expect(aggregateStatus({ db: 'down', opencode: 'down', disk: 'down' })).toBe('down');
  });

  it('is degraded when any dependency is not ok', () => {
    expect(aggregateStatus({ db: 'ok', opencode: 'down', disk: 'ok' })).toBe('degraded');
    expect(aggregateStatus({ db: 'ok', opencode: 'ok', disk: 'degraded' })).toBe('degraded');
    expect(aggregateStatus({ db: 'degraded', opencode: 'ok', disk: 'ok' })).toBe('degraded');
  });

  it('is ok when everything is ok', () => {
    expect(aggregateStatus({ db: 'ok', opencode: 'ok', disk: 'ok' })).toBe('ok');
  });
});

describe('diskState', () => {
  it('maps the used percentage onto the pinned thresholds', () => {
    expect(diskState({ freeBytes: 1, totalBytes: 100, usedPercent: 0 })).toBe('ok');
    expect(diskState({ freeBytes: 1, totalBytes: 100, usedPercent: 84.9 })).toBe('ok');
    expect(diskState({ freeBytes: 1, totalBytes: 100, usedPercent: 85 })).toBe('degraded');
    expect(diskState({ freeBytes: 1, totalBytes: 100, usedPercent: 94.9 })).toBe('degraded');
    expect(diskState({ freeBytes: 1, totalBytes: 100, usedPercent: 95 })).toBe('down');
  });

  it('treats an unknown disk as down', () => {
    expect(DISK_UNKNOWN).toEqual({ freeBytes: 0, totalBytes: 1, usedPercent: 100 });
    expect(diskState(DISK_UNKNOWN)).toBe('down');
  });
});

describe('collectHealth', () => {
  it('returns a parsed health object with db, opencode and disk', async () => {
    const health: Health = await collectHealth(probes(), '0.0.0');
    expect(() => parseHealth(health)).not.toThrow();
    expect(health).toMatchObject({
      status: 'ok',
      db: 'ok',
      opencode: 'ok',
      disk: { freeBytes: 500, totalBytes: 1000, usedPercent: 50 },
      queue: { pending: 0, running: 0, maxConcurrency: 2 },
      version: '0.0.0',
    });
  });

  it('degrades when only opencode is down and is down when the database is', async () => {
    const degraded = await collectHealth(probes({ opencode: () => 'down' }), '1.0.0');
    expect(degraded.status).toBe('degraded');
    const down = await collectHealth(probes({ db: () => 'down' }), '1.0.0');
    expect(down.status).toBe('down');
  });

  it('degrades when the disk probe returns the unknown value', async () => {
    const health = await collectHealth(probes({ disk: () => DISK_UNKNOWN }), '1.0.0');
    expect(health.status).toBe('degraded');
    expect(health.disk).toEqual(DISK_UNKNOWN);
  });

  it('starts the three probes together', async () => {
    const started: string[] = [];
    const later = <T>(name: string, value: T): Promise<T> =>
      new Promise((done) => {
        started.push(name);
        setTimeout(() => done(value), 5);
      });
    await collectHealth(
      probes({
        db: () => later('db', 'ok'),
        opencode: () => later('opencode', 'ok'),
        disk: () => later('disk', DISK_UNKNOWN),
      }),
      '1.0.0',
    );
    expect(started).toEqual(['db', 'opencode', 'disk']);
  });
});

describe('createProbes', () => {
  it('reports the database as ok and counts the queue', () => {
    const { context, store } = harness();
    store.repos.create(REPO);
    store.runs.create(runRecord('run_000001', 'queued'));
    store.runs.create(runRecord('run_000002', 'running'));
    const queue = createProbes(context).queue();
    expect(queue.pending).toBe(1);
    expect(queue.running).toBe(2);
    expect(queue.maxConcurrency).toBe(3);
  });

  it('keeps maxConcurrency positive when the configured value is zero', () => {
    const { context } = harness({ CB_MAX_CONCURRENCY: 0 });
    expect(createProbes(context).queue().maxConcurrency).toBe(1);
  });

  it('reports the database as down when the statement throws', () => {
    const { context } = harness();
    context.store.close();
    expect(createProbes(context).db()).toBe('down');
  });

  it('reports a 2xx opencode health path as ok', async () => {
    const server = await httpServer(200);
    cleanups.push(server.close);
    const { context } = harness({ CB_OPENCODE_URL: server.url });
    expect(await createProbes(context).opencode()).toBe('ok');
  });

  it('reports a non-2xx opencode answer as down', async () => {
    const server = await httpServer(503);
    cleanups.push(server.close);
    const { context } = harness({ CB_OPENCODE_URL: server.url });
    expect(await createProbes(context).opencode()).toBe('down');
  });

  it('reports a refused opencode connection as down', async () => {
    const server = await httpServer(200);
    const url = server.url;
    await server.close();
    const { context } = harness({ CB_OPENCODE_URL: url });
    expect(await createProbes(context).opencode()).toBe('down');
  });

  it('reads the real filesystem for the disk probe', async () => {
    const { context } = harness();
    const info = await createProbes(context).disk();
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.freeBytes).toBeGreaterThanOrEqual(0);
    expect(info.usedPercent).toBeGreaterThanOrEqual(0);
    expect(info.usedPercent).toBeLessThanOrEqual(100);
    expect(() => parseHealth(healthWith(info))).not.toThrow();
  });

  it('reports the unknown disk when the state directory is gone', async () => {
    const { context } = harness();
    rmSync(context.paths.stateDir, { recursive: true, force: true });
    expect(await createProbes(context).disk()).toEqual(DISK_UNKNOWN);
  });
});
