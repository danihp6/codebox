import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { notificationPreferencesSchema, quietHoursSchema } from '@codebox/contracts';
import type { NotificationPreferences, SseEventName } from '@codebox/contracts';
import { finalize } from 'rxjs';
import { ApiError } from '../../core/api/api-client';
import type { Locale } from '../../core/i18n/i18n.service';
import { NotificationsApi } from './notifications.api';
import { translate } from './notifications.i18n';

export const NOTIFICATION_EVENTS = [
  'run.finished',
  'run.failed',
  'run.merged',
  'approval.created',
  'routine.fired',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** The one row that has no toggle and is never written to `events`. */
export const LOCKED_NOTIFICATION = 'credential.changed' as const;

export interface NotificationPayload {
  readonly type: NotificationEvent;
  readonly id: string;
  readonly title: string;
}

export type NotificationMirror = 'absent' | 'synced' | 'failed';

const PANEL_EVENTS: ReadonlySet<string> = new Set<string>(NOTIFICATION_EVENTS);

const ID_FIELDS: Readonly<Record<NotificationEvent, string>> = Object.freeze({
  'run.finished': 'runId',
  'run.failed': 'runId',
  'run.merged': 'runId',
  'approval.created': 'approvalId',
  'routine.fired': 'routineId',
});

/**
 * The SSE frame -> display projection. Reads `type` and one id field, writes exactly three
 * keys. Anything else on `data` (prompt, diff, path, payload) is dropped, never spread.
 */
export function buildNotificationPayload(
  frame: { readonly type: string; readonly data: Readonly<Record<string, unknown>> },
  locale: Locale,
): NotificationPayload | null {
  if (!isNotificationEvent(frame.type)) return null;
  const data: unknown = frame.data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as Readonly<Record<string, unknown>>)[ID_FIELDS[frame.type]];
  if (typeof id !== 'string' || id === '') return null;
  return {
    type: frame.type,
    id,
    title: translate(locale, `notifications.title.${frame.type}`),
  };
}

function isNotificationEvent(type: string): type is NotificationEvent {
  return PANEL_EVENTS.has(type);
}

@Injectable()
export class NotificationsStore {
  private readonly api = inject(NotificationsApi);
  private readonly destroy = inject(DestroyRef);

  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  /** `event name` while a toggle is in flight, `'quiet'` while quiet hours are saved. */
  readonly saving = signal<string | null>(null);
  /** Result of mirroring the window to `PATCH /v1/settings`. */
  readonly mirror = signal<NotificationMirror | null>(null);

  load(): void {
    this.error.set(null);
    this.loading.set(true);
    this.api
      .preferences()
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (value) => this.preferences.set(value),
        error: (error: ApiError) => this.error.set(error),
      });
  }

  reload(): void {
    this.mirror.set(null);
    this.load();
  }

  toggle(event: NotificationEvent, enabled: boolean): void {
    const previous = this.preferences();
    if (previous === null || this.saving() !== null) return;
    const next = notificationPreferencesSchema.safeParse({
      events: orderedEvents(previous.events, event, enabled),
      quietHours: previous.quietHours,
    });
    if (!next.success) {
      this.error.set(contractError(next.error.message));
      return;
    }
    this.error.set(null);
    this.preferences.set(next.data);
    this.saving.set(event);
    this.api
      .patchPreferences(next.data)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.release(event)),
      )
      .subscribe({
        next: (saved) => this.preferences.set(saved),
        error: (error: ApiError) => {
          this.preferences.set(previous);
          this.error.set(error);
        },
      });
  }

  saveQuietHours(value: string | null): void {
    const current = this.preferences();
    if (current === null || this.saving() !== null) return;
    const trimmed = value === null ? '' : value.trim();
    const quiet = quietHoursSchema.safeParse(trimmed === '' ? null : trimmed);
    if (!quiet.success) {
      this.error.set(contractError('expected HH:MM-HH:MM or null'));
      return;
    }
    const next = notificationPreferencesSchema.safeParse({
      events: current.events,
      quietHours: quiet.data,
    });
    if (!next.success) {
      this.error.set(contractError(next.error.message));
      return;
    }
    this.error.set(null);
    this.mirror.set(null);
    this.saving.set('quiet');
    this.api
      .patchPreferences(next.data)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (saved) => {
          this.preferences.set(saved);
          this.mirrorQuietHours(quiet.data);
        },
        error: (error: ApiError) => {
          this.release('quiet');
          this.error.set(error);
        },
      });
  }

  /** The daemon reads the window from the preferences; this route is the best-effort mirror. */
  private mirrorQuietHours(value: string | null): void {
    this.api
      .patchQuietHours(value)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.release('quiet')),
      )
      .subscribe({
        next: () => this.mirror.set('synced'),
        error: (error: ApiError) => {
          if (error.status === 404) {
            this.mirror.set('absent');
            return;
          }
          this.mirror.set('failed');
          this.error.set(error);
        },
      });
  }

  private release(key: string): void {
    if (this.saving() === key) this.saving.set(null);
  }
}

function orderedEvents(
  current: readonly SseEventName[],
  event: NotificationEvent,
  enabled: boolean,
): SseEventName[] {
  const wanted = new Set<string>(current);
  wanted.delete(LOCKED_NOTIFICATION);
  if (enabled) wanted.add(event);
  else wanted.delete(event);
  const ordered = NOTIFICATION_EVENTS.filter((name) => wanted.has(name));
  const rest = [...wanted].filter((name): name is SseEventName => !PANEL_EVENTS.has(name));
  return [...ordered, ...rest];
}

function contractError(message: string): ApiError {
  return new ApiError({ message, status: 0, code: 'contract', requestId: null, details: null });
}
