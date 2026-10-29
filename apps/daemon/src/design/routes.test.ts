import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, parseDesignPreview } from '@codebox/contracts';
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
import { registerDesignRoutes } from './routes.js';
import { DesignReadError, DesignRevisionError, createDesignService } from './service.js';
import type { DesignRuntime, DesignSnapshot } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
const NOW = '2026-10-29T10:00:00.000Z';
const SHORT = '9f1c2ab';
const FULL = '9f1c2ab0123456789abcdef0123456789abcdef0';
const TOKENS = '{"color":{"ink":{"$value":"#0b1120","$type":"color"}}}';
const ROUTES =
  '{"routes":[{"path":"/repos/:id","screen":"Repo · backlog","component":"RepoBacklogPage"}]}';
const SCREEN =
  '{"screen":"Repo · backlog","route":"/repos/:id","states":{"loading":"a","empty":"b","error":"c"}}';

const REPO: Repo = {
  id: 'repo_routes79',
  slug: 'acme/widgets',
  defaultBranch: 'main',
  gate: 'npm test',
  policy: 'manual',
  protectedPaths: [],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

type Mode = 'ok' | 'absent' | 'unknown-revision' | 'read-failure' | 'invalid-document';

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
  readonly requested: (string | null)[];
  readonly repositories: Repo[];
  device(scopes?: readonly Scope[]): string;
  call(path: string, token?: string): Promise<Response>;
  logs(): readonly Record<string, unknown>[];
}

function snapshotOf(mode: Mode): DesignSnapshot {
  return {
    revision: FULL,
    source:
      mode === 'absent'
        ? { tokens: null, routes: null, screens: [] }
        : mode === 'invalid-document'
          ? {
              tokens: '{"color":{"ink":{"$value":"#0b1120"}}}',
              routes: ROUTES,
              screens: [],
            }
          : {
              tokens: TOKENS,
              routes: ROUTES,
              screens: [{ file: 'design/screens/repo-backlog.json', text: SCREEN }],
            },
  };
}

