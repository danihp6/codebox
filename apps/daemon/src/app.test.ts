import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ERROR_STATUS,
  RequestId,
  errorEnvelopeSchema,
  parseHealth,
  parseVersion,
} from '@codebox/contracts';
import type { CodeboxConfig } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { API_PREFIX, REQUEST_ID_HEADER, createApp, errorBody, newRequestId } from './app.js';
import { loadConfig, readBuildInfo, resolvePaths } from './config.js';
import type { HealthProbes } from './health.js';
import { createLogger } from './logger.js';
import { createShutdownRegistry } from './modules.js';
import type { DaemonApp, DaemonContext } from './modules.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const INDEX = '<!doctype html><title>cb</title>';

const stores: Store[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly lines: Record<string, unknown>[];
  readonly appDir: string;
}

interface HarnessOptions {
  readonly files?: Record<string, string>;
  readonly probes?: Partial<HealthProbes>;
}

function harness(options: HarnessOptions = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-11-app-'));
  temporaryDirectories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  for (const [name, content] of Object.entries(options.files ?? { 'index.html': INDEX })) {
    writeFileSync(join(appDir, name), content);
  }
  const base: CodeboxConfig = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
  });
  const store = openInMemoryStore();
  stores.push(store);
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ level: 'trace', sink: (line) => lines.push(JSON.parse(line)) });
  const context: DaemonContext = {
    config: base,
    store,
    logger,
    clock: () => new Date('2026-10-25T00:00:00.000Z'),
    flags: {
      auth: true,
      chat: true,
      events: true,
      run: true,
      gate: true,
      jobs: true,
      runs: true,
      push: true,
      routines: true,
      telemetry: true,
      cli: true,
    },
    build: readBuildInfo(base),
    paths: resolvePaths(base),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const probes: HealthProbes = {
    db: () => 'ok',
    opencode: () => 'ok',
    disk: () => ({ freeBytes: 500, totalBytes: 1000, usedPercent: 50 }),
    queue: () => ({ pending: 0, running: 0, maxConcurrency: 2 }),
    ...options.probes,
  };
  return { app: createApp({ context, probes }), context, lines, appDir };
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

describe('newRequestId', () => {
  it('builds a ULID-shaped request id', () => {
    const first = newRequestId();
    const second = newRequestId();
    expect(first).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(RequestId.safeParse(first).success).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('errorBody', () => {
  it('satisfies the error envelope schema with and without details', () => {
    const plain = errorBody({
      code: 'internal',
      message: 'Internal error',
      requestId: newRequestId(),
    });
    expect(() => errorEnvelopeSchema.parse(plain)).not.toThrow();
    const detailed = errorBody({
      code: 'not_found',
      message: 'Not found',
      requestId: newRequestId(),
      details: { path: '/v1/nope' },
    });
    expect(() => errorEnvelopeSchema.parse(detailed)).not.toThrow();
    expect(detailed.error).not.toHaveProperty('details', undefined);
    expect(detailed.error.details).toEqual({ path: '/v1/nope' });
  });

  it('pins the status of a code to ERROR_STATUS', () => {
    expect(ERROR_STATUS.not_found).toBe(404);
    expect(ERROR_STATUS.internal).toBe(500);
  });
});

describe('GET /v1/health', () => {
  it('answers 200 with a parsed body when degraded', async () => {
    const { app } = harness({ probes: { opencode: () => 'down' } });
    const response = await app.request(`${API_PREFIX}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = await jsonBody(response);
    expect(() => parseHealth(body)).not.toThrow();
    expect(body).toMatchObject({ status: 'degraded', db: 'ok', opencode: 'down' });
    expect(body['disk']).toEqual({ freeBytes: 500, totalBytes: 1000, usedPercent: 50 });
  });

  it('answers 503 with the same body when the database is down', async () => {
    const { app } = harness({ probes: { db: () => 'down' } });
    const response = await app.request(`${API_PREFIX}/health`);
    expect(response.status).toBe(503);
    const body = await jsonBody(response);
    expect(() => parseHealth(body)).not.toThrow();
    expect(body).toMatchObject({ status: 'down', db: 'down' });
  });
});

describe('GET /v1/version', () => {
  it('answers 200 with the parsed build info', async () => {
    const { app, context } = harness();
    const response = await app.request(`${API_PREFIX}/version`);
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(() => parseVersion(body)).not.toThrow();
    expect(body).toEqual({
      version: context.build.version,
      commit: null,
      builtAt: null,
      node: process.version,
    });
  });
});

describe('request id middleware', () => {
  it('generates a request id and echoes it', async () => {
    const { app } = harness();
    const response = await app.request(`${API_PREFIX}/version`);
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).not.toBeNull();
    expect(RequestId.safeParse(requestId).success).toBe(true);
  });

  it('reuses a valid inbound request id', async () => {
    const { app } = harness();
    const inbound = newRequestId();
    const response = await app.request(`${API_PREFIX}/version`, {
      headers: { [REQUEST_ID_HEADER]: inbound },
    });
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(inbound);
  });

  it('replaces an invalid inbound request id', async () => {
    const { app } = harness();
    const response = await app.request(`${API_PREFIX}/version`, {
      headers: { [REQUEST_ID_HEADER]: 'not-a-request-id' },
    });
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).not.toBe('not-a-request-id');
    expect(RequestId.safeParse(requestId).success).toBe(true);
  });

  it('logs one info line per completed request', async () => {
    const { app, lines } = harness();
    const response = await app.request(`${API_PREFIX}/version`, {
      headers: { [REQUEST_ID_HEADER]: newRequestId() },
    });
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    const logged = lines.filter((line) => line['msg'] === 'request');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'info',
      requestId,
      method: 'GET',
      path: `${API_PREFIX}/version`,
      status: 200,
    });
    expect(typeof logged[0]?.['durationMs']).toBe('number');
  });
});

describe('static hosting', () => {
  it('serves the built app byte for byte', async () => {
    const { app } = harness();
    const response = await app.request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(INDEX);
  });

  it('serves the index for a client-side route', async () => {
    const { app } = harness();
    const response = await app.request('/runs/run_000001');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  it('answers not_found with app_not_built when the app is missing', async () => {
    const { app } = harness({ files: {} });
    const response = await app.request('/');
    expect(response.status).toBe(404);
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      error: { code: 'not_found', details: { path: '/', reason: 'app_not_built' } },
    });
  });

  it('answers not_found for a missing asset', async () => {
    const { app } = harness();
    const response = await app.request('/main.js');
    expect(response.status).toBe(404);
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      error: { code: 'not_found', details: { path: '/main.js' } },
    });
  });

  it('answers not_found for an unknown /v1 path', async () => {
    const { app } = harness();
    const response = await app.request('/v1/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      error: { code: 'not_found', message: 'Not found', details: { path: '/v1/nope' } },
    });
    expect(RequestId.safeParse((body['error'] as { requestId?: unknown }).requestId).success).toBe(
      true,
    );
  });

  it('answers not_found for an unmatched method', async () => {
    const { app } = harness();
    const response = await app.request('/v1/version', { method: 'DELETE' });
    expect(response.status).toBe(404);
    expect((await jsonBody(response))['error']).toMatchObject({ code: 'not_found' });
  });

  it('never serves a path outside the app directory', async () => {
    const { app } = harness();
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/x%00y']) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      const body = await jsonBody(response);
      expect(body['error']).toMatchObject({ code: 'not_found' });
      expect(JSON.stringify(body)).not.toContain('"name": "@codebox/daemon"');
    }
  });

  it('answers the index when the URL parser has already collapsed the traversal', async () => {
    const { app } = harness();
    // WHATWG URL collapses "/a/../../etc/passwd" to "/etc/passwd" before the daemon sees it,
    // so the request is an ordinary dotless route and the SPA fallback answers the index.
    const response = await app.request('/a/%2e%2e/%2e%2e/etc/passwd');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });
});

describe('onError', () => {
  it('answers 500 with the internal envelope and logs the error', async () => {
    const { app, lines } = harness({
      probes: { queue: () => ({ pending: 0, running: 0, maxConcurrency: 0 }) },
    });
    const response = await app.request(`${API_PREFIX}/health`);
    expect(response.status).toBe(500);
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      error: { code: 'internal', message: 'Internal error' },
    });
    expect(JSON.stringify(body)).not.toContain('maxConcurrency');
    expect(RequestId.safeParse((body['error'] as { requestId?: unknown }).requestId).success).toBe(
      true,
    );
    const failed = lines.filter((line) => line['msg'] === 'request_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ err: { name: 'ContractParseError' } });
  });
});
