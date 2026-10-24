import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Scope } from '@codebox/contracts';
import {
  ACCESS_TOKEN_PREFIX,
  authorizeDevice,
  hasScope,
  hashRefreshToken,
  issueRefreshToken,
  mintAccessToken,
  verifyAccessToken,
} from './tokens.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const SECRET = 'a-test-session-secret-that-is-long-enough';
const TTL_SECONDS = 900;
const DEVICE_ID = 'dev_01JABCDEFG';
const SCOPES: readonly Scope[] = ['read', 'chat', 'runs', 'write', 'admin'];

function mint(at: Date = NOW): ReturnType<typeof mintAccessToken> {
  return mintAccessToken({
    deviceId: DEVICE_ID,
    scopes: SCOPES,
    secret: SECRET,
    now: at,
    ttlSeconds: TTL_SECONDS,
  });
}

function tamper(token: string): string {
  const parts = token.split('.');
  const signature = parts[2] ?? '';
  const head = signature.charAt(0);
  const flipped = head === 'A' ? 'B' : 'A';
  return `${parts[0]}.${parts[1]}.${flipped}${signature.slice(1)}`;
}

function forge(shape: unknown): string {
  const payload = Buffer.from(JSON.stringify(shape), 'utf8').toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`cb1.${payload}`).digest('base64url');
  return `cb1.${payload}.${signature}`;
}

describe('access tokens', () => {
  it('an access token verifies before its expiry and not after', () => {
    const minted = mint();
    const parts = minted.token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(ACCESS_TOKEN_PREFIX);
    expect(minted.claims).toEqual({
      v: 1,
      sub: DEVICE_ID,
      scopes: SCOPES,
      iat: Math.floor(NOW.getTime() / 1000),
      exp: Math.floor(NOW.getTime() / 1000) + TTL_SECONDS,
    });

    const verified = verifyAccessToken({ token: minted.token, secret: SECRET, now: NOW });
    expect(verified).toEqual(minted.claims);

    const justBefore = new Date(NOW.getTime() + (TTL_SECONDS - 1) * 1000);
    expect(verifyAccessToken({ token: minted.token, secret: SECRET, now: justBefore })).toEqual(
      minted.claims,
    );

    const atExpiry = new Date(NOW.getTime() + TTL_SECONDS * 1000);
    expect(verifyAccessToken({ token: minted.token, secret: SECRET, now: atExpiry })).toBeNull();
    expect(
      verifyAccessToken({
        token: minted.token,
        secret: SECRET,
        now: new Date(atExpiry.getTime() + 1),
      }),
    ).toBeNull();
  });

  it('rejects a tampered signature, another secret and a malformed token', () => {
    const minted = mint();
    expect(verifyAccessToken({ token: tamper(minted.token), secret: SECRET, now: NOW })).toBeNull();
    expect(
      verifyAccessToken({ token: minted.token, secret: `${SECRET}-other`, now: NOW }),
    ).toBeNull();
    const [prefix, payload] = minted.token.split('.');
    for (const token of [
      '',
      'cb1',
      `${prefix}.${payload}`,
      `${prefix}.${payload}.`,
      `cb2.${payload}.${minted.token.split('.')[2] ?? ''}`,
      `${prefix}.${payload}.${minted.token.split('.')[2] ?? ''}.extra`,
      'cb1.!!!.???',
    ]) {
      expect(verifyAccessToken({ token, secret: SECRET, now: NOW })).toBeNull();
    }
  });

  it('rejects a signed payload that is not the frozen claim shape', () => {
    const nowSeconds = Math.floor(NOW.getTime() / 1000);
    const shapes: unknown[] = [
      { v: 2, sub: DEVICE_ID, scopes: ['read'], iat: nowSeconds, exp: nowSeconds + 60 },
      { v: 1, sub: '', scopes: ['read'], iat: nowSeconds, exp: nowSeconds + 60 },
      { v: 1, sub: DEVICE_ID, scopes: 'read', iat: nowSeconds, exp: nowSeconds + 60 },
      { v: 1, sub: DEVICE_ID, scopes: [1], iat: nowSeconds, exp: nowSeconds + 60 },
      { v: 1, sub: DEVICE_ID, scopes: ['read'], iat: 1.5, exp: nowSeconds + 60 },
      { v: 1, sub: DEVICE_ID, scopes: ['read'], iat: nowSeconds },
      [],
      'claims',
    ];
    for (const shape of shapes) {
      expect(verifyAccessToken({ token: forge(shape), secret: SECRET, now: NOW })).toBeNull();
    }
    expect(
      verifyAccessToken({
        token: forge({
          v: 1,
          sub: DEVICE_ID,
          scopes: ['read'],
          iat: nowSeconds,
          exp: nowSeconds + 60,
        }),
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({
      v: 1,
      sub: DEVICE_ID,
      scopes: ['read'],
      iat: nowSeconds,
      exp: nowSeconds + 60,
    });
  });
});

describe('refresh tokens', () => {
  it('issues 32 random bytes as base64url and two calls differ', () => {
    const first = issueRefreshToken();
    const second = issueRefreshToken();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(issueRefreshToken({ bytes: 16 }).token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('hashes a refresh token deterministically with the session secret', () => {
    const { token } = issueRefreshToken();
    const hash = hashRefreshToken(token, SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token, SECRET)).toBe(hash);
    expect(hashRefreshToken(token, `${SECRET}-other`)).not.toBe(hash);
    expect(hashRefreshToken(`${token}x`, SECRET)).not.toBe(hash);
    const issued = issueRefreshToken({ secret: SECRET });
    expect(issued.hash).toBe(hashRefreshToken(issued.token, SECRET));
  });
});

describe('scopes', () => {
  it('matches exact membership with no implied scope', () => {
    expect(hasScope(['read'], 'read')).toBe(true);
    expect(hasScope(['read'], 'write')).toBe(false);
    expect(hasScope(['admin'], 'write')).toBe(false);
    expect(hasScope(['admin'], 'read')).toBe(false);
    expect(hasScope([], 'read')).toBe(false);
    expect(hasScope(SCOPES, 'admin')).toBe(true);
  });

  it('a revoked device fails every scope', () => {
    for (const scope of SCOPES) {
      expect(
        authorizeDevice({
          device: { scopes: [scope], revokedAt: null },
          required: scope,
          now: NOW,
        }),
      ).toBe(true);
      expect(
        authorizeDevice({
          device: { scopes: [scope], revokedAt: '2026-10-23T00:00:00.000Z' },
          required: scope,
          now: NOW,
        }),
      ).toBe(false);
    }
    for (const scope of SCOPES) {
      expect(
        authorizeDevice({
          device: { scopes: SCOPES, revokedAt: '2026-10-23T00:00:00.000Z' },
          required: scope,
          now: NOW,
        }),
      ).toBe(false);
    }
    expect(
      authorizeDevice({ device: { scopes: SCOPES, revokedAt: null }, required: 'admin', now: NOW }),
    ).toBe(true);
    expect(
      authorizeDevice({
        device: { scopes: ['read'], revokedAt: null },
        required: 'admin',
        now: NOW,
      }),
    ).toBe(false);
  });
});
