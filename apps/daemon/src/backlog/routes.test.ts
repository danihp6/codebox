import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, parseBacklog } from '@codebox/contracts';
import type { Repo, Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerBacklogRoutes } from './routes.js';
import { BacklogMissingError, createBacklogService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
const NOW = '2026-10-25T00:00:00.000Z';
const REVISION = '9f1c2ab';
const MARKDOWN = `## Batch 1 — Alpha

- [ ] **[Task-02]** Open item.
      *Dependencies:* Task-01.
`;

const REPO: Repo = {
  id: 'repo_routes01',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'manual',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  device(scopes?: readonly Scope[]): string;
  call(path: string, token?: string): Promise<Response>;
}

function harness(missing: boolean): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-72-backlog-routes-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  store.repos.create(REPO);
  const logger = createLogger({ level: 'error', sink: () => undefined });
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
  const service = createBacklogService({
    context,
    runtime: {
      readSnapshot: async () => {
        if (missing) throw new BacklogMissingError(REVISION);
        return { markdown: MARKDOWN, revision: REVISION };
      },
    },
  });
  registerBacklogRoutes(app, service);
  let devices = 0;
  return {
    app,
    store,
    device(scopes: readonly Scope[] = ['read']): string {
      devices += 1;
      const id = `dev_backlog${devices}`;
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
    async call(path: string, token?: string): Promise<Response> {
      const headers: Record<string, string> = {};
      if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
      return app.request(path, { method: 'GET', headers });
    },
  };
}

describe('GET /v1/repos/{id}/backlog', () => {
  it('answers the projection and never writes', async () => {
    const test = harness(false);
    const response = await test.call(`/v1/repos/${REPO.id}/backlog`, test.device());
    expect(response.status).toBe(200);
    const backlog = parseBacklog(await response.json());
    expect(backlog.repoId).toBe(REPO.id);
    expect(backlog.revision).toBe(REVISION);
    expect(backlog.sections[0]?.items[0]?.ref).toBe('Task-02');
    expect(backlog.sections[0]?.items[0]?.needs).toEqual(['Task-01']);
    expect(test.store.works.list({ limit: 10, cursor: null }).data).toEqual([]);
  });

  it('answers an empty projection for a repository without TODO.md', async () => {
    const test = harness(true);
    const response = await test.call(`/v1/repos/${REPO.id}/backlog`, test.device());
    expect(response.status).toBe(200);
    expect(parseBacklog(await response.json())).toEqual({
      repoId: REPO.id,
      revision: REVISION,
      path: 'TODO.md',
      sections: [],
    });
  });

  it('answers 404 not_found with details.path for an unknown repository', async () => {
    const test = harness(false);
    const response = await test.call('/v1/repos/repo_000404/backlog', test.device());
    expect(response.status).toBe(404);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.details).toEqual({ path: 'repo.id' });
  });

  it('needs a device token', async () => {
    const test = harness(false);
    const response = await test.call(`/v1/repos/${REPO.id}/backlog`);
    expect(response.status).toBe(401);
  });
});
