import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_EXPOSES,
  CREDENTIAL_KINDS,
  credentialExposeSchema,
  credentialKindSchema,
  credentialSummarySchema,
  pageOfCredentialSummary,
  parseCredentialSummary,
} from './index.js';
import type { CredentialExpose, CredentialKind, CredentialSummary } from './index.js';
import { ContractParseError } from './parse.js';

const NOW = '2026-10-24T18:03:11Z';

const summary: CredentialSummary = {
  id: 'cred_01JABCDEFG',
  name: 'GitHub App',
  kind: 'github_app',
  expose: 'daemon',
  configured: true,
  lastFour: 'a91f',
  createdAt: NOW,
  updatedAt: NOW,
  lastUsedAt: null,
};

function parseErrorOf(run: () => unknown): ContractParseError {
  try {
    run();
  } catch (thrown) {
    if (thrown instanceof ContractParseError) return thrown;
    throw thrown;
  }
  throw new Error('expected a ContractParseError');
}

describe('credential summary', () => {
  it('parses a summary and its page', () => {
    expect(parseCredentialSummary(summary)).toEqual(summary);
    expect(pageOfCredentialSummary.parse({ data: [summary], nextCursor: null })).toEqual({
      data: [summary],
      nextCursor: null,
    });
  });

  it('accepts an empty lastFour and a null lastUsedAt', () => {
    const parsed = parseCredentialSummary({ ...summary, lastFour: '', lastUsedAt: null });

    expect(parsed.lastFour).toBe('');
    expect(parsed.lastUsedAt).toBeNull();
  });

  it('refuses an unknown key and a wrong kind on the credential boundary', () => {
    const unknownKey = parseErrorOf(() =>
      parseCredentialSummary({ ...summary, value: 'a-sealed-secret' }),
    );
    expect(unknownKey).toBeInstanceOf(ContractParseError);
    expect(unknownKey.boundary).toBe('credential');
    expect(unknownKey.first.path).toBe('credential.value');

    const wrongKind = parseErrorOf(() => parseCredentialSummary({ ...summary, kind: 'key' }));
    expect(wrongKind.boundary).toBe('credential');
    expect(wrongKind.first.path).toBe('credential.kind');
  });

  it('freezes the vocabularies and re-exports the entry point names', () => {
    expect([...CREDENTIAL_KINDS]).toEqual([
      'api_key',
      'bearer',
      'basic',
      'github_app',
      'model_key',
    ]);
    expect([...CREDENTIAL_EXPOSES]).toEqual(['daemon', 'tool', 'env']);
    expect(credentialKindSchema.safeParse('github_app').success).toBe(true);
    expect(credentialKindSchema.safeParse('key').success).toBe(false);
    expect(credentialExposeSchema.safeParse('daemon').success).toBe(true);
    expect(credentialExposeSchema.safeParse('shell').success).toBe(false);
    expect(credentialSummarySchema.safeParse(summary).success).toBe(true);

    const kind: CredentialKind = 'github_app';
    const expose: CredentialExpose = 'daemon';
    expect([kind, expose]).toEqual(['github_app', 'daemon']);
  });
});
