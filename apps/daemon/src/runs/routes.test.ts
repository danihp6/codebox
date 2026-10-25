import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  pageOfApproval,
  pageOfJob,
  pageOfRun,
  parseApproval,
  parseJob,
  parseRun,
  parseRunDiff,
  runDiffSchema,
  runSchema,
} from '@codebox/contracts';
import type { Repo, Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import type { WorkspaceManager, WorkspaceStatus } from '@codebox/workspaces';
import { createModule as createAuthModule } from '../auth/index.js';
import { createApp } from '../app.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createJobsService } from '../jobs/service.js';
import { registerJobsRoutes } from '../jobs/routes.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import type { RunEngine, RunOutcome, RunStartInput } from '../run/ports.js';
import { registerApprovalRoutes } from './approvals.js';
import { registerRunsRoutes } from './routes.js';
import { createRunsService } from './service.js';
import type { RunsService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const ACCESS_TTL_SECONDS = 900;
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

interface FakeEngine extends RunEngine {
  readonly starts: RunStartInput[];
  readonly cancels: { readonly runId: string; readonly reason: string | undefined }[];
}

function fakeEngine(): FakeEngine {
  const starts: RunStartInput[] = [];
  const cancels: { runId: string; reason: string | undefined }[] = [];
  return {
    starts,
    cancels,
    start(input: RunStartInput): Promise<RunOutcome> {
      starts.push(input);
      return new Promise<RunOutcome>(() => undefined);
    },
    cancel(runId: string, reason?: 'operator' | 'timeout' | 'cost_cap_reached'): Promise<boolean> {
      cancels.push({ runId, reason });
      return Promise.resolve(true);
    },
    active(): readonly string[] {
      return starts.map((start) => start.runId);
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
        commitsAhead: 1,
        dirty: false,
        diff: {
          files: 1,
          added: 9,
          removed: 2,
          changedFiles: [{ path: 'src/a.ts', status: 'modified', added: 9, removed: 2 }],
        },
        changedPaths: ['src/a.ts'],
        protectedHits: [],
      });
    },
  };
}

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly raw?: string;
}

interface Harness {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly store: Store;
  readonly engine: FakeEngine;
  readonly service: RunsService;
  readonly config: DaemonContext['config'];
  now(): Date;
  advance(seconds: number): void;
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-15-runs-routes-'));
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
  const engine = fakeEngine();
  const service = createRunsService({
    context,
    engine,
    workspaces: fakeWorkspaces(),
    now: () => now,
  });
  services.push(service);
  const jobs = createJobsService({ context, runs: service, now: () => now });
  registerJobsRoutes(app, jobs);
  registerRunsRoutes(app, service);
  registerApprovalRoutes(app, service);
  seedRepo(store, () => now);
  let devices = 0;

  const test: Harness = {
    app,
    context,
    store,
    engine,
    service,
    config,
    now: () => now,
    advance(seconds: number): void {
      now = new Date(now.getTime() + seconds * 1000);
    },
    device(scopes: readonly Scope[] = ['read', 'runs', 'write']): string {
      devices += 1;
      const id = `dev_routes${devices}`;
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
        ttlSeconds: ACCESS_TTL_SECONDS,
      }).token;
    },
    async call(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
      const headers: Record<string, string> = { ...options.headers };
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method, headers };
      if (options.raw !== undefined) init.body = options.raw;
      else if (options.body !== undefined) init.body = JSON.stringify(options.body);
      return app.request(path, init);
    },
  };
  return test;
}

function seedRepo(store: Store, clock: () => Date): Repo {
  return store.repos.create({
    id: 'repo_test01',
    slug: 'dani/example',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: ['.github/**'],
    enabled: true,
    createdAt: clock().toISOString(),
  });
}

function seedChat(test: Harness): string {
  const at = test.now().toISOString();
  test.store.chats.createSession(
    {
      id: 'chat_test01',
      repoId: 'repo_test01',
      title: 'Nightly chat',
      status: 'idle',
      createdAt: at,
      updatedAt: at,
      lastMessage: null,
    },
    { opencodeSessionId: null, worktree: null },
  );
  test.store.chats.appendMessage(
    {
      id: 'msg_assistant001',
      chatId: 'chat_test01',
      role: 'assistant',
      text: 'Done.',
      createdAt: at,
    },
    { origin: 'assistant' },
  );
  return 'chat_test01';
}

let approvals = 0;

