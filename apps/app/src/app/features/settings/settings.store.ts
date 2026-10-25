import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  notificationPreferencesSchema,
  quietHoursSchema,
  timezoneSchema,
} from '@codebox/contracts';
import type {
  Me,
  NotificationPreferences,
  Providers,
  Settings,
  Version,
} from '@codebox/contracts';
import { Observable, finalize } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import { SettingsApi } from './settings.api';

/** The six names `apps/daemon/src/push/mapping.ts` maps to a `NotificationType`. */
export const PREFERENCE_EVENTS = [
  'run.finished',
  'run.failed',
  'run.merged',
  'run.cancelled',
  'approval.created',
  'routine.fired',
] as const;
export type PreferenceEvent = (typeof PREFERENCE_EVENTS)[number];

const READ_COUNT = 5;

@Injectable()
export class SettingsStore {
  private readonly api = inject(SettingsApi);
  private readonly destroy = inject(DestroyRef);
  private remaining = READ_COUNT;

  readonly me = signal<Me | null>(null);
  readonly version = signal<Version | null>(null);
  readonly settings = signal<Settings | null>(null);
  readonly settingsUnavailable = signal(false);
  readonly providers = signal<Providers | null>(null);
  readonly providersUnavailable = signal(false);
  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly brakeAvailable = signal(true);
  readonly cacheWipeAvailable = signal(true);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly saving = signal<string | null>(null);

  load(): void {
    this.error.set(null);
    this.loading.set(true);
    this.settingsUnavailable.set(false);
    this.providersUnavailable.set(false);
    this.remaining = READ_COUNT;

    this.read(this.api.me(), (value) => this.me.set(value));
    this.read(this.api.version(), (value) => this.version.set(value));
    this.read(this.api.settings(), (value) => this.applySettings(value));
    this.read(this.api.providers(), (value) => this.applyProviders(value));
    this.read(this.api.preferences(), (value) => this.preferences.set(value));
  }

  saveTimezone(timezone: string): void {
    const parsed = timezoneSchema.safeParse(timezone);
    if (!parsed.success) {
      this.error.set(contractError('expected an IANA time zone such as Europe/Madrid'));
      return;
    }
    this.error.set(null);
    this.saving.set('timezone');
    this.api
      .patchSettings({ timezone: parsed.data })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.releaseSaving('timezone')),
      )
      .subscribe({
        next: (settings) => this.applySettings(settings),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  setBrake(brakeOn: boolean): void {
    const previous = this.settings();
    if (previous !== null) this.settings.set({ ...previous, automerge: !brakeOn });
    this.error.set(null);
    this.saving.set('brake');
    this.api
      .brake(brakeOn)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.releaseSaving('brake')),
      )
      .subscribe({
        next: (applied) => {
          if (applied) return;
          this.brakeAvailable.set(false);
          this.settings.set(previous);
        },
        error: (error: ApiError) => {
          this.settings.set(previous);
          this.error.set(error);
        },
      });
  }

  wipeCache(): void {
    this.error.set(null);
    this.api
      .wipeCache()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.releaseSaving('cache')),
      )
      .subscribe({
        next: (wiped) => {
          if (wiped) this.saving.set('cache');
          else this.cacheWipeAvailable.set(false);
        },
        error: (error: ApiError) => this.error.set(error),
      });
  }

  togglePreference(event: PreferenceEvent, enabled: boolean): void {
    const current = this.preferences();
    if (current === null) return;
    const events = enabled
      ? [...current.events.filter((name) => name !== event), event]
      : current.events.filter((name) => name !== event);
    const parsed = notificationPreferencesSchema.safeParse({
      events,
      quietHours: current.quietHours,
    });
    if (!parsed.success) {
      this.error.set(contractError(parsed.error.message));
      return;
    }
    this.patchPreferences(current, parsed.data);
  }

  setQuietHours(value: string | null): void {
    const current = this.preferences();
    if (current === null) return;
    const quiet = quietHoursSchema.safeParse(value);
    if (!quiet.success) {
      this.error.set(contractError('expected HH:MM-HH:MM or null'));
      return;
    }
    const parsed = notificationPreferencesSchema.safeParse({
      events: current.events,
      quietHours: quiet.data,
    });
    if (!parsed.success) {
      this.error.set(contractError(parsed.error.message));
      return;
    }
    this.patchPreferences(current, parsed.data);
  }

  private patchPreferences(
    previous: NotificationPreferences,
    next: NotificationPreferences,
  ): void {
    this.error.set(null);
    this.preferences.set(next);
    this.api
      .patchPreferences(next)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (saved) => this.preferences.set(saved),
        error: (error: ApiError) => {
          this.preferences.set(previous);
          this.error.set(error);
        },
      });
  }

  private applySettings(value: Settings | null): void {
    if (value === null) {
      this.settingsUnavailable.set(true);
      return;
    }
    this.settingsUnavailable.set(false);
    this.settings.set(value);
  }

  private applyProviders(value: Providers | null): void {
    if (value === null) {
      this.providersUnavailable.set(true);
      return;
    }
    this.providersUnavailable.set(false);
    this.providers.set(value);
  }

  private read<T>(source: Observable<T>, apply: (value: T) => void): void {
    source
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.settle()),
      )
      .subscribe({
        next: apply,
        error: (error: ApiError) => this.error.set(error),
      });
  }

  private settle(): void {
    this.remaining = Math.max(0, this.remaining - 1);
    if (this.remaining === 0) this.loading.set(false);
  }

  private releaseSaving(key: string): void {
    if (this.saving() === key) this.saving.set(null);
  }
}

function contractError(message: string): ApiError {
  return new ApiError({ message, status: 0, code: 'contract', requestId: null, details: null });
}
