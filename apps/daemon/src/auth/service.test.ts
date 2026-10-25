import { afterEach, describe, expect, it } from 'vitest';
import { DeviceId } from '@codebox/contracts';
import { openInMemoryStore } from '@codebox/store';
import type { Store } from '@codebox/store';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { AuthError } from './errors.js';
import { createAuthService } from './service.js';
import type { AuthService, PairExchangeInput } from './service.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';
const PUBLIC_KEY = 'ed25519:test-public-key';

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

interface Harness {
  readonly service: AuthService;
  readonly store: Store;
  readonly lines: Record<string, unknown>[];
  advance(seconds: number): void;
}

function harness(): Harness {
  const store = openInMemoryStore();
  stores.push(store);
  let now = new Date('2026-10-25T00:00:00.000Z');
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'trace',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const config = loadConfig({ CB_ENV: 'test', CB_SESSION_SECRET: SESSION_SECRET });
  const service = createAuthService({ store, config, clock: () => now, logger });
  return {
    service,
    store,
    lines,
    advance(seconds: number): void {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

function exchangeInput(
  code: string,
  overrides: Partial<PairExchangeInput> = {},
): PairExchangeInput {
  return {
    code,
    deviceName: 'Dani iPhone',
    platform: 'ios',
    devicePublicKey: PUBLIC_KEY,
    ...overrides,
  };
}

describe('issueCode', () => {
  it('mints a single-use code with all scopes and the configured TTL', async () => {
    const { service } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(issued.scopes).toEqual(['read', 'chat', 'runs', 'write', 'admin']);
    expect(issued.name).toBe('Dani iPhone');
    expect(issued.expiresAt).toBe('2026-10-25T00:05:00.000Z');
  });

  it('accepts a narrower scope list and a custom TTL', async () => {
    const { service } = harness();
    const issued = await service.issueCode({ name: 'Tablet', scopes: ['read'], ttlSeconds: 60 });
    expect(issued.scopes).toEqual(['read']);
    expect(issued.expiresAt).toBe('2026-10-25T00:01:00.000Z');
  });

  it('rejects a bad name, TTL or scope as a 422', async () => {
    const { service } = harness();
    await expect(service.issueCode({ name: '' })).rejects.toMatchObject({
      reason: 'invalid_payload',
      status: 422,
      details: { path: 'name' },
    });
    await expect(service.issueCode({ name: 'x'.repeat(65) })).rejects.toBeInstanceOf(AuthError);
    await expect(service.issueCode({ name: 'phone', ttlSeconds: 10 })).rejects.toMatchObject({
      details: { path: 'ttlSeconds' },
    });
    await expect(service.issueCode({ name: 'phone', ttlSeconds: 3601 })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      service.issueCode({ name: 'phone', scopes: ['root' as never] }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(service.issueCode({ name: 'phone', scopes: [] })).rejects.toMatchObject({
      details: { path: 'scopes' },
    });
  });
});

describe('exchange', () => {
  it('creates a device row, a refresh token and an access token', async () => {
    const { service, store } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const result = await service.exchange(exchangeInput(issued.code), '127.0.0.1');

    expect(DeviceId.safeParse(result.device.id).success).toBe(true);
    expect(result.device).toEqual({
      id: result.device.id,
      name: 'Dani iPhone',
      platform: 'ios',
      scopes: ['read', 'chat', 'runs', 'write', 'admin'],
      createdAt: '2026-10-25T00:00:00.000Z',
      lastSeenAt: null,
    });
    expect(result.expiresIn).toBe(900);
    expect(result.accessToken).toMatch(/^cb1\./);
    expect(JSON.stringify(result)).not.toMatch(/refreshTokenHash|refreshPreviousHash|fingerprint/);

    const record = store.devices.getRecord(result.device.id);
    expect(record).not.toBeNull();
    expect(record?.refreshTokenHash).not.toBe(result.refreshToken);
    expect(record?.refreshPreviousHash).toBeNull();
    expect(record?.refreshExpiresAt).toBe('2026-11-24T00:00:00.000Z');
    expect(record?.publicKey).toBe(PUBLIC_KEY);
    expect(record?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('lets exactly one of two concurrent exchanges win', async () => {
    const { service, store } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const input = exchangeInput(issued.code);
    const results = await Promise.allSettled([
      service.exchange(input, '127.0.0.1'),
      service.exchange(input, '127.0.0.1'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      reason: 'used_code',
      status: 401,
    });
    expect(store.devices.list({ limit: 50, cursor: null }).data).toHaveLength(1);
  });

  it('rejects a used, expired or unknown code without creating a row', async () => {
    const { service, store, advance } = harness();
    const used = await service.issueCode({ name: 'Dani iPhone' });
    await service.exchange(exchangeInput(used.code), '127.0.0.1');
    await expect(service.exchange(exchangeInput(used.code), '127.0.0.1')).rejects.toMatchObject({
      reason: 'used_code',
      details: { reason: 'used_code' },
    });

    const expired = await service.issueCode({ name: 'Tablet', ttlSeconds: 30 });
    advance(31);
    await expect(service.exchange(exchangeInput(expired.code), '127.0.0.1')).rejects.toMatchObject({
      reason: 'expired_code',
      status: 401,
    });

    await expect(service.exchange(exchangeInput('ZZZZZZZZZZ'), '127.0.0.1')).rejects.toMatchObject({
      reason: 'unknown_code',
      status: 401,
    });
    expect(store.devices.list({ limit: 50, cursor: null }).data).toHaveLength(1);
  });
});

describe('refresh', () => {
  it('rotates both tokens and keeps the previous hash for replay detection', async () => {
    const { service, store } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const paired = await service.exchange(exchangeInput(issued.code), '127.0.0.1');
    const previousHash = store.devices.getRecord(paired.device.id)?.refreshTokenHash;

    const rotated = await service.refresh({ refreshToken: paired.refreshToken });
    expect(rotated.refreshToken).not.toBe(paired.refreshToken);
    expect(rotated.expiresIn).toBe(900);
    expect(rotated.scopes).toEqual(paired.scopes);

    const record = store.devices.getRecord(paired.device.id);
    expect(record?.refreshPreviousHash).toBe(previousHash);
    expect(record?.refreshTokenHash).not.toBe(previousHash);
  });

  it('revokes the device when a rotated refresh token comes back', async () => {
    const { service, store, lines } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const paired = await service.exchange(exchangeInput(issued.code), '127.0.0.1');
    const rotated = await service.refresh({ refreshToken: paired.refreshToken });

    await expect(service.refresh({ refreshToken: paired.refreshToken })).rejects.toMatchObject({
      status: 401,
    });
    expect(store.devices.getRecord(paired.device.id)?.revokedAt).not.toBeNull();
    expect(service.authenticate(rotated.accessToken)).toBeNull();
    const replayLine = lines.find((line) => line['msg'] === 'refresh_token_replay');
    expect(replayLine).toMatchObject({ level: 'warn', deviceId: paired.device.id });
    expect(JSON.stringify(replayLine)).not.toContain(paired.refreshToken);
  });

  it('rejects and revokes an expired refresh token', async () => {
    const { service, store, advance } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const paired = await service.exchange(exchangeInput(issued.code), '127.0.0.1');
    advance(30 * 86_400 + 1);
    await expect(service.refresh({ refreshToken: paired.refreshToken })).rejects.toMatchObject({
      status: 401,
    });
    expect(store.devices.getRecord(paired.device.id)?.revokedAt).not.toBeNull();
  });

  it('rejects an unknown refresh token', async () => {
    const { service } = harness();
    await expect(service.refresh({ refreshToken: 'not-a-token' })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('authenticate and logout', () => {
  it('returns the device scopes and touches lastSeenAt', async () => {
    const { service, store, advance } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const paired = await service.exchange(exchangeInput(issued.code), '127.0.0.1');

    expect(service.authenticate(paired.accessToken)).toEqual({
      id: paired.device.id,
      scopes: ['read', 'chat', 'runs', 'write', 'admin'],
    });
    expect(store.devices.get(paired.device.id)?.lastSeenAt).toBe('2026-10-25T00:00:00.000Z');

    advance(5);
    expect(service.authenticate(paired.accessToken)?.id).toBe(paired.device.id);
    expect(store.devices.get(paired.device.id)?.lastSeenAt).toBe('2026-10-25T00:00:05.000Z');
  });

  it('rejects a tampered or expired access token', async () => {
    const { service, advance } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const paired = await service.exchange(exchangeInput(issued.code), '127.0.0.1');

    expect(service.authenticate(`${paired.accessToken}x`)).toBeNull();
    advance(901);
    expect(service.authenticate(paired.accessToken)).toBeNull();
  });

  it('revokes idempotently and kills the access token', async () => {
    const { service, store } = harness();
    const issued = await service.issueCode({ name: 'Dani iPhone' });
    const paired = await service.exchange(exchangeInput(issued.code), '127.0.0.1');

    service.logout(paired.device.id);
    service.logout(paired.device.id);
    expect(store.devices.getRecord(paired.device.id)?.revokedAt).toBe('2026-10-25T00:00:00.000Z');
    expect(service.authenticate(paired.accessToken)).toBeNull();
  });
});
