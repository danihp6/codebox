import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoId, parseOrThrow } from '@codebox/contracts';
import type { Work } from '@codebox/contracts';
import { StoreError, openInMemoryStore } from '@codebox/store';
import type { RunRecord, Store } from '@codebox/store';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonContext } from '../modules.js';
import { RunApiError } from '../runs/errors.js';
import { newRepoId } from './ids.js';
import { REPO_DEFAULTS, createReposService, reposService } from './service.js';
import type { RepoVerifyPort } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-25T00:00:00.000Z';

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
  readonly logs: string[];
  at(iso: string): void;
  service(verify?: RepoVerifyPort): ReturnType<typeof createReposService>;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-88-repos-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  let now = new Date(NOW);
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => now,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  return {
    context,
    store,
    logs,
    at(iso: string): void {
      now = new Date(iso);
    },
    service(verify?: RepoVerifyPort): ReturnType<typeof createReposService> {
      return createReposService(verify === undefined ? { context } : { context, verify });
    },
  };
}

function runRecord(id: string, repoId: string, state: RunRecord['state']): RunRecord {
  return {
    id,
    repoId,
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
    createdAt: NOW,
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

function work(id: string, repoId: string, backlogRef: string): Work {
  return {
    id,
    repoId,
    backlogRef,
    title: `Work ${backlogRef}`,
    prompt: `Do ${backlogRef}`,
    specSha: '9f1c2ab',
    state: 'queued',
    origin: 'backlog',
    attempts: 0,
    maxAttempts: 2,
    usage: { usd: 0, tokensIn: 0, tokensOut: 0 },
    contextTokens: 0,
    contextEpoch: 1,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function storeErrorOf(run: () => unknown): StoreError | null {
  try {
    run();
  } catch (error) {
    return error instanceof StoreError ? error : null;
  }
  return null;
}

async function apiErrorOf(run: () => Promise<unknown>): Promise<RunApiError | null> {
  try {
    await run();
  } catch (error) {
    return error instanceof RunApiError ? error : null;
  }
  return null;
}

describe('REPO_DEFAULTS', () => {
  it('is the frozen set a create fills in', () => {
    expect(REPO_DEFAULTS).toEqual({
      defaultBranch: 'main',
      gate: 'npm ci && npm test && npm run build',
      policy: 'auto',
      protectedPaths: [],
      enabled: true,
    });
    expect(Object.isFrozen(REPO_DEFAULTS)).toBe(true);
  });
});

describe('newRepoId', () => {
  it('mints an id the contract accepts, from an injectable source', () => {
    const id = newRepoId(() => Buffer.alloc(20, 0x1f));
    expect(id).toBe(`repo_${'Z'.repeat(20)}`);
    expect(parseOrThrow(RepoId, id)).toBe(id);
    expect(parseOrThrow(RepoId, newRepoId())).toBeTypeOf('string');
  });

  it('refuses a short random buffer', () => {
    expect(() => newRepoId(() => Buffer.alloc(4))).toThrow(RangeError);
  });
});

describe('create', () => {
  it('fills the defaults, stamps the clock and answers zero counts', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });

    expect(repo.slug).toBe('acme/example');
    expect(repo.defaultBranch).toBe('main');
    expect(repo.gate).toBe(REPO_DEFAULTS.gate);
    expect(repo.policy).toBe('auto');
    expect(repo.protectedPaths).toEqual([]);
    expect(repo.enabled).toBe(true);
    expect(repo.createdAt).toBe(NOW);
    expect(repo.counts).toEqual({ pending: 0, running: 0, merged: 0 });
    expect(parseOrThrow(RepoId, repo.id)).toBe(repo.id);
  });

  it('keeps the four optional values the body carried', () => {
    const test = harness();
    const repo = test.service().create({
      slug: 'acme/example',
      defaultBranch: 'trunk',
      gate: 'npm run gate',
      policy: 'manual',
      protectedPaths: ['infra/**'],
    });
    expect(repo.defaultBranch).toBe('trunk');
    expect(repo.gate).toBe('npm run gate');
    expect(repo.policy).toBe('manual');
    expect(repo.protectedPaths).toEqual(['infra/**']);
  });

  it('surfaces a taken slug as the store refusal the route maps to 409', () => {
    const test = harness();
    const service = test.service();
    service.create({ slug: 'acme/example' });
    expect(storeErrorOf(() => service.create({ slug: 'acme/example' }))?.code).toBe(
      'unique_violation',
    );
  });
});

describe('detail', () => {
  it('answers the repo, its counts and its newest run', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });
    expect(service.detail(repo.id)).toEqual({ ...repo, lastRun: null });

    test.store.works.create(work('wrk_000001', repo.id, 'Task-01'));
    test.store.runs.create(runRecord('run_0000001', repo.id, 'succeeded'));

    const detail = service.detail(repo.id);
    expect(detail.counts).toEqual({ pending: 1, running: 0, merged: 0 });
    expect(detail.lastRun?.id).toBe('run_0000001');
  });

  it('refuses an unknown id with the repo.id path', () => {
    const test = harness();
    const thrown = ((): unknown => {
      try {
        test.service().detail('repo_000404');
      } catch (error: unknown) {
        return error;
      }
      return null;
    })();
    expect(thrown).toBeInstanceOf(RunApiError);
    expect(thrown instanceof RunApiError ? thrown.status : null).toBe(404);
    expect(thrown instanceof RunApiError ? thrown.code : null).toBe('not_found');
    expect(thrown instanceof RunApiError ? thrown.details : null).toEqual({ path: 'repo.id' });
  });
});

