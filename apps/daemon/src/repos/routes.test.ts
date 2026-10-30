import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  pageOfRepo,
  parseRepo,
  parseRepoDetail,
  parseRepoVerify,
} from '@codebox/contracts';
import type { Repo, Scope, Work } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { RunRecord, Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerReposRoutes } from './routes.js';
import { createReposService } from './service.js';
import type { RepoVerifyPort } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
const NOW = '2026-10-25T00:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface HarnessOptions {
  readonly verify?: RepoVerifyPort;
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly logs: string[];
  device(scopes?: readonly Scope[]): string;
  call(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<Response>;
}

function harness(options: HarnessOptions = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-88-repos-routes-'));
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
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date(NOW),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  const verify: RepoVerifyPort = options.verify ?? {
    verify: async () => ({ defaultBranch: 'main', canPush: true }),
  };
  registerReposRoutes(app, createReposService({ context, verify }));
  let devices = 0;
  return {
    app,
    store,
    logs,
    device(scopes: readonly Scope[] = ['read']): string {
      devices += 1;
      const id = `dev_repos${String(devices).padStart(3, '0')}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now: new Date(NOW),
        ttlSeconds: ACCESS_TTL_SECONDS,
      }).token;
    },
    async call(method, path, callOptions = {}): Promise<Response> {
      const headers: Record<string, string> = {};
      if (callOptions.token !== undefined) headers['authorization'] = `Bearer ${callOptions.token}`;
      const init: RequestInit = { method, headers };
      if (callOptions.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(callOptions.body);
      }
      return app.request(path, init);
    },
  };
}

async function errorOf(response: Response): Promise<{ code: string; details?: unknown }> {
  const body = errorEnvelopeSchema.parse(await response.json());
  return { code: body.error.code, details: body.error.details };
}

async function createRepo(
  test: Harness,
  token: string,
  body: Record<string, unknown> = { slug: 'acme/example' },
): Promise<Repo> {
  const response = await test.call('POST', '/v1/repos', { token, body });
  expect(response.status).toBe(201);
  return parseRepo(await response.json());
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

function work(id: string, repoId: string, backlogRef: string, state: Work['state']): Work {
  return {
    id,
    repoId,
    backlogRef,
    title: `Work ${backlogRef}`,
    prompt: `Do ${backlogRef}`,
    specSha: '9f1c2ab',
    state,
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

describe('GET /v1/repos', () => {
  it('answers a Page of repositories whose counts are the works the store holds', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const counted = await createRepo(test, token, { slug: 'acme/counted' });
    const empty = await createRepo(test, token, { slug: 'acme/empty' });

    const states: Work['state'][] = ['queued', 'running', 'merged', 'needs_decision', 'failed'];
    states.forEach((state, index) => {
      test.store.works.create(
        work(`wrk_000000${index + 1}`, counted.id, `Task-0${index + 1}`, state),
      );
    });

    const response = await test.call('GET', '/v1/repos', { token });
    expect(response.status).toBe(200);
    const page = pageOfRepo.parse(await response.json());
    expect(page.nextCursor).toBeNull();
    expect(page.data).toHaveLength(2);

    const byId = new Map(page.data.map((repo) => [repo.id, repo]));
    expect(byId.get(counted.id)?.counts).toEqual({ pending: 1, running: 1, merged: 1 });
    expect(byId.get(empty.id)?.counts).toEqual({ pending: 0, running: 0, merged: 0 });
  });

  it('pages with limit and cursor, newest first', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    await createRepo(test, token, { slug: 'acme/one' });
    await createRepo(test, token, { slug: 'acme/two' });

    const first = await test.call('GET', '/v1/repos?limit=1', { token });
    expect(first.status).toBe(200);
    const page = pageOfRepo.parse(await first.json());
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();

    const second = await test.call(
      'GET',
      `/v1/repos?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      { token },
    );
    const last = pageOfRepo.parse(await second.json());
    expect(last.data).toHaveLength(1);
    expect(last.data[0]?.id).not.toBe(page.data[0]?.id);
    expect(last.nextCursor).toBeNull();
  });

  it('refuses a repeated query key and an unreadable cursor with repos.cursor', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    await createRepo(test, token);

    const repeated = await test.call('GET', '/v1/repos?cursor=a&cursor=b', { token });
    expect(repeated.status).toBe(422);
    expect(await errorOf(repeated)).toEqual({
      code: 'validation_failed',
      details: { path: 'repos.cursor' },
    });

    const badCursor = await test.call('GET', '/v1/repos?cursor=not-a-cursor', { token });
    expect(badCursor.status).toBe(422);
    expect(await errorOf(badCursor)).toEqual({
      code: 'validation_failed',
      details: { path: 'repos.cursor' },
    });
  });

  it('needs a bearer token', async () => {
    const test = harness();
    const response = await test.call('GET', '/v1/repos');
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toEqual({
      code: 'unauthorized',
      details: { reason: 'unauthorized' },
    });
  });
});

