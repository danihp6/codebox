import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  pageOfRepoSchedule,
  parsePage,
  parseRepoSchedule,
  parseRepoScheduleDetail,
  repoScheduleSchema,
} from '@codebox/contracts';
import type { RepoSchedule, Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import type { ScheduleFirePort } from './fire.js';
import { registerScheduleRoutes } from './routes.js';
import { createSchedulesService } from './service.js';
import type { SchedulesService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_routes01';
const NOW = '2026-10-25T10:05:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];
const services: SchedulesService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly service: SchedulesService;
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

const record: ScheduleFirePort = {
  startRun: () => ({ runId: 'run_routes00001' }),
};

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-107-schedule-routes-'));
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
  const at = new Date(NOW);
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => at,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir: join(directory, 'app'),
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  const service = createSchedulesService({ context, now: () => at, fire: record });
  services.push(service);
  registerScheduleRoutes(app, service);
  store.repos.create({
    id: REPO_ID,
    slug: 'acme/widgets',
    defaultBranch: 'main',
    gate: 'npm test',
    policy: 'auto',
    protectedPaths: [],
    enabled: true,
    createdAt: NOW,
  });
  let devices = 0;
  return {
    app,
    store,
    service,
    device(scopes: readonly Scope[] = ['read', 'write', 'runs']): string {
      devices += 1;
      const id = `dev_schedules${devices}`;
      store.devices.create({
        id,
        name: `Device ${devices}`,
        platform: 'cli',
        publicKey: null,
        fingerprint: null,
        scopes: [...scopes],
        refreshTokenHash: sha256Hex(id),
        refreshPreviousHash: null,
        refreshExpiresAt: new Date(at.getTime() + 86_400_000).toISOString(),
        createdAt: NOW,
        lastSeenAt: null,
        revokedAt: null,
      });
      return mintAccessToken({
        deviceId: id,
        scopes,
        secret: SESSION_SECRET,
        now: at,
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

const CREATE_BODY = {
  mode: 'window',
  timezone: 'Europe/Madrid',
  windowStart: '22:00',
  windowEnd: '06:00',
  cooldownMinutes: 20,
  repoId: REPO_ID,
};

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

function detailsOf(error: Record<string, unknown>): Record<string, unknown> {
  const details = error['details'];
  if (typeof details !== 'object' || details === null) throw new Error('no details');
  return details as Record<string, unknown>;
}

describe('schedule routes', () => {
  it('answers the seven routes and a 404 in their documented statuses', async () => {
    const { device, call } = harness();
    const token = device();

    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    expect(created.status).toBe(201);
    const schedule = parseRepoSchedule(await created.json());
    expect(schedule.mode).toBe('window');
    expect(schedule.selection).toBe('nextPending');
    expect(schedule.refs).toEqual([]);
    expect(schedule.maxAttempts).toBe(2);
    expect(schedule.nextFireAt).toBe('2026-10-25T21:00:00Z');

    const list = await call('GET', '/v1/schedules', { token });
    expect(list.status).toBe(200);
    const page: unknown = await list.json();
    expect(() => parsePage(repoScheduleSchema, page, 'schedules')).not.toThrow();
    expect(pageOfRepoSchedule.safeParse(page).success).toBe(true);
    expect((page as { data: RepoSchedule[] }).data.map((entry) => entry.id)).toEqual([schedule.id]);

    const detail = await call('GET', `/v1/schedules/${schedule.id}`, { token });
    expect(detail.status).toBe(200);
    const parsedDetail = parseRepoScheduleDetail(await detail.json());
    expect(parsedDetail.schedule.id).toBe(schedule.id);
    expect(parsedDetail.nextFires[0]).toBe('2026-10-25T21:00:00Z');
    expect(parsedDetail.nextFires.length).toBeLessThanOrEqual(5);

    const patched = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { cooldownMinutes: 30 },
    });
    expect(patched.status).toBe(200);
    const patchedSchedule = parseRepoSchedule(await patched.json());
    expect(patchedSchedule.cooldownMinutes).toBe(30);
    expect(patchedSchedule.nextFireAt).toBe('2026-10-25T21:00:00Z');

    const paused = await call('POST', `/v1/schedules/${schedule.id}/pause`, { token });
    expect(paused.status).toBe(200);
    const pausedSchedule = parseRepoSchedule(await paused.json());
    expect(pausedSchedule.enabled).toBe(false);
    expect(pausedSchedule.nextFireAt).toBeNull();

    const resumed = await call('POST', `/v1/schedules/${schedule.id}/resume`, { token });
    expect(resumed.status).toBe(200);
    expect(parseRepoSchedule(await resumed.json()).nextFireAt).toBe('2026-10-25T21:00:00Z');

    const removed = await call('DELETE', `/v1/schedules/${schedule.id}`, { token });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');

    const missing = await call('GET', `/v1/schedules/${schedule.id}`, { token });
    expect(missing.status).toBe(404);
    expect(errorOf(await body(missing))['code']).toBe('not_found');
  });

  it('writes the D56 row the tick reads, sentinel title included', async () => {
    const { device, call, store } = harness();
    const created = await call('POST', '/v1/schedules', {
      token: device(),
      body: {
        repoId: REPO_ID,
        mode: 'every',
        cron: '0 9 * * *',
        timezone: 'UTC',
      },
    });
    expect(created.status).toBe(201);
    const schedule = parseRepoSchedule(await created.json());

    const row = store.repoSchedules.getByRepo(REPO_ID);
    expect(row).toEqual(schedule);
    expect(row?.selection).toBe('nextPending');
    expect(row?.refs).toEqual([]);
    expect(row?.maxAttempts).toBe(2);
    expect(store.schedules.get(schedule.id)?.title).toBe('');
  });

  it('refuses a second schedule for the same repository as schedule_exists', async () => {
    const { device, call } = harness();
    const token = device();
    expect((await call('POST', '/v1/schedules', { token, body: CREATE_BODY })).status).toBe(201);

    const second = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    expect(second.status).toBe(409);
    const error = errorOf(await body(second));
    expect(error['code']).toBe('conflict');
    expect(detailsOf(error)).toEqual({ path: 'schedule.repoId', reason: 'schedule_exists' });
  });

  it('refuses the retired keys as unknown body keys', async () => {
    const { device, call } = harness();
    const token = device();

    for (const key of ['title', 'prompt', 'chatSessionId', 'firePolicy', 'policy']) {
      const response = await call('POST', '/v1/schedules', {
        token,
        body: { ...CREATE_BODY, [key]: key === 'policy' ? 'auto' : 'x' },
      });
      expect(response.status, key).toBe(422);
      const error = errorOf(await body(response));
      expect(error['code']).toBe('validation_failed');
      expect(detailsOf(error)['path'], key).toBe(`schedule.${key}`);
    }
  });

  it('refuses an unknown body key with the schedule.<key> path', async () => {
    const { device, call } = harness();
    const token = device();

    const unknown = await call('POST', '/v1/schedules', {
      token,
      body: { ...CREATE_BODY, nope: true },
    });
    expect(unknown.status).toBe(422);
    const unknownError = errorOf(await body(unknown));
    expect(unknownError['code']).toBe('validation_failed');
    expect(detailsOf(unknownError)['path']).toBe('schedule.nope');

    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    const schedule = parseRepoSchedule(await created.json());
    const patchUnknown = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { maxAttempts: 3, nope: true },
    });
    expect(patchUnknown.status).toBe(422);
    expect(detailsOf(errorOf(await body(patchUnknown)))['path']).toBe('schedule.nope');
  });

  it('never accepts nextFireAt from a client', async () => {
    const { device, call } = harness();
    const token = device();
    const response = await call('POST', '/v1/schedules', {
      token,
      body: { ...CREATE_BODY, nextFireAt: '2027-01-01T00:00:00Z' },
    });
    expect(response.status).toBe(422);
    expect(detailsOf(errorOf(await body(response)))['path']).toBe('schedule.nextFireAt');
  });

  it('answers 422 with the field path and the machine reason', async () => {
    const { device, call } = harness();
    const token = device();

    for (const [patch, path, reason] of [
      [
        { mode: 'every', cron: '99 99 99 99 99', windowStart: null, windowEnd: null },
        'schedule.cron',
        'range',
      ],
      [
        { mode: 'every', cron: '0 3 * *', windowStart: null, windowEnd: null },
        'schedule.cron',
        'field_count',
      ],
      [{ timezone: 'Mars/Olympus' }, 'schedule.timezone', 'timezone'],
      [{ windowEnd: '22:00' }, 'schedule.windowStart', 'window'],
      [{ repoId: 'repo_000404' }, 'schedule.repoId', 'repo_missing'],
      [{ selection: 'refs', refs: [] }, 'schedule.refs', 'selection_empty'],
    ] as [Record<string, unknown>, string, string][]) {
      const response = await call('POST', '/v1/schedules', {
        token,
        body: { ...CREATE_BODY, ...patch },
      });
      expect(response.status, path).toBe(422);
      const details = detailsOf(errorOf(await body(response)));
      expect(details['path'], path).toBe(path);
      expect(details['reason'], path).toBe(reason);
    }

    const nextPendingWithRefs = await call('POST', '/v1/schedules', {
      token,
      body: { ...CREATE_BODY, selection: 'nextPending', refs: ['Task-35'] },
    });
    expect(nextPendingWithRefs.status).toBe(422);
    expect(detailsOf(errorOf(await body(nextPendingWithRefs)))).toEqual({ path: 'schedule.refs' });
  });

  it('round-trips maxAttempts and the refs selection through a patch', async () => {
    const { device, call } = harness();
    const token = device();
    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    const schedule = parseRepoSchedule(await created.json());

    const attempts = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { maxAttempts: 3 },
    });
    expect(attempts.status).toBe(200);
    expect(parseRepoSchedule(await attempts.json()).maxAttempts).toBe(3);

    const refs = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { selection: 'refs', refs: ['Task-35'] },
    });
    expect(refs.status).toBe(200);
    const refsSchedule = parseRepoSchedule(await refs.json());
    expect(refsSchedule.selection).toBe('refs');
    expect(refsSchedule.refs).toEqual(['Task-35']);
    expect(refsSchedule.maxAttempts).toBe(3);

    const empty = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { selection: 'refs', refs: [] },
    });
    expect(empty.status).toBe(422);
    expect(detailsOf(errorOf(await body(empty)))).toEqual({
      path: 'schedule.refs',
      reason: 'selection_empty',
    });

    const immutable = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { repoId: REPO_ID },
    });
    expect(immutable.status).toBe(422);
    expect(detailsOf(errorOf(await body(immutable)))['path']).toBe('schedule.repoId');
  });

  it('filters the list and refuses an unknown query key', async () => {
    const { device, call, store } = harness();
    const token = device();
    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    const schedule = parseRepoSchedule(await created.json());
    store.repoSchedules.update(schedule.id, {
      enabled: false,
      nextFireAt: null,
      updatedAt: NOW,
    });

    const paused = await call('GET', '/v1/schedules?enabled=false', { token });
    expect(paused.status).toBe(200);
    expect(parsePage(repoScheduleSchema, await paused.json(), 'schedules').data).toHaveLength(1);

    const filtered = await call('GET', `/v1/schedules?repoId=${REPO_ID}&limit=5`, { token });
    expect(filtered.status).toBe(200);

    const unknown = await call('GET', '/v1/schedules?nope=1', { token });
    expect(unknown.status).toBe(422);
  });

  it('requires write for every mutation and a bearer token for every route', async () => {
    const { device, call } = harness();
    const reader = device(['read']);
    const created = await call('POST', '/v1/schedules', {
      token: device(),
      body: CREATE_BODY,
    });
    const schedule = parseRepoSchedule(await created.json());

    for (const [method, path, bodyValue] of [
      ['POST', '/v1/schedules', CREATE_BODY],
      ['PATCH', `/v1/schedules/${schedule.id}`, { maxAttempts: 3 }],
      ['POST', `/v1/schedules/${schedule.id}/pause`, undefined],
      ['POST', `/v1/schedules/${schedule.id}/resume`, undefined],
      ['DELETE', `/v1/schedules/${schedule.id}`, undefined],
    ] as [string, string, unknown][]) {
      const response = await call(method, path, {
        token: reader,
        ...(bodyValue === undefined ? {} : { body: bodyValue }),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    const listing = await call('GET', '/v1/schedules', { token: reader });
    expect(listing.status).toBe(200);

    for (const [method, path] of [
      ['GET', '/v1/schedules'],
      ['POST', '/v1/schedules'],
      ['GET', `/v1/schedules/${schedule.id}`],
      ['PATCH', `/v1/schedules/${schedule.id}`],
      ['DELETE', `/v1/schedules/${schedule.id}`],
      ['POST', `/v1/schedules/${schedule.id}/pause`],
      ['POST', `/v1/schedules/${schedule.id}/resume`],
    ] as [string, string][]) {
      const response = await call(method, path);
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});