describe('patch', () => {
  it('updates the four patchable keys and keeps the counts', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });
    test.store.works.create(work('wrk_000001', repo.id, 'Task-01'));

    const updated = service.patch(repo.id, {
      gate: 'npm run gate',
      policy: 'manual',
      protectedPaths: ['ops/**'],
      enabled: false,
    });
    expect(updated.gate).toBe('npm run gate');
    expect(updated.policy).toBe('manual');
    expect(updated.protectedPaths).toEqual(['ops/**']);
    expect(updated.enabled).toBe(false);
    expect(updated.slug).toBe('acme/example');
    expect(updated.counts).toEqual({ pending: 1, running: 0, merged: 0 });
  });

  it('accepts an empty patch and lets not_found travel', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });
    expect(service.patch(repo.id, {})).toEqual(repo);
    expect(storeErrorOf(() => service.patch('repo_000404', {}))?.code).toBe('not_found');
  });
});

describe('remove', () => {
  it('deletes a repository without runs', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });
    service.remove(repo.id);
    expect(test.store.repos.get(repo.id)).toBeNull();
  });

  it('maps a live run to 409 repo_has_live_run', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });
    test.store.runs.create(runRecord('run_0000001', repo.id, 'queued'));

    const thrown = ((): unknown => {
      try {
        service.remove(repo.id);
      } catch (error: unknown) {
        return error;
      }
      return null;
    })();
    expect(thrown).toBeInstanceOf(RunApiError);
    expect(thrown instanceof RunApiError ? thrown.status : null).toBe(409);
    expect(thrown instanceof RunApiError ? thrown.details : null).toEqual({
      reason: 'repo_has_live_run',
    });
  });

  it('maps run history to 409 repo_has_history', () => {
    const test = harness();
    const service = test.service();
    const repo = service.create({ slug: 'acme/example' });
    test.store.runs.create(runRecord('run_0000001', repo.id, 'succeeded'));

    const thrown = ((): unknown => {
      try {
        service.remove(repo.id);
      } catch (error: unknown) {
        return error;
      }
      return null;
    })();
    expect(thrown instanceof RunApiError ? thrown.status : null).toBe(409);
    expect(thrown instanceof RunApiError ? thrown.details : null).toEqual({
      reason: 'repo_has_history',
    });
  });

  it('lets not_found travel', () => {
    const test = harness();
    expect(storeErrorOf(() => test.service().remove('repo_000404'))?.code).toBe('not_found');
  });
});

