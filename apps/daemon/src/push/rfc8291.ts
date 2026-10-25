import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export interface EncryptPayloadInput {
  readonly plaintext: Uint8Array;
  /** base64url: `p256dh` is the 65-byte point, `auth` the 16-byte secret. */
  readonly keys: { readonly p256dh: string; readonly auth: string };
  /** 16 bytes; default random. */
  readonly salt?: Uint8Array;
  /** 32-byte scalar; default random. Tests pin it. */
  readonly ephemeralPrivateKey?: Uint8Array;
}

export interface EncryptedPayload {
  /** salt(16) | rs(4, big-endian 4096) | idlen(1, 65) | keyid(65) | ciphertext. */
  readonly body: Uint8Array;
  readonly salt: Uint8Array;
  /** The 65-byte uncompressed point used as keyid. */
  readonly senderPublicKey: Uint8Array;
}

const CURVE = 'prime256v1';
const SALT_LENGTH = 16;
const AUTH_SECRET_LENGTH = 16;
const PUBLIC_KEY_LENGTH = 65;
const UNCOMPRESSED_POINT = 0x04;
const EPHEMERAL_KEY_LENGTH = 32;
const RECORD_SIZE = 4096;
const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const DELIMITER = 0x02;
const KEY_INFO_PREFIX = Buffer.from('WebPush: info\0', 'utf8');
const CEK_INFO = Buffer.from('Content-Encoding: aes128gcm\0', 'utf8');
const NONCE_INFO = Buffer.from('Content-Encoding: nonce\0', 'utf8');

/**
 * RFC 8291 web push with RFC 8188 `aes128gcm`: one record, ECDH P-256 with the subscription
 * key, HKDF-SHA256 keyed by the `auth` secret and the salt, and a single `0x02` padding
 * delimiter. `node:crypto` only.
 */
export function encryptPayload(input: EncryptPayloadInput): EncryptedPayload {
  const userAgentPublicKey = decodeBase64Url(input.keys.p256dh);
  const authSecret = decodeBase64Url(input.keys.auth);
  if (
    userAgentPublicKey.length !== PUBLIC_KEY_LENGTH ||
    userAgentPublicKey[0] !== UNCOMPRESSED_POINT
  ) {
    throw new TypeError('p256dh must be a 65-byte uncompressed P-256 point');
  }
  if (authSecret.length !== AUTH_SECRET_LENGTH) {
    throw new TypeError('auth must be a 16-byte secret');
  }
  const salt = Buffer.from(input.salt ?? randomBytes(SALT_LENGTH));
  if (salt.length !== SALT_LENGTH) throw new TypeError('salt must be 16 bytes');
  const ephemeral = Buffer.from(input.ephemeralPrivateKey ?? randomBytes(EPHEMERAL_KEY_LENGTH));
  if (ephemeral.length !== EPHEMERAL_KEY_LENGTH) {
    throw new TypeError('the ephemeral private key must be a 32-byte scalar');
  }

  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(ephemeral);
  const senderPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userAgentPublicKey);

  const keyInfo = Buffer.concat([KEY_INFO_PREFIX, userAgentPublicKey, senderPublicKey]);
  const ikm = hkdf(sharedSecret, authSecret, keyInfo, 32);
  const contentKey = hkdf(ikm, salt, CEK_INFO, KEY_LENGTH);
  const nonce = hkdf(ikm, salt, NONCE_INFO, NONCE_LENGTH);

  const plaintext = Buffer.from(input.plaintext);
  const padded = Buffer.concat([plaintext, Buffer.from([DELIMITER])]);
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  if (ciphertext.length < TAG_LENGTH) throw new Error('the ciphertext is shorter than its tag');
  const header = Buffer.alloc(SALT_LENGTH + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_LENGTH);
  header.writeUInt8(PUBLIC_KEY_LENGTH, SALT_LENGTH + 4);

  return {
    body: Buffer.concat([header, senderPublicKey, ciphertext]),
    salt,
    senderPublicKey,
  };
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

function decodeBase64Url(value: string): Buffer {
  if (value === '') throw new TypeError('a key is empty');
  return Buffer.from(value, 'base64url');
}
