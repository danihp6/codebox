import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload } from './rfc8291.js';

const AUTH_SECRET = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1));
const SALT = Buffer.from(Array.from({ length: 16 }, (_, index) => 240 - index));
const OTHER_SALT = Buffer.from(Array.from({ length: 16 }, (_, index) => index * 3));
const EPHEMERAL = Buffer.from(Array.from({ length: 32 }, (_, index) => (index % 31) + 1));
const PLAINTEXT = Buffer.from(JSON.stringify({ type: 'run.finished', title: 'Run succeeded' }));

interface Recipient {
  readonly publicKey: Buffer;
  readonly privateKey: Buffer;
}

function recipient(): Recipient {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey() };
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/** An independent aes128gcm decode: same RFC, written from the body bytes alone. */
function decrypt(body: Uint8Array, keys: Recipient, auth: Buffer): Buffer {
  const bytes = Buffer.from(body);
  const salt = bytes.subarray(0, 16);
  expect(bytes.readUInt32BE(16)).toBe(4096);
  const keyLength = bytes.readUInt8(20);
  expect(keyLength).toBe(65);
  const senderPublicKey = bytes.subarray(21, 21 + keyLength);
  const ciphertext = bytes.subarray(21 + keyLength);

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(keys.privateKey);
  const shared = ecdh.computeSecret(senderPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    keys.publicKey,
    senderPublicKey,
  ]);
  const ikm = hkdf(shared, auth, keyInfo, 32);
  const contentKey = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
}

describe('aes128gcm payload encryption', () => {
  it('lays out salt, record size, key id and one record', () => {
    const keys = recipient();
    const encrypted = encryptPayload({
      plaintext: PLAINTEXT,
      keys: {
        p256dh: keys.publicKey.toString('base64url'),
        auth: AUTH_SECRET.toString('base64url'),
      },
      salt: SALT,
      ephemeralPrivateKey: EPHEMERAL,
    });

    const body = Buffer.from(encrypted.body);
    expect(encrypted.salt).toEqual(SALT);
    expect(body.subarray(0, 16)).toEqual(SALT);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(encrypted.senderPublicKey).toHaveLength(65);
    expect(body.subarray(21, 86)).toEqual(Buffer.from(encrypted.senderPublicKey));

    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(EPHEMERAL);
    expect(Buffer.from(encrypted.senderPublicKey)).toEqual(ecdh.getPublicKey());
  });

  it('round-trips the plaintext and its 0x02 delimiter', () => {
    const keys = recipient();
    const encrypted = encryptPayload({
      plaintext: PLAINTEXT,
      keys: {
        p256dh: keys.publicKey.toString('base64url'),
        auth: AUTH_SECRET.toString('base64url'),
      },
      salt: SALT,
      ephemeralPrivateKey: EPHEMERAL,
    });

    const padded = decrypt(encrypted.body, keys, AUTH_SECRET);
    expect(padded.at(-1)).toBe(2);
    expect(padded.subarray(0, padded.length - 1).toString('utf8')).toBe(PLAINTEXT.toString('utf8'));
  });

  it('produces a different body under a different salt', () => {
    const keys = recipient();
    const input = {
      plaintext: PLAINTEXT,
      keys: {
        p256dh: keys.publicKey.toString('base64url'),
        auth: AUTH_SECRET.toString('base64url'),
      },
      ephemeralPrivateKey: EPHEMERAL,
    };
    const first = encryptPayload({ ...input, salt: SALT });
    const second = encryptPayload({ ...input, salt: OTHER_SALT });
    expect(Buffer.from(first.body)).not.toEqual(Buffer.from(second.body));
    expect(decrypt(second.body, keys, AUTH_SECRET).at(-1)).toBe(2);
  });

  it('generates a salt and an ephemeral key by default', () => {
    const keys = recipient();
    const encrypted = encryptPayload({
      plaintext: PLAINTEXT,
      keys: {
        p256dh: keys.publicKey.toString('base64url'),
        auth: AUTH_SECRET.toString('base64url'),
      },
    });
    expect(encrypted.salt).toHaveLength(16);
    expect(encrypted.senderPublicKey).toHaveLength(65);
    expect(decrypt(encrypted.body, keys, AUTH_SECRET).subarray(0, PLAINTEXT.length)).toEqual(
      PLAINTEXT,
    );
  });

  it('refuses a short p256dh or auth secret', () => {
    const keys = recipient();
    expect(() =>
      encryptPayload({
        plaintext: PLAINTEXT,
        keys: {
          p256dh: Buffer.alloc(10).toString('base64url'),
          auth: AUTH_SECRET.toString('base64url'),
        },
      }),
    ).toThrow(TypeError);
    expect(() =>
      encryptPayload({
        plaintext: PLAINTEXT,
        keys: {
          p256dh: keys.publicKey.toString('base64url'),
          auth: Buffer.alloc(4).toString('base64url'),
        },
      }),
    ).toThrow(TypeError);
  });
});
