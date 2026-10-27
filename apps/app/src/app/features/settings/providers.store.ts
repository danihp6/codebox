import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Providers } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { SettingsApi } from './settings.api';

/** One row of `GET /v1/providers`, derived from the contract, never hand-written. */
export type ProviderStatus = Providers['providers'][number];

/** docs/api.md §5.1: a route this build does not ship is unavailable, not an empty list. */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set<number>([404, 503]);

@Injectable()
export class ProvidersStore {
  private readonly api = inject(SettingsApi);
  private readonly destroy = inject(DestroyRef);

  readonly providers = signal<readonly ProviderStatus[]>([]);
  readonly unavailable = signal(false);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  load(): void {
    this.error.set(null);
    this.unavailable.set(false);
    this.loading.set(true);
    this.api
      .providers()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (value) => this.apply(value),
        error: (error: ApiError) => this.fail(error),
      });
  }

  private apply(value: Providers | null): void {
    if (value === null) {
      this.markUnavailable();
      return;
    }
    this.providers.set(value.providers);
  }

  private fail(error: ApiError): void {
    if (UNAVAILABLE_STATUSES.has(error.status)) {
      this.markUnavailable();
      return;
    }
    this.error.set(error);
  }

  private markUnavailable(): void {
    this.providers.set([]);
    this.unavailable.set(true);
  }
}
