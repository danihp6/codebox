import { HttpErrorResponse } from '@angular/common/http';
import type { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { API_PREFIX } from '../api/http';
import { AuthStore } from './auth.store';

const RETRIED_HEADER = 'x-cb-retried';

export function authInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  if (!isApiRequest(req.url)) return next(req);

  const auth = inject(AuthStore);
  const router = inject(Router);
  const token = auth.accessToken();
  const authorized =
    token === null ? req : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      if (req.headers.has(RETRIED_HEADER) || isAuthFree(req.url)) {
        return throwError(() => error);
      }
      return from(auth.refresh()).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            void leaveSession(auth, router);
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
            catchError((second: unknown) => {
              if (second instanceof HttpErrorResponse && second.status === 401) {
                void leaveSession(auth, router);
              }
              return throwError(() => second);
            }),
          );
        }),
      );
    }),
  );
}

async function leaveSession(auth: AuthStore, router: Router): Promise<void> {
  await auth.logout();
  await router.navigateByUrl('/pair');
}

function isApiRequest(url: string): boolean {
  return url.startsWith(`${API_PREFIX}/`);
}

function isAuthFree(url: string): boolean {
  return (
    url.endsWith('/pair') || url.endsWith('/auth/refresh') || url.endsWith('/auth/logout')
  );
}