function harness(mode: Mode): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-79-design-routes-'));
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
  const lines: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => lines.push(line) });
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
  const requested: (string | null)[] = [];
  const repositories: Repo[] = [];
  const runtime: DesignRuntime = {
    async readDesign(repo: Repo, revision: string | null): Promise<DesignSnapshot> {
      requested.push(revision);
      repositories.push(repo);
      if (mode === 'unknown-revision') throw new DesignRevisionError(revision ?? '');
      if (mode === 'read-failure') throw new DesignReadError('show', 128);
      return snapshotOf(mode);
    },
  };
  const service = createDesignService({ context, runtime });
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  registerDesignRoutes(app, service, store);
  let devices = 0;
  return {
    app,
    store,
    requested,
    repositories,
    device(scopes: readonly Scope[] = ['read']): string {
      devices += 1;
      const id = `dev_design${devices}`;
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
    logs(): readonly Record<string, unknown>[] {
      return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}

describe('GET /v1/repos/{id}/design', () => {
  it('answers the projection at the default branch head', async () => {
    const test = harness('ok');
    const response = await test.call(`/v1/repos/${REPO.id}/design`, test.device());

    expect(response.status).toBe(200);
    const preview = parseDesignPreview(await response.json());
    expect(preview.repoId).toBe(REPO.id);
    expect(preview.revision).toBe(FULL);
    expect(preview.present).toBe(true);
    expect(preview.tokens).toEqual([{ name: 'color.ink', type: 'color', value: '#0b1120' }]);
    expect(preview.screens).toHaveLength(1);
    expect(preview.findings).toEqual([]);
    expect(preview.checkedAt).toBe(NOW);
    expect(test.requested).toEqual([null]);
    expect(test.repositories).toEqual([REPO]);
    expect(test.store.works.list({ limit: 10, cursor: null }).data).toEqual([]);
  });

  it('reads at the revision the query names and echoes the resolved commit', async () => {
    const test = harness('ok');
    const response = await test.call(
      `/v1/repos/${REPO.id}/design?revision=${SHORT}`,
      test.device(),
    );

    expect(response.status).toBe(200);
    expect(test.requested).toEqual([SHORT]);
    expect(parseDesignPreview(await response.json()).revision).toBe(FULL);
  });

  it('answers present false with empty collections for a repository without a design', async () => {
    const test = harness('absent');
    const response = await test.call(`/v1/repos/${REPO.id}/design`, test.device());

    expect(response.status).toBe(200);
    const preview = parseDesignPreview(await response.json());
    expect(preview.present).toBe(false);
    expect(preview.tokens).toEqual([]);
    expect(preview.routes).toEqual([]);
    expect(preview.screens).toEqual([]);
    expect(preview.findings).toEqual([]);
  });

  it('answers 404 not_found for an unknown repository', async () => {
    const test = harness('ok');
    const response = await test.call('/v1/repos/repo_000404/design', test.device());

    expect(response.status).toBe(404);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.details).toEqual({ path: 'repo.id' });
  });

  it('answers 422 repo.id for an id that is not a repo id', async () => {
    const test = harness('ok');
    const response = await test.call('/v1/repos/wrk_000404/design', test.device());

    expect(response.status).toBe(422);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual({ path: 'repo.id' });
  });

  it('answers 422 design.revision for a query that is not a commit sha', async () => {
    const test = harness('ok');
    const response = await test.call(`/v1/repos/${REPO.id}/design?revision=nope`, test.device());

    expect(response.status).toBe(422);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual({ path: 'design.revision' });
    expect(test.requested).toEqual([]);
  });

  it('answers 422 design.revision for a repeated query key', async () => {
    const test = harness('ok');
    const response = await test.call(
      `/v1/repos/${REPO.id}/design?revision=${SHORT}&revision=${SHORT}`,
      test.device(),
    );

    expect(response.status).toBe(422);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual({ path: 'design.revision' });
    expect(test.requested).toEqual([]);
  });

  it('answers 422 revision_unknown and warns without reading a document', async () => {
    const test = harness('unknown-revision');
    const response = await test.call(
      `/v1/repos/${REPO.id}/design?revision=${SHORT}`,
      test.device(),
    );

    expect(response.status).toBe(422);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual({
      path: 'design.revision',
      reason: 'revision_unknown',
    });
    const warning = test.logs().find((line) => line['msg'] === 'design_preview_revision_unknown');
    expect(warning).toMatchObject({ level: 'warn', repoId: REPO.id, revision: SHORT });
  });

  it('answers 422 invalid_document with the file that does not parse', async () => {
    const test = harness('invalid-document');
    const response = await test.call(`/v1/repos/${REPO.id}/design`, test.device());

    expect(response.status).toBe(422);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual({
      path: 'design.document',
      file: 'design/tokens.json',
      reason: 'invalid_document',
    });
    const warning = test.logs().find((line) => line['msg'] === 'design_preview_invalid');
    expect(warning).toMatchObject({ level: 'warn', repoId: REPO.id, file: 'design/tokens.json' });
    expect(JSON.stringify(warning)).not.toContain('$value');
  });

  it('answers 503 workspace_unavailable when git fails', async () => {
    const test = harness('read-failure');
    const response = await test.call(
      `/v1/repos/${REPO.id}/design?revision=${SHORT}`,
      test.device(),
    );

    expect(response.status).toBe(503);
    const body = errorEnvelopeSchema.parse(await response.json());
    expect(body.error.code).toBe('agent_unavailable');
    expect(body.error.details).toEqual({ reason: 'workspace_unavailable' });
    const warning = test.logs().find((line) => line['msg'] === 'design_preview_failed');
    expect(warning).toMatchObject({
      level: 'warn',
      repoId: REPO.id,
      revision: SHORT,
      command: 'show',
      code: 128,
    });
  });

  it('needs a device token', async () => {
    const test = harness('ok');
    const response = await test.call(`/v1/repos/${REPO.id}/design`);

    expect(response.status).toBe(401);
  });
});
