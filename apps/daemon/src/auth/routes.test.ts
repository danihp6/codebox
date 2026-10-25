import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_STATUS, errorEnvelopeSchema, meSchema, pageOfDevice } from '@codebox/contracts';
import type { Device, Me, Scope } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { createApp } from '../app.js';
import { loadConfig, readBuildInfo, resolvePaths } from '../config.js';
import { createLogger } from '../logger.js';
import { createShutdownRegistry } from '../modules.js';
import type { DaemonApp, DaemonContext } from '../modules.js';
import { createModule } from './index.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const INDEX = '<!doctype html><title>cb</title>';
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const REMOTE = { incoming: { socket: { remoteAddress: '203.0.113.9' } } };
const ALL_SCOPES: readonly Scope[] = ['read', 'chat', 'runs', 'write', 'admin'];

const stores: Store[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface Harness {
  readonly app: DaemonApp;
  readonly context: DaemonContext;
  readonly store: Store;
  advance(seconds: number): void;
}

function harness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'cb-12-auth-'));
  directories.push(directory);
  const appDir = join(directory, 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'index.html'), INDEX);
  const config = loadConfig({
    CB_ENV: 'test',
    CB_SESSION_SECRET: SESSION_SECRET,
    CB_STATE_DIR: join(directory, 'state'),
  });
  const store = openInMemoryStore();
  stores.push(store);
  let now = new Date('2026-10-25T00:00:00.000Z');
  const logger = createLogger({ level: 'error', sink: () => undefined });
  const context: DaemonContext = {
    config,
    store,
    logger,
    clock: () => now,
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
    build: readBuildInfo(config),
    paths: resolvePaths(config),
    appDir,
    shutdown: createShutdownRegistry(logger),
  };
  const app = createApp({ context });
  createModule(context).register(app, context);
  return {
    app,
    context,
    store,
    advance(seconds: number): void {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

function jsonInit(body: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
  return parsed as Record<string, unknown>;
}

async function issueCode(
  app: DaemonApp,
  body: Record<string, unknown> = { name: 'Dani iPhone' },
  env: Record<string, unknown> | undefined = LOOPBACK,
): Promise<Response> {
  return app.request('/v1/pair/code', jsonInit(body), env);
}

async function pair(
  app: DaemonApp,
  code: string,
  overrides: Record<string, unknown> = {},
  env: Record<string, unknown> | undefined = LOOPBACK,
): Promise<Response> {
  return app.request(
    '/v1/pair',
    jsonInit({
      code,
      deviceName: 'Dani iPhone',
      platform: 'ios',
      devicePublicKey: 'ed25519:test-public-key',
      ...overrides,
    }),
    env,
  );
}

interface Paired {
  readonly device: Device;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly scopes: readonly Scope[];
}

async function pairDevice(
  app: DaemonApp,
  scopes?: readonly Scope[],
  name = 'Dani iPhone',
): Promise<Paired> {
  const issued = await issueCode(app, scopes === undefined ? { name } : { name, scopes });
  expect(issued.status).toBe(201);
  const code = (await bodyOf(issued))['code'];
  if (typeof code !== 'string') throw new Error('no code');
  const exchanged = await pair(app, code, { deviceName: name });
  expect(exchanged.status).toBe(200);
  return (await bodyOf(exchanged)) as unknown as Paired;
}

describe('POST /v1/pair/code and POST /v1/pair', () => {
  it('pairs a device and serves /v1/me with the same identity', async () => {
    const { app } = harness();
    const issued = await issueCode(app);
    expect(issued.status).toBe(201);
    const codeBody = await bodyOf(issued);
    expect(codeBody['code']).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(codeBody['name']).toBe('Dani iPhone');
    expect(codeBody['scopes']).toEqual(ALL_SCOPES);
    expect(typeof codeBody['expiresAt']).toBe('string');

    const exchanged = await pair(app, String(codeBody['code']));
    expect(exchanged.status).toBe(200);
    const result = await bodyOf(exchanged);
    expect(result['expiresIn']).toBe(900);
    expect(result['scopes']).toEqual(ALL_SCOPES);
    expect(result['accessToken']).toMatch(/^cb1\./);
    expect(typeof result['refreshToken']).toBe('string');
    const device = result['device'] as Device;
    expect(device.id).toMatch(/^dev_[0-9A-Z]{20}$/);
    expect(device.name).toBe('Dani iPhone');
    expect(device.platform).toBe('ios');
    expect(device.scopes).toEqual(ALL_SCOPES);
    expect(result).not.toHaveProperty('refreshTokenHash');
    expect(JSON.stringify(result)).not.toMatch(/refreshTokenHash|refreshPreviousHash|fingerprint/);

    const me = await app.request('/v1/me', {
      headers: { authorization: `Bearer ${String(result['accessToken'])}` },
    });
    expect(me.status).toBe(200);
    const meBody = await bodyOf(me);
    expect(() => meSchema.parse(meBody)).not.toThrow();
    expect((meBody as unknown as Me).device.id).toBe(device.id);
    expect(meBody['scopes']).toEqual(ALL_SCOPES);
    expect(JSON.stringify(meBody)).not.toMatch(/Hash|publicKey|fingerprint/);
  });

  it('uses a code once and never creates a second device', async () => {
    const { app, store } = harness();
    const issued = await issueCode(app);
    const code = String((await bodyOf(issued))['code']);
    expect((await pair(app, code)).status).toBe(200);

    const second = await pair(app, code);
    expect(second.status).toBe(401);
    const body = await bodyOf(second);
    expect(() => errorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body['error']).toMatchObject({
      code: 'unauthorized',
      details: { reason: 'used_code' },
    });
    expect(store.devices.list({ limit: 10, cursor: null }).data).toHaveLength(1);
  });

  it('rejects an expired code and an unknown code', async () => {
    const { app, advance } = harness();
    const issued = await issueCode(app, { name: 'Dani iPhone', ttlSeconds: 30 });
    const code = String((await bodyOf(issued))['code']);
    advance(31);
    const expired = await pair(app, code);
    expect(expired.status).toBe(401);
    expect((await bodyOf(expired))['error']).toMatchObject({
      code: 'unauthorized',
      details: { reason: 'expired_code' },
    });

    const unknown = await pair(app, 'ZZZZZZZZZZ');
    expect(unknown.status).toBe(401);
    expect((await bodyOf(unknown))['error']).toMatchObject({
      code: 'unauthorized',
      details: { reason: 'unknown_code' },
    });
  });
});

describe('POST /v1/auth/refresh', () => {
  it('rotates the refresh token and treats a replay as theft', async () => {
    const { app, store } = harness();
    const paired = await pairDevice(app);
    const deviceId = paired.device.id;

    const first = await app.request(
      '/v1/auth/refresh',
      jsonInit({ refreshToken: paired.refreshToken }),
    );
    expect(first.status).toBe(200);
    const rotated = await bodyOf(first);
    expect(rotated['refreshToken']).not.toBe(paired.refreshToken);
    expect(rotated['expiresIn']).toBe(900);

    const second = await app.request(
      '/v1/auth/refresh',
      jsonInit({ refreshToken: String(rotated['refreshToken']) }),
    );
    expect(second.status).toBe(200);
    const secondBody = await bodyOf(second);
    expect(secondBody['refreshToken']).not.toBe(rotated['refreshToken']);

    const replay = await app.request(
      '/v1/auth/refresh',
      jsonInit({ refreshToken: String(rotated['refreshToken']) }),
    );
    expect(replay.status).toBe(401);
    expect((await bodyOf(replay))['error']).toMatchObject({ code: 'unauthorized' });
    expect(store.devices.getRecord(deviceId)?.revokedAt).not.toBeNull();

    const afterRevoke = await app.request('/v1/me', {
      headers: { authorization: `Bearer ${String(secondBody['accessToken'])}` },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const { app } = harness();
    const response = await app.request('/v1/auth/refresh', jsonInit({ refreshToken: 'nope' }));
    expect(response.status).toBe(401);
    expect((await bodyOf(response))['error']).toMatchObject({ code: 'unauthorized' });
  });
});

describe('/v1 guard', () => {
  const guarded: readonly { method: string; path: string; body?: unknown }[] = [
    { method: 'GET', path: '/v1/me' },
    { method: 'GET', path: '/v1/devices' },
    { method: 'DELETE', path: '/v1/devices/dev_00000000000000000000' },
    { method: 'POST', path: '/v1/auth/logout' },
    { method: 'GET', path: '/v1/unknown' },
  ];

  it('answers 401 unauthorized on every guarded route without a bearer', async () => {
    const { app } = harness();
    for (const entry of guarded) {
      const init: RequestInit =
        entry.body === undefined
          ? { method: entry.method }
          : {
              method: entry.method,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(entry.body),
            };
      const response = await app.request(entry.path, init);
      expect(response.status, `${entry.method} ${entry.path}`).toBe(ERROR_STATUS.unauthorized);
      const body = await bodyOf(response);
      expect(body['error'], `${entry.method} ${entry.path}`).toMatchObject({
        code: 'unauthorized',
      });
    }
  });

  it('serves health, version and the pairing exchange without a bearer', async () => {
    const { app } = harness();
    expect((await app.request('/v1/health')).status).toBe(200);
    expect((await app.request('/v1/version')).status).toBe(200);
    const pairing = await pair(app, 'ZZZZZZZZZZ');
    expect(pairing.status).toBe(401);
    expect((await bodyOf(pairing))['error']).toMatchObject({
      code: 'unauthorized',
      details: { reason: 'unknown_code' },
    });
  });

  it('rejects a token without the Bearer prefix and a forged token', async () => {
    const { app } = harness();
    const paired = await pairDevice(app);
    const bare = await app.request('/v1/me', {
      headers: { authorization: paired.accessToken },
    });
    expect(bare.status).toBe(401);
    const forged = await app.request('/v1/me', {
      headers: { authorization: 'Bearer cb1.abc.def' },
    });
    expect(forged.status).toBe(401);
  });
});

describe('device administration', () => {
  it('revokes another device and refuses a read-only device', async () => {
    const { app } = harness();
    const admin = await pairDevice(app, undefined, 'Dani phone');
    const phone = await pairDevice(app, undefined, 'Tablet');
    const readOnly = await pairDevice(app, ['read'], 'Read only');

    const list = await app.request('/v1/devices?limit=50', {
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(list.status).toBe(200);
    const page = await bodyOf(list);
    expect(() => pageOfDevice.parse(page)).not.toThrow();
    expect((page['data'] as Device[]).map((device) => device.id).sort()).toEqual(
      [admin.device.id, phone.device.id, readOnly.device.id].sort(),
    );
    expect(page['nextCursor']).toBeNull();

    const refused = await app.request(`/v1/devices/${phone.device.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${readOnly.accessToken}` },
    });
    expect(refused.status).toBe(403);
    expect((await bodyOf(refused))['error']).toMatchObject({
      code: 'forbidden',
      details: { reason: 'insufficient_scope' },
    });

    const unknown = await app.request('/v1/devices/dev_00000000000000000000', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(unknown.status).toBe(404);
    expect((await bodyOf(unknown))['error']).toMatchObject({ code: 'not_found' });

    const revoked = await app.request(`/v1/devices/${phone.device.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(revoked.status).toBe(204);
    expect(await revoked.text()).toBe('');

    const next = await app.request('/v1/me', {
      headers: { authorization: `Bearer ${phone.accessToken}` },
    });
    expect(next.status).toBe(401);
  });

  it('logs out the calling device and rejects its token afterwards', async () => {
    const { app, store } = harness();
    const paired = await pairDevice(app);
    const headers = { authorization: `Bearer ${paired.accessToken}` };
    expect((await app.request('/v1/auth/logout', { method: 'POST', headers })).status).toBe(204);
    expect((await app.request('/v1/auth/logout', { method: 'POST', headers })).status).toBe(401);
    expect(store.devices.getRecord(paired.device.id)?.revokedAt).not.toBeNull();
  });
});

describe('pairing issuer gate', () => {
  it('accepts loopback without a bearer and refuses a remote source', async () => {
    const { app } = harness();
    expect((await issueCode(app, { name: 'Dani iPhone' }, LOOPBACK)).status).toBe(201);

    const remote = await issueCode(app, { name: 'Dani iPhone' }, REMOTE);
    expect(remote.status).toBe(403);
    expect((await bodyOf(remote))['error']).toMatchObject({
      code: 'forbidden',
      details: { reason: 'loopback_required' },
    });

    const noEnv = await app.request('/v1/pair/code', jsonInit({ name: 'Dani iPhone' }));
    expect(noEnv.status).toBe(403);
  });

  it('accepts an admin bearer from a remote source', async () => {
    const { app } = harness();
    const paired = await pairDevice(app, undefined, 'Dani phone');
    const response = await app.request(
      '/v1/pair/code',
      jsonInit({ name: 'Remote tablet' }, paired.accessToken),
      REMOTE,
    );
    expect(response.status).toBe(201);
    expect((await bodyOf(response))['name']).toBe('Remote tablet');
  });
});

describe('pairing rate limit', () => {
  it('answers 429 on the eleventh request from one source and serves another', async () => {
    const { app } = harness();
    for (let index = 0; index < 10; index += 1) {
      const response = await app.request('/v1/pair', jsonInit({}), REMOTE);
      expect(response.status).toBe(422);
    }
    const limited = await app.request('/v1/pair', jsonInit({}), REMOTE);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = await bodyOf(limited);
    expect(() => errorEnvelopeSchema.parse(body)).not.toThrow();
    expect(body['error']).toMatchObject({
      code: 'rate_limited',
      details: { retryAfter: expect.any(Number) },
    });

    const elsewhere = await app.request('/v1/pair', jsonInit({}), LOOPBACK);
    expect(elsewhere.status).toBe(422);
  });

  it('shares one budget between the code issue and the exchange', async () => {
    const { app } = harness();
    for (let index = 0; index < 9; index += 1) {
      await app.request('/v1/pair', jsonInit({}), REMOTE);
    }
    expect((await issueCode(app, { name: 'X' }, REMOTE)).status).toBe(403);
    const limited = await app.request('/v1/pair', jsonInit({}), REMOTE);
    expect(limited.status).toBe(429);
  });
});

describe('edge validation', () => {
  it('rejects an unknown field and a bad platform with the field path', async () => {
    const { app } = harness();
    const issued = await issueCode(app);
    const code = String((await bodyOf(issued))['code']);

    const extra = await pair(app, code, { surprise: true });
    expect(extra.status).toBe(422);
    const extraBody = await bodyOf(extra);
    expect(extraBody['error']).toMatchObject({
      code: 'validation_failed',
      details: { path: 'pair.surprise' },
    });

    const platform = await pair(app, code, { platform: 'toaster' });
    expect(platform.status).toBe(422);
    expect((await bodyOf(platform))['error']).toMatchObject({
      code: 'validation_failed',
      details: { path: 'pair.platform' },
    });
  });

  it('answers 400 bad_request on malformed JSON', async () => {
    const { app } = harness();
    const response = await app.request('/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect((await bodyOf(response))['error']).toMatchObject({ code: 'bad_request' });
  });

  it('rejects unknown and duplicated query parameters', async () => {
    const { app } = harness();
    const paired = await pairDevice(app);
    const headers = { authorization: `Bearer ${paired.accessToken}` };

    const unknown = await app.request('/v1/devices?limit=10&sort=asc', { headers });
    expect(unknown.status).toBe(422);
    expect((await bodyOf(unknown))['error']).toMatchObject({
      code: 'validation_failed',
      details: { path: 'devices.sort' },
    });

    const badLimit = await app.request('/v1/devices?limit=500', { headers });
    expect(badLimit.status).toBe(422);
  });
});

describe('the module route seam', () => {
  it('answers 404 not_found for an unmatched API path even with a valid token', async () => {
    const { app } = harness();
    const paired = await pairDevice(app);
    const response = await app.request('/v1/unknown', {
      headers: { authorization: `Bearer ${paired.accessToken}` },
    });
    expect(response.status).toBe(404);
    const body = await bodyOf(response);
    expect(body['error']).toMatchObject({
      code: 'not_found',
      details: { path: '/v1/unknown' },
    });
  });
});
