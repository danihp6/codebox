import { describe, expect, it } from 'vitest';
import {
  MASTER_KEY_BASE64_LENGTH,
  MASTER_KEY_BYTES,
  SEALED_SECRET_VERSION,
  VaultError,
  decodeMasterKey,
  lastFour,
  openSecret,
  sealSecret,
} from './credential-vault.js';
import type { SealedSecret } from './credential-vault.js';

const PLAINTEXT = 'sk-test-0123456789abcdefghijklmnopqrstuvwxyz';

function key(fill: number): Uint8Array {
  return new Uint8Array(MASTER_KEY_BYTES).fill(fill);
}

function keyBase64(fill: number): string {
  return Buffer.from(key(fill)).toString('base64');
}

function codes(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof VaultError ? error.code : 'not-a-vault-error';
  }
}

function fiveCharacterSlices(value: string): string[] {
  const slices: string[] = [];
  for (let index = 0; index + 5 <= value.length; index += 1) {
    slices.push(value.slice(index, index + 5));
  }
  return slices;
}

describe('credential vault', () => {
  it('round-trips a secret through AES-256-GCM', () => {
    const masterKey = key(7);
    const sealed = sealSecret(PLAINTEXT, masterKey);
    expect(sealed.v).toBe(SEALED_SECRET_VERSION);
    expect(openSecret(sealed, masterKey)).toBe(PLAINTEXT);
    expect(Buffer.from(sealed.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(sealed.tag, 'base64')).toHaveLength(16);
  });

  it('uses a fresh IV per seal', () => {
    const masterKey = key(7);
    const first = sealSecret(PLAINTEXT, masterKey);
    const second = sealSecret(PLAINTEXT, masterKey);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('throws decrypt_failed for a wrong key and for a flipped tag', () => {
    const masterKey = key(7);
    const sealed = sealSecret(PLAINTEXT, masterKey);
    expect(codes(() => openSecret(sealed, key(8)))).toBe('decrypt_failed');

    const tag = Buffer.from(sealed.tag, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0x01;
    const tampered: SealedSecret = { ...sealed, tag: tag.toString('base64') };
    expect(codes(() => openSecret(tampered, masterKey))).toBe('decrypt_failed');
  });

  it('throws invalid_sealed for a malformed envelope and invalid_key for a bad key', () => {
    expect(
      codes(() =>
        openSecret({ ...sealSecret('x', key(1)), v: 2 } as unknown as SealedSecret, key(1)),
      ),
    ).toBe('invalid_sealed');
    expect(codes(() => openSecret({ ...sealSecret('x', key(1)), iv: 'AAAA' }, key(1)))).toBe(
      'invalid_sealed',
    );
    expect(codes(() => sealSecret('x', new Uint8Array(16)))).toBe('invalid_key');
    expect(codes(() => openSecret(sealSecret('x', key(1)), new Uint8Array(8)))).toBe('invalid_key');
  });

  it('never carries the plaintext or a five-character slice of it', () => {
    const sealed = sealSecret(PLAINTEXT, key(3));
    const wire = JSON.stringify(sealed);
    expect(wire).not.toContain(PLAINTEXT);
    for (const slice of fiveCharacterSlices(PLAINTEXT)) {
      expect(wire).not.toContain(slice);
    }
  });

  it('decodes a 44-character standard base64 master key and refuses anything else', () => {
    const base64 = keyBase64(5);
    expect(base64).toHaveLength(MASTER_KEY_BASE64_LENGTH);
    expect(decodeMasterKey(base64)).toEqual(key(5));
    expect(codes(() => decodeMasterKey('short'))).toBe('invalid_key');
    expect(codes(() => decodeMasterKey('A'.repeat(44)))).toBe('invalid_key');
    expect(codes(() => decodeMasterKey(Buffer.from(key(5)).toString('base64url')))).toBe(
      'invalid_key',
    );
  });

  it('reports the last four characters, and nothing for short values', () => {
    expect(lastFour('abcdef')).toBe('cdef');
    expect(lastFour('abc')).toBe('');
    expect(lastFour('abcd')).toBe('');
    expect(lastFour('')).toBe('');
  });
});
