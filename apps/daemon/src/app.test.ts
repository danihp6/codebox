import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
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
import {
  API_PREFIX,
  BODY_TOO_LARGE_PATH,
  MAX_REQUEST_BYTES,
  ORIGIN_REFUSAL_REASON,
  REQUEST_ID_HEADER,
  SECURITY_HEADERS,
  createApp,
  errorBody,
  newRequestId,
  originAllowed,
} from './app.js';
import { loadConfig, readBuildInfo, resolvePaths } from './config.js';
import type { HealthProbes } from './health.js';
import { createLogger } from './logger.js';
import { DEFAULT_SUBSYSTEM_FLAGS, createShutdownRegistry } from './modules.js';
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
  readonly config?: Record<string, string>;
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
    ...options.config,
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
    flags: DEFAULT_SUBSYSTEM_FLAGS,
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

interface RawResult {
  readonly path: string;
  readonly status: number;
  readonly body: string;
}

function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * The Fetch API normalises dot-segments before a Request exists, so the app is only ever shown
 * a raw target by a real listener; this is the same node-server entry `startDaemon` uses.
 */
async function rawRequests(app: DaemonApp, paths: readonly string[]): Promise<RawResult[]> {
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((listening) => {
    if (server.listening) listening();
    else server.once('listening', () => listening());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no listener address');
  try {
    const results: RawResult[] = [];
    for (const path of paths) {
      results.push({ path, ...(await rawGet((address as AddressInfo).port, path)) });
    }
    return results;
  } finally {
    await new Promise<void>((closed) => {
      server.close(() => closed());
    });
  }
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

  it('answers not_found for a traversal target, plain or percent-encoded', async () => {
    const { app } = harness();
    const traversal = [
      '/a/%2e%2e/%2e%2e/etc/passwd',
      '/a/../../etc/passwd',
      '/../package.json',
      '/%2e%2e/package.json',
      '/a/.%2e/etc/passwd',
      '/a/%2E%2E/etc/passwd',
    ];
    const results = await rawRequests(app, traversal);
    for (const result of results) {
      expect(result.status, result.path).toBe(404);
      const body = JSON.parse(result.body) as {
        error: { code: string; details: { path: string } };
      };
      expect(body.error.code, result.path).toBe('not_found');
      expect(body.error.details.path, result.path).toBeDefined();
      expect(result.body, result.path).not.toContain('@codebox/daemon');
    }
  });

  it('keeps the SPA fallback and the missing asset answer over the same transport', async () => {
    const { app } = harness();
    const [route, asset] = await rawRequests(app, ['/runs/run_000001', '/main.js']);
    expect(route?.status).toBe(200);
    expect(route?.body).toBe(INDEX);
    expect(asset?.status).toBe(404);
    expect(JSON.parse(asset?.body ?? '{}')).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('security headers', () => {
  it('pins the four headers and their exact values', () => {
    expect(SECURITY_HEADERS).toEqual({
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
  });

  it('sets them on a JSON answer, on the static app and on an error', async () => {
    const { app } = harness();
    for (const path of [`${API_PREFIX}/version`, '/', '/v1/nope']) {
      const response = await app.request(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(response.headers.get(name), `${path} ${name}`).toBe(value);
      }
    }
  });

  it('never overwrites a header a route already set', async () => {
    const { app } = harness();
    app.get(
      '/v1/custom',
      (c): Response => c.json({ ok: true }, 200, { 'Referrer-Policy': 'same-origin' }),
    );
    const response = await app.request('/v1/custom');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('origin allowlist', () => {
  function configured(): DaemonApp {
    return harness({ config: { CB_ALLOWED_ORIGINS: 'https://box.example' } }).app;
  }

  it('compares lowercased and without a trailing slash, and accepts an empty list', () => {
    expect(originAllowed('https://box.example', ['https://box.example'])).toBe(true);
    expect(originAllowed('https://BOX.example/', ['https://box.example'])).toBe(true);
    expect(originAllowed('https://evil.example', ['https://box.example'])).toBe(false);
    expect(originAllowed('https://evil.example', [])).toBe(true);
  });

  it('refuses a foreign origin on a /v1 path with forbidden and reason origin', async () => {
    const app = configured();
    const response = await app.request(`${API_PREFIX}/version`, {
      headers: { origin: 'https://evil.example' },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = await jsonBody(response);
    expect(() => errorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Forbidden',
        details: { reason: ORIGIN_REFUSAL_REASON },
      },
    });
    expect(ORIGIN_REFUSAL_REASON).toBe('origin');
  });

  it('serves the configured origin, no origin at all, and a request without an allowlist', async () => {
    const own = await configured().request(`${API_PREFIX}/version`, {
      headers: { origin: 'https://box.example' },
    });
    expect(own.status).toBe(200);

    const none = await configured().request(`${API_PREFIX}/version`);
    expect(none.status).toBe(200);

    const any = await harness().app.request(`${API_PREFIX}/version`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(any.status).toBe(200);
  });

  it('never origin-checks the hosted app or the SPA fallback', async () => {
    const app = configured();
    for (const path of ['/', '/runs/run_000001']) {
      const response = await app.request(path, { headers: { origin: 'https://evil.example' } });
      expect(response.status, path).toBe(200);
    }
  });
});

describe('request body cap', () => {
  it('answers 400 bad_request for a declared body over 1 MiB and never runs the route', async () => {
    let ran = 0;
    const { app } = harness();
    app.post(`${API_PREFIX}/runs`, (c): Response => {
      ran += 1;
      return c.json({ ok: true }, 202);
    });

    const response = await app.request(`${API_PREFIX}/runs`, {
      method: 'POST',
      headers: { 'content-length': String(MAX_REQUEST_BYTES + 1) },
    });

    expect(MAX_REQUEST_BYTES).toBe(1_048_576);
    expect(response.status).toBe(400);
    const body = await jsonBody(response);
    expect(() => errorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      error: {
        code: 'bad_request',
        details: { limitBytes: MAX_REQUEST_BYTES, path: BODY_TOO_LARGE_PATH },
      },
    });
    expect(BODY_TOO_LARGE_PATH).toBe('request.body');
    expect(ran).toBe(0);
  });

  it('lets a body at the cap through and ignores an absent or non-numeric length', async () => {
    const { app } = harness();
    const atCap = await app.request(`${API_PREFIX}/version`, {
      headers: { 'content-length': String(MAX_REQUEST_BYTES) },
    });
    expect(atCap.status).toBe(200);

    const nonNumeric = await app.request(`${API_PREFIX}/version`, {
      headers: { 'content-length': 'huge' },
    });
    expect(nonNumeric.status).toBe(200);
  });

  it('does not cap a static response', async () => {
    const { app } = harness();
    const response = await app.request('/', {
      headers: { 'content-length': String(MAX_REQUEST_BYTES + 1) },
    });
    expect(response.status).toBe(200);
  });
});

describe('route seam', () => {  it('leaves an unmatched API path to the not_found envelope', async () => {
    const { app } = harness();
    const response = await app.request('/v1/nope');
    expect(response.status).toBe(404);
    const body = await jsonBody(response);
    expect(body['error']).toMatchObject({
      code: 'not_found',
      details: { path: '/v1/nope' },
    });
  });

  it('keeps the static fallback when no build exists', async () => {
    const { app } = harness({ files: {} });
    const response = await app.request('/');
    expect(response.status).toBe(404);
    const body = await jsonBody(response);
    expect(body['error']).toMatchObject({
      code: 'not_found',
      details: { path: '/', reason: 'app_not_built' },
    });
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
