import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseErrorEnvelope,
  parseNotificationPreferences,
  parsePushSubscription,
} from '@codebox/contracts';
import type { Scope } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerPushRoutes } from './routes.js';
import { createPushService } from './service.js';
import type { PushSendOutcome, PushTransport } from './transport.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const PREFERENCES_PATH = '/v1/notifications/preferences';
const SUBSCRIPTIONS_PATH = '/v1/push/subscriptions';
const ENDPOINT = 'https://push.example.com/secret-endpoint';
const KEYS = { p256dh: 'p256dh-VALUE', auth: 'auth-VALUE' };

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class QuietTransport implements PushTransport {
  send(): Promise<PushSendOutcome> {
    return Promise.resolve({ kind: 'accepted', status: 201 });
  }
}

interface Harness {
  readonly app: DaemonApp;
  readonly store: Store;
  readonly lines: Record<string, unknown>[];
  readonly service: ReturnType<typeof createPushService>;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-16-push-routes-'));
  directories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
    CB_REPO_ROOT: join(directory, 'repos'),
    CB_WORKSPACE_ROOT: join(directory, 'worktrees'),
    CB_LOG_LEVEL: 'debug',
  });
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => new Date('2026-10-25T10:00:00.000Z'),
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const service = createPushService({ context, transports: { web: new QuietTransport() } });
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  registerPushRoutes(app, service);
  return { app, store, lines, service };
}

function jsonInit(body: unknown, token?: string, method = 'POST'): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  return { method, headers, body: JSON.stringify(body) };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

