import { randomBytes, scrypt } from 'node:crypto';
import { safeEqual, sha256Hex } from './constant-time.js';

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 32,
});

const SCHEME = 'scrypt';
const SALT_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;
const MIN_KEY_BYTES = 16;
const MAX_KEY_BYTES = 128;
// Bounds keep a forged or corrupted stored hash from turning verification into a
// memory-exhaustion lever; every value above them is a malformed hash.
const MIN_N = 2;
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

function derive(secret: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      salt,
      params.keyLength,
      { N: params.N, r: params.r, p: params.p },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function parseBoundedInteger(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export async function hashSecret(
  secret: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(secret, salt, params);
  return [
    SCHEME,
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [scheme, rawN, rawR, rawP, saltText, keyText] = parts;
  if (
    scheme !== SCHEME ||
    rawN === undefined ||
    rawR === undefined ||
    rawP === undefined ||
    saltText === undefined ||
    keyText === undefined
  ) {
    return false;
  }
  const N = parseBoundedInteger(rawN, MIN_N, MAX_N);
  const r = parseBoundedInteger(rawR, 1, MAX_R);
  const p = parseBoundedInteger(rawP, 1, MAX_P);
  if (N === null || r === null || p === null) return false;
  if (!BASE64URL.test(saltText) || !BASE64URL.test(keyText)) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const key = Buffer.from(keyText, 'base64url');
  if (salt.length < MIN_SALT_BYTES || salt.length > MAX_SALT_BYTES) return false;
  if (key.length < MIN_KEY_BYTES || key.length > MAX_KEY_BYTES) return false;
  try {
    const derived = await derive(secret, salt, { N, r, p, keyLength: key.length });
    return safeEqual(derived, key);
  } catch {
    return false;
  }
}

export function deviceFingerprint(publicKey: string): string {
  return `sha256:${sha256Hex(publicKey)}`;
}
