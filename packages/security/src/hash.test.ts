import { describe, expect, it } from 'vitest';
import { DEFAULT_SCRYPT_PARAMS, deviceFingerprint, hashSecret, verifySecret } from './hash.js';

const HASH_PATTERN = /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;

describe('scrypt hashing', () => {
  it('freezes the documented default parameters', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 16384, r: 8, p: 1, keyLength: 32 });
  });

  it('writes the scheme, the parameters, a fresh salt and the derived key', async () => {
    const first = await hashSecret('correct horse');
    const second = await hashSecret('correct horse');
    expect(first).toMatch(HASH_PATTERN);
    expect(second).toMatch(HASH_PATTERN);
    expect(first).not.toBe(second);
    expect(first.split('$')).toHaveLength(6);
  });

  it('verifies the secret it hashed and rejects another one', async () => {
    const stored = await hashSecret('correct horse');
    await expect(verifySecret('correct horse', stored)).resolves.toBe(true);
    await expect(verifySecret('correct horsE', stored)).resolves.toBe(false);
    await expect(verifySecret('', stored)).resolves.toBe(false);
  });

  it('honours explicit parameters', async () => {
    const stored = await hashSecret('correct horse', { N: 1024, r: 8, p: 1, keyLength: 32 });
    expect(stored.startsWith('scrypt$1024$8$1$')).toBe(true);
    await expect(verifySecret('correct horse', stored)).resolves.toBe(true);
  });

  it('returns false for a stored hash that does not parse', async () => {
    const stored = await hashSecret('correct horse');
    const parts = stored.split('$');
    const truncations = [
      '',
      'not-a-hash',
      'scrypt$16384$8$1',
      parts.slice(0, 5).join('$'),
      stored.replace(/^scrypt/, 'bcrypt'),
      stored.replace('$16384$', '$0$'),
      stored.replace('$16384$', '$100000000$'),
      `${stored}$extra`,
      stored.replace(/\$([A-Za-z0-9_-]+)$/, '$not+base64!'),
    ];
    for (const candidate of truncations) {
      await expect(verifySecret('correct horse', candidate)).resolves.toBe(false);
    }
  });

  it('derives a stable fingerprint of the public key', () => {
    const publicKey =
      '-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAK0=\n-----END PUBLIC KEY-----\n';
    const fingerprint = deviceFingerprint(publicKey);
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(deviceFingerprint(publicKey)).toBe(fingerprint);
    expect(deviceFingerprint(`${publicKey} `)).not.toBe(fingerprint);
    expect(fingerprint).not.toContain('MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAK0');
  });
});
