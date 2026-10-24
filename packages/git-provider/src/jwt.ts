import { sign } from 'node:crypto';
import { GitProviderError } from './errors.js';

export const APP_JWT_BACKDATE_SECONDS = 60;
export const APP_JWT_TTL_SECONDS = 600;

const KEY_ERROR = 'github private key is unreadable';

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function createAppJwt(input: {
  readonly appId: string;
  readonly privateKeyPem: string;
  readonly issuedAt: number;
}): string {
  const issuedAt = input.issuedAt - APP_JWT_BACKDATE_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + APP_JWT_TTL_SECONDS,
      iss: input.appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  let signature: string;
  try {
    signature = sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), input.privateKeyPem).toString(
      'base64url',
    );
  } catch {
    throw new GitProviderError('validation_failed', KEY_ERROR, null, false);
  }
  return `${signingInput}.${signature}`;
}