async function paired(app: DaemonApp, scopes?: readonly Scope[]): Promise<string> {
  const issued = await app.request(
    '/v1/pair/code',
    jsonInit(scopes === undefined ? { name: 'Dani iPhone' } : { name: 'Dani iPhone', scopes }),
    LOOPBACK,
  );
  expect(issued.status).toBe(201);
  const code = (await bodyOf(issued))['code'];
  const exchanged = await app.request(
    '/v1/pair',
    jsonInit({
      code,
      deviceName: 'Dani iPhone',
      platform: 'ios',
      devicePublicKey: 'ed25519:test-public-key',
    }),
    LOOPBACK,
  );
  expect(exchanged.status).toBe(200);
  return String((await bodyOf(exchanged))['accessToken']);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('push routes', () => {
  it('refuses every route without a device token', async () => {
    const { app } = harness();
    const calls: [string, string][] = [
      ['GET', PREFERENCES_PATH],
      ['PATCH', PREFERENCES_PATH],
      ['POST', SUBSCRIPTIONS_PATH],
      ['DELETE', `${SUBSCRIPTIONS_PATH}/sub_01JABCDEFG`],
    ];
    for (const [method, path] of calls) {
      const response = await app.request(path, { method });
      expect(response.status).toBe(401);
      expect(parseErrorEnvelope(await bodyOf(response)).error.code).toBe('unauthorized');
    }
  });

  it('refuses the three mutations for a read-only device but serves the read', async () => {
    const { app } = harness();
    const token = await paired(app, ['read']);
    for (const [method, path] of [
      ['PATCH', PREFERENCES_PATH],
      ['POST', SUBSCRIPTIONS_PATH],
      ['DELETE', `${SUBSCRIPTIONS_PATH}/sub_01JABCDEFG`],
    ] as [string, string][]) {
      const response = await app.request(path, { method, headers: auth(token) });
      expect(response.status).toBe(403);
      expect(parseErrorEnvelope(await bodyOf(response)).error.code).toBe('forbidden');
    }
    const read = await app.request(PREFERENCES_PATH, { headers: auth(token) });
    expect(read.status).toBe(200);
  });

  it('serves the default preferences', async () => {
    const { app } = harness();
    const token = await paired(app);
    const response = await app.request(PREFERENCES_PATH, { headers: auth(token) });
    expect(response.status).toBe(200);
    expect(parseNotificationPreferences(await bodyOf(response))).toEqual({
      events: ['run.finished', 'run.failed', 'approval.created'],
      quietHours: null,
    });
  });

  it('replaces the preferences and deduplicates the events', async () => {
    const { app, store } = harness();
    const token = await paired(app);
    const response = await app.request(
      PREFERENCES_PATH,
      jsonInit(
        { events: ['run.failed', 'run.failed', 'approval.created'], quietHours: '22:00-08:00' },
        token,
        'PATCH',
      ),
    );
    expect(response.status).toBe(200);
    expect(parseNotificationPreferences(await bodyOf(response))).toEqual({
      events: ['run.failed', 'approval.created'],
      quietHours: '22:00-08:00',
    });
    expect(store.settings.get('notifications.preferences')).toEqual({
      events: ['run.failed', 'approval.created'],
      quietHours: '22:00-08:00',
    });
  });

  it('rejects an unknown preference key and a bad quiet window', async () => {
    const { app } = harness();
    const token = await paired(app);
    const unknown = await app.request(
      PREFERENCES_PATH,
      jsonInit({ events: [], quietHours: null, timezone: 'UTC' }, token, 'PATCH'),
    );
    expect(unknown.status).toBe(422);
    const unknownBody = parseErrorEnvelope(await bodyOf(unknown));
    expect(unknownBody.error.code).toBe('validation_failed');
    expect(String(unknownBody.error.details?.['path'])).toContain('timezone');

    const badWindow = await app.request(
      PREFERENCES_PATH,
      jsonInit({ events: [], quietHours: '25:00-08:00' }, token, 'PATCH'),
    );
    expect(badWindow.status).toBe(422);
    const badBody = parseErrorEnvelope(await bodyOf(badWindow));
    expect(badBody.error.code).toBe('validation_failed');
    expect(String(badBody.error.details?.['path'])).toContain('quietHours');
  });

  it('rejects a web subscription without keys or over plain http', async () => {
    const { app } = harness();
    const token = await paired(app);
    const missing = await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit({ kind: 'web', endpoint: ENDPOINT, keys: { auth: KEYS.auth } }, token),
    );
    expect(missing.status).toBe(422);
    const missingBody = parseErrorEnvelope(await bodyOf(missing));
    expect(missingBody.error.code).toBe('validation_failed');
    expect(missingBody.error.details?.['path']).toBe('push.keys.p256dh');

    const insecure = await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit({ kind: 'web', endpoint: 'http://push.example.com/x', keys: KEYS }, token),
    );
    expect(insecure.status).toBe(422);
    expect(parseErrorEnvelope(await bodyOf(insecure)).error.details?.['path']).toBe(
      'push.endpoint',
    );
  });

  it('creates, replaces and lists web subscriptions', async () => {
    const { app, service } = harness();
    const token = await paired(app);

    const created = await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit({ kind: 'web', endpoint: ENDPOINT, keys: KEYS }, token),
    );
    expect(created.status).toBe(201);
    const first = parsePushSubscription(await bodyOf(created));
    expect(first.id.startsWith('sub_')).toBe(true);
    expect(first.endpoint).toBe(ENDPOINT);
    expect(service.listSubscriptions()).toEqual([first]);

    const replaced = await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit(
        { kind: 'web', endpoint: ENDPOINT, keys: { p256dh: 'other', auth: 'other' } },
        token,
      ),
    );
    expect(replaced.status).toBe(200);
    const second = parsePushSubscription(await bodyOf(replaced));
    expect(second.id).toBe(first.id);
    expect(second.keys).toEqual({ p256dh: 'other', auth: 'other' });

    const added = await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit({ kind: 'web', endpoint: 'https://push.example.com/other', keys: KEYS }, token),
    );
    expect(added.status).toBe(201);
    expect(service.listSubscriptions()).toHaveLength(2);
  });

  it('deletes a subscription once and answers 404 afterwards', async () => {
    const { app, store, service } = harness();
    const token = await paired(app);
    const created = await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit({ kind: 'web', endpoint: ENDPOINT, keys: KEYS }, token),
    );
    const subscription = parsePushSubscription(await bodyOf(created));

    const removed = await app.request(`${SUBSCRIPTIONS_PATH}/${subscription.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');
    expect(service.listSubscriptions()).toEqual([]);
    expect(store.settings.get('push.subscriptions')).toEqual([]);

    const again = await app.request(`${SUBSCRIPTIONS_PATH}/${subscription.id}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(again.status).toBe(404);
    const body = parseErrorEnvelope(await bodyOf(again));
    expect(body.error.code).toBe('not_found');
    expect(body.error.details?.['path']).toBe('push.id');
  });

  it('logs the request without the endpoint or the subscription keys', async () => {
    const { app, lines } = harness();
    const token = await paired(app);
    await app.request(
      SUBSCRIPTIONS_PATH,
      jsonInit({ kind: 'web', endpoint: ENDPOINT, keys: KEYS }, token),
    );
    const requests = lines.filter((line) => line['msg'] === 'request');
    expect(requests.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(requests);
    expect(serialised).not.toContain('secret-endpoint');
    expect(serialised).not.toContain('p256dh-VALUE');
    expect(serialised).not.toContain('auth-VALUE');
  });
});
