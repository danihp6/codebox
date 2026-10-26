import { describe, expect, it } from 'vitest';
import { REDACTION_CORPUS } from './redact-corpus.js';
import { REDACTED_PLACEHOLDER, redact } from './redact.js';

/** A bigint has no JSON form and a fixture may be circular; the corpus still has to serialise. */
function serialise(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === 'bigint') return entry.toString();
      if (typeof entry === 'object' && entry !== null) {
        if (seen.has(entry)) return '[cycle]';
        seen.add(entry);
      }
      return entry;
    }) ?? ''
  );
}

function fixtureNamed(name: string): unknown {
  const fixture = REDACTION_CORPUS.find((entry) => entry.name === name);
  if (fixture === undefined) throw new Error(`no fixture named ${name}`);
  return fixture.input;
}

describe('REDACTION_CORPUS', () => {
  it('holds exactly thirty fixtures with unique names', () => {
    expect(REDACTION_CORPUS).toHaveLength(30);
    expect(new Set(REDACTION_CORPUS.map((fixture) => fixture.name)).size).toBe(30);
  });

  it('never lets a planted literal survive, in any depth', () => {
    for (const fixture of REDACTION_CORPUS) {
      const result = serialise(redact(fixture.input));
      for (const secret of fixture.secrets) {
        expect(result, `${fixture.name} leaked ${secret}`).not.toContain(secret);
      }
    }
  });

  it('covers every documented key pattern at least once', () => {
    const corpus = serialise(REDACTION_CORPUS.map((fixture) => fixture.input));
    for (const key of [
      'token',
      'access_token',
      'refreshToken',
      'secret',
      'client_secret',
      'password',
      'apiKey',
      'privateKey',
      'authorization',
      'cookie',
      'set-cookie',
      'private_key_pem',
    ]) {
      expect(corpus, key).toContain(key);
    }
  });
});

describe('redact over the corpus shapes', () => {
  it('renders a date as ISO, an error as its name and message, and binary as a marker', () => {
    expect(serialise(redact(fixtureNamed('date-value')))).toContain('2026-10-25T09:00:00.000Z');
    expect(redact(fixtureNamed('error-value'))).toMatchObject({
      err: { name: 'Error', message: 'boom' },
    });
    expect(serialise(redact(fixtureNamed('binary-value')))).toContain('[binary]');
  });

  it('marks a cycle instead of recursing, and redacts a bigint behind a secret key', () => {
    expect(serialise(redact(fixtureNamed('circular-reference')))).toContain('[circular]');
    expect(serialise(redact(fixtureNamed('cycle-in-array')))).toContain('[circular]');
    expect(redact(fixtureNamed('bigint-value'))).toMatchObject({
      token: REDACTED_PLACEHOLDER,
    });
  });

  it('keeps a non-secret value that shares a fixture with a secret one', () => {
    expect(redact(fixtureNamed('date-value'))).toMatchObject({
      at: '2026-10-25T09:00:00.000Z',
      password: REDACTED_PLACEHOLDER,
    });
    expect(serialise(redact(fixtureNamed('null-prototype-record')))).toContain('kept');
  });

  it('never mutates the fixture it was given', () => {
    for (const fixture of REDACTION_CORPUS) {
      const before = serialise(fixture.input);
      redact(fixture.input);
      expect(serialise(fixture.input), fixture.name).toBe(before);
    }
  });
});
