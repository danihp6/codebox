import { randomBytes } from 'node:crypto';
import { verifySecret } from './hash.js';

export const PAIRING_CODE_LENGTH = 10;

export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface PendingPairingCode {
  readonly hash: string;
  readonly expiresAt: string;
  readonly usedAt: string | null;
}

export type PairingRejection = 'unknown' | 'expired' | 'used';

export type PairingVerification =
  { readonly ok: true } | { readonly ok: false; readonly reason: PairingRejection };

// A well-formed scrypt hash nobody knows the plaintext of: verifying against it costs the
// same as a real check, so an unknown code cannot be told apart from a wrong one by timing.
const DUMMY_HASH =
  'scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function generatePairingCode(random: (bytes: number) => Buffer = randomBytes): string {
  const bytes = random(16);
  if (bytes.length < PAIRING_CODE_LENGTH) {
    throw new RangeError('the random source returned fewer than 10 bytes');
  }
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    const byte = bytes[index] ?? 0;
    code += PAIRING_CODE_ALPHABET.charAt(byte & 31);
  }
  return code;
}

export function normalisePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

export async function verifyPairingCode(input: {
  readonly code: string;
  readonly pending: PendingPairingCode | null;
  readonly now: Date;
}): Promise<PairingVerification> {
  const code = normalisePairingCode(input.code);
  if (input.pending === null) {
    await verifySecret(code, DUMMY_HASH);
    return { ok: false, reason: 'unknown' };
  }
  if (input.pending.usedAt !== null) return { ok: false, reason: 'used' };
  if (Date.parse(input.pending.expiresAt) <= input.now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  const matches = await verifySecret(code, input.pending.hash);
  return matches ? { ok: true } : { ok: false, reason: 'unknown' };
}