describe('POST /v1/repos', () => {
  it('creates with the defaults and answers 201 with zero counts', async () => {
    const test = harness();
    const repo = await createRepo(test, test.device(['read', 'write']));
    expect(repo.slug).toBe('acme/example');
    expect(repo.defaultBranch).toBe('main');
    expect(repo.gate).toBe('npm ci && npm test && npm run build');
    expect(repo.policy).toBe('auto');
    expect(repo.protectedPaths).toEqual([]);
    expect(repo.enabled).toBe(true);
    expect(repo.createdAt).toBe(NOW);
    expect(repo.counts).toEqual({ pending: 0, running: 0, merged: 0 });
    expect(test.store.repos.get(repo.id)).toEqual(repo);
  });

  it('accepts the four optional keys', async () => {
    const test = harness();
    const repo = await createRepo(test, test.device(['write']), {
      slug: 'acme/example',
      defaultBranch: 'trunk',
      gate: 'npm run gate',
      policy: 'manual',
      protectedPaths: ['.github/**', 'infra/**'],
    });
    expect(repo.defaultBranch).toBe('trunk');
    expect(repo.gate).toBe('npm run gate');
    expect(repo.policy).toBe('manual');
    expect(repo.protectedPaths).toEqual(['.github/**', 'infra/**']);
  });

  it('refuses a bad body field with repo.<field>', async () => {
    const test = harness();
    const token = test.device(['write']);

    const missingSlug = await test.call('POST', '/v1/repos', { token, body: {} });
    expect(missingSlug.status).toBe(422);
    const missing = await errorOf(missingSlug);
    expect(missing.code).toBe('validation_failed');
    expect(String((missing.details as { path?: unknown }).path)).toBe('repo.slug');

    const unknownKey = await test.call('POST', '/v1/repos', {
      token,
      body: { slug: 'acme/example', extra: true },
    });
    expect(unknownKey.status).toBe(422);
    expect((await errorOf(unknownKey)).details).toEqual({ path: 'repo.extra' });

    const badPolicy = await test.call('POST', '/v1/repos', {
      token,
      body: { slug: 'acme/example', policy: 'sometimes' },
    });
    expect(badPolicy.status).toBe(422);
    expect((await errorOf(badPolicy)).details).toEqual({ path: 'repo.policy' });
  });

  it('answers 409 unique_violation for a taken slug, never 500', async () => {
    const test = harness();
    const token = test.device(['write']);
    await createRepo(test, token);

    const duplicate = await test.call('POST', '/v1/repos', {
      token,
      body: { slug: 'acme/example' },
    });
    expect(duplicate.status).toBe(409);
    expect(await errorOf(duplicate)).toEqual({
      code: 'conflict',
      details: { reason: 'unique_violation' },
    });
    expect(test.store.repos.list()).toHaveLength(1);
  });
});

