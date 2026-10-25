import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { PushError } from './errors.js';

export interface VapidSignerOptions {
  /** base64url, 65-byte uncompressed P-256 point. */
  readonly publicKey: string;
  /** base64url, 32-byte raw scalar OR PKCS#8 DER. */
  readonly privateKey: string;
  /** `mailto:…` or an https URL. */
  readonly subject: string;
  readonly now: () => Date;
  /** JWT lifetime; default 12 h, clamped to 24 h. */
  readonly ttlSeconds?: number;
}

export interface VapidSigner {
  /** `vapid t=<jwt>, k=<publicKey>` for one endpoint. */
  authorization(endpoint: string): string;
}

export const VAPID_TTL_SECONDS = 43_200;
export const VAPID_MAX_TTL_SECONDS = 86_400;

const PUBLIC_KEY_LENGTH = 65;
const UNCOMPRESSED_POINT = 0x04;
const PRIVATE_KEY_LENGTH = 32;
const CURVE = 'prime256v1';
const P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
// PKCS#8 with the embedded P-256 public key: the fixed prefix, the 32-byte scalar, then the
// [1] publicKey field, which is why the configured point is needed to wrap a raw scalar.
const P256_PKCS8_PREFIX = Buffer.from(
  '308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420',
  'hex',
);
const P256_PKCS8_PUBLIC_PREFIX = Buffer.from('a144034200', 'hex');

const PUBLIC_KEY_CONFIG = 'CB_VAPID_PUBLIC_KEY';
const PRIVATE_KEY_CONFIG = 'CB_VAPID_PRIVATE_KEY';

const HEADER = { typ: 'JWT', alg: 'ES256' } as const;

export function createVapidSigner(options: VapidSignerOptions): VapidSigner {
  const rawPublicKey = decodePublicKey(options.publicKey);
  const privateKey = decodePrivateKey(options.privateKey, rawPublicKey);
  const exposedKey = rawPublicKey.toString('base64url');
  const ttlSeconds = clampTtl(options.ttlSeconds ?? VAPID_TTL_SECONDS);

  return {
    authorization(endpoint: string): string {
      const issuedAt = Math.floor(options.now().getTime() / 1000);
      const header = toBase64Url(JSON.stringify(HEADER));
      const payload = toBase64Url(
        JSON.stringify({
          aud: new URL(endpoint).origin,
          exp: issuedAt + ttlSeconds,
          sub: options.subject,
        }),
      );
      const signingInput = `${header}.${payload}`;
      const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      return `vapid t=${signingInput}.${signature.toString('base64url')}, k=${exposedKey}`;
    },
  };
}

function decodePublicKey(value: string): Buffer {
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== PUBLIC_KEY_LENGTH || raw[0] !== UNCOMPRESSED_POINT) {
    throw invalidKey(PUBLIC_KEY_CONFIG);
  }
  try {
    const key = createPublicKey({
      key: Buffer.concat([P256_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    assertCurve(key, PUBLIC_KEY_CONFIG);
  } catch {
    throw invalidKey(PUBLIC_KEY_CONFIG);
  }
  return raw;
}

function decodePrivateKey(value: string, rawPublicKey: Buffer): KeyObject {
  const decoded = Buffer.from(value, 'base64url');
  const der =
    decoded.length === PRIVATE_KEY_LENGTH
      ? Buffer.concat([P256_PKCS8_PREFIX, decoded, P256_PKCS8_PUBLIC_PREFIX, rawPublicKey])
      : decoded;
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    throw invalidKey(PRIVATE_KEY_CONFIG);
  }
  assertCurve(key, PRIVATE_KEY_CONFIG);
  return key;
}

function assertCurve(key: KeyObject, configKey: string): void {
  if (key.asymmetricKeyDetails?.namedCurve !== CURVE) throw invalidKey(configKey);
}

function invalidKey(key: string): PushError {
  return new PushError('invalid_config', 503, { key });
}

function clampTtl(value: number): number {
  if (!Number.isFinite(value)) return VAPID_TTL_SECONDS;
  return Math.min(Math.max(0, Math.trunc(value)), VAPID_MAX_TTL_SECONDS);
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
