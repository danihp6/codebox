export const REDACTED_PLACEHOLDER = '[redacted]';

export const REDACTION_KEY_PATTERNS: readonly string[] = Object.freeze([
  'token',
  'secret',
  'password',
  'key',
  'authorization',
  'cookie',
  'private',
]);

const UNSUPPORTED = '[unsupported]';
const BINARY = '[binary]';
const CIRCULAR = '[circular]';

export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTION_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'bigint') {
    return value;
  }
  if (kind !== 'object') return UNSUPPORTED;
  const object = value as object;
  if (seen.has(object)) return CIRCULAR;
  if (Array.isArray(value)) {
    seen.add(object);
    const copy = value.map((entry) => redactValue(entry, seen));
    seen.delete(object);
    return copy;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value instanceof Uint8Array) return BINARY;
  if (!isPlainObject(object)) return UNSUPPORTED;
  seen.add(object);
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(object as Record<string, unknown>)) {
    copy[key] = isSecretKey(key) ? REDACTED_PLACEHOLDER : redactValue(entry, seen);
  }
  seen.delete(object);
  return copy;
}

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}
