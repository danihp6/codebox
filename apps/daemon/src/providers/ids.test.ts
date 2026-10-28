import { describe, expect, it } from 'vitest';
import { ProviderAccountId } from '@codebox/contracts';
import { newOauthState, newProviderAccountId } from './ids.js';

describe('provider ids', () => {
  it('builds a provider account id the contract accepts', () => {
    const id = newProviderAccountId();
    expect(ProviderAccountId.safeParse(id).success).toBe(true);
    expect(id).toMatch(/^acct_[0-9A-Z]{10}$/);
  });

  it('pins the suffix to the injected bytes', () => {
    expect(newProviderAccountId((size) => Buffer.alloc(size, 0))).toBe('acct_0000000000');
    expect(newProviderAccountId((size) => Buffer.alloc(size, 31))).toBe('acct_ZZZZZZZZZZ');
  });

  it('refuses a short random source', () => {
    expect(() => newProviderAccountId(() => Buffer.alloc(2))).toThrow(RangeError);
  });

  it('builds a 32 character URL-safe oauth state', () => {
    const state = newOauthState();
    expect(state).toHaveLength(32);
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('differs between two calls', () => {
    expect(newOauthState()).not.toBe(newOauthState());
  });

  it('pins the oauth state to the injected bytes', () => {
    expect(newOauthState((size) => Buffer.alloc(size, 0))).toBe('A'.repeat(32));
  });
});
