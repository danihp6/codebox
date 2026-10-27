import { DestroyRef, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ChatSession, Schedule, ScheduleDetail } from '@codebox/contracts';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import type { ApiError } from '../../core/api/api-client';
import { ChatApi } from '../chat/chat.api';
import { SchedulesApi } from './schedules.api';

/** The list is a single page; the filter is a read-only surface, not a paged log. */
export const LIST_LIMIT = 100;

/** The detail read is bounded: the tail renders without `nextFires` instead of fanning out. */
export const DETAIL_LIMIT = 20;

export interface ScheduleGroup {
  readonly schedule: Schedule;
  readonly nextFires: readonly string[];
  readonly unreviewed: boolean;
}

const WINDOW_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Half-open [start, end) in the schedule's own IANA zone; a window may wrap midnight. A
 * malformed window (bad bound, bad zone, equal bounds) is closed and never throws.
 */
export function isWindowOpen(
  window: { start: string; end: string; timezone: string },
  nowMs: number,
): boolean {
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === null || end === null || start === end) return false;
  const local = localMinutes(new Date(nowMs), window.timezone);
  if (local === null) return false;
  return start < end ? local >= start && local < end : local >= start || local < end;
}

/** Open windows first, then by `nextFireAt` ascending (null last), then by title. */
export function groupSchedules(
  groups: readonly ScheduleGroup[],
  nowMs: number,
): readonly ScheduleGroup[] {
  return groups
    .map((group, index) => ({
      group,
      index,
      open: scheduleWindowOpen(group.schedule, nowMs),
      fire: fireKey(group.schedule.nextFireAt),
    }))
    .sort((left, right) => {
      if (left.open !== right.open) return left.open ? -1 : 1;
      if (left.fire !== right.fire) return left.fire < right.fire ? -1 : 1;
      const byTitle = left.group.schedule.title.localeCompare(right.group.schedule.title);
      return byTitle !== 0 ? byTitle : left.index - right.index;
    })
    .map((entry) => entry.group);
}

function scheduleWindowOpen(schedule: Schedule, nowMs: number): boolean {
  if (schedule.mode !== 'window' || schedule.windowStart === null || schedule.windowEnd === null) {
    return false;
  }
  return isWindowOpen(
    { start: schedule.windowStart, end: schedule.windowEnd, timezone: schedule.timezone },
    nowMs,
  );
}

function fireKey(nextFireAt: string | null): number {
  if (nextFireAt === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(nextFireAt);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function minutesOf(value: string): number | null {
  const match = WINDOW_TIME.exec(value);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localMinutes(date: Date, timezone: string): number | null {
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === 'hour');
    const minute = parts.find((part) => part.type === 'minute');
    if (hour === undefined || minute === undefined) return null;
    return Number(hour.value) * 60 + Number(minute.value);
  } catch {
    return null;
  }
}

@Injectable()
export class ScheduleFilterStore {
  private readonly api: SchedulesApi;
  private readonly chats: ChatApi;
  private readonly destroy: DestroyRef;

  readonly schedules = signal<readonly Schedule[]>([]);
  readonly groups = signal<readonly ScheduleGroup[]>([]);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  private readonly nextFires = new Map<string, readonly string[]>();
  private readonly unreviewed = new Map<string, boolean>();

  constructor(api: SchedulesApi, chats: ChatApi, destroy: DestroyRef) {
    this.api = api;
    this.chats = chats;
    this.destroy = destroy;
  }

  load(): void {
    this.error.set(null);
    this.loading.set(true);
    this.nextFires.clear();
    this.unreviewed.clear();
    this.api
      .list({ limit: LIST_LIMIT })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (page) => {
          this.schedules.set(page.data);
          this.loading.set(false);
          this.rebuild();
          this.loadDetails(page.data);
          this.loadSessions(page.data);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }

  reload(): void {
    this.load();
  }

  private loadDetails(schedules: readonly Schedule[]): void {
    const visible = schedules.slice(0, DETAIL_LIMIT);
    if (visible.length === 0) return;
    const reads: Observable<ScheduleDetail | null>[] = visible.map((schedule) =>
      this.api.get(schedule.id).pipe(catchError(() => of(null))),
    );
    forkJoin(reads)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((details) => {
        for (const detail of details) {
          if (detail !== null) this.nextFires.set(detail.schedule.id, detail.nextFires);
        }
        this.rebuild();
      });
  }

  /** A schedule that never fired, or that has no session, cannot be "delivered but unreviewed". */
  private loadSessions(schedules: readonly Schedule[]): void {
    const ids = new Set<string>();
    for (const schedule of schedules) {
      if (schedule.lastFiredAt === null || schedule.chatSessionId === null) continue;
      ids.add(schedule.chatSessionId);
    }
    if (ids.size === 0) return;
    const reads: Observable<{ id: string; unreviewed: boolean }>[] = [...ids].map((id) =>
      this.chats.getSession(id).pipe(
        map((session: ChatSession) => ({ id, unreviewed: session.reviewedAt === null })),
        catchError(() => of({ id, unreviewed: false })),
      ),
    );
    forkJoin(reads)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((results) => {
        for (const result of results) this.unreviewed.set(result.id, result.unreviewed);
        this.rebuild();
      });
  }

  private rebuild(): void {
    const groups: ScheduleGroup[] = this.schedules().map((schedule) => {
      const sessionId = schedule.chatSessionId;
      return {
        schedule,
        nextFires: this.nextFires.get(schedule.id) ?? [],
        unreviewed:
          schedule.lastFiredAt !== null &&
          sessionId !== null &&
          this.unreviewed.get(sessionId) === true,
      };
    });
    this.groups.set(groupSchedules(groups, Date.now()));
  }
}