describe('GET /v1/repos/{id}', () => {
  it('answers the repository, its counts and its last run', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);
    test.store.works.create(work('wrk_000001', repo.id, 'Task-01', 'running'));

    const empty = await test.call('GET', `/v1/repos/${repo.id}`, { token });
    expect(empty.status).toBe(200);
    const detail = parseRepoDetail(await empty.json());
    expect(detail.id).toBe(repo.id);
    expect(detail.counts).toEqual({ pending: 0, running: 1, merged: 0 });
    expect(detail.lastRun).toBeNull();

    test.store.runs.create(runRecord('run_0000001', repo.id, 'succeeded'));
    const withRun = await test.call('GET', `/v1/repos/${repo.id}`, { token });
    expect(parseRepoDetail(await withRun.json()).lastRun?.id).toBe('run_0000001');
  });

  it('answers 404 not_found with details.path repo.id for an unknown id', async () => {
    const test = harness();
    const response = await test.call('GET', '/v1/repos/repo_000404', { token: test.device() });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({
      code: 'not_found',
      details: { path: 'repo.id' },
    });
  });

  it('answers 422 validation_failed for a malformed id', async () => {
    const test = harness();
    const response = await test.call('GET', '/v1/repos/nope', { token: test.device() });
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toEqual({
      code: 'validation_failed',
      details: { path: 'repo.id' },
    });
  });
});

describe('PATCH /v1/repos/{id}', () => {
  it('updates the four patchable keys', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);

    const response = await test.call('PATCH', `/v1/repos/${repo.id}`, {
      token,
      body: { gate: 'npm run gate', policy: 'manual', protectedPaths: ['ops/**'], enabled: false },
    });
    expect(response.status).toBe(200);
    const updated = parseRepo(await response.json());
    expect(updated.gate).toBe('npm run gate');
    expect(updated.policy).toBe('manual');
    expect(updated.protectedPaths).toEqual(['ops/**']);
    expect(updated.enabled).toBe(false);
    expect(updated.slug).toBe(repo.slug);
    expect(updated.counts).toEqual({ pending: 0, running: 0, merged: 0 });
  });

  it('accepts an empty body', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);
    const response = await test.call('PATCH', `/v1/repos/${repo.id}`, { token, body: {} });
    expect(response.status).toBe(200);
    expect(parseRepo(await response.json())).toEqual(repo);
  });

  it('never patches the slug or the default branch', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);
    const response = await test.call('PATCH', `/v1/repos/${repo.id}`, {
      token,
      body: { slug: 'acme/other' },
    });
    expect(response.status).toBe(422);
    expect((await errorOf(response)).details).toEqual({ path: 'repo.slug' });
    expect(test.store.repos.get(repo.id)?.slug).toBe('acme/example');
  });

  it('answers 404 for an unknown id', async () => {
    const test = harness();
    const response = await test.call('PATCH', '/v1/repos/repo_000404', {
      token: test.device(['write']),
      body: { enabled: false },
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({
      code: 'not_found',
      details: { path: 'repo.id' },
    });
  });
});

describe('DELETE /v1/repos/{id}', () => {
  it('deletes and answers 204 with an empty body', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);

    const response = await test.call('DELETE', `/v1/repos/${repo.id}`, { token });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(test.store.repos.get(repo.id)).toBeNull();
  });

  it('refuses a live run with 409 repo_has_live_run', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);
    test.store.runs.create(runRecord('run_0000001', repo.id, 'queued'));

    const response = await test.call('DELETE', `/v1/repos/${repo.id}`, { token });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: 'conflict',
      details: { reason: 'repo_has_live_run' },
    });
  });

  it('refuses run history with 409 repo_has_history', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);
    test.store.runs.create(runRecord('run_0000001', repo.id, 'succeeded'));

    const response = await test.call('DELETE', `/v1/repos/${repo.id}`, { token });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: 'conflict',
      details: { reason: 'repo_has_history' },
    });
  });

  it('answers 404 for an unknown id', async () => {
    const test = harness();
    const response = await test.call('DELETE', '/v1/repos/repo_000404', {
      token: test.device(['write']),
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({
      code: 'not_found',
      details: { path: 'repo.id' },
    });
  });
});

