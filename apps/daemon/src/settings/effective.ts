import { parseNotificationPreferences, parseSettings, timezoneSchema } from '@codebox/contracts';
import type { Settings } from '@codebox/contracts';
import type { DaemonContext } from '../modules.js';
import { NOTIFICATION_PREFERENCES_KEY } from '../push/storage.js';

const AUTOMERGE_KEY = 'automerge';
const TIMEZONE_KEY = 'timezone';

function storedBoolean(context: DaemonContext, key: string): boolean | null {
  try {
    const value = context.store.settings.get(key);
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

/** The boot default is the floor: a stored switch only overrides it when it is a boolean. */
export function effectiveAutomerge(context: DaemonContext): 'on' | 'off' {
  const stored = storedBoolean(context, AUTOMERGE_KEY);
  const enabled = stored ?? context.config.CB_AUTOMERGE === 'on';
  return enabled ? 'on' : 'off';
}

function effectiveTimezone(context: DaemonContext): string {
  try {
    const parsed = timezoneSchema.safeParse(context.store.settings.get(TIMEZONE_KEY));
    return parsed.success ? parsed.data : context.config.CB_TIMEZONE;
  } catch {
    return context.config.CB_TIMEZONE;
  }
}

/** Quiet hours have one owner, the push preferences row; this is a read, never a second write. */
function effectiveQuietHours(context: DaemonContext): string | null {
  try {
    const value = context.store.settings.get(NOTIFICATION_PREFERENCES_KEY);
    if (value === undefined) return null;
    return parseNotificationPreferences(value).quietHours;
  } catch {
    return null;
  }
}

/** The settings the daemon serves and the run engine honours right now. */
export function effectiveSettings(context: DaemonContext): Settings {
  const config = context.config;
  return parseSettings({
    automerge: effectiveAutomerge(context) === 'on',
    mergeMethod: config.CB_MERGE_METHOD,
    maxConcurrency: config.CB_MAX_CONCURRENCY,
    dailyCostUsd: config.CB_DAILY_COST_USD,
    protectedPaths: [...config.CB_PROTECTED_PATHS],
    diffMaxFiles: config.CB_DIFF_MAX_FILES,
    diffMaxLines: config.CB_DIFF_MAX_LINES,
    timezone: effectiveTimezone(context),
    quietHours: effectiveQuietHours(context),
  });
}
