import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  pageOfRoutine,
  parseRoutine,
  routineSchema,
} from '@codebox/contracts';
import type { ReminderRoutine, Routine, Scope } from '@codebox/contracts';
import { mintAccessToken, sha256Hex } from '@codebox/security';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerRoutineRoutes } from './routes.js';
import { createRoutineService } from './service.js';
import type { RoutineService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const REPO_ID = 'repo_routes01';
const NOW = '2026-10-25T10:00:00.000Z';

const stores: Store[] = [];
const directories: string[] = [];
const services: RoutineService[] = [];

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
  now(): Date;
  device(scopes?: readonly Scope[]): string;
  call(method: string, path: string, options?: RequestOptions): Promise<Response>;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-35-routine-routes-'));
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
  const now = new Date(NOW);
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
  const service = createRoutineService({ context, now: () => now, chat: () => null });
  services.push(service);
  registerRoutineRoutes(app, service);
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
    now: () => now,
    device(scopes: readonly Scope[] = ['read', 'write', 'runs']): string {
      devices += 1;
      const id = `dev_routines${devices}`;
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

function reminder(
  store: Store,
  input: { id: string; nextFireAt?: string | null; enabled?: boolean },
): ReminderRoutine {
  return store.routines.create({
    id: input.id,
    kind: 'reminder',
    title: 'Take the pill',
    cron: '0 12 * * *',
    timezone: 'UTC',
    enabled: input.enabled ?? true,
    notify: true,
    createdAt: NOW,
    nextFireAt: input.nextFireAt === undefined ? '2026-10-25T11:00:00Z' : input.nextFireAt,
    lastFiredAt: null,
  }) as ReminderRoutine;
}

function prompt(store: Store, id: string): Routine {
  return store.routines.create({
    id,
    kind: 'prompt',
    title: 'Morning summary',
    cron: '0 12 * * *',
    timezone: 'UTC',
    enabled: true,
    notify: true,
    repoId: REPO_ID,
    prompt: 'Summarise the repository.',
    chatSessionId: null,
    createdAt: NOW,
    nextFireAt: '2026-10-25T11:00:00Z',
    lastFiredAt: null,
  });
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

describe('routine routes', () => {
  it('lists routines newest first with the contract page envelope', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000201' });
    reminder(store, { id: 'rtn_000202' });
    reminder(store, { id: 'rtn_000203' });

    const response = await call('GET', '/v1/routines?limit=2', { token: device() });

    expect(response.status).toBe(200);
    const page = await body(response);
    expect(() => pageOfRoutine.parse(page)).not.toThrow();
    const data = page['data'] as Routine[];
    expect(data).toHaveLength(2);
    expect(data.map((entry) => entry.id)).toEqual(['rtn_000203', 'rtn_000202']);
    expect(typeof page['nextCursor']).toBe('string');

    const next = await call('GET', `/v1/routines?limit=2&cursor=${String(page['nextCursor'])}`, {
      token: device(),
    });
    const second = await body(next);
    expect((second['data'] as Routine[]).map((entry) => entry.id)).toEqual(['rtn_000201']);
    expect(second['nextCursor']).toBeNull();
  });

  it('filters the list by kind and enabled', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000204' });
    reminder(store, { id: 'rtn_000205', enabled: false, nextFireAt: null });
    prompt(store, 'rtn_000206');

    const paused = await call('GET', '/v1/routines?enabled=false', { token: device() });
    expect(((await body(paused))['data'] as Routine[]).map((entry) => entry.id)).toEqual([
      'rtn_000205',
    ]);

    const prompts = await call('GET', '/v1/routines?kind=prompt', { token: device() });
    expect(((await body(prompts))['data'] as Routine[]).map((entry) => entry.id)).toEqual([
      'rtn_000206',
    ]);

    const unknown = await call('GET', '/v1/routines?kind=other', { token: device() });
    expect(unknown.status).toBe(422);
  });

  it('reads one routine and refuses an unknown id with 404', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000207' });

    const found = await call('GET', '/v1/routines/rtn_000207', { token: device() });
    expect(found.status).toBe(200);
    const foundBody: unknown = await found.json();
    expect(() => routineSchema.parse(foundBody)).not.toThrow();

    const missing = await call('GET', '/v1/routines/rtn_999999', { token: device() });
    expect(missing.status).toBe(404);
    const error = errorOf(await body(missing));
    expect(error['code']).toBe('not_found');
    expect((error['details'] as Record<string, unknown>)['path']).toBe('routine.id');
  });

  it('patches the fields present and recomputes the next fire', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000208' });

    const response = await call('PATCH', '/v1/routines/rtn_000208', {
      token: device(),
      body: { title: 'Take the vitamins', cron: '30 12 * * *', notify: false },
    });

    expect(response.status).toBe(200);
    const updated = parseRoutine(await response.json());
    expect(updated.title).toBe('Take the vitamins');
    expect(updated.cron).toBe('30 12 * * *');
    expect(updated.notify).toBe(false);
    expect(updated.nextFireAt).toBe('2026-10-25T12:30:00Z');
    expect(store.routines.get('rtn_000208')).toMatchObject({
      title: 'Take the vitamins',
      cron: '30 12 * * *',
      notify: false,
      nextFireAt: '2026-10-25T12:30:00Z',
    });
  });

  it('refuses a prompt on a reminder, a bad cron and a bad timezone with 422', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000209' });
    const token = device();

    const promptOnReminder = await call('PATCH', '/v1/routines/rtn_000209', {
      token,
      body: { prompt: 'say something' },
    });
    expect(promptOnReminder.status).toBe(422);
    const promptError = errorOf(await body(promptOnReminder));
    expect((promptError['details'] as Record<string, unknown>)['path']).toBe('routine.prompt');

    const badCron = await call('PATCH', '/v1/routines/rtn_000209', {
      token,
      body: { cron: '99 99 99 99 99' },
    });
    expect(badCron.status).toBe(422);
    const cronError = errorOf(await body(badCron));
    expect((cronError['details'] as Record<string, unknown>)['path']).toBe('routine.cron');

    const badZone = await call('PATCH', '/v1/routines/rtn_000209', {
      token,
      body: { timezone: 'Mars/Olympus' },
    });
    expect(badZone.status).toBe(422);
    const zoneError = errorOf(await body(badZone));
    expect((zoneError['details'] as Record<string, unknown>)['path']).toBe('routine.timezone');
  });

  it('refuses an unknown body key and an unknown query key with 422', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000210' });

    const unknownKey = await call('PATCH', '/v1/routines/rtn_000210', {
      token: device(),
      body: { title: 'ok', nope: true },
    });
    expect(unknownKey.status).toBe(422);

    const unknownQuery = await call('GET', '/v1/routines?nope=true', { token: device() });
    expect(unknownQuery.status).toBe(422);
  });

  it('pauses and resumes a routine idempotently', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000211' });
    const token = device();

    const paused = await call('POST', '/v1/routines/rtn_000211/pause', { token });
    expect(paused.status).toBe(200);
    const pausedBody = parseRoutine(await paused.json());
    expect(pausedBody.enabled).toBe(false);
    expect(pausedBody.nextFireAt).toBeNull();

    const pausedAgain = await call('POST', '/v1/routines/rtn_000211/pause', { token });
    expect(pausedAgain.status).toBe(200);

    const resumed = await call('POST', '/v1/routines/rtn_000211/resume', { token });
    expect(resumed.status).toBe(200);
    const resumedBody = parseRoutine(await resumed.json());
    expect(resumedBody.enabled).toBe(true);
    expect(resumedBody.nextFireAt).toBe('2026-10-25T12:00:00Z');
  });

  it('runs a paused routine by hand without consuming the schedule', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000212', enabled: false, nextFireAt: null });
    const token = device();

    const response = await call('POST', '/v1/routines/rtn_000212/run', { token });

    expect(response.status).toBe(202);
    const fired = parseRoutine(await response.json());
    expect(fired.enabled).toBe(false);
    expect(fired.nextFireAt).toBeNull();
    expect(store.routineFires.listByRoutine('rtn_000212', 10)).toEqual([]);
    expect(
      store.events
        .readAfterId(0, 50)
        .filter((record) => record.type === 'routine.fired')
        .map((record) => record.data['routineId']),
    ).toEqual(['rtn_000212']);
  });

  it('deletes a routine and answers 204, and 404 for an unknown id', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000213' });
    const token = device();

    const response = await call('DELETE', '/v1/routines/rtn_000213', { token });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(store.routines.get('rtn_000213')).toBeNull();

    const missing = await call('DELETE', '/v1/routines/rtn_999999', { token });
    expect(missing.status).toBe(404);
    expect(errorOf(await body(missing))['code']).toBe('not_found');
  });

  it('is not mounted as a create route', async () => {
    const { device, call } = harness();

    const response = await call('POST', '/v1/routines', {
      token: device(),
      body: { kind: 'reminder', title: 'x', cron: '0 12 * * *', timezone: 'UTC' },
    });

    expect(response.status).toBe(404);
  });

  it('requires write for every mutation and runs for a manual fire', async () => {
    const { store, device, call } = harness();
    reminder(store, { id: 'rtn_000214' });
    const reader = device(['read']);
    const writer = device(['read', 'write']);

    for (const [method, path, body] of [
      ['PATCH', '/v1/routines/rtn_000214', { title: 'nope' }],
      ['POST', '/v1/routines/rtn_000214/pause', undefined],
      ['POST', '/v1/routines/rtn_000214/resume', undefined],
      ['DELETE', '/v1/routines/rtn_000214', undefined],
    ] as [string, string, unknown][]) {
      const response = await call(method, path, {
        token: reader,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    const runAsWriter = await call('POST', '/v1/routines/rtn_000214/run', { token: writer });
    expect(runAsWriter.status).toBe(403);
    expect(errorOf(await body(runAsWriter))['code']).toBe('forbidden');

    const runAsRunner = await call('POST', '/v1/routines/rtn_000214/run', {
      token: device(['read', 'runs']),
    });
    expect(runAsRunner.status).toBe(202);
  });

  it('refuses every route without a bearer token', async () => {
    const { call } = harness();

    for (const [method, path] of [
      ['GET', '/v1/routines'],
      ['GET', '/v1/routines/rtn_000215'],
      ['PATCH', '/v1/routines/rtn_000215'],
      ['POST', '/v1/routines/rtn_000215/pause'],
      ['POST', '/v1/routines/rtn_000215/resume'],
      ['POST', '/v1/routines/rtn_000215/run'],
      ['DELETE', '/v1/routines/rtn_000215'],
    ] as [string, string][]) {
      const response = await call(method, path);
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});
