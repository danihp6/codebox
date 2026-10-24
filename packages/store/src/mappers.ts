import type { Approval, ChatMessage, ChatSession, Job, Repo, Run } from '@codebox/contracts';
import type { Device, RunState, SseEventName } from '@codebox/contracts';
import type { SQLOutputValue } from 'node:sqlite';
import type { DeviceRecord } from './devices.js';
import type { EventRecord } from './events.js';
import { StoreError } from './errors.js';
import type { RunRecord } from './runs.js';
import type { UsageRecord } from './usage.js';

// The contract enums are re-declared here because @codebox/contracts is imported type-only:
// a value import would need packages/contracts/dist, which does not exist during npm test.
const RUN_STATES = [
  'queued',
  'preparing',
  'running',
  'gating',
  'pr_open',
  'merging',
  'succeeded',
  'failed',
  'cancelled',
] as const;
const RUN_TRIGGERS = ['schedule', 'manual', 'promote', 'revert', 'retry'] as const;
const RUN_MODES = ['work'] as const;
const REPO_POLICIES = ['auto', 'manual'] as const;
const RUN_STATE_LIVE = ['queued', 'preparing', 'running', 'gating', 'pr_open', 'merging'] as const;
const APPROVAL_STATES = ['pending', 'allowed', 'denied', 'expired'] as const;
const CHAT_STATUSES = ['idle', 'working', 'archived'] as const;
const CHAT_ROLES = ['user', 'assistant', 'system'] as const;
const DEVICE_PLATFORMS = ['ios', 'android', 'web', 'cli'] as const;
const SCOPES = ['read', 'chat', 'runs', 'write', 'admin'] as const;
const GATE_STATUSES = ['passed', 'failed', 'skipped'] as const;
const GUARDRAIL_IDS = [
  'gate',
  'checks',
  'base',
  'diff',
  'protected_paths',
  'labels',
  'policy',
  'automerger',
] as const;
const GUARDRAIL_STATES = ['pass', 'fail', 'skip'] as const;
const BLOCKER_CODES = [
  'base_moved',
  'protected_path',
  'diff_budget',
  'checks_red',
  'label_do_not_merge',
  'policy_manual',
  'automerger_off',
  'gate_failed',
  'not_mergeable',
] as const;
const SSE_EVENT_NAMES = [
  'run.queued',
  'run.started',
  'run.output',
  'run.tool',
  'run.permission',
  'run.gate',
  'run.pr',
  'run.merged',
  'run.finished',
  'run.failed',
  'run.cancelled',
  'chat.delta',
  'chat.message',
  'chat.tool',
  'chat.permission',
  'chat.idle',
  'job.changed',
  'approval.created',
  'approval.resolved',
  'telemetry',
] as const;

export type Row = Record<string, unknown>;

export const LIVE_RUN_STATES_SQL = RUN_STATE_LIVE.map((state) => `'${state}'`).join(', ');

export function row(value: Record<string, SQLOutputValue> | undefined): Row {
  if (value === undefined) throw new StoreError('invalid_row', 'row not found');
  return value;
}

function invalidColumn(column: string): StoreError {
  return new StoreError('invalid_row', `invalid column ${column}`);
}

export function textColumn(rowValue: Row, column: string): string {
  const value = rowValue[column];
  if (typeof value !== 'string') throw invalidColumn(column);
  return value;
}

