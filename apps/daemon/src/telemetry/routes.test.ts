import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TELEMETRY_RANGES, parseErrorEnvelope, telemetrySchema } from '@codebox/contracts';
import type { Scope } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { createModule as createAuthModule } from '../auth/index.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { registerTelemetryRoutes } from './routes.js';
import { createTelemetryService } from './service.js';
import type { TelemetryService } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const PATH = '/v1/telemetry';
const NOW = new Date('2026-10-25T12:00:00.000Z');
const DISK = { freeBytes: 4_000, totalBytes: 10_000, usedPercent: 60 };
const QUEUE = { pending: 4, running: 1, maxConcurrency: 2 };

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
}

function harness(service?: TelemetryService): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-27-telemetry-routes-'));
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
  const logger = createLogger({ level: 'debug', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => NOW,
    flags: DEFAULT_SUBSYSTEM_FLAGS,
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createAuthModule(context).register(app, context);
  registerTelemetryRoutes(
    app,
    service ??
      createTelemetryService({
        context,
        probes: { disk: () => DISK, queue: () => QUEUE },
        logsDir: join(directory, 'state', 'logs'),
      }),
  );
  return { app, context };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

async function paired(app: DaemonApp, scopes?: readonly Scope[]): Promise<string> {
  const issued = await app.request(
    '/v1/pair/code',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        scopes === undefined ? { name: 'Dani iPhone' } : { name: 'Dani iPhone', scopes },
      ),
    },
    LOOPBACK,
  );
  expect(issued.status).toBe(201);
  const code = (await bodyOf(issued))['code'];
  const exchanged = await app.request(
    '/v1/pair',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        deviceName: 'Dani iPhone',
        platform: 'ios',
        devicePublicKey: 'ed25519:test-public-key',
      }),
    },
    LOOPBACK,
  );
  expect(exchanged.status).toBe(200);
  return String((await bodyOf(exchanged))['accessToken']);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('GET /v1/telemetry', () => {
  it('answers every range with a parsed Telemetry whose since is the window start', async () => {
    const { app } = harness();
    const token = await paired(app, ['read']);
    const expected: Record<string, string> = {
      '1h': '2026-10-25T11:00:00.000Z',
      '24h': '2026-10-24T12:00:00.000Z',
      '7d': '2026-10-18T12:00:00.000Z',
      '30d': '2026-09-25T12:00:00.000Z',
    };
    for (const range of TELEMETRY_RANGES) {
      const response = await app.request(`${PATH}?range=${range}`, { headers: auth(token) });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      const body: unknown = await response.json();
      expect(telemetrySchema.safeParse(body).success).toBe(true);
      const telemetry = telemetrySchema.parse(body);
      expect(telemetry.range).toBe(range);
      expect(telemetry.since).toBe(expected[range]);
      expect(telemetry.queueDepth).toBe(QUEUE.pending);
      expect(telemetry.disk).toEqual(DISK);
      expect(telemetry.runs).toEqual({ total: 0, succeeded: 0, failed: 0, cancelled: 0 });
    }
  });

  it('defaults to the 24h range with no query', async () => {
    const { app } = harness();
    const token = await paired(app);
    const response = await app.request(PATH, { headers: auth(token) });
    expect(response.status).toBe(200);
    const telemetry = telemetrySchema.parse(await response.json());
    expect(telemetry.range).toBe('24h');
    expect(telemetry.since).toBe('2026-10-24T12:00:00.000Z');
  });

  it('refuses an unknown range, a repeated key and an unknown key', async () => {
    const { app } = harness();
    const token = await paired(app);
    for (const query of ['?range=2d', '?range=24h&range=1h', '?rangexx=1h', '?range=']) {
      const response = await app.request(`${PATH}${query}`, { headers: auth(token) });
      expect(response.status).toBe(422);
      const envelope = parseErrorEnvelope(await bodyOf(response));
      expect(envelope.error.code).toBe('validation_failed');
      expect(String(envelope.error.details?.['path']).startsWith('telemetry.')).toBe(true);
    }
  });

  it('refuses an anonymous request and a device without the read scope', async () => {
    const { app } = harness();
    const anonymous = await app.request(PATH);
    expect(anonymous.status).toBe(401);
    expect(parseErrorEnvelope(await bodyOf(anonymous)).error.code).toBe('unauthorized');

    const token = await paired(app, ['chat']);
    const forbidden = await app.request(PATH, { headers: auth(token) });
    expect(forbidden.status).toBe(403);
    expect(parseErrorEnvelope(await bodyOf(forbidden)).error.code).toBe('forbidden');
  });

  it('answers 500 with the internal envelope when the report throws', async () => {
    const { app } = harness({
      report: () => Promise.reject(new Error('db gone')),
      retention: () => ({ runs: 0, events: 0, chats: 0, approvals: 0, logDirectories: 0 }),
      start: () => undefined,
      stop: () => undefined,
    });
    const token = await paired(app);
    const response = await app.request(PATH, { headers: auth(token) });
    expect(response.status).toBe(500);
    const envelope = parseErrorEnvelope(await bodyOf(response));
    expect(envelope.error.code).toBe('internal');
  });
});
