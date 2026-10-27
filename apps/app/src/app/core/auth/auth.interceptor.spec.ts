import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import type { HttpEvent } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityStore } from '../../shared/offline-banner';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';
import { setSignedOutReason, signedOutReason } from './signed-out';

const API_REQUEST = '/v1/runs';

interface AuthStub {
  accessToken: () => string | null;
  refresh: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}

interface RouterStub {
  navigateByUrl: ReturnType<typeof vi.fn>;
}

interface Rig {
  readonly auth: AuthStub;
  readonly router: RouterStub;
  readonly connectivity: ConnectivityStore;
}

function setup(refreshed: boolean): Rig {
  const auth: AuthStub = {
    accessToken: () => 'access-token',
    refresh: vi.fn(() => Promise.resolve(refreshed)),
    logout: vi.fn(() => Promise.resolve()),
  };
  const router: RouterStub = { navigateByUrl: vi.fn(() => Promise.resolve(true)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthStore, useValue: auth },
      { provide: Router, useValue: router },
    ],
  });
  return { auth, router, connectivity: TestBed.inject(ConnectivityStore) };
}

function send(next: (req: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>) {
  const request = new HttpRequest<unknown>('GET', API_REQUEST);
  const stream = TestBed.runInInjectionContext(() => authInterceptor(request, next));
  return firstValueFrom(stream);
}

function unauthorized(): HttpErrorResponse {
  return new HttpErrorResponse({ status: 401, url: API_REQUEST });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('authInterceptor', () => {
  beforeEach(() => {
    setSignedOutReason(null);
  });

  it('leaves the session as session_expired when the refresh fails', async () => {
    const rig = setup(false);
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(send(next)).rejects.toBeInstanceOf(HttpErrorResponse);

    await vi.waitFor(() =>
      expect(rig.router.navigateByUrl).toHaveBeenCalledWith('/pair?reason=session_expired'),
    );
    expect(rig.auth.logout).toHaveBeenCalledTimes(1);
    expect(rig.auth.refresh).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(signedOutReason()).toBe('session_expired');
  });

  it('leaves the session as revoked when the retried request is still a 401', async () => {
    const rig = setup(true);
    const next = vi
      .fn()
      .mockReturnValueOnce(throwError(() => unauthorized()))
      .mockReturnValueOnce(throwError(() => unauthorized()));

    await expect(send(next)).rejects.toBeInstanceOf(HttpErrorResponse);

    await vi.waitFor(() =>
      expect(rig.router.navigateByUrl).toHaveBeenCalledWith('/pair?reason=revoked'),
    );
    expect(rig.auth.logout).toHaveBeenCalledTimes(1);
    expect(rig.auth.refresh).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
    expect(signedOutReason()).toBe('revoked');
  });

  it('navigates nowhere on an error that is not a 401', async () => {
    const rig = setup(true);
    const next = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));

    await expect(send(next)).rejects.toBeInstanceOf(HttpErrorResponse);
    await settle();

    expect(rig.router.navigateByUrl).not.toHaveBeenCalled();
    expect(rig.auth.logout).not.toHaveBeenCalled();
    expect(rig.auth.refresh).not.toHaveBeenCalled();
    expect(signedOutReason()).toBeNull();
  });

  it('marks the cache stale when there is no response and fresh on the next success', async () => {
    const rig = setup(true);
    const offline = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 0 })));

    await expect(send(offline)).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(rig.connectivity.stale()).toBe(true);

    await send(() => of(new HttpResponse<unknown>({ status: 200 })));
    expect(rig.connectivity.stale()).toBe(false);
    await settle();
    expect(rig.router.navigateByUrl).not.toHaveBeenCalled();
  });
});
