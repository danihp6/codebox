import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SEALED_SECRET_VERSION = 1;
export const MASTER_KEY_BYTES = 32;
export const MASTER_KEY_BASE64_LENGTH = 44;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const CIPHER = 'aes-256-gcm';
const MASTER_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export interface SealedSecret {
  readonly v: 1;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export type VaultCode = 'invalid_key' | 'invalid_sealed' | 'decrypt_failed';

export class VaultError extends Error {
  readonly code: VaultCode;

  constructor(code: VaultCode) {
    super(`credential vault: ${code}`);
    this.name = 'VaultError';
    this.code = code;
  }
}

function decodeBase64Field(value: unknown, expectedBytes: number | null): Buffer {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
    throw new VaultError('invalid_sealed');
  }
  const bytes = Buffer.from(value, 'base64');
  if (expectedBytes !== null && bytes.length !== expectedBytes) {
    throw new VaultError('invalid_sealed');
  }
  return bytes;
}

export function decodeMasterKey(base64: string): Uint8Array {
  if (!MASTER_KEY_PATTERN.test(base64)) throw new VaultError('invalid_key');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== MASTER_KEY_BYTES) throw new VaultError('invalid_key');
  return new Uint8Array(bytes);
}

export function sealSecret(plaintext: string, masterKey: Uint8Array): SealedSecret {
  if (masterKey.length !== MASTER_KEY_BYTES) throw new VaultError('invalid_key');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: SEALED_SECRET_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function openSecret(sealed: SealedSecret, masterKey: Uint8Array): string {
  if (masterKey.length !== MASTER_KEY_BYTES) throw new VaultError('invalid_key');
  const record = sealed as unknown as Record<string, unknown>;
  if (record.v !== SEALED_SECRET_VERSION) throw new VaultError('invalid_sealed');
  const iv = decodeBase64Field(record.iv, IV_BYTES);
  const tag = decodeBase64Field(record.tag, TAG_BYTES);
  const ciphertext = decodeBase64Field(record.ciphertext, null);
  try {
    const decipher = createDecipheriv(CIPHER, masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new VaultError('decrypt_failed');
  }
}

/** At most the last four characters; `''` when the value is four characters or shorter. */
export function lastFour(value: string): string {
  return value.length <= 4 ? '' : value.slice(-4);
}
