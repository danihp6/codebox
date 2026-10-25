import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approvalSchema,
  errorEnvelopeSchema,
  pageOfApproval,
  parseApproval,
} from '@codebox/contracts';
import type { Repo, Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorkspaceStatus } from '@codebox/workspaces';
import { createModule as createAuthModule } from '../auth/index.js';
import { createApp } from '../app.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import type { RunEngine, RunOutcome } from '../run/ports.js';
import { registerApprovalRoutes } from './approvals.js';
import { createRunsService } from './service.js';
import type { RunsService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const DEVICE = 'dev_approval01';
const NOW = '2026-10-25T00:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];
const services: RunsService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fakeEngine(): RunEngine {
  return {
    start(): Promise<RunOutcome> {
      return new Promise<RunOutcome>(() => undefined);
    },
    cancel(): Promise<boolean> {
      return Promise.resolve(false);
    },
    active(): readonly string[] {
      return [];
    },
  };
}

function fakeWorkspaces(): Pick<WorkspaceManager, 'status'> {
  return {
    status(): Promise<WorkspaceStatus> {
      return Promise.resolve({
        branch: 'cb/run_x-fixture',
        baseSha: 'deadbee',
        headSha: 'deadbee',
        commitsAhead: 0,
        dirty: false,
        diff: { files: 0, added: 0, removed: 0, changedFiles: [] },
        changedPaths: [],
        protectedHits: [],
      });
    },
  };
}

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly service: RunsService;
  now(): Date;
  advance(seconds: number): void;
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-15-approvals-'));
  directories.push(directory);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_OPENCODE_URL: 'http://127.0.0.1:9',
  });
  const store = openInMemoryStore();
  stores.push(store);
  let now = new Date(NOW);
  const logger = createLogger({ level: 'error', sink: () => undefined });
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
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  const service = createRunsService({
    context,
    engine: fakeEngine(),
    workspaces: fakeWorkspaces(),
    now: () => now,
  });
  services.push(service);
  registerApprovalRoutes(app, service);
  store.repos.create(seedRepo());
  let devices = 0;

  return {
    app,
    store,
    service,
    now: () => now,
    advance(seconds: number): void {
      now = new Date(now.getTime() + seconds * 1000);
    },
    device(scopes: readonly Scope[] = ['read', 'write']): string {
      devices += 1;
      const id = `dev_approval0${devices}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now,
        ttlSeconds: 900,
      }).token;
    },
    async call(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      return app.request(path, init);
    },
  };
}

function seedRepo(): Repo {
  return {
    id: 'repo_test01',
    slug: 'dani/example',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: ['.github/**'],
    enabled: true,
    createdAt: NOW,
  };
}

function runId(test: Harness, index: number): string {
  const created = test.service.createRun({
    repoId: 'repo_test01',
    prompt: `Approval fixture ${index}`,
    mode: 'work',
    deviceId: DEVICE,
    idempotencyKey: `approval-fixture-${index}`,
  });
  return created.id;
}

function seedApproval(
  test: Harness,
  index: number,
  options: { runId?: string | null; ttlSeconds?: number; state?: 'pending' } = {},
): string {
  const id = `apv_approval0${index}`;
  const at = test.now();
  test.store.approvals.create({
    id,
    state: options.state ?? 'pending',
    tool: 'bash',
    title: `Run the tests ${index}`,
    runId: options.runId === undefined ? null : options.runId,
    chatId: options.runId === undefined || options.runId === null ? 'chat_fixture01' : null,
    input: { command: 'npm test' },
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + (options.ttlSeconds ?? 600) * 1000).toISOString(),
    resolvedAt: null,
  });
  return id;
}

function seedChat(test: Harness): void {
  test.store.chats.createSession(
    {
      id: 'chat_fixture01',
      repoId: 'repo_test01',
      title: 'Fixture',
      status: 'idle',
      createdAt: NOW,
      updatedAt: NOW,
      lastMessage: null,
    },
    { opencodeSessionId: null, worktree: null },
  );
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

function errorOf(value: Record<string, unknown>): Record<string, unknown> {
  expect(() => errorEnvelopeSchema.parse(value)).not.toThrow();
  const error = value['error'];
  if (typeof error !== 'object' || error === null) throw new Error('no error body');
  return error as Record<string, unknown>;
}

describe('the approvals inbox', () => {
  it('defaults to pending, is oldest first and accepts the four states', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const run = runId(test, 1);
    const first = seedApproval(test, 1, { runId: run });
    test.advance(1);
    const second = seedApproval(test, 2, { runId: run });

    const inbox = await test.call('GET', '/v1/approvals', { token });
    expect(inbox.status).toBe(200);
    const page = pageOfApproval.parse(await inbox.json());
    expect(page.data.map((entry) => entry.id)).toEqual([first, second]);
    expect(page.nextCursor).toBeNull();
    for (const entry of page.data) {
      expect(approvalSchema.parse(entry)).toEqual(entry);
      expect(entry.input['command']).toBe('npm test');
    }

    for (const state of ['pending', 'allowed', 'denied', 'expired'] as const) {
      const filtered = await test.call('GET', `/v1/approvals?state=${state}`, { token });
      expect(filtered.status).toBe(200);
      const filteredPage = pageOfApproval.parse(await filtered.json());
      expect(filteredPage.data.every((entry) => entry.state === state)).toBe(true);
    }

    const one = await test.call('GET', `/v1/approvals/${first}`, { token });
    expect(one.status).toBe(200);
    expect(parseApproval(await one.json()).id).toBe(first);

    const badState = await test.call('GET', '/v1/approvals?state=maybe', { token });
    expect(badState.status).toBe(422);
    expect(errorOf(await body(badState))).toMatchObject({
      code: 'validation_failed',
      details: { path: 'approvals.state' },
    });
  });

  it('pages with the shared cursor and names a bad one', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const run = runId(test, 1);
    const ids = [seedApproval(test, 1, { runId: run })];
    test.advance(1);
    ids.push(seedApproval(test, 2, { runId: run }));
    test.advance(1);
    ids.push(seedApproval(test, 3, { runId: run }));

    const first = await test.call('GET', '/v1/approvals?limit=2', { token });
    const firstPage = pageOfApproval.parse(await first.json());
    expect(firstPage.data.map((entry) => entry.id)).toEqual([ids[0], ids[1]]);
    expect(firstPage.nextCursor).not.toBeNull();
    const second = await test.call(
      'GET',
      `/v1/approvals?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      { token },
    );
    expect(pageOfApproval.parse(await second.json()).data.map((entry) => entry.id)).toEqual([
      ids[2],
    ]);

    const badCursor = await test.call('GET', '/v1/approvals?cursor=garbage', { token });
    expect(badCursor.status).toBe(422);
    expect(errorOf(await body(badCursor))).toMatchObject({
      code: 'validation_failed',
      details: { path: 'approvals.cursor' },
    });
  });

  it('answers an unknown approval with 404', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const unknown = await test.call('GET', '/v1/approvals/apv_zzzzzzzzzz', { token });
    expect(unknown.status).toBe(404);
    expect(errorOf(await body(unknown))).toMatchObject({
      code: 'not_found',
      details: { path: 'approval.id' },
    });
  });
});

