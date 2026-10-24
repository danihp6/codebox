import { describe, expect, it } from 'vitest';
import { hashSecret } from './hash.js';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  generatePairingCode,
  normalisePairingCode,
  verifyPairingCode,
  type PendingPairingCode,
} from './pairing.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const TTL_SECONDS = 300;

function pending(hash: string, expiresAt: Date, usedAt: string | null = null): PendingPairingCode {
  return { hash, expiresAt: expiresAt.toISOString(), usedAt };
}

function at(offsetSeconds: number): Date {
  return new Date(NOW.getTime() + offsetSeconds * 1000);
}

describe('pairing codes', () => {
  it('draws ten canonical characters from the injected byte source', () => {
    expect(PAIRING_CODE_LENGTH).toBe(10);
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(generatePairingCode(() => Buffer.alloc(16, 0))).toBe('0000000000');
    expect(
      generatePairingCode(() =>
        Buffer.from([0, 1, 2, 3, 30, 31, 32, 33, 254, 255, 7, 8, 9, 10, 11, 12]),
      ),
    ).toBe('0123YZ01YZ');
  });

  it('only ever produces the documented pattern', () => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      expect(generatePairingCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    }
  });

  it('normalises what a human reads back', () => {
    expect(normalisePairingCode(' ab-cd ef gh jk ')).toBe('ABCDEFGHJK');
    expect(normalisePairingCode('oil')).toBe('011');
    expect(normalisePairingCode('IL0O')).toBe('1100');
    expect(normalisePairingCode('')).toBe('');
  });

  it('a used or expired code never pairs twice', async () => {
    const code = generatePairingCode();
    const hash = await hashSecret(code);
    const fresh = pending(hash, at(TTL_SECONDS));

    await expect(verifyPairingCode({ code, pending: fresh, now: NOW })).resolves.toEqual({
      ok: true,
    });

    const used = pending(hash, at(TTL_SECONDS), at(0).toISOString());
    await expect(verifyPairingCode({ code, pending: used, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'used',
    });

    const expired = pending(hash, at(-1));
    await expect(verifyPairingCode({ code, pending: expired, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });

    await expect(verifyPairingCode({ code, pending: null, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    });

    await expect(
      verifyPairingCode({ code: generatePairingCode(), pending: fresh, now: NOW }),
    ).resolves.toEqual({ ok: false, reason: 'unknown' });
  });

  it('accepts a lower-case code typed with spaces and hyphens', async () => {
    const code = generatePairingCode();
    const hash = await hashSecret(code);
    const printed = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();
    await expect(
      verifyPairingCode({ code: printed, pending: pending(hash, at(TTL_SECONDS)), now: NOW }),
    ).resolves.toEqual({ ok: true });
  });

  it('expires exactly at its expiry instant', async () => {
    const code = generatePairingCode();
    const hash = await hashSecret(code);
    const pendingCode = pending(hash, at(0));
    await expect(verifyPairingCode({ code, pending: pendingCode, now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
    await expect(verifyPairingCode({ code, pending: pendingCode, now: at(-1) })).resolves.toEqual({
      ok: true,
    });
  });
});
