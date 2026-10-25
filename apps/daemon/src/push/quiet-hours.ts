export interface QuietHoursInput {
  readonly now: Date;
  readonly quietHours: string | null;
  readonly timeZone: string;
}

const WINDOW = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

/**
 * Half-open `[start, end)` on the wall clock of `timeZone`. Local time comes from
 * `Intl.DateTimeFormat` so a DST change neither shifts the window nor produces a gap; unusable
 * input is never quiet, because the daemon must still deliver.
 */
export function inQuietHours(input: QuietHoursInput): boolean {
  if (input.quietHours === null) return false;
  const window = WINDOW.exec(input.quietHours);
  if (window === null) return false;
  const start = minutesOf(window[1], window[2]);
  const end = minutesOf(window[3], window[4]);
  if (start === null || end === null || start === end) return false;
  const current = localMinuteOf(input.now, input.timeZone);
  if (current === null) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function minutesOf(hour: string | undefined, minute: string | undefined): number | null {
  if (hour === undefined || minute === undefined) return null;
  return Number(hour) * 60 + Number(minute);
}

function localMinuteOf(now: Date, timeZone: string): number | null {
  if (Number.isNaN(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now);
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    const parsed = minutesOf(hour, minute);
    if (parsed === null || parsed < 0 || parsed >= MINUTES_PER_DAY) return null;
    return parsed;
  } catch {
    return null;
  }
}