function seedApproval(test: Harness, runId: string | null): string {
  approvals += 1;
  const id = `apv_routes000${approvals}`;
  const at = test.now();
  test.store.approvals.create({
    id,
    state: 'pending',
    tool: 'bash',
    title: 'Run the tests',
    runId,
    chatId: runId === null ? 'chat_test01' : null,
    input: { command: 'npm test' },
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 600_000).toISOString(),
    resolvedAt: null,
  });
  return id;
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

describe('the runs routes contract', () => {
  it('every runs response parses with its contract schema', async () => {
    const test = harness();
    const token = test.device();
    const created = await test.call('POST', '/v1/runs', {
      token,
      body: { repoId: 'repo_test01', prompt: 'Fix the lockfile' },
      headers: { 'idempotency-key': 'contract-run' },
    });
    expect(created.status).toBe(202);
    expect(created.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const run = parseRun(await created.json());
    expect(run.state).toBe('queued');

    const fetched = await test.call('GET', `/v1/runs/${run.id}`, { token });
    expect(fetched.status).toBe(200);
    expect(parseRun(await fetched.json()).id).toBe(run.id);

    const list = await test.call('GET', '/v1/runs?limit=10', { token });
    expect(list.status).toBe(200);
    expect(pageOfRun.parse(await list.json()).data).toHaveLength(1);

    const filtered = await test.call('GET', '/v1/runs?state=queued&repoId=repo_test01', { token });
    expect(filtered.status).toBe(200);
    expect(pageOfRun.parse(await filtered.json()).data).toHaveLength(1);

    const cancelled = await test.call('POST', `/v1/runs/${run.id}/cancel`, { token, body: {} });
    expect(cancelled.status).toBe(202);
    expect(parseRun(await cancelled.json()).id).toBe(run.id);

    test.store.runs.update(run.id, { worktree: '/tmp/cb-wt', baseSha: 'deadbee' });
    const diff = await test.call('GET', `/v1/runs/${run.id}/diff`, { token });
    expect(diff.status).toBe(200);
    const diffBody = parseRunDiff(await diff.json());
    expect(diffBody).toEqual(runDiffSchema.parse(diffBody));

    const chatId = seedChat(test);
    const promoted = await test.call('POST', `/v1/chat/sessions/${chatId}/promote`, {
      token,
      body: {},
      headers: { 'idempotency-key': 'contract-promote' },
    });
    expect(promoted.status).toBe(202);
    const promotedRun = parseRun(await promoted.json());
    expect(promotedRun.trigger).toBe('promote');

    const jobs = await test.call('POST', '/v1/jobs', {
      token,
      body: {
        repoId: 'repo_test01',
        title: 'Nightly',
        prompt: 'Fix it',
        cron: '0 3 * * *',
        timezone: 'Europe/Madrid',
      },
    });
    expect(jobs.status).toBe(201);
    expect(parseJob(await body(jobs)).id).toBeDefined();
    const jobList = await test.call('GET', '/v1/jobs', { token });
    expect(pageOfJob.parse(await jobList.json()).data).toHaveLength(1);

    const approvals = await test.call('GET', '/v1/approvals', { token });
    expect(approvals.status).toBe(200);
    expect(pageOfApproval.parse(await approvals.json()).data).toEqual([]);
  });

  it('answers a refusal with the docs/api.md §3 envelope', async () => {
    const test = harness();
    const token = test.device();
    const missing = await test.call('GET', '/v1/runs/run_zzzzzzzzzzzzzz', { token });
    expect(missing.status).toBe(404);
    expect(errorOf(await body(missing))).toMatchObject({
      code: 'not_found',
      details: { path: 'run.id' },
    });

    const invalid = await test.call('POST', '/v1/runs', {
      token,
      body: { repoId: 'repo_test01', prompt: '' },
      headers: { 'idempotency-key': 'contract-invalid' },
    });
    expect(invalid.status).toBe(422);
    expect(errorOf(await body(invalid))).toMatchObject({
      code: 'validation_failed',
      details: { path: 'run.prompt' },
    });

    const malformed = await test.call('POST', '/v1/runs', {
      token,
      raw: '{"repoId":',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'contract-malformed' },
    });
    expect(malformed.status).toBe(400);
    expect(errorOf(await body(malformed))).toMatchObject({
      code: 'bad_request',
      details: { path: 'body' },
    });

    const badCursor = await test.call('GET', '/v1/runs?cursor=not-a-cursor', { token });
    expect(badCursor.status).toBe(422);
    expect(errorOf(await body(badCursor))).toMatchObject({
      code: 'validation_failed',
      details: { path: 'runs.cursor' },
    });
  });
});

