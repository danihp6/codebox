import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Device } from '@codebox/contracts';
import { finalize } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { SettingsApi } from './settings.api';

@Injectable()
export class DevicesStore {
  private readonly api = inject(SettingsApi);
  private readonly auth = inject(AuthStore);
  private readonly destroy = inject(DestroyRef);

  readonly devices = signal<readonly Device[]>([]);
  readonly currentDeviceId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly revoking = signal<string | null>(null);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .me()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (me) => this.currentDeviceId.set(me.device.id),
        error: (error: ApiError) => this.error.set(error),
      });
    this.api
      .devices()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (page) => this.devices.set(page.data),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  revoke(id: string): void {
    this.revoking.set(id);
    this.error.set(null);
    this.api
      .revokeDevice(id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.release(id)),
      )
      .subscribe({
        next: () => {
          this.devices.update((devices) => devices.filter((device) => device.id !== id));
          if (id === this.currentDeviceId()) void this.auth.logout();
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private release(id: string): void {
    if (this.revoking() === id) this.revoking.set(null);
  }
}