describe('the approvals reply', () => {
  it('resolves allow once and appends exactly one approval.resolved', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const run = runId(test, 1);
    const approvalId = seedApproval(test, 1, { runId: run });

    const replied = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'allow', scope: 'once' },
    });
    expect(replied.status).toBe(200);
    const approval = parseApproval(await replied.json());
    expect(approval.state).toBe('allowed');
    expect(approval.resolvedAt).toBe(test.now().toISOString());

    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({
      approvalId,
      decision: 'allow',
      ts: test.now().toISOString(),
    });

    const again = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'deny', scope: 'session' },
    });
    expect(again.status).toBe(409);
    expect(errorOf(await body(again))).toMatchObject({
      code: 'conflict',
      details: { reason: 'approval_already_answered' },
    });
    expect(
      test.store.events.readAfterId(0, 50).filter((event) => event.type === 'approval.resolved'),
    ).toHaveLength(1);
  });

  it('records a deny decision', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const approvalId = seedApproval(test, 1);
    const replied = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'deny', scope: 'session' },
    });
    expect(replied.status).toBe(200);
    expect(parseApproval(await replied.json()).state).toBe('denied');
    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events[0]?.data).toMatchObject({ decision: 'deny' });
  });

  it('validates the reply body strictly', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const approvalId = seedApproval(test, 1);

    const badDecision = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'maybe', scope: 'once' },
    });
    expect(badDecision.status).toBe(422);
    expect(errorOf(await body(badDecision))).toMatchObject({
      details: { path: 'approval.reply.decision' },
    });

    const missingScope = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'allow' },
    });
    expect(missingScope.status).toBe(422);
    expect(errorOf(await body(missingScope))).toMatchObject({
      details: { path: 'approval.reply.scope' },
    });
    expect(test.store.approvals.get(approvalId)?.state).toBe('pending');
  });

  it('sweeps an expired approval on the next request, before answering it', async () => {
    const test = harness();
    seedChat(test);
    const token = test.device();
    const approvalId = seedApproval(test, 1, { ttlSeconds: 1 });
    test.advance(2);

    const swept = await test.call('GET', `/v1/approvals/${approvalId}`, { token });
    expect(swept.status).toBe(200);
    expect(parseApproval(await swept.json()).state).toBe('expired');

    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ approvalId, decision: 'expired' });

    const reply = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'allow', scope: 'once' },
    });
    expect(reply.status).toBe(409);
  });

  it('refuses a reply from a read-only device', async () => {
    const test = harness();
    seedChat(test);
    const approvalId = seedApproval(test, 1);
    const reader = test.device(['read']);
    const refused = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token: reader,
      body: { decision: 'allow', scope: 'once' },
    });
    expect(refused.status).toBe(403);
    expect(errorOf(await body(refused))).toMatchObject({
      code: 'forbidden',
      details: { reason: 'insufficient_scope' },
    });
    expect(test.store.approvals.get(approvalId)?.state).toBe('pending');
  });
});
