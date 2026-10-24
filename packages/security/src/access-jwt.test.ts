import { generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAccessJwt } from './access-jwt.js';
import type { AccessJwk, AccessJwks } from './access-jwt.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const TEAM_DOMAIN = 'codebox.cloudflareaccess.com';
const AUD = 'aud-tag-value';
const KID = 'kid-1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwkOf(key: KeyObject, kid: string): AccessJwk {
  const exported = key.export({ format: 'jwk' }) as { n?: string; e?: string };
  return { kid, kty: 'RSA', n: exported.n ?? '', e: exported.e ?? '', alg: 'RS256' };
}

const JWKS: AccessJwks = { keys: [jwkOf(publicKey, KID)] };

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: KeyObject = privateKey,
): string {
  const head = encode(header);
  const body = encode(payload);
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`, 'utf8'), key).toString(
    'base64url',
  );
  return `${head}.${body}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: 'owner@example.com',
    aud: AUD,
    iss: `https://${TEAM_DOMAIN}`,
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 60,
    ...overrides,
  };
}

function verify(token: string): ReturnType<typeof verifyAccessJwt> {
  return verifyAccessJwt({ token, jwks: JWKS, aud: AUD, teamDomain: TEAM_DOMAIN, now: NOW });
}

function header(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { alg: 'RS256', kid: KID, typ: 'JWT', ...overrides };
}

describe('Cloudflare Access JWTs', () => {
  it('Access JWT verification rejects a wrong aud, an expired token and an unsigned token', () => {
    const valid = signToken(header(), claims());
    expect(verify(valid)).toEqual({
      ok: true,
      claims: {
        email: 'owner@example.com',
        aud: [AUD],
        iss: `https://${TEAM_DOMAIN}`,
        iat: NOW_SECONDS - 10,
        exp: NOW_SECONDS + 60,
      },
    });

    expect(verify(signToken(header(), claims({ aud: 'another-audience' })))).toEqual({
      ok: false,
      reason: 'wrong_aud',
    });

    const expired = signToken(header(), claims({ exp: NOW_SECONDS - 1 }));
    expect(verify(expired)).toEqual({ ok: false, reason: 'expired' });

    const unsigned = `${encode({ alg: 'none', kid: KID })}.${encode(claims())}.`;
    expect(verify(unsigned)).toEqual({ ok: false, reason: 'unsupported_alg' });

    const [head, body, signature] = valid.split('.');
    const flippedBody = `${(body ?? '').slice(0, 10)}${(body ?? '').charAt(10) === 'A' ? 'B' : 'A'}${(body ?? '').slice(11)}`;
    const flipped = `${head}.${flippedBody}.${signature}`;
    expect(verify(flipped)).toEqual({ ok: false, reason: 'bad_signature' });

    const otherKid = signToken(header({ kid: 'kid-2' }), claims());
    expect(verify(otherKid)).toEqual({ ok: false, reason: 'unknown_kid' });
  });

  it('accepts an audience array and an absent email', () => {
    const token = signToken(header(), claims({ aud: ['other', AUD], email: 42 }));
    expect(verify(token)).toEqual({
      ok: true,
      claims: {
        email: null,
        aud: ['other', AUD],
        iss: `https://${TEAM_DOMAIN}`,
        iat: NOW_SECONDS - 10,
        exp: NOW_SECONDS + 60,
      },
    });
  });

  it('rejects a wrong issuer, a bad signature key and an expired-at-instant token', () => {
    expect(verify(signToken(header(), claims({ iss: 'https://evil.example.com' })))).toEqual({
      ok: false,
      reason: 'wrong_issuer',
    });

    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const foreign = signToken(header(), claims(), stranger.privateKey);
    expect(verify(foreign)).toEqual({ ok: false, reason: 'bad_signature' });

    expect(verify(signToken(header(), claims({ exp: NOW_SECONDS })))).toEqual({
      ok: false,
      reason: 'expired',
    });

    expect(verify(signToken(header(), claims({ iat: 'yesterday' })))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a malformed token before anything else', () => {
    for (const token of ['', 'one', 'one.two', 'one.two.three.four']) {
      const result = verify(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('malformed');
    }
    const notJson = `${Buffer.from('not json', 'utf8').toString('base64url')}.e30.sig`;
    expect(verify(notJson)).toEqual({ ok: false, reason: 'malformed' });
    const noAlg = `${encode({ typ: 'JWT' })}.${encode(claims())}.sig`;
    expect(verify(noAlg)).toEqual({ ok: false, reason: 'unsupported_alg' });
    const noKid = signToken({ alg: 'RS256' }, claims());
    expect(verify(noKid)).toEqual({ ok: false, reason: 'unknown_kid' });
  });
});
