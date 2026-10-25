import { redact } from '@codebox/security';
import type { LogLevel } from '@codebox/contracts';

export const LOG_LEVELS: readonly LogLevel[] = Object.freeze([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
]);

export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
});

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  trace(fields: LogFields): void;
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  readonly sink?: (line: string) => void;
  readonly now?: () => Date;
  readonly base?: LogFields;
  readonly includeStack?: boolean;
}

interface LoggerRuntime {
  readonly threshold: number;
  readonly sink: (line: string) => void;
  readonly now: () => Date;
  readonly includeStack: boolean;
}

const RESERVED_FIELDS: readonly string[] = Object.freeze(['ts', 'level', 'msg']);
const ERROR_FIELDS: readonly string[] = Object.freeze(['err', 'error']);

function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const runtime: LoggerRuntime = {
    threshold: LOG_LEVEL_RANK[options.level],
    sink: options.sink ?? defaultSink,
    now: options.now ?? ((): Date => new Date()),
    includeStack: options.includeStack ?? false,
  };
  return buildLogger(options.base ?? {}, runtime);
}

/** Bootstrap only: a `CB_LOG_LEVEL` that fails validation cannot stop the failure being logged. */
export function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

/**
 * The final string for one record: prepends `ts` (from `now`), keeps `level` then `msg` first,
 * runs the whole object through `redact`, and `JSON.stringify`s it.
 */
export function formatLogLine(record: LogFields, now: Date): string {
  const level = typeof record.level === 'string' ? record.level : 'info';
  const msg = typeof record.msg === 'string' ? record.msg : '';
  const rest = stripReserved(record);
  const ordered: Record<string, unknown> = { ts: now.toISOString(), level, msg, ...rest };
  return String(JSON.stringify(redact(ordered)));
}

function buildLogger(base: LogFields, runtime: LoggerRuntime): Logger {
  const bindings = stripReserved(base);
  const write =
    (level: LogLevel) =>
    (fields: LogFields): void => {
      if (LOG_LEVEL_RANK[level] < runtime.threshold) return;
      const msg = typeof fields.msg === 'string' ? fields.msg : '';
      const call = serialiseErrors(stripReserved(fields), runtime.includeStack);
      runtime.sink(formatLogLine({ level, msg, ...bindings, ...call }, runtime.now()));
    };
  return {
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (extra: LogFields): Logger => buildLogger({ ...bindings, ...extra }, runtime),
  };
}

function stripReserved(fields: LogFields): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_FIELDS.includes(key)) continue;
    copy[key] = value;
  }
  return copy;
}

function serialiseErrors(
  fields: Record<string, unknown>,
  includeStack: boolean,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ERROR_FIELDS.includes(key) || !(value instanceof Error)) {
      copy[key] = value;
      continue;
    }
    copy[key] = includeStack
      ? { name: value.name, message: value.message, stack: value.stack ?? null }
      : { name: value.name, message: value.message };
  }
  return copy;
}
