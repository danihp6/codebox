import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_ID_RANDOM_CHARS,
  INTEGRATION_ID_RANDOM_CHARS,
  newCredentialId,
  newIntegrationId,
} from './ids.js';

function bytes(value: number): Buffer {
  return Buffer.alloc(CREDENTIAL_ID_RANDOM_CHARS, value);
}

describe('credential ids', () => {
  it('builds a cred_ id of ten Crockford characters', () => {
    const id = newCredentialId(() => bytes(1));
    expect(id).toMatch(/^cred_[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(id).toHaveLength(5 + CREDENTIAL_ID_RANDOM_CHARS);
  });

  it('builds an int_ id of ten Crockford characters', () => {
    const id = newIntegrationId(() => bytes(2));
    expect(id).toMatch(/^int_[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(id).toHaveLength(4 + INTEGRATION_ID_RANDOM_CHARS);
  });

  it('uses the injected randomness so a test can pin the suffix', () => {
    expect(newCredentialId(() => Buffer.alloc(CREDENTIAL_ID_RANDOM_CHARS, 0))).toBe(
      'cred_0000000000',
    );
    expect(newIntegrationId(() => Buffer.alloc(INTEGRATION_ID_RANDOM_CHARS, 0x1f))).toBe(
      'int_ZZZZZZZZZZ',
    );
  });

  it('refuses a short random source and stays unique', () => {
    expect(() => newCredentialId(() => Buffer.alloc(2))).toThrow(RangeError);
    const ids = new Set(Array.from({ length: 50 }, () => newCredentialId()));
    expect(ids.size).toBe(50);
  });
});