export function nullableTextColumn(rowValue: Row, column: string): string | null {
  const value = rowValue[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw invalidColumn(column);
  return value;
}

export function integerColumn(rowValue: Row, column: string): number {
  const value = rowValue[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidColumn(column);
  return value;
}

export function nullableIntegerColumn(rowValue: Row, column: string): number | null {
  const value = rowValue[column];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidColumn(column);
  return value;
}

export function realColumn(rowValue: Row, column: string): number {
  const value = rowValue[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidColumn(column);
  return value;
}

export function booleanColumn(rowValue: Row, column: string): boolean {
  const value = integerColumn(rowValue, column);
  if (value !== 0 && value !== 1) throw invalidColumn(column);
  return value === 1;
}

export function enumColumn<T extends string>(
  rowValue: Row,
  column: string,
  allowed: readonly T[],
): T {
  const value = textColumn(rowValue, column);
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw invalidColumn(column);
  return found;
}

export function nullableEnumColumn<T extends string>(
  rowValue: Row,
  column: string,
  allowed: readonly T[],
): T | null {
  const value = nullableTextColumn(rowValue, column);
  if (value === null) return null;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw invalidColumn(column);
  return found;
}

export function booleanToInteger(value: boolean): number {
  return value ? 1 : 0;
}

export function jsonText(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new StoreError('invalid_row', 'value is not serialisable');
  return text;
}

function parseJson(rowValue: Row, column: string): unknown {
  const value = textColumn(rowValue, column);
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    throw invalidColumn(column);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function jsonObjectColumn(rowValue: Row, column: string): Record<string, unknown> {
  const parsed = parseJson(rowValue, column);
  if (!isRecord(parsed)) throw invalidColumn(column);
  return parsed;
}

function jsonArrayColumn(rowValue: Row, column: string): unknown[] {
  const parsed = parseJson(rowValue, column);
  if (!Array.isArray(parsed)) throw invalidColumn(column);
  return parsed;
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== 'string') throw invalidColumn(column);
  return value;
}

function optionalString(value: unknown, column: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, column);
}

function stringArrayColumn(rowValue: Row, column: string): string[] {
  return jsonArrayColumn(rowValue, column).map((value) => requiredString(value, column));
}

function guardrailOf(value: unknown, column: string): Run['guardrails'][number] {
  if (!isRecord(value)) throw invalidColumn(column);
  const id = GUARDRAIL_IDS.find((candidate) => candidate === value['id']);
  const state = GUARDRAIL_STATES.find((candidate) => candidate === value['state']);
  if (id === undefined || state === undefined) throw invalidColumn(column);
  const reason = optionalString(value['reason'], column);
  return reason === undefined ? { id, state } : { id, state, reason };
}

function blockerOf(value: unknown, column: string): Run['blockers'][number] {
  if (!isRecord(value)) throw invalidColumn(column);
  const code = BLOCKER_CODES.find((candidate) => candidate === value['code']);
  if (code === undefined) throw invalidColumn(column);
  return { code, message: requiredString(value['message'], column) };
}

function guardrailsColumn(rowValue: Row, column: string): Run['guardrails'] {
  return jsonArrayColumn(rowValue, column).map((value) => guardrailOf(value, column));
}

function blockersColumn(rowValue: Row, column: string): Run['blockers'] {
  return jsonArrayColumn(rowValue, column).map((value) => blockerOf(value, column));
}

function prColumn(rowValue: Row): Run['pr'] {
  const number = nullableIntegerColumn(rowValue, 'pr_number');
  const url = nullableTextColumn(rowValue, 'pr_url');
  if (number === null || url === null) return null;
  return { number, url, mergeable: nullableIntegerColumn(rowValue, 'pr_mergeable') === 1 };
}

function gateColumn(rowValue: Row): Run['gate'] {
  const status = nullableEnumColumn(rowValue, 'gate_status', GATE_STATUSES);
  if (status === null) return null;
  const exitCode = nullableIntegerColumn(rowValue, 'gate_exit_code');
  const durationMs = nullableIntegerColumn(rowValue, 'gate_duration_ms');
  if (exitCode === null) throw invalidColumn('gate_exit_code');
  if (durationMs === null) throw invalidColumn('gate_duration_ms');
  return { status, exitCode, durationMs };
}

function diffColumn(rowValue: Row): Run['diff'] {
  const files = nullableIntegerColumn(rowValue, 'diff_files');
  const added = nullableIntegerColumn(rowValue, 'diff_added');
  const removed = nullableIntegerColumn(rowValue, 'diff_removed');
  if (files === null || added === null || removed === null) return null;
  return { files, added, removed };
}

export function repoFromRow(rowValue: Row): Repo {
  return {
    id: textColumn(rowValue, 'id'),
    slug: textColumn(rowValue, 'slug'),
    defaultBranch: textColumn(rowValue, 'default_branch'),
    gate: textColumn(rowValue, 'gate'),
    policy: enumColumn(rowValue, 'policy', REPO_POLICIES),
    protectedPaths: stringArrayColumn(rowValue, 'protected_paths'),
    enabled: booleanColumn(rowValue, 'enabled'),
    createdAt: textColumn(rowValue, 'created_at'),
  };
}

export function jobFromRow(rowValue: Row): Job {
  return {
    id: textColumn(rowValue, 'id'),
    repoId: textColumn(rowValue, 'repo_id'),
    title: textColumn(rowValue, 'title'),
    prompt: textColumn(rowValue, 'prompt'),
    mode: enumColumn(rowValue, 'mode', RUN_MODES),
    agent: textColumn(rowValue, 'agent'),
    model: nullableTextColumn(rowValue, 'model'),
    cron: textColumn(rowValue, 'cron'),
    timezone: textColumn(rowValue, 'timezone'),
    enabled: booleanColumn(rowValue, 'enabled'),
    policy: enumColumn(rowValue, 'policy', REPO_POLICIES),
    createdAt: textColumn(rowValue, 'created_at'),
    nextFireAt: nullableTextColumn(rowValue, 'next_fire_at'),
  };
}

export function runRecordFromRow(rowValue: Row): RunRecord {
  return {
    id: textColumn(rowValue, 'id'),
    repoId: textColumn(rowValue, 'repo_id'),
    jobId: nullableTextColumn(rowValue, 'job_id'),
    state: enumColumn<RunState>(rowValue, 'state', RUN_STATES),
    trigger: enumColumn(rowValue, 'trigger', RUN_TRIGGERS),
    branch: textColumn(rowValue, 'branch'),
    baseRef: textColumn(rowValue, 'base_ref'),
    pr: prColumn(rowValue),
    gate: gateColumn(rowValue),
    guardrails: guardrailsColumn(rowValue, 'guardrails'),
    blockers: blockersColumn(rowValue, 'blockers'),
    diff: diffColumn(rowValue),
    cost: {
      usd: realColumn(rowValue, 'cost_usd'),
      tokensIn: integerColumn(rowValue, 'tokens_in'),
      tokensOut: integerColumn(rowValue, 'tokens_out'),
    },
    createdAt: textColumn(rowValue, 'created_at'),
    finishedAt: nullableTextColumn(rowValue, 'finished_at'),
    baseSha: nullableTextColumn(rowValue, 'base_sha'),
    worktree: nullableTextColumn(rowValue, 'worktree'),
    sessionId: nullableTextColumn(rowValue, 'session_id'),
    prompt: textColumn(rowValue, 'prompt'),
    promptHash: nullableTextColumn(rowValue, 'prompt_hash'),
    agent: textColumn(rowValue, 'agent'),
    model: nullableTextColumn(rowValue, 'model'),
    gateCommand: nullableTextColumn(rowValue, 'gate_command'),
    scheduledFor: nullableTextColumn(rowValue, 'scheduled_for'),
    attempt: integerColumn(rowValue, 'attempt'),
    failureCode: nullableTextColumn(rowValue, 'failure_code'),
    failureMessage: nullableTextColumn(rowValue, 'failure_message'),
    startedAt: nullableTextColumn(rowValue, 'started_at'),
  };
}

export function eventFromRow(rowValue: Row): EventRecord {
  return {
    id: integerColumn(rowValue, 'id'),
    runId: nullableTextColumn(rowValue, 'run_id'),
    chatId: nullableTextColumn(rowValue, 'chat_id'),
    seq: nullableIntegerColumn(rowValue, 'seq'),
    type: enumColumn<SseEventName>(rowValue, 'type', SSE_EVENT_NAMES),
    data: jsonObjectColumn(rowValue, 'payload'),
    ts: textColumn(rowValue, 'ts'),
  };
}

export function approvalFromRow(rowValue: Row): Approval {
  return {
    id: textColumn(rowValue, 'id'),
    state: enumColumn(rowValue, 'state', APPROVAL_STATES),
    tool: textColumn(rowValue, 'tool'),
    title: textColumn(rowValue, 'title'),
    runId: nullableTextColumn(rowValue, 'run_id'),
    chatId: nullableTextColumn(rowValue, 'chat_id'),
    input: jsonObjectColumn(rowValue, 'input'),
    createdAt: textColumn(rowValue, 'created_at'),
    expiresAt: textColumn(rowValue, 'expires_at'),
    resolvedAt: nullableTextColumn(rowValue, 'resolved_at'),
  };
}

export function chatMessageFromRow(rowValue: Row): ChatMessage {
  return {
    id: textColumn(rowValue, 'id'),
    chatId: textColumn(rowValue, 'chat_id'),
    role: enumColumn(rowValue, 'role', CHAT_ROLES),
    text: textColumn(rowValue, 'text'),
    createdAt: textColumn(rowValue, 'created_at'),
  };
}

export function chatSessionFromRow(rowValue: Row, lastMessage: ChatMessage | null): ChatSession {
  return {
    id: textColumn(rowValue, 'id'),
    repoId: textColumn(rowValue, 'repo_id'),
    title: textColumn(rowValue, 'title'),
    status: enumColumn(rowValue, 'status', CHAT_STATUSES),
    createdAt: textColumn(rowValue, 'created_at'),
    updatedAt: textColumn(rowValue, 'updated_at'),
    lastMessage,
  };
}

function scopesColumn(rowValue: Row, column: string): Device['scopes'] {
  return jsonArrayColumn(rowValue, column).map((value) => {
    const scope = SCOPES.find((candidate) => candidate === requiredString(value, column));
    if (scope === undefined) throw invalidColumn(column);
    return scope;
  });
}

export function deviceRecordFromRow(rowValue: Row): DeviceRecord {
  return {
    id: textColumn(rowValue, 'id'),
    name: textColumn(rowValue, 'name'),
    platform: enumColumn(rowValue, 'platform', DEVICE_PLATFORMS),
    scopes: scopesColumn(rowValue, 'scopes'),
    createdAt: textColumn(rowValue, 'created_at'),
    lastSeenAt: nullableTextColumn(rowValue, 'last_seen_at'),
    publicKey: nullableTextColumn(rowValue, 'public_key'),
    fingerprint: nullableTextColumn(rowValue, 'fingerprint'),
    refreshTokenHash: textColumn(rowValue, 'refresh_token_hash'),
    refreshPreviousHash: nullableTextColumn(rowValue, 'refresh_previous_hash'),
    refreshExpiresAt: textColumn(rowValue, 'refresh_expires_at'),
    revokedAt: nullableTextColumn(rowValue, 'revoked_at'),
  };
}

export function deviceFromRow(recordValue: DeviceRecord): Device {
  return {
    id: recordValue.id,
    name: recordValue.name,
    platform: recordValue.platform,
    scopes: recordValue.scopes,
    createdAt: recordValue.createdAt,
    lastSeenAt: recordValue.lastSeenAt,
  };
}

export function usageFromRow(rowValue: Row): UsageRecord {
  return {
    id: integerColumn(rowValue, 'id'),
    runId: nullableTextColumn(rowValue, 'run_id'),
    repoId: nullableTextColumn(rowValue, 'repo_id'),
    day: textColumn(rowValue, 'day'),
    model: nullableTextColumn(rowValue, 'model'),
    tokensIn: integerColumn(rowValue, 'tokens_in'),
    tokensOut: integerColumn(rowValue, 'tokens_out'),
    costUsd: realColumn(rowValue, 'cost_usd'),
    createdAt: textColumn(rowValue, 'created_at'),
  };
}