describe('the runs idempotency contract', () => {
  it('a duplicate Idempotency-Key returns the first run and never starts a second', async () => {
    const test = harness();
    const token = test.device();
    const requestOptions: RequestOptions = {
      token,
      body: { repoId: 'repo_test01', prompt: 'Fix the lockfile' },
      headers: { 'idempotency-key': 'same-key' },
    };
    const first = await test.call('POST', '/v1/runs', requestOptions);
    const second = await test.call('POST', '/v1/runs', requestOptions);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstRun = parseRun(await first.json());
    const secondRun = parseRun(await second.json());
    expect(secondRun.id).toBe(firstRun.id);

    expect(test.store.runs.list({ limit: 10, cursor: null }).data).toHaveLength(1);
    expect(test.store.events.readRunAfterSeq(firstRun.id, 0, 10)).toHaveLength(1);
    expect(test.engine.starts).toHaveLength(1);

    const different = await test.call('POST', '/v1/runs', {
      token,
      body: { repoId: 'repo_test01', prompt: 'different' },
      headers: { 'idempotency-key': 'same-key' },
    });
    expect(different.status).toBe(409);
    expect(errorOf(await body(different))).toMatchObject({
      code: 'idempotency_mismatch',
      details: { key: 'same-key' },
    });

    const missing = await test.call('POST', '/v1/runs', {
      token,
      body: { repoId: 'repo_test01', prompt: 'Fix the lockfile' },
    });
    expect(missing.status).toBe(400);
    expect(errorOf(await body(missing))).toMatchObject({
      code: 'bad_request',
      details: { reason: 'idempotency_key_required' },
    });

    const job = parseJob(
      await body(
        await test.call('POST', '/v1/jobs', {
          token,
          body: {
            repoId: 'repo_test01',
            title: 'Nightly',
            prompt: 'Fix it',
            cron: '0 3 * * *',
            timezone: 'Europe/Madrid',
          },
        }),
      ),
    );
    const jobRun = await test.call('POST', `/v1/jobs/${job.id}/run`, { token });
    expect(jobRun.status).toBe(400);
    const replay = await test.call('POST', `/v1/jobs/${job.id}/run`, {
      token,
      headers: { 'idempotency-key': 'job-key' },
    });
    const replayAgain = await test.call('POST', `/v1/jobs/${job.id}/run`, {
      token,
      headers: { 'idempotency-key': 'job-key' },
    });
    expect(replay.status).toBe(202);
    expect(parseRun(await replayAgain.json()).id).toBe(parseRun(await replay.json()).id);
    expect(test.store.runs.list({ limit: 10, cursor: null }).data).toHaveLength(2);
  });
});

