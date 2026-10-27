import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Health, Version } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ApiError } from '../../core/api/api-client';

@Injectable()
export class AboutStore {
  private readonly api = inject(ApiClient);
  private readonly destroy = inject(DestroyRef);

  readonly version = signal<Version | null>(null);
  readonly health = signal<Health | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  private pending = 0;

  load(): void {
    this.error.set(null);
    this.readVersion();
    this.readHealth();
  }

  reload(): void {
    this.load();
  }

  private readVersion(): void {
    this.begin();
    this.api
      .version()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.settle()),
      )
      .subscribe({
        next: (version) => this.version.set(version),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private readHealth(): void {
    this.begin();
    this.api
      .health()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.settle()),
      )
      .subscribe({
        next: (health) => this.health.set(health),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private begin(): void {
    this.pending += 1;
    this.loading.set(true);
  }

  private settle(): void {
    this.pending -= 1;
    if (this.pending === 0) this.loading.set(false);
  }
}
