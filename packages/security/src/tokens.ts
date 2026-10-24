import { createHmac, randomBytes } from 'node:crypto';
import type { Scope } from '@codebox/contracts';
import { safeEqual, sha256Hex } from './constant-time.js';

export const ACCESS_TOKEN_PREFIX = 'cb1';

const REFRESH_TOKEN_BYTES = 32;

export interface AccessTokenClaims {
  readonly v: 1;
  readonly sub: string;
  readonly scopes: readonly Scope[];
  readonly iat: number;
  readonly exp: number;
}

export interface MintedAccessToken {
  readonly token: string;
  readonly claims: AccessTokenClaims;
}

export interface IssuedRefreshToken {
  readonly token: string;
  readonly hash: string;
}

export interface IssueRefreshTokenInput {
  readonly bytes?: number;
  readonly secret?: string;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${ACCESS_TOKEN_PREFIX}.${payload}`)
    .digest('base64url');
}

function parseClaims(payload: string): AccessTokenClaims | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;
  const record = decoded as Record<string, unknown>;
  const { v, sub, scopes, iat, exp } = record;
  if (v !== 1) return null;
  if (typeof sub !== 'string' || sub === '') return null;
  if (!Array.isArray(scopes)) return null;
  const scopeList: unknown[] = scopes;
  if (!scopeList.every((scope: unknown) => typeof scope === 'string')) return null;
  if (typeof iat !== 'number' || !Number.isInteger(iat)) return null;
  if (typeof exp !== 'number' || !Number.isInteger(exp)) return null;
  return { v: 1, sub, scopes: scopeList as readonly Scope[], iat, exp };
}

export function mintAccessToken(input: {
  readonly deviceId: string;
  readonly scopes: readonly Scope[];
  readonly secret: string;
  readonly now: Date;
  readonly ttlSeconds: number;
}): MintedAccessToken {
  const iat = Math.floor(input.now.getTime() / 1000);
  const claims: AccessTokenClaims = {
    v: 1,
    sub: input.deviceId,
    scopes: [...input.scopes],
    iat,
    exp: iat + input.ttlSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { token: `${ACCESS_TOKEN_PREFIX}.${payload}.${sign(payload, input.secret)}`, claims };
}

export function verifyAccessToken(input: {
  readonly token: string;
  readonly secret: string;
  readonly now: Date;
}): AccessTokenClaims | null {
  const parts = input.token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, payload, signature] = parts;
  if (prefix !== ACCESS_TOKEN_PREFIX || payload === undefined || signature === undefined) {
    return null;
  }
  if (!safeEqual(sign(payload, input.secret), signature)) return null;
  const claims = parseClaims(payload);
  if (claims === null) return null;
  if (claims.exp <= Math.floor(input.now.getTime() / 1000)) return null;
  return claims;
}

export function issueRefreshToken(input: IssueRefreshTokenInput = {}): IssuedRefreshToken {
  const token = randomBytes(input.bytes ?? REFRESH_TOKEN_BYTES).toString('base64url');
  const hash =
    input.secret === undefined ? sha256Hex(token) : hashRefreshToken(token, input.secret);
  return { token, hash };
}

export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function hasScope(granted: readonly Scope[], required: Scope): boolean {
  return granted.includes(required);
}

export function authorizeDevice(input: {
  readonly device: { readonly scopes: readonly Scope[]; readonly revokedAt: string | null };
  readonly required: Scope;
  readonly now: Date;
}): boolean {
  return input.device.revokedAt === null && hasScope(input.device.scopes, input.required);
}