describe('list', () => {
  it('pages newest first without repeating a row and closes with a null cursor', () => {
    const test = harness();
    const service = test.service();
    test.at('2026-10-25T00:00:00.000Z');
    const first = service.create({ slug: 'acme/first' });
    test.at('2026-10-25T00:01:00.000Z');
    const second = service.create({ slug: 'acme/second' });
    test.at('2026-10-25T00:02:00.000Z');
    const third = service.create({ slug: 'acme/third' });

    const pageOne = service.list({ limit: 1, cursor: null });
    expect(pageOne.data.map((repo) => repo.id)).toEqual([third.id]);
    expect(pageOne.nextCursor).not.toBeNull();

    const pageTwo = service.list({ limit: 1, cursor: pageOne.nextCursor ?? null });
    expect(pageTwo.data.map((repo) => repo.id)).toEqual([second.id]);
    expect(pageTwo.nextCursor).not.toBeNull();

    const pageThree = service.list({ limit: 1, cursor: pageTwo.nextCursor ?? null });
    expect(pageThree.data.map((repo) => repo.id)).toEqual([first.id]);
    expect(pageThree.nextCursor).toBeNull();

    const seen = [...pageOne.data, ...pageTwo.data, ...pageThree.data].map((repo) => repo.id);
    expect(new Set(seen).size).toBe(3);
    expect(service.list({ limit: 50, cursor: null }).data.map((repo) => repo.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
  });

  it('refuses an unreadable cursor with the store rows error handle turns into 422', () => {
    const test = harness();
    test.service().create({ slug: 'acme/example' });
    const error = storeErrorOf(() => test.service().list({ limit: 10, cursor: 'not-a-cursor' }));
    expect(error?.code).toBe('invalid_row');
  });
});

describe('verify', () => {
  it('composes the four checks in order and is ok when all four pass', async () => {
    const test = harness();
    const service = test.service({
      verify: async () => ({ defaultBranch: 'main', canPush: true }),
    });
    const repo = service.create({ slug: 'acme/example' });

    const result = await service.verify(repo.id);
    expect(result.checks.map((check) => check.name)).toEqual(['repo', 'branch', 'push', 'gate']);
    expect(result.checks.map((check) => check.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(result).toEqual({
      ok: true,
      defaultBranch: 'main',
      canPush: true,
      checks: [
        { name: 'repo', state: 'ok' },
        { name: 'branch', state: 'ok' },
        { name: 'push', state: 'ok' },
        { name: 'gate', state: 'ok' },
      ],
    });
    expect(test.logs).toEqual([]);
  });

  it('reports a moved default branch and a missing push permission', async () => {
    const test = harness();
    const seen: string[] = [];
    const service = test.service({
      verify: async (slug: string) => {
        seen.push(slug);
        return { defaultBranch: 'develop', canPush: false };
      },
    });
    const repo = service.create({ slug: 'acme/example' });

    const result = await service.verify(repo.id);
    expect(seen).toEqual(['acme/example']);
    expect(result.ok).toBe(false);
    expect(result.defaultBranch).toBe('develop');
    expect(result.canPush).toBe(false);
    expect(result.checks.map((check) => check.state)).toEqual([
      'ok',
      'mismatch',
      'forbidden',
      'ok',
    ]);
  });

  it('reports a repository without a gate command as missing', async () => {
    const test = harness();
    const service = test.service({
      verify: async () => ({ defaultBranch: 'main', canPush: true }),
    });
    const repo = test.store.repos.create({
      id: 'repo_empty001',
      slug: 'acme/empty',
      defaultBranch: 'main',
      gate: '',
      policy: 'auto',
      protectedPaths: [],
      enabled: true,
      createdAt: NOW,
    });

    const result = await service.verify(repo.id);
    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.state)).toEqual(['ok', 'ok', 'ok', 'missing']);
  });

  it('turns a failing port into 503 provider_unreachable and one redacted warn line', async () => {
    const test = harness();
    const service = test.service({
      verify: async () => {
        throw new Error('github answered 502 for Bearer ghp_secret');
      },
    });
    const repo = service.create({ slug: 'acme/example' });

    const error = await apiErrorOf(() => service.verify(repo.id));
    expect(error?.status).toBe(503);
    expect(error?.code).toBe('provider_unavailable');
    expect(error?.details).toEqual({ reason: 'provider_unreachable' });

    expect(test.logs).toHaveLength(1);
    const line = test.logs[0] ?? '';
    expect(line).not.toContain('ghp_secret');
    expect(line).not.toContain('Bearer');
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record['msg']).toBe('repo_verify_failed');
    expect(record['repoId']).toBe(repo.id);
    expect(record['slug']).toBe('acme/example');
  });

  it('refuses an unknown id before touching the port', async () => {
    const test = harness();
    let calls = 0;
    const service = test.service({
      verify: async () => {
        calls += 1;
        return { defaultBranch: 'main', canPush: true };
      },
    });

    const error = await apiErrorOf(() => service.verify('repo_000404'));
    expect(error?.status).toBe(404);
    expect(error?.details).toEqual({ path: 'repo.id' });
    expect(calls).toBe(0);
  });
});

describe('reposService', () => {
  it('memoises one service per daemon context', () => {
    const one = harness();
    const two = harness();
    expect(reposService(one.context)).toBe(reposService(one.context));
    expect(reposService(one.context)).not.toBe(reposService(two.context));
    expect(createReposService({ context: one.context })).not.toBe(
      createReposService({ context: one.context }),
    );
  });

  it('constructing a service performs no I/O', () => {
    const test = harness();
    expect(() => test.service()).not.toThrow();
    expect(test.store.repos.list()).toEqual([]);
  });
});
