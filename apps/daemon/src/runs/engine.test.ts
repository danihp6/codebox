import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodeboxConfig } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import {
  createDaemonEngine,
  createDaemonPorts,
  createDaemonSettings,
  providerAuth,
} from './engine.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Harness {
  readonly context: DaemonContext;
  readonly store: Store;
  readonly lines: string[];
}

function harness(env: NodeJS.ProcessEnv = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-15-engine-'));
  directories.push(directory);
  const config: CodeboxConfig = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    ...env,
  } as NodeJS.ProcessEnv);
  const store = openInMemoryStore();
  stores.push(store);
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(line),
    now: () => new Date('2026-10-25T00:00:00.000Z'),
  });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date('2026-10-25T00:00:00.000Z'),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  return { context, store, lines };
}

function logs(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('the daemon engine wiring', () => {
  it('copies every run setting from the CB_* configuration', () => {
    const { context } = harness({
      CB_GATE_DEFAULT: 'make gate',
      CB_GATE_SHELL: '/bin/sh',
      CB_GATE_TIMEOUT_SECONDS: '60',
      CB_RUN_TIMEOUT_SECONDS: '120',
      CB_DAILY_COST_USD: '2.5',
      CB_AUTOMERGE: 'off',
      CB_MERGE_METHOD: 'merge',
      CB_PROTECTED_PATHS: '.github/**,ops/**',
      CB_DIFF_MAX_FILES: '7',
      CB_DIFF_MAX_LINES: '70',
      CB_PROBATION_RUNS: '3',
      CB_APPROVAL_TTL_SECONDS: '90',
      CB_GIT_AUTHOR_NAME: 'bot',
      CB_GIT_AUTHOR_EMAIL: 'bot@example.invalid',
      CB_GIT_HTTP_TIMEOUT_SECONDS: '11',
    });
    const settings = createDaemonSettings(context);
    expect(settings).toMatchObject({
      gateDefault: 'make gate',
      gateShell: '/bin/sh',
      gateTimeoutSeconds: 60,
      runTimeoutSeconds: 120,
      maxConcurrency: 3,
      maxPerRepo: 1,
      dailyCostUsd: 2.5,
      automerge: 'off',
      mergeMethod: 'merge',
      protectedPaths: ['.github/**', 'ops/**'],
      diffMaxFiles: 7,
      diffMaxLines: 70,
      probationRuns: 3,
      consecutiveGreenRuns: 0,
      approvalTtlSeconds: 90,
      logsDir: join(context.config.CB_STATE_DIR, 'logs'),
      author: { name: 'bot', email: 'bot@example.invalid' },
      gitTimeoutMs: 11_000,
    });
  });

  it('builds every port from the merged packages without doing I/O', () => {
    const { context } = harness();
    const ports = createDaemonPorts(context);
    expect(ports.store).toBe(context.store);
    expect(ports.clock).toBe(context.clock);
    expect(ports.gate).toBeTypeOf('function');
    expect(ports.gitRunner.run).toBeTypeOf('function');
    expect(ports.workspaces.ensureClone).toBeTypeOf('function');
    expect(ports.agent.subscribe).toBeTypeOf('function');
    expect(Number.isNaN(ports.spentTodayUsd())).toBe(false);
  });

  it('reads today spend from the usage repository', () => {
    const { context, store } = harness();
    store.usage.record({
      runId: null,
      repoId: null,
      day: '2026-10-25',
      model: null,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.25,
      createdAt: '2026-10-25T00:00:00.000Z',
    });
    expect(createDaemonPorts(context).spentTodayUsd()).toBeCloseTo(0.25, 6);
  });

  it('emits a debug line per persisted event, never a callback', () => {
    const { context, lines } = harness();
    const ports = createDaemonPorts(context);
    ports.emit({
      id: 17,
      runId: 'run_aaaaaaaaaaaaaa',
      chatId: null,
      seq: 3,
      type: 'run.queued',
      data: {},
      ts: '2026-10-25T00:00:00.000Z',
    });
    expect(logs(lines)).toContainEqual(
      expect.objectContaining({ msg: 'run_event', event: 'run.queued', eventId: 17 }),
    );
  });

  it('selects no provider auth when no GitHub credential exists', () => {
    const { context } = harness();
    const ports = createDaemonPorts(context);
    expect(ports.git.getRepo).toBeTypeOf('function');
  });

  it('starts the engine lazily and cancels nothing before a run exists', async () => {
    const { context } = harness({ CB_OPENCODE_URL: 'http://127.0.0.1:9' });
    const engine = createDaemonEngine(context);
    expect(engine.active()).toEqual([]);
    await expect(engine.cancel('run_aaaaaaaaaaaaaa')).resolves.toBe(false);
  });
});

describe('provider auth selection', () => {
  it('is none when no GitHub credential exists', () => {
    const { context } = harness();
    expect(providerAuth(context)).toEqual({ kind: 'none' });
  });

  it('uses the fine-grained PAT when only the token exists', () => {
    const { context } = harness({ CB_GITHUB_TOKEN: 'test-pat-value' });
    expect(providerAuth(context)).toEqual({ kind: 'pat', token: 'test-pat-value' });
  });

  it('prefers App keys and decodes the base64 PEM', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const encoded = Buffer.from(pem, 'utf8').toString('base64');
    const { context, lines } = harness({
      CB_GITHUB_APP_ID: '12345',
      CB_GITHUB_INSTALLATION_ID: '67890',
      CB_GITHUB_APP_PRIVATE_KEY_BASE64: encoded,
      CB_GITHUB_TOKEN: 'test-pat-value',
    });
    const auth = providerAuth(context);
    expect(auth.kind).toBe('app');
    if (auth.kind !== 'app') throw new Error('expected app auth');
    expect(auth.appId).toBe('12345');
    expect(auth.installationId).toBe('67890');
    expect(auth.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(logs(lines).some((line) => line['msg'] === 'github_app_key_invalid')).toBe(false);
  });

  it('never echoes a malformed App key into the log', () => {
    const { context, lines } = harness({
      CB_GITHUB_APP_ID: '12345',
      CB_GITHUB_INSTALLATION_ID: '67890',
      CB_GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from('not-a-key', 'utf8').toString('base64'),
    });
    expect(providerAuth(context)).toEqual({ kind: 'none' });
    const written = lines.join('\n');
    expect(written).toContain('github_app_key_invalid');
    expect(written).not.toContain('not-a-key');
  });
});
