import { healthSchema, providersSchema, telemetrySchema } from '@codebox/contracts';
import type { Health, Providers, Telemetry } from '@codebox/contracts';
import { TransportError, apiErrorFrom, isSuccessStatus } from './transport.js';
import type { CliTransport } from './transport.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface DoctorReport {
  readonly checks: readonly CheckResult[];
  readonly ok: boolean;
}

export interface DoctorOptions {
  readonly now: () => Date;
  readonly token: string | null;
}

export const CHECK_NAMES: readonly string[] = Object.freeze([
  'db',
  'opencode',
  'tunnel',
  'github',
  'disk',
  'queue',
  'cost',
  'backup',
]);

export const DISK_WARN_PERCENT = 70;
export const DISK_FAIL_PERCENT = 85;
export const COST_WARN_USD = 10;
export const COST_FAIL_USD = 20;
export const MISSING_ROUTE = 'missing_route';

const NAME_WIDTH = 12;
const STATUS_WIDTH = 6;

export async function readHealth(transport: CliTransport, token: string | null): Promise<Health> {
  const response = await transport.send({ method: 'GET', path: '/v1/health', token });
  const parsed = healthSchema.safeParse(response.body);
  if (parsed.success) return parsed.data;
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  throw new TransportError('bad_response', 'GET /v1/health did not answer with a health document');
}

export async function doctorChecks(
  transport: CliTransport,
  options: DoctorOptions,
): Promise<DoctorReport> {
  const health = await readHealth(transport, options.token);
  const providers = await readOptional(
    transport,
    options.token,
    '/v1/providers',
    undefined,
    providersSchema,
  );
  const telemetry = await readOptional(
    transport,
    options.token,
    '/v1/telemetry',
    { range: '24h' },
    telemetrySchema,
  );
  const checks: readonly CheckResult[] = [
    componentCheck('db', health.db),
    componentCheck('opencode', health.opencode),
    {
      name: 'tunnel',
      status: componentStatus(health.status),
      detail: `reached ${baseUrlOf(transport)}, health.status = ${health.status}`,
    },
    githubCheck(providers),
    diskCheck(health.disk.usedPercent),
    queueCheck(health.queue),
    costCheck(telemetry),
    backupCheck(),
  ];
  return { checks, ok: checks.every((check) => check.status !== 'fail') };
}

export function formatDoctor(report: DoctorReport): string[] {
  return report.checks.map(
    (check) =>
      `${check.name.padEnd(NAME_WIDTH)} ${check.status.padEnd(STATUS_WIDTH)} ${check.detail}`,
  );
}

export function doctorJson(report: DoctorReport): {
  checks: readonly CheckResult[];
  ok: boolean;
} {
  return { checks: report.checks, ok: report.ok };
}

async function readOptional<T>(
  transport: CliTransport,
  token: string | null,
  path: string,
  query: Readonly<Record<string, string>> | undefined,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
): Promise<T | null> {
  const response = await transport.send(
    query === undefined ? { method: 'GET', path, token } : { method: 'GET', path, query, token },
  );
  if (response.status === 404) return null;
  const parsed = schema.safeParse(response.body);
  if (parsed.success) return parsed.data;
  if (!isSuccessStatus(response.status)) throw apiErrorFrom(response);
  throw new TransportError('bad_response', `GET ${path} did not answer with the documented JSON`);
}

function componentCheck(name: string, state: Health['status']): CheckResult {
  return { name, status: componentStatus(state), detail: `health.${name} = ${state}` };
}

function componentStatus(state: Health['status']): CheckStatus {
  if (state === 'ok') return 'ok';
  if (state === 'degraded') return 'warn';
  return 'fail';
}

function baseUrlOf(transport: CliTransport): string {
  const candidate = transport as CliTransport & { readonly baseUrl?: unknown };
  if (typeof candidate.baseUrl === 'string' && candidate.baseUrl.length > 0)
    return candidate.baseUrl;
  return 'the configured URL';
}

function githubCheck(providers: Providers | null): CheckResult {
  if (providers === null) return { name: 'github', status: 'skip', detail: MISSING_ROUTE };
  const github = providers.providers.find((provider) => provider.provider === 'github');
  if (github === undefined) return { name: 'github', status: 'warn', detail: 'not reported' };
  return github.configured
    ? { name: 'github', status: 'ok', detail: `configured (${github.mode})` }
    : { name: 'github', status: 'warn', detail: `not configured (${github.mode})` };
}

function diskCheck(usedPercent: number): CheckResult {
  if (usedPercent >= DISK_FAIL_PERCENT) {
    return { name: 'disk', status: 'fail', detail: `${usedPercent}% used` };
  }
  if (usedPercent >= DISK_WARN_PERCENT) {
    return { name: 'disk', status: 'warn', detail: `${usedPercent}% used` };
  }
  return { name: 'disk', status: 'ok', detail: `${usedPercent}% used` };
}

function queueCheck(queue: Health['queue']): CheckResult {
  const status: CheckStatus = queue.running < queue.maxConcurrency ? 'ok' : 'warn';
  return {
    name: 'queue',
    status,
    detail: `${queue.running}/${queue.maxConcurrency} running, ${queue.pending} pending`,
  };
}

function costCheck(telemetry: Telemetry | null): CheckResult {
  if (telemetry === null) return { name: 'cost', status: 'skip', detail: MISSING_ROUTE };
  const detail = `$${telemetry.spendUsd.toFixed(2)} in 24h`;
  if (telemetry.spendUsd >= COST_FAIL_USD) return { name: 'cost', status: 'fail', detail };
  if (telemetry.spendUsd >= COST_WARN_USD) return { name: 'cost', status: 'warn', detail };
  return { name: 'cost', status: 'ok', detail };
}

function backupCheck(): CheckResult {
  return { name: 'backup', status: 'skip', detail: MISSING_ROUTE };
}