describe('POST /v1/repos/{id}/verify', () => {
  it('answers the four checks in order', async () => {
    const test = harness();
    const token = test.device(['read', 'write']);
    const repo = await createRepo(test, token);

    const response = await test.call('POST', `/v1/repos/${repo.id}/verify`, { token, body: null });
    expect(response.status).toBe(200);
    const body = parseRepoVerify(await response.json());
    expect(body.ok).toBe(true);
    expect(body.defaultBranch).toBe('main');
    expect(body.canPush).toBe(true);
    expect(body.checks.map((check) => check.name)).toEqual(['repo', 'branch', 'push', 'gate']);
    expect(body.checks.map((check) => check.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('never reads a body: an absent one is fine', async () => {
    const test = harness();
    const token = test.device(['write']);
    const repo = await createRepo(test, token);
    const response = await test.call('POST', `/v1/repos/${repo.id}/verify`, { token });
    expect(response.status).toBe(200);
    expect(parseRepoVerify(await response.json()).ok).toBe(true);
  });

  it('is not ok when the provider answers a different branch and no push', async () => {
    const test = harness({
      verify: { verify: async () => ({ defaultBranch: 'develop', canPush: false }) },
    });
    const token = test.device(['write']);
    const repo = await createRepo(test, token);

    const response = await test.call('POST', `/v1/repos/${repo.id}/verify`, { token });
    const body = parseRepoVerify(await response.json());
    expect(body.ok).toBe(false);
    expect(body.checks.map((check) => check.state)).toEqual(['ok', 'mismatch', 'forbidden', 'ok']);
  });

  it('answers 503 provider_unreachable and warns without the failure text', async () => {
    const test = harness({
      verify: {
        verify: async () => {
          throw new Error('github answered 502 for Bearer ghp_secret');
        },
      },
    });
    const token = test.device(['write']);
    const repo = await createRepo(test, token);

    const response = await test.call('POST', `/v1/repos/${repo.id}/verify`, { token });
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toEqual({
      code: 'provider_unavailable',
      details: { reason: 'provider_unreachable' },
    });

    expect(test.logs).toHaveLength(1);
    const line = test.logs[0] ?? '';
    expect(line).not.toContain('ghp_secret');
    expect(line).not.toContain('Bearer');
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record['msg']).toBe('repo_verify_failed');
    expect(record['repoId']).toBe(repo.id);
    expect(record['slug']).toBe('acme/example');
  });

  it('answers 404 for an unknown id', async () => {
    const test = harness();
    const response = await test.call('POST', '/v1/repos/repo_000404/verify', {
      token: test.device(['write']),
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({
      code: 'not_found',
      details: { path: 'repo.id' },
    });
  });
});

describe('scopes', () => {
  it('refuses every mutation to a read-only device', async () => {
    const test = harness();
    const readToken = test.device(['read']);
    const repo = await createRepo(test, test.device(['write']));

    const calls: Promise<Response>[] = [
      test.call('POST', '/v1/repos', { token: readToken, body: { slug: 'acme/other' } }),
      test.call('PATCH', `/v1/repos/${repo.id}`, { token: readToken, body: { enabled: false } }),
      test.call('DELETE', `/v1/repos/${repo.id}`, { token: readToken }),
      test.call('POST', `/v1/repos/${repo.id}/verify`, { token: readToken }),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toEqual({
        code: 'forbidden',
        details: { reason: 'insufficient_scope' },
      });
    }
    expect(test.store.repos.get(repo.id)?.enabled).toBe(true);
    expect(test.store.repos.list()).toHaveLength(1);
  });

  it('refuses every mutation without a bearer', async () => {
    const test = harness();
    const repo = await createRepo(test, test.device(['write']));

    const calls: Promise<Response>[] = [
      test.call('POST', '/v1/repos', { body: { slug: 'acme/other' } }),
      test.call('PATCH', `/v1/repos/${repo.id}`, { body: { enabled: false } }),
      test.call('DELETE', `/v1/repos/${repo.id}`),
      test.call('POST', `/v1/repos/${repo.id}/verify`),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toEqual({
        code: 'unauthorized',
        details: { reason: 'unauthorized' },
      });
    }
  });
});
