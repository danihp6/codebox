import { generateKeyPairSync, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PushError } from './errors.js';
import { createVapidSigner } from './vapid.js';

const SUBJECT = 'mailto:ops@example.com';
const NOW = '2026-11-10T21:30:00.000Z';

interface GeneratedPair {
  readonly publicKeyObject: KeyObject;
  readonly rawPublicKey: Buffer;
  readonly rawPrivateKey: Buffer;
  readonly pkcs8: Buffer;
}

function generatedPair(): GeneratedPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  if (jwk.d === undefined || jwk.x === undefined || jwk.y === undefined) {
    throw new Error('the generated key has no EC coordinates');
  }
  return {
    publicKeyObject: publicKey,
    rawPublicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x, 'base64url'),
      Buffer.from(jwk.y, 'base64url'),
    ]),
    rawPrivateKey: Buffer.from(jwk.d, 'base64url'),
    pkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }),
  };
}

interface ParsedAuthorization {
  readonly jwt: string;
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly signingInput: string;
  readonly signature: Buffer;
  readonly key: string;
}

function parseAuthorization(value: string): ParsedAuthorization {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(value);
  if (match === null) throw new Error(`not a vapid authorization: ${value}`);
  const jwt = match[1] ?? '';
  const key = match[2] ?? '';
  const [header, payload, signature, ...rest] = jwt.split('.');
  if (header === undefined || payload === undefined || signature === undefined || rest.length > 0) {
    throw new Error('not a compact JWS');
  }
  return {
    jwt,
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    signingInput: `${header}.${payload}`,
    signature: Buffer.from(signature, 'base64url'),
    key,
  };
}

describe('VAPID signer', () => {
  it('signs an ES256 JWT with the configured audience and expiry', () => {
    const pair = generatedPair();
    const signer = createVapidSigner({
      publicKey: pair.rawPublicKey.toString('base64url'),
      privateKey: pair.rawPrivateKey.toString('base64url'),
      subject: SUBJECT,
      now: () => new Date(NOW),
      ttlSeconds: 3600,
    });

    const parsed = parseAuthorization(signer.authorization('https://push.example.com/x?y=1'));
    expect(parsed.header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(parsed.payload['aud']).toBe('https://push.example.com');
    expect(parsed.payload['sub']).toBe(SUBJECT);
    expect(parsed.payload['exp']).toBe(Math.floor(Date.parse(NOW) / 1000) + 3600);
    expect(parsed.key).toBe(pair.rawPublicKey.toString('base64url'));
    expect(parsed.signature).toHaveLength(64);
    expect(
      verify(
        'sha256',
        Buffer.from(parsed.signingInput, 'utf8'),
        {
          key: pair.publicKeyObject,
          dsaEncoding: 'ieee-p1363',
        },
        parsed.signature,
      ),
    ).toBe(true);
  });

  it('accepts a PKCS#8 private key as well as a raw scalar', () => {
    const pair = generatedPair();
    const signer = createVapidSigner({
      publicKey: pair.rawPublicKey.toString('base64url'),
      privateKey: pair.pkcs8.toString('base64url'),
      subject: SUBJECT,
      now: () => new Date(NOW),
      ttlSeconds: 3600,
    });

    const parsed = parseAuthorization(signer.authorization('https://push.example.com/x'));
    expect(
      verify(
        'sha256',
        Buffer.from(parsed.signingInput, 'utf8'),
        {
          key: pair.publicKeyObject,
          dsaEncoding: 'ieee-p1363',
        },
        parsed.signature,
      ),
    ).toBe(true);
  });

  it('defaults to twelve hours and clamps the ttl to one day', () => {
    const pair = generatedPair();
    const base = {
      publicKey: pair.rawPublicKey.toString('base64url'),
      privateKey: pair.rawPrivateKey.toString('base64url'),
      subject: SUBJECT,
      now: () => new Date(NOW),
    };
    const issuedAt = Math.floor(Date.parse(NOW) / 1000);
    const byDefault = parseAuthorization(
      createVapidSigner(base).authorization('https://push.example.com'),
    );
    expect(byDefault.payload['exp']).toBe(issuedAt + 43_200);
    const clamped = parseAuthorization(
      createVapidSigner({ ...base, ttlSeconds: 999_999 }).authorization('https://push.example.com'),
    );
    expect(clamped.payload['exp']).toBe(issuedAt + 86_400);
  });

  it('refuses a public key that is not a P-256 point', () => {
    const pair = generatedPair();
    try {
      createVapidSigner({
        publicKey: Buffer.alloc(65, 1).toString('base64url'),
        privateKey: pair.rawPrivateKey.toString('base64url'),
        subject: SUBJECT,
        now: () => new Date(NOW),
      });
      throw new Error('expected a PushError');
    } catch (error) {
      expect(error).toBeInstanceOf(PushError);
      const push = error as PushError;
      expect(push.reason).toBe('invalid_config');
      expect(push.status).toBe(503);
      expect(push.details).toEqual({ key: 'CB_VAPID_PUBLIC_KEY' });
    }
  });

  it('refuses a private key that does not decode', () => {
    const pair = generatedPair();
    try {
      createVapidSigner({
        publicKey: pair.rawPublicKey.toString('base64url'),
        privateKey: Buffer.from([1, 2, 3]).toString('base64url'),
        subject: SUBJECT,
        now: () => new Date(NOW),
      });
      throw new Error('expected a PushError');
    } catch (error) {
      expect(error).toBeInstanceOf(PushError);
      expect((error as PushError).details).toEqual({ key: 'CB_VAPID_PRIVATE_KEY' });
    }
  });
});
