import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIGNED_OUT_REASONS,
  pairUrlFor,
  reasonFromPairUrl,
  setSignedOutReason,
  signedOutReason,
} from './signed-out';

describe('signed-out reasons', () => {
  beforeEach(() => {
    setSignedOutReason(null);
  });

  it('builds the pair URL for every reason code', () => {
    expect(SIGNED_OUT_REASONS.map(pairUrlFor)).toEqual([
      '/pair?reason=unpaired',
      '/pair?reason=session_expired',
      '/pair?reason=revoked',
    ]);
    expect(pairUrlFor('unpaired')).toBe('/pair?reason=unpaired');
    expect(pairUrlFor('session_expired')).toBe('/pair?reason=session_expired');
    expect(pairUrlFor('revoked')).toBe('/pair?reason=revoked');
  });

  it('reads the reason back from a router URL and from a full URL', () => {
    expect(reasonFromPairUrl('/pair?reason=revoked')).toBe('revoked');
    expect(reasonFromPairUrl('/pair?reason=unpaired&from=dashboard')).toBe('unpaired');
    expect(reasonFromPairUrl('https://box.example.test/pair?reason=session_expired')).toBe(
      'session_expired',
    );
  });

  it('returns null for an unknown or a missing reason', () => {
    expect(reasonFromPairUrl('/pair?reason=maybe')).toBeNull();
    expect(reasonFromPairUrl('/pair')).toBeNull();
    expect(reasonFromPairUrl('/pair?reason=')).toBeNull();
  });

  it('keeps the last sign-out reason in one module-level signal', () => {
    expect(signedOutReason()).toBeNull();
    setSignedOutReason('session_expired');
    expect(signedOutReason()).toBe('session_expired');
    setSignedOutReason(null);
    expect(signedOutReason()).toBeNull();
  });
});
