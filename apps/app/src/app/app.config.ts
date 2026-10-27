import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideIonicAngular } from '@ionic/angular';
import { routes } from './app.routes';
import { AuthStore } from './core/auth/auth.store';
import { authInterceptor } from './core/auth/auth.interceptor';

/** Exchanges the stored refresh token before the first navigation, so a deep link is not bounced to `/pair`. */
export function restoreSession(): Promise<boolean> {
  return inject(AuthStore).restore();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideIonicAngular({ mode: 'md' }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideAppInitializer(restoreSession),
    // Angular 22 spells the pinned option `registrationStrategy: 'registerWhenStable:30000'`.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