describe('the runs stable pagination', () => {
  it('keeps a cursor stable while new runs arrive', async () => {
    const test = harness();
    const token = test.device();
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      test.advance(1);
      const created = await test.call('POST', '/v1/runs', {
        token,
        body: { repoId: 'repo_test01', prompt: `Run ${index}` },
        headers: { 'idempotency-key': `page-${index}` },
      });
      ids.push(parseRun(await created.json()).id);
    }
    const first = await test.call('GET', '/v1/runs?limit=2', { token });
    const firstPage = pageOfRun.parse(await first.json());
    expect(firstPage.data.map((entry) => entry.id)).toEqual([ids[4], ids[3]]);
    expect(firstPage.nextCursor).not.toBeNull();

    for (let index = 0; index < 3; index += 1) {
      test.advance(1);
      await test.call('POST', '/v1/runs', {
        token,
        body: { repoId: 'repo_test01', prompt: `Newer ${index}` },
        headers: { 'idempotency-key': `newer-${index}` },
      });
    }

    const second = await test.call(
      'GET',
      `/v1/runs?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      { token },
    );
    const secondPage = pageOfRun.parse(await second.json());
    expect(secondPage.data.map((entry) => entry.id)).toEqual([ids[2], ids[1]]);
    expect(secondPage.data.some((entry) => firstPage.data.includes(entry))).toBe(false);

    const third = await test.call(
      'GET',
      `/v1/runs?limit=2&cursor=${encodeURIComponent(secondPage.nextCursor ?? '')}`,
      { token },
    );
    const thirdPage = pageOfRun.parse(await third.json());
    expect(thirdPage.data.map((entry) => entry.id)).toEqual([ids[0]]);
    expect(thirdPage.nextCursor).toBeNull();
  });
});

describe('the runs cancel state machine', () => {
  it('cancels a queued or running run and refuses merging or finished ones', async () => {
    const test = harness();
    const token = test.device();
    const create = async (prompt: string): Promise<string> => {
      const created = await test.call('POST', '/v1/runs', {
        token,
        body: { repoId: 'repo_test01', prompt },
        headers: { 'idempotency-key': `cancel-${prompt}` },
      });
      return parseRun(await created.json()).id;
    };

    const queued = await create('queued');
    const running = await create('running');
    test.store.runs.update(running, { state: 'running' });
    const merging = await create('merging');
    test.store.runs.update(merging, { state: 'merging' });
    const succeeded = await create('succeeded');
    test.store.runs.update(succeeded, { state: 'succeeded' });

    const queuedCancel = await test.call('POST', `/v1/runs/${queued}/cancel`, { token });
    expect(queuedCancel.status).toBe(202);
    const runningCancel = await test.call('POST', `/v1/runs/${running}/cancel`, { token });
    expect(runningCancel.status).toBe(202);
    expect(test.engine.cancels).toEqual([
      { runId: queued, reason: 'operator' },
      { runId: running, reason: 'operator' },
    ]);

    for (const id of [merging, succeeded]) {
      const refused = await test.call('POST', `/v1/runs/${id}/cancel`, { token });
      expect(refused.status).toBe(409);
      expect(errorOf(await body(refused))).toMatchObject({
        code: 'conflict',
        details: { reason: 'run_not_cancellable' },
      });
    }
    expect(test.engine.cancels).toHaveLength(2);
  });
});

describe('the runs event replay', () => {
  it('serves JSON replay, not SSE, with the last id as the cursor', async () => {
    const test = harness();
    const token = test.device();
    const created = await test.call('POST', '/v1/runs', {
      token,
      body: { repoId: 'repo_test01', prompt: 'Replay' },
      headers: { 'idempotency-key': 'replay-1' },
    });
    const run = parseRun(await created.json());

    for (const seq of [2, 3]) {
      test.store.events.append({
        runId: run.id,
        chatId: null,
        seq,
        type: seq === 2 ? 'run.started' : 'run.finished',
        data:
          seq === 2
            ? { runId: run.id, seq, ts: test.now().toISOString(), branch: run.branch }
            : { runId: run.id, seq, ts: test.now().toISOString(), state: 'succeeded' },
        ts: test.now().toISOString(),
      });
    }

    const page = await test.call('GET', `/v1/runs/${run.id}/events?after=1&limit=2`, { token });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const pageBody = await body(page);
    expect(pageBody).toMatchObject({ nextCursor: '3' });
    const items = pageBody['data'] as Record<string, unknown>[];
    expect(items.map((item) => item['id'])).toEqual([2, 3]);
    expect(Object.keys(items[0] ?? {})).toEqual(['id', 'seq', 'type', 'data', 'ts']);

    const empty = await test.call('GET', `/v1/runs/${run.id}/events?after=3`, { token });
    expect(await body(empty)).toEqual({ data: [], nextCursor: null });

    const unknown = await test.call('GET', '/v1/runs/run_zzzzzzzzzzzzzz/events', { token });
    expect(unknown.status).toBe(404);
  });
});

describe('the runs approvals inbox', () => {
  it('lists pending approvals, replies once and expires on the sweep', async () => {
    const test = harness();
    const token = test.device();
    const created = await test.call('POST', '/v1/runs', {
      token,
      body: { repoId: 'repo_test01', prompt: 'Approve me' },
      headers: { 'idempotency-key': 'approvals-1' },
    });
    const run = parseRun(await created.json());
    const approvalId = seedApproval(test, run.id);

    const inbox = await test.call('GET', '/v1/approvals', { token });
    expect(inbox.status).toBe(200);
    const page = pageOfApproval.parse(await inbox.json());
    expect(page.data.map((entry) => entry.id)).toEqual([approvalId]);

    const one = await test.call('GET', `/v1/approvals/${approvalId}`, { token });
    expect(one.status).toBe(200);
    expect(parseApproval(await one.json()).state).toBe('pending');

    const replied = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'allow', scope: 'once' },
    });
    expect(replied.status).toBe(200);
    expect(parseApproval(await replied.json()).state).toBe('allowed');
    const events = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ approvalId, decision: 'allow' });

    const again = await test.call('POST', `/v1/approvals/${approvalId}/reply`, {
      token,
      body: { decision: 'deny', scope: 'session' },
    });
    expect(again.status).toBe(409);
    expect(errorOf(await body(again))).toMatchObject({
      code: 'conflict',
      details: { reason: 'approval_already_answered' },
    });
    // The reply never reaches the agent: the engine recorded nothing at all.
    expect(test.engine.cancels).toEqual([]);
    expect(test.engine.starts).toHaveLength(1);

    const expiring = seedApproval(test, run.id);
    test.advance(601);
    const afterSweep = await test.call('GET', '/v1/approvals?state=expired', { token });
    const expiredPage = pageOfApproval.parse(await afterSweep.json());
    expect(expiredPage.data.map((entry) => entry.id)).toEqual([expiring]);
    const expiredEvents = test.store.events
      .readAfterId(0, 50)
      .filter((event) => event.type === 'approval.resolved');
    expect(expiredEvents.at(-1)?.data).toMatchObject({ decision: 'expired' });
  });

  it('answers an unknown approval with 404', async () => {
    const test = harness();
    const token = test.device();
    const unknown = await test.call('GET', '/v1/approvals/apv_zzzzzz', { token });
    expect(unknown.status).toBe(404);
    expect(errorOf(await body(unknown))).toMatchObject({
      code: 'not_found',
      details: { path: 'approval.id' },
    });
  });
});

describe('the runs promote route', () => {
  it('promotes the last assistant message and refuses the rest', async () => {
    const test = harness();
    const token = test.device();
    const chatId = seedChat(test);
    const promoted = await test.call('POST', `/v1/chat/sessions/${chatId}/promote`, {
      token,
      body: { title: 'Promoted work' },
      headers: { 'idempotency-key': 'promote-1' },
    });
    expect(promoted.status).toBe(202);
    const run = parseRun(await promoted.json());
    expect(run.trigger).toBe('promote');
    expect(test.engine.starts.at(-1)?.prompt).toBe('Done.');

    const noAssistant = await test.call('POST', '/v1/chat/sessions/chat_unknown01/promote', {
      token,
      body: {},
      headers: { 'idempotency-key': 'promote-2' },
    });
    expect(noAssistant.status).toBe(404);
    expect(errorOf(await body(noAssistant))).toMatchObject({
      code: 'not_found',
      details: { path: 'chat.id' },
    });

    test.store.chats.updateSession(chatId, { status: 'archived', updatedAt: NOW });
    const archived = await test.call('POST', `/v1/chat/sessions/${chatId}/promote`, {
      token,
      body: {},
      headers: { 'idempotency-key': 'promote-3' },
    });
    expect(archived.status).toBe(409);
    expect(errorOf(await body(archived))).toMatchObject({
      code: 'conflict',
      details: { reason: 'chat_archived' },
    });
  });

  it('promotes without a body and rejects a missing key', async () => {
    const test = harness();
    const token = test.device();
    const chatId = seedChat(test);
    const noKey = await test.call('POST', `/v1/chat/sessions/${chatId}/promote`, { token });
    expect(noKey.status).toBe(400);
    const promoted = await test.call('POST', `/v1/chat/sessions/${chatId}/promote`, {
      token,
      headers: { 'idempotency-key': 'promote-empty' },
    });
    expect(promoted.status).toBe(202);
    expect(runSchema.safeParse(await promoted.json()).success).toBe(true);
  });
});

describe('the runs route scope', () => {
  it('refuses every mutating route to a read-only device', async () => {
    const test = harness();
    const reader = test.device(['read']);
    const chatId = seedChat(test);
    const approvalId = seedApproval(test, null);

    const attempts: [string, string, unknown][] = [
      ['POST', '/v1/runs', { repoId: 'repo_test01', prompt: 'nope' }],
      [
        'POST',
        '/v1/jobs',
        {
          repoId: 'repo_test01',
          title: 'Nightly',
          prompt: 'Fix it',
          cron: '0 3 * * *',
          timezone: 'Europe/Madrid',
        },
      ],
      ['POST', `/v1/approvals/${approvalId}/reply`, { decision: 'allow', scope: 'once' }],
      ['POST', `/v1/chat/sessions/${chatId}/promote`, {}],
    ];

    for (const [method, path, payload] of attempts) {
      const refused = await test.call(method, path, {
        token: reader,
        body: payload,
        headers: { 'idempotency-key': 'scope-key' },
      });
      expect(refused.status, path).toBe(403);
      expect(await body(refused)).toMatchObject({
        error: { code: 'forbidden', details: { reason: 'insufficient_scope' } },
      });
    }
    expect(test.store.runs.list({ limit: 10, cursor: null }).data).toHaveLength(0);
    expect(test.store.jobs.list({ limit: 10, cursor: null }).data).toHaveLength(0);
    expect(test.store.approvals.get(approvalId)?.state).toBe('pending');
  });

  it('rejects an unauthenticated call before any handler runs', async () => {
    const test = harness();
    const anonymous = await test.call('POST', '/v1/runs', {
      body: { repoId: 'repo_test01', prompt: 'nope' },
      headers: { 'idempotency-key': 'anonymous' },
    });
    expect(anonymous.status).toBe(401);
  });
});
