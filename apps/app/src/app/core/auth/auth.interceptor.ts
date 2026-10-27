import { HttpErrorResponse } from '@angular/common/http';
import type { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, from, switchMap, tap, throwError } from 'rxjs';
import { ConnectivityStore } from '../../shared/offline-banner';
import { API_PREFIX } from '../api/http';
import { AuthStore } from './auth.store';
import { pairUrlFor, setSignedOutReason } from './signed-out';
import type { SignedOutReason } from './signed-out';

const RETRIED_HEADER = 'x-cb-retried';

export function authInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  if (!isApiRequest(req.url)) return next(req);

  const auth = inject(AuthStore);
  const router = inject(Router);
  const connectivity = inject(ConnectivityStore);
  const token = auth.accessToken();
  const authorized =
    token === null ? req : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(authorized).pipe(
    tap(() => connectivity.markFresh()),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 0) {
        connectivity.markStale();
      }
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      if (req.headers.has(RETRIED_HEADER) || isAuthFree(req.url)) {
        return throwError(() => error);
      }
      return from(auth.refresh()).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            void leaveSession(auth, router, 'session_expired');
            return throwError(() => error);
          }
          const fresh = auth.accessToken();
          const replay = req.clone({
            setHeaders: {
              Authorization: `Bearer ${fresh ?? ''}`,
              [RETRIED_HEADER]: '1',
            },
          });
          return next(replay).pipe(
            tap(() => connectivity.markFresh()),
            catchError((second: unknown) => {
              if (second instanceof HttpErrorResponse && second.status === 0) {
                connectivity.markStale();
              }
              if (second instanceof HttpErrorResponse && second.status === 401) {
                void leaveSession(auth, router, 'revoked');
              }
              return throwError(() => second);
            }),
          );
        }),
      );
    }),
  );
}

async function leaveSession(
  auth: AuthStore,
  router: Router,
  reason: SignedOutReason,
): Promise<void> {
  await auth.logout();
  setSignedOutReason(reason);
  await router.navigateByUrl(pairUrlFor(reason));
}

function isApiRequest(url: string): boolean {
  return url.startsWith(`${API_PREFIX}/`);
}

function isAuthFree(url: string): boolean {
  return url.endsWith('/pair') || url.endsWith('/auth/refresh') || url.endsWith('/auth/logout');
}
