import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PushSubscription } from '@codebox/contracts';
import type { PushMessage } from './mapping.js';
import { createWebPushTransport } from './transport.js';
import type { PushTransport } from './transport.js';
import type { VapidSigner } from './vapid.js';

const AUTH_SECRET = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1));
const ENDPOINT = 'https://push.example.com/subscription/abc';
const AUTHORIZATION = 'vapid t=test.token, k=test-key';

interface Recipient {
  readonly publicKey: Buffer;
  readonly privateKey: Buffer;
}

function recipient(): Recipient {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey() };
}

function subscriptionOf(keys: Recipient): PushSubscription {
  return {
    id: 'sub_01JABCDEFG',
    kind: 'web',
    endpoint: ENDPOINT,
    keys: {
      p256dh: keys.publicKey.toString('base64url'),
      auth: AUTH_SECRET.toString('base64url'),
    },
  };
}

function message(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    type: 'run.finished',
    title: 'Run succeeded',
    body: 'Run run_01JABCDEFG finished.',
    url: '/runs/run_01JABCDEFG',
    tag: 'run:run_01JABCDEFG',
    runId: 'run_01JABCDEFG',
    ...overrides,
  };
}

function vapid(): VapidSigner {
  return { authorization: (endpoint: string): string => `${AUTHORIZATION} ${endpoint}` };
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/** Decrypts an aes128gcm request body with the recipient key, independently of rfc8291.ts. */
function decrypt(body: Uint8Array, keys: Recipient): unknown {
  const bytes = Buffer.from(body);
  const salt = bytes.subarray(0, 16);
  const keyLength = bytes.readUInt8(20);
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
  const ikm = hkdf(shared, AUTH_SECRET, keyInfo, 32);
  const contentKey = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  expect(plaintext.at(-1)).toBe(2);
  return JSON.parse(plaintext.subarray(0, plaintext.length - 1).toString('utf8')) as unknown;
}

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

function transportWith(
  respond: (url: string, init: RequestInit) => Promise<Response>,
  options: { readonly timeoutMs?: number } = {},
): { readonly push: PushTransport; readonly captured: Captured[] } {
  const captured: Captured[] = [];
  const push = createWebPushTransport({
    vapid: vapid(),
    fetch: (url, init) => {
      captured.push({ url, init });
      return respond(url, init);
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { push, captured };
}

describe('web push transport', () => {
  it('posts an encrypted body with the vapid authorization and expiry headers', async () => {
    const keys = recipient();
    const { push, captured } = transportWith(() =>
      Promise.resolve(new Response(null, { status: 201 })),
    );

    const outcome = await push.send({ subscription: subscriptionOf(keys), message: message() });

    expect(outcome).toEqual({ kind: 'accepted', status: 201 });
    expect(captured).toHaveLength(1);
    const request = captured[0];
    if (request === undefined) throw new Error('no request');
    expect(request.url).toBe(ENDPOINT);
    expect(request.init.method).toBe('POST');
    const headers = new Headers(request.init.headers);
    expect(headers.get('authorization')).toBe(`${AUTHORIZATION} ${ENDPOINT}`);
    expect(headers.get('content-type')).toBe('application/encoding/aes128gcm');
    expect(headers.get('ttl')).toBe('300');
    expect(headers.get('urgency')).toBe('normal');

    const body = request.init.body;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(decrypt(body as Uint8Array, keys)).toEqual({
      type: 'run.finished',
      title: 'Run succeeded',
      body: 'Run run_01JABCDEFG finished.',
      url: '/runs/run_01JABCDEFG',
      tag: 'run:run_01JABCDEFG',
      runId: 'run_01JABCDEFG',
    });
  });

  it('raises urgency for an approval and omits absent resource ids', async () => {
    const keys = recipient();
    const { push, captured } = transportWith(() =>
      Promise.resolve(new Response(null, { status: 202 })),
    );
    await push.send({
      subscription: subscriptionOf(keys),
      message: {
        type: 'approval.created',
        title: 'Approve',
        body: 'The agent is waiting for your approval.',
        url: '/approvals',
        tag: 'approval:apv_1',
      },
    });
    const request = captured[0];
    if (request === undefined) throw new Error('no request');
    expect(new Headers(request.init.headers).get('urgency')).toBe('high');
    expect(decrypt(request.init.body as Uint8Array, keys)).toEqual({
      type: 'approval.created',
      title: 'Approve',
      body: 'The agent is waiting for your approval.',
      url: '/approvals',
      tag: 'approval:apv_1',
    });
  });

  it('maps a gone subscription to expired', async () => {
    const keys = recipient();
    for (const status of [404, 410] as const) {
      const { push } = transportWith(() => Promise.resolve(new Response(null, { status })));
      const outcome = await push.send({ subscription: subscriptionOf(keys), message: message() });
      expect(outcome).toEqual({ kind: 'expired', status });
    }
  });

  it('maps any other status to failed', async () => {
    const keys = recipient();
    const { push } = transportWith(() => Promise.resolve(new Response(null, { status: 429 })));
    const outcome = await push.send({ subscription: subscriptionOf(keys), message: message() });
    expect(outcome).toEqual({ kind: 'failed', status: 429 });
  });

  it('reports a rejection as unreachable and never throws', async () => {
    const keys = recipient();
    const { push } = transportWith(() => Promise.reject(new TypeError('fetch failed')));
    const outcome = await push.send({ subscription: subscriptionOf(keys), message: message() });
    expect(outcome).toEqual({ kind: 'unreachable', error: 'TypeError' });
  });

  it('aborts a slow request and reports it as unreachable', async () => {
    const keys = recipient();
    const { push } = transportWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
      { timeoutMs: 5 },
    );
    const outcome = await push.send({ subscription: subscriptionOf(keys), message: message() });
    expect(outcome).toEqual({ kind: 'unreachable', error: 'AbortError' });
  });

  it('reports missing keys as unreachable', async () => {
    const { push } = transportWith(() => Promise.resolve(new Response(null, { status: 201 })));
    const outcome = await push.send({
      subscription: { id: 'sub_01JABCDEFG', kind: 'web', endpoint: ENDPOINT, keys: {} },
      message: message(),
    });
    expect(outcome.kind).toBe('unreachable');
  });
});
