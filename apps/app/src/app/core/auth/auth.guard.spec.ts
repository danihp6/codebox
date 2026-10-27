import { TestBed } from '@angular/core/testing';
import { UrlTree, provideRouter } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthStore } from './auth.store';
import { setSignedOutReason, signedOutReason } from './signed-out';

const ROUTE = {} as ActivatedRouteSnapshot;
const STATE = {} as RouterStateSnapshot;

interface AuthStub {
  signedIn: () => boolean;
  restore: ReturnType<typeof vi.fn>;
}

function stubAuth(input: { signedIn: boolean; restore: boolean }): AuthStub {
  return {
    signedIn: () => input.signedIn,
    restore: vi.fn(() => Promise.resolve(input.restore)),
  };
}

function runGuard(auth: AuthStub): Promise<unknown> {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthStore, useValue: auth }],
  });
  return TestBed.runInInjectionContext(async () => authGuard(ROUTE, STATE));
}

describe('authGuard', () => {
  beforeEach(() => {
    setSignedOutReason(null);
  });

  it('routes to pairing with the unpaired reason when there is no session', async () => {
    const auth = stubAuth({ signedIn: false, restore: false });

    const result = await runGuard(auth);

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/pair?reason=unpaired');
    expect(signedOutReason()).toBe('unpaired');
    expect(auth.restore).toHaveBeenCalledTimes(1);
  });

  it('lets a signed-in session through without restoring', async () => {
    const auth = stubAuth({ signedIn: true, restore: false });

    await expect(runGuard(auth)).resolves.toBe(true);
    expect(auth.restore).not.toHaveBeenCalled();
    expect(signedOutReason()).toBeNull();
  });

  it('lets a restored session through and records no reason', async () => {
    const auth = stubAuth({ signedIn: false, restore: true });

    await expect(runGuard(auth)).resolves.toBe(true);
    expect(auth.restore).toHaveBeenCalledTimes(1);
    expect(signedOutReason()).toBeNull();
  });
});
