import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  parseSchedule,
  parseScheduleDetail,
  scheduleSchema,
  parsePage,
} from '@codebox/contracts';
import type { Schedule, Scope } from '@codebox/contracts';
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
  const directory = mkdtempSync(join(tmpdir(), 'cb-53-schedule-routes-'));
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
  title: 'Nightly drain',
  prompt: 'Pick the next issue and open a PR.',
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

describe('schedule routes', () => {
  it('answers the seven routes and a 404 in their documented statuses', async () => {
    const { device, call } = harness();
    const token = device();

    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    expect(created.status).toBe(201);
    const schedule = parseSchedule(await created.json());
    expect(schedule.mode).toBe('window');
    expect(schedule.nextFireAt).toBe('2026-10-25T21:00:00Z');

    const list = await call('GET', '/v1/schedules', { token });
    expect(list.status).toBe(200);
    const page: unknown = await list.json();
    expect(() => parsePage(scheduleSchema, page, 'schedules')).not.toThrow();
    expect((page as { data: Schedule[] }).data.map((entry) => entry.id)).toEqual([schedule.id]);

    const detail = await call('GET', `/v1/schedules/${schedule.id}`, { token });
    expect(detail.status).toBe(200);
    const parsedDetail = parseScheduleDetail(await detail.json());
    expect(parsedDetail.schedule.id).toBe(schedule.id);
    expect(parsedDetail.nextFires[0]).toBe('2026-10-25T21:00:00Z');

    const patched = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { cooldownMinutes: 30 },
    });
    expect(patched.status).toBe(200);
    const patchedSchedule = parseSchedule(await patched.json());
    expect(patchedSchedule.cooldownMinutes).toBe(30);
    expect(patchedSchedule.nextFireAt).toBe('2026-10-25T21:00:00Z');

    const paused = await call('POST', `/v1/schedules/${schedule.id}/pause`, { token });
    expect(paused.status).toBe(200);
    const pausedSchedule = parseSchedule(await paused.json());
    expect(pausedSchedule.enabled).toBe(false);
    expect(pausedSchedule.nextFireAt).toBeNull();

    const resumed = await call('POST', `/v1/schedules/${schedule.id}/resume`, { token });
    expect(resumed.status).toBe(200);
    expect(parseSchedule(await resumed.json()).nextFireAt).toBe('2026-10-25T21:00:00Z');

    const removed = await call('DELETE', `/v1/schedules/${schedule.id}`, { token });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');

    const missing = await call('GET', `/v1/schedules/${schedule.id}`, { token });
    expect(missing.status).toBe(404);
    expect(errorOf(await body(missing))['code']).toBe('not_found');
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
    expect((unknownError['details'] as Record<string, unknown>)['path']).toBe('schedule.nope');

    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    const schedule = parseSchedule(await created.json());
    const patchUnknown = await call('PATCH', `/v1/schedules/${schedule.id}`, {
      token,
      body: { title: 'ok', nope: true },
    });
    expect(patchUnknown.status).toBe(422);
    expect((errorOf(await body(patchUnknown))['details'] as Record<string, unknown>)['path']).toBe(
      'schedule.nope',
    );
  });

  it('never accepts nextFireAt from a client', async () => {
    const { device, call } = harness();
    const token = device();
    const response = await call('POST', '/v1/schedules', {
      token,
      body: { ...CREATE_BODY, nextFireAt: '2027-01-01T00:00:00Z' },
    });
    expect(response.status).toBe(422);
    expect((errorOf(await body(response))['details'] as Record<string, unknown>)['path']).toBe(
      'schedule.nextFireAt',
    );
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
      [{ repoId: null }, 'schedule.repoId', 'repo_required'],
    ] as [Record<string, unknown>, string, string][]) {
      const response = await call('POST', '/v1/schedules', {
        token,
        body: { ...CREATE_BODY, ...patch },
      });
      expect(response.status, path).toBe(422);
      const details = errorOf(await body(response))['details'] as Record<string, unknown>;
      expect(details['path'], path).toBe(path);
      expect(details['reason'], path).toBe(reason);
    }
  });

  it('filters the list and refuses an unknown query key', async () => {
    const { device, call, store } = harness();
    const token = device();
    const created = await call('POST', '/v1/schedules', { token, body: CREATE_BODY });
    const schedule = parseSchedule(await created.json());
    store.schedules.update(schedule.id, { enabled: false, nextFireAt: null });

    const paused = await call('GET', '/v1/schedules?enabled=false', { token });
    expect(paused.status).toBe(200);
    expect(parsePage(scheduleSchema, await paused.json(), 'schedules').data).toHaveLength(1);

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
    const schedule = parseSchedule(await created.json());

    for (const [method, path, bodyValue] of [
      ['POST', '/v1/schedules', CREATE_BODY],
      ['PATCH', `/v1/schedules/${schedule.id}`, { title: 'nope' }],
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
