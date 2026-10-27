import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { SIGNED_OUT_PARAM, setSignedOutReason } from './signed-out';

/** `/pair` is the only public route; every other route resolves through this guard. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (auth.signedIn()) return true;
  if (await auth.restore()) return true;
  setSignedOutReason('unpaired');
  return router.createUrlTree(['/pair'], {
    queryParams: { [SIGNED_OUT_PARAM]: 'unpaired' },
  });
};
