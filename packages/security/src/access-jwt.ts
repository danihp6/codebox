import { createPublicKey, verify } from 'node:crypto';

export interface AccessJwk {
  readonly kid: string;
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
}

export interface AccessJwks {
  readonly keys: readonly AccessJwk[];
}

export interface AccessClaims {
  readonly email: string | null;
  readonly aud: readonly string[];
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
}

export type AccessRejection =
  | 'malformed'
  | 'unsupported_alg'
  | 'unknown_kid'
  | 'bad_signature'
  | 'expired'
  | 'wrong_aud'
  | 'wrong_issuer';

export type AccessVerification =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: AccessRejection };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function reject(reason: AccessRejection): AccessVerification {
  return { ok: false, reason };
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifySignature(signingInput: string, signatureText: string, jwk: AccessJwk): boolean {
  if (!BASE64URL.test(signatureText)) return false;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    return verify(
      'RSA-SHA256',
      Buffer.from(signingInput, 'utf8'),
      key,
      Buffer.from(signatureText, 'base64url'),
    );
  } catch {
    return false;
  }
}

function audienceOf(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return null;
  const list: unknown[] = value;
  if (!list.every((entry: unknown) => typeof entry === 'string')) return null;
  return list as string[];
}

export function verifyAccessJwt(input: {
  readonly token: string;
  readonly jwks: AccessJwks;
  readonly aud: string;
  readonly teamDomain: string;
  readonly now: Date;
}): AccessVerification {
  const parts = input.token.split('.');
  if (parts.length !== 3) return reject('malformed');
  const [headerText, payloadText, signatureText] = parts;
  if (headerText === undefined || payloadText === undefined || signatureText === undefined) {
    return reject('malformed');
  }
  const header = decodeJson(headerText);
  if (!isRecord(header)) return reject('malformed');
  if (header.alg !== 'RS256') return reject('unsupported_alg');
  const kid = header.kid;
  if (typeof kid !== 'string') return reject('unknown_kid');
  const jwk = input.jwks.keys.find((candidate) => candidate.kid === kid);
  if (jwk === undefined) return reject('unknown_kid');
  if (!verifySignature(`${headerText}.${payloadText}`, signatureText, jwk)) {
    return reject('bad_signature');
  }
  const payload = decodeJson(payloadText);
  if (!isRecord(payload)) return reject('malformed');
  const { exp, iat, aud, iss, email } = payload;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return reject('malformed');
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return reject('malformed');
  if (exp <= Math.floor(input.now.getTime() / 1000)) return reject('expired');
  const audience = audienceOf(aud);
  if (audience === null || !audience.includes(input.aud)) return reject('wrong_aud');
  if (typeof iss !== 'string' || iss !== `https://${input.teamDomain}`) {
    return reject('wrong_issuer');
  }
  return {
    ok: true,
    claims: { email: typeof email === 'string' ? email : null, aud: audience, iss, iat, exp },
  };
}
