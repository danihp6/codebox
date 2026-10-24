import type { ScheduleFields, ScheduleValidation, SchedulerDeps } from './types.js';

function formatInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function validateSchedule(
  deps: SchedulerDeps,
  fields: ScheduleFields,
  after: string,
): ScheduleValidation {
  const parsed = deps.cron.parse(fields.cron);
  if (!parsed.ok) {
    return { ok: false, field: 'cron', code: parsed.code, message: parsed.message };
  }
  if (!deps.cron.isValidTimezone(fields.timezone)) {
    return {
      ok: false,
      field: 'timezone',
      code: 'timezone',
      message: `"${fields.timezone}" is not a known IANA timezone.`,
    };
  }
  const next = deps.cron.nextFire(parsed.cron, fields.timezone, new Date(after));
  if (next === null) {
    return {
      ok: false,
      field: 'cron',
      code: 'no_fire',
      message: `"${fields.cron}" never fires in ${fields.timezone}.`,
    };
  }
  return { ok: true, nextFireAt: formatInstant(next) };
}
