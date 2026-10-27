import { signal } from '@angular/core';
import type { Signal } from '@angular/core';

export const SIGNED_OUT_REASONS = ['unpaired', 'session_expired', 'revoked'] as const;

export type SignedOutReason = (typeof SIGNED_OUT_REASONS)[number];

/** `/pair?reason=…` uses this query key. */
export const SIGNED_OUT_PARAM = 'reason';

const signedOutReasonState = signal<SignedOutReason | null>(null);

/** The reason of the last automatic sign-out, or null after a successful pair. */
export const signedOutReason: Signal<SignedOutReason | null> = signedOutReasonState.asReadonly();

export function setSignedOutReason(reason: SignedOutReason | null): void {
  signedOutReasonState.set(reason);
}

export function pairUrlFor(reason: SignedOutReason): string {
  return `/pair?${SIGNED_OUT_PARAM}=${reason}`;
}

export function reasonFromPairUrl(url: string): SignedOutReason | null {
  const value = new URL(url, 'http://codebox.local').searchParams.get(SIGNED_OUT_PARAM);
  return value !== null && isSignedOutReason(value) ? value : null;
}

function isSignedOutReason(value: string): value is SignedOutReason {
  return (SIGNED_OUT_REASONS as readonly string[]).includes(value);
}
