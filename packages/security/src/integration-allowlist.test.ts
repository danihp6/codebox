import { describe, expect, it } from 'vitest';
import { checkIntegrationUrl, hostAllowed } from './integration-allowlist.js';

const ALLOWED = ['api.example.com'];

function rejection(input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly allowedHosts?: readonly string[];
}): string | null {
  const result = checkIntegrationUrl({
    baseUrl: input.baseUrl,
    path: input.path,
    allowedHosts: input.allowedHosts ?? ALLOWED,
  });
  return result.ok ? null : result.reason;
}

describe('integration allowlist', () => {
  it('resolves an https path on an allowed host', () => {
    const result = checkIntegrationUrl({
      baseUrl: 'https://api.example.com',
      path: '/v2/items',
      allowedHosts: ALLOWED,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.toString()).toBe('https://api.example.com/v2/items');
  });

  it('refuses http, an unlisted host, a lookalike, a trailing dot and an IP literal', () => {
    expect(rejection({ baseUrl: 'http://api.example.com', path: '/x' })).toBe('scheme');
    expect(rejection({ baseUrl: 'https://evil-api.example.com', path: '/x' })).toBe('host');
    expect(rejection({ baseUrl: 'https://api.example.com.evil.test', path: '/x' })).toBe('host');
    expect(rejection({ baseUrl: 'https://api.example.com.', path: '/x' })).toBe('host');
    expect(rejection({ baseUrl: 'https://169.254.169.254', path: '/x' })).toBe('host');
    expect(rejection({ baseUrl: 'https://api.example.com', path: 'x' })).toBe('invalid_url');
    expect(rejection({ baseUrl: 'not a url', path: '/x' })).toBe('invalid_url');
  });

  it('refuses a protocol-relative path that resolves to another host', () => {
    expect(rejection({ baseUrl: 'https://api.example.com', path: '//evil.test/x' })).toBe('host');
    expect(rejection({ baseUrl: 'https://api.example.com', path: '/\\evil.test/x' })).toBe('host');
  });

  it('matches the whole host, case-insensitively', () => {
    expect(hostAllowed('API.Example.COM', ALLOWED)).toBe(true);
    expect(hostAllowed('example.com', ALLOWED)).toBe(false);
    expect(hostAllowed('api.example.com.', ALLOWED)).toBe(false);
    expect(hostAllowed('evil-api.example.com', ALLOWED)).toBe(false);
  });
});
