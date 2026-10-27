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
  /** The device whose revoke is in flight, so the screen issues one `DELETE` at a time. */
  readonly revokingId = signal<string | null>(null);

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
    if (this.revokingId() !== null) return;
    this.revokingId.set(id);
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
          if (id === this.currentDeviceId()) {
            void this.auth.logout();
            return;
          }
          this.refresh();
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  /** docs/app.md §5: the server is the state, so a revoke is corroborated by a new read. */
  private refresh(): void {
    this.api
      .devices()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => this.devices.set(page.data),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private release(id: string): void {
    if (this.revokingId() === id) this.revokingId.set(null);
  }
}
