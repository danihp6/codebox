import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GitProviderError } from './errors.js';
import { APP_JWT_BACKDATE_SECONDS, APP_JWT_TTL_SECONDS, createAppJwt } from './jwt.js';

const ISSUED_AT = 1_700_000_000;
const APP_ID = '123456';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function segments(token: string): readonly string[] {
  return token.split('.');
}

function decode(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
}

function jwt(issuedAt: number = ISSUED_AT): string {
  return createAppJwt({ appId: APP_ID, privateKeyPem: PRIVATE_PEM, issuedAt });
}

describe('app jwt', () => {
  it('carries the RS256 header and nothing else', () => {
    const [header] = segments(jwt());
    expect(decode(header ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('backdates iat by 60 seconds and expires 600 seconds later', () => {
    const [, payload] = segments(jwt());
    const claims = decode(payload ?? '') as Record<string, unknown>;
    expect(claims['iat']).toBe(ISSUED_AT - APP_JWT_BACKDATE_SECONDS);
    expect(claims['exp']).toBe(ISSUED_AT - APP_JWT_BACKDATE_SECONDS + APP_JWT_TTL_SECONDS);
    expect(APP_JWT_BACKDATE_SECONDS).toBe(60);
    expect(APP_JWT_TTL_SECONDS).toBe(600);
  });

  it('sets iss to the app id and carries no other claim', () => {
    const [, payload] = segments(jwt());
    expect(decode(payload ?? '')).toEqual({
      iat: ISSUED_AT - 60,
      exp: ISSUED_AT + 540,
      iss: APP_ID,
    });
  });

  it('has three unpadded base64url segments', () => {
    const parts = segments(jwt());
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(part).not.toContain('=');
    }
  });

  it('signs with the private key so the matching public key verifies it', () => {
    const token = jwt();
    const [header, payload, signature] = segments(token);
    const signingInput = `${header ?? ''}.${payload ?? ''}`;
    const valid = createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(PUBLIC_PEM, Buffer.from(signature ?? '', 'base64url'));
    expect(valid).toBe(true);
  });

  it('fails verification with a different key', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPublic = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const [header, payload, signature] = segments(jwt());
    const valid = createVerify('RSA-SHA256')
      .update(`${header ?? ''}.${payload ?? ''}`)
      .verify(otherPublic, Buffer.from(signature ?? '', 'base64url'));
    expect(valid).toBe(false);
  });

  it('rejects an unreadable private key with validation_failed', () => {
    let caught: unknown;
    try {
      createAppJwt({ appId: APP_ID, privateKeyPem: 'not a pem', issuedAt: ISSUED_AT });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitProviderError);
    expect((caught as GitProviderError).code).toBe('validation_failed');
    expect((caught as GitProviderError).status).toBeNull();
  });
});
