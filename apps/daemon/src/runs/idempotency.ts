import { IDEMPOTENCY_RETENTION_HOURS, idempotencyKeySchema } from '@codebox/contracts';
import type { Run } from '@codebox/contracts';
import { sha256Hex } from '@codebox/security';
import { RunApiError } from './errors.js';

export const IDEMPOTENCY_MAX_ENTRIES = 1_000;

const SEPARATOR = '\u0000';
const HOUR_MS = 3_600_000;

export type IdempotencyLookup =
  | { readonly kind: 'miss' }
  | { readonly kind: 'replay'; readonly run: Run }
  | { readonly kind: 'mismatch' };

export interface IdempotencyEntry {
  readonly hash: string;
  readonly run: Run;
  readonly storedAt: number;
}

export interface IdempotencyStore {
  lookup(input: {
    readonly deviceId: string;
    readonly key: string;
    readonly hash: string;
    readonly now: Date;
  }): IdempotencyLookup;
  record(input: {
    readonly deviceId: string;
    readonly key: string;
    readonly hash: string;
    readonly run: Run;
    readonly now: Date;
  }): void;
  size(): number;
}

export interface IdempotencyStoreOptions {
  readonly retentionHours?: number;
  readonly maxEntries?: number;
}

/**
 * docs/api.md §4: keys are per device and survive 24 h. `packages/store` has no table for them,
 * so this map is the process lifetime and a restart forgets a replay — a follow-up store task
 * owns the persistent table.
 */
export function createIdempotencyStore(options: IdempotencyStoreOptions = {}): IdempotencyStore {
  const retentionMs = (options.retentionHours ?? IDEMPOTENCY_RETENTION_HOURS) * HOUR_MS;
  const maxEntries = options.maxEntries ?? IDEMPOTENCY_MAX_ENTRIES;
  const entries = new Map<string, IdempotencyEntry>();

  function keyOf(deviceId: string, key: string): string {
    return `${deviceId}${SEPARATOR}${key}`;
  }

  function prune(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (nowMs - entry.storedAt >= retentionMs) entries.delete(key);
    }
  }

  return {
    lookup(input): IdempotencyLookup {
      const nowMs = input.now.getTime();
      prune(nowMs);
      const entry = entries.get(keyOf(input.deviceId, input.key));
      if (entry === undefined) return { kind: 'miss' };
      if (entry.hash !== input.hash) return { kind: 'mismatch' };
      return { kind: 'replay', run: entry.run };
    },

    record(input): void {
      const nowMs = input.now.getTime();
      prune(nowMs);
      const key = keyOf(input.deviceId, input.key);
      if (!entries.has(key) && entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done !== true) entries.delete(oldest.value);
      }
      entries.set(key, { hash: input.hash, run: input.run, storedAt: nowMs });
    },

    size(): number {
      return entries.size;
    },
  };
}

/** Sorted keys, no whitespace: the same body always hashes the same, field order never matters. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(',')}}`;
}

export function requestHash(body: unknown): string {
  return sha256Hex(canonicalJson(body));
}

/** §4 requires the header on `POST /v1/runs`, `POST /v1/jobs/{id}/run` and `promote`. */
export function requireIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header === '') {
    throw new RunApiError('bad_request', 400, { reason: 'idempotency_key_required' });
  }
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw new RunApiError('validation_failed', 422, { path: 'idempotencyKey' });
  }
  return parsed.data;
}

export interface IdempotentRunInput {
  readonly store: IdempotencyStore;
  readonly deviceId: string;
  /** `null` opts the route out: §4 does not require a key on `revert`. */
  readonly key: string | null;
  readonly body: unknown;
  readonly now: Date;
  readonly start: () => Run;
}

/**
 * A replay never starts a second run: it answers the stored one, which is why the route can
 * reply `202` with a row it already owns.
 */
export function idempotentRun(input: IdempotentRunInput): Run {
  if (input.key === null) return input.start();
  const hash = requestHash(input.body);
  const found = input.store.lookup({
    deviceId: input.deviceId,
    key: input.key,
    hash,
    now: input.now,
  });
  if (found.kind === 'replay') return found.run;
  if (found.kind === 'mismatch') {
    throw new RunApiError('idempotency_mismatch', 409, { key: input.key });
  }
  const run = input.start();
  input.store.record({
    deviceId: input.deviceId,
    key: input.key,
    hash,
    run,
    now: input.now,
  });
  return run;
}
