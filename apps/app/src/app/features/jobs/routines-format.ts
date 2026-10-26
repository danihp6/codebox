import type { Routine } from '@codebox/contracts';
import { summarise } from './cron';
import { formatFire } from './time-format';

export function routineSchedule(routine: Routine, locale: 'en' | 'es'): string {
  return `${summarise(routine.cron, locale)} · ${routine.timezone}`;
}

export function routineNextFire(routine: Routine, locale: 'en' | 'es'): string | null {
  if (routine.nextFireAt === null) return null;
  return formatFire(routine.nextFireAt, routine.timezone, locale);
}

export function routineLastFire(routine: Routine, locale: 'en' | 'es'): string | null {
  if (routine.lastFiredAt === null) return null;
  return formatFire(routine.lastFiredAt, routine.timezone, locale);
}
