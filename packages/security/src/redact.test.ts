import { describe, expect, it } from 'vitest';
import { REDACTED_PLACEHOLDER, REDACTION_KEY_PATTERNS, isSecretKey, redact } from './redact.js';

interface Fixture {
  readonly requestId: string;
  readonly authorization: string;
  readonly nested: {
    readonly cookie: string;
    readonly child: {
      readonly password: string;
      readonly clientSecret: string;
      readonly label: string;
    };
  };
  readonly privateKey: string;
  readonly refresh_token: string;
  readonly ANTHROPIC_API_KEY: string;
}

function fixture(): Fixture {
  return {
    requestId: 'req_01JABCDEFG',
    authorization: 'Bearer not-a-real-token',
    nested: {
      cookie: 'session=1',
      child: {
        password: 'hunter2',
        clientSecret: 'client-secret-value',
        label: 'keep-me',
      },
    },
    privateKey: '-----BEGIN PRIVATE KEY-----',
    refresh_token: 'refresh-value',
    ANTHROPIC_API_KEY: 'provider-key-value',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('redaction', () => {
  it('freezes the documented placeholder and key list', () => {
    expect(REDACTED_PLACEHOLDER).toBe('[redacted]');
    expect([...REDACTION_KEY_PATTERNS]).toEqual([
      'token',
      'secret',
      'password',
      'key',
      'authorization',
      'cookie',
      'private',
    ]);
    for (const key of [
      'CB_SESSION_SECRET',
      'ANTHROPIC_API_KEY',
      'set-cookie',
      'privateKey',
      'Authorization',
      'refresh_token',
      'Password',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
    for (const key of ['deviceId', 'scopes', 'requestId', 'email']) {
      expect(isSecretKey(key)).toBe(false);
    }
    expect(isSecretKey('tokensIn')).toBe(true);
  });

  it('redaction removes the documented key list and never mutates the input', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = redact(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toBe(input);
    const redacted = asRecord(result);
    expect(redacted['nested']).not.toBe(input.nested);

    expect(redacted['authorization']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['privateKey']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['refresh_token']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['ANTHROPIC_API_KEY']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['requestId']).toBe('req_01JABCDEFG');

    const nested = asRecord(redacted['nested']);
    expect(nested['cookie']).toBe(REDACTED_PLACEHOLDER);
    const child = asRecord(nested['child']);
    expect(child['password']).toBe(REDACTED_PLACEHOLDER);
    expect(child['clientSecret']).toBe(REDACTED_PLACEHOLDER);
    expect(child['label']).toBe('keep-me');
  });

  it('copies arrays and leaves scalars alone', () => {
    const input = {
      items: [{ token: 'a', label: 'x' }],
      count: 1,
      ok: true,
      big: 10n,
      empty: null,
    };
    const result = asRecord(redact(input));
    expect(result['count']).toBe(1);
    expect(result['ok']).toBe(true);
    expect(result['big']).toBe(10n);
    expect(result['empty']).toBeNull();
    expect(result['items']).not.toBe(input.items);
    const [item] = result['items'] as Record<string, unknown>[];
    expect(item).toEqual({ token: REDACTED_PLACEHOLDER, label: 'x' });
  });

  it('renders dates, errors and binary without leaking content', () => {
    const date = new Date('2026-10-24T12:00:00.000Z');
    expect(redact(date)).toBe('2026-10-24T12:00:00.000Z');
    const error = new TypeError('boom');
    expect(redact(error)).toEqual({ name: 'TypeError', message: 'boom' });
    expect(redact(Buffer.from('secret bytes'))).toBe('[binary]');
    expect(redact(new Uint8Array([1, 2, 3]))).toBe('[binary]');
  });

  it('marks a cycle and never throws on an unsupported object', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    const result = asRecord(redact(cyclic));
    expect(result['name']).toBe('loop');
    expect(result['self']).toBe('[circular]');

    class Custom {
      readonly value = 1;
    }
    expect(redact(new Custom())).toBe('[unsupported]');
    expect(redact(new Map())).toBe('[unsupported]');
    expect(redact(() => undefined)).toBe('[unsupported]');
    expect(redact(Symbol('s'))).toBe('[unsupported]');
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype['secret'] = 'value';
    nullPrototype['safe'] = 'kept';
    expect(redact(nullPrototype)).toEqual({ secret: REDACTED_PLACEHOLDER, safe: 'kept' });
  });
});
